import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, json, privateDirectory } from './helpers.mjs';
import { NmmClient } from '../dist/client.js';

const { ActionStore } = await import('../dist/actions.js').catch(() => ({}));
const target = { account_id: '101', subscription_id: 'sub', resource_group: 'rg', pool_name: 'pool', host_name: 'host.example.com' };
async function setup(t, handler = (_, res) => json(res, { jobId: 4821 }), opts = {}) {
  assert.equal(typeof ActionStore, 'function', 'operator approval store must exist');
  const f = await fixture(t, handler);
  const dir = await privateDirectory(t);
  f.env.NERDIO_ENABLE_WRITES = 'true';
  const store = new ActionStore(dir, f.env, new NmmClient(f.env, { fetch: f.fetch, ...opts.clientOptions }), opts);
  return { ...f, dir, store };
}

test('unapproved requests cannot cause writes', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('restart_host', target);
  await assert.rejects(f.store.execute(a.action_id), /approval/i);
  assert.equal(f.requests.length, 0);
});

test('approved writes use the exact target and are single-use across store instances', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id);
  const second = new ActionStore(f.dir, f.env, new NmmClient(f.env, { fetch: f.fetch }));
  const results = await Promise.allSettled([f.store.execute(a.action_id), second.execute(a.action_id)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const writes = f.requests.filter(r => r.method === 'POST' && r.url !== '/token');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url, '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/hosts/host.example.com/restart');
  assert.equal(writes[0].body, '{}');
  const state = await f.store.status(a.action_id);
  assert.equal(state.state, 'submitted');
  assert.equal(state.job_id, '4821');
});

test('expired approvals fail before a network request', async t => {
  const f = await setup(t, undefined, { ttlMs: 20 });
  const a = await f.store.prepare('stop_host', target);
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(f.store.approve(a.action_id), /expired/i);
  assert.equal(f.requests.length, 0);
});

test('changed requests invalidate approvals', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('start_host', target);
  await f.store.approve(a.action_id);
  const path = join(f.dir, `${a.action_id}.request.json`);
  const record = JSON.parse(await readFile(path, 'utf8'));
  record.target.host_name = 'different-host';
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(f.store.execute(a.action_id), /approval/i);
  assert.equal(f.requests.length, 0);
});

test('approval cannot be reused for another deployment or revoked account', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('start_host', target);
  await f.store.approve(a.action_id);
  const changed = new ActionStore(f.dir, { ...f.env, NERDIO_BASE_URL: 'https://other.test' }, new NmmClient(f.env));
  await assert.rejects(changed.execute(a.action_id), /deployment/i);
  f.env.NERDIO_ALLOWED_ACCOUNT_IDS = '102';
  await assert.rejects(f.store.execute(a.action_id), /allowlist/i);
  assert.equal(f.requests.length, 0);
});

test('writes disabled means proposals and execution fail closed', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('start_host', target);
  await f.store.approve(a.action_id);
  f.env.NERDIO_ENABLE_WRITES = 'false';
  await assert.rejects(f.store.execute(a.action_id), /disabled/i);
  await assert.rejects(f.store.prepare('start_host', target), /disabled/i);
});

test('ambiguous failures consume approval and persist no sensitive response', async t => {
  const f = await setup(t, (_, res) => json(res, { secret: 'fixture-secret' }, 500));
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id);
  await assert.rejects(f.store.execute(a.action_id), /unknown/i);
  await assert.rejects(f.store.execute(a.action_id), /consumed|attempted/i);
  assert.equal((await f.store.status(a.action_id)).state, 'unknown');
  for (const name of await readdir(f.dir)) assert.ok(!(await readFile(join(f.dir, name), 'utf8')).includes('fixture-secret'));
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.url !== '/token').length, 1);
});

test('autoscale approval covers the entire configuration and uses PUT', async t => {
  const f = await setup(t);
  const pool = { ...target }; delete pool.host_name;
  const config = { enableAutoScale: false, hostPoolCapacity: 3, autoHeal: { enable: false } };
  const a = await f.store.prepare('set_autoscale', pool, config);
  assert.deepEqual(a.config, config);
  await f.store.approve(a.action_id);
  await f.store.execute(a.action_id);
  const request = f.requests.find(r => r.method === 'PUT');
  assert.equal(request.url, '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/autoscale-configuration');
  assert.deepEqual(JSON.parse(request.body), config);
});

test('invalid operations, paths and sensitive autoscale bodies are rejected', async t => {
  const f = await setup(t);
  await assert.rejects(f.store.prepare('delete_host', target), /operation/i);
  await assert.rejects(f.store.prepare('restart_host', { ...target, host_name: '../escape' }), /identifier|target/i);
  const pool = { ...target }; delete pool.host_name;
  await assert.rejects(f.store.prepare('set_autoscale', pool, { enableAutoScale: true, clientSecret: 'secret' }), /secret|sensitive/i);
  assert.equal(f.requests.length, 0);
});

test('action state cannot be read by an unauthorized account and IDs cannot traverse paths', async t => {
  const f = await setup(t);
  const a = await f.store.prepare('start_host', target);
  f.env.NERDIO_ALLOWED_ACCOUNT_IDS = '102';
  await assert.rejects(f.store.status(a.action_id), /allowlist/i);
  await assert.rejects(f.store.status('../escape'), /action ID/i);
});

test('symbolic links in approval records are rejected', async t => {
  const f = await setup(t);
  const id = '00000000-0000-4000-8000-000000000000';
  const external = join(await privateDirectory(t), 'external.json');
  await writeFile(external, '{}');
  await symlink(external, join(f.dir, `${id}.request.json`));
  await assert.rejects(f.store.status(id));
});

test('completed-with-errors jobs report a failed outcome under their approved account', async t => {
  const f = await setup(t, (r, res) => json(res, r.method === 'POST' ? { jobId: 4821 } : { status: 'CompletedWithErrors', error: 'failed task' }));
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id);
  await f.store.execute(a.action_id);
  const result = await f.store.refresh(a.action_id);
  assert.equal(result.state, 'failed');
  assert.equal(result.job.status, 'CompletedWithErrors');
  assert.ok(f.requests.some(r => r.url === '/rest-api/v1/job/4821'));
});

test('job wait deadline includes a stalled HTTP status request', async t => {
  const f = await setup(t, (r, res) => { if (r.method === 'POST') json(res, 4821); else { res.writeHead(200); res.write('{'); } }, { clientOptions: { timeoutMs: 500 } });
  const a = await f.store.prepare('start_host', target);
  await f.store.approve(a.action_id);
  await f.store.execute(a.action_id);
  const result = await f.store.wait(a.action_id, 40);
  assert.equal(result.timed_out, true);
  assert.equal(result.state, 'submitted');
});

test('local review digest is required by the operator approval executable', async t => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const f = await setup(t);
  const a = await f.store.prepare('restart_host', target);
  const env = { ...process.env, ...f.env, NERDIO_STATE_DIR: f.dir };
  const review = JSON.parse((await run(process.execPath, ['dist/index.js', 'review', a.action_id], { env })).stdout);
  assert.equal(review.request.target.host_name, 'host.example.com');
  await assert.rejects(run(process.execPath, ['dist/index.js', 'approve', a.action_id, '--digest', '0'.repeat(64)], { env }));
  assert.equal((await f.store.status(a.action_id)).state, 'pending_approval');
  await run(process.execPath, ['dist/index.js', 'approve', a.action_id, '--digest', review.digest], { env });
  assert.equal((await f.store.status(a.action_id)).state, 'approved');
  assert.equal(f.requests.length, 0);
});

test('terminal outcomes remain available after stale replies or job endpoint failures', async t => {
  let polls = 0;
  const f = await setup(t, (r, res) => {
    if (r.method === 'POST') json(res, 4821);
    else if (++polls === 1) json(res, { status: 'Completed' });
    else json(res, { status: 'Running' }, polls > 2 ? 404 : 200);
  });
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id); await f.store.execute(a.action_id);
  assert.equal((await f.store.refresh(a.action_id)).state, 'succeeded');
  assert.equal((await f.store.refresh(a.action_id)).state, 'succeeded');
  assert.equal((await f.store.refresh(a.action_id)).state, 'succeeded');
  assert.equal(polls, 1);
});

test('concurrent polling never overwrites a terminal job with an older running reply', async t => {
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let polls = 0;
  const f = await setup(t, async (r, res) => {
    if (r.method === 'POST') json(res, 4821);
    else if (++polls === 1) { entered(); await delayed; json(res, { status: 'Running' }); }
    else json(res, { status: 'Completed' });
  });
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id); await f.store.execute(a.action_id);
  const oldPoll = f.store.refresh(a.action_id); await started;
  await f.store.refresh(a.action_id); release();
  assert.equal((await oldPoll).state, 'succeeded');
  assert.equal((await f.store.status(a.action_id)).state, 'succeeded');
});

test('malformed job payloads fail explicitly while unknown string statuses remain pending', async t => {
  let reply;
  const f = await setup(t, (r, res) => json(res, r.method === 'POST' ? 4821 : reply));
  const a = await f.store.prepare('start_host', target);
  await f.store.approve(a.action_id); await f.store.execute(a.action_id);
  for (const malformed of [null, [], {}, { error: 'invalid job' }, { status: 1 }, { status: {} }, { status: '' }, { data: null }]) {
    reply = malformed;
    await assert.rejects(f.store.refresh(a.action_id), e => e.code === 'INVALID_RESPONSE');
  }
  reply = { status: 'NewVendorPendingStatus' };
  assert.equal((await f.store.refresh(a.action_id)).state, 'submitted');
});

test('directory sync failures prevent approved mutations from being dispatched', async t => {
  const fsPromises = (await import('node:fs/promises')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const f = await setup(t);
  const a = await f.store.prepare('restart_host', target);
  await f.store.approve(a.action_id);
  const original = fsPromises.open;
  const mocked = t.mock.method(fsPromises, 'open', async (...args) => {
    const handle = await original(...args);
    if ((await handle.stat()).isDirectory()) handle.sync = async () => { throw new Error('directory sync failed'); };
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { mocked.mock.restore(); syncBuiltinESMExports(); });
  await assert.rejects(f.store.execute(a.action_id), /sync|durab/i);
  assert.equal(f.requests.length, 0);
});

test('failed initial action lookup cleans up wait cancellation listeners', async t => {
  const f = await setup(t);
  const { getEventListeners } = await import('node:events');
  const controller = new AbortController();
  await assert.rejects(f.store.wait('00000000-0000-4000-8000-000000000000', 50, controller.signal));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

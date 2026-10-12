import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { NmmClient } from '../dist/client.js';
import { fixture, json, privateDirectory } from './helpers.mjs';
const { createServer } = await import('../dist/server.js').catch(() => ({}));
const pool = { account_id: '101', subscription_id: 'sub', resource_group: 'rg', pool_name: 'pool' };

async function connect(t, f, env = {}) {
  assert.equal(typeof createServer, 'function', 'MCP server factory must exist');
  const config = { ...f.env, NERDIO_STATE_DIR: await privateDirectory(t), ...env };
  const service = createServer(config, { client: new NmmClient(config, { fetch: f.fetch, retryBaseMs: 1 }) });
  const client = new Client({ name: 'fixture-client', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await service.server.connect(a); await client.connect(b);
  t.after(async () => { await client.close(); await service.server.close(); });
  return { ...service, client, config };
}
const data = result => result.structuredContent.data;

test('MCP inventory tools issue verified routes with complete host-pool parameters', async t => {
  const f = await fixture(t, (r, res) => json(res, r.url.includes('autoscale') ? { enableAutoScale: true } : [{ id: 1 }]));
  const { client } = await connect(t, f, { NERDIO_ALLOW_ACCOUNT_DISCOVERY: 'true', NERDIO_ALLOW_GLOBAL_JOBS: 'true' });
  for (const [name, args, route] of [
    ['list_accounts', {}, '/rest-api/v1/accounts'],
    ['list_host_pools', { account_id: '101' }, '/rest-api/v1/accounts/101/host-pool'],
    ['list_session_hosts', pool, '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/hosts'],
    ['list_sessions', pool, '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/sessions'],
    ['get_autoscale', pool, '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/autoscale-configuration'],
    ['get_job', { job_id: '4821' }, '/rest-api/v1/job/4821'],
  ]) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, undefined);
    assert.ok(data(result));
    assert.equal(f.requests.at(-1).url, route);
  }
});

test('MCP account boundaries, global gates, unknown fields and flag injection fail before networking', async t => {
  const f = await fixture(t, (_, res) => json(res, []));
  const { client } = await connect(t, f);
  for (const [name, args] of [
    ['list_accounts', {}], ['get_job', { job_id: '4821' }],
    ['list_host_pools', { account_id: '999' }],
    ['list_session_hosts', { ...pool, pool_name: '--help' }],
    ['list_session_hosts', { account_id: '101', host_pool_id: 'pool' }],
    ['list_host_pools', { account_id: '101', arbitrary_url: 'https://attacker.test' }],
  ]) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal(f.requests.length, 0);
});

test('MCP writes require local approval and action-job lookup stays authorized without a global jobs gate', async t => {
  const f = await fixture(t, (r, res) => json(res, r.method === 'POST' ? { jobId: 4821 } : { status: 'Completed' }));
  const { client, actions } = await connect(t, f, { NERDIO_ENABLE_WRITES: 'true' });
  const proposal = data(await client.callTool({ name: 'prepare_host_action', arguments: { ...pool, host_name: 'host', operation: 'restart_host' } }));
  assert.equal(f.requests.length, 0);
  assert.equal((await client.callTool({ name: 'execute_action', arguments: { action_id: proposal.action_id } })).isError, true);
  await actions.approve(proposal.action_id);
  assert.equal(data(await client.callTool({ name: 'execute_action', arguments: { action_id: proposal.action_id } })).state, 'submitted');
  const completed = await client.callTool({ name: 'wait_for_action', arguments: { action_id: proposal.action_id, timeout_seconds: 1 } });
  assert.equal(data(completed).state, 'succeeded');
  assert.equal((await client.callTool({ name: 'execute_action', arguments: { action_id: proposal.action_id } })).isError, true);
});

test('MCP failed jobs return isError and secrets never reach content or structured output', async t => {
  const f = await fixture(t, (r, res) => json(res, r.method === 'POST' ? { jobId: 4821 } : { status: 'Failed', clientSecret: 'fixture-secret' }));
  const { client, actions } = await connect(t, f, { NERDIO_ENABLE_WRITES: 'true' });
  const p = data(await client.callTool({ name: 'prepare_host_action', arguments: { ...pool, host_name: 'host', operation: 'stop_host' } }));
  await actions.approve(p.action_id);
  await client.callTool({ name: 'execute_action', arguments: { action_id: p.action_id } });
  const result = await client.callTool({ name: 'get_action_status', arguments: { action_id: p.action_id } });
  assert.equal(result.isError, true);
  assert.equal(data(result).state, 'failed');
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('stdio executable discovers tools without credentials and reports a safe configuration error', async t => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], cwd: process.cwd(), env: { PATH: process.env.PATH }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', chunk => { stderr += chunk; });
  t.after(() => client.close());
  await client.connect(transport);
  const registry = await client.listTools();
  assert.ok(registry.tools.some(tool => tool.name === 'prepare_host_action'));
  assert.ok(registry.tools.find(tool => tool.name === 'execute_action').annotations.destructiveHint);
  assert.ok(!registry.tools.some(tool => tool.name === 'approve_action'));
  const error = await client.callTool({ name: 'list_host_pools', arguments: { account_id: '101' } });
  assert.equal(error.isError, true);
  assert.equal(stderr, '');
});

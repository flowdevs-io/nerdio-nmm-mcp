import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, json } from './helpers.mjs';

const { NmmClient } = await import('../dist/client.js').catch(() => ({}));
const client = (f, options = {}) => {
  assert.equal(typeof NmmClient, 'function', 'native NMM client must exist');
  return new NmmClient(f.env, { fetch: f.fetch, retryBaseMs: 1, ...options });
};

test('OAuth client credentials are encoded, cached and never written to disk', async t => {
  const f = await fixture(t, (_, res) => json(res, { name: 'pool' }));
  const c = client(f);
  await Promise.all([c.get('/rest-api/v1/accounts/101/host-pool'), c.get('/rest-api/v1/accounts/102/host-pool')]);
  const tokens = f.requests.filter(r => r.url === '/token');
  assert.equal(tokens.length, 1);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokens[0].body)), { grant_type: 'client_credentials', client_id: 'fixture-client', client_secret: 'fixture-secret', scope: 'fixture-app/.default' });
  assert.equal(f.requests[1].headers.authorization, 'Bearer fixture-access-token');
});

test('pagination returns every item and preserves the original scoped route', async t => {
  const f = await fixture(t, (r, res) => json(res, r.url.includes('page=2') ? { items: [{ id: 2 }] } : { items: [{ id: 1 }], nextLink: '/rest-api/v1/accounts/101/host-pool?page=2' }));
  const result = await client(f).list('/rest-api/v1/accounts/101/host-pool');
  assert.deepEqual(result.items, [{ id: 1 }, { id: 2 }]);
  assert.equal(result.pages, 2);
});

for (const link of ['https://attacker.test/steal', '/rest-api/v1/accounts/102/host-pool?page=2', '/rest-api/v1/accounts/101/host-pool/../secrets', '/rest-api/v1/accounts/101/host-pool?page=1']) {
  test(`unsafe or looping pagination is rejected: ${link}`, async t => {
    const f = await fixture(t, (_, res) => json(res, { items: [], nextLink: link }));
    await assert.rejects(client(f).list('/rest-api/v1/accounts/101/host-pool'), /pagination/i);
    assert.ok(f.requests.length <= 3);
  });
}

test('read requests retry rate limits and transient failures', async t => {
  let n = 0;
  const f = await fixture(t, (_, res) => { if (++n === 1) { res.setHeader('Retry-After', '0'); json(res, {}, 429); } else if (n === 2) json(res, {}, 503); else json(res, { ok: true }); });
  assert.deepEqual(await client(f).get('/rest-api/v1/accounts'), { ok: true });
  assert.equal(n, 3);
});

test('writes are never retried after server errors', async t => {
  let n = 0;
  const f = await fixture(t, (_, res) => { n++; json(res, { secret: 'private failure' }, 503); });
  await assert.rejects(client(f).mutate('POST', '/rest-api/v1/accounts/101/host-pool/sub/rg/pool/hosts/host/restart', {}), /503/);
  assert.equal(n, 1);
});

test('401 refresh is read-only and bounded', async t => {
  let n = 0;
  const f = await fixture(t, (_, res) => json(res, { ok: ++n > 1 }, n === 1 ? 401 : 200));
  await client(f).get('/rest-api/v1/accounts');
  assert.equal(f.requests.filter(r => r.url === '/token').length, 2);
  n = 0;
  await assert.rejects(client(f).mutate('POST', '/rest-api/v1/accounts/101/test', {}), /401/);
  assert.equal(n, 1);
});

test('redirects never receive bearer tokens', async t => {
  const f = await fixture(t, (_, res) => { res.writeHead(302, { Location: 'https://attacker.test' }); res.end(); });
  await assert.rejects(client(f).get('/rest-api/v1/accounts'), /302/);
  assert.equal(f.requests.length, 2);
});

test('malformed and oversized responses fail without exposing payloads', async t => {
  const f = await fixture(t, (r, res) => res.end(r.url.includes('large') ? 'x'.repeat(1024 * 1024 + 1) : 'fixture-secret invalid JSON'));
  await assert.rejects(client(f).get('/rest-api/v1/malformed'), e => /JSON/.test(e.message) && !e.message.includes('fixture-secret'));
  await assert.rejects(client(f).get('/rest-api/v1/large'), /limit/i);
});

test('response body stalls and caller cancellations are bounded', async t => {
  const f = await fixture(t, (_, res) => { res.writeHead(200); res.write('{'); });
  await assert.rejects(client(f, { timeoutMs: 50 }).get('/rest-api/v1/accounts'), /timeout/i);
  const controller = new AbortController();
  const promise = client(f).get('/rest-api/v1/accounts', controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(promise, /cancel/i);
});

test('production URLs require HTTPS and reject credentials and URL query parameters', async t => {
  const f = await fixture(t, (_, res) => json(res, []));
  for (const base of ['http://nmm.test', 'https://u:p@nmm.test', 'https://nmm.test?secret=x', 'https://nmm.test/#x']) {
    f.env.NERDIO_BASE_URL = base;
    await assert.rejects(client(f).get('/rest-api/v1/accounts'), /NERDIO_BASE_URL/);
  }
  assert.equal(f.requests.length, 0);
});

test('secret fields and credential strings are redacted recursively', async t => {
  const f = await fixture(t, (_, res) => json(res, { name: 'Pool A', clientSecret: 'other-secret', nested: [{ password: 'p', recoveryKey: 'key', message: 'Bearer fixture-access-token fixture-secret' }] }));
  const result = await client(f).get('/rest-api/v1/accounts');
  assert.equal(result.name, 'Pool A');
  assert.equal(result.clientSecret, '[REDACTED]');
  assert.equal(result.nested[0].password, '[REDACTED]');
  assert.equal(result.nested[0].recoveryKey, '[REDACTED]');
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
  assert.ok(!JSON.stringify(result).includes('fixture-access-token'));
});

test('read transport failures retry but mutation transport failures do not', async t => {
  let reads = 0, writes = 0;
  const f = await fixture(t, (r, res) => {
    if (r.method === 'GET' && ++reads > 1) json(res, { ok: true });
    else { if (r.method === 'POST') writes++; res.destroy(); }
  });
  assert.deepEqual(await client(f).get('/rest-api/v1/accounts'), { ok: true });
  await assert.rejects(client(f).mutate('POST', '/rest-api/v1/accounts/101/test', {}), /unknown/i);
  assert.equal(reads, 2); assert.equal(writes, 1);
});

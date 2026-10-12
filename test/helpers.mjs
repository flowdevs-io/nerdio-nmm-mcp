import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function fixture(t, handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const entry = { method: req.method, url: req.url, headers: req.headers, body };
    requests.push(entry);
    if (req.url === '/token') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ access_token: 'fixture-access-token', expires_in: 3600, token_type: 'Bearer' }));
    } else await handler(entry, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const env = { NERDIO_BASE_URL: 'https://nmm.test', NERDIO_TOKEN_URL: 'https://identity.test/token', NERDIO_CLIENT_ID: 'fixture-client', NERDIO_CLIENT_SECRET: 'fixture-secret', NERDIO_OAUTH_SCOPE: 'fixture-app/.default', NERDIO_ALLOWED_ACCOUNT_IDS: '101,102' };
  const fetchLocal = (url, init) => fetch(origin + new URL(url).pathname + new URL(url).search, init);
  return { env, requests, fetch: fetchLocal };
}

export async function privateDirectory(t) {
  const dir = await mkdtemp(join(tmpdir(), 'nmm-actions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export function json(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

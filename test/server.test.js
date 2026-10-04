import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

async function withServer(options, fn) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('serves the POC and reports missing credentials without exposing a token', async () => {
  await withServer({ key: '', region: '' }, async base => {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.ready, false);
    const token = await fetch(`${base}/api/token`);
    assert.equal(token.status, 503);
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/../secret`)).status, 404);
    assert.equal((await fetch(`${base}/not-found`)).status, 404);
  });
});

test('exchanges the key for a short-lived token and only returns token and region', async () => {
  let observed;
  await withServer({ key: 'secret-key', region: 'centralindia', tokenFetch: async (url, options) => {
    observed = { url, options };
    return { ok: true, text: async () => 'temporary-token' };
  } }, async base => {
    const response = await fetch(`${base}/api/token`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { token: 'temporary-token', region: 'centralindia' });
  });
  assert.match(observed.url, /centralindia\.api\.cognitive\.microsoft\.com\/sts\/v1\.0\/issueToken/);
  assert.equal(observed.options.headers['Ocp-Apim-Subscription-Key'], 'secret-key');
});

test('does not reflect upstream secrets or accept other methods', async () => {
  await withServer({ key: 'secret-key', region: 'centralindia', tokenFetch: async () => ({ ok: false, status: 401 }) }, async base => {
    const result = await fetch(`${base}/api/token`);
    assert.equal(result.status, 502);
    assert.doesNotMatch(await result.text(), /secret-key/);
    assert.equal((await fetch(`${base}/api/token`, { method: 'POST' })).status, 405);
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import app from './index.js';
import { API_PROVIDERS, providerStatus } from '../web/shared/api-providers.js';

test('public setup status reports credential presence without values or a writable endpoint', async () => {
  const env = Object.fromEntries(API_PROVIDERS.flatMap(p => p.fields.map(f => [f.name, 'private-value-' + f.name])));
  const response = await app.fetch(new Request('https://app.test/api/setup/status'), env, {});
  const body = await response.json();
  assert.equal(body.writable, false); assert.equal(body.mode, 'server');
  assert.ok(Object.values(body.providers).every(p => p.configured));
  assert.ok(!JSON.stringify(body).includes('private-value'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(Object.values(providerStatus({})).every(p => !p.configured));
  assert.equal(providerStatus({ ALPACA_API_KEY: 'key' }).alpaca.configured, false);
  assert.equal(providerStatus({ ALPACA_API_KEY: 'key', ALPACA_API_SECRET: 'secret' }).alpaca.configured, true);
});

test('the public Worker never accepts visitor keys even on localhost or with a local-looking token', async () => {
  for (const host of ['https://app.test', 'http://127.0.0.1:8820']) {
    const response = await app.fetch(new Request(host + '/api/setup/credentials', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': host, 'X-Ultimater-CSRF': 'fake' },
      body: JSON.stringify({ provider: 'finnhub', credentials: { FINNHUB_API_KEY: 'never-save-this' } }) }), {}, {});
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'setup_local_only');
  }
  const response = await app.fetch(new Request('https://app.test/api/setup/status', { method: 'POST' }), {}, {});
  assert.equal(response.status, 405);
});

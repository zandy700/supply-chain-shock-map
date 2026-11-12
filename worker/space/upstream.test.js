import test from 'node:test';
import assert from 'node:assert/strict';
import { getJSON, resetSpaceUpstreamForTests } from './upstream.js';

test('a live price caller enforces its own freshness budget on a cache warmed by a slower panel', async () => {
  const realFetch = globalThis.fetch, realNow = Date.now;
  let clock = 100000, calls = 0;
  Date.now = () => clock;
  globalThis.fetch = async () => Response.json({ price: ++calls });
  resetSpaceUpstreamForTests();
  try {
    assert.equal((await getJSON('https://example.test/quote', { ttl: 3600 })).price, 1);
    clock += 29000;
    assert.equal((await getJSON('https://example.test/quote', { ttl: 30 })).price, 1);
    clock += 1001;
    assert.equal((await getJSON('https://example.test/quote', { ttl: 30 })).price, 2);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = realFetch; Date.now = realNow; resetSpaceUpstreamForTests(); }
});

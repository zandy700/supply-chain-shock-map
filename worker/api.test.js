import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.js';
const request = path => new Request('https://pulse.test'+path);
test('health only reports key presence', async () => {
  const r = await worker.fetch(request('/api/health'), {FINNHUB_API_KEY:'test-secret'});
  assert.deepEqual(await r.json(), {ok:true,finnhub:true});
});
for (const [input, status] of [['',400],['MSFT,$BAD',400],[Array.from({length:13},(_,i)=>'A'+i).join(','),400]]) {
  test(`reject invalid/empty/over-cap input: ${input}`, async () => {
    const r = await worker.fetch(request('/api/briefing?tickers='+encodeURIComponent(input)), {});
    assert.equal(r.status,status);
    assert.ok((await r.json()).error);
  });
}
test('no-key live is empty, normalized, and explicitly unresolved', async () => {
  const r = await worker.fetch(request('/api/briefing?tickers=msft,MSFT,Microsoft'), {});
  const p = await r.json();
  assert.deepEqual(p.tickers,['MSFT']);
  assert.deepEqual(p.unresolved,['Microsoft']);
  assert.equal(p.mode,'live');
  assert.deepEqual(p.impacts,[]);
  assert.match(p.notice,/FINNHUB_API_KEY/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNewsBatches, loadOptionScanBatches } from '../../web/shared/feed-batches.js';

const symbols = Array.from({ length: 40 }, (_, i) => 'S' + String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26));

test('news covers 40 symbols and merges duplicate stories with all matching stocks', async () => {
  const calls = [];
  const data = await loadNewsBatches(async (route, params) => {
    assert.equal(route, 'news/feed');
    const batch = params.symbols.split(','); calls.push(batch);
    return { items: [{ id: 'shared', url: 'https://example.test/shared', date: '2026-11-10', symbols: batch },
      { id: batch[0], date: '2026-11-11', symbols: [batch[0]] }], providers: ['Feed'], as_of: '2026-11-12' };
  }, symbols);
  assert.deepEqual(calls.map(c => c.length), [12, 12, 12, 4]);
  assert.deepEqual(data.items.find(i => i.id === 'shared').symbols, symbols);
  assert.equal(data.items.length, 5); assert.equal(data.items.at(-1).id, 'shared');
  assert.deepEqual(data.providers, ['Feed']); assert.equal(data.partial, false);
});

test('news distinguishes an empty feed from partial and complete outages, and propagates aborts', async () => {
  const empty = await loadNewsBatches(async () => ({ items: [] }), ['AAPL']);
  assert.deepEqual(empty.items, []); assert.equal(empty.partial, false);
  const partial = await loadNewsBatches(async (_, p) => {
    if (p.symbols.startsWith(symbols[12])) throw new Error('offline');
    return { items: [], errors: [{ symbol: symbols[0], code: 'missing' }] };
  }, symbols);
  assert.equal(partial.partial, true); assert.deepEqual(partial.failedSymbols, symbols.slice(12, 24));
  assert.ok(partial.errors.some(e => e.symbol === symbols[23]));
  await assert.rejects(loadNewsBatches(async () => { throw new Error('offline'); }, ['AAPL']), /could not be refreshed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadNewsBatches(async () => assert.fail(), ['AAPL'], { signal: controller.signal }), { name: 'AbortError' });
});

test('options combines all batches before ranking and retains missing-source coverage', async () => {
  const calls = [];
  const result = await loadOptionScanBatches(async (_, params) => {
    const batch = params.symbols.split(','); calls.push(batch);
    const indicative = batch[0] === symbols[0];
    return { contracts: batch.map(s => ({ id: s, symbol: s, volOI: symbols.indexOf(s), vol: 1, premium: 1 })),
      providers: batch.map(symbol => ({ symbol, unavailableMetrics: indicative ? ['volume', 'openInterest'] : [] })),
      provider: indicative ? 'alpaca' : 'nasdaq', feed: indicative ? 'indicative' : 'delayed',
      indicative, source: indicative ? 'Alpaca' : 'Nasdaq', fetchedAt: indicative ? '2026-11-10' : '2026-11-11',
      coverage: { partial: indicative }, total: batch.length };
  }, [...symbols, '^GSPC'], { sort: 'ratio' }, { limit: 5 });
  assert.deepEqual(calls.map(c => c.length), [12, 12, 12, 4]);
  assert.deepEqual(result.contracts.map(c => c.symbol), symbols.slice(-5).reverse());
  assert.deepEqual(result.unavailable, ['^GSPC']); assert.equal(result.total, 40);
  assert.equal(result.provider, 'mixed-by-symbol'); assert.equal(result.indicative, false);
  assert.equal(result.feed, 'mixed-by-symbol'); assert.equal(result.coverage.partial, true);
  assert.equal(result.fetchedAt, '2026-11-10'); assert.deepEqual(result.unavailableMetrics, []);
});

test('options reports unavailable volume honestly and keeps partial results when a batch fails', async () => {
  const result = await loadOptionScanBatches(async (_, p) => {
    if (p.symbols.startsWith(symbols[12])) throw new Error('offline');
    return { contracts: [], providers: p.symbols.split(',').map(symbol => ({ symbol, unavailableMetrics: ['volume', 'openInterest'] })),
      provider: 'alpaca', feed: 'indicative', indicative: true, notices: ['No volume'], total: 0 };
  }, symbols, { sort: 'volume' });
  assert.deepEqual(result.unavailableMetrics, ['volume', 'openInterest']);
  assert.deepEqual(result.unavailable, symbols.slice(12, 24)); assert.equal(result.coverage.partial, true);
  assert.equal(result.indicative, true); assert.equal(result.notices.filter(n => n === 'No volume').length, 1);
  await assert.rejects(loadOptionScanBatches(async () => assert.fail(), ['^GSPC'], {}), /US stock/);
});

test('equal and unknown option ratios retain the provider volume tie-break across batches', async () => {
  const result = await loadOptionScanBatches(async () => ({ contracts: [
    { id: 'a', symbol: 'AAPL', volOI: null, vol: 100 },
    { id: 'z', symbol: 'Z', volOI: null, vol: 900 },
    { id: 'm', symbol: 'MSFT', volOI: 2, vol: 10 }
  ] }), ['AAPL'], { sort: 'ratio' });
  assert.deepEqual(result.contracts.map(c => c.id), ['m', 'z', 'a']);
});

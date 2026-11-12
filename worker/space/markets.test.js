import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, fromWatchlist, periodReturns, closeOnOrBefore, handle, resolveQuotes, nasdaqQuotes } from './markets.js';
import { resetSpaceUpstreamForTests } from './upstream.js';

const route = path => { const u = new URL('https://pulse.test/api/space/markets/' + path); return handle(new Request(u), {}, {}, u, u.pathname.split('/').at(-1)); };
test('regular and after-hours quotes keep missing changes and prior prices unknown', () => {
  assert.equal(fromWatchlist({ symbol: 'NVDA', lastSalePrice: '$100', netChange: null }).change, null);
  const q = fromWatchlist({ symbol: 'NVDA', lastSalePrice: '$105', netChange: '$5', previousClosePrice: '$90', marketStatus: 'After Hours', percentageChange: '5%' });
  assert.equal(q.price, 100); assert.equal(q.change, 10); assert.equal(q.ext.price, 105);
  const missing = fromWatchlist({ symbol: 'NVDA', lastSalePrice: '$105', netChange: null, previousClosePrice: '$90', marketStatus: 'After Hours' });
  assert.equal(missing.price, null); assert.equal(missing.change, null); assert.equal(missing.ext.price, 105);
});
test('theme aggregation excludes missing returns and only weights available market caps', () => {
  const a = aggregate([{ symbol: 'A', changePercent: 10, marketCap: 100 }, { symbol: 'B', changePercent: -5, marketCap: 300 }, { symbol: 'C', missing: true }]);
  assert.equal(a.count, 3); assert.equal(a.quoted, 2); assert.equal(a.equalWeightChangePercent, 2.5); assert.equal(a.capWeightedChangePercent, -1.25);
  assert.equal(aggregate([]).equalWeightChangePercent, null);
});
test('period returns use closes on or before the boundary, never a future close', () => {
  const now = Date.UTC(2026, 10, 11);
  const rows = [{ date: '2026-11-03', close: 100 }, { date: '2026-11-05', close: 200 }];
  assert.equal(periodReturns(rows, 110, now)['1W'], 10);
  assert.equal(periodReturns(rows, 110, now)['1Y'], null);
  assert.equal(closeOnOrBefore(rows, '2026-11-01'), null);
});
test('route input validation rejects unsupported universes, periods, symbols and movers', async () => {
  for (const path of ['movers?type=anything', 'quotes?symbols=../secret', 'quotes', 'heatmap?universe=nope', 'heatmap?period=10Y', 'screener?preset=nope']) {
    const u = new URL('https://pulse.test/api/space/markets/' + path);
    await assert.rejects(handle(new Request(u), {}, {}, u, path.split('?')[0]), e => e.status === 400);
  }
  const response = await route('unknown'); assert.equal(response.status, 404);
});
test('catalogs are local metadata and do not call providers', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail('catalog must not fetch');
  try {
    const themes = await (await route('theme')).json(); assert.ok(themes.themes.length >= 24);
    const screens = await (await route('screener')).json(); assert.ok(screens.presets.length >= 8);
  } finally { globalThis.fetch = original; }
});
test('mixed crypto and Cboe quotes retain null fields without inventing zeros', async () => {
  const original = globalThis.fetch; resetSpaceUpstreamForTests();
  globalThis.fetch = async url => {
    if (String(url).includes('cboe.com')) return Response.json({ data: { current_price: 6000, price_change: null, prev_day_close: null, high: null, low: null } });
    if (String(url).includes('/products/stats')) return Response.json({ 'BTC-USD': { stats_24hour: { last: '90000', open: '80000', volume: '10' } } });
    throw new Error('Unexpected request');
  };
  try {
    const data = await resolveQuotes(['^SPX', 'BTC-USD']);
    assert.equal(data.get('^SPX').change, null); assert.equal(data.get('^SPX').prevClose, null);
    assert.equal(data.get('BTC-USD').price, 90000); assert.equal(data.get('BTC-USD').changePercent, 12.5);
  } finally { globalThis.fetch = original; resetSpaceUpstreamForTests(); }
});

test('frontend sorts missing values last in both directions and filters unavailable fund feeds', async () => {
  const { sortedMarketRows, themeListRows } = await import('../../web/space/panels/markets.js');
  const rows = [{ symbol: 'A', price: 0 }, { symbol: 'B', price: null }, { symbol: 'C', price: 10 }];
  assert.deepEqual(sortedMarketRows(rows, 'price', true).map(r => r.symbol), ['A', 'C', 'B']);
  assert.deepEqual(sortedMarketRows(rows, 'price', false).map(r => r.symbol), ['C', 'A', 'B']);
  assert.deepEqual(rows.map(r => r.symbol), ['A', 'B', 'C']);
  const constituents = [{ symbol: 'NVDA', assetClass: 'stocks' }, { symbol: 'SMH', assetClass: 'etf' }];
  assert.deepEqual(themeListRows(constituents, 'etfs').map(r => r.symbol), ['SMH']);
  assert.deepEqual(themeListRows(constituents, 'funds'), []);
});

test('market quote cache coalesces short repeats but advances within the refresh cadence', async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now;
  let now = Date.UTC(2026, 10, 11, 15), calls = 0;
  Date.now = () => now;
  resetSpaceUpstreamForTests();
  globalThis.fetch = async url => {
    assert.ok(String(url).includes('/quote/watchlist?'));
    calls++;
    return Response.json({ status: { rCode: 200 }, data: [{ symbol: 'NVDA', companyName: 'NVIDIA', lastSalePrice: String(100 + calls), lastTradeTimestampDateTime: `provider-time-${calls}` }] });
  };
  try {
    const first = await nasdaqQuotes(['NVDA']);
    now += 29000;
    const cached = await nasdaqQuotes(['NVDA']);
    assert.equal(calls, 1);
    assert.equal(cached.get('NVDA').price, first.get('NVDA').price);
    now += 1001;
    const next = await nasdaqQuotes(['NVDA']);
    assert.equal(calls, 2);
    assert.equal(next.get('NVDA').price, 102);
    assert.equal(next.get('NVDA').asOf, 'provider-time-2');
  } finally { globalThis.fetch = originalFetch; Date.now = originalNow; resetSpaceUpstreamForTests(); }
});

test('crypto checks never become fabricated source times and tape preserves reported times', async () => {
  const original = globalThis.fetch; resetSpaceUpstreamForTests();
  globalThis.fetch = async raw => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/products/stats')) return Response.json({ 'BTC-USD': { stats_24hour: { last: '90000', open: '80000', volume: '10' } } });
    if (url.hostname.includes('coingecko')) return Response.json([]);
    if (url.pathname.endsWith('/quote/watchlist')) return Response.json({ status: { rCode: 200 }, data: [{ symbol: 'GLD', companyName: 'Gold', lastSalePrice: '100', lastTradeTimestampDateTime: '2026-11-11T16:00:00-05:00' }] });
    throw new Error('Unexpected request');
  };
  try {
    const u = new URL('https://pulse.test/api/space/markets/movers?type=crypto-all');
    const crypto = await (await handle(new Request(u), {}, {}, u, 'movers')).json();
    assert.equal(crypto.asOf, null);
    assert.ok(Number.isFinite(Date.parse(crypto.checkedAt)));
    assert.equal(crypto.rows[0].price, 90000);
    const t = new URL('https://pulse.test/api/space/markets/tape?region=commodities');
    const tape = await (await handle(new Request(t), {}, {}, t, 'tape')).json();
    assert.equal(tape[0].asOf, '2026-11-11T16:00:00-05:00');
    const c = new URL('https://pulse.test/api/space/markets/tape?region=crypto');
    const untimed = await (await handle(new Request(c), {}, {}, c, 'tape')).json();
    assert.equal(untimed[0].asOf, null);
  } finally { globalThis.fetch = original; resetSpaceUpstreamForTests(); }
});

test('most-active feed failure uses a labeled large-cap share-volume sample and keeps valid full-market rows', async () => {
  const original = globalThis.fetch;
  let fullMarket = false;
  globalThis.fetch = async raw => {
    const url = new URL(raw);
    if (url.pathname.endsWith('/marketmovers')) return fullMarket ? Response.json({ status: { rCode: 200 }, data: { STOCKS: { MostActiveByDollarVolume: { dataAsOf: 'provider-time', table: { rows: [{ symbol: 'NVDA', name: 'NVIDIA', lastSalePrice: '100', lastSaleChange: '1', change: '1%' }] } } } } }) : new Response('', { status: 503 });
    if (url.pathname.endsWith('/screener/stocks')) return Response.json({ status: { rCode: 200 }, data: { rows: [{ symbol: 'NVDA', name: 'NVIDIA', marketCap: '1000000000000', country: 'United States' }, { symbol: 'AMD', name: 'AMD', marketCap: '100000000000', country: 'United States' }] } });
    if (url.pathname.endsWith('/quote/watchlist')) return Response.json({ status: { rCode: 200 }, data: [{ symbol: 'NVDA', lastSalePrice: '100', volume: '10' }, { symbol: 'AMD', lastSalePrice: '50', volume: '20' }] });
    throw new Error('Unexpected request');
  };
  try {
    for (const normal of [false, true]) {
      fullMarket = normal; resetSpaceUpstreamForTests();
      const url = new URL('https://pulse.test/api/space/markets/movers?type=most-active');
      const data = await (await handle(new Request(url), {}, {}, url, 'movers')).json();
      if (!normal) {
        assert.equal(data.notice, 'High-volume large-cap sample');
        assert.equal(data.coverage, 'large-cap-sample');
        assert.equal(data.asOf, null);
        assert.deepEqual(data.rows.map(r => r.symbol), ['AMD', 'NVDA']);
        assert.match(data.definition, /not a full-market dollar-volume ranking/);
      } else {
        assert.equal(data.notice, undefined);
        assert.equal(data.asOf, 'provider-time');
        assert.deepEqual(data.rows.map(r => r.symbol), ['NVDA']);
      }
    }
  } finally { globalThis.fetch = original; resetSpaceUpstreamForTests(); }
});

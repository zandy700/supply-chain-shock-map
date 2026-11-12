import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, allowedIntervals, aggregate, weekKey, intradayBars, nyOffset, resetChartForTests, financialSeries, applyCryptoTrade } from './chart.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import * as M from '../../web/space/panels/chart-math.js';
import { chartSourceStamp } from '../../web/space/panels/chart-math.js';

test('daily source periods keep their UTC trading date while intraday/sample timestamps show Eastern time',()=>{
  assert.equal(chartSourceStamp('2026-11-11T00:00:00.000Z','1d'),'Nov 11, 2026');
  assert.match(chartSourceStamp('2026-11-11T00:00:00.000Z','5m'),/Nov 10, 2026.*07:00 PM ET/);
  assert.match(chartSourceStamp('2026-11-11T00:00:00.000Z','1d',true),/Nov 10, 2026.*07:00 PM ET/);
  assert.equal(chartSourceStamp(null,'1d'),'unavailable');
});

const NOW = Date.UTC(2026, 10, 11, 23, 0); // Nov 11 2026 6pm ET
const realFetch = globalThis.fetch;
function stub(routes) {
  const calls = [];
  globalThis.fetch = async (href) => {
    const u = String(href); calls.push(u);
    for (const [re, body] of routes) if (re.test(u)) return typeof body === 'function' ? body(u) : Response.json(body);
    return new Response('not found', { status: 404 });
  };
  return calls;
}
async function get(path, env = {}) {
  const url = new URL('http://x/api/space/chart/' + path);
  const res = await handle(new Request(url), env, {}, url, url.pathname.split('/').pop(), NOW);
  return { status: res.status, body: await res.json() };
}
test.beforeEach(() => { resetSpaceUpstreamForTests(); resetChartForTests(); });
test.after(() => { globalThis.fetch = realFetch; });

const ok = data => ({ data, status: { rCode: 200 } });
const notExists = { data: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: 'Symbol not exists.' }] } };
const wall = (h, m) => Date.UTC(2026, 10, 11, h, m); // NY wall clock encoded as UTC, as Nasdaq does

test('daily stock history parses Nasdaq chart rows, appends a partial session bar and rolls weekly', async () => {
  const calls = stub([
    [/quote\/NVDA\/chart\?assetclass=stocks&charttype=rs/, ok({ exchange: 'NASDAQ-GS', chart: [
      { x: wall(8, 0), y: 170, w: 10 }, { x: wall(9, 30), y: 171, w: 100 }, { x: wall(12, 0), y: 175, w: 200 }, { x: wall(15, 59), y: 173, w: 50 }, { x: wall(17, 0), y: 160, w: 5 }] })],
    [/quote\/NVDA\/chart\?assetclass=stocks&fromdate=/, ok({ company: 'NVIDIA Corporation Common Stock', chart: [
      { x: 0, z: { dateTime: '11/9/2026', open: '173.06', high: '179.92', low: '170.24', close: '178.67', volume: '462,719,300' } },
      { x: 0, z: { dateTime: '11/10/2026', open: '173.97', high: '174.69', low: '165.89', close: '168.89', volume: '429,273,200' } },
      { x: 0, z: { dateTime: '11/6/2026', open: '0', high: '0', low: '0', close: '181.60', volume: '--' } }] })]
  ]);
  const { status, body } = await get('history?symbol=NVDA&range=1M');
  assert.equal(status, 200);
  assert.equal(body.source, 'Nasdaq'); assert.equal(body.delayed, true); assert.equal(body.interval, '1d');
  assert.equal(body.bars.length, 4);
  assert.deepEqual(body.bars[0], { t: Date.UTC(2026, 10, 6), o: null, h: null, l: null, c: 181.6, v: null });
  assert.equal(body.bars[2].v, 429273200);
  const last = body.bars[3];
  assert.equal(last.t, Date.UTC(2026, 10, 11)); assert.equal(last.partial, true);
  assert.deepEqual([last.o, last.h, last.l, last.c, last.v], [171, 175, 171, 173, 350]); // regular session only
  assert.ok(calls.some(u => u.includes('fromdate=2026-10-11&todate=2026-11-11')));
  assert.deepEqual(body.allowed['1D'], ['1m', '2m', '5m', '15m', '30m', '1h']);
  const wk = await get('history?symbol=NVDA&range=1M&interval=1wk');
  assert.equal(wk.body.bars.length, 2); // week of Nov 2 (Fri 6th) and week of Nov 9
  assert.deepEqual([wk.body.bars[1].o, wk.body.bars[1].h, wk.body.bars[1].l, wk.body.bars[1].c], [173.06, 179.92, 165.89, 173]);
});

test('falls back to the etf asset class and returns 404 for unknown symbols', async () => {
  stub([
    [/quote\/SPY\/chart\?assetclass=stocks/, notExists],
    [/quote\/SPY\/chart\?assetclass=etf&fromdate/, ok({ chart: [{ x: 0, z: { dateTime: '11/10/2026', open: '747.94', high: '752.14', low: '744.86', close: '749.92', volume: '40,698,600' } }] })],
    [/quote\/SPY\/chart\?assetclass=etf&charttype/, ok({ chart: [] })],
    [/quote\/ZZZZ\//, notExists]
  ]);
  const spy = await get('history?symbol=SPY&range=1Y');
  assert.equal(spy.status, 200); assert.equal(spy.body.bars.length, 1);
  const bad = await get('history?symbol=ZZZZ&range=1Y');
  assert.equal(bad.status, 404); assert.match(bad.body.error, /No chart data for ZZZZ/);
});

test('intraday 1D converts New York wall-clock to UTC, buckets from 9:30 and flags extended hours', async () => {
  stub([[/quote\/NVDA\/chart\?assetclass=stocks&charttype=rs/, ok({ chartPrevClose: '168.89', exchange: 'NASDAQ-GS', chart: [
    { x: wall(9, 29), y: 170, w: 1 }, { x: wall(9, 30), y: 171, w: 2 }, { x: wall(9, 33), y: 174, w: 3 }, { x: wall(9, 34), y: 169, w: 4 }, { x: wall(9, 35), y: 172, w: 5 }] })]]);
  const { status, body } = await get('history?symbol=NVDA&range=1D&interval=5m');
  assert.equal(status, 200); assert.equal(body.previousClose, 168.89);
  assert.equal(body.bars.length, 3);
  assert.equal(body.bars[0].t, Date.UTC(2026, 10, 11, 14, 25)); assert.equal(body.bars[0].ext, true); // 9:25 ET = 14:25 UTC (EST)
  assert.deepEqual(body.bars[1], { t: Date.UTC(2026, 10, 11, 14, 30), o: 171, h: 174, l: 169, c: 169, v: 9 });
  assert.equal(body.bars[2].t, Date.UTC(2026, 10, 11, 14, 35));
});

test('chart responses keep source sample time separate from the check time and expire quickly', async () => {
  stub([[/quote\/NVDA\/chart\?assetclass=stocks&charttype=rs/, ok({ chart: [
    { x: wall(9, 30), y: 171, w: 2 }, { x: wall(9, 34), y: 174, w: 3 }
  ] })]]);
  const url = new URL('http://x/api/space/chart/history?symbol=NVDA&range=1D&interval=5m');
  const response = await handle(new Request(url), {}, {}, url, 'history', NOW);
  const body = await response.json();
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=30');
  assert.equal(body.asOf, '2026-11-11T14:34:00.000Z');
  assert.equal(body.lastBarAt, '2026-11-11T14:30:00.000Z');
  assert.equal(body.checkedAt, new Date(NOW).toISOString());
});

test('an in-progress daily candle replaces the same-day cached row without duplicate dates', async () => {
  stub([
    [/quote\/NVDA\/chart\?assetclass=stocks&charttype=rs/, ok({ chart: [
      { x: wall(9, 30), y: 171, w: 100 }, { x: wall(12, 0), y: 175, w: 200 }
    ] })],
    [/quote\/NVDA\/chart\?assetclass=stocks&fromdate=/, ok({ chart: [
      { z: { dateTime: '11/10/2026', open: '170', high: '173', low: '169', close: '172', volume: '100' } },
      { z: { dateTime: '11/11/2026', open: '171', high: '172', low: '170', close: '171', volume: '10' } }
    ] })]
  ]);
  const url = new URL('http://x/api/space/chart/history?symbol=NVDA&range=1Y');
  const response = await handle(new Request(url), {}, {}, url, 'history', Date.UTC(2026, 10, 11, 17));
  const body = await response.json();
  assert.equal(body.bars.length, 2);
  assert.equal(body.bars.at(-1).c, 175);
  assert.equal(body.bars.at(-1).partial, true);
  assert.equal(body.asOf, '2026-11-11T17:00:00.000Z');
});

test('price refresh expires the minute cache while reusing the historical base', async () => {
  const realNow = Date.now;
  let clock = realNow(), samples = 0, history = 0;
  Date.now = () => clock;
  stub([
    [/quote\/NVDA\/chart\?assetclass=stocks&charttype=rs/, () => Response.json(ok({ chart: [
      { x: wall(12, 0), y: 170 + ++samples, w: 100 }
    ] }))],
    [/quote\/NVDA\/chart\?assetclass=stocks&fromdate=/, () => {
      history++;
      return Response.json(ok({ chart: [{ z: { dateTime: '11/10/2026', close: '170' } }] }));
    }]
  ]);
  try {
    const first = await get('history?symbol=NVDA&range=1Y');
    clock += 10000;
    const cached = await get('history?symbol=NVDA&range=1Y');
    assert.equal(first.body.bars.at(-1).c, cached.body.bars.at(-1).c);
    clock += 21000;
    const updated = await get('history?symbol=NVDA&range=1Y');
    assert.equal(updated.body.bars.at(-1).c, 172);
    assert.equal(samples, 2);
    assert.equal(history, 1);
  } finally { Date.now = realNow; }
});

test('crypto refreshes its latest trade every fifteen seconds without polling historical candles', async () => {
  const realNow = Date.now;
  let clock = NOW, tick = 0;
  Date.now = () => clock;
  const calls = stub([
    [/api\.exchange\.coinbase\.com\/products\/BTC-USD\/ticker/, () => Response.json({ price: String(100 + ++tick), time: new Date(clock).toISOString(), volume: '999999' })],
    [/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles/, () => Response.json([[NOW / 1000, 90, 110, 100, 100, 1]])]
  ]);
  try {
    const first = await get('history?symbol=BTC-USD&range=1D&interval=1m');
    assert.equal(first.status, 200);
    assert.equal(first.body.bars.at(-1).c, 101);
    assert.equal(first.body.bars.at(-1).v, null);
    const before = calls.filter(u => u.includes('/candles')).length;
    clock += 16000;
    const second = await get('history?symbol=BTC-USD&range=1D&interval=1m');
    assert.equal(second.body.bars.at(-1).c, 102);
    assert.equal(calls.filter(u => u.includes('/candles')).length, before);
    assert.equal(calls.filter(u => u.includes('/ticker')).length, 2);
    assert.ok(second.body.notes.some(n => n.includes('sampled high/low')));
  } finally { Date.now = realNow; }
});

test('long crypto charts reuse completed daily chunks across minute boundaries', async () => {
  const realNow = Date.now;
  let clock = NOW;
  Date.now = () => clock;
  const calls = stub([[/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles/, href => {
    const start = Date.parse(new URL(href).searchParams.get('start')) / 1000;
    return Response.json([[start, 90, 110, 100, 100, 1]]);
  }]]);
  try {
    await get('history?symbol=BTC-USD&range=MAX');
    const before = calls.filter(u => u.includes('/candles')).length;
    assert.equal(before, 14);
    clock += 60000;
    const url = new URL('http://x/api/space/chart/history?symbol=BTC-USD&range=MAX');
    await handle(new Request(url), {}, {}, url, 'history', clock);
    assert.equal(calls.filter(u => u.includes('/candles')).length, before);
    assert.equal(calls.filter(u => u.includes('/ticker')).length, 2);
  } finally { Date.now = realNow; }
});

test('latest trades update only the active UTC bucket after all crypto aggregation', () => {
  const now = Date.UTC(2026, 10, 11, 23, 17, 42);
  const cases = [
    ['1m', Date.UTC(2026, 10, 11, 23, 17)], ['2m', Date.UTC(2026, 10, 11, 23, 16)],
    ['30m', Date.UTC(2026, 10, 11, 23)], ['4h', Date.UTC(2026, 10, 11, 20)],
    ['1d', Date.UTC(2026, 10, 11)], ['1wk', Date.UTC(2026, 10, 9)], ['1mo', Date.UTC(2026, 10, 1)]
  ];
  for (const [interval, t] of cases) {
    const closed = { t: Date.UTC(2026, 9, 1), o: 80, h: 95, l: 75, c: 90, v: 50 };
    const active = { t, o: 100, h: 120, l: 90, c: 110, v: 500 };
    const result = applyCryptoTrade([closed, active], { price: '130', time: new Date(now).toISOString(), volume: '999999' }, interval, now);
    assert.deepEqual(result.bars[0], closed, interval);
    assert.deepEqual(result.bars[1], { ...active, c: 130, h: 130, v: null, partial: true, sampled: true }, interval);
    assert.equal(result.asOf, new Date(now).toISOString());
    assert.equal(result.applied, true);
    assert.equal(active.v, 500, 'cached source bars stay immutable');
  }
});

test('new crypto candles disclose first observed samples and old ticker trades never rewrite closed history', () => {
  const now = Date.UTC(2026, 10, 12, 0, 0, 12);
  const previous = { t: Date.UTC(2026, 10, 11), o: 100, h: 120, l: 90, c: 110, v: 500 };
  const ticker = { price: '115', time: new Date(now).toISOString() };
  const current = applyCryptoTrade([previous], ticker, '1d', now);
  assert.deepEqual(current.bars, [previous, { t: Date.UTC(2026, 10, 12), o: 115, h: 115, l: 115, c: 115, v: null, partial: true, sampled: true }]);
  const old = applyCryptoTrade([previous], { ...ticker, time: '2026-11-11T23:59:59Z' }, '1d', now);
  assert.equal(old.applied, false);
  assert.deepEqual(old.bars, [previous]);
  assert.throws(() => applyCryptoTrade([previous], { price: '-1', time: ticker.time }, '1d', now), /provider_unavailable/);
});

test('sampled crypto candles retain observed extrema and first sample open until an official open is available', () => {
  const now = Date.UTC(2026, 10, 12, 0, 0, 12), t = Date.UTC(2026, 10, 12);
  const base = [{ t, o: 100, h: 102, l: 98, c: 100, v: 500 }];
  const first = applyCryptoTrade(base, { price: '105', time: new Date(now).toISOString() }, '1d', now);
  const second = applyCryptoTrade(base, { price: '101', time: new Date(now + 15000).toISOString() }, '1d', now + 15000, first.observation);
  assert.equal(second.bars.at(-1).h, 105);
  assert.equal(second.bars.at(-1).c, 101);
  assert.equal(second.bars.at(-1).o, 100);
  const firstNew = applyCryptoTrade([], { price: '105', time: new Date(now).toISOString() }, '1d', now);
  const nextNew = applyCryptoTrade([], { price: '101', time: new Date(now + 15000).toISOString() }, '1d', now + 15000, firstNew.observation);
  assert.deepEqual([nextNew.bars[0].o, nextNew.bars[0].h, nextNew.bars[0].l], [105, 105, 101]);
  const official = applyCryptoTrade(base, { price: '101', time: new Date(now + 30000).toISOString() }, '1d', now + 30000, nextNew.observation);
  assert.equal(official.bars[0].o, 100);
  assert.equal(official.bars[0].h, 105);
  const tomorrow = now + 86400000;
  const rolled = applyCryptoTrade([], { price: '90', time: new Date(tomorrow).toISOString() }, '1d', tomorrow, official.observation);
  assert.deepEqual([rolled.bars[0].o, rolled.bars[0].h, rolled.bars[0].l], [90, 90, 90]);
  assert.deepEqual(base, [{ t, o: 100, h: 102, l: 98, c: 100, v: 500 }]);
});

test('rejects unsupported range/interval combinations with the allowed list', async () => {
  stub([]);
  const a = await get('history?symbol=NVDA&range=1Y&interval=5m');
  assert.equal(a.status, 400); assert.deepEqual(a.body.allowed, ['1d', '1wk', '1mo']); assert.match(a.body.error, /not available for the 1Y range/);
  const b = await get('history?symbol=NVDA&range=2W');
  assert.equal(b.status, 400);
  const c = await get('history?symbol=BTC-USD&range=1M&interval=1m');
  assert.equal(c.status, 400);
  await assert.rejects(get('history?symbol=bad$$&range=1M'), e => e.status === 400 && e.code === 'invalid_symbol'); // router maps to 400
});

test('S&P 500 / Dow / Russell indexes report unavailability with an ETF suggestion (no invented data)', async () => {
  const calls = stub([]);
  const r = await get('history?symbol=^GSPC&range=1Y');
  assert.equal(r.status, 404); assert.equal(r.body.proxy, 'SPY');
  assert.equal(calls.length, 0);
});

test('Nasdaq indexes map ^IXIC to COMP and use the historical endpoint', async () => {
  const calls = stub([[/quote\/COMP\/historical\?assetclass=index/, ok({ tradesTable: { rows: [
    { date: '11/10/2026', close: '25,065.87', volume: '--', open: '25,047.45', high: '25,286.83', low: '24,816.10' },
    { date: '11/07/2026', close: '24,900.00', volume: '--', open: '0.00', high: '0.00', low: '0.00' }] } })]]);
  const { status, body } = await get('history?symbol=^IXIC&range=6M');
  assert.equal(status, 200); assert.equal(body.kind, 'index');
  assert.deepEqual(body.bars.map(b => b.c), [24900, 25065.87]);
  assert.equal(body.bars[0].o, null); assert.equal(body.bars[1].v, null);
  assert.ok(calls[0].includes('limit=99999'));
});

test('crypto uses Coinbase candles in chunks, de-duplicates and aggregates 4h', async () => {
  const calls = stub([[/api\.exchange\.coinbase\.com\/products\/BTC-USD\/candles/, u => {
    const start = Date.parse(new URL(u).searchParams.get('start')) / 1000;
    const rows = []; for (let i = 0; i < 4; i++) { const t = Math.ceil(start / 3600) * 3600 + i * 3600; rows.push([t, 100 + i, 110 + i, 105 + i, 106 + i, 1]); }
    return Response.json(rows.reverse());
  }]]);
  const { status, body } = await get('history?symbol=BTC-USD&range=1M&interval=4h');
  assert.equal(status, 200); assert.equal(body.source, 'Coinbase Exchange');
  const candleCalls = calls.filter(u => u.includes('/candles'));
  assert.equal(candleCalls.length, Math.ceil(31 * 24 / 300));
  assert.ok(candleCalls.every(u => u.includes('granularity=3600')));
  for (let i = 1; i < body.bars.length; i++) assert.ok(body.bars[i].t > body.bars[i - 1].t);
  const b0 = body.bars[0];
  assert.ok(b0.h >= b0.o && b0.l <= b0.c);
});

test('allowed interval matrix', () => {
  assert.deepEqual(allowedIntervals('equity', '5D'), ['1d']);
  assert.ok(allowedIntervals('crypto', '1D').includes('1m'));
  assert.ok(!allowedIntervals('crypto', '1Y').includes('1h'));
  assert.deepEqual(allowedIntervals('crypto', 'MAX'), ['1d', '1wk', '1mo']);
});

test('aggregate and weekKey', () => {
  const d = (day, c) => ({ t: Date.UTC(2026, 10, day), o: c, h: c + 1, l: c - 1, c, v: 1 });
  const out = aggregate([d(2, 10), d(3, 11), d(6, 12), d(9, 13)], weekKey);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { t: Date.UTC(2026, 10, 2), o: 10, h: 13, l: 9, c: 12, v: 3 });
  assert.equal(intradayBars([], '5m').length, 0);
  assert.equal(nyOffset(Date.UTC(2026, 6, 1)), -4 * 3600000);
  assert.equal(nyOffset(Date.UTC(2026, 11, 1)), -5 * 3600000);
});

test('metrics: Finnhub series mapped, missing keys marked unavailable, unconfigured provider reported', async () => {
  stub([[/finnhub\.io\/api\/v1\/stock\/metric/, { series: { quarterly: { pe: [{ period: '2026-07-31', v: 40.5 }, { period: '2026-04-30', v: 50 }], eps: [] } } }]]);
  const { body } = await get('metrics?symbol=NVDA', { FINNHUB_API_KEY: 'k' });
  const pe = body.series.find(s => s.id === 'pe');
  assert.equal(pe.available, true); assert.deepEqual(pe.points.map(p => p.v), [50, 40.5]);
  assert.equal(body.series.find(s => s.id === 'eps').available, false);
  const none = await get('metrics?symbol=NVDA', {});
  assert.ok(none.body.series.every(s => !s.available && /not configured/.test(s.reason)));
  const btc = await get('metrics?symbol=BTC-USD', {});
  assert.ok(btc.body.series.every(s => !s.available));
});

// ---- pure indicator math (web/space/panels/chart-math.js) ----
const close = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma / ema / wma', () => {
  assert.deepEqual(M.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = M.ema([1, 2, 3, 4, 5], 3);
  assert.deepEqual(e.slice(0, 3), [null, null, 2]); near(e[3], 3); near(e[4], 4);
  near(M.wma([1, 2, 3], 3)[2], (1 + 4 + 9) / 6);
});
test('rsi matches the classic Wilder example', () => {
  const r = M.rsi(close, 14);
  assert.equal(r[13], null);
  near(r[14], 70.46, 0.05);
});
test('bollinger, macd, stochastic, atr, obv, vwap', () => {
  const bb = M.bollinger([1, 2, 3, 4, 5], 5, 2);
  near(bb.mid[4], 3); near(bb.upper[4], 3 + 2 * Math.sqrt(2));
  const m = M.macd(close, 3, 6, 3);
  assert.ok(m.hist.slice(-1)[0] != null);
  const bars = close.map((c, i) => ({ t: i, o: c, h: c + 1, l: c - 1, c, v: 100 + i }));
  const st = M.stochastic(bars, 5, 3, 1);
  assert.ok(st.k.slice(4).every(v => v >= 0 && v <= 100));
  near(M.atr(bars, 3)[2], 2); // constant 2-point range, small moves
  const ob = M.obv(bars);
  assert.equal(ob[1], -(101)); assert.equal(ob[2], -101 + 102);
  const vw = M.vwap([{ h: 2, l: 0, c: 1, v: 10 }, { h: 4, l: 2, c: 3, v: 30 }]);
  near(vw[1], (1 * 10 + 3 * 30) / 40);
});
test('heikin-ashi, psar, ichimoku displacement, drawdown', () => {
  const bars = close.map((c, i) => ({ t: i, o: c - 0.1, h: c + 0.5, l: c - 0.5, c, v: 1 }));
  const ha = M.heikinAshi(bars);
  near(ha[0].c, (bars[0].o + bars[0].h + bars[0].l + bars[0].c) / 4);
  near(ha[1].o, (ha[0].o + ha[0].c) / 2);
  const ps = M.psar(bars);
  assert.equal(ps[0], null); assert.ok(ps.slice(1).every(Number.isFinite));
  const ich = M.ichimoku(bars, 3, 5, 7, 4);
  assert.equal(ich.spanA.length, bars.length + 4);
  assert.equal(ich.lagging[0], bars[4].c);
  assert.deepEqual(M.drawdown([10, 12, 9, 12]), [0, 0, -25, 0]);
});
test('indicator registry clamps params and exposes panes', () => {
  const bars = close.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }));
  const r = M.computeIndicator('sma', bars, { period: 0 });
  assert.equal(r.lines[0].name, 'SMA 1');
  assert.equal(M.INDICATORS.rsi.pane, 'sub');
  assert.equal(M.computeIndicator('nope', bars), null);
});
test('ticks and time mapping', () => {
  assert.deepEqual(M.niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(M.logTicks(1, 100, 5).ticks, [1, 2, 5, 10, 20, 50, 100]);
  const bars = [{ t: 0 }, { t: 10 }, { t: 30 }];
  assert.equal(M.indexOfTime(bars, 20), 1.5);
  assert.equal(M.timeOfIndex(bars, 1.5), 20);
  assert.equal(M.indexOfTime(bars, 45), 3);
  assert.equal(M.stepValueAt([{ t: 1, v: 'a' }, { t: 5, v: 'b' }], 4), 'a');
  const parts = t => { const d = new Date(t); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), H: 0, M: 0 }; };
  const daily = Array.from({ length: 300 }, (_, i) => ({ t: Date.UTC(2025, 10, 17) + i * 86400000 }));
  const ticks = M.timeTicks(daily, 0, 299, 2, { parts });
  assert.ok(ticks.length >= 3);
  assert.ok(ticks.some(t => t.label === '2026'));
});

test('study pane budget always preserves a visible price plot', () => {
  for (const height of [130,240,500,1000]) for (const count of [0,1,7,30,60]) {
    const layout=M.paneLayout(height,count);
    assert.ok(layout.bottom>=190);
    assert.ok(layout.height>=layout.bottom+30+count*layout.paneH);
  }
});
test('expanded indicator catalog produces aligned finite-or-null data on flat and trending bars',()=>{
  for(const values of [Array(180).fill(100),Array.from({length:180},(_,i)=>80+i/3+Math.sin(i))]){
    const bars=values.map((c,i)=>({t:i*86400000,o:c-.1,h:c+1,l:c-1,c,v:100+i}));
    for(const [id] of Object.entries(M.INDICATORS)){
      const result=M.computeIndicator(id,bars);
      assert.ok(result && Array.isArray(result.lines),id);
      for(const line of result.lines){assert.ok(line.values.length>=bars.length,id);assert.ok(line.values.every(v=>v===null||Number.isFinite(v)),id);}
      if(result.volumeProfile)assert.equal(result.volumeProfile.reduce((a,b)=>a+b.volume,0),bars.reduce((a,b)=>a+b.v,0));
    }
  }
});
test('new momentum and volume studies have expected boundary values',()=>{
  const b=Array.from({length:100},(_,i)=>({t:i,c:i+1,h:i+2,l:i,o:i+1,v:10}));
  assert.equal(M.computeIndicator('roc',b,{period:10}).lines[0].values[10],1000);
  assert.equal(M.computeIndicator('momentum',b,{period:10}).lines[0].values[10],10);
  assert.equal(M.computeIndicator('mfi',b).lines[0].values.at(-1),100);
  assert.equal(M.computeIndicator('regslope',b).lines[0].values.at(-1),1);
  assert.equal(M.computeIndicator('aroon',b).lines[0].values.at(-1),100);
});
test('statement series excludes TTM, nulls and invalid dates and preserves raw units',()=>{
  const rows=financialSeries({period:'annual',columns:[{id:'ttm',end:'2026-01-01'},{id:'2025',end:'2025-01-01'},{id:'2024',end:'2024-01-01'},{id:'bad',end:'bad'}],rows:[{key:'revenue',label:'Revenue',unit:'usd',values:[999,100,null,80]},{key:'capex',label:'Capex',values:[0,null,null,null]}]},'income');
  assert.deepEqual(rows[0].points,[{t:Date.UTC(2025,0,1),v:100}]);assert.equal(rows[0].unit,'$');assert.equal(rows[1].available,false);
});
test('annual Finnhub metrics use annual points rather than quarterly values',async()=>{
 stub([[/stock\/metric/,{series:{annual:{pe:[{period:'2025-12-31',v:18}]},quarterly:{pe:[{period:'2025-12-31',v:99}]}}}]]);
 const r=await get('metrics?symbol=NVDA&period=annual',{FINNHUB_API_KEY:'test'});assert.equal(r.body.series[0].period,'annual');assert.equal(r.body.series[0].points[0].v,18);
});

test('unsupported adjusted total returns are explicitly rejected without fetching',async()=>{
 const calls=stub([]);const r=await get('history?symbol=NVDA&totalReturn=true');assert.equal(r.status,422);assert.equal(r.body.code,'total_return_unavailable');assert.deepEqual(calls,[]);
});
test('non-equity full metric catalog stays unavailable without inventing statements',async()=>{
 const calls=stub([]);const r=await get('metrics?symbol=BTC-USD&full=1');assert.equal(r.status,200);assert.ok(r.body.series.every(m=>!m.available));assert.deepEqual(calls,[]);
});

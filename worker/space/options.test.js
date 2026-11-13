import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceRoute } from './router.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import { parseExpiryGroup, parseLastTrade, normalizeRows, maxPain, summarizeExpiry, scanUnusual, nearTheMoney, daysBetween, resetOptionsStateForTests } from './options.js';
import { cdf, bsPrice, greeks, impliedVol, payoffStats, payoffAt, profitChance, expectedMove, analyze, yearsToExpiry, etCloseMs } from '../../web/space/panels/options-math.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} expected ${b} ± ${tol}, got ${a}`);

// ---- Black-Scholes math -------------------------------------------------------------
test('normal CDF matches reference values', () => {
  close(cdf(0), 0.5, 1e-12); close(cdf(1), 0.8413447460685429, 1e-12); close(cdf(-1.96), 0.024997895148220435, 1e-12); close(cdf(3), 0.9986501019683699, 1e-12); close(cdf(-8), 6.22096057427178e-16, 1e-20);
});

test('Black-Scholes prices match textbook values (Hull: S=42,K=40,r=10%,σ=20%,T=0.5)', () => {
  close(bsPrice('call', 42, 40, 0.5, 0.2, 0.1), 4.7594, 1e-3);
  close(bsPrice('put', 42, 40, 0.5, 0.2, 0.1), 0.8086, 1e-3);
  // put-call parity: C - P = S - K e^{-rT}
  const S = 100, K = 95, T = 0.3, v = 0.35, r = 0.04;
  close(bsPrice('call', S, K, T, v, r) - bsPrice('put', S, K, T, v, r), S - K * Math.exp(-r * T), 1e-9);
  assert.equal(bsPrice('call', 100, 100, 0, 0.2), null);
  assert.equal(bsPrice('call', 100, 100, 0.5, 0), null);
});

test('greeks match reference values and finite differences', () => {
  // S=100,K=100,T=1,r=5%,σ=20%: call Δ≈0.6368, Γ≈0.01876, vega≈0.3752/pt, call θ≈-6.414/yr
  const g = greeks('call', 100, 100, 1, 0.2, 0.05);
  close(g.delta, 0.6368, 1e-4); close(g.gamma, 0.018762, 1e-5); close(g.vega, 0.37524, 1e-4); close(g.theta * 365, -6.414, 1e-2);
  const p = greeks('put', 100, 100, 1, 0.2, 0.05);
  close(p.delta, g.delta - 1, 1e-9); close(p.gamma, g.gamma, 1e-12);
  close(p.theta * 365, -1.658, 1e-2);
  // finite-difference check on delta and vega
  const h = 1e-3;
  close((bsPrice('put', 100 + h, 100, 1, 0.2, 0.05) - bsPrice('put', 100 - h, 100, 1, 0.2, 0.05)) / (2 * h), p.delta, 1e-6);
  close((bsPrice('call', 100, 100, 1, 0.2 + h, 0.05) - bsPrice('call', 100, 100, 1, 0.2 - h, 0.05)) / (2 * h) / 100, g.vega, 1e-6);
});

test('implied volatility round-trips and rejects arbitrage-violating prices', () => {
  for (const [kind, S, K, T, v] of [['call', 173.73, 160, 9 / 365, 0.55], ['put', 173.73, 190, 30 / 365, 0.4], ['call', 50, 80, 2, 0.9], ['put', 760, 600, 0.1, 0.25]]) {
    const price = bsPrice(kind, S, K, T, v);
    close(impliedVol(kind, price, S, K, T), v, 1e-5, `${kind} ${K}`);
  }
  assert.equal(impliedVol('call', 0.5, 100, 50, 0.5), null, 'below intrinsic');
  assert.equal(impliedVol('call', 120, 100, 50, 0.5), null, 'above spot');
  assert.equal(impliedVol('put', 0, 100, 100, 0.5), null);
  assert.equal(impliedVol('call', 5, 100, 100, 0), null, 'expired');
});

test('analyze uses the bid/ask mid and falls back to last', () => {
  const a = analyze('call', { bid: 9, ask: 11, last: 3 }, 100, 100, 0.25);
  assert.equal(a.price, 10); assert.equal(a.priceBasis, 'mid'); assert.ok(a.iv > 0 && a.delta > 0.5);
  const b = analyze('call', { bid: null, ask: 11, last: 10 }, 100, 100, 0.25);
  assert.equal(b.priceBasis, 'last');
  const c = analyze('call', { bid: null, ask: null, last: null }, 100, 100, 0.25);
  assert.equal(c.iv, null); assert.equal(c.delta, null);
});

test('payoff economics, profit chance and expected move', () => {
  assert.deepEqual(payoffStats('call', 'long', 100, 5), { breakEven: 105, maxGain: Infinity, maxLoss: 500 });
  assert.deepEqual(payoffStats('call', 'short', 100, 5), { breakEven: 105, maxGain: 500, maxLoss: Infinity });
  assert.deepEqual(payoffStats('put', 'long', 100, 5), { breakEven: 95, maxGain: 9500, maxLoss: 500 });
  assert.deepEqual(payoffStats('put', 'short', 100, 5), { breakEven: 95, maxGain: 500, maxLoss: 9500 });
  assert.equal(payoffAt('call', 'long', 100, 5, 120), 1500);
  assert.equal(payoffAt('put', 'short', 100, 5, 120), 500);
  const pl = profitChance('call', 'long', 100, 105, 0.25, 0.3), ps = profitChance('call', 'short', 100, 105, 0.25, 0.3);
  close(pl + ps, 1, 1e-12); assert.ok(pl > 0 && pl < 0.5);
  close(expectedMove(100, 0.2, 1), 20, 1e-12);
  assert.equal(expectedMove(100, null, 1), null);
});

test('expiry time uses 4 PM New York close across DST', () => {
  assert.equal(new Date(etCloseMs('2026-07-17')).toISOString(), '2026-07-17T20:00:00.000Z');
  assert.equal(new Date(etCloseMs('2026-11-20')).toISOString(), '2026-11-20T21:00:00.000Z');
  close(yearsToExpiry('2026-11-20', Date.parse('2026-11-19T21:00:00Z')), 1 / 365, 1e-12);
  assert.equal(yearsToExpiry('bad'), null);
});

// ---- Normalization + derived aggregates ---------------------------------------------
const raw = (exp, strike, c, p) => ({ expirygroup: '', expiryDate: exp, strike: String(strike),
  c_Last: c[0], c_Change: c[1], c_Bid: c[2], c_Ask: c[3], c_Volume: c[4], c_Openinterest: c[5],
  p_Last: p[0], p_Change: p[1], p_Bid: p[2], p_Ask: p[3], p_Volume: p[4], p_Openinterest: p[5] });
const nasdaqRows = [
  { expirygroup: 'November 20, 2026', strike: null },
  raw('Nov 20', 90, ['11.00', '1.00', '10.80', '11.20', '1,200', '100'], ['0.05', '--', '--', '0.06', '50', '4,000']),
  raw('Nov 20', 100, ['2.50', '-0.10', '2.40', '2.60', '5,000', '2,000'], ['2.40', '0.20', '2.30', '2.50', '3,000', '3,000']),
  raw('Nov 20', 110, ['0.20', '--', '0.15', '0.25', '800', '--'], ['10.10', '--', '9.90', '10.30', '10', '200']),
  { expirygroup: 'December 18, 2026', strike: null },
  raw('Dec 18', 100, ['5.00', '--', '4.90', '5.10', '10', '10'], ['4.80', '--', '4.70', '4.90', '5', '5'])
];

test('parsers handle Nasdaq formats', () => {
  assert.equal(parseExpiryGroup('November 20, 2026'), '2026-11-20');
  assert.equal(parseExpiryGroup('January 5, 2027'), '2027-01-05');
  assert.equal(parseExpiryGroup('Nov 20'), null);
  assert.deepEqual(parseLastTrade('LAST TRADE: $1,173.73 (AS OF NOV 11, 2026)'), { price: 1173.73, asOf: 'NOV 11, 2026' });
  assert.deepEqual(parseLastTrade('n/a'), { price: null, asOf: null });
  assert.equal(daysBetween('2026-11-11', '2026-11-20'), 9);
});

test('normalizeRows drops alternate option roots but never empties the chain', () => {
  const alt = { ...raw('Nov 20', 100, ['--', '--', '--', '--', '40', '42'], ['--', '--', '--', '--', '--', '--']), drillDownURL: '/market-activity/stocks/test/option-chain/call-put-options/b1est-261120c00100000' };
  const std = { ...nasdaqRows[2], drillDownURL: '/market-activity/stocks/test/option-chain/call-put-options/test--261120c00100000' };
  const rows = normalizeRows([nasdaqRows[0], std, alt], 'TEST');
  assert.equal(rows.length, 1); assert.equal(rows[0].call.vol, 5000);
  assert.equal(normalizeRows([nasdaqRows[0], alt], 'TEST').length, 1, 'falls back to what exists');
  assert.equal(normalizeRows([nasdaqRows[0], std, alt]).length, 2, 'no symbol, no filter');
});

test('normalizeRows groups by expiry and keeps missing values null', () => {
  const rows = normalizeRows(nasdaqRows);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { expiry: '2026-11-20', strike: 90, call: { last: 11, chg: 1, bid: 10.8, ask: 11.2, vol: 1200, oi: 100 }, put: { last: 0.05, chg: null, bid: null, ask: 0.06, vol: 50, oi: 4000 } });
  assert.equal(rows[3].expiry, '2026-12-18');
  assert.equal(rows[2].call.oi, null);
});

test('max pain minimizes holder payout; null without open interest', () => {
  const rows = normalizeRows(nasdaqRows).filter(r => r.expiry === '2026-11-20');
  // payouts: K=90 → puts 3000*10 + 200*20 = 34000; K=100 → calls 100*10 + puts 200*10 = 3000; K=110 → calls 100*20+2000*10 = 22000
  assert.equal(maxPain(rows), 100);
  assert.equal(maxPain([{ strike: 1, call: { oi: null }, put: { oi: null } }]), null);
});

test('summarizeExpiry computes totals, ratios and ATM straddle', () => {
  const rows = normalizeRows(nasdaqRows).filter(r => r.expiry === '2026-11-20');
  const s = summarizeExpiry('2026-11-20', rows, 101, '2026-11-11');
  assert.equal(s.dte, 9);
  assert.deepEqual(s.calls, { vol: 7000, oi: 2100 });
  assert.deepEqual(s.puts, { vol: 3060, oi: 7200 });
  close(s.putCallVolume, 3060 / 7000, 1e-12);
  assert.equal(s.atmStrike, 100); close(s.straddle, 2.5 + 2.4, 1e-12); close(s.expectedMovePct, 100 * 4.9 / 101, 1e-12);
});

test('nearTheMoney keeps the closest strikes per expiry', () => {
  const rows = normalizeRows(nasdaqRows);
  assert.deepEqual(nearTheMoney(rows, 108, 1).map(r => r.strike), [100, 110, 100]);
  assert.equal(nearTheMoney(rows, null, 1).length, rows.length);
});

test('scanUnusual filters by volume and vol/OI and labels moneyness', () => {
  const rows = normalizeRows(nasdaqRows);
  const hits = scanUnusual('TEST', rows, 100, '2026-11-11', { minVolume: 500, minRatio: 1 });
  const key = hits.map(h => `${h.strike}${h.side[0]}`).sort();
  assert.deepEqual(key, ['100c', '100p', '110c', '90c']);
  const c110 = hits.find(h => h.strike === 110);
  assert.equal(c110.volOI, null, 'no reported OI stays null, not infinite');
  close(c110.premium, 0.2 * 800 * 100, 1e-9);
  close(hits.find(h => h.strike === 90).moneyness, 10, 1e-12);
});

// ---- Routes (stubbed fetch) -----------------------------------------------------------
function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (href) => { const u = new URL(href); calls.push(u); return handler(u); };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
const reply = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const chainBody = { status: { rCode: 200 }, data: { totalRecord: 6, lastTrade: 'LAST TRADE: $101.00 (AS OF NOV 11, 2026)', table: { rows: nasdaqRows } } };
const notFound = { data: null, status: { rCode: 400, bCodeMessage: [{ code: 1001, errorMessage: 'Symbol not exists.' }] } };
const infoBody = { status: { rCode: 200 }, data: { companyName: 'Test Co', marketStatus: 'Closed', primaryData: { lastSalePrice: '$100.50', netChange: '-0.50', percentageChange: '-0.50%', lastTradeTimestamp: 'Nov 11, 2026' } } };
const route = path => spaceRoute(new Request('https://pulse.test/api/space/options/' + path), {}, {});
const reset = () => { resetSpaceUpstreamForTests(); resetOptionsStateForTests(); };

test('chain route: defaults to nearest expiry, filters type, falls back to the ETF asset class', async () => {
  reset();
  const f = stubFetch(u => u.pathname.endsWith('/info') ? reply(infoBody) : reply(u.searchParams.get('assetclass') === 'etf' ? chainBody : notFound));
  try {
    const r = await route('chain?symbol=TEST&type=puts');
    const body = await r.json();
    assert.equal(r.status, 200);
    assert.ok(body.expiry >= '2026-11-20' || body.expiry === '2026-12-18');
    assert.equal(body.delayed, true); assert.match(body.source, /Nasdaq/);
    assert.equal(body.underlying.price, 101); assert.equal(body.underlying.last, 100.5);
    assert.ok(body.rows.every(r => r.put && !r.call));
    assert.deepEqual(body.expirations.map(e => e.date), ['2026-11-20', '2026-12-18']);
    assert.ok(f.calls.some(u => u.searchParams.get('assetclass') === 'etf'));
    assert.ok(f.calls.every(u => !/key|token/i.test(u.search)));
    const again = await (await route('chain?symbol=TEST&expiry=2026-12-18')).json();
    assert.equal(again.rows.length, 1);
    const chainCalls = f.calls.filter(u => u.pathname.endsWith('option-chain')).length;
    assert.equal(chainCalls, 2, 'full chain is cached and the ETF class remembered');
    assert.equal((await route('chain?symbol=TEST&expiry=2026-12-19')).status, 404);
    assert.equal((await route('chain?symbol=TEST&expiry=12/18')).status, 400);
  } finally { f.restore(); }
});

test('expirations route returns totals and derived fields', async () => {
  reset();
  const f = stubFetch(u => u.pathname.endsWith('/info') ? reply(infoBody) : reply(chainBody));
  try {
    const body = await (await route('expirations?symbol=TEST')).json();
    assert.equal(body.expirations.length, 2);
    assert.equal(body.expirations[0].maxPain, 100);
    assert.deepEqual(body.totals.calls, { vol: 7010, oi: 2110 });
    assert.ok(body.derived.includes('maxPain'));
  } finally { f.restore(); }
});

test('expiry menus omit old dates while an explicitly requested historical chain remains available', async () => {
  reset();
  const historical = { ...chainBody, data: { ...chainBody.data, table: { rows: [
    { expirygroup: 'January 21, 2000', strike: null },
    raw('Jan 21', 100, ['2', '0', '1.9', '2.1', '900000', '200'], ['2', '0', '1.9', '2.1', '800000', '200']),
    ...nasdaqRows
  ] } } };
  const f = stubFetch(u => u.pathname.endsWith('/info') ? reply(infoBody) : reply(historical));
  try {
    const current = await (await route('chain?symbol=TEST')).json();
    assert.ok(current.expirations.every(e => e.date >= current.today));
    const summary = await (await route('expirations?symbol=TEST')).json();
    assert.ok(summary.expirations.every(e => e.expiry >= summary.today));
    assert.deepEqual(summary.totals.calls, { vol: 7010, oi: 2110 }, 'old volume is excluded from current totals');
    const old = await (await route('chain?symbol=TEST&expiry=2000-01-21')).json();
    assert.equal(old.expiry, '2000-01-21'); assert.equal(old.rows.length, 1);
    assert.ok(old.expirations.some(e => e.date === '2000-01-21'));
  } finally { f.restore(); }
});

test('unusual route validates input, reports unavailable symbols and sorts', async () => {
  reset();
  const f = stubFetch(u => u.pathname.includes('/BAD/') ? reply(notFound) : reply(chainBody));
  try {
    assert.equal((await route('unusual?symbols=')).status, 400);
    assert.equal((await route('unusual?symbols=' + Array.from({ length: 13 }, (_, i) => 'A' + i).join(','))).status, 400);
    const body = await (await route('unusual?symbols=TEST,BAD&minVolume=500&minRatio=1&sort=volume')).json();
    assert.deepEqual(body.unavailable, ['BAD']);
    assert.equal(body.derived, true);
    assert.deepEqual(body.contracts.map(c => c.vol), [5000, 3000, 1200, 800]);
    const ratio = await (await route('unusual?symbols=TEST&sort=ratio')).json();
    assert.equal(ratio.contracts.at(-1).volOI, null, 'unknown OI sorts last');
    const none = await route('unusual?symbols=BAD');
    assert.equal(none.status, 404);
  } finally { f.restore(); }
});

test('upstream outage maps to a 502 error, never fabricated rows', async () => {
  reset();
  const f = stubFetch(() => new Response('oops', { status: 500 }));
  try {
    const r = await route('chain?symbol=TEST');
    assert.equal(r.status, 502);
    assert.deepEqual(await r.json(), { error: 'provider_unavailable' });
  } finally { f.restore(); }
});

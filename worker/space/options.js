// /api/space/options/* — delayed US equity/ETF option chains from the Nasdaq public API.
// Owned by the options-portfolio builder (docs/space-contract.md).
//   chain?symbol=&expiry=YYYY-MM-DD|all&moneyness=all|near&type=all|calls|puts
//   expirations?symbol=           per-expiry totals, put/call ratios, max pain, ATM straddle (derived)
//   unusual?symbols=A,B&minVolume=&minRatio=&limit=   volume vs open-interest scan (derived)
// Nothing here is invented: missing upstream values stay null, derived values are labeled.
import { json, getJSON, symbolParam, num, UpstreamError, SYMBOL } from './upstream.js';

import { alpacaOptionsConfigured, fetchAlpacaChain, resetAlpacaOptionsForTests } from './alpaca-options.js';
import {flowRoute} from './flow.js';
const SOURCE = 'Nasdaq (delayed)';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh) WatchlistPulse', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
const DAY = 86400000;

// "November 11, 2026" -> "2026-11-11"
export function parseExpiryGroup(text) {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(text || '').trim());
  const month = m && MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

// "LAST TRADE: $173.73 (AS OF NOV 11, 2026)" -> { price, asOf }
export function parseLastTrade(text) {
  const m = /\$\s*([\d,]+(?:\.\d+)?)\s*(?:\(AS OF ([^)]+)\))?/i.exec(String(text || ''));
  if (!m) return { price: null, asOf: null };
  return { price: num(m[1]), asOf: m[2] ? m[2].trim() : null };
}

// Today's calendar date in New York, as YYYY-MM-DD.
export function todayET(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export const daysBetween = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY);

const side = (r, p) => ({ last: num(r[p + 'Last']), chg: num(r[p + 'Change']), bid: num(r[p + 'Bid']), ask: num(r[p + 'Ask']), vol: num(r[p + 'Volume']), oi: num(r[p + 'Openinterest']) });

// Option root from Nasdaq's drill-down URL, e.g. ".../nvda--261113c00160000" -> "NVDA".
export const rootOf = url => { const m = /\/([a-z0-9.-]+?)-*\d{6}[cp]\d{8}$/i.exec(url || ''); return m ? m[1].replace(/[^a-z0-9]/gi, '').toUpperCase() : null; };

// Nasdaq table rows -> [{expiry, strike, call, put}]; group header rows carry the expiry date.
// With `symbol`, non-standard roots (adjusted / alternate deliverable contracts such as "B1VDA")
// are dropped so each strike appears once — unless that would leave nothing.
export function normalizeRows(rows, symbol) {
  const out = [], alt = [];
  let expiry = null;
  const want = symbol ? symbol.replace(/[^A-Z0-9]/gi, '').toUpperCase() : null;
  for (const r of rows || []) {
    if (r?.expirygroup) { expiry = parseExpiryGroup(r.expirygroup); continue; }
    const strike = num(r?.strike);
    if (!expiry || strike === null) continue;
    const row = { expiry, strike, call: side(r, 'c_'), put: side(r, 'p_') };
    const root = rootOf(r.drillDownURL);
    (want && root && root !== want ? alt : out).push(row);
  }
  return out.length ? out : alt;
}

export const mid = q => (q && q.bid > 0 && q.ask > 0 && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null);

// Strike at which option holders' aggregate intrinsic value at expiry is smallest.
// Uses open interest only; returns null when there is no open interest.
export function maxPain(rows) {
  const strikes = [...new Set(rows.map(r => r.strike))].sort((a, b) => a - b);
  let best = null, bestPay = Infinity, anyOI = false;
  for (const K of strikes) {
    let pay = 0;
    for (const r of rows) {
      const c = r.call.oi || 0, p = r.put.oi || 0;
      if (c || p) anyOI = true;
      if (K > r.strike) pay += c * (K - r.strike);
      if (K < r.strike) pay += p * (r.strike - K);
    }
    if (pay < bestPay) { bestPay = pay; best = K; }
  }
  return anyOI ? best : null;
}

const sum = (rows, pick) => { let s = 0, any = false; for (const r of rows) { const v = pick(r); if (v !== null && v !== undefined) { s += v; any = true; } } return any ? s : null; };
const ratio = (a, b) => (a !== null && b !== null && b > 0 ? a / b : null);

// Per-expiry aggregates. Expected move = ATM straddle mid (a common market convention), labeled derived.
export function summarizeExpiry(expiry, rows, spot, today) {
  const callVol = sum(rows, r => r.call.vol), putVol = sum(rows, r => r.put.vol);
  const callOI = sum(rows, r => r.call.oi), putOI = sum(rows, r => r.put.oi);
  let atm = null;
  if (spot > 0) for (const r of rows) if (!atm || Math.abs(r.strike - spot) < Math.abs(atm.strike - spot)) atm = r;
  const cm = atm ? mid(atm.call) : null, pm = atm ? mid(atm.put) : null;
  const straddle = cm !== null && pm !== null ? cm + pm : null;
  return {
    expiry, dte: daysBetween(today, expiry), strikes: rows.length,
    calls: { vol: callVol, oi: callOI }, puts: { vol: putVol, oi: putOI },
    putCallVolume: ratio(putVol, callVol), putCallOI: ratio(putOI, callOI),
    maxPain: maxPain(rows),
    atmStrike: atm ? atm.strike : null, straddle,
    expectedMove: straddle, expectedMovePct: straddle !== null && spot > 0 ? (100 * straddle) / spot : null
  };
}

function groupByExpiry(rows) {
  const m = new Map();
  for (const r of rows) { if (!m.has(r.expiry)) m.set(r.expiry, []); m.get(r.expiry).push(r); }
  return m;
}

async function nasdaqRaw(path, params, ttl) {
  const url = new URL('https://api.nasdaq.com/api/' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return getJSON(url.href, { headers: HEADERS, ttl, timeout: 20000 });
}

const CHAIN_TTL = 180;
const chainCache = new Map(); // symbol -> { expires, value: {assetclass, lastTrade, rows} }
const chainInFlight = new Map();
const assetClassOf = new Map(); // Nasdaq needs the right asset class (stocks vs etf)

async function fetchChainOnce(symbol, assetclass) {
  const url = new URL(`https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/option-chain`);
  const params = { assetclass, limit: '20000', fromdate: 'all', todate: 'undefined', excode: 'oprac', callput: 'callput', money: 'all', type: 'all' };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res;
  try { res = await fetch(url.href, { headers: { Accept: 'application/json', ...HEADERS }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new UpstreamError('provider_unavailable'); }
  if (res.status === 429) throw new UpstreamError('rate_limited', 429);
  if (!res.ok) throw new UpstreamError('provider_unavailable');
  let body; try { body = await res.json(); } catch { throw new UpstreamError('provider_unavailable'); }
  if (body?.status?.rCode === 200 && body.data?.table) return { assetclass, lastTrade: body.data.lastTrade, rows: normalizeRows(body.data.table.rows, symbol), provider: 'nasdaq', feed: 'delayed', source: SOURCE, indicative: false, delayed: true, asOf: null, quoteAsOf: null, tradeAsOf: null, fetchedAt: new Date().toISOString(), notices: ['Nasdaq option quotes are delayed. Contract quote and trade timestamps are not supplied by this chain response.'], coverage: { partial: false, pages: 1, contracts: null, droppedContracts: null } };
  if (body?.status?.rCode === 400) return null; // "Symbol not exists" for this asset class
  throw new UpstreamError('provider_unavailable');
}

// Full chain (every expiry and strike) for a symbol, normalized and cached. All routes share it.
export async function fetchChain(symbol) {
  const hit = chainCache.get(symbol);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (chainInFlight.has(symbol)) return chainInFlight.get(symbol);
  const p = (async () => {
    const order = assetClassOf.get(symbol) === 'etf' ? ['etf', 'stocks'] : ['stocks', 'etf'];
    for (const assetclass of order) {
      const value = await fetchChainOnce(symbol, assetclass);
      if (!value) continue;
      assetClassOf.set(symbol, assetclass);
      if (!value.rows.length) throw new UpstreamError('no_options_for_symbol', 404);
      if (chainCache.size >= 64) chainCache.delete(chainCache.keys().next().value);
      chainCache.set(symbol, { value, expires: Date.now() + CHAIN_TTL * 1000 });
      return value;
    }
    throw new UpstreamError('no_options_for_symbol', 404);
  })();
  chainInFlight.set(symbol, p);
  try { return await p; } finally { chainInFlight.delete(symbol); }
}

// Latest trade (may be extended hours) for display; failure is non-fatal.
async function fetchInfo(symbol) {
  const first = assetClassOf.get(symbol) || 'stocks';
  for (const assetclass of [first, first === 'stocks' ? 'etf' : 'stocks']) {
    try {
      const body = await nasdaqRaw(`quote/${encodeURIComponent(symbol)}/info`, { assetclass }, 60);
      const d = body?.data; if (!d?.primaryData) continue;
      const p = d.primaryData;
      return { last: num(p.lastSalePrice), change: num(p.netChange), changePct: num(p.percentageChange), lastTime: p.lastTradeTimestamp || null, marketStatus: d.marketStatus || null, name: d.companyName || null };
    } catch { /* independent spot quote is optional */ }
  }
  return null;
}

async function selectedChain(symbol, env = {}) {
  if (!alpacaOptionsConfigured(env)) return fetchChain(symbol);
  try { return await fetchAlpacaChain(symbol, env); }
  catch (error) {
    const reasons = { alpaca_access_denied: 'access denied', alpaca_rate_limited: 'rate limited', alpaca_invalid_response: 'invalid response', alpaca_no_standard_contracts: 'no supported standard contracts', invalid_symbol: 'unsupported underlying symbol' };
    const reason = reasons[error?.code] || 'provider unavailable';
    const chain = await fetchChain(symbol);
    return { ...chain, fallback: { requestedProvider: 'alpaca', provider: 'nasdaq', reason }, notices: [`Alpaca indicative unavailable (${reason}). Showing Nasdaq option fields instead; option data sources have not been merged.`, ...(chain.notices || [])] };
  }
}
function providerMetadata(chain) {
  const { provider, source, feed, indicative, delayed, asOf, quoteAsOf, tradeAsOf, fetchedAt, coverage, notices, unavailableMetrics = [], fallback } = chain;
  return { provider, source, feed, indicative, delayed, asOf, quoteAsOf, tradeAsOf, fetchedAt, coverage, notices, unavailableMetrics, ...(fallback ? { fallback } : {}) };
}
async function loadWithUnderlying(symbol, env) {
  const chain = await selectedChain(symbol, env);
  const info = await fetchInfo(symbol);
  const lt = parseLastTrade(chain.lastTrade);
  return { chain, underlying: { symbol, price: chain.provider === 'alpaca' ? info?.last ?? null : lt.price, asOf: chain.provider === 'alpaca' ? info?.lastTime ?? null : lt.asOf, source: 'Nasdaq (independent underlying quote; may include extended hours)', delayed: true, fetchedAt: new Date().toISOString(), ...(info || {}) } };
}

// Keep the N strikes closest to spot (per expiry).
export function nearTheMoney(rows, spot, n = 10) {
  if (!(spot > 0)) return rows;
  const out = [];
  for (const list of groupByExpiry(rows).values()) {
    const keep = new Set([...list].sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot)).slice(0, n * 2).map(r => r.strike));
    out.push(...list.filter(r => keep.has(r.strike)));
  }
  return out;
}

function expirationsFrom(rows, spot, today) {
  return [...groupByExpiry(rows)].filter(([e]) => e >= today).sort(([a], [b]) => a.localeCompare(b)).map(([e, list]) => summarizeExpiry(e, list, spot, today));
}

async function chainRoute(url, env) {
  const symbol = symbolParam(url);
  const expiryArg = (url.searchParams.get('expiry') || '').trim();
  if (expiryArg && expiryArg !== 'all' && !/^\d{4}-\d{2}-\d{2}$/.test(expiryArg)) throw new UpstreamError('invalid_expiry', 400);
  const moneyness = url.searchParams.get('moneyness') === 'near' ? 'near' : 'all';
  const type = ['calls', 'puts'].includes(url.searchParams.get('type')) ? url.searchParams.get('type') : 'all';
  const today = todayET();
  const { chain, underlying } = await loadWithUnderlying(symbol, env);
  const expiries = [...new Set(chain.rows.map(r => r.expiry))].sort();
  const expiry = expiryArg === 'all' ? 'all' : expiryArg || expiries.find(e => e >= today) || expiries[0];
  const missingFromPartialCoverage = expiry !== 'all' && !expiries.includes(expiry) && chain.coverage?.partial === true;
  if (expiry !== 'all' && !expiries.includes(expiry) && !missingFromPartialCoverage) throw new UpstreamError('unknown_expiry', 404);
  let rows = expiry === 'all' ? chain.rows.slice() : chain.rows.filter(r => r.expiry === expiry);
  if (moneyness === 'near') rows = nearTheMoney(rows, underlying.price, 10);
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike);
  if (type === 'calls') rows = rows.map(({ put, ...r }) => r);
  if (type === 'puts') rows = rows.map(({ call, ...r }) => r);
  return json({
    symbol, expiry, moneyness, type, today, underlying,
    expirations: expiries.filter(e => e >= today || e === expiry).map(e => ({ date: e, dte: daysBetween(today, e) })),
    rows, ...providerMetadata(chain),
    ...(missingFromPartialCoverage ? { notices: [...(chain.notices || []), `Requested expiry ${expiry} is absent from limited snapshot coverage. This is not evidence that no contracts exist; the requested expiry has been preserved without substituting another date.`] } : {}),
    note: chain.provider === 'alpaca' ? 'Alpaca indicative quotes are modified, not OPRA. Latest trades are delayed 15 minutes. Underlying spot is a separately sourced Nasdaq quote, not an Alpaca option timestamp. IV and Greeks remain derived estimates.' : 'Option quotes are delayed. Underlying price is the last regular-session trade Nasdaq reports with this chain; `last` may include extended hours.'
  }, 200, alpacaOptionsConfigured(env) ? 0 : 60);
}

async function expirationsRoute(url, env) {
  const symbol = symbolParam(url);
  const today = todayET();
  const { chain, underlying } = await loadWithUnderlying(symbol, env);
  const expirations = expirationsFrom(chain.rows, underlying.price, today);
  const tot = k => sum(expirations, e => e[k.split('.')[0]][k.split('.')[1]]);
  const totals = { calls: { vol: tot('calls.vol'), oi: tot('calls.oi') }, puts: { vol: tot('puts.vol'), oi: tot('puts.oi') } };
  totals.putCallVolume = ratio(totals.puts.vol, totals.calls.vol);
  totals.putCallOI = ratio(totals.puts.oi, totals.calls.oi);
  return json({
    symbol, today, underlying, expirations, totals, ...providerMetadata(chain),
    derived: ['putCallVolume', 'putCallOI', 'maxPain', 'straddle', 'expectedMove', 'expectedMovePct'],
    note: 'Max pain uses open interest only and is unavailable without it. Expected move is derived from the at-the-money straddle mid price; on indicative snapshots it uses modified quotes and is not an executable price.'
  }, 200, alpacaOptionsConfigured(env) ? 0 : 120);
}

export function scanUnusual(symbol, rows, spot, today, { minVolume = 500, minRatio = 1 } = {}) {
  const out = [];
  for (const r of rows) for (const [kind, q] of [['call', r.call], ['put', r.put]]) {
    if (!q || q.vol === null || q.vol < minVolume) continue;
    const oi = q.oi ?? 0;
    const volOI = oi > 0 ? q.vol / oi : null; // null = no prior open interest (all new positions)
    if (volOI !== null && volOI < minRatio) continue;
    const m = mid(q);
    const price = m ?? q.last;
    out.push({
      symbol, expiry: r.expiry, dte: daysBetween(today, r.expiry), strike: r.strike, side: kind,
      last: q.last, bid: q.bid, ask: q.ask, vol: q.vol, oi: q.oi, volOI,
      premium: price !== null ? price * q.vol * 100 : null, spot,
      moneyness: spot > 0 ? (kind === 'call' ? (spot - r.strike) / spot : (r.strike - spot) / spot) * 100 : null
    });
  }
  return out;
}

// Ratio sort: known vol/OI first (desc); contracts with no reported OI follow, by volume.
const UNUSUAL_SORTS = {
  ratio: (a, b) => (a.volOI === null) - (b.volOI === null) || (b.volOI ?? 0) - (a.volOI ?? 0) || b.vol - a.vol,
  volume: (a, b) => b.vol - a.vol,
  premium: (a, b) => (b.premium ?? -1) - (a.premium ?? -1)
};

async function unusualRoute(url, env) {
  const raw = (url.searchParams.get('symbols') || url.searchParams.get('symbol') || '').toUpperCase();
  const symbols = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))];
  if (!symbols.length || symbols.length > 12 || symbols.some(s => !SYMBOL.test(s) || s.startsWith('^'))) throw new UpstreamError('invalid_symbols', 400);
  const clamp = (v, lo, hi, d) => { const n = v === null || v === '' ? NaN : Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const minVolume = clamp(url.searchParams.get('minVolume'), 1, 1e7, 500);
  const minRatio = clamp(url.searchParams.get('minRatio'), 0, 1000, 1);
  const limit = clamp(url.searchParams.get('limit'), 1, 500, 100);
  const today = todayET();
  const results = await Promise.allSettled(symbols.map(async s => {
    const chain = await selectedChain(s, env);
    return { metadata: { symbol: s, ...providerMetadata(chain) }, contracts: scanUnusual(s, chain.rows, parseLastTrade(chain.lastTrade).price, today, { minVolume, minRatio }) };
  }));
  const unavailable = [];
  let contracts = [];
  const providers = [];
  results.forEach((r, i) => { if (r.status === 'fulfilled') { contracts.push(...r.value.contracts); providers.push(r.value.metadata); } else unavailable.push(symbols[i]); });
  if (unavailable.length === symbols.length) throw results[0].reason instanceof UpstreamError ? results[0].reason : new UpstreamError('provider_unavailable');
  const sort = ['volume', 'premium', 'ratio'].includes(url.searchParams.get('sort')) ? url.searchParams.get('sort') : 'ratio';
  contracts.sort(UNUSUAL_SORTS[sort]);
  const total = contracts.length;
  contracts = contracts.slice(0, limit);
  return json({
    symbols, today, minVolume, minRatio, sort, total, contracts, unavailable, delayed: true, providers, provider: new Set(providers.map(p => p.provider)).size > 1 ? 'mixed-by-symbol' : providers[0]?.provider, source: [...new Set(providers.map(p => p.source))].join(' / '), feed: providers.every(p => p.feed === 'indicative') ? 'indicative' : providers.every(p => p.feed === 'delayed') ? 'delayed' : 'mixed-by-symbol', indicative: providers.every(p => p.indicative), quoteAsOf: null, tradeAsOf: null, asOf: null, fetchedAt: new Date().toISOString(), coverage: { partial: unavailable.length > 0 || providers.some(p => p.coverage?.partial) }, notices: [...new Set(providers.flatMap(p => p.notices || [])), ...(providers.some(p => p.provider === 'alpaca') ? ['Indicative snapshots have no session volume/open interest; those symbols cannot participate in this scan.'] : [])], derived: true,
    note: 'Derived from delayed chain volume vs. prior-day open interest. Not a trade-by-trade options flow feed; side and sentiment are unknown.'
  }, 200, alpacaOptionsConfigured(env) ? 0 : 120);
}

export async function handle(request, env, ctx, url, rest) {
  if (rest === 'flow') return flowRoute(url,env);
  if (rest === 'status') return json({ configured: alpacaOptionsConfigured(env), provider: alpacaOptionsConfigured(env) ? 'alpaca' : 'nasdaq', feed: alpacaOptionsConfigured(env) ? 'indicative' : 'delayed' });
  if (rest === 'chain') return chainRoute(url, env);
  if (rest === 'expirations') return expirationsRoute(url, env);
  if (rest === 'unusual') return unusualRoute(url, env);
  return json({ error: 'Unknown options route.' }, 404);
}

export function resetOptionsStateForTests() { assetClassOf.clear(); chainCache.clear(); chainInFlight.clear(); resetAlpacaOptionsForTests(); }

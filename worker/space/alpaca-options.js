// Alpaca Basic indicative snapshots only. Authentication is header-only and errors never echo bodies.
// https://docs.alpaca.markets/us/reference/optionchain
import { UpstreamError } from './upstream.js';
export const ALPACA_OPTIONS_SOURCE = 'Alpaca indicative (modified quotes; trades delayed 15 minutes; not OPRA)';
export const ALPACA_PAGE_LIMIT = 5;
const TTL = 30000;
const accounts = new Map();
export function alpacaOptionsConfigured(env = {}) { return typeof env.ALPACA_API_KEY === 'string' && !!env.ALPACA_API_KEY.trim() && typeof env.ALPACA_API_SECRET === 'string' && !!env.ALPACA_API_SECRET.trim(); }
export function parseOCC(value, underlying) {
  const m = /^([A-Z0-9.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(String(value));
  if (!m) return null;
  const expiry = `20${m[2]}-${m[3]}-${m[4]}`;
  const time = Date.parse(expiry + 'T00:00:00Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== expiry) return null;
  const strike = Number(m[6]) / 1000;
  if (!(strike > 0)) return null;
  if (underlying && m[1] !== underlying.replace(/[.-]/g, '').toUpperCase()) return null;
  return { root: m[1], expiry, strike, side: m[5] === 'C' ? 'call' : 'put' };
}
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const timestamp = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
export const latestTimestamp = values => values.filter(Boolean).reduce((latest, value) => !latest || Date.parse(value) > Date.parse(latest) ? value : latest, null);
function emptySide() { return { last: null, chg: null, bid: null, ask: null, vol: null, oi: null, quoteAsOf: null, tradeAsOf: null, asOf: null, contractSymbol: null }; }
export function normalizeSnapshots(snapshots, symbol) {
  const byStrike = new Map(); let droppedContracts = 0, contracts = 0;
  for (const [contractSymbol, snapshot] of Object.entries(snapshots || {})) {
    const occ = parseOCC(contractSymbol, symbol);
    if (!occ || !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) { droppedContracts++; continue; }
    const key = `${occ.expiry}:${occ.strike}`;
    if (!byStrike.has(key)) byStrike.set(key, { expiry: occ.expiry, strike: occ.strike, call: emptySide(), put: emptySide() });
    const quoteAsOf = timestamp(snapshot.latestQuote?.t), tradeAsOf = timestamp(snapshot.latestTrade?.t);
    byStrike.get(key)[occ.side] = { last: amount(snapshot.latestTrade?.p), chg: null, bid: amount(snapshot.latestQuote?.bp), ask: amount(snapshot.latestQuote?.ap), vol: null, oi: null, quoteAsOf, tradeAsOf, asOf: latestTimestamp([quoteAsOf, tradeAsOf]), contractSymbol };
    contracts++;
  }
  return { rows: [...byStrike.values()].sort((a, b) => a.expiry.localeCompare(b.expiry) || a.strike - b.strike), contracts, droppedContracts };
}
async function accountState(env) {
  const bytes = new TextEncoder().encode(JSON.stringify([env.ALPACA_API_KEY, env.ALPACA_API_SECRET]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const key = [...digest].map(n => n.toString(16).padStart(2, '0')).join('');
  if (!accounts.has(key)) { if (accounts.size >= 32) accounts.delete(accounts.keys().next().value); accounts.set(key, { cache: new Map(), inFlight: new Map(), cooldown: 0 }); }
  return accounts.get(key);
}
export async function fetchAlpacaChain(symbol, env = {}) {
  if (!alpacaOptionsConfigured(env)) throw new UpstreamError('alpaca_not_configured', 503);
  if (!/^[A-Z]{1,6}(?:[.-][A-Z])?$/.test(symbol)) throw new UpstreamError('invalid_symbol', 400);
  const state = await accountState(env), hit = state.cache.get(symbol);
  if (hit && hit.until > Date.now()) return hit.value;
  if (state.cooldown > Date.now()) throw new UpstreamError('alpaca_rate_limited', 429);
  if (state.inFlight.has(symbol)) return state.inFlight.get(symbol);
  const work = (async () => {
    const snapshots = Object.create(null), seenTokens = new Set(); let token = null, pages = 0, reason = null;
    do {
      const url = new URL('https://data.alpaca.markets/v1beta1/options/snapshots/' + encodeURIComponent(symbol));
      url.searchParams.set('feed', 'indicative'); url.searchParams.set('limit', '1000');
      if (token) url.searchParams.set('page_token', token);
      let res;
      // workerd supports manual/follow, not the browser's redirect:error mode.
      // Reject 3xx below so authenticated headers never follow a provider redirect.
      try { res = await fetch(url.href, { headers: { Accept: 'application/json', 'APCA-API-KEY-ID': env.ALPACA_API_KEY, 'APCA-API-SECRET-KEY': env.ALPACA_API_SECRET }, signal: AbortSignal.timeout(12000), redirect: 'manual' }); }
      catch { throw new UpstreamError('alpaca_unavailable'); }
      if (res.status === 429) { const seconds = Number(res.headers.get('Retry-After')); state.cooldown = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : 30000); throw new UpstreamError('alpaca_rate_limited', 429); }
      if (res.status === 401 || res.status === 403) throw new UpstreamError('alpaca_access_denied');
      if (!res.ok) throw new UpstreamError('alpaca_unavailable');
      let body; try { body = await res.json(); } catch { throw new UpstreamError('alpaca_invalid_response'); }
      if (!body?.snapshots || typeof body.snapshots !== 'object' || Array.isArray(body.snapshots)) throw new UpstreamError('alpaca_invalid_response');
      if (Object.keys(body.snapshots).length > 1000) throw new UpstreamError('alpaca_invalid_response');
      Object.assign(snapshots, body.snapshots); pages++;
      token = body.next_page_token ?? null;
      if (token === '') token = null;
      if (token !== null && (typeof token !== 'string' || token.length > 4096)) throw new UpstreamError('alpaca_invalid_response');
      if (token && seenTokens.has(token)) { reason = 'Provider repeated a page token; coverage is incomplete.'; break; }
      if (token) seenTokens.add(token);
    } while (token && pages < ALPACA_PAGE_LIMIT);
    const normalized = normalizeSnapshots(snapshots, symbol);
    if (!normalized.rows.length) throw new UpstreamError('alpaca_no_standard_contracts', 404);
    const quoteAsOf = latestTimestamp(normalized.rows.flatMap(r => [r.call.quoteAsOf, r.put.quoteAsOf]));
    const tradeAsOf = latestTimestamp(normalized.rows.flatMap(r => [r.call.tradeAsOf, r.put.tradeAsOf]));
    const coverage = { partial: !!token, pages, contracts: normalized.contracts, droppedContracts: normalized.droppedContracts, ...(token ? { reason: reason || `Limited to ${ALPACA_PAGE_LIMIT} snapshot pages; more contracts are available from the provider.` } : {}) };
    const value = { rows: normalized.rows, assetclass: null, lastTrade: null, provider: 'alpaca', source: ALPACA_OPTIONS_SOURCE, feed: 'indicative', indicative: true, delayed: true, quoteAsOf, tradeAsOf, asOf: latestTimestamp([quoteAsOf, tradeAsOf]), fetchedAt: new Date().toISOString(), coverage, unavailableMetrics: ['volume', 'openInterest', 'change'], notices: ['Indicative quotes are modified and are not executable OPRA quotations. Trades are delayed 15 minutes.', 'This snapshot endpoint does not provide session volume, open interest or daily change; those fields remain unavailable.', 'Top-level quote/trade timestamps are the latest observed contract updates, not a claim that every contract has that timestamp.', ...(coverage.partial ? [coverage.reason] : []), ...(normalized.droppedContracts ? [`Excluded ${normalized.droppedContracts} malformed, adjusted-root or non-standard contracts.`] : [])] };
    if (state.cache.size >= 16) state.cache.delete(state.cache.keys().next().value);
    state.cache.set(symbol, { until: Date.now() + TTL, value }); return value;
  })();
  state.inFlight.set(symbol, work);
  try { return await work; } finally { state.inFlight.delete(symbol); }
}
export function resetAlpacaOptionsForTests() { accounts.clear(); }

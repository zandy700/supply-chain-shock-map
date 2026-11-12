// /api/space/markets/* — market tape, movers, sectors, heatmaps, themes, batch quotes, screener, sparklines.
// Owned by the markets builder (docs/space-contract.md). Every price comes from a provider; theme
// constituent lists are editorial. Sources:
//   Nasdaq public API (stocks/ETFs/Nasdaq indexes, movers, screener, history) — may be delayed
//   Cboe delayed quotes CDN (S&P 500, Dow via DJX, Russell 2000, VIX) — 15-min delayed
//   Coinbase Exchange public API (crypto, real time) · CoinGecko public API (crypto market caps, optional)
//   U.S. Treasury daily par yield curve (rates, daily close) · ECB reference rates via Frankfurter (FX, daily)
import { THEMES_BY_ID as THEMES, THEME_CATALOG } from '../../web/space/themes.js';
import { json, UpstreamError, getJSON, nasdaq, num } from './upstream.js';

const SRC = {
  nasdaq: 'Nasdaq', cboe: 'Cboe (15-min delayed)', coinbase: 'Coinbase', coingecko: 'CoinGecko',
  treasury: 'U.S. Treasury (daily close)', ecb: 'ECB reference rate (daily)'
};
const MAX_QUOTES = 40;
const day = 864e5;
const isoDate = d => new Date(d).toISOString().slice(0, 10);
const round = (v, d = 4) => (Number.isFinite(v) ? +v.toFixed(d) : null);
const pctOf = (chg, base) => (Number.isFinite(chg) && Number.isFinite(base) && base ? round((chg / base) * 100, 4) : null);

// ---------- Instruments for tape / index movers / market summary ----------
// kind: cboe (Cboe delayed index), nqi (Nasdaq index), nq (Nasdaq stock/ETF), cb (Coinbase), ust (Treasury), fx (ECB)
const INST = {
  '^SPX': { label: 'S&P 500', kind: 'cboe', id: '_SPX' },
  '^DJI': { label: 'Dow 30', kind: 'cboe', id: '_DJX', scale: 100, note: 'Cboe DJX (1/100 of the Dow) × 100' },
  '^COMP': { label: 'Nasdaq', kind: 'nqi', id: 'COMP' },
  '^NDX': { label: 'Nasdaq 100', kind: 'nqi', id: 'NDX' },
  '^RUT': { label: 'Russell 2000', kind: 'cboe', id: '_RUT' },
  '^VIX': { label: 'VIX', kind: 'cboe', id: '_VIX' },
  GLD: { label: 'Gold (GLD proxy)', kind: 'nq', proxy: true },
  SLV: { label: 'Silver (SLV proxy)', kind: 'nq', proxy: true },
  USO: { label: 'Oil (USO proxy)', kind: 'nq', proxy: true },
  BNO: { label: 'Brent (BNO proxy)', kind: 'nq', proxy: true },
  UNG: { label: 'Nat Gas (UNG proxy)', kind: 'nq', proxy: true },
  CPER: { label: 'Copper (CPER proxy)', kind: 'nq', proxy: true },
  DBA: { label: 'Agriculture (DBA proxy)', kind: 'nq', proxy: true },
  DBC: { label: 'Commodities (DBC proxy)', kind: 'nq', proxy: true },
  US3M: { label: '3M T-Bill', kind: 'ust', col: '3 Mo' },
  US2Y: { label: '2Y Yield', kind: 'ust', col: '2 Yr' },
  US5Y: { label: '5Y Yield', kind: 'ust', col: '5 Yr' },
  US10Y: { label: '10Y Yield', kind: 'ust', col: '10 Yr' },
  US30Y: { label: '30Y Yield', kind: 'ust', col: '30 Yr' },
  EURUSD: { label: 'EUR/USD', kind: 'fx', ccy: 'EUR', invert: true },
  GBPUSD: { label: 'GBP/USD', kind: 'fx', ccy: 'GBP', invert: true },
  AUDUSD: { label: 'AUD/USD', kind: 'fx', ccy: 'AUD', invert: true },
  USDJPY: { label: 'USD/JPY', kind: 'fx', ccy: 'JPY' },
  USDCNY: { label: 'USD/CNY', kind: 'fx', ccy: 'CNY' },
  USDCAD: { label: 'USD/CAD', kind: 'fx', ccy: 'CAD' },
  USDCHF: { label: 'USD/CHF', kind: 'fx', ccy: 'CHF' },
  USDMXN: { label: 'USD/MXN', kind: 'fx', ccy: 'MXN' },
  USDINR: { label: 'USD/INR', kind: 'fx', ccy: 'INR' },
  FEZ: { label: 'Euro Stoxx 50 (FEZ proxy)', kind: 'nq', proxy: true },
  EWU: { label: 'UK (EWU proxy)', kind: 'nq', proxy: true },
  EWG: { label: 'Germany (EWG proxy)', kind: 'nq', proxy: true },
  EWQ: { label: 'France (EWQ proxy)', kind: 'nq', proxy: true },
  EWI: { label: 'Italy (EWI proxy)', kind: 'nq', proxy: true },
  EWP: { label: 'Spain (EWP proxy)', kind: 'nq', proxy: true },
  EWL: { label: 'Switzerland (EWL proxy)', kind: 'nq', proxy: true },
  EWN: { label: 'Netherlands (EWN proxy)', kind: 'nq', proxy: true },
  EWJ: { label: 'Japan (EWJ proxy)', kind: 'nq', proxy: true },
  FXI: { label: 'China Large-Cap (FXI proxy)', kind: 'nq', proxy: true },
  EWH: { label: 'Hong Kong (EWH proxy)', kind: 'nq', proxy: true },
  EWY: { label: 'South Korea (EWY proxy)', kind: 'nq', proxy: true },
  EWT: { label: 'Taiwan (EWT proxy)', kind: 'nq', proxy: true },
  INDA: { label: 'India (INDA proxy)', kind: 'nq', proxy: true },
  EWA: { label: 'Australia (EWA proxy)', kind: 'nq', proxy: true },
  EWS: { label: 'Singapore (EWS proxy)', kind: 'nq', proxy: true }
};

// Crypto universe: Coinbase USD pairs, ordered by approximate market-cap rank; `cg` = CoinGecko id.
export const COINS = [
  ['BTC', 'Bitcoin', 'bitcoin'], ['ETH', 'Ethereum', 'ethereum'], ['USDT', 'Tether', 'tether'], ['XRP', 'XRP', 'ripple'],
  ['BNB', 'BNB', 'binancecoin'], ['SOL', 'Solana', 'solana'], ['HYPE', 'Hyperliquid', 'hyperliquid'], ['ZEC', 'Zcash', 'zcash'],
  ['DOGE', 'Dogecoin', 'dogecoin'], ['LINK', 'Chainlink', 'chainlink'], ['ADA', 'Cardano', 'cardano'], ['XLM', 'Stellar', 'stellar'],
  ['NEAR', 'NEAR Protocol', 'near'], ['BCH', 'Bitcoin Cash', 'bitcoin-cash'], ['LTC', 'Litecoin', 'litecoin'], ['UNI', 'Uniswap', 'uniswap'],
  ['AVAX', 'Avalanche', 'avalanche-2'], ['SUI', 'Sui', 'sui'], ['HBAR', 'Hedera', 'hedera-hashgraph'], ['SHIB', 'Shiba Inu', 'shiba-inu'],
  ['PEPE', 'Pepe', 'pepe'], ['AAVE', 'Aave', 'aave'], ['ONDO', 'Ondo', 'ondo-finance'], ['ICP', 'Internet Computer', 'internet-computer'],
  ['DOT', 'Polkadot', 'polkadot'], ['ARB', 'Arbitrum', 'arbitrum'], ['ETC', 'Ethereum Classic', 'ethereum-classic'],
  ['POL', 'Polygon', 'polygon-ecosystem-token'], ['RENDER', 'Render', 'render-token'], ['ATOM', 'Cosmos', 'cosmos'],
  ['FIL', 'Filecoin', 'filecoin'], ['APT', 'Aptos', 'aptos']
].map(([c, name, cg]) => ({ symbol: `${c}-USD`, name, cg }));
const COIN = Object.fromEntries(COINS.map(c => [c.symbol, c]));

const TAPES = {
  us: ['^DJI', '^COMP', '^SPX', '^RUT', '^VIX', 'GLD', 'USO', 'US10Y', 'BTC-USD'],
  europe: ['FEZ', 'EWU', 'EWG', 'EWQ', 'EWI', 'EWP', 'EWL', 'EWN', 'EURUSD', 'GBPUSD'],
  asia: ['EWJ', 'FXI', 'EWH', 'EWY', 'EWT', 'INDA', 'EWA', 'EWS', 'USDJPY', 'USDCNY'],
  crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BNB-USD', 'DOGE-USD', 'ADA-USD', 'LINK-USD', 'AVAX-USD', 'LTC-USD'],
  rates: ['US3M', 'US2Y', 'US5Y', 'US10Y', 'US30Y'],
  commodities: ['GLD', 'SLV', 'USO', 'BNO', 'UNG', 'CPER', 'DBA', 'DBC'],
  fx: ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCNY', 'USDCAD', 'USDCHF', 'AUDUSD', 'USDMXN', 'USDINR']
};
const TAPE_NOTES = {
  us: 'Gold and oil use US-listed ETF proxies; 10Y is the Treasury daily close.',
  europe: 'European markets shown via US-listed country ETFs (traded in US hours), not local indexes.',
  asia: 'Asian markets shown via US-listed country ETFs (traded in US hours), not local indexes.',
  commodities: 'Commodity prices use US-listed ETF proxies, not futures.',
  rates: 'U.S. Treasury daily par yield curve; change vs prior business day.',
  fx: 'ECB daily reference rates; change vs prior fixing.'
};
// Index movers list (mirrors the traced list: US indexes, oil/gold/silver, FX, 10Y, crypto, overseas).
const INDEX_MOVERS = ['^SPX', '^DJI', '^COMP', '^RUT', '^NDX', '^VIX', 'USO', 'GLD', 'SLV', 'EURUSD', 'US10Y', 'GBPUSD', 'USDJPY', 'BTC-USD', 'XRP-USD', 'EWU', 'EWJ'];
const SUMMARY_GROUPS = [
  ['Indexes', ['^SPX', '^DJI', '^COMP', '^NDX', '^RUT', '^VIX']],
  ['Rates', ['US3M', 'US2Y', 'US5Y', 'US10Y', 'US30Y']],
  ['Commodities', ['GLD', 'SLV', 'USO', 'BNO', 'UNG', 'CPER']],
  ['Currencies', ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCNY', 'USDCAD', 'AUDUSD']],
  ['Crypto', ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD', 'ADA-USD']],
  ['World', ['FEZ', 'EWU', 'EWG', 'EWJ', 'FXI', 'INDA']]
];

const SECTORS = [
  ['XLK', 'Technology'], ['XLF', 'Financials'], ['XLV', 'Health Care'], ['XLY', 'Consumer Discretionary'],
  ['XLC', 'Communication Services'], ['XLI', 'Industrials'], ['XLP', 'Consumer Staples'], ['XLE', 'Energy'],
  ['XLU', 'Utilities'], ['XLB', 'Materials'], ['XLRE', 'Real Estate']
];

// Symbols the Nasdaq API treats as ETFs (asset class matters for every Nasdaq quote endpoint).
const ETFS = new Set([...THEME_CATALOG.flatMap(t=>t.constituents.filter(r=>r.instrumentType==='etf').map(r=>r.symbol)),...Object.entries(INST).filter(([, v]) => v.kind === 'nq').map(([k]) => k), ...SECTORS.map(s => s[0]),
  'SPY', 'DIA', 'IWM', 'QQQ', 'VIXY', 'TLT', 'IEF', 'ITB', 'XHB', 'XBI', 'IBB', 'ICLN', 'TAN', 'UFO', 'ARKX', 'HACK', 'CIBR', 'ITA',
  'DRIV', 'JETS', 'BETZ', 'PSP', 'SMH', 'SOXX', 'SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'VOO', 'VTI', 'IVV', 'QQQM', 'VGT', 'XLK', 'ARKK', 'IBIT', 'ETHA', 'GBTC']);

// ---------- Themes (editorial constituent lists; prices always from providers) ----------
export { THEMES_BY_ID as THEMES } from '../../web/space/themes.js';


// ---------- Provider adapters ----------
const textCache = new Map();
async function getText(href, ttl = 3600) {
  const hit = textCache.get(href);
  if (hit && hit.expires > Date.now()) return hit.body;
  let res;
  try { res = await fetch(href, { headers: { Accept: 'text/csv,text/plain,*/*', 'User-Agent': 'Mozilla/5.0 WatchlistPulse' }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new UpstreamError('provider_unavailable'); }
  if (!res.ok) throw new UpstreamError(res.status === 429 ? 'rate_limited' : 'provider_unavailable', res.status === 429 ? 429 : 502);
  const body = await res.text();
  if (textCache.size > 64) textCache.delete(textCache.keys().next().value);
  textCache.set(href, { body, expires: Date.now() + ttl * 1000 });
  return body;
}
export function resetMarketsForTests() { textCache.clear(); }

const cleanName = s => String(s || '').replace(/\s+(Class [A-C] )?(Common Stock|Common Shares|Ordinary Shares|Capital Stock|American Depositary Shares.*|American depositary shares.*|Depositary Shares.*|Common stock)$/i, '').replace(/\s+Class [A-C]$/i, '').trim();
const nqClass = sym => (ETFS.has(sym) ? 'etf' : 'stocks');
const nqSym = sym => sym.toLowerCase();

// One normalized quote row from a Nasdaq watchlist row. After hours, Nasdaq reports the extended-hours
// trade with its change vs the regular close; we expose the regular session (close vs previous close)
// as price/change and the extended trade separately, matching how the traced product shows quotes.
export function fromWatchlist(r) {
  const last = num(r.lastSalePrice), net = num(r.netChange), prev = num(r.previousClosePrice);
  const isIndex = r.assetClass === 'INDEX';
  let price = last, change = net, changePercent = num(r.percentageChange), ext = null;
  if (!isIndex && /after/i.test(r.marketStatus || '') && last !== null) {
    price = net !== null ? round(last - net) : null; change = prev !== null && price !== null ? round(price - prev) : null; changePercent = pctOf(change, prev);
    ext = { session: 'post', price: last, change: net, changePercent: num(r.percentageChange) };
  } else if (!isIndex && /pre/i.test(r.marketStatus || '') && last !== null) {
    ext = { session: 'pre', price: last, change: net, changePercent: num(r.percentageChange) };
  }
  return {
    symbol: r.symbol, name: cleanName(r.companyName), price, change, changePercent, volume: num(r.volume), prevClose: prev,
    open: num(r.openingPrice), ext, assetClass: String(r.assetClass || '').toLowerCase(), marketStatus: r.marketStatus || null,
    asOf: r.lastTradeTimestampDateTime || null, delayed: true, source: SRC.nasdaq
  };
}

// Batch Nasdaq quotes (20 per request). Unknown symbols retried once as the other asset class.
export async function nasdaqQuotes(symbols, cls = {}) {
  const out = new Map();
  const run = async (list, clsOf) => {
    const batches = [];
    for (let i = 0; i < list.length; i += 20) batches.push(list.slice(i, i + 20));
    await Promise.all(batches.map(async b => {
      const qs = b.map(s => `symbol=${encodeURIComponent(nqSym(s) + '|' + clsOf(s))}`).join('&');
      try {
        const data = await nasdaq('quote/watchlist?' + qs, null, 30);
        for (const r of data || []) if (r?.symbol) out.set(r.symbol.toUpperCase(), fromWatchlist(r));
      } catch { /* batch failed: symbols stay missing */ }
    }));
  };
  const uniq = [...new Set(symbols)];
  await run(uniq, s => cls[s] || nqClass(s));
  const missing = uniq.filter(s => !out.has(s) && !cls[s]);
  if (missing.length) await run(missing, s => (nqClass(s) === 'etf' ? 'stocks' : 'etf'));
  // Watchlist batches omit some valid listings. The info endpoint preserves their
  // availability; secondaryData is the regular close when primaryData is extended.
  const unresolved=uniq.filter(s=>!out.has(s));
  for(let i=0;i<unresolved.length;i+=4)await Promise.all(unresolved.slice(i,i+4).map(async symbol=>{
    try{
      const d=await nasdaq('quote/'+encodeURIComponent(nqSym(symbol))+'/info',{assetclass:cls[symbol]||nqClass(symbol)},30);
      const parse=v=>v==null||String(v).trim()===''?null:num(v);
      const primary=d?.primaryData,secondary=d?.secondaryData,regular=secondary?.lastSalePrice?secondary:primary;
      const price=parse(regular?.lastSalePrice);if(price===null)return;
      const change=parse(regular.netChange),changePercent=parse(regular.percentageChange);
      const ext=secondary?.lastSalePrice&&primary?.lastSalePrice?{session:/pre/i.test(d.marketStatus||'')?'pre':'post',price:parse(primary.lastSalePrice),change:parse(primary.netChange),changePercent:parse(primary.percentageChange)}:null;
      out.set(symbol,{symbol,name:cleanName(d.companyName),price,change,changePercent,prevClose:change===null?null:round(price-change),volume:parse(primary?.volume),ext,assetClass:cls[symbol]||nqClass(symbol),marketStatus:d.marketStatus||null,asOf:regular.lastTradeTimestamp||null,delayed:true,source:SRC.nasdaq});
    }catch{/* unavailable listings remain missing */}
  }));
  return out;
}

async function cboeQuote(id, scale = 1) {
  const b = await getJSON(`https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/${id}.json`, { ttl: 60 });
  const d = b?.data;
  const price = num(d?.current_price);
  const scaled = value => { const n = num(value); return n === null ? null : round(n * scale, 2); };
  if (price === null) throw new UpstreamError('provider_unavailable');
  return { price: round(price * scale, 2), change: scaled(d.price_change), changePercent: round(num(d.price_change_percent), 4), prevClose: scaled(d.prev_day_close),
    high: scaled(d.high), low: scaled(d.low), asOf: d.last_trade_time || b.timestamp || null, delayed: true, source: SRC.cboe };
}

export async function coinbaseStats() {
  const all = await getJSON('https://api.exchange.coinbase.com/products/stats', { ttl: 30, headers: { 'User-Agent': 'WatchlistPulse' } });
  if (!all || typeof all !== 'object') throw new UpstreamError('provider_unavailable');
  return all;
}
function coinQuote(stats, symbol) {
  const s = stats?.[symbol]?.stats_24hour;
  const last = num(s?.last), open = num(s?.open);
  if (last === null) return null;
  const change = open !== null ? last - open : null;
  return { symbol, name: COIN[symbol]?.name || symbol.replace('-USD', ''), price: last, change: round(change, 8), changePercent: pctOf(change, open),
    high: num(s.high), low: num(s.low), volume: num(s.volume), dollarVolume: num(s.volume) !== null ? round(num(s.volume) * last, 0) : null,
    prevClose: open, delayed: false, source: SRC.coinbase, note: '24h change vs Coinbase 24h open' };
}
async function coinGeckoCaps(symbols) {
  const ids = symbols.map(s => COIN[s]?.cg).filter(Boolean);
  if (!ids.length) return new Map();
  try {
    const rows = await getJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=100&ids=${ids.join(',')}`, { ttl: 600 });
    const bySym = new Map();
    for (const r of rows || []) { const c = COINS.find(x => x.cg === r.id); if (c) bySym.set(c.symbol, { marketCap: num(r.market_cap), rank: num(r.market_cap_rank) }); }
    return bySym;
  } catch { return new Map(); } // market caps are optional; panels fall back to volume sizing
}

const parseCsvLine = l => l.split(',').map(s => s.replace(/^"|"$/g, '').trim());
export async function treasuryYields(now = Date.now()) {
  const y = new Date(now).getUTCFullYear();
  const url = yr => `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${yr}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${yr}&page&_format=csv`;
  const parse = txt => { const lines = String(txt).trim().split(/\r?\n/); const head = parseCsvLine(lines[0] || ''); return lines.slice(1).map(l => { const c = parseCsvLine(l); return Object.fromEntries(head.map((h, i) => [h, c[i]])); }); };
  let rows = parse(await getText(url(y), 3600));
  if (rows.length < 2) rows = rows.concat(parse(await getText(url(y - 1), 6 * 3600)));
  if (!rows.length || !rows[0].Date) throw new UpstreamError('provider_unavailable');
  return { latest: rows[0], prior: rows[1] || null };
}
function ustQuote(t, col) {
  const v = num(t.latest[col]), p = num(t.prior?.[col]);
  if (v === null) return null;
  const change = p !== null ? round(v - p, 4) : null;
  const [m, d, yr] = String(t.latest.Date).split('/');
  return { price: v, change, changePercent: pctOf(change, p), prevClose: p, unit: '%', asOf: yr ? `${yr}-${m}-${d}` : t.latest.Date, delayed: true, source: SRC.treasury };
}

const FX_CCY = ['EUR', 'GBP', 'JPY', 'CNY', 'CAD', 'CHF', 'AUD', 'MXN', 'INR'];
export async function ecbRates(now = Date.now()) {
  const start = isoDate(now - 12 * day);
  const b = await getJSON(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${FX_CCY.join(',')}`, { ttl: 1800 });
  const dates = Object.keys(b?.rates || {}).sort();
  if (!dates.length) throw new UpstreamError('provider_unavailable');
  return { date: dates.at(-1), latest: b.rates[dates.at(-1)], prior: dates.length > 1 ? b.rates[dates.at(-2)] : null };
}
function fxQuote(r, spec) {
  const conv = v => (Number.isFinite(v) && v ? (spec.invert ? 1 / v : v) : null);
  const v = conv(r.latest[spec.ccy]), p = r.prior ? conv(r.prior[spec.ccy]) : null;
  if (v === null) return null;
  const change = p !== null ? v - p : null;
  return { price: round(v, 5), change: round(change, 5), changePercent: pctOf(change, p), prevClose: round(p, 5), asOf: r.date, delayed: true, source: SRC.ecb };
}

// Resolve any mix of symbols (instruments, crypto, FX, rates, stocks/ETFs) to normalized quotes.
export async function resolveQuotes(symbols) {
  const want = [...new Set(symbols)];
  const kindOf = s => INST[s]?.kind || (/-USD$/.test(s) ? 'cb' : 'nq');
  const groups = {};
  for (const s of want) (groups[kindOf(s)] ||= []).push(s);
  const out = new Map();
  const tasks = [];
  if (groups.nq) tasks.push(nasdaqQuotes(groups.nq).then(m => { for (const [k, v] of m) out.set(k, v); }));
  if (groups.nqi) tasks.push(nasdaqQuotes(groups.nqi.map(s => INST[s].id), Object.fromEntries(groups.nqi.map(s => [INST[s].id, 'index'])))
    .then(m => { for (const s of groups.nqi) { const q = m.get(INST[s].id); if (q) out.set(s, { ...q, symbol: s }); } }));
  if (groups.cboe) tasks.push(...groups.cboe.map(s => cboeQuote(INST[s].id, INST[s].scale).then(q => out.set(s, { symbol: s, ...q }), () => {})));
  if (groups.cb) tasks.push(coinbaseStats().then(st => { for (const s of groups.cb) { const q = coinQuote(st, s); if (q) out.set(s, q); } }, () => {}));
  if (groups.ust) tasks.push(treasuryYields().then(t => { for (const s of groups.ust) { const q = ustQuote(t, INST[s].col); if (q) out.set(s, { symbol: s, ...q }); } }, () => {}));
  if (groups.fx) tasks.push(ecbRates().then(r => { for (const s of groups.fx) { const q = fxQuote(r, INST[s]); if (q) out.set(s, { symbol: s, ...q }); } }, () => {}));
  await Promise.all(tasks);
  for (const [s, q] of out) {
    const spec = INST[s];
    if (spec) out.set(s, { ...q, label: spec.label, name: spec.label, ...(spec.proxy ? { proxy: s } : {}), ...(spec.note ? { note: spec.note } : {}) });
  }
  return out;
}

const pick = (map, list) => list.map(s => map.get(s)).filter(Boolean);
const tapeRow = q => ({ symbol: q.symbol, label: q.label || q.symbol, price: q.price, change: q.change, changePercent: q.changePercent, delayed: !!q.delayed, source: q.source, asOf: q.asOf || null, ...(q.proxy ? { proxy: q.proxy } : {}), ...(q.unit ? { unit: q.unit } : {}), ...(q.note ? { note: q.note } : {}) });

// ---------- Large-cap universe (top US-listed companies by market cap) ----------
async function screenerRows(params, ttl = 3600) {
  const data = await nasdaq('screener/stocks', { tableonly: 'true', download: 'true', ...params }, ttl);
  const rows = data?.rows || data?.table?.rows || [];
  return rows.map(r => ({ symbol: String(r.symbol || '').trim().replace('/', '.').toUpperCase(), name: cleanName(r.name), marketCap: num(r.marketCap),
    sector: r.sector || '', industry: r.industry || '', country: r.country || '', ipoYear: num(r.ipoyear), lastClose: num(r.lastsale), volume: num(r.volume) }))
    .filter(r => r.symbol && /^[A-Z0-9.]{1,7}$/.test(r.symbol));
}
async function largeCaps(n = 200) {
  const rows = await screenerRows({ marketcap: 'mega|large' });
  return rows.filter(r => r.country === 'United States' && r.marketCap).sort((a, b) => b.marketCap - a.marketCap).slice(0, n);
}
async function liveUniverse(n) {
  const base = await largeCaps(n);
  if (!base.length) throw new UpstreamError('provider_unavailable');
  const q = await nasdaqQuotes(base.map(r => r.symbol), Object.fromEntries(base.map(r => [r.symbol, 'stocks'])));
  return base.map(r => { const l = q.get(r.symbol); return l ? { ...l, name: r.name || l.name, marketCap: r.marketCap, sector: r.sector, industry: r.industry } : null; }).filter(Boolean);
}

// ---------- Nasdaq per-symbol extras (summary, history, intraday chart) ----------
async function summary(sym, cls) {
  try {
    const d = await nasdaq(`quote/${encodeURIComponent(sym)}/summary`, { assetclass: cls }, 6 * 3600);
    const s = d?.summaryData || {};
    const [hi, lo] = String(s.FiftTwoWeekHighLow?.value || '').split('/').map(num);
    return { marketCap: num(s.MarketCap?.value), avgVolume: num(s.AverageVolume?.value), high52: hi ?? null, low52: lo ?? null, sector: s.Sector?.value || null, industry: s.Industry?.value || null };
  } catch { return null; }
}
async function history(sym, cls, now = Date.now()) {
  const d = await nasdaq(`quote/${encodeURIComponent(sym)}/historical`, { assetclass: cls, fromdate: isoDate(now - 380 * day), todate: isoDate(now), limit: 400 }, 3600);
  return (d?.tradesTable?.rows || []).map(r => { const [m, dd, y] = String(r.date).split('/'); return { date: `${y}-${m}-${dd}`, close: num(r.close) }; })
    .filter(r => r.close !== null).sort((a, b) => (a.date < b.date ? -1 : 1));
}
export const PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
export function periodStart(period, now = Date.now()) {
  const d = new Date(now);
  if (period === '1W') return isoDate(now - 7 * day);
  if (period === '1M') { d.setUTCMonth(d.getUTCMonth() - 1); return isoDate(d); }
  if (period === '3M') { d.setUTCMonth(d.getUTCMonth() - 3); return isoDate(d); }
  if (period === 'YTD') return `${d.getUTCFullYear() - 1}-12-31`;
  if (period === '1Y') { d.setUTCFullYear(d.getUTCFullYear() - 1); return isoDate(d); }
  return null;
}
// Close on or before `date` (rows ascending); null if history doesn't reach back that far.
export function closeOnOrBefore(rows, date) { let c = null; for (const r of rows) { if (r.date <= date) c = r.close; else break; } return c; }
export function periodReturns(rows, price, now = Date.now()) {
  const out = {};
  for (const p of PERIODS.slice(1)) { const base = closeOnOrBefore(rows, periodStart(p, now)); out[p] = base && Number.isFinite(price) ? round((price / base - 1) * 100, 4) : null; }
  return out;
}
async function coinPeriodChange(symbol, period, price, now = Date.now()) {
  const target = Date.parse(periodStart(period, now) + 'T23:59:59Z');
  const c = await getJSON(`https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=86400&start=${isoDate(target - 6 * day)}&end=${isoDate(target + day)}`, { ttl: 3600, headers: { 'User-Agent': 'WatchlistPulse' } });
  const rows = (Array.isArray(c) ? c : []).filter(r => r[0] * 1000 <= target).sort((a, b) => b[0] - a[0]);
  const base = rows[0]?.[4];
  return base && Number.isFinite(price) ? round((price / base - 1) * 100, 4) : null;
}

// ---------- Route handlers ----------
async function tape(url) {
  const region = (url.searchParams.get('region') || 'us').toLowerCase();
  const list = TAPES[region];
  if (!list) throw new UpstreamError('invalid_region', 400);
  const q = await resolveQuotes(list);
  const items = pick(q, list).map(tapeRow);
  if (!items.length) throw new UpstreamError('provider_unavailable');
  return json(items, 200, 30);
}

const WARRANTISH = /^[A-Z]{4}[WRU]$|^[A-Z]{3,4}(WS|W)$/;
async function stockMovers(type, scope) {
  if (type === 'most-active') {
    let d;
    try { d = await nasdaq('marketmovers', { assetclass: 'stocks', exchangestatus: 'currentMarket', limit: 25 }, 30); }
    catch { /* Fall back to an explicitly scoped sample below, never a full-market ranking. */ }
    const t = d?.STOCKS?.MostActiveByDollarVolume;
    const rows = (t?.table?.rows || []).map(r => ({ symbol: r.symbol, name: cleanName(r.name), price: num(r.lastSalePrice), change: num(r.lastSaleChange), changePercent: num(r.change) }));
    if (!rows.length) {
      const sample = (await liveUniverse(200)).filter(r => Number.isFinite(r.volume)).sort((a, b) => b.volume - a.volume).slice(0, 25);
      return { rows: sample, asOf: null, coverage: 'large-cap-sample', notice: 'High-volume large-cap sample', definition: 'The full-market most-active feed is unavailable. Showing the highest share volume among up to 200 largest US companies by market cap; this is a scoped sample, not a full-market dollar-volume ranking.' };
    }
    const vol = await nasdaqQuotes(rows.map(r => r.symbol));
    return { rows: rows.map(r => ({ ...r, volume: vol.get(r.symbol)?.volume ?? null })), asOf: t?.dataAsOf || null, definition: 'Most active US stocks and ETFs by dollar volume today (Nasdaq).' };
  }
  if (type === 'trending') {
    const d = await nasdaq('marketmovers', { assetclass: 'stocks', exchangestatus: 'currentMarket', limit: 25 }, 30);
    const cand = [...(d?.STOCKS?.MostActiveByDollarVolume?.table?.rows || []), ...(d?.STOCKS?.MostActiveByShareVolume?.table?.rows || [])]
      .filter(r => num(r.lastSalePrice) >= 2 && !WARRANTISH.test(r.symbol)).map(r => r.symbol);
    const syms = [...new Set(cand)].slice(0, 25);
    const q = await nasdaqQuotes(syms);
    const sums = await Promise.all(syms.map(s => summary(s, q.get(s)?.assetClass === 'etf' ? 'etf' : 'stocks')));
    const rows = syms.map((s, i) => { const l = q.get(s); const avg = sums[i]?.avgVolume; return l ? { ...l, avgVolume: avg ?? null, relVolume: avg && l.volume ? round(l.volume / avg, 2) : null } : null; })
      .filter(r => r && r.relVolume !== null).sort((a, b) => b.relVolume - a.relVolume).slice(0, 15);
    return { rows, asOf: d?.STOCKS?.MostActiveByShareVolume?.dataAsOf || null, definition: "Trending: today's most active names (price ≥ $2) ranked by volume relative to their average daily volume (Nasdaq)." };
  }
  // gainers / losers
  if (scope === 'all') {
    const d = await nasdaq('marketmovers', { assetclass: 'stocks', exchangestatus: 'currentMarket', limit: 25 }, 30);
    const t = d?.STOCKS?.[type === 'gainers' ? 'MostAdvanced' : 'MostDeclined'];
    return { rows: (t?.table?.rows || []).map(r => ({ symbol: r.symbol, name: cleanName(r.name), price: num(r.lastSalePrice), change: num(r.lastSaleChange), changePercent: num(r.change) })),
      asOf: t?.dataAsOf || null, definition: `All US listings with the largest % ${type === 'gainers' ? 'gains' : 'declines'} today, including micro-caps (Nasdaq).` };
  }
  const uni = await liveUniverse(200);
  const rows = uni.filter(r => Number.isFinite(r.changePercent)).sort((a, b) => (type === 'gainers' ? b.changePercent - a.changePercent : a.changePercent - b.changePercent)).slice(0, 25);
  return { rows, asOf: rows[0]?.asOf || null, definition: `Largest % ${type === 'gainers' ? 'gains' : 'declines'} among the 200 largest US companies by market cap (Nasdaq).` };
}

async function cryptoMovers(type) {
  const stats = await coinbaseStats();
  const caps = await coinGeckoCaps(COINS.map(c => c.symbol));
  let rows = COINS.map(c => { const q = coinQuote(stats, c.symbol); return q ? { ...q, marketCap: caps.get(c.symbol)?.marketCap ?? null } : null; }).filter(Boolean);
  let definition = caps.size ? 'Major cryptocurrencies by market cap (CoinGecko) with Coinbase USD prices; change over 24h.' : 'Major cryptocurrencies (approximate market-cap order) with Coinbase USD prices; change over 24h.';
  if (type === 'crypto-all' && caps.size) rows.sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
  if (type === 'crypto-most-active') { rows.sort((a, b) => (b.dollarVolume ?? 0) - (a.dollarVolume ?? 0)); definition = 'Major cryptocurrencies ranked by 24h USD volume on Coinbase.'; }
  if (type === 'crypto-gainers') { rows = rows.filter(r => r.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent); definition = 'Major cryptocurrencies with the largest 24h % gains (Coinbase).'; }
  if (type === 'crypto-losers') { rows = rows.filter(r => r.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent); definition = 'Major cryptocurrencies with the largest 24h % declines (Coinbase).'; }
  // The bulk stats endpoint supplies prices but no exchange trade timestamp.
  return { rows, asOf: null, checkedAt: new Date().toISOString(), definition, ...(caps.size ? { capsSource: SRC.coingecko } : {}) };
}

const MOVER_TYPES = ['indexes', 'most-active', 'trending', 'gainers', 'losers', 'crypto-all', 'crypto-most-active', 'crypto-gainers', 'crypto-losers'];
async function movers(url) {
  const type = url.searchParams.get('type') || 'most-active';
  if (!MOVER_TYPES.includes(type)) throw new UpstreamError('invalid_type', 400);
  if (type === 'indexes') {
    const q = await resolveQuotes(INDEX_MOVERS);
    const rows = pick(q, INDEX_MOVERS).map(r => ({ ...tapeRow(r), name: r.label }));
    if (!rows.length) throw new UpstreamError('provider_unavailable');
    return json({ type, rows, definition: 'Major US indexes (Cboe/Nasdaq), commodity and country ETF proxies, Treasury yields, ECB FX and crypto.', source: 'Cboe · Nasdaq · U.S. Treasury · ECB · Coinbase', delayed: true }, 200, 30);
  }
  const res = type.startsWith('crypto') ? await cryptoMovers(type) : await stockMovers(type, url.searchParams.get('scope'));
  if (!res.rows.length && !/gainers|losers/.test(type)) throw new UpstreamError('provider_unavailable');
  const crypto = type.startsWith('crypto');
  return json({ type, ...res, source: crypto ? SRC.coinbase : SRC.nasdaq, delayed: !crypto }, 200, 30);
}

async function sectors() {
  const syms = SECTORS.map(s => s[0]);
  const q = await nasdaqQuotes(syms, Object.fromEntries(syms.map(s => [s, 'etf'])));
  const hist = await Promise.all(syms.map(s => history(s, 'etf').catch(() => [])));
  const rows = SECTORS.map(([sym, name], i) => {
    const l = q.get(sym);
    if (!l) return null;
    return { symbol: sym, name, price: l.price, change: l.change, changePercent: l.changePercent, perf: { '1D': l.changePercent, ...periodReturns(hist[i], l.price) } };
  }).filter(Boolean);
  if (!rows.length) throw new UpstreamError('provider_unavailable');
  return json({ rows, periods: PERIODS, source: SRC.nasdaq, delayed: true, definition: 'SPDR Select Sector ETFs as sector proxies; returns use the latest price vs the close on or before each period start.', asOf: q.get('XLK')?.asOf || null }, 200, 60);
}

// Live theme rows: quotes + market cap / 52-week range / average volume.
async function themeRows(theme) {
  const syms = theme.constituents.map(c => c.symbol);
  if (theme.kind === 'crypto') {
    const stats = await coinbaseStats();
    const caps = await coinGeckoCaps(syms);
    return theme.constituents.map(c => { const q = coinQuote(stats, c.symbol); return q ? { ...q, ...c, marketCap: caps.get(c.symbol)?.marketCap ?? null } : { ...c, missing: true }; });
  }
  const q = await nasdaqQuotes(syms);
  const sums = await Promise.all(syms.map(s => (q.get(s) ? summary(s, q.get(s).assetClass === 'etf' ? 'etf' : 'stocks') : null)));
  return theme.constituents.map((c, i) => {
    const l = q.get(c.symbol);
    if (!l) return { ...c, missing: true };
    const s = sums[i] || {};
    return { ...l, ...c, marketCap: s.marketCap ?? null, avgVolume: s.avgVolume ?? null, high52: s.high52 ?? null, low52: s.low52 ?? null, sector: s.sector || null };
  });
}
export function aggregate(rows) {
  const live = rows.filter(r => !r.missing && Number.isFinite(r.changePercent));
  const capped = live.filter(r => r.marketCap);
  const capTotal = capped.reduce((a, r) => a + r.marketCap, 0);
  return {
    count: rows.length, quoted: live.length,
    advancers: live.filter(r => r.changePercent > 0).length, decliners: live.filter(r => r.changePercent < 0).length, unchanged: live.filter(r => r.changePercent === 0).length,
    equalWeightChangePercent: live.length ? round(live.reduce((a, r) => a + r.changePercent, 0) / live.length, 4) : null,
    capWeightedChangePercent: capTotal ? round(capped.reduce((a, r) => a + r.changePercent * r.marketCap, 0) / capTotal, 4) : null,
    totalMarketCap: capTotal || null,
    best: live.length ? live.reduce((a, r) => (r.changePercent > a.changePercent ? r : a)).symbol : null,
    worst: live.length ? live.reduce((a, r) => (r.changePercent < a.changePercent ? r : a)).symbol : null
  };
}
async function theme(url) {
  const id = url.searchParams.get('id');
  if (!id) return json({ themes: Object.entries(THEMES).map(([tid, t]) => ({ id: tid, name: t.name, description: t.description, group:t.group, kind: t.kind, count: t.constituents.length })) }, 200, 3600);
  const t = THEMES[id];
  if (!t) throw new UpstreamError('unknown_theme', 404);
  const rows = await themeRows(t);
  if (!rows.some(r => !r.missing)) throw new UpstreamError('provider_unavailable');
  return json({ id, name: t.name, description: t.description, group:t.group, kind: t.kind, constituents: rows, aggregate: aggregate(rows),
    source: t.kind === 'crypto' ? `${SRC.coinbase} · market cap ${SRC.coingecko}` : SRC.nasdaq, delayed: t.kind !== 'crypto',
    note: t.note || 'Constituent list is editorial (Ultimater), not an index.' }, 200, 30);
}

async function heatmap(url) {
  const universe = url.searchParams.get('universe') || 'sp500-top';
  const period = (url.searchParams.get('period') || '1D').toUpperCase();
  if (!PERIODS.includes(period)) throw new UpstreamError('invalid_period', 400);
  if (universe === 'sp500-top') {
    if (period !== '1D') throw new UpstreamError('period_unavailable_for_universe', 400);
    const rows = await liveUniverse(100);
    return json({ universe, title: 'US Large Caps', period, periods: ['1D'], sizes: ['marketCap', 'volume'], tiles: rows.map(r => ({ symbol: r.symbol, name: r.name, sector: r.sector || 'Other', marketCap: r.marketCap, volume: r.volume, price: r.price, change: r.change, changePercent: r.changePercent })),
      source: SRC.nasdaq, delayed: true, definition: '100 largest US-domiciled companies by market cap (Nasdaq screener), a proxy for S&P 500 leaders; market cap as of the last close.' }, 200, 30);
  }
  const m = /^theme:([a-z0-9-]+)$/.exec(universe);
  const t = m && THEMES[m[1]];
  if (!t) throw new UpstreamError('unknown_universe', 400);
  const rows = (await themeRows(t)).filter(r => !r.missing);
  if (!rows.length) throw new UpstreamError('provider_unavailable');
  let perf = rows.map(r => r.changePercent);
  if (period !== '1D') {
    perf = await Promise.all(rows.map(r => (t.kind === 'crypto' ? coinPeriodChange(r.symbol, period, r.price) : history(r.symbol, r.assetClass === 'etf' ? 'etf' : 'stocks').then(h => periodReturns(h, r.price)[period])).catch(() => null)));
  }
  return json({ universe, title: t.name, period, periods: PERIODS, sizes: t.kind === 'crypto' ? ['marketCap', 'volume'] : ['marketCap', 'volume', 'avgVolume'],
    tiles: rows.map((r, i) => ({ symbol: r.symbol, name: r.name, sector: r.sector || t.name, marketCap: r.marketCap ?? null, volume: t.kind === 'crypto' ? r.dollarVolume : r.volume, avgVolume: r.avgVolume ?? null, price: r.price, change: period === '1D' ? r.change : null, changePercent: perf[i] })),
    source: t.kind === 'crypto' ? `${SRC.coinbase} · market cap ${SRC.coingecko}` : SRC.nasdaq, delayed: t.kind !== 'crypto' }, 200, 30);
}

// Batch quotes for watchlists/screens. Accepts stocks/ETFs, ^indexes from the instrument list, XXX-USD crypto, FX pairs, US10Y etc.
const QSYM = /^\^?[A-Z0-9]{1,7}(?:[.-][A-Z0-9]{1,4})?$/;
async function quotes(url) {
  const raw = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!raw.length) throw new UpstreamError('missing_symbols', 400);
  if (raw.length > MAX_QUOTES) throw new UpstreamError('too_many_symbols', 400);
  if (raw.some(s => !QSYM.test(s))) throw new UpstreamError('invalid_symbol', 400);
  const q = await resolveQuotes(raw);
  const list = raw.map(s => q.get(s)).filter(Boolean);
  if (!list.length) throw new UpstreamError('provider_unavailable');
  return json({ quotes: list, missing: raw.filter(s => !q.has(s)) }, 200, 15);
}

export const SCREENS = {
  'large-gainers': { name: 'Large-cap gainers', description: 'Biggest % gainers among the 200 largest US companies.' },
  'large-losers': { name: 'Large-cap losers', description: 'Biggest % decliners among the 200 largest US companies.' },
  'high-volume': { name: 'High volume', description: 'Highest share volume today among the 200 largest US companies.' },
  'mega-caps': { name: 'Mega caps', description: 'US-listed companies worth $200B or more.' },
  'near-52w-high': { name: 'Near 52-week high', description: 'The 40 largest US companies ranked by distance from their 52-week high.' },
  'near-52w-low': { name: 'Near 52-week low', description: 'The 40 largest US companies ranked by distance from their 52-week low.' },
  'strong-buy': { name: 'Analyst strong buys', description: 'Largest US-listed companies with a Strong Buy analyst consensus (Nasdaq).' },
  'recent-ipos': { name: 'Recent IPOs', description: 'Largest US-listed companies that IPO\'d this year or last.' },
  ...Object.fromEntries(['technology', 'health_care', 'finance', 'consumer_discretionary', 'consumer_staples', 'industrials', 'energy', 'utilities', 'real_estate', 'basic_materials', 'telecommunications']
    .map(s => [`sector-${s.replace(/_/g, '-')}`, { name: `Largest in ${s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`, description: `Largest US-listed companies in the Nasdaq "${s.replace(/_/g, ' ')}" sector.`, sector: s }]))
};
async function liveFromSnapshot(snapshot, n = 40) {
  const base = snapshot.filter(r => r.marketCap).sort((a, b) => b.marketCap - a.marketCap).slice(0, n);
  const q = await nasdaqQuotes(base.map(r => r.symbol), Object.fromEntries(base.map(r => [r.symbol, 'stocks'])));
  return base.map(r => { const l = q.get(r.symbol); return l ? { ...l, name: r.name || l.name, marketCap: r.marketCap, sector: r.sector, industry: r.industry, ipoYear: r.ipoYear } : null; }).filter(Boolean);
}
async function screener(url) {
  const preset = url.searchParams.get('preset');
  if (!preset) return json({ presets: Object.entries(SCREENS).map(([id, s]) => ({ id, name: s.name, description: s.description })) }, 200, 3600);
  const def = SCREENS[preset];
  if (!def) throw new UpstreamError('unknown_preset', 400);
  let rows;
  if (preset === 'large-gainers' || preset === 'large-losers' || preset === 'high-volume') {
    const uni = await liveUniverse(200);
    const key = preset === 'high-volume' ? r => -(r.volume ?? 0) : preset === 'large-gainers' ? r => -(r.changePercent ?? -1e9) : r => (r.changePercent ?? 1e9);
    rows = uni.sort((a, b) => key(a) - key(b)).slice(0, 40);
  } else if (preset === 'near-52w-high' || preset === 'near-52w-low') {
    const base = await liveUniverse(40);
    const sums = await Promise.all(base.map(r => summary(r.symbol, 'stocks')));
    rows = base.map((r, i) => {
      const s = sums[i] || {};
      return { ...r, high52: s.high52 ?? null, low52: s.low52 ?? null, fromHigh: s.high52 ? round((r.price / s.high52 - 1) * 100, 2) : null, fromLow: s.low52 ? round((r.price / s.low52 - 1) * 100, 2) : null };
    }).filter(r => (preset === 'near-52w-high' ? r.fromHigh !== null : r.fromLow !== null))
      .sort((a, b) => (preset === 'near-52w-high' ? b.fromHigh - a.fromHigh : a.fromLow - b.fromLow));
  } else {
    const params = preset === 'mega-caps' ? { marketcap: 'mega' } : preset === 'strong-buy' ? { recommendation: 'strong_buy', marketcap: 'mega|large' }
      : preset === 'recent-ipos' ? {} : { sector: def.sector, marketcap: 'mega|large|mid' };
    let snap = await screenerRows(params);
    if (preset === 'recent-ipos') { const y = new Date().getUTCFullYear(); snap = snap.filter(r => r.ipoYear >= y - 1); }
    rows = await liveFromSnapshot(snap, 40);
  }
  return json({ preset, name: def.name, description: def.description, rows, source: SRC.nasdaq, delayed: true,
    note: 'Universe and market caps from the Nasdaq screener (as of the last close); prices are delayed Nasdaq quotes.' }, 200, 30);
}

// Intraday sparkline points (≤ 20 symbols). Stocks/ETFs/Nasdaq indexes via Nasdaq chart; crypto via Coinbase 15-min candles.
async function spark(url) {
  const raw = (url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!raw.length) throw new UpstreamError('missing_symbols', 400);
  if (raw.length > 20) throw new UpstreamError('too_many_symbols', 400);
  if (raw.some(s => !QSYM.test(s))) throw new UpstreamError('invalid_symbol', 400);
  const thin = (pts, n = 60) => { if (pts.length <= n) return pts; const step = (pts.length - 1) / (n - 1); return Array.from({ length: n }, (_, i) => pts[Math.round(i * step)]); };
  const series = {};
  await Promise.all(raw.map(async s => {
    try {
      if (/-USD$/.test(s)) {
        const c = await getJSON(`https://api.exchange.coinbase.com/products/${s}/candles?granularity=900`, { ttl: 30, headers: { 'User-Agent': 'WatchlistPulse' } });
        const pts = (Array.isArray(c) ? c : []).slice(0, 96).reverse().map(r => r[4]);
        if (pts.length) series[s] = { points: thin(pts), prevClose: (Array.isArray(c) && c[Math.min(95, c.length - 1)]?.[3]) || null };
        return;
      }
      const spec = INST[s];
      if (spec && spec.kind !== 'nq' && spec.kind !== 'nqi') return; // no free intraday series for Cboe/Treasury/ECB instruments
      const sym = spec?.kind === 'nqi' ? spec.id : s;
      const cls = spec?.kind === 'nqi' ? 'index' : nqClass(s);
      const d = await nasdaq(`quote/${encodeURIComponent(sym)}/chart`, { assetclass: cls }, 30);
      const pts = (d?.chart || []).map(p => num(p.y)).filter(v => v !== null);
      if (pts.length) series[s] = { points: thin(pts), prevClose: num(d.previousClose) };
    } catch { /* leave missing */ }
  }));
  return json({ series, source: 'Nasdaq · Coinbase' }, 200, 30);
}

async function summaryRoute() {
  const all = SUMMARY_GROUPS.flatMap(g => g[1]);
  const q = await resolveQuotes(all);
  const groups = SUMMARY_GROUPS.map(([name, list]) => ({ name, items: pick(q, list).map(tapeRow) })).filter(g => g.items.length);
  if (!groups.length) throw new UpstreamError('provider_unavailable');
  return json({ groups, notes: [TAPE_NOTES.commodities, 'World markets via US-listed country ETFs.', TAPE_NOTES.rates, TAPE_NOTES.fx] }, 200, 30);
}

const ROUTES = { tape, movers, sectors, heatmap, theme, quotes, screener, spark, summary: summaryRoute };
export async function handle(request, env, ctx, url, rest) {
  const route = ROUTES[rest.replace(/\/+$/, '')];
  if (!route) return json({ error: 'Unknown markets route.' }, 404);
  return route(url);
}
export { TAPES, TAPE_NOTES, INST, SECTORS };

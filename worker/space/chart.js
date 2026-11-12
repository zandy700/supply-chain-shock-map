// Owned by the chart builder. See docs/space-contract.md.
// GET /api/space/chart/history?symbol=&range=&interval=  -> OHLCV bars (Nasdaq for US equities/ETFs/Nasdaq
//     indexes, Coinbase Exchange for <BASE>-USD crypto). Delayed data; nothing is synthesized.
// GET /api/space/chart/metrics?symbol=                   -> quarterly fundamental series (Finnhub stock/metric).
import { handle as companyHandle } from './company.js';
import { json, UpstreamError, symbolParam, getJSON, nasdaq, finnhub, num } from './upstream.js';

export const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX'];
export const INTERVALS = ['1m', '2m', '5m', '15m', '30m', '1h', '4h', '1d', '1wk', '1mo'];
const MINUTES = { '1m': 1, '2m': 2, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '4h': 240 };
const DAY = 86400000;
const RANGE_DAYS = { '1D': 1, '5D': 5, '1M': 31, '3M': 92, '6M': 183, '1Y': 366, '2Y': 731, '5Y': 1827, '10Y': 3653 };

// Nasdaq serves only its own indexes. Verified 2026-11-11: COMP and NDX work; SPX, INDU, RUT, VIX return
// "Symbol not exists." -- those get a clear 404 with an ETF suggestion instead of invented data.
const INDEX_MAP = { '^IXIC': 'COMP', '^NDX': 'NDX', '^COMP': 'COMP', '^NBI': 'NBI', '^XQC': 'XQC' };
const NO_INDEX = {
  '^GSPC': { name: 'S&P 500', proxy: 'SPY' }, '^SPX': { name: 'S&P 500', proxy: 'SPY' },
  '^DJI': { name: 'Dow Jones Industrial Average', proxy: 'DIA' }, '^RUT': { name: 'Russell 2000', proxy: 'IWM' },
  '^VIX': { name: 'CBOE Volatility Index', proxy: null }, '^NYA': { name: 'NYSE Composite', proxy: null }
};
const CRYPTO = /^([A-Z0-9]{2,10})-USD$/;
const COINBASE_GRAN = { '1m': 60, '2m': 60, '5m': 300, '15m': 900, '30m': 900, '1h': 3600, '4h': 3600, '1d': 86400, '1wk': 86400, '1mo': 86400 };
const COINBASE_MAX_REQUESTS = 14; // 300 candles each; stays well under Worker subrequest limits

export function kindOf(symbol) {
  if (CRYPTO.test(symbol)) return 'crypto';
  if (symbol.startsWith('^')) return 'index';
  return 'equity';
}

// Intervals each range supports for a given kind of symbol (depends on what the source actually serves).
export function allowedIntervals(kind, range) {
  if (kind !== 'crypto') {
    if (range === '1D') return ['1m', '2m', '5m', '15m', '30m', '1h'];   // Nasdaq: today's 1-minute series only
    if (range === '5D') return ['1d'];
    if (range === '1M') return ['1d', '1wk'];
    return ['1d', '1wk', '1mo'];
  }
  if (range === 'MAX') return ['1d', '1wk', '1mo'];
  const days = range === 'YTD' ? ytdDays(new Date()) : RANGE_DAYS[range];
  return INTERVALS.filter(iv => {
    const gran = COINBASE_GRAN[iv];
    if (iv === '1wk' && days < 28) return false;
    if (iv === '1mo' && days < 92) return false;
    if (gran >= 86400 && days < 2) return false;
    return Math.ceil(days * 86400 / gran / 300) <= COINBASE_MAX_REQUESTS;
  });
}
export function defaultInterval(kind, range) {
  const crypto = kind === 'crypto';
  return ({ '1D': '5m', '5D': crypto ? '15m' : '1d', '1M': crypto ? '1h' : '1d', '5Y': '1wk', '10Y': '1wk', MAX: '1mo' })[range] || '1d';
}
const ytdDays = now => Math.max(1, Math.ceil((now - Date.UTC(now.getUTCFullYear(), 0, 1)) / DAY));
const allowedTable = kind => Object.fromEntries(RANGES.map(r => [r, allowedIntervals(kind, r)]));

// --- time helpers ---------------------------------------------------------------------------------
// Offset (ms) of America/New_York from UTC at instant ms, e.g. -5h in winter.
export function nyOffset(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms));
  const g = t => +parts.find(p => p.type === t).value;
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms;
}
const ymd = ms => new Date(ms).toISOString().slice(0, 10);
// Today's date in New York as a UTC-midnight timestamp.
const nyToday = now => { const wall = now + nyOffset(now); return wall - (wall % DAY); };
function rangeStart(range, todayMs) {
  if (range === 'MAX') return Date.UTC(1970, 0, 1);
  if (range === 'YTD') return Date.UTC(new Date(todayMs).getUTCFullYear(), 0, 1);
  if (range === '5D') return todayMs - 12 * DAY;               // trimmed to the last 5 sessions
  const d = new Date(todayMs), months = { '1M': 1, '3M': 3, '6M': 6 }[range], years = { '1Y': 1, '2Y': 2, '5Y': 5, '10Y': 10 }[range];
  if (months) d.setUTCMonth(d.getUTCMonth() - months);
  if (years) d.setUTCFullYear(d.getUTCFullYear() - years);
  return +d;
}
function parseUSDate(s) { // "11/10/2026" or "1/2/1990"
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || '').trim());
  return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : null;
}

// --- aggregation ----------------------------------------------------------------------------------
// Merge bars into buckets given by keyFn(bar). o/h/l may be null (some Nasdaq rows only carry a close).
export function aggregate(bars, keyFn) {
  const out = [];
  let cur = null, key = null;
  for (const b of bars) {
    const k = keyFn(b);
    if (!cur || k !== key) {
      if (cur) out.push(cur);
      key = k;
      cur = { t: b.t, o: b.o ?? b.c, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v };
      if (b.ext) cur.ext = true;
      if (b.partial) cur.partial = true;
      continue;
    }
    cur.h = Math.max(cur.h, b.h ?? b.c);
    cur.l = Math.min(cur.l, b.l ?? b.c);
    cur.c = b.c;
    if (b.v != null) cur.v = (cur.v ?? 0) + b.v;
    if (!b.ext) delete cur.ext;
    if (b.partial) cur.partial = true;
  }
  if (cur) out.push(cur);
  return out;
}
export const weekKey = b => { const d = new Date(b.t).getUTCDay(); return b.t - (b.t % DAY) - ((d + 6) % 7) * DAY; };
export const monthKey = b => { const d = new Date(b.t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
function rollDaily(bars, interval) {
  if (interval === '1wk') return aggregate(bars, weekKey);
  if (interval === '1mo') return aggregate(bars, monthKey);
  return bars;
}

// --- Nasdaq (US equities, ETFs, Nasdaq indexes) ----------------------------------------------------
const assetClassCache = new Map();
async function nasdaqTry(sym, classes, path, params) {
  let lastErr = null;
  for (const ac of classes) {
    try {
      const data = await nasdaq(`quote/${encodeURIComponent(sym)}/${path}`, { assetclass: ac, ...params }, params.fromdate ? 300 : 30);
      const rows = path === 'historical' ? data?.tradesTable?.rows : data?.chart;
      if (Array.isArray(rows) && rows.length) { assetClassCache.set(sym, ac); return { ac, data }; }
    } catch (e) { lastErr = e; }
  }
  if (lastErr && lastErr.code !== 'provider_unavailable') throw lastErr;
  return null;
}
const classesFor = (sym, kind) => kind === 'index' ? ['index'] : assetClassCache.has(sym) ? [assetClassCache.get(sym)] : ['stocks', 'etf'];

// Nasdaq's intraday x values are New York wall-clock times encoded as UTC; convert to real instants.
export function intradayBars(points, interval) {
  const n = MINUTES[interval] || 1;
  const pts = (points || []).map(p => ({ x: +p.x, y: Number.isFinite(+p.y) ? +p.y : num(p.z?.price ?? p.z?.value), w: p.w != null ? +p.w : num(p.z?.shares) }))
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
  const raw = pts.map(p => {
    const mins = Math.floor((p.x % DAY) / 60000);
    const bucket = Math.floor((mins - 570) / n); // buckets aligned to the 9:30 ET open
    const wallStart = p.x - (p.x % DAY) + (570 + bucket * n) * 60000;
    const b = { t: wallStart - nyOffset(wallStart), o: p.y, h: p.y, l: p.y, c: p.y, v: Number.isFinite(p.w) ? Math.round(p.w) : null, _k: wallStart };
    if (mins < 570 || mins >= 960) b.ext = true;
    return b;
  });
  return aggregate(raw, b => b._k).map(({ _k, ...b }) => b);
}

function dailyFromChart(rows) {
  const zero = v => { const n = num(v); return n === 0 ? null : n; };
  return rows.map(r => {
    const z = r.z || {};
    const c = num(z.close ?? z.value ?? z.lastSalePrice);
    const t = parseUSDate(z.dateTime) ?? (Number.isFinite(+r.x) ? +r.x - (+r.x % DAY) : null);
    return { t, o: zero(z.open), h: zero(z.high), l: zero(z.low), c, v: z.volume == null ? null : num(z.volume) };
  }).filter(b => b.t != null && Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
}
function dailyFromHistorical(rows) {
  const zero = v => { const n = num(v); return n === 0 ? null : n; };
  return rows.map(r => ({ t: parseUSDate(r.date), o: zero(r.open), h: zero(r.high), l: zero(r.low), c: num(r.close), v: num(r.volume) }))
    .filter(b => b.t != null && Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
}

async function nasdaqHistory(symbol, kind, range, interval, now) {
  const sym = kind === 'index' ? (INDEX_MAP[symbol] || symbol.slice(1)) : symbol;
  const classes = classesFor(sym, kind);
  const meta = { name: null, exchange: null, previousClose: null, asOf: null, notes: [] };
  if (range === '1D') {
    const got = await nasdaqTry(sym, classes, 'chart', { charttype: 'rs' });
    if (!got) return null;
    const d = got.data;
    meta.name = d.company || null;
    meta.exchange = d.exchange || null;
    meta.previousClose = num(d.chartPrevClose ?? d.previousClose ?? d.chart?.[0]?.z?.prevCls);
    const bars = intradayBars(d.chart, interval);
    const latestSample = intradayBars(d.chart, '1m').at(-1);
    meta.asOf = latestSample ? new Date(latestSample.t).toISOString() : null;
    if (got.ac === 'index') meta.notes.push('Index intraday series has no volume.');
    meta.notes.push('Intraday bars are built from Nasdaq one-minute price samples; high/low are sampled, not tick-level.');
    return { ...meta, bars };
  }
  const today = nyToday(now);
  const params = { fromdate: ymd(rangeStart(range, today)), todate: ymd(today) };
  let bars, got;
  if (kind === 'index') {
    got = await nasdaqTry(sym, classes, 'historical', { ...params, limit: 99999 });
    if (!got) return null;
    bars = dailyFromHistorical(got.data.tradesTable.rows);
  } else {
    got = await nasdaqTry(sym, classes, 'chart', params);
    if (!got) return null;
    meta.name = got.data.company || null;
    bars = dailyFromChart(got.data.chart);
  }
  // Keep the historical base cached while the current regular-session candle
  // refreshes from the short-lived minute series. Never replace a completed
  // same-day official row after the regular session has ended.
  try {
    const intra = await nasdaqTry(sym, [got.ac], 'chart', { charttype: 'rs' });
    const reg = intradayBars(intra?.data?.chart || [], '1m').filter(b => !b.ext);
    if (reg.length) {
      const sample = reg.at(-1), wallNow = now + nyOffset(now);
      const dayT = (() => { const w = reg[0].t + nyOffset(reg[0].t); return w - (w % DAY); })();
      const currentDay = wallNow - (wallNow % DAY), minute = (wallNow - currentDay) / 60000;
      const last = bars.at(-1);
      const replaceCurrent = last?.t === dayT && dayT === currentDay && minute >= 570 && minute < 960;
      if (!last || dayT > last.t || replaceCurrent) {
        const vols = reg.map(b => b.v).filter(v => v != null);
        const current = { t: dayT, o: reg[0].o, h: Math.max(...reg.map(b => b.h)), l: Math.min(...reg.map(b => b.l)), c: sample.c, v: vols.length ? vols.reduce((a, b) => a + b, 0) : null, partial: true };
        if (replaceCurrent) bars[bars.length - 1] = current;
        else bars.push(current);
        meta.asOf = new Date(sample.t).toISOString();
        meta.notes.push('Latest daily bar is built from the current session\'s one-minute samples (marked partial); high/low are sampled, not tick-level.');
      }
      meta.exchange = intra.data.exchange || null;
    }
  } catch { /* the daily series stands on its own */ }
  if (range === '5D') bars = bars.slice(-5);
  if (bars.some(b => b.o == null)) meta.notes.push('Some early rows carry only a closing price.');
  return { ...meta, bars: rollDaily(bars, interval) };
}

// --- Coinbase Exchange (crypto) --------------------------------------------------------------------
async function coinbaseCandles(product, gran, startSec, endSec, current = false) {
  const url = new URL(`https://api.exchange.coinbase.com/products/${product}/candles`);
  url.searchParams.set('granularity', gran);
  url.searchParams.set('start', new Date(startSec * 1000).toISOString());
  url.searchParams.set('end', new Date(endSec * 1000).toISOString());
  const rows = await getJSON(url.href, { headers: { 'User-Agent': 'WatchlistPulse' }, ttl: current ? 300 : 600 });
  if (!Array.isArray(rows)) throw new UpstreamError('provider_unavailable');
  return rows;
}
function cryptoBucketStart(time, interval) {
  if (interval === '1wk') return weekKey({ t: time });
  if (interval === '1mo') { const d = new Date(time); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  const duration = (MINUTES[interval] || 1440) * 60000;
  return Math.floor(time / duration) * duration;
}

// A latest-trade sample can update the active candle, but cannot reconstruct
// trades between checks or historical OHLCV. Apply after aggregation so missing
// current volume cannot turn into a plausible weekly/monthly volume total.
export function applyCryptoTrade(bars, ticker, interval, now, observed = null) {
  let price = num(ticker?.price), time = Date.parse(ticker?.time);
  if (!(price > 0) || !Number.isFinite(time) || time > now + 30000) throw new UpstreamError('provider_unavailable');
  const activeStart = cryptoBucketStart(now, interval);
  if (cryptoBucketStart(time, interval) !== activeStart) return { bars, asOf: new Date(time).toISOString(), applied: false };
  const previous = observed?.t === activeStart ? observed : null;
  if (previous && Date.parse(previous.asOf) > time) { time = Date.parse(previous.asOf); price = previous.c; }
  const asOf = new Date(time).toISOString();
  const latest = bars.at(-1);
  const sameBucket = latest && cryptoBucketStart(latest.t, interval) === activeStart;
  const current = {
    ...(sameBucket ? latest : { t: activeStart }),
    o: (sameBucket ? latest.o : null) ?? previous?.o ?? price,
    c: price,
    h: Math.max((sameBucket ? latest.h : null) ?? price, previous?.h ?? price, price),
    l: Math.min((sameBucket ? latest.l : null) ?? price, previous?.l ?? price, price),
    v: null, partial: true, sampled: true
  };
  return {
    bars: sameBucket ? [...bars.slice(0, -1), current] : [...bars, current], asOf, applied: true,
    observation: { t: activeStart, o: current.o, h: current.h, l: current.l, c: current.c, asOf }
  };
}
async function loadCoinbaseBase(symbol, range, interval, now) {
  const gran = COINBASE_GRAN[interval];
  const span = 300 * gran;
  // End at the source candle boundary. In particular MAX daily chunks must not
  // all acquire new URLs each minute while only today's candle can change.
  const endSec = Math.floor(now / (gran * 1000)) * gran + gran;
  const rows = [];
  if (range === 'MAX') {
    let end = endSec;
    for (let i = 0; i < COINBASE_MAX_REQUESTS; i++) {
      const chunk = await coinbaseCandles(symbol, gran, end - span, end, i === 0);
      if (!chunk.length) break;
      rows.push(...chunk);
      end -= span;
    }
  } else {
    const startSec = range === '1D' ? endSec - 86400 : range === '5D' ? endSec - 5 * 86400 : Math.floor(rangeStart(range, now - (now % DAY)) / 1000);
    const starts = [];
    for (let s = startSec; s < endSec; s += span) starts.push(s);
    if (starts.length > COINBASE_MAX_REQUESTS) throw new UpstreamError('too_many_bars', 400);
    const chunks = await Promise.all(starts.map(s => coinbaseCandles(symbol, gran, s, Math.min(s + span, endSec), s + span >= endSec)));
    for (const c of chunks.reverse()) rows.push(...c);
  }
  const seen = new Set();
  let bars = rows.map(r => ({ t: r[0] * 1000, l: +r[1], h: +r[2], o: +r[3], c: +r[4], v: +r[5] }))
    .filter(b => Number.isFinite(b.c) && !seen.has(b.t) && seen.add(b.t)).sort((a, b) => a.t - b.t);
  const mins = MINUTES[interval];
  if (interval === '2m' || interval === '30m' || interval === '4h') bars = aggregate(bars, b => Math.floor(b.t / (mins * 60000)));
  return rollDaily(bars, interval);
}
const cryptoBaseCache = new Map(), cryptoBasePending = new Map(), cryptoTradeSamples = new Map();
async function coinbaseHistory(symbol, range, interval, now) {
  const key = `${symbol}|${range}|${interval}`;
  const tickerRequest = getJSON(`https://api.exchange.coinbase.com/products/${symbol}/ticker`, { headers: { 'User-Agent': 'WatchlistPulse' }, ttl: 15 })
    .then(value => ({ value }), () => ({ value: null }));
  let bars;
  const cached = cryptoBaseCache.get(key);
  if (cached && cached.expires > Date.now()) bars = cached.bars;
  else {
    if (!cryptoBasePending.has(key)) {
      const request = loadCoinbaseBase(symbol, range, interval, now).then(value => {
        if (cryptoBaseCache.size >= 64) cryptoBaseCache.delete(cryptoBaseCache.keys().next().value);
        cryptoBaseCache.set(key, { bars: value, expires: Date.now() + 300000 });
        return value;
      }).finally(() => cryptoBasePending.delete(key));
      cryptoBasePending.set(key, request);
    }
    bars = await cryptoBasePending.get(key);
  }
  const notes = ['Historical candle volume is in units of the base currency.'];
  let asOf = null;
  const ticker = (await tickerRequest).value;
  try {
    const sampleKey = `${symbol}|${interval}`;
    const current = applyCryptoTrade(bars, ticker, interval, now, cryptoTradeSamples.get(sampleKey));
    bars = current.bars; asOf = current.asOf;
    if (current.applied) {
      if (cryptoTradeSamples.size >= 128 && !cryptoTradeSamples.has(sampleKey)) cryptoTradeSamples.delete(cryptoTradeSamples.keys().next().value);
      cryptoTradeSamples.set(sampleKey, current.observation);
    }
    notes.push(current.applied
      ? 'Current candle is partial: its close and sampled high/low include the latest trade checked every 15s. Trades between checks may be missed; volume is unavailable. A new candle opens at the first observed sample. Historical candles refresh at most every 5 minutes.'
      : 'Latest trade is outside the current candle period; historical candles are unchanged.');
  } catch {
    notes.push('Latest-trade updates are unavailable; showing historical candles, which may be cached for 5 minutes.');
  }
  return { name: symbol.replace('-USD', '') + ' / US Dollar', exchange: 'Coinbase Exchange', previousClose: null, bars, asOf, notes };
}

// --- handlers ---------------------------------------------------------------------------------------
async function history(url, now) {
  const symbol = symbolParam(url);
  const kind = kindOf(symbol);
  if (url.searchParams.get('totalReturn') === 'true') return json({ error: 'Total-return history is unavailable: no validated dividend-reinvested, split-adjusted source is configured.', code: 'total_return_unavailable' }, 422);
  const range = (url.searchParams.get('range') || '1Y').toUpperCase() === 'ALL' ? 'MAX' : (url.searchParams.get('range') || '1Y').toUpperCase();
  if (!RANGES.includes(range)) return json({ error: `Unknown range "${range}". Use one of ${RANGES.join(', ')}.` }, 400);
  const allowed = allowedIntervals(kind, range);
  let interval = (url.searchParams.get('interval') || '').toLowerCase() || defaultInterval(kind, range);
  if (interval === '60m') interval = '1h';
  if (interval === '1w') interval = '1wk';
  if (!INTERVALS.includes(interval)) return json({ error: `Unknown interval "${interval}". Use one of ${INTERVALS.join(', ')}.`, allowed }, 400);
  if (!allowed.includes(interval)) {
    const why = kind === 'crypto' ? 'Coinbase serves at most a few thousand candles per chart at this granularity.' : 'Nasdaq serves intraday data for the current session only, and daily or longer bars otherwise.';
    return json({ error: `${interval} bars are not available for the ${range} range. ${why} Available: ${allowed.join(', ')}.`, allowed }, 400);
  }
  if (NO_INDEX[symbol]) {
    const { name, proxy } = NO_INDEX[symbol];
    return json({ error: `${name} (${symbol}) history is not available from our data sources.${proxy ? ` Try ${proxy}, an ETF that tracks it.` : ''}`, proxy }, 404);
  }
  let out;
  try {
    out = kind === 'crypto' ? await coinbaseHistory(symbol, range, interval, now) : await nasdaqHistory(symbol, kind, range, interval, now);
  } catch (e) {
    if (e.code === 'too_many_bars') return json({ error: `Too many ${interval} bars for ${range}. Choose a longer interval.`, allowed }, 400);
    throw e;
  }
  if (!out || !out.bars.length) return json({ error: `No chart data for ${symbol}. Nasdaq covers US-listed stocks, ETFs and Nasdaq indexes; crypto uses <BASE>-USD.` }, 404);
  const maxAge = kind === 'crypto' ? 15 : 30;
  const lastBarAt = new Date(out.bars.at(-1).t).toISOString();
  return json({
    symbol, name: out.name, kind, currency: 'USD', exchange: out.exchange, interval, range, delayed: true,
    source: kind === 'crypto' ? 'Coinbase Exchange' : 'Nasdaq', timezone: 'America/New_York',
    asOf: out.asOf || lastBarAt, asOfKind: out.asOf ? 'sample' : 'bar-start', lastBarAt, checkedAt: new Date(now).toISOString(),
    capabilities: { extendedHours: range === '1D' && kind !== 'crypto', totalReturn: false, corporateEvents: false, reasons: { extendedHours: kind === 'crypto' ? 'Crypto trades continuously.' : 'Only the current-session intraday endpoint identifies extended-hours bars.', totalReturn: 'Validated dividend-reinvested and split-adjusted history is unavailable from these sources.', corporateEvents: 'A validated historical dividend/split event feed is not configured.' } },
    previousClose: out.previousClose, notes: out.notes, allowed: allowedTable(kind), bars: out.bars
  }, 200, maxAge);
}

// Finnhub stock/metric series.quarterly -> chartable fundamental series. Missing keys are reported, not filled.
export const METRICS = [
  { id: 'pe', label: 'P/E ratio', keys: ['pe', 'peTTM'], unit: 'x' },
  { id: 'ps', label: 'Price / Sales', keys: ['ps', 'psTTM'], unit: 'x' },
  { id: 'pb', label: 'Price / Book', keys: ['pb'], unit: 'x' },
  { id: 'eps', label: 'EPS', keys: ['eps', 'epsTTM'], unit: '$' },
  { id: 'salesPerShare', label: 'Revenue per share', keys: ['salesPerShare'], unit: '$' },
  { id: 'fcfPerShare', label: 'Free cash flow per share', keys: ['fcfPerShareTTM'], unit: '$' },
  { id: 'bookValue', label: 'Book value', keys: ['bookValue'], unit: '$M' },
  { id: 'grossMargin', label: 'Gross margin', keys: ['grossMargin'], unit: '%' },
  { id: 'operatingMargin', label: 'Operating margin', keys: ['operatingMargin'], unit: '%' },
  { id: 'netMargin', label: 'Net margin', keys: ['netMargin'], unit: '%' },
  { id: 'roe', label: 'Return on equity', keys: ['roeTTM'], unit: '%' },
  { id: 'roa', label: 'Return on assets', keys: ['roaTTM'], unit: '%' },
  { id: 'currentRatio', label: 'Current ratio', keys: ['currentRatio'], unit: 'x' },
  { id: 'debtToEquity', label: 'Debt / Equity', keys: ['totalDebtToEquity'], unit: 'x' },
  { id: 'ev', label: 'Enterprise value', keys: ['ev'], unit: '$M' }
];
async function metrics(url, env) {
  const symbol = symbolParam(url);
  const kind = kindOf(symbol);
  const unavailable = reason => METRICS.map(m => ({ id: m.id, label: m.label, unit: m.unit, available: false, reason }));
  if (kind !== 'equity') return json({ symbol, source: 'Finnhub', series: unavailable('Fundamental metrics apply to individual stocks.') }, 200, 3600);
  let body;
  try { body = await finnhub('stock/metric', { symbol, metric: 'all' }, env, 3600); }
  catch (e) {
    const reason = e.code === 'provider_not_configured' ? 'Fundamentals provider is not configured on this server.' : e.code === 'rate_limited' ? 'Fundamentals provider rate limit reached; try again shortly.' : 'Fundamentals provider unavailable.';
    return json({ symbol, source: 'Finnhub', series: unavailable(reason) }, 200);
  }
  const period = url.searchParams.get('period') === 'annual' ? 'annual' : 'quarterly';
  const q = body?.series?.[period] || {};
  const series = METRICS.map(m => {
    const key = m.keys.find(k => Array.isArray(q[k]) && q[k].length);
    if (!key) return { id: m.id, label: m.label, unit: m.unit, available: false, reason: 'Not reported for this company.' };
    const points = q[key].map(p => ({ t: Date.parse(p.period + 'T00:00:00Z'), v: Number(p.v) }))
      .filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t);
    return { id: m.id, label: m.label, unit: m.unit, period, available: points.length > 0, points, reason: points.length ? undefined : 'Not reported for this company.' };
  });
  return json({ symbol, source: 'Finnhub', series }, 200, 3600);
}

export async function handle(request, env, ctx, url, rest, now = Date.now()) {
  if (rest === 'history') return history(url, now);
  if (rest === 'metrics') return url.searchParams.get('full') === '1' ? fullMetrics(url, env) : metrics(url, env);
  return json({ error: 'Unknown chart route. Use /api/space/chart/history or /api/space/chart/metrics.' }, 404);
}

export function resetChartForTests() { assetClassCache.clear(); cryptoBaseCache.clear(); cryptoBasePending.clear(); cryptoTradeSamples.clear(); }

// Reuse normalized company statements; never infer missing quarters or historical valuations.
export function financialSeries(body, group) {
  const rows = body.sections ? body.sections.flatMap(s => s.rows.map(r => ({ ...r, group: s.section }))) : body.rows || [];
  return rows.filter(r => !r.section && r.values).map(r => {
    const points = (body.columns || []).flatMap((c, i) => {
      if (c.id === 'ttm' || !c.end || r.values[i] == null || !Number.isFinite(r.values[i])) return [];
      const t = Date.parse(c.end + 'T00:00:00Z'); return Number.isFinite(t) ? [{ t, v: r.values[i] }] : [];
    }).sort((a,b) => a.t-b.t);
    return { id: group + '-' + (r.key || r.label.toLowerCase().replace(/[^a-z0-9]+/g,'-')), label: r.label, unit: r.unit === 'usd' ? '$' : r.unit === 'percent' ? '%' : r.unit === 'multiple' ? 'x' : r.unit || '', group: r.group || group, derived: !!r.derived, available: points.length > 0, points, period: body.period, reason: points.length ? undefined : r.noteIfEmpty || 'Historical values are not published by this provider.' };
  });
}
async function fullMetrics(url, env) {
  const base = await (await metrics(url, env)).json();
  const period = url.searchParams.get('period') === 'annual' ? 'annual' : 'quarterly';
  if (kindOf(symbolParam(url)) !== 'equity') return json({ ...base, period, notes: ['Financial statement overlays apply to individual stocks.'] },200,3600);
  const results = await Promise.allSettled(['income','cashflow','metrics'].map(async group => {
    const u = new URL(url); u.searchParams.set('period',period); u.searchParams.set('statement',group);
    const res = await companyHandle(new Request(u),env,null,u,group === 'metrics' ? 'metrics' : 'financials');
    if (!res.ok) throw new Error(group + ' history unavailable.');
    return financialSeries(await res.json(),group);
  }));
  const notes = results.flatMap((r,i) => r.status === 'rejected' ? [['income','cashflow','metrics'][i] + ' history unavailable from configured sources.'] : []);
  return json({ ...base, period, source: 'Finnhub / Nasdaq (as available)', series: [...base.series, ...results.flatMap(r=>r.status==='fulfilled'?r.value:[])], notes },200,3600);
}

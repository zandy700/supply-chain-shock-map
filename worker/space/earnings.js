// /api/space/earnings/* — earnings calendar, per-symbol earnings detail and the economic calendar.
// Owned by the news-earnings builder (docs/space-contract.md). Sources: Nasdaq public API (keyless),
// Finnhub calendar/earnings + stock/earnings when FINNHUB_API_KEY is set, worker/calendar.js for macro events.
import { json, UpstreamError, symbolParam, SYMBOL, finnhub, nasdaq } from './upstream.js';
import { calendar } from '../calendar.js';
import { earningsConnections } from '../earnings-links.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 31;
const DAY = 86400000;

// Nasdaq numbers: "$1.77", "($0.44)", "$49,364,394,000", "42.86", "N/A", "" -> number|null.
export function money(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!s || /^(n\/a|--|-|—)$/i.test(s)) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()$,%+\s-]/g, ''));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}
const TIME = { 'time-pre-market': 'BMO', 'time-after-hours': 'AMC', bmo: 'BMO', amc: 'AMC', dmh: 'DMH' };
export const timeCode = v => TIME[String(v || '').toLowerCase()] || null;

// "11/03/2025" -> "2025-11-03"
const mdy = v => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(v || '').trim()); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const validDate = s => { if (!DATE.test(s || '')) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s; };
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const nyToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

function range(url, defaultDays = 7, maxDays = MAX_DAYS) {
  const from = url.searchParams.get('from') || nyToday();
  const to = url.searchParams.get('to') || addDays(from, defaultDays - 1);
  if (!validDate(from) || !validDate(to) || to < from) throw new UpstreamError('invalid_range', 400);
  if ((Date.parse(to) - Date.parse(from)) / DAY + 1 > maxDays) throw new UpstreamError('range_too_long', 400);
  return { from, to };
}
function symbolsParam(url) {
  const raw = url.searchParams.get('symbols');
  if (!raw) return null;
  const list = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
  if (!list.length || list.length > 100 || list.some(s => !SYMBOL.test(s))) throw new UpstreamError('invalid_symbol', 400);
  return list;
}

// One Nasdaq calendar row -> our row shape. Exported for tests.
export function nasdaqRow(r, date) {
  const symbol = String(r?.symbol || '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) return null;
  return {
    symbol, company: r.name ? String(r.name) : null, date,
    time: timeCode(r.time), epsEstimate: money(r.epsForecast), epsActual: money(r.eps), surprisePct: money(r.surprise),
    revenueEstimate: null, revenueActual: null, marketCap: money(r.marketCap),
    fiscalQuarter: r.fiscalQuarterEnding ? String(r.fiscalQuarterEnding) : null, estimates: money(r.noOfEsts),
    lastYearDate: mdy(r.lastYearRptDt), lastYearEPS: money(r.lastYearEPS), sources: ['Nasdaq']
  };
}

async function nasdaqDay(date, today) {
  const ttl = date < today ? 3600 : 600;
  const data = await nasdaq('calendar/earnings', { date }, ttl);
  return (data?.rows || []).map(r => nasdaqRow(r, date)).filter(Boolean);
}

// Merge Finnhub calendar rows (revenue, hour, quarter) into Nasdaq rows by symbol+date.
export function mergeFinnhub(rows, fh) {
  const byKey = new Map(rows.map(r => [r.symbol + '|' + r.date, r]));
  for (const e of fh || []) {
    const symbol = String(e?.symbol || '').toUpperCase();
    if (!SYMBOL.test(symbol) || !validDate(e.date)) continue;
    const key = symbol + '|' + e.date;
    let row = byKey.get(key);
    if (!row) {
      row = { symbol, company: null, date: e.date, time: null, epsEstimate: null, epsActual: null, surprisePct: null, revenueEstimate: null, revenueActual: null, marketCap: null, fiscalQuarter: null, estimates: null, lastYearDate: null, lastYearEPS: null, sources: [] };
      byKey.set(key, row); rows.push(row);
    }
    row.time ??= timeCode(e.hour);
    row.epsEstimate ??= Number.isFinite(e.epsEstimate) ? e.epsEstimate : null;
    row.epsActual ??= Number.isFinite(e.epsActual) ? e.epsActual : null;
    row.revenueEstimate ??= Number.isFinite(e.revenueEstimate) ? e.revenueEstimate : null;
    row.revenueActual ??= Number.isFinite(e.revenueActual) ? e.revenueActual : null;
    if (!row.fiscalQuarter && e.quarter && e.year) row.fiscalQuarter = `Q${e.quarter} FY${e.year}`;
    if (row.surprisePct === null && Number.isFinite(row.epsActual) && Number.isFinite(row.epsEstimate) && row.epsEstimate !== 0) {
      row.surprisePct = +((row.epsActual - row.epsEstimate) / Math.abs(row.epsEstimate) * 100).toFixed(2);
    }
    if (!row.sources.includes('Finnhub')) row.sources.push('Finnhub');
  }
  return rows;
}

export async function earningsCalendar(url, env) {
  const { from, to } = range(url);
  const only = symbolsParam(url);
  const today = nyToday();
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const errors = [];
  const settled = await Promise.allSettled(dates.map(d => nasdaqDay(d, today)));
  let rows = [];
  settled.forEach((r, i) => { if (r.status === 'fulfilled') rows.push(...r.value); else errors.push({ date: dates[i], provider: 'Nasdaq', code: r.reason?.code || 'provider_unavailable' }); });
  const sources = errors.length < dates.length ? ['Nasdaq'] : [];
  if (env.FINNHUB_API_KEY) {
    try {
      const fh = await finnhub('calendar/earnings', { from, to }, env, 900);
      mergeFinnhub(rows, fh?.earningsCalendar);
      sources.push('Finnhub');
    } catch (e) { errors.push({ provider: 'Finnhub', code: e.code || 'provider_unavailable' }); }
  }
  if (!sources.length) throw new UpstreamError(errors[0]?.code || 'provider_unavailable');
  if (only) rows = rows.filter(r => only.includes(r.symbol));
  rows.sort((a, b) => a.date.localeCompare(b.date) || (b.marketCap ?? -1) - (a.marketCap ?? -1) || a.symbol.localeCompare(b.symbol));
  const days = dates.map(date => ({ date, count: rows.filter(r => r.date === date).length, unavailable: errors.some(e => e.date === date) }));
  return { from, to, days, rows, errors, sources, as_of: new Date().toISOString(), note: 'Nasdaq data via Zacks consensus; dates marked by companies or estimated. EPS is per-share; surprise is % vs consensus.' };
}

// --- Detail -----------------------------------------------------------------
const settle = p => p.then(value => ({ value }), error => ({ error: error?.code || 'provider_unavailable' }));

export function parseNextDate(reportText) {
  const m = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(reportText || '');
  if (!m) return null;
  const date = `${m[3]}-${m[1]}-${m[2]}`;
  if (!validDate(date)) return null;
  const t = /before market open/i.test(reportText) ? 'BMO' : /after market close/i.test(reportText) ? 'AMC' : null;
  const q = /fiscal Quarter ending ([A-Za-z]{3} \d{4})/i.exec(reportText)?.[1] || null;
  const est = /consensus EPS forecast for the quarter is (\(?-?\$?\d+(?:\.\d+)?\)?)/i.exec(reportText)?.[1];
  const n = /based on\s+(\d+)\s+analysts/i.exec(reportText)?.[1];
  const ly = /same quarter last year was (\(?-?\$?\d+(?:\.\d+)?\)?)/i.exec(reportText)?.[1];
  return { date, time: t, fiscalQuarter: q, epsEstimate: money(est), estimates: n ? +n : null, lastYearEPS: money(ly), estimated: /expected\*/i.test(reportText) };
}

// Nasdaq financials table -> [{period, revenue, netIncome}] in USD (Nasdaq reports in thousands).
export function financialRows(table) {
  if (!table?.headers || !Array.isArray(table.rows)) return [];
  const cols = Object.keys(table.headers).filter(k => k !== 'value1');
  const find = label => table.rows.find(r => String(r.value1).trim().toLowerCase() === label);
  const rev = find('total revenue'), ni = find('net income');
  const k = v => { const n = money(v); return n === null ? null : n * 1000; };
  return cols.map(c => ({ period: mdy(table.headers[c]) || String(table.headers[c]), revenue: k(rev?.[c]), netIncome: k(ni?.[c]) }))
    .filter(r => r.period && (r.revenue !== null || r.netIncome !== null)).reverse();
}

// Combine Nasdaq quote/eps (4 past + 4 upcoming), earnings-surprise (dates, %), Finnhub stock/earnings.
export function epsHistory(epsData, surprise, fh) {
  const rows = new Map();
  for (const e of epsData?.earningsPerShare || []) {
    const upcoming = e.type === 'UpcomingQuarter';
    rows.set(e.period, { period: e.period, estimate: money(e.consensus), actual: upcoming ? null : money(e.earnings), upcoming, reported: null, surprisePct: null, source: 'Nasdaq' });
  }
  for (const s of surprise?.earningsSurpriseTable?.rows || []) {
    const r = rows.get(s.fiscalQtrEnd) || { period: s.fiscalQtrEnd, estimate: money(s.consensusForecast), actual: money(s.eps), upcoming: false, source: 'Nasdaq' };
    r.reported = mdy(s.dateReported); r.surprisePct = money(s.percentageSurprise);
    r.actual ??= money(s.eps); r.estimate ??= money(s.consensusForecast);
    rows.set(r.period, r);
  }
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const f of Array.isArray(fh) ? fh : []) {
    if (!f?.period) continue;
    const d = new Date(f.period + 'T00:00:00Z');
    if (Number.isNaN(+d)) continue;
    const period = `${mon[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    const r = rows.get(period) || { period, estimate: null, actual: null, upcoming: false, reported: null, surprisePct: null, source: 'Finnhub' };
    r.actual ??= Number.isFinite(f.actual) ? f.actual : null;
    r.estimate ??= Number.isFinite(f.estimate) ? f.estimate : null;
    r.surprisePct ??= Number.isFinite(f.surprisePercent) ? +f.surprisePercent.toFixed(2) : null;
    rows.set(period, r);
  }
  const key = p => { const [m, y] = String(p).split(' '); return (+y || 0) * 12 + mon.indexOf(m); };
  return [...rows.values()].map(r => {
    if (r.surprisePct === null && !r.upcoming && Number.isFinite(r.actual) && Number.isFinite(r.estimate) && r.estimate !== 0) r.surprisePct = +((r.actual - r.estimate) / Math.abs(r.estimate) * 100).toFixed(2);
    return r;
  }).sort((a, b) => key(a.period) - key(b.period)).slice(-12);
}

const forecastRows = t => (t?.rows || []).map(r => ({ fiscalEnd: r.fiscalEnd, avg: money(r.consensusEPSForecast), high: money(r.highEPSForecast), low: money(r.lowEPSForecast), analysts: money(r.noOfEstimates), up: money(r.up), down: money(r.down) }));

export async function detail(url, env) {
  const symbol = symbolParam(url);
  if (symbol.startsWith('^')) throw new UpstreamError('invalid_symbol', 400);
  const s = symbol.toLowerCase();
  const today = nyToday();
  const [dateR, epsR, surR, fcR, momR, qR, aR, fhE, fhC, rel] = await Promise.all([
    settle(nasdaq(`analyst/${symbol}/earnings-date`, {}, 3600)),
    settle(nasdaq(`quote/${symbol}/eps`, {}, 3600)),
    settle(nasdaq(`company/${symbol}/earnings-surprise`, {}, 3600)),
    settle(nasdaq(`analyst/${symbol}/earnings-forecast`, {}, 3600)),
    settle(nasdaq(`analyst/${symbol}/estimate-momentum`, {}, 3600)),
    settle(nasdaq(`company/${symbol}/financials`, { frequency: 2 }, 21600)),
    settle(nasdaq(`company/${symbol}/financials`, { frequency: 1 }, 21600)),
    env.FINNHUB_API_KEY ? settle(finnhub('stock/earnings', { symbol }, env, 3600)) : Promise.resolve({ error: 'provider_not_configured' }),
    env.FINNHUB_API_KEY ? settle(finnhub('calendar/earnings', { symbol, from: today, to: addDays(today, 120) }, env, 3600)) : Promise.resolve({ error: 'provider_not_configured' }),
    settle(earningsConnections([symbol]))
  ]);
  const errors = [];
  const note = (part, r) => { if (r.error) errors.push({ part, code: r.error }); };
  [['next', dateR], ['eps', epsR], ['surprise', surR], ['forecast', fcR], ['momentum', momR], ['quarterly_financials', qR], ['annual_financials', aR]].forEach(([p, r]) => note(p, r));
  if (env.FINNHUB_API_KEY) { note('finnhub_earnings', fhE); note('finnhub_calendar', fhC); }

  let next = parseNextDate(dateR.value?.reportText);
  const fhNext = (fhC.value?.earningsCalendar || []).filter(e => validDate(e.date) && e.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (fhNext) {
    next ??= { date: fhNext.date, time: null, fiscalQuarter: null, epsEstimate: null, estimates: null, lastYearEPS: null, estimated: true };
    if (next.date === fhNext.date) {
      next.time ??= timeCode(fhNext.hour);
      next.epsEstimate ??= Number.isFinite(fhNext.epsEstimate) ? fhNext.epsEstimate : null;
      next.revenueEstimate = Number.isFinite(fhNext.revenueEstimate) ? fhNext.revenueEstimate : null;
    }
  }
  if (next && next.date < today) next = null;

  const eps = epsHistory(epsR.value, surR.value, fhE.value);
  const connections = rel.value?.byReporter ? [...rel.value.byReporter.entries()].map(([reporter, list]) => ({ symbol: reporter, links: list.map(l => ({ kind: l.kind, detail: l.detail, url: l.url })) })) : [];
  // Related companies' next dates (bounded; Nasdaq Zacks estimate).
  const related = await Promise.all(connections.slice(0, 8).map(async c => {
    const r = await settle(nasdaq(`analyst/${c.symbol}/earnings-date`, {}, 3600));
    const n = parseNextDate(r.value?.reportText);
    return { ...c, next: n && n.date >= today ? { date: n.date, time: n.time } : null, nextError: r.error || null };
  }));

  const anything = next || eps.length || fcR.value || qR.value;
  if (!anything && errors.length) throw new UpstreamError(errors[0].code);
  return {
    symbol, next, nextText: dateR.value?.reportText || null, eps,
    forecast: fcR.value ? { quarterly: forecastRows(fcR.value.quarterlyForecast), yearly: forecastRows(fcR.value.yearlyForecast) } : null,
    momentum: momR.value?.changeInConsensus ? {
      quarter: { label: momR.value.changeInConsensus.fiscalQtrEndText, current: money(momR.value.changeInConsensus.currentData?.qtrMean), weekAgo: money(momR.value.changeInConsensus.weekData?.qtrMean), monthAgo: money(momR.value.changeInConsensus.monthData?.qtrMean), up: money(momR.value.estimatesChanged?.quarterDataUp?.changeValue), down: money(momR.value.estimatesChanged?.quarterDataDown?.changeValue) },
      year: { label: momR.value.changeInConsensus.fiscalYearEndText, current: money(momR.value.changeInConsensus.currentData?.yrMean), weekAgo: money(momR.value.changeInConsensus.weekData?.yrMean), monthAgo: money(momR.value.changeInConsensus.monthData?.yrMean), up: money(momR.value.estimatesChanged?.yearDataUp?.changeValue), down: money(momR.value.estimatesChanged?.yearDataDown?.changeValue) }
    } : null,
    financials: { quarterly: financialRows(qR.value?.incomeStatementTable), annual: financialRows(aR.value?.incomeStatementTable) },
    related, errors,
    sources: ['Nasdaq (Zacks consensus)', ...(env.FINNHUB_API_KEY && (fhE.value || fhC.value) ? ['Finnhub'] : [])],
    links: { nasdaq: `https://www.nasdaq.com/market-activity/stocks/${encodeURIComponent(s)}/earnings` },
    as_of: new Date().toISOString()
  };
}

// --- Economic calendar (reuses worker/calendar.js published schedules) ------
export async function economic(url) {
  const { from, to } = range(url, 92, 400);
  // calendar() starts at `now` (New York date) and returns events through the end of the third month.
  // Empty tickers -> market-wide events only (CPI, FOMC), no provider calls.
  const result = await calendar([], new Date(from + 'T12:00:00Z'));
  const events = result.events.filter(e => e.scope === 'market' && e.date >= from && e.date <= to)
    .map(e => ({ date: e.date, title: e.title, kind: /price index/i.test(e.title) ? 'inflation' : /fed/i.test(e.title) ? 'rates' : 'other', timing: e.timing || null, status: e.status, source: e.source, url: e.url, detail: e.detail }));
  return { from, to, events, coverage: 'Published release dates kept in the app’s calendar (BLS CPI, Federal Reserve FOMC). Other releases are not listed.', as_of: new Date().toISOString() };
}

export async function handle(request, env, ctx, url, rest) {
  if (rest === 'calendar') return json(await earningsCalendar(url, env), 200, 300);
  if (rest === 'detail') return json(await detail(url, env), 200, 600);
  if (rest === 'economic') return json(await economic(url), 200, 3600);
  return json({ error: 'Unknown earnings route.' }, 404);
}

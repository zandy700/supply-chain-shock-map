// Owned by the company builder. See docs/space-contract.md.
// /api/space/company/<route>: search, quote, profile, metrics, financials, analyst, peers, segments.
// Providers: Nasdaq public API (delayed quotes, statements, analyst consensus), Finnhub (when
// FINNHUB_API_KEY is set) and SEC EDGAR (filer facts + XBRL segment revenue). Every response lists
// its sources and names each field it could not fill, with the reason. Nothing is estimated
// unless the field says `derived`.
import { json, UpstreamError, symbolParam, getJSON, finnhub, num } from './upstream.js';

const NQ_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Macintosh) WatchlistPulse', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' };
const SEC_HEADERS = { 'User-Agent': 'WatchlistPulse research contact@example.invalid' };
const FINNHUB_MISSING = 'Finnhub is not configured on this server (FINNHUB_API_KEY).';

// ---------- provider helpers ----------

// Nasdaq JSON with symbol-not-found detection (the shared nasdaq() helper folds that into 502).
async function nq(path, params = {}, ttl = 120) {
  const url = new URL('https://api.nasdaq.com/api/' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const body = await getJSON(url.href, { headers: NQ_HEADERS, ttl });
  const code = body?.status?.rCode;
  if (code && code !== 200) {
    const msgs = body.status.bCodeMessage || [];
    if (msgs.some(m => m?.code === 1001 || /not exist/i.test(m?.errorMessage || ''))) throw new UpstreamError('unknown_symbol', 404);
    throw new UpstreamError('provider_unavailable');
  }
  return body?.data ?? null;
}

// Settle a provider call into { ok, value } | { ok:false, reason } for field-level reporting.
const REASONS = {
  provider_not_configured: FINNHUB_MISSING,
  provider_access_denied: 'The provider denied access (premium endpoint or invalid key).',
  rate_limited: 'Provider rate limit reached; try again shortly.',
  unknown_symbol: 'Symbol not found at the provider.',
  provider_unavailable: 'Provider unavailable.'
};
async function settle(p) {
  try { return { ok: true, value: await p }; }
  catch (e) { return { ok: false, code: e?.code || 'provider_unavailable', reason: REASONS[e?.code] || REASONS.provider_unavailable }; }
}
const fh = (path, params, env, ttl) => settle(finnhub(path, params, env, ttl));

// Resolve the Nasdaq asset class (stocks, then etf). Throws unknown_symbol (404) if neither.
async function nqInfo(symbol) {
  try { return { cls: 'stocks', info: await nq(`quote/${symbol}/info`, { assetclass: 'stocks' }, 30) }; }
  catch (e) {
    if (e.code !== 'unknown_symbol') throw e;
    return { cls: 'etf', info: await nq(`quote/${symbol}/info`, { assetclass: 'etf' }, 30) };
  }
}

const money = v => num(v);
const pctNum = v => num(v);
const range = (v, sep = /\s*[-/]\s*/) => {
  if (!v || typeof v !== 'string') return [null, null];
  const parts = v.replace(/\$/g, '').split(sep).map(num);
  return parts.length === 2 ? parts : [null, null];
};
const EXCHANGES = { 'NASDAQ-GS': 'NasdaqGS', 'NASDAQ-GM': 'NasdaqGM', 'NASDAQ-CM': 'NasdaqCM', NASDAQ: 'Nasdaq', NYSE: 'NYSE', PSE: 'NYSE Arca', 'NYSE ARCA': 'NYSE Arca', AMEX: 'NYSE American', 'NYSE MKT': 'NYSE American', BATS: 'Cboe BZX', CBOE: 'Cboe' };
const exchangeName = x => (x ? EXCHANGES[String(x).toUpperCase()] || x : null);
const cleanName = n => (n ? String(n).replace(/\s+(Common Stock|Class [A-C] (Common|Capital) Stock|Ordinary Shares|American Depositary Shares.*|New York Registry Shares|Capital Stock)$/i, '').trim() : null);
const isoDate = v => { if (!v) return null; const d = new Date(String(v).replace(/^Closed at /i, '').replace(/ ET$/, '')); return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10); };
const etTime = v => (v ? String(v).replace(/^Closed at /i, '').trim() : null);
const unavailable = (list, field, reason) => { list.push({ field, reason }); return null; };

// ---------- search ----------
const SEARCH_Q = /^[\p{L}\p{N} .,&'’()^=-]{1,60}$/u;
async function search(url, env) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || !SEARCH_Q.test(q)) throw new UpstreamError('invalid_query', 400);
  const [f, n] = await Promise.all([
    fh('search', { q, exchange: 'US' }, env, 3600),
    settle(nq('autocomplete/slookup/10', { search: q }, 3600))
  ]);
  const out = new Map();
  const add = r => { if (r.symbol && !out.has(r.symbol)) out.set(r.symbol, r); };
  const nasdaqRows = n.ok && Array.isArray(n.value) ? n.value.filter(r => ['STOCKS', 'ETF', 'INDEX'].includes(r.asset)) : [];
  const nasdaqBySym = new Map(nasdaqRows.map(r => [r.symbol, r]));
  if (f.ok) for (const r of f.value?.result || []) {
    if (!r.symbol || /[.:]/.test(r.symbol) && !/^[A-Z]{1,5}\.[A-Z]$/.test(r.symbol)) continue;
    const nr = nasdaqBySym.get(r.symbol);
    add({ symbol: r.symbol, name: cleanName(nr?.name) || r.description || r.symbol, type: r.type || nr?.subCategory || null, exchange: exchangeName(nr?.exchange) || null });
  }
  for (const r of nasdaqRows) add({ symbol: r.symbol, name: cleanName(r.name) || r.symbol, type: r.asset === 'ETF' ? 'ETF' : r.asset === 'INDEX' ? 'Index' : (r.subCategory || 'Common Stock'), exchange: exchangeName(r.exchange) || null });
  // Exact symbol matches first, then name-prefix matches, then the rest in provider order.
  const Q = q.toUpperCase();
  const rank = r => (r.symbol === Q ? 0 : r.symbol.startsWith(Q) ? 1 : (r.name || '').toUpperCase().startsWith(Q) ? 2 : 3);
  const results = [...out.values()].map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(x => x.r).slice(0, 12);
  const sources = [f.ok && 'Finnhub', n.ok && 'Nasdaq'].filter(Boolean);
  if (!sources.length) throw new UpstreamError('provider_unavailable');
  return json({ query: q, results, sources, notes: f.ok ? [] : [`Finnhub search unavailable: ${f.reason}`] }, 200, 300);
}

// ---------- quote ----------
async function quote(symbol, env) {
  const { cls, info } = await nqInfo(symbol);
  if (!info?.primaryData) throw new UpstreamError('unknown_symbol', 404);
  const [summary, fq, fm, divs, ana, chart] = await Promise.all([
    settle(nq(`quote/${symbol}/summary`, { assetclass: cls }, 30)),
    fh('quote', { symbol }, env, 30),
    fh('stock/metric', { symbol, metric: 'all' }, env, 3600),
    cls === 'stocks' ? settle(nq(`quote/${symbol}/dividends`, { assetclass: cls }, 3600)) : Promise.resolve({ ok: false, reason: 'Not reported for this asset class.' }),
    cls === 'stocks' ? settle(nq(`analyst/${symbol}/targetprice`, {}, 3600)) : Promise.resolve({ ok: false, reason: 'No analyst coverage for this asset class.' }),
    settle(nq(`quote/${symbol}/chart`, { assetclass: cls }, 30))
  ]);
  const miss = [];
  const sd = summary.ok ? summary.value?.summaryData || {} : {};
  const v = k => sd[k]?.value;
  const p = info.primaryData, s = info.secondaryData;
  const status = info.marketStatus || null;
  const extendedSession = /after|post/i.test(status || '') ? 'post' : /pre/i.test(status || '') ? 'pre' : null;
  // During pre/after-hours Nasdaq puts the extended trade in primaryData and the last regular close in secondaryData.
  const regular = extendedSession && s?.lastSalePrice ? s : p;
  const ext = extendedSession && s?.lastSalePrice ? p : null;
  const metric = fm.ok ? fm.value?.metric || {} : {};
  const m = (...keys) => { for (const k of keys) if (Number.isFinite(metric[k])) return metric[k]; return null; };

  const price = money(regular.lastSalePrice);
  const [dayLow, dayHigh] = (() => { const r = range(info.keyStats?.dayrange?.value); if (r[0] !== null) return [Math.min(...r), Math.max(...r)]; const t = range(v('TodayHighLow')); return t[0] !== null ? [Math.min(...t), Math.max(...t)] : [null, null]; })();
  const [yLow, yHigh] = (() => { const r = range(info.keyStats?.fiftyTwoWeekHighLow?.value); if (r[0] !== null) return [Math.min(...r), Math.max(...r)]; const t = range(v('FiftTwoWeekHighLow')); return t[0] !== null ? [Math.min(...t), Math.max(...t)] : [null, null]; })();
  const bidAsk = summary.ok ? summary.value?.bidAsk || {} : {};
  const parseBA = (str, fallbackPx, fallbackSz) => { const mm = String(str || '').match(/\$?([\d,.]+)\s*\*\s*([\d,]+)/); return mm ? [num(mm[1]), num(mm[2])] : [money(fallbackPx), num(fallbackSz)]; };
  const [bid, bidSize] = parseBA(bidAsk['Bid * Size']?.value, p.bidPrice, p.bidSize);
  const [ask, askSize] = parseBA(bidAsk['Ask * Size']?.value, p.askPrice, p.askSize);

  // Open: Finnhub's official open, else the first regular-session minute of Nasdaq's intraday chart (labeled derived).
  let open = fq.ok && fq.value?.o > 0 ? fq.value.o : null, openDerived = false;
  if (open === null && chart.ok) {
    const first = (chart.value?.chart || []).find(pt => /^9:3\d AM/.test(pt?.z?.dateTime || ''));
    if (first && Number.isFinite(first.y)) { open = first.y; openDerived = true; }
  }
  if (open === null) unavailable(miss, 'open', fq.ok ? 'Open not reported yet.' : `No official open without Finnhub. ${fq.reason}`);

  const divHeader = Object.fromEntries((divs.ok ? divs.value?.dividendHeaderValues || [] : []).map(h => [h.label, h.value]));
  const pe = m('peTTM', 'peBasicExclExtraTTM', 'peExclExtraTTM') ?? num(divHeader['P/E Ratio']);
  const eps = m('epsTTM', 'epsBasicExclExtraItemsTTM', 'epsInclExtraItemsTTM') ?? (pe && price ? +(price / pe).toFixed(2) : null);
  const epsDerived = m('epsTTM', 'epsBasicExclExtraItemsTTM', 'epsInclExtraItemsTTM') === null && eps !== null;
  const beta = m('beta') ?? num(v('Beta'));
  if (beta === null) unavailable(miss, 'beta', fm.ok ? 'Not reported.' : fm.reason);
  if (pe === null) unavailable(miss, 'pe', cls === 'etf' ? 'Not reported for ETFs by these sources.' : fm.ok ? 'Not reported.' : fm.reason);

  const earnings = (info.notifications || []).flatMap(n => n.eventTypes || []).find(e => /earnings/i.test(e.eventName || e.message || ''));
  const earningsDate = earnings ? isoDate(String(earnings.message).split(':').slice(1).join(':').trim()) : null;
  if (!earningsDate && cls === 'stocks') unavailable(miss, 'earningsDate', 'No upcoming earnings date published by Nasdaq.');
  const cons = ana.ok ? ana.value?.consensusOverview : null;
  const marketCap = num(v('MarketCap')) ?? (m('marketCapitalization') ? m('marketCapitalization') * 1e6 : null);

  // 52-week change and the S&P 500 (SPY) change over the same window: Finnhub, else derived from Nasdaq daily closes.
  let chg52 = m('52WeekPriceReturnDaily'), spx52 = null, chg52Derived = false;
  if (chg52 === null && price) {
    const [mine, spy, spyNow] = await Promise.all([settle(closeYearAgo(symbol, cls)), settle(closeYearAgo('SPY', 'etf')), settle(nqInfo('SPY'))]);
    if (mine.ok && mine.value) { chg52 = (price / mine.value - 1) * 100; chg52Derived = true; }
    const spyRegular = spyNow.ok ? (/after|pre/i.test(spyNow.value.info?.marketStatus || '') && spyNow.value.info?.secondaryData?.lastSalePrice ? spyNow.value.info.secondaryData : spyNow.value.info?.primaryData) : null;
    if (spy.ok && spy.value && spyRegular) spx52 = (money(spyRegular.lastSalePrice) / spy.value - 1) * 100;
  }

  const body = {
    symbol, assetClass: cls === 'etf' ? 'ETF' : 'Equity',
    name: cleanName(info.companyName) || symbol, longName: info.companyName || null,
    exchange: exchangeName(info.exchange), currency: 'USD',
    marketStatus: status,
    delayed: !regular.isRealTime,
    priceSource: regular.isRealTime ? 'Nasdaq Last Sale (real-time Nasdaq trades)' : 'Nasdaq consolidated (delayed)',
    price, change: num(regular.netChange), changePercent: pctNum(regular.percentageChange),
    regularTime: etTime(regular.lastTradeTimestamp), regularClosed: /^Closed/i.test(regular.lastTradeTimestamp || '') || !!ext,
    extended: ext ? { session: extendedSession, price: money(ext.lastSalePrice), change: num(ext.netChange), changePercent: pctNum(ext.percentageChange), time: etTime(ext.lastTradeTimestamp) } : null,
    previousClose: money(v('PreviousClose')) ?? (fq.ok ? fq.value?.pc ?? null : null),
    open, openDerived,
    bid, bidSize, ask, askSize,
    dayLow, dayHigh, yearLow: yLow, yearHigh: yHigh,
    volume: Math.round(num(v('ShareVolume')) ?? num(p.volume) ?? 0) || null,
    avgVolume: num(v('AverageVolume')) ?? num(v('FiftyDayAvgDailyVol')) ?? (m('3MonthAverageTradingVolume') ? m('3MonthAverageTradingVolume') * 1e6 : null),
    marketCap,
    beta, pe, eps, epsDerived,
    week52Change: chg52, week52Derived: chg52Derived, sp500Change52: spx52,
    earningsDate,
    dividendRate: money(v('AnnualizedDividend')) ?? money(divHeader['Annual Dividend']),
    dividendYield: pctNum(v('Yield')) ?? pctNum(divHeader['Dividend Yield']),
    exDividendDate: isoDate(v('ExDividendDate')) ?? isoDate(divHeader['Ex-Dividend Date']),
    targetMean: cons?.priceTarget ?? money(v('OneYrTarget')),
    targetLow: cons?.lowPriceTarget ?? null, targetHigh: cons?.highPriceTarget ?? null,
    ratingCounts: cons ? { buy: cons.buy, hold: cons.hold, sell: cons.sell } : null,
    sector: v('Sector') || null, industry: v('Industry') || null,
    etf: cls === 'etf' ? { aum: num(v('AUM')) !== null ? num(v('AUM')) * 1000 : null, expenseRatio: pctNum(v('ExpenseRatio')) } : null,
    sources: ['Nasdaq', fq.ok && 'Finnhub'].filter(Boolean),
    unavailable: miss,
    asOf: regular.lastTradeTimestamp || null,
    checkedAt: new Date().toISOString()
  };
  if (chg52 === null) unavailable(miss, 'week52Change', 'No close from a year ago is available.');
  return json(body, 200, 15);
}

// First daily close on/after the date one year ago, from Nasdaq history (narrow date windows return nothing,
// so read the total and fetch the oldest row by offset).
async function closeYearAgo(symbol, cls) {
  const params = { assetclass: cls, fromdate: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), todate: new Date().toISOString().slice(0, 10) };
  const head = await nq(`quote/${symbol}/historical`, { ...params, limit: 1 }, 21600);
  const total = +head?.totalRecords || 0;
  if (!total) return null;
  const tail = await nq(`quote/${symbol}/historical`, { ...params, limit: 1, offset: total - 1 }, 21600);
  return money(tail?.tradesTable?.rows?.[0]?.close);
}

// ---------- profile ----------
async function secCik(symbol) {
  const map = await getJSON('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS, ttl: 86400, timeout: 20000 });
  const sym = symbol.replace('.', '-');
  for (const r of Object.values(map || {})) if (r?.ticker === sym) return String(r.cik_str).padStart(10, '0');
  return null;
}
async function secSubmissions(cik) { return getJSON(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS, ttl: 21600, timeout: 20000 }); }
async function screenerRows() {
  const d = await nq('screener/stocks', { tableonly: 'true', download: 'true' }, 21600);
  return Array.isArray(d?.rows) ? d.rows : [];
}

async function profile(symbol, env) {
  const { cls, info } = await nqInfo(symbol);
  const [np, ns, f2, cik, screen] = await Promise.all([
    settle(nq(`company/${symbol}/company-profile`, {}, 86400)),
    settle(nq(`quote/${symbol}/summary`, { assetclass: cls }, 3600)),
    fh('stock/profile2', { symbol }, env, 86400),
    settle(secCik(symbol)),
    settle(screenerRows())
  ]);
  const sub = cik.ok && cik.value ? await settle(secSubmissions(cik.value)) : { ok: false, reason: cik.ok ? 'No SEC filer found for this symbol.' : cik.reason };
  const miss = [];
  const pv = k => (np.ok ? np.value?.[k]?.value : null) || null;
  const sv = k => (ns.ok ? ns.value?.summaryData?.[k]?.value : null) || null;
  const f = f2.ok ? f2.value || {} : {};
  const s = sub.ok ? sub.value || {} : {};
  const row = screen.ok ? screen.value.find(r => r.symbol === symbol) : null;
  const addr = s.addresses?.business;
  const hq = addr ? [addr.street1, addr.street2, addr.city, addr.stateOrCountryDescription || addr.stateOrCountry, addr.zipCode].filter(Boolean).join(', ') : (pv('Address') || null);
  const website = f.weburl || pv('CompanyUrl') || s.website || null;
  const ipo = f.ipo || null;
  const body = {
    symbol, name: f.name || pv('CompanyName') || cleanName(info.companyName) || symbol,
    description: pv('CompanyDescription') || null,
    sector: sv('Sector') || pv('Sector') || row?.sector || null,
    industry: sv('Industry') || pv('Industry') || row?.industry || f.finnhubIndustry || null,
    sic: s.sicDescription || null,
    country: f.country || row?.country || null,
    region: pv('Region') || null,
    headquarters: hq, phone: s.phone || pv('Phone') || f.phone || null,
    website: website && /^https?:\/\//i.test(website) ? website : website ? `https://${website}` : null,
    ipoDate: ipo, ipoYear: ipo ? Number(ipo.slice(0, 4)) : num(row?.ipoyear),
    exchange: exchangeName(info.exchange), assetClass: cls === 'etf' ? 'ETF' : 'Equity',
    fiscalYearEnd: s.fiscalYearEnd ? `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+s.fiscalYearEnd.slice(0, 2) - 1]} ${+s.fiscalYearEnd.slice(2)}` : null,
    stateOfIncorporation: s.stateOfIncorporationDescription || s.stateOfIncorporation || null,
    filerCategory: s.category || null, cik: cik.ok ? cik.value : null,
    formerNames: (s.formerNames || []).map(x => x.name).slice(0, 5),
    sharesOutstanding: Number.isFinite(f.shareOutstanding) ? f.shareOutstanding * 1e6 : null,
    logo: f.logo && /^https:\/\//.test(f.logo) ? f.logo : null,
    employees: null, officers: [],
    sources: ['Nasdaq', sub.ok && 'SEC EDGAR', f2.ok && 'Finnhub'].filter(Boolean),
    unavailable: miss
  };
  unavailable(miss, 'employees', 'Employee counts are not published by the free sources used here (Nasdaq, SEC EDGAR filer API, Finnhub free tier).');
  unavailable(miss, 'officers', 'Executive officer lists are not exposed by these sources.');
  if (!f2.ok) unavailable(miss, 'ipoDate', `Exact IPO date needs Finnhub. ${f2.reason}`);
  if (!body.description) unavailable(miss, 'description', 'Nasdaq has no description for this symbol.');
  return json(body, 200, 3600);
}

// ---------- financial statements ----------
// Canonical rows. `nq` = Nasdaq row label(s); `c` = us-gaap/ifrs concept names in Finnhub financials-reported.
const STATEMENTS = {
  income: [
    { key: 'revenue', label: 'Total Revenue', nq: ['Total Revenue'], c: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'Revenue'] },
    { key: 'cogs', label: 'Cost of Revenue', nq: ['Cost of Revenue'], c: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfSales'] },
    { key: 'grossProfit', label: 'Gross Profit', nq: ['Gross Profit'], c: ['GrossProfit'] },
    { section: 'Operating Expenses' },
    { key: 'rnd', label: 'Research & Development', nq: ['Research and Development'], c: ['ResearchAndDevelopmentExpense', 'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost'] },
    { key: 'sga', label: 'Selling, General & Admin.', nq: ['Sales, General and Admin.'], c: ['SellingGeneralAndAdministrativeExpense'] },
    { key: 'nonRecurring', label: 'Non-Recurring Items', nq: ['Non-Recurring Items'], c: ['RestructuringCharges', 'AssetImpairmentCharges'] },
    { key: 'otherOperating', label: 'Other Operating Items', nq: ['Other Operating Items'], c: [] },
    { key: 'operatingIncome', label: 'Operating Income', nq: ['Operating Income'], c: ['OperatingIncomeLoss'] },
    { key: 'otherIncome', label: "Add'l Income/Expense Items", nq: ["Add'l income/expense items"], c: ['NonoperatingIncomeExpense', 'OtherNonoperatingIncomeExpense'] },
    { key: 'ebit', label: 'EBIT', nq: ['Earnings Before Interest and Tax'], c: [] },
    { key: 'interestExpense', label: 'Interest Expense', nq: ['Interest Expense'], c: ['InterestExpense', 'InterestExpenseNonoperating', 'InterestExpenseDebt'] },
    { key: 'pretaxIncome', label: 'Pretax Income', nq: ['Earnings Before Tax'], c: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments', 'IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic'] },
    { key: 'incomeTax', label: 'Income Tax', nq: ['Income Tax'], c: ['IncomeTaxExpenseBenefit'] },
    { key: 'minorityInterest', label: 'Minority Interest', nq: ['Minority Interest'], c: ['NetIncomeLossAttributableToNoncontrollingInterest'] },
    { key: 'netIncomeCont', label: 'Net Income from Continuing Ops', nq: ['Net Income-Cont. Operations'], c: ['IncomeLossFromContinuingOperations'] },
    { key: 'netIncome', label: 'Net Income', nq: ['Net Income'], c: ['NetIncomeLoss', 'ProfitLoss'] },
    { key: 'netIncomeCommon', label: 'Net Income to Common', nq: ['Net Income Applicable to Common Shareholders'], c: ['NetIncomeLossAvailableToCommonStockholdersBasic'] },
    { key: 'epsBasic', label: 'Basic EPS', nq: [], c: ['EarningsPerShareBasic'], unit: 'perShare' },
    { key: 'epsDiluted', label: 'Diluted EPS', nq: [], c: ['EarningsPerShareDiluted'], unit: 'perShare' },
    { key: 'ebitda', label: 'EBITDA', derived: true }
  ],
  balance: [
    { section: 'Current Assets' },
    { key: 'cash', label: 'Cash & Equivalents', nq: ['Cash and Cash Equivalents'], c: ['CashAndCashEquivalentsAtCarryingValue', 'CashAndCashEquivalents'] },
    { key: 'shortInvestments', label: 'Short-Term Investments', nq: ['Short-Term Investments'], c: ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'] },
    { key: 'receivables', label: 'Net Receivables', nq: ['Net Receivables'], c: ['AccountsReceivableNetCurrent'] },
    { key: 'inventory', label: 'Inventory', nq: ['Inventory'], c: ['InventoryNet'] },
    { key: 'otherCurrentAssets', label: 'Other Current Assets', nq: ['Other Current Assets'], c: ['PrepaidExpenseAndOtherAssetsCurrent', 'OtherAssetsCurrent'] },
    { key: 'currentAssets', label: 'Total Current Assets', nq: ['Total Current Assets'], c: ['AssetsCurrent'] },
    { section: 'Long-Term Assets' },
    { key: 'longInvestments', label: 'Long-Term Investments', nq: ['Long-Term Investments'], c: ['LongTermInvestments', 'MarketableSecuritiesNoncurrent'] },
    { key: 'ppe', label: 'Fixed Assets', nq: ['Fixed Assets'], c: ['PropertyPlantAndEquipmentNet'] },
    { key: 'goodwill', label: 'Goodwill', nq: ['Goodwill'], c: ['Goodwill'] },
    { key: 'intangibles', label: 'Intangible Assets', nq: ['Intangible Assets'], c: ['IntangibleAssetsNetExcludingGoodwill', 'FiniteLivedIntangibleAssetsNet'] },
    { key: 'otherAssets', label: 'Other Assets', nq: ['Other Assets'], c: ['OtherAssetsNoncurrent'] },
    { key: 'deferredAssets', label: 'Deferred Asset Charges', nq: ['Deferred Asset Charges'], c: ['DeferredIncomeTaxAssetsNet'] },
    { key: 'totalAssets', label: 'Total Assets', nq: ['Total Assets'], c: ['Assets'] },
    { section: 'Current Liabilities' },
    { key: 'payables', label: 'Accounts Payable', nq: ['Accounts Payable'], c: ['AccountsPayableCurrent'] },
    { key: 'shortDebt', label: 'Short-Term Debt', nq: ['Short-Term Debt / Current Portion of Long-Term Debt'], c: ['LongTermDebtCurrent', 'DebtCurrent', 'ShortTermBorrowings'] },
    { key: 'otherCurrentLiabilities', label: 'Other Current Liabilities', nq: ['Other Current Liabilities'], c: ['OtherLiabilitiesCurrent', 'AccruedLiabilitiesCurrent'] },
    { key: 'currentLiabilities', label: 'Total Current Liabilities', nq: ['Total Current Liabilities'], c: ['LiabilitiesCurrent'] },
    { section: 'Long-Term Liabilities' },
    { key: 'longDebt', label: 'Long-Term Debt', nq: ['Long-Term Debt'], c: ['LongTermDebtNoncurrent'] },
    { key: 'otherLiabilities', label: 'Other Liabilities', nq: ['Other Liabilities'], c: ['OtherLiabilitiesNoncurrent'] },
    { key: 'deferredLiabilities', label: 'Deferred Liability Charges', nq: ['Deferred Liability Charges'], c: ['DeferredIncomeTaxLiabilitiesNet'] },
    { key: 'totalLiabilities', label: 'Total Liabilities', nq: ['Total Liabilities'], c: ['Liabilities'] },
    { section: "Stockholders' Equity" },
    { key: 'commonStock', label: 'Common Stock', nq: ['Common Stocks'], c: ['CommonStockValue', 'CommonStocksIncludingAdditionalPaidInCapital'] },
    { key: 'capitalSurplus', label: 'Capital Surplus', nq: ['Capital Surplus'], c: ['AdditionalPaidInCapital', 'AdditionalPaidInCapitalCommonStock'] },
    { key: 'retainedEarnings', label: 'Retained Earnings', nq: ['Retained Earnings'], c: ['RetainedEarningsAccumulatedDeficit'] },
    { key: 'treasuryStock', label: 'Treasury Stock', nq: ['Treasury Stock'], c: ['TreasuryStockValue'] },
    { key: 'otherEquity', label: 'Other Equity', nq: ['Other Equity'], c: ['AccumulatedOtherComprehensiveIncomeLossNetOfTax'] },
    { key: 'totalEquity', label: 'Total Equity', nq: ['Total Equity', 'Stock Holders Equity'], c: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'] },
    { key: 'totalLiabEquity', label: 'Total Liabilities & Equity', nq: ['Total Liabilities & Equity'], c: ['LiabilitiesAndStockholdersEquity'] }
  ],
  cashflow: [
    { key: 'netIncome', label: 'Net Income', nq: ['Net Income'], c: ['NetIncomeLoss', 'ProfitLoss'] },
    { section: 'Operating Activities' },
    { key: 'depreciation', label: 'Depreciation & Amortization', nq: ['Depreciation'], c: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'] },
    { key: 'netIncomeAdjustments', label: 'Net Income Adjustments', nq: ['Net Income Adjustments'], c: ['ShareBasedCompensation'] },
    { key: 'receivablesChange', label: 'Accounts Receivable', nq: ['Accounts Receivable'], c: ['IncreaseDecreaseInAccountsReceivable'] },
    { key: 'inventoryChange', label: 'Changes in Inventories', nq: ['Changes in Inventories'], c: ['IncreaseDecreaseInInventories'] },
    { key: 'otherOperatingCF', label: 'Other Operating Activities', nq: ['Other Operating Activities'], c: [] },
    { key: 'liabilitiesChange', label: 'Liabilities', nq: ['Liabilities'], c: ['IncreaseDecreaseInAccountsPayable'] },
    { key: 'operatingCF', label: 'Operating Cash Flow', nq: ['Net Cash Flow-Operating'], c: ['NetCashProvidedByUsedInOperatingActivities'] },
    { section: 'Investing Activities' },
    { key: 'capex', label: 'Capital Expenditures', nq: ['Capital Expenditures'], c: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'], negate: 'finnhub' },
    { key: 'investments', label: 'Investments', nq: ['Investments'], c: [] },
    { key: 'otherInvesting', label: 'Other Investing Activities', nq: ['Other Investing Activities'], c: [] },
    { key: 'investingCF', label: 'Investing Cash Flow', nq: ['Net Cash Flows-Investing'], c: ['NetCashProvidedByUsedInInvestingActivities'] },
    { section: 'Financing Activities' },
    { key: 'stockRepurchase', label: 'Sale & Purchase of Stock', nq: ['Sale and Purchase of Stock'], c: ['PaymentsForRepurchaseOfCommonStock'], negate: 'finnhub' },
    { key: 'netBorrowings', label: 'Net Borrowings', nq: ['Net Borrowings'], c: [] },
    { key: 'dividendsPaid', label: 'Dividends Paid', nq: [], c: ['PaymentsOfDividends', 'PaymentsOfDividendsCommonStock'], negate: 'finnhub' },
    { key: 'otherFinancing', label: 'Other Financing Activities', nq: ['Other Financing Activities'], c: [] },
    { key: 'financingCF', label: 'Financing Cash Flow', nq: ['Net Cash Flows-Financing'], c: ['NetCashProvidedByUsedInFinancingActivities'] },
    { key: 'fxEffect', label: 'Effect of Exchange Rate', nq: ['Effect of Exchange Rate'], c: ['EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'] },
    { key: 'netCashFlow', label: 'Net Change in Cash', nq: ['Net Cash Flow'], c: ['CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect', 'CashAndCashEquivalentsPeriodIncreaseDecrease'] },
    { key: 'freeCashFlow', label: 'Free Cash Flow', derived: true }
  ]
};
const TABLES = { income: 'incomeStatementTable', balance: 'balanceSheetTable', cashflow: 'cashFlowTable' };
// Nasdaq statement values are in thousands of USD ("$215,938,000" = $215.9B).
const nqMoney = v => { if (v === '' || v === '--' || v == null) return null; const n = num(String(v).replace(/[()]/g, '')); return n === null ? null : n * 1000; };
const nqDate = v => { const m = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };

// Nasdaq statements -> { periods:[{end,label}], values:{key:[...]} } for one statement.
function fromNasdaq(data, statement) {
  const t = data?.[TABLES[statement]];
  if (!t?.headers) return null;
  const cols = Object.keys(t.headers).filter(k => k !== 'value1');
  const periods = cols.map(c => ({ end: nqDate(t.headers[c]), label: t.headers[c] })).filter(p => p.end);
  const byLabel = new Map((t.rows || []).map(r => [r.value1, r]));
  const values = {};
  for (const def of STATEMENTS[statement]) {
    if (!def.key || def.derived) continue;
    const row = (def.nq || []).map(l => byLabel.get(l)).find(Boolean);
    if (row) values[def.key] = cols.slice(0, periods.length).map(c => nqMoney(row[c]));
  }
  return { periods, values };
}
function nasdaqRatios(data) {
  const t = data?.financialRatiosTable;
  if (!t?.headers) return null;
  const cols = Object.keys(t.headers).filter(k => k !== 'value1');
  return {
    periods: cols.map(c => ({ end: nqDate(t.headers[c]), label: t.headers[c] })),
    rows: (t.rows || []).map(r => (cols.every(c => r[c] === '') ? { section: r.value1 } : { label: r.value1, unit: 'percent', values: cols.map(c => num(r[c])) }))
  };
}

// Finnhub financials-reported -> same shape. Values are raw USD; statements arrays carry {concept,value}.
function fromFinnhub(body, statement, freq) {
  const reports = (body?.data || []).filter(r => r?.report && r.endDate).sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (!reports.length) return null;
  const key = statement === 'income' ? 'ic' : statement === 'balance' ? 'bs' : 'cf';
  const list = reports.slice(0, freq === 'quarterly' ? 12 : 15);
  const periods = list.map(r => ({ end: r.endDate.slice(0, 10), start: r.startDate?.slice(0, 10) || null, label: `${r.form || ''} ${r.endDate.slice(0, 10)}`.trim(), form: r.form || null }));
  const values = {};
  for (const def of STATEMENTS[statement]) {
    if (!def.key || def.derived || !def.c?.length) continue;
    const vals = list.map(r => {
      const items = Array.isArray(r.report[key]) ? r.report[key] : [];
      for (const c of def.c) {
        const hit = items.find(x => String(x.concept || '').replace(/^[a-z-]+[_:]/i, '') === c && Number.isFinite(+x.value));
        if (hit) return def.negate === 'finnhub' ? -Math.abs(+hit.value) : +hit.value;
      }
      return null;
    });
    if (vals.some(v => v !== null)) values[def.key] = vals;
  }
  return { periods, values };
}

function addDerived(stmt, statement, cashflow) {
  const n = stmt.periods.length;
  if (statement === 'income') {
    const op = stmt.values.operatingIncome, dep = cashflow?.values?.depreciation;
    if (op && dep) stmt.values.ebitda = Array.from({ length: n }, (_, i) => (op[i] !== null && dep[i] != null ? op[i] + dep[i] : null));
  }
  if (statement === 'cashflow') {
    const ocf = stmt.values.operatingCF, capex = stmt.values.capex;
    if (ocf && capex) stmt.values.freeCashFlow = Array.from({ length: n }, (_, i) => (ocf[i] !== null && capex[i] !== null ? ocf[i] + capex[i] : null));
  }
}

// Load one statement (annual or quarterly), preferring Finnhub's longer history.
async function loadStatements(symbol, period, env) {
  const freq = period === 'quarterly' ? 'quarterly' : 'annual';
  const f = await fh('stock/financials-reported', { symbol, freq }, env, 21600);
  if (f.ok && f.value?.data?.length) {
    const out = {};
    for (const s of ['income', 'balance', 'cashflow']) out[s] = fromFinnhub(f.value, s, freq);
    if (out.income) return { source: 'Finnhub (SEC financials as reported)', ...out, ratios: null, notes: [] };
  }
  const d = await nq(`company/${symbol}/financials`, { frequency: freq === 'quarterly' ? 2 : 1 }, 21600);
  const out = {};
  for (const s of ['income', 'balance', 'cashflow']) out[s] = fromNasdaq(d, s);
  if (!out.income) throw new UpstreamError('financials_unavailable', 404);
  return { source: 'Nasdaq (values reported in USD thousands, scaled to USD)', ...out, ratios: nasdaqRatios(d), notes: f.ok ? [] : [`Longer history needs Finnhub: ${f.reason} Showing the 4 most recent periods from Nasdaq.`] };
}

// TTM column: income/cash flow = sum of the latest 4 quarters; balance sheet = latest quarter.
function ttmColumn(quarterly, statement) {
  const q = quarterly?.[statement];
  if (!q?.periods?.length) return null;
  if (statement === 'balance') return { end: q.periods[0].end, values: Object.fromEntries(Object.entries(q.values).map(([k, arr]) => [k, arr[0] ?? null])) };
  const rolling = rollingFinancials(q, statement);
  if (!rolling.periods.length) return null;
  return { end: rolling.periods[0].end, values: Object.fromEntries(Object.entries(rolling.values).map(([k, arr]) => [k, arr[0] ?? null])) };
}

// A rolling year needs four consecutive, standalone quarters. Do not sum
// year-to-date filing values or bridge missing fiscal quarters.
export function rollingFinancials(stmt, statement) {
  const periods = [], values = Object.fromEntries(Object.keys(stmt.values).map(k => [k, []]));
  for (let i = 0; i + 3 < stmt.periods.length; i++) {
    const window = stmt.periods.slice(i, i + 4);
    const valid = window.every((p, j) => {
      const end = Date.parse(p.end), duration = p.start ? (end - Date.parse(p.start)) / 86400000 : 90;
      const gap = j ? (Date.parse(window[j - 1].end) - end) / 86400000 : 90;
      return Number.isFinite(end) && duration >= 45 && duration <= 125 && gap >= 60 && gap <= 125;
    });
    if (!valid) continue;
    periods.push({ id: `ltm-${window[0].end}`, label: window[0].end, end: window[0].end });
    for (const [key, arr] of Object.entries(stmt.values)) values[key].push(statement === 'balance' ? arr[i] ?? null : arr.slice(i, i + 4).length === 4 && arr.slice(i, i + 4).every(Number.isFinite) ? arr.slice(i, i + 4).reduce((a, b) => a + b, 0) : null);
  }
  return { periods, values };
}

async function financials(symbol, url, env) {
  const statement = url.searchParams.get('statement') || 'income';
  const period = ['quarterly', 'ltm'].includes(url.searchParams.get('period')) ? url.searchParams.get('period') : 'annual';
  if (!STATEMENTS[statement] && statement !== 'ratios') throw new UpstreamError('invalid_statement', 400);
  await nqInfo(symbol); // unknown symbols -> 404
  const main = await loadStatements(symbol, period === 'ltm' ? 'quarterly' : period, env);
  if (statement === 'ratios') {
    if (!main.ratios) return json({ symbol, statement, period, unavailable: [{ field: 'ratios', reason: 'Ratio table is only published by Nasdaq for this symbol.' }], rows: [], periods: [] }, 200, 3600);
    return json({ symbol, statement, period, currency: 'USD', source: 'Nasdaq', ...main.ratios }, 200, 3600);
  }
  const quarterly = period !== 'annual' ? main : await settle(loadStatements(symbol, 'quarterly', env)).then(r => (r.ok ? r.value : null));
  let stmt = main[statement];
  if (!stmt) throw new UpstreamError('financials_unavailable', 404);
  addDerived(stmt, statement, main.cashflow);
  if (quarterly && quarterly !== main) addDerived(quarterly[statement] || { periods: [], values: {} }, statement, quarterly.cashflow);
  if (period === 'ltm') stmt = rollingFinancials(stmt, statement);
  const ttm = period === 'ltm' ? null : ttmColumn(quarterly, statement);
  const columns = [...(ttm ? [{ id: 'ttm', label: statement === 'balance' ? 'Current' : 'TTM', end: ttm.end }] : []), ...stmt.periods.map(p => ({ id: p.id || p.end, label: p.end, end: p.end }))];
  const rows = STATEMENTS[statement].map(def => {
    if (def.section) return { section: def.section };
    const vals = stmt.values[def.key];
    if (!vals || (vals.every(v => v === null) && !(ttm && ttm.values[def.key] != null))) return null;
    return { key: def.key, label: def.label, unit: def.unit || 'usd', derived: !!def.derived, values: [...(ttm ? [ttm.values[def.key] ?? null] : []), ...vals] };
  }).filter(Boolean);
  // Drop section headers with no rows after them.
  const cleaned = rows.filter((r, i) => !r.section || (rows[i + 1] && !rows[i + 1].section));
  return json({ symbol, statement, period, currency: 'USD', source: main.source, columns, rows: cleaned, notes: [...main.notes, ...(period === 'ltm' ? [columns.length ? 'Derived LTM: sums of four consecutive reported quarters. Older rolling years require longer quarterly history. Balance sheets remain point-in-time values.' : 'LTM unavailable: four consecutive standalone quarters are required; year-to-date filing values are not summed.'] : ttm ? [] : ['TTM column unavailable (needs 4 reported quarters).'])] }, 200, 3600);
}

// ---------- key metrics ----------
async function metrics(symbol, url, env) {
  const period = url.searchParams.get('period') === 'quarterly' ? 'quarterly' : 'annual';
  const { cls } = await nqInfo(symbol);
  const [q, fm, peg, divs, summary] = await Promise.all([
    quoteData(symbol, env),
    fh('stock/metric', { symbol, metric: 'all' }, env, 3600),
    cls === 'stocks' ? settle(nq(`analyst/${symbol}/peg-ratio`, {}, 21600)) : Promise.resolve({ ok: false, reason: 'Not covered.' }),
    cls === 'stocks' ? settle(nq(`quote/${symbol}/dividends`, { assetclass: cls }, 3600)) : Promise.resolve({ ok: false }),
    settle(nq(`quote/${symbol}/summary`, { assetclass: cls }, 300))
  ]);
  const st = cls === 'stocks' ? await settle(loadStatements(symbol, period, env)) : { ok: false, reason: 'Financial statements are not published for ETFs.' };
  const qs = cls === 'stocks' && period === 'annual' ? await settle(loadStatements(symbol, 'quarterly', env)) : st;
  const notes = [];
  const metric = fm.ok ? fm.value?.metric || {} : {};
  const series = fm.ok ? fm.value?.series?.[period] || {} : {};
  if (!fm.ok) notes.push(`Historical valuation multiples need Finnhub: ${fm.reason}`);
  const S = st.ok ? st.value : null, Q = qs.ok ? qs.value : null;
  if (!S) notes.push(`Statement-based metrics unavailable: ${st.reason}`);
  const inc = S?.income, bal = S?.balance, cf = S?.cashflow;
  const periods = inc?.periods || [];
  const ttmInc = Q ? ttmColumn(Q, 'income')?.values || {} : {};
  const ttmBal = Q ? ttmColumn(Q, 'balance')?.values || {} : {};
  const ttmCf = Q ? ttmColumn(Q, 'cashflow')?.values || {} : {};
  const columns = [{ id: 'ttm', label: 'Current/TTM', end: Q?.income?.periods?.[0]?.end || null }, ...periods.map(p => ({ id: p.end, label: p.end, end: p.end }))];
  const at = (obj, key, i) => obj?.values?.[key]?.[i] ?? null;
  const ratio = (a, b) => (a !== null && b !== null && b !== 0 ? a / b : null);
  const pct = (a, b) => { const r = ratio(a, b); return r === null ? null : r * 100; };
  const per = fn => periods.map((_, i) => fn(i));
  const seriesAt = (key, i) => { const s = series[key]; if (!Array.isArray(s) || !periods[i]) return null; const hit = s.find(x => x.period === periods[i].end); return hit && Number.isFinite(hit.v) ? hit.v : null; };
  const m = (...keys) => { for (const k of keys) if (Number.isFinite(metric[k])) return metric[k]; return null; };

  const ebitda = i => { const op = at(inc, 'operatingIncome', i), d = at(cf, 'depreciation', i); return op !== null && d !== null ? op + d : null; };
  const ttmEbitda = ttmInc.operatingIncome != null && ttmCf.depreciation != null ? ttmInc.operatingIncome + ttmCf.depreciation : null;
  const debt = v => (v.shortDebt ?? 0) + (v.longDebt ?? 0);
  const cashLike = v => (v.cash ?? 0) + (v.shortInvestments ?? 0);
  const ev = q.marketCap !== null && ttmBal.totalAssets != null ? q.marketCap + debt(ttmBal) - cashLike(ttmBal) : (m('enterpriseValue') ? m('enterpriseValue') * 1e6 : null);
  const pegData = peg.ok ? peg.value : null;
  const fwdPe = (pegData?.per?.peRatioChart || []).find(x => /estimate/i.test(x.x))?.y ?? m('forwardPE');
  const divHeader = Object.fromEntries((divs.ok ? divs.value?.dividendHeaderValues || [] : []).map(h => [h.label, h.value]));
  const trailingPe = m('peTTM', 'peBasicExclExtraTTM') ?? num(divHeader['P/E Ratio']);
  const growth = (arr, i, lag) => (arr && arr[i] != null && arr[i + lag] != null && arr[i + lag] !== 0 ? (arr[i] / arr[i + lag] - 1) * 100 : null);
  const lag = period === 'quarterly' ? 4 : 1;
  const rev = inc?.values?.revenue;

  const row = (label, unit, current, hist, tip, opts = {}) => ({ label, unit, tip, values: [current ?? null, ...(hist || periods.map(() => null))], ...opts });
  const sections = [
    { section: 'Operational', rows: [
      row('Revenue', 'usd', ttmInc.revenue ?? null, per(i => at(inc, 'revenue', i)), 'Revenue as reported, current column sums four reported quarters.'),
      row('Operating Income', 'usd', ttmInc.operatingIncome ?? null, per(i => at(inc, 'operatingIncome', i)), 'Operating profit as reported.'),
      row('Net Income', 'usd', ttmInc.netIncome ?? null, per(i => at(inc, 'netIncome', i)), 'Net income as reported.'),
      row('Operating Cash Flow', 'usd', ttmCf.operatingCF ?? null, per(i => at(cf, 'operatingCF', i)), 'Cash generated by operations as reported.'),
      row('Free Cash Flow', 'usd', ttmCf.operatingCF != null && ttmCf.capex != null ? ttmCf.operatingCF + ttmCf.capex : null, per(i => at(cf, 'operatingCF', i) != null && at(cf, 'capex', i) != null ? at(cf, 'operatingCF', i) + at(cf, 'capex', i) : null), 'Operating cash flow plus reported capital expenditures (cash outflows are negative).', { derived: true }),
      row('Revenue Growth', 'percent', m('revenueGrowthTTMYoy'), per(i => growth(rev, i, lag)), period === 'quarterly' ? 'Revenue change versus the same quarter a year earlier.' : 'Revenue change versus the prior fiscal year.', { noteIfEmpty: period === 'quarterly' && (rev?.length || 0) <= 4 ? 'Year-over-year quarterly growth needs 5+ quarters (Finnhub).' : null }),
      row('Gross Margin', 'percent', pct(ttmInc.grossProfit ?? null, ttmInc.revenue ?? null), per(i => pct(at(inc, 'grossProfit', i), at(inc, 'revenue', i))), 'Gross profit as a share of revenue.'),
      row('EBITDA Margin', 'percent', pct(ttmEbitda, ttmInc.revenue ?? null), per(i => pct(ebitda(i), at(inc, 'revenue', i))), 'EBITDA (operating income + depreciation & amortization, derived) as a share of revenue.', { derived: true }),
      row('Operating Margin', 'percent', pct(ttmInc.operatingIncome ?? null, ttmInc.revenue ?? null), per(i => pct(at(inc, 'operatingIncome', i), at(inc, 'revenue', i))), 'Operating income as a share of revenue.'),
      row('Net Margin', 'percent', pct(ttmInc.netIncome ?? null, ttmInc.revenue ?? null), per(i => pct(at(inc, 'netIncome', i), at(inc, 'revenue', i))), 'Net income as a share of revenue.')
    ] },
    { section: 'Dividend Yield', rows: [
      row('Dividend Yield', 'percent', q.dividendYield, per(i => seriesAt('dividendYield', i) ?? null), 'Indicated annual dividend divided by the current price.')
    ] },
    { section: 'Valuation', rows: [
      row('Market Cap', 'usd', q.marketCap, per(i => (seriesAt('marketCapitalization', i) ? seriesAt('marketCapitalization', i) * 1e6 : null)), 'Share price × shares outstanding. Historical values need Finnhub.'),
      row('Enterprise Value', 'usd', ev, per(i => (seriesAt('ev', i) ? seriesAt('ev', i) * 1e6 : null)), 'Market cap + total debt − cash and short-term investments (derived from the latest balance sheet).', { derived: true })
    ] },
    { section: 'Multiples', rows: [
      row('EV / Revenue (Forward)', 'multiple', null, null, 'Needs a consensus revenue estimate, which the free sources do not publish.', { noteIfEmpty: 'Consensus revenue estimates are not available from these sources.' }),
      row('EV / Revenue (Trailing)', 'multiple', ratio(ev, ttmInc.revenue ?? null), per(i => seriesAt('evRevenue', i)), 'Enterprise value divided by trailing-twelve-month revenue.', { derived: true }),
      row('EV / EBITDA (Forward)', 'multiple', null, null, 'Needs a consensus EBITDA estimate, which the free sources do not publish.', { noteIfEmpty: 'Consensus EBITDA estimates are not available from these sources.' }),
      row('EV / EBITDA (Trailing)', 'multiple', ratio(ev, ttmEbitda), per(i => seriesAt('evEbitda', i)), 'Enterprise value divided by trailing-twelve-month EBITDA.', { derived: true }),
      row('P/E (Forward)', 'multiple', fwdPe ?? null, null, 'Price divided by the consensus EPS estimate for the next fiscal year (Zacks via Nasdaq).'),
      row('P/E (Trailing)', 'multiple', trailingPe, per(i => seriesAt('pe', i)), 'Price divided by trailing-twelve-month earnings per share.'),
      row('PEG Ratio', 'multiple', pegData?.pegr?.pegValue ?? m('pegTTM'), null, 'Forward P/E divided by the expected earnings growth rate (12-month forward, Zacks via Nasdaq).'),
      row('Price / Sales', 'multiple', ratio(q.marketCap, ttmInc.revenue ?? null) ?? m('psTTM'), per(i => seriesAt('ps', i)), 'Market cap divided by trailing-twelve-month revenue.'),
      row('Price / Book', 'multiple', ratio(q.marketCap, ttmBal.totalEquity ?? null) ?? m('pbQuarterly', 'pbAnnual'), per(i => seriesAt('pb', i)), 'Market cap divided by total shareholders’ equity.')
    ] },
    { section: 'Profitability', rows: [
      row('Return on Equity', 'percent', pct(ttmInc.netIncome ?? null, ttmBal.totalEquity ?? null) ?? m('roeTTM'), per(i => pct(at(inc, 'netIncome', i), at(bal, 'totalEquity', i))), 'Net income divided by shareholders’ equity at period end.'),
      row('Return on Assets', 'percent', pct(ttmInc.netIncome ?? null, ttmBal.totalAssets ?? null) ?? m('roaTTM'), per(i => pct(at(inc, 'netIncome', i), at(bal, 'totalAssets', i))), 'Net income divided by total assets at period end.'),
      row('Free Cash Flow Margin', 'percent', pct(ttmCf.operatingCF != null && ttmCf.capex != null ? ttmCf.operatingCF + ttmCf.capex : null, ttmInc.revenue ?? null), per(i => pct(at(cf, 'operatingCF', i) !== null && at(cf, 'capex', i) !== null ? at(cf, 'operatingCF', i) + at(cf, 'capex', i) : null, at(inc, 'revenue', i))), 'Operating cash flow minus capital expenditures, as a share of revenue.', { derived: true })
    ] },
    { section: 'Financial Health', rows: [
      row('Current Ratio', 'multiple', ratio(ttmBal.currentAssets ?? null, ttmBal.currentLiabilities ?? null), per(i => ratio(at(bal, 'currentAssets', i), at(bal, 'currentLiabilities', i))), 'Current assets divided by current liabilities.'),
      row('Debt / Equity', 'multiple', ratio(ttmBal.totalAssets != null ? debt(ttmBal) : null, ttmBal.totalEquity ?? null), per(i => (at(bal, 'totalAssets', i) !== null ? ratio(debt({ shortDebt: at(bal, 'shortDebt', i), longDebt: at(bal, 'longDebt', i) }), at(bal, 'totalEquity', i)) : null)), 'Short- plus long-term debt divided by shareholders’ equity.')
    ] }
  ];
  const sv = summary.ok ? summary.value?.summaryData || {} : {};
  return json({
    symbol, period, currency: 'USD', assetClass: cls === 'etf' ? 'ETF' : 'Equity', columns, sections,
    etf: cls === 'etf' ? Object.values(sv).map(x => ({ label: x.label, value: x.value })) : null,
    finnhub: fm.ok ? { beta: m('beta'), week52High: m('52WeekHigh'), week52Low: m('52WeekLow'), roeTTM: m('roeTTM') } : null,
    sources: ['Nasdaq', fm.ok && 'Finnhub', S?.source?.startsWith('Finnhub') && 'SEC via Finnhub'].filter(Boolean),
    statementSource: S?.source || null, notes
  }, 200, 900);
}

// Shared quote numbers for other routes (no Response wrapper).
async function quoteData(symbol, env) { return (await quote(symbol, env)).json(); }

// ---------- analyst ----------
async function analyst(symbol, env) {
  const { cls, info } = await nqInfo(symbol);
  if (cls !== 'stocks') return json({ symbol, covered: false, reason: 'Analyst ratings are published for individual stocks, not ETFs.', sources: [] }, 200, 3600);
  const [tp, rt, ef, rec, ptg, ud] = await Promise.all([
    settle(nq(`analyst/${symbol}/targetprice`, {}, 3600)),
    settle(nq(`analyst/${symbol}/ratings`, {}, 3600)),
    settle(nq(`analyst/${symbol}/earnings-forecast`, {}, 3600)),
    fh('stock/recommendation', { symbol }, env, 3600),
    fh('stock/price-target', { symbol }, env, 3600),
    fh('stock/upgrade-downgrade', { symbol }, env, 3600)
  ]);
  const notes = [];
  const price = money(info?.secondaryData?.lastSalePrice && /after|pre/i.test(info.marketStatus || '') ? info.primaryData.lastSalePrice : info?.primaryData?.lastSalePrice);
  const cons = tp.ok ? tp.value?.consensusOverview : null;
  const recs = rec.ok && Array.isArray(rec.value) ? rec.value.filter(r => r?.period).sort((a, b) => b.period.localeCompare(a.period)) : [];
  let distribution = null;
  if (recs.length) {
    const r = recs[0];
    distribution = { source: 'Finnhub', period: r.period, buckets: [['strongBuy', 'Strong buy', r.strongBuy], ['buy', 'Buy', r.buy], ['hold', 'Hold', r.hold], ['sell', 'Sell', r.sell], ['strongSell', 'Strong sell', r.strongSell]].map(([key, label, count]) => ({ key, label, count: +count || 0 })) };
  } else if (cons) {
    distribution = { source: 'Nasdaq (Zacks)', period: null, buckets: [['buy', 'Buy', cons.buy], ['hold', 'Hold', cons.hold], ['sell', 'Sell', cons.sell]].map(([key, label, count]) => ({ key, label, count: +count || 0 })) };
    notes.push(`Nasdaq reports Buy / Hold / Sell only; the Strong buy / Strong sell split needs Finnhub (${rec.ok ? 'no data' : rec.reason})`);
  }
  if (distribution) {
    const total = distribution.buckets.reduce((a, b) => a + b.count, 0);
    distribution.total = total;
    for (const b of distribution.buckets) b.percent = total ? (b.count / total) * 100 : 0;
    distribution.bullishPercent = total ? ((distribution.buckets.find(b => b.key === 'strongBuy')?.count || 0) + (distribution.buckets.find(b => b.key === 'buy')?.count || 0)) / total * 100 : null;
  }
  // Consensus label: Finnhub-weighted mean (1 strong buy … 5 strong sell) else Nasdaq's mean rating.
  let consensus = rt.ok ? rt.value?.meanRatingType || null : null;
  if (distribution?.source === 'Finnhub' && distribution.total) {
    const w = { strongBuy: 1, buy: 2, hold: 3, sell: 4, strongSell: 5 };
    const mean = distribution.buckets.reduce((a, b) => a + w[b.key] * b.count, 0) / distribution.total;
    consensus = mean <= 1.5 ? 'Strong buy' : mean <= 2.5 ? 'Buy' : mean <= 3.5 ? 'Hold' : mean <= 4.5 ? 'Sell' : 'Strong sell';
    distribution.meanScore = +mean.toFixed(2);
  }
  const pt = ptg.ok && ptg.value && Number.isFinite(ptg.value.targetMean) && ptg.value.targetMean > 0 ? ptg.value : null;
  const targets = pt ? { source: 'Finnhub', mean: pt.targetMean, median: pt.targetMedian ?? null, low: pt.targetLow ?? null, high: pt.targetHigh ?? null, updated: pt.lastUpdated || null, analysts: pt.numberAnalysts ?? null }
    : cons ? { source: 'Nasdaq (Zacks)', mean: cons.priceTarget ?? null, median: null, low: cons.lowPriceTarget ?? null, high: cons.highPriceTarget ?? null, updated: null, analysts: (cons.buy || 0) + (cons.hold || 0) + (cons.sell || 0) } : null;
  if (!pt) notes.push(`Price targets from Nasdaq (Zacks consensus). Finnhub price targets: ${ptg.ok ? 'no data' : ptg.reason}`);
  if (targets && price) targets.upsidePercent = targets.mean ? (targets.mean / price - 1) * 100 : null;
  if (targets?.low && targets?.high) targets.spread = targets.high / targets.low;

  const history = tp.ok ? (tp.value?.historicalConsensus || []).filter(h => h?.z?.date && !h.z.latest).map(h => ({ date: nqDate(h.z.date), buy: h.z.buy ?? 0, hold: h.z.hold ?? 0, sell: h.z.sell ?? 0, consensus: h.z.consensus || null, price: Number.isFinite(h.y) ? h.y : null })) : [];
  const trend = recs.length ? recs.slice(0, 12).reverse().map(r => ({ date: r.period, strongBuy: r.strongBuy, buy: r.buy, hold: r.hold, sell: r.sell, strongSell: r.strongSell })) : null;

  const actions = [];
  if (ud.ok && Array.isArray(ud.value)) for (const a of ud.value.slice(0, 40)) actions.push({ date: a.gradeTime ? new Date(a.gradeTime * 1000).toISOString().slice(0, 10) : null, firm: a.company || null, action: a.action || null, from: a.fromGrade || null, to: a.toGrade || null, source: 'Finnhub' });
  if (rt.ok) for (const a of rt.value?.upgradesDowngrades || []) actions.push({ date: nqDate(a.date) || a.date || null, firm: a.brokerName || a.firm || null, action: a.action || a.upgradeDowngrade || null, from: a.fromRating || a.from || null, to: a.toRating || a.to || null, target: num(a.priceTarget) ?? null, source: 'Nasdaq' });
  const actionsNote = actions.length ? null : `No recent upgrades/downgrades published by Nasdaq for ${symbol}. Finnhub upgrade/downgrade feed: ${ud.ok ? 'no data' : ud.reason}`;

  const fc = ef.ok ? ef.value : null;
  const mapFc = t => (t?.rows || []).map(r => ({ period: r.fiscalEnd, consensus: r.consensusEPSForecast ?? null, high: r.highEPSForecast ?? null, low: r.lowEPSForecast ?? null, estimates: r.noOfEstimates ?? null, revisionsUp: r.up ?? null, revisionsDown: r.down ?? null }));
  if (!tp.ok && !rec.ok && !rt.ok) throw new UpstreamError('provider_unavailable');
  return json({
    symbol, covered: !!(targets || distribution), price, consensus,
    ratingsSummary: rt.ok ? rt.value?.ratingsSummary || null : null,
    brokers: rt.ok ? rt.value?.brokerNames || [] : [],
    distribution, targets, history, trend, actions, actionsNote,
    forecasts: fc ? { quarterly: mapFc(fc.quarterlyForecast), yearly: mapFc(fc.yearlyForecast), source: 'Nasdaq (Zacks)' } : null,
    trackRecord: { available: false, reason: 'Per-analyst accuracy history is not published by free sources.' },
    sources: ['Nasdaq (Zacks)', (rec.ok || ptg.ok) && 'Finnhub'].filter(Boolean), notes
  }, 200, 900);
}

// ---------- peers ----------
async function peers(symbol, env) {
  await nqInfo(symbol);
  const [fp, screen] = await Promise.all([fh('stock/peers', { symbol }, env, 86400), settle(screenerRows())]);
  const rows = screen.ok ? screen.value : [];
  const bySym = new Map(rows.map(r => [r.symbol, r]));
  const self = bySym.get(symbol);
  let list = [], method;
  if (fp.ok && Array.isArray(fp.value) && fp.value.length) {
    list = fp.value.filter(s => typeof s === 'string' && /^[A-Z.]{1,6}$/.test(s)).slice(0, 12);
    if (!list.includes(symbol)) list.unshift(symbol);
    method = 'Finnhub peer group';
  } else if (self?.industry) {
    list = rows.filter(r => r.industry === self.industry && /^[A-Z]{1,5}$/.test(r.symbol)).sort((a, b) => (num(b.marketCap) || 0) - (num(a.marketCap) || 0)).slice(0, 10).map(r => r.symbol);
    if (!list.includes(symbol)) list.unshift(symbol);
    method = `Largest US-listed companies in Nasdaq industry “${self.industry}”, by market cap`;
  } else {
    return json({ symbol, peers: [], method: null, unavailable: [{ field: 'peers', reason: fp.ok ? 'No peer group for this symbol.' : `No Finnhub peers (${fp.reason}) and no Nasdaq industry classification for this symbol.` }], sources: [] }, 200, 3600);
  }
  // Valuation fields need Finnhub metrics per peer; otherwise only screener price data is shown.
  const metricsFor = await Promise.all(list.map(s => (fp.ok ? fh('stock/metric', { symbol: s, metric: 'all' }, env, 3600) : Promise.resolve({ ok: false }))));
  const out = list.map((s, i) => {
    const r = bySym.get(s); const mt = metricsFor[i].ok ? metricsFor[i].value?.metric || {} : {};
    const f = k => (Number.isFinite(mt[k]) ? mt[k] : null);
    return {
      symbol: s, name: cleanName(r?.name) || s, self: s === symbol,
      price: money(r?.lastsale), change: num(r?.netchange), changePercent: pctNum(r?.pctchange),
      marketCap: num(r?.marketCap) || (f('marketCapitalization') ? f('marketCapitalization') * 1e6 : null),
      volume: num(r?.volume), industry: r?.industry || null, country: r?.country || null,
      pe: f('peTTM') ?? f('peBasicExclExtraTTM'), ps: f('psTTM'), pb: f('pbQuarterly') ?? f('pbAnnual'),
      revenueGrowth: f('revenueGrowthTTMYoy'), netMargin: f('netProfitMarginTTM'), dividendYield: f('currentDividendYieldTTM') ?? f('dividendYieldIndicatedAnnual'), beta: f('beta'),
      week52Change: f('52WeekPriceReturnDaily')
    };
  });
  const notes = [];
  if (!fp.ok) notes.push(`Valuation columns (P/E, P/S, margins, beta) need Finnhub: ${fp.reason}`);
  if (screen.ok) notes.push('Prices from the Nasdaq screener snapshot (delayed, refreshed every few hours).');
  return json({ symbol, method, peers: out, notes, sources: ['Nasdaq', fp.ok && 'Finnhub'].filter(Boolean) }, 200, 900);
}

// ---------- segments (SEC XBRL) ----------
const SEG_AXES = {
  'us-gaap:StatementBusinessSegmentsAxis': 'Business segments',
  'srt:ProductOrServiceAxis': 'Products & services',
  'srt:StatementGeographicalAxis': 'Geography',
  'ifrs-full:SegmentsAxis': 'Business segments',
  'ifrs-full:ProductsAndServicesAxis': 'Products & services',
  'ifrs-full:GeographicalAreasAxis': 'Geography'
};
const REVENUE_CONCEPTS = new Set(['us-gaap:Revenues', 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'us-gaap:RevenueFromContractWithCustomerIncludingAssessedTax', 'us-gaap:SalesRevenueNet', 'ifrs-full:Revenue', 'ifrs-full:RevenueFromContractsWithCustomers']);
const IGNORABLE_MEMBERS = new Set(['us-gaap:OperatingSegmentsMember', 'srt:ConsolidationItemsAxis']);
const COUNTRIES = { US: 'United States', TW: 'Taiwan', CN: 'China', HK: 'Hong Kong', IL: 'Israel', JP: 'Japan', KR: 'South Korea', SG: 'Singapore', DE: 'Germany', GB: 'United Kingdom', NL: 'Netherlands', IE: 'Ireland', IN: 'India', CA: 'Canada', FR: 'France', CH: 'Switzerland', MX: 'Mexico', BR: 'Brazil', AU: 'Australia', MY: 'Malaysia', VN: 'Vietnam', PH: 'Philippines', TH: 'Thailand', IT: 'Italy', ES: 'Spain', SE: 'Sweden' };
export function memberLabel(member) {
  const [prefix, local = ''] = String(member).split(':');
  if (prefix === 'country') return COUNTRIES[local] || local;
  const words = local.replace(/(Segment)?Member$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
  return words.replace(/\b(And|Of|The|For|In|Including|Excluding|Other Than)\b/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase()).replace(/\bNon Us\b/i, 'Non-US').replace(/\bUs\b/, 'US') || member;
}
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

// Choose which tagged lines make up the total when a filer tags overlapping lines on one axis
// (e.g. Data Center and its Compute/Networking sub-lines, or Product/Service next to product lines).
// Picks the partition summing to the total with the fewest lines (at least 3 if possible); lines left
// over are attached as children of the line they add up to, or reported as `alsoTagged`.
function partition(items, total) {
  const n = Math.min(items.length, 16), tol = Math.abs(total) * 0.002;
  let best = null;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0, count = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { sum += items[i].value; count++; }
    if (Math.abs(sum - total) > tol) continue;
    const better = !best || (count >= 3 && (best.count < 3 || count < best.count)) || (best.count < 3 && count > best.count);
    if (better) best = { mask, count };
  }
  if (!best) return null;
  const chosen = items.filter((_, i) => i < n && best.mask & (1 << i));
  const rest = items.filter(x => !chosen.includes(x));
  const alsoTagged = [];
  const used = new Set();
  for (const parent of chosen) {
    const pool = rest.filter(x => !used.has(x) && Math.abs(x.value) < Math.abs(parent.value));
    const k = Math.min(pool.length, 12);
    for (let mask = 3; mask < 1 << k; mask++) {
      if ((mask & (mask - 1)) === 0) continue; // need 2+ children
      let sum = 0; for (let i = 0; i < k; i++) if (mask & (1 << i)) sum += pool[i].value;
      if (Math.abs(sum - parent.value) <= Math.abs(parent.value) * 0.002) {
        const kids = pool.filter((_, i) => mask & (1 << i)); kids.forEach(x => used.add(x));
        parent.children = kids.map(x => ({ label: x.label, value: x.value })); break;
      }
    }
  }
  for (const x of rest) if (!used.has(x)) alsoTagged.push({ label: x.label, value: x.value });
  return { items: chosen, alsoTagged };
}

// Label linkbase -> Map('prefix:LocalName' -> human label). Terse labels win over standard ones.
export function parseLabels(xml) {
  const out = new Map(), rank = new Map();
  for (const m of xml.matchAll(/<(?:link:)?label\b([^>]*)>([^<]*)<\/(?:link:)?label>/g)) {
    const key = m[1].match(/xlink:label="lab_([A-Za-z0-9-]+)_([A-Za-z0-9]+Member)"/);
    const role = m[1].match(/xlink:role="[^"]*\/(\w+)"/)?.[1];
    const r = role === 'terseLabel' ? 2 : role === 'label' ? 1 : 0;
    if (!key || !r) continue;
    const id = `${key[1]}:${key[2]}`;
    if ((rank.get(id) || 0) >= r) continue;
    const text = m[2].replace(/&amp;/g, '&').replace(/&#x2019;|&#8217;/g, '’').replace(/\s*\[Member\]\s*$/i, '').trim();
    if (text) { out.set(id, text); rank.set(id, r); }
  }
  return out;
}

// Parse an XBRL instance document (text) into revenue breakdowns per axis and period.
export function parseSegments(xml, labels = new Map()) {
  const units = new Map();
  for (const u of xml.matchAll(/<(?:xbrli:)?unit\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?unit>/g)) {
    const measure = u[2].match(/<(?:xbrli:)?measure>\s*iso4217:([A-Z]{3})\s*</);
    if (measure && !/divide/i.test(u[2])) units.set(u[1], measure[1]);
  }
  const contexts = new Map();
  const ctxRe = /<(?:xbrli:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:xbrli:)?context>/g;
  let m;
  while ((m = ctxRe.exec(xml))) {
    const body = m[2];
    const start = body.match(/<(?:xbrli:)?startDate>([^<]+)</)?.[1]?.trim();
    const end = body.match(/<(?:xbrli:)?endDate>([^<]+)</)?.[1]?.trim();
    const members = [...body.matchAll(/<xbrldi:explicitMember[^>]*dimension="([^"]+)"[^>]*>([^<]+)</g)].map(x => [x[1], x[2].trim()]);
    contexts.set(m[1], { start, end, members });
  }
  const totals = new Map(); // "start|end|CUR" -> value
  const groups = {};        // axis -> "start|end|CUR" -> member -> value
  const factRe = /<((?:us-gaap|ifrs-full):[A-Za-z]+)\b([^>]*)>([^<]*)</g;
  while ((m = factRe.exec(xml))) {
    if (!REVENUE_CONCEPTS.has(m[1])) continue;
    const ref = m[2].match(/contextRef="([^"]+)"/)?.[1];
    const cur = units.get(m[2].match(/unitRef="([^"]+)"/)?.[1]);
    const ctx = ref && contexts.get(ref);
    const val = Number(m[3].trim());
    if (!cur || !ctx?.start || !ctx.end || !Number.isFinite(val)) continue;
    const sign = /\bsign="-"/.test(m[2]) ? -1 : 1;
    const key = `${ctx.start}|${ctx.end}|${cur}`;
    const dims = ctx.members.filter(([axis, mem]) => !(axis === 'srt:ConsolidationItemsAxis' && IGNORABLE_MEMBERS.has(mem)));
    if (!dims.length) { if (!totals.has(key) || m[1].endsWith('Revenues')) totals.set(key, sign * val); continue; }
    if (dims.length !== 1 || !SEG_AXES[dims[0][0]]) continue;
    const [axis, member] = dims[0];
    groups[axis] ??= {}; groups[axis][key] ??= {};
    // Keep the first concept seen per member (filers repeat values across concepts).
    groups[axis][key][member] ??= sign * val;
  }
  const breakdowns = [];
  for (const [axis, byPeriod] of Object.entries(groups)) {
    const periods = Object.entries(byPeriod).map(([key, members]) => {
      const [start, end, currency] = key.split('|');
      let items = Object.entries(members).map(([member, value]) => ({ member, label: labels.get(member) || memberLabel(member), value })).sort((a, b) => b.value - a.value);
      const total = totals.get(key) ?? null;
      let alsoTagged = [];
      if (total && items.reduce((a, b) => a + b.value, 0) > total * 1.002) {
        const p = partition(items, total);
        if (p) ({ items, alsoTagged } = p);
      }
      const sum = items.reduce((a, b) => a + b.value, 0);
      return { start, end, currency, months: Math.round(days(start, end) / 30.4), total, sum, coverage: total ? sum / total : null, overlapping: total ? sum > total * 1.002 : false, items, alsoTagged };
    }).filter(p => p.items.length >= 2).sort((a, b) => b.end.localeCompare(a.end) || a.months - b.months);
    if (periods.length) breakdowns.push({ axis, title: SEG_AXES[axis], periods });
  }
  const order = ['Business segments', 'Products & services', 'Geography'];
  return breakdowns.sort((a, b) => order.indexOf(a.title) - order.indexOf(b.title));
}

const segCache = new Map();
async function getText(href, ttl) {
  const hit = segCache.get(href);
  if (hit && hit.expires > Date.now()) return hit.body;
  let res;
  try { res = await fetch(href, { headers: SEC_HEADERS, signal: AbortSignal.timeout(20000) }); } catch { throw new UpstreamError('provider_unavailable'); }
  if (res.status === 404) throw new UpstreamError('filing_unavailable', 404);
  if (res.status === 429 || res.status === 403) throw new UpstreamError('rate_limited', 429);
  if (!res.ok) throw new UpstreamError('provider_unavailable');
  const body = await res.text();
  if (segCache.size >= 16) segCache.delete(segCache.keys().next().value);
  segCache.set(href, { body, expires: Date.now() + ttl * 1000 });
  return body;
}

async function segments(symbol, url) {
  const period = url.searchParams.get('period') === 'quarterly' ? 'quarterly' : 'annual';
  const cik = await secCik(symbol);
  const none = reason => json({ symbol, period, breakdowns: [], unavailable: [{ field: 'segments', reason }], sources: ['SEC EDGAR'] }, 200, 3600);
  if (!cik) return none('No SEC filer is registered for this symbol (ETFs and many foreign listings do not file XBRL statements).');
  const sub = await secSubmissions(cik);
  const r = sub?.filings?.recent || {};
  const forms = period === 'quarterly' ? ['10-Q'] : ['10-K', '20-F', '40-F'];
  let idx = -1;
  for (let i = 0; i < (r.form || []).length; i++) if (forms.includes(r.form[i]) && r.isXBRL?.[i]) { idx = i; break; }
  if (idx < 0) return none(`No ${forms.join('/')} with XBRL data in recent SEC filings.`);
  const acc = r.accessionNumber[idx], doc = r.primaryDocument[idx];
  const base = `https://www.sec.gov/Archives/edgar/data/${+cik}/${acc.replace(/-/g, '')}/`;
  if (!r.isInlineXBRL?.[idx] || !/\.htm$/i.test(doc)) return none('This filing has no inline XBRL instance to read segment data from.');
  const [xml, lab] = await Promise.all([getText(base + doc.replace(/\.htm$/i, '_htm.xml'), 86400), settle(getText(base + doc.replace(/\.htm$/i, '_lab.xml'), 86400))]);
  const breakdowns = parseSegments(xml, lab.ok ? parseLabels(lab.value) : undefined);
  const filing = { form: r.form[idx], filed: r.filingDate[idx], reportDate: r.reportDate[idx], accession: acc, url: base + doc };
  if (!breakdowns.length) return json({ symbol, period, filing, breakdowns: [], unavailable: [{ field: 'segments', reason: `The latest ${filing.form} does not tag revenue by segment, product or geography in a way we can read.` }], sources: ['SEC EDGAR'] }, 200, 3600);
  return json({ symbol, period, currency: breakdowns[0]?.periods[0]?.currency || 'USD', filing, breakdowns, notes: [lab.ok ? 'Line names come from the filing’s XBRL labels.' : 'Line names are generated from XBRL tags (label file unavailable) and may differ from the filing’s wording.'], sources: ['SEC EDGAR (XBRL)'] }, 200, 3600);
}

// ---------- router ----------
export async function handle(request, env, ctx, url, rest) {
  const route = rest.replace(/\/+$/, '');
  if (route === 'search') return search(url, env);
  const routes = {
    quote: s => quote(s, env), profile: s => profile(s, env), metrics: s => metrics(s, url, env),
    financials: s => financials(s, url, env), analyst: s => analyst(s, env), peers: s => peers(s, env), segments: s => segments(s, url)
  };
  if (!routes[route]) return json({ error: 'Unknown company route.' }, 404);
  return routes[route](symbolParam(url));
}

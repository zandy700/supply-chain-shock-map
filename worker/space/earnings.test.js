import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceRoute } from './router.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import { money, timeCode, parseNextDate, financialRows, epsHistory, mergeFinnhub } from './earnings.js';

const KEY = 'fake-earnings-test-key';
const get = (path, env = {}) => spaceRoute(new Request('https://pulse.test/api/space/earnings/' + path), env, {});
function stub(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    calls.push(u);
    if (u.hostname === 'finnhub.io') { assert.equal(options.headers['X-Finnhub-Token'], KEY); assert.ok(!u.href.includes(KEY)); }
    return handler(u);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}
const ok = data => Response.json({ data, status: { rCode: 200 } });

test('number parsing handles Nasdaq formats', () => {
  assert.equal(money('$1.77'), 1.77);
  assert.equal(money('($0.44)'), -0.44);
  assert.equal(money('$49,364,394,000'), 49364394000);
  assert.equal(money('-3.56'), -3.56);
  assert.equal(money('N/A'), null);
  assert.equal(money(''), null);
  assert.equal(timeCode('time-pre-market'), 'BMO');
  assert.equal(timeCode('amc'), 'AMC');
  assert.equal(timeCode('time-not-supplied'), null);
});

test('calendar fetches one Nasdaq day per date, normalizes rows and counts per day', async () => {
  resetSpaceUpstreamForTests();
  const s = stub(u => {
    const date = u.searchParams.get('date');
    assert.equal(u.pathname, '/api/calendar/earnings');
    if (date === '2026-11-10') return ok({ rows: [{ symbol: 'AAA', name: 'Alpha', time: 'time-pre-market', eps: '$1.10', surprise: '10', epsForecast: '$1.00', marketCap: '$5,000,000', fiscalQuarterEnding: 'Sep/2026', noOfEsts: '3' }] });
    if (date === '2026-11-11') return ok({ rows: [
      { symbol: 'BBB', name: 'Beta', time: 'time-after-hours', epsForecast: '($0.20)', marketCap: '$9,000,000', noOfEsts: '2', lastYearRptDt: '11/12/2025', lastYearEPS: '($0.30)' },
      { symbol: 'bad symbol!', name: 'x' }
    ] });
    return ok({ rows: [] });
  });
  try {
    const body = await (await get('calendar?from=2026-11-10&to=2026-11-12')).json();
    assert.equal(s.calls.length, 3);
    assert.deepEqual(body.days.map(d => d.count), [1, 1, 0]);
    const [a, b] = body.rows;
    assert.deepEqual([a.symbol, a.time, a.epsEstimate, a.epsActual, a.surprisePct, a.marketCap, a.estimates], ['AAA', 'BMO', 1, 1.1, 10, 5000000, 3]);
    assert.deepEqual([b.symbol, b.time, b.epsEstimate, b.lastYearDate, b.lastYearEPS], ['BBB', 'AMC', -0.2, '2025-11-12', -0.3]);
    assert.deepEqual(body.sources, ['Nasdaq']);
    const only = await (await get('calendar?from=2026-11-10&to=2026-11-12&symbols=BBB')).json();
    assert.deepEqual(only.rows.map(r => r.symbol), ['BBB']);
  } finally { s.restore(); }
});

test('calendar merges Finnhub revenue and hour when keyed', async () => {
  resetSpaceUpstreamForTests();
  const s = stub(u => {
    if (u.hostname === 'finnhub.io') {
      assert.equal(u.pathname, '/api/v1/calendar/earnings');
      return Response.json({ earningsCalendar: [
        { symbol: 'AAA', date: '2026-11-10', hour: 'bmo', epsEstimate: 1, epsActual: 1.1, revenueEstimate: 2e9, revenueActual: 2.1e9, quarter: 3, year: 2026 },
        { symbol: 'ZZZ', date: '2026-11-10', hour: 'amc', epsEstimate: 0.5, epsActual: 0.4, revenueEstimate: null, revenueActual: null, quarter: 3, year: 2026 }
      ] });
    }
    return ok({ rows: u.searchParams.get('date') === '2026-11-10' ? [{ symbol: 'AAA', name: 'Alpha', time: 'time-not-supplied', epsForecast: '$1.00' }] : [] });
  });
  try {
    const body = await (await get('calendar?from=2026-11-10&to=2026-11-10', { FINNHUB_API_KEY: KEY })).json();
    const a = body.rows.find(r => r.symbol === 'AAA'), z = body.rows.find(r => r.symbol === 'ZZZ');
    assert.deepEqual([a.time, a.revenueEstimate, a.revenueActual, a.sources.join('+')], ['BMO', 2e9, 2.1e9, 'Nasdaq+Finnhub']);
    assert.deepEqual([z.time, z.surprisePct, z.fiscalQuarter], ['AMC', -20, 'Q3 FY2026']);
    assert.deepEqual(body.sources, ['Nasdaq', 'Finnhub']);
    assert.ok(!JSON.stringify(body).includes(KEY));
  } finally { s.restore(); }
});

test('calendar validation and total failure', async () => {
  resetSpaceUpstreamForTests();
  assert.equal((await get('calendar?from=2026-13-01&to=2026-13-02')).status, 400);
  assert.equal((await get('calendar?from=2026-11-10&to=2026-11-01')).status, 400);
  assert.equal((await get('calendar?from=2026-01-01&to=2026-03-01')).status, 400);
  assert.equal((await get('calendar?from=2026-11-10&to=2026-11-10&symbols=bad!')).status, 400);
  const s = stub(() => new Response('down', { status: 500 }));
  try {
    const res = await get('calendar?from=2026-11-10&to=2026-11-11');
    assert.equal(res.status, 502);
  } finally { s.restore(); }
});

test('parseNextDate reads the Nasdaq/Zacks report text', () => {
  const t = "NVIDIA Corporation Common Stock is expected* to report earnings on  11/17/2026 after market close.  The report will be for the fiscal Quarter ending Oct 2026.  According to Zacks Investment Research, based on  13 analysts'  forecasts, the consensus EPS forecast for the quarter is $2.49.  The reported EPS for the same quarter last year was $1.24.";
  assert.deepEqual(parseNextDate(t), { date: '2026-11-17', time: 'AMC', fiscalQuarter: 'Oct 2026', epsEstimate: 2.49, estimates: 13, lastYearEPS: 1.24, estimated: true });
  assert.equal(parseNextDate('no date here'), null);
  assert.equal(parseNextDate('on 02/30/2026'), null);
});

test('financialRows converts thousands and orders oldest first; epsHistory merges sources', () => {
  const rows = financialRows({ headers: { value1: 'Quarterly Ending:', value2: '7/26/2026', value3: '4/26/2026' }, rows: [
    { value1: 'Total Revenue', value2: '$96,222,000', value3: '$81,615,000' }, { value1: 'Net Income', value2: '$50,000', value3: '($1,000)' }] });
  assert.deepEqual(rows, [{ period: '2026-04-26', revenue: 81615000000, netIncome: -1000000 }, { period: '2026-07-26', revenue: 96222000000, netIncome: 50000000 }]);
  const eps = epsHistory(
    { earningsPerShare: [{ type: 'PreviousQuarter', period: 'Jul 2026', consensus: 2.09, earnings: 2.22 }, { type: 'UpcomingQuarter', period: 'Oct 2026', consensus: 2.49, earnings: 0 }] },
    { earningsSurpriseTable: { rows: [{ fiscalQtrEnd: 'Jul 2026', dateReported: '8/26/2026', eps: 2.22, consensusForecast: '2.09', percentageSurprise: '6.22' }] } },
    [{ period: '2026-04-30', actual: 1.87, estimate: 1.7, surprisePercent: 10.0001 }]
  );
  assert.deepEqual(eps.map(e => [e.period, e.actual, e.estimate, e.surprisePct, e.upcoming]), [['Apr 2026', 1.87, 1.7, 10, false], ['Jul 2026', 2.22, 2.09, 6.22, false], ['Oct 2026', null, 2.49, null, true]]);
  assert.equal(eps[1].reported, '2026-08-26');
});

test('mergeFinnhub does not overwrite Nasdaq values', () => {
  const rows = [{ symbol: 'A', date: '2026-11-10', time: 'BMO', epsEstimate: 1, epsActual: null, surprisePct: null, revenueEstimate: null, revenueActual: null, fiscalQuarter: 'Sep/2026', sources: ['Nasdaq'] }];
  mergeFinnhub(rows, [{ symbol: 'A', date: '2026-11-10', hour: 'amc', epsEstimate: 9, epsActual: 1.5, revenueEstimate: 5 }]);
  assert.deepEqual([rows[0].time, rows[0].epsEstimate, rows[0].epsActual, rows[0].surprisePct, rows[0].revenueEstimate, rows[0].fiscalQuarter], ['BMO', 1, 1.5, 50, 5, 'Sep/2026']);
});

test('detail combines Nasdaq endpoints, relationships and tolerates partial failure', async () => {
  resetSpaceUpstreamForTests();
  const s = stub(u => {
    const p = u.pathname;
    if (p === '/api/analyst/NVDA/earnings-date') return ok({ reportText: 'NVIDIA is expected* to report earnings on 12/17/2099 before market open. The report will be for the fiscal Quarter ending Oct 2099. based on 5 analysts forecasts, the consensus EPS forecast for the quarter is $2.49.' });
    if (p === '/api/quote/NVDA/eps') return ok({ earningsPerShare: [{ type: 'PreviousQuarter', period: 'Jul 2026', consensus: 2.09, earnings: 2.22 }] });
    if (p === '/api/company/NVDA/earnings-surprise') return new Response('x', { status: 500 });
    if (p === '/api/analyst/NVDA/earnings-forecast') return ok({ quarterlyForecast: { rows: [{ fiscalEnd: 'Oct 2026', consensusEPSForecast: 2.49, highEPSForecast: 2.7, lowEPSForecast: 2.34, noOfEstimates: 13, up: 1, down: 0 }] }, yearlyForecast: { rows: [] } });
    if (p === '/api/analyst/NVDA/estimate-momentum') return ok({ changeInConsensus: { currentData: { qtrMean: '2.49', yrMean: '9.3' }, weekData: { qtrMean: 2.48, yrMean: 9.3 }, monthData: { qtrMean: 2.4, yrMean: 9.29 }, fiscalQtrEndText: 'Q', fiscalYearEndText: 'Y' }, estimatesChanged: { quarterDataUp: { changeValue: '1' }, quarterDataDown: { changeValue: 0 } } });
    if (p === '/api/company/NVDA/financials') return ok({ incomeStatementTable: { headers: { value1: 'x', value2: '7/26/2026' }, rows: [{ value1: 'Total Revenue', value2: '$1,000' }] } });
    if (/\/api\/analyst\/[A-Z]+\/earnings-date/.test(p)) return ok({ reportText: 'expected* to report earnings on 01/28/2099 after market close.' });
    throw new Error('unexpected ' + p);
  });
  try {
    const res = await get('detail?symbol=nvda');
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.deepEqual([d.next.date, d.next.time, d.next.epsEstimate, d.next.estimates], ['2099-12-17', 'BMO', 2.49, 5]);
    assert.equal(d.eps.length, 1);
    assert.equal(d.forecast.quarterly[0].analysts, 13);
    assert.equal(d.momentum.quarter.weekAgo, 2.48);
    assert.deepEqual([d.momentum.quarter.current, d.momentum.year.current, d.momentum.quarter.up], [2.49, 9.3, 1]);
    assert.deepEqual(d.financials.quarterly, [{ period: '2026-07-26', revenue: 1000000, netIncome: null }]);
    assert.ok(d.related.some(r => r.symbol === 'META' && r.next.date === '2099-01-28' && r.links[0].kind === 'AI infrastructure'));
    assert.deepEqual(d.errors, [{ part: 'surprise', code: 'provider_unavailable' }]);
  } finally { s.restore(); }
  assert.equal((await get('detail?symbol=%5EGSPC')).status, 400);
  assert.equal((await get('detail?symbol=bad!')).status, 400);
});

test('economic calendar reuses calendar.js published market events within the range', async () => {
  const s = stub(() => { throw new Error('economic calendar must not call providers'); });
  try {
    const d = await (await get('economic?from=2026-11-01&to=2026-12-31')).json();
    assert.deepEqual(d.events.map(e => [e.date, e.kind]), [['2026-11-10', 'inflation'], ['2026-12-09', 'rates'], ['2026-12-10', 'inflation']]);
    assert.ok(d.events.every(e => e.url.startsWith('https://')));
    assert.ok(!d.events.some(e => /NVIDIA|Applied/.test(e.title)));
  } finally { s.restore(); }
  assert.equal((await get('economic?from=2026-11-01&to=2026-10-01')).status, 400);
});

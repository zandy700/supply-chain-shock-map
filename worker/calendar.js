import {earningsConnections} from './earnings-links.js';

// Published schedules are date-specific. Never extrapolate a missing release.
const cpi = {
  title: 'Consumer Price Index', source: 'Bureau of Labor Statistics',
  url: 'https://www.bls.gov/schedule/news_release/cpi.htm', detail: 'Inflation can change expectations for interest rates and borrowing costs.',
  timing: '8:30 a.m. ET', status: 'Scheduled'
};
const fed = {
  title: 'Fed policy meeting concludes', source: 'Federal Reserve',
  url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', detail: 'Investors watch the rate decision and what the Fed says about future policy.',
  timing: '', status: 'Published meeting date'
};
const asml = {
  ticker: 'ASML', title: 'ASML quarterly results', source: 'ASML Investor Relations',
  url: 'https://www.investor.asml.com/', detail: 'Orders and sales guidance give investors a read on chipmakers’ equipment spending.',
  timing: '', status: 'Company-announced'
};
const published = [
  ...['2026-11-10','2026-12-10'].map(date => ({...cpi, date})),
  ...['2026-12-09','2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-12-08'].map(date => ({...fed, date})),
  ...['2027-01-27','2027-04-28'].map(date => ({...asml, date})),
  {date:'2026-11-12', ticker:'AMAT', title:'Applied Materials earnings call', source:'Applied Materials Investor Relations',
    url:'https://ir.appliedmaterials.com/news-releases/news-release-details/applied-materials-report-fourth-quarter-and-fiscal-2026-results',
    detail:'Management will discuss its fourth-quarter and full-year results.', timing:'4:30 p.m. ET', status:'Company-announced'},
  {date:'2026-11-17', ticker:'NVDA', title:'NVIDIA earnings call', source:'NVIDIA Investor Relations',
    url:'https://investor.nvidia.com/news/press-release-details/2026/NVIDIA-Sets-Conference-Call-for-Third-Quarter-Financial-Results/default.aspx',
    detail:'Management will discuss quarterly results and take analyst questions.', timing:'5:00 p.m. ET', status:'Company-announced'}
];

async function nextEarnings(ticker) {
  const response = await fetch('https://api.nasdaq.com/api/analyst/' + ticker + '/earnings-date', {
    headers: {Accept:'application/json'}, signal:AbortSignal.timeout(10000),
    cf: {cacheEverything:true, cacheTtlByStatus:{'200-299':3600, '400-599':0}}
  });
  if (!response.ok) throw new Error('Earnings lookup unavailable');
  const payload = await response.json();
  if (payload.status?.rCode !== 200) throw new Error('Earnings lookup unavailable');
  const report = payload.data?.reportText || '';
  const match = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(report);
  if (!match) return null;
  const date = match[3] + '-' + match[1] + '-' + match[2];
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) return null;
  const timing = report.match(/before market open|after market close/i)?.[0] || '';
  return {date, ticker, timing, title:ticker + ' earnings', status:'Estimated', source:'Nasdaq / Zacks',
    url:'https://www.nasdaq.com/market-activity/stocks/' + ticker.toLowerCase() + '/earnings',
    detail:'Results and guidance can change expectations for sales and profits.'};
}

export async function calendar(tickers, now = new Date(), getPeers) {
  const from = new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'}).format(now);
  const end = new Date(from);
  end.setUTCMonth(end.getUTCMonth() + 3, 0);
  const to = end.toISOString().slice(0,10);
  const inside = event => event.date >= from && event.date <= to;
  const {byReporter, peerErrors} = await earningsConnections(tickers, getPeers);
  const reporting = [...new Set([...tickers, ...byReporter.keys()])];
  const events = published.filter(event => inside(event) && (!event.ticker || reporting.includes(event.ticker)));
  const remaining = reporting.filter(ticker => !events.some(event => event.ticker === ticker));
  const results = await Promise.allSettled(remaining.map(nextEarnings));
  const unavailable = [], unlisted = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') unavailable.push(remaining[i]);
    else if (result.value && inside(result.value)) events.push(result.value);
    else unlisted.push(remaining[i]);
  });
  events.sort((a,b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const annotated = events.map(event => ({
    ...event, scope: !event.ticker ? 'market' : tickers.includes(event.ticker) ? 'watchlist' : 'related',
    connections: byReporter.get(event.ticker) || []
  }));
  return {from,to,events:annotated,unavailable,unlisted,peerErrors};
}

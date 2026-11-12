import test from 'node:test';
import assert from 'node:assert/strict';
import { getPanel } from '../../web/space/core.js';
import { displayFinancial, financialColumns, financialGrowth } from '../../web/space/panels/company.js';
import { handle as companyRoute, rollingFinancials } from './company.js';
import { resetSpaceUpstreamForTests } from './upstream.js';

// Panels only require this small DOM surface; provider bodies remain explicit fixtures.
function element() {
  const handlers = new Map();
  return { innerHTML: '', classList: { add() {} }, addEventListener(k, fn) { handlers.set(k, fn); }, removeEventListener(k) { handlers.delete(k); },
    fire(k, target) { handlers.get(k)?.({ target, key: 'Enter', preventDefault() {} }); }, handlers };
}
const tick = () => new Promise(r => setImmediate(r));

test('quote separates the source trade timestamp from the server check and preserves unknown time', async () => {
  const original = globalThis.fetch;
  try {
    for (const timestamp of ['Nov 11, 2026 4:00 PM ET', null]) {
      resetSpaceUpstreamForTests();
      globalThis.fetch = async raw => Response.json({ status: { rCode: 200 }, data: String(raw).includes('/info?') ? { primaryData: { lastSalePrice: '$0', lastTradeTimestamp: timestamp } } : {} });
      const url = new URL('https://pulse.test/api/space/company/quote?symbol=NVDA');
      const data = await (await companyRoute(new Request(url), {}, {}, url, 'quote')).json();
      assert.equal(data.asOf, timestamp);
      assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
      assert.equal(data.price, 0);
    }
  } finally { globalThis.fetch = original; resetSpaceUpstreamForTests(); }
});
function setup(t, reply, type, initial = {}) {
  const original = globalThis.fetch, oldLocation = globalThis.location;
  globalThis.location = { origin: 'https://pulse.test' };
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push(new URL(url)); return reply(new URL(url), init); };
  t.after(() => { globalThis.fetch = original; globalThis.location = oldLocation; });
  const el = element(), saved = [], selected = [];
  const instance = getPanel(type).mount(el, { symbol: 'NVDA', state: initial, setState(v) { saved.push({ ...v }); }, setSubtitle() {}, openSymbol(s) { selected.push(s); } });
  t.after(() => instance.destroy());
  return { el, instance, calls, saved, selected };
}

test('quote retains missing values and escapes provider content', async t => {
  const { el, instance } = setup(t, () => Response.json({ symbol: 'NVDA', name: '<img src=x onerror=alert(1)>', price: 0, change: null, changePercent: null, sources: ['Nasdaq'], currency: 'USD', delayed: true }), 'quote');
  await tick();
  assert.match(el.innerHTML, /&lt;img/);
  assert.doesNotMatch(el.innerHTML, /<img/);
  assert.match(el.innerHTML, /\$0\.0000/);
  assert.match(el.innerHTML, /Previous close<\/dt><dd>—/);
  assert.match(el.innerHTML, /Delayed quote/);
  assert.match(instance.csv(), /price,0/);
});

test('fundamentals switches statement and quarterly frequency with persisted state', async t => {
  const { el, calls, saved, instance } = setup(t, () => Response.json({ columns: [{ label: '2026' }], rows: [{ label: 'Revenue', unit: 'usd', values: [1230000] }], currency: 'USD' }), 'fundamentals');
  await tick();
  el.fire('click', { closest: selector => selector === '[data-key][data-value]' ? { dataset: { key: 'statement', value: 'income' } } : null });
  await tick();
  el.fire('change', { dataset: { key: 'period' }, value: 'quarterly' });
  await tick();
  assert.equal(calls.at(-1).pathname, '/api/space/company/financials');
  assert.equal(calls.at(-1).searchParams.get('period'), 'quarterly');
  assert.equal(saved.at(-1).statement, 'income');
  assert.match(el.innerHTML, /\$1\.23M/);
  assert.match(instance.csv(), /1230000,,Revenue,usd,false/);
});

test('analyst tabs use current response without unnecessary fetch and handle unavailable actions', async t => {
  const { el, calls } = setup(t, () => Response.json({ covered: true, consensus: 'Buy', distribution: { total: 10, buckets: [{ label: 'Buy', count: 10, percent: 100 }] }, actions: [], actionsNote: 'No recent actions.' }), 'analyst');
  await tick();
  assert.match(el.innerHTML, /10 analyst ratings/);
  el.fire('click', { closest: s => s === '[data-key][data-value]' ? { dataset: { key: 'tab', value: 'actions' } } : null });
  assert.equal(calls.length, 1);
  assert.match(el.innerHTML, /No recent actions/);
});

test('profile blocks unsafe website protocols', async t => {
  const { el } = setup(t, () => Response.json({ name: 'Test', website: 'javascript:alert(1)' }), 'profile');
  await tick();
  assert.doesNotMatch(el.innerHTML, /href=/);
  assert.match(el.innerHTML, /Website<\/dt><dd>—/);
});

test('peers navigate through linked symbols by keyboard', async t => {
  const { el, selected } = setup(t, () => Response.json({ peers: [{ symbol: 'AMD', name: 'AMD', price: null, changePercent: null }] }), 'peers');
  await tick();
  el.fire('keydown', { closest: () => ({ dataset: { symbol: 'AMD' } }) });
  assert.deepEqual(selected, ['AMD']);
  assert.match(el.innerHTML, /tabindex="0"/);
  assert.match(el.innerHTML, /class="s-num">—/);
});

test('segments disclose overlapping tags and link the source filing safely', async t => {
  const { el, instance } = setup(t, () => Response.json({ breakdowns: [{ title: 'Geography', periods: [{ start: '2025-01-01', end: '2025-12-31', total: 100, sum: 120, overlapping: true, currency: 'USD', items: [{ label: 'US', value: 70 }, { label: 'Other', value: 50 }] }] }], filing: { url: 'https://sec.gov/filing', form: '10-K' } }), 'segments');
  await tick();
  assert.match(el.innerHTML, /Tags overlap/);
  assert.match(el.innerHTML, /https:\/\/sec.gov\/filing/);
  assert.match(instance.csv(), /US,70/);
});

test('symbol changes discard stale responses; destroy releases handlers', async t => {
  let resolveFirst;
  const { el, instance } = setup(t, url => url.searchParams.get('symbol') === 'NVDA' ? new Promise(r => { resolveFirst = r; }) : Response.json({ name: 'AMD', price: 12 }), 'quote');
  instance.onSymbol('AMD'); await tick();
  resolveFirst(Response.json({ name: 'NVDA', price: 999 })); await tick();
  assert.match(el.innerHTML, /AMD/);
  assert.doesNotMatch(el.innerHTML, /NVDA/);
  instance.destroy(); assert.equal(el.handlers.size, 0);
});

test('failed responses show retry and successful retry replaces error', async t => {
  let count = 0;
  const { el } = setup(t, () => ++count === 1 ? Response.json({ error: 'provider_unavailable' }, { status: 502 }) : Response.json({ name: 'Recovered', price: 1 }), 'quote');
  await tick(); assert.match(el.innerHTML, /data-retry/);
  el.fire('click', { closest: s => s === '[data-retry]' ? {} : null });
  await tick(); assert.match(el.innerHTML, /Recovered/);
});


test('financial units scale monetary values while keeping EPS and ratios unscaled', () => {
  assert.equal(displayFinancial(1200000, 'usd', 'MM'), '$1.20 MM');
  assert.equal(displayFinancial(1200000, 'usd', 'K'), '$1,200.00 K');
  assert.equal(displayFinancial(0, 'usd', 'B'), '$0.00 B');
  assert.equal(displayFinancial(null, 'usd', 'K'), '—');
  assert.equal(displayFinancial(2, 'perShare', 'MM'), '$2.00');
  assert.equal(displayFinancial(20, 'percent', 'B'), '20.00%');
  assert.equal(displayFinancial(3, 'multiple', 'K'), '3.00×');
});
test('fiscal date order keeps current/TTM first and preserves value indices', () => {
  const d = { columns: [{id:'2025-12-31',label:'2025',end:'2025-12-31'}, {id:'ttm',label:'TTM'}, {id:'2026-12-31',label:'2026',end:'2026-12-31'}] };
  assert.deepEqual(financialColumns(d).map(c => c.index), [1, 2, 0]);
  assert.deepEqual(financialColumns(d, 'oldest').map(c => c.index), [1, 0, 2]);
});
test('integrated segment tab and reporting selector use chosen period without new requests', async t => {
  const body = {symbol:'NVDA',breakdowns:[{title:'Geography',periods:[{start:'2025-01-01',end:'2025-12-31',sum:100,items:[{label:'US',value:100}]},{start:'2024-01-01',end:'2024-12-31',sum:80,items:[{label:'US',value:80}]}]}]};
  const {el,calls,instance}=setup(t,()=>Response.json(body),'fundamentals',{statement:'segments'});
  await tick(); assert.match(el.innerHTML,/Segment reporting period/);
  el.fire('change',{dataset:{key:'reporting'},value:'1'});
  assert.equal(calls.length,1); assert.match(el.innerHTML,/2024-12-31/);
  el.fire('change',{dataset:{key:'units'},value:'K'});
  assert.match(el.innerHTML,/\$0.08 K/); assert.match(instance.csv(),/US/);
});
test('comparison responses align each company fiscal columns; missing comparator remains explicit', async t => {
  const {el,calls}=setup(t,url=>url.searchParams.get('symbol')==='BAD' ? Response.json({error:'unknown_symbol'},{status:404}) : Response.json({symbol:url.searchParams.get('symbol'),columns:[{id:'2026-01-01',label:'2026-01-01'}],sections:[{section:'Operational',rows:[{label:'Revenue',unit:'usd',values:[100]}]}]}),'fundamentals',{compare:'AMD BAD',statement:'operating'});
  await tick(); await tick();
  assert.equal(calls.length,3); assert.match(el.innerHTML,/AMD/);assert.match(el.innerHTML,/BAD: Comparison data unavailable/);assert.match(el.innerHTML,/colgroup/);
});

test('quote refreshes while mounted, retains last good data on failure and stops after destroy', async t => {
  const originalTimer=globalThis.setTimeout, originalCancel=globalThis.clearTimeout;
  const timers=[];globalThis.setTimeout=(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;};globalThis.clearTimeout=()=>{};
  t.after(()=>{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalCancel;});
  let count=0;
  const {el,instance,calls}=setup(t,()=>++count===2?Response.json({error:'provider_unavailable'},{status:502}):Response.json({name:'Refresh fixture',price:100+count}),'quote');
  await tick();assert.match(el.innerHTML,/\$101\.00/);assert.equal(timers.at(-1).ms,30000);
  timers.at(-1).fn();await tick();assert.equal(calls.length,2);assert.match(el.innerHTML,/\$101\.00/);
  timers.at(-1).fn();await tick();assert.equal(calls.length,3);assert.match(el.innerHTML,/\$103\.00/);
  instance.destroy();timers.at(-1).fn();await tick();assert.equal(calls.length,3);
});

test('timed-out company refresh cannot commit a late response and the next refresh recovers', async t => {
  const originalTimer=globalThis.setTimeout,originalCancel=globalThis.clearTimeout;
  const timers=[];globalThis.setTimeout=(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;};globalThis.clearTimeout=()=>{};
  t.after(()=>{globalThis.setTimeout=originalTimer;globalThis.clearTimeout=originalCancel;});
  let count=0,late;
  const {instance,calls}=setup(t,()=>++count===2?new Promise(resolve=>{late=resolve;}):Response.json({name:'Timeout fixture',price:100+count}),'quote');
  await tick();timers.filter(x=>x.ms===30000).at(-1).fn();await tick();assert.equal(calls.length,2);
  timers.filter(x=>x.ms===45000).at(-1).fn();await tick();
  late(Response.json({name:'Late response',price:999}));await tick();assert.match(instance.csv(),/price,101/);assert.doesNotMatch(instance.csv(),/999/);
  timers.at(-1).fn();await tick();assert.equal(calls.length,3);assert.match(instance.csv(),/price,103/);
});

test('initial company request has its own deadline and can retry after a hang', async t => {
  const oldTimeout=AbortSignal.timeout,deadlines=[];
  AbortSignal.timeout=()=>{const c=new AbortController();deadlines.push(c);return c.signal;};
  t.after(()=>{AbortSignal.timeout=oldTimeout;});
  let count=0;
  const {el,calls}=setup(t,(_url,init)=>++count===1?new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})):Response.json({name:'After timeout',price:23}),'quote');
  await tick();assert.equal(calls.length,1);
  deadlines[0].abort(new DOMException('Request timed out','TimeoutError'));await tick();
  assert.match(el.innerHTML,/request timed out/);assert.match(el.innerHTML,/data-retry/);
  el.fire('click',{closest:s=>s==='[data-retry]'?{}:null});await tick();
  assert.equal(calls.length,2);assert.match(el.innerHTML,/\$23\.00/);
});

test('LTM rolls four consecutive quarters and refuses gaps, missing values and YTD filings', () => {
  const periods = ['2026-12-31','2026-09-30','2026-06-30','2026-03-31','2025-12-31','2025-09-30'].map(end=>({end}));
  const input = {periods,values:{revenue:[60,50,40,30,20,10],missing:[null,5,4,3,2,1]}};
  const result = rollingFinancials(input,'income');
  assert.deepEqual(result.values.revenue,[180,140,100]);
  assert.deepEqual(result.values.missing,[null,14,10]);
  assert.deepEqual(result.periods.map(p=>p.end),periods.slice(0,3).map(p=>p.end));
  assert.equal(input.values.revenue[0],60);
  assert.equal(rollingFinancials({...input,periods:periods.slice(0,3)},'income').periods.length,0);
  assert.equal(rollingFinancials({periods:[periods[0],periods[2],periods[3],periods[4]],values:input.values},'income').periods.length,0);
  assert.equal(rollingFinancials({periods:periods.slice(0,4).map(p=>({...p,start:'2026-01-01'})),values:input.values},'cashflow').periods.length,0);
  assert.deepEqual(rollingFinancials(input,'balance').values.revenue,[60,50,40]);
});
test('financial YoY matches fiscal dates regardless of order and leaves unknown/zero bases blank', () => {
  const d = {columns:[{id:'ttm',end:'2026-12-31'},{id:'2025-12-31',end:'2025-12-31'},{id:'2026-12-31',end:'2026-12-31'}]};
  const cols = financialColumns(d,'oldest');
  assert.equal(financialGrowth({values:[900,100,125]},cols,cols.find(c=>c.id==='2026-12-31')),25);
  assert.equal(financialGrowth({values:[900,0,125]},cols,cols.find(c=>c.id==='2026-12-31')),null);
  assert.equal(financialGrowth({values:[900,100,125]},cols,cols.find(c=>c.id==='ttm')),null);
  assert.equal(financialGrowth({values:[900,-100,-50]},cols,cols.find(c=>c.id==='2026-12-31')),50);
});
test('fundamentals metric rows expand YoY without refetch and LTM is sent to the API', async t => {
  const {el,calls,saved} = setup(t,()=>Response.json({symbol:'NVDA',columns:[{id:'2026',label:'2026',end:'2026-12-31'},{id:'2025',label:'2025',end:'2025-12-31'}],rows:[{key:'revenue',label:'Total Revenue',unit:'usd',values:[125,100]}]}),'fundamentals',{statement:'income'});
  await tick(); assert.match(el.innerHTML,/LTM \(rolling 12 months\)/);
  el.fire('click',{closest:selector=>selector==='[data-company-metric]'?{dataset:{companyMetric:'revenue'}}:null});
  assert.equal(calls.length,1); assert.match(el.innerHTML,/% Change YoY/); assert.match(el.innerHTML,/25\.00%/); assert.deepEqual(saved.at(-1).expandedRows,['revenue']);
  el.fire('change',{dataset:{key:'period'},value:'ltm'}); await tick();
  assert.equal(calls.at(-1).searchParams.get('period'),'ltm');
  el.fire('click',{closest:selector=>selector==='[data-key][data-value]'?{dataset:{key:'statement',value:'balance'}}:null}); await tick();
  assert.equal(calls.at(-1).searchParams.get('period'),'quarterly');
});

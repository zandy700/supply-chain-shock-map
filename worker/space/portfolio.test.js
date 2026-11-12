import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioSelection, snapshotAccounts, portfolioDisplayRows, portfolioSectorAllocation } from '../../web/space/panels/portfolio.js';
import { holdingMovers } from '../../web/space/panels/portfolio-workflows.js';
const account = (id, ticker = 'AAPL') => ({ id, name: id, cash: 10, holdings:[{ticker,shares:2,cost:5}],history:[{date:'2026-11-10',value:25}] });
const prices = {AAPL:{price:10,previous:9}};

test('portfolio source and selection isolate manual/linked accounts and broker fallback quotes', () => {
  const manual = account('same');
  const linked = {...account('same'),prices:{AAPL:{price:20}},complete:true};
  const data = {manual:[manual],broker:{accounts:[linked]},prices:{}};
  assert.equal(portfolioSelection(data,'manual','same').totals.value,null);
  assert.equal(portfolioSelection(data,'linked','same').totals.value,50);
  assert.equal(portfolioSelection({...data,prices},'manual','same').totals.value,30);
  const selected = portfolioSelection({...data,manual:[manual,account('other','MSFT')],prices},'manual','same');
  assert.equal(selected.accounts.length,1);assert.equal(selected.totals.value,30);
  assert.equal(portfolioSelection(data,'manual','gone').selected,'');
});
test('incomplete linked accounts hide every aggregate including cash but preserve supported rows', () => {
  const good = {...account('good'),complete:true};
  const partial = {...account('partial'),complete:false};
  const data = {manual:[],broker:{accounts:[good,partial]},prices};
  const combined = portfolioSelection(data,'linked','');
  for (const key of ['value','cash','dayChange','dayPercent','gain','gainPercent']) assert.equal(combined.totals[key],null);
  assert.equal(combined.totals.rows[0].value,40);
  assert.equal(portfolioSelection(data,'linked','good').totals.value,30);
  assert.equal(portfolioSelection(data,'linked','good').incomplete,false);
});
test('snapshots affect only selected manual accounts and replace the same calendar date', () => {
  const first = account('a'), second = account('b','MSFT');
  const current = [first,second];
  const saved = snapshotAccounts(current,current,[first],prices,'2026-11-10');
  assert.deepEqual(saved[0].history,[{date:'2026-11-10',value:30}]);
  assert.equal(saved[1],second);
  assert.equal(first.history[0].value,25);
});
test('snapshot rejects stale holdings and incomplete prices instead of recording partial totals', () => {
  const a = account('a');
  assert.throws(()=>snapshotAccounts([{...a,cash:99}],[a],[a],prices,'2026-11-11'),/changed/);
  assert.throws(()=>snapshotAccounts([a],[a],[a],{},'2026-11-11'),/complete price/);
  const missingPrior = portfolioSelection({manual:[a],broker:{accounts:[]},prices:{AAPL:{price:10}}},'manual','a');
  assert.equal(missingPrior.totals.value,30);assert.equal(missingPrior.totals.dayChange,null);
});

test('holdings columns derive weighted basis, cash-inclusive weights and day versus total returns', () => {
  const accounts=[{...account('a'),cash:30},{...account('b'),cash:0,holdings:[{ticker:'AAPL',shares:3,cost:10}]}];
  const quotes={AAPL:{price:12,previous:10,companyName:'Apple Inc.'}};
  const selection=portfolioSelection({manual:accounts,broker:{accounts:[]},prices:quotes},'manual','');
  const [row]=portfolioDisplayRows(accounts,quotes,selection.totals);
  assert.equal(row.shares,5);assert.equal(row.cost,8);assert.equal(row.costBasis,40);
  assert.equal(row.value,60);assert.equal(row.weight,100*60/90);
  assert.equal(row.dayChange,10);assert.equal(row.dayPercent,20);assert.equal(row.dayGainPercent,20);
  assert.equal(row.gain,20);assert.equal(row.gainPercent,50);assert.equal(row.name,'Apple Inc.');
});

test('unavailable holdings columns stay unknown, zero basis does not create infinite returns', () => {
  const accounts=[{...account('a'),cash:0,complete:false,holdings:[{ticker:'AAPL',shares:2,cost:0},{ticker:'MSFT',shares:1,cost:null}]}];
  const quotes={AAPL:{price:10},MSFT:{price:20,previous:20}};
  const selection=portfolioSelection({manual:[],broker:{accounts},prices:quotes},'linked','');
  const [free,unknown]=portfolioDisplayRows(accounts,quotes,selection.totals);
  assert.equal(free.costBasis,0);assert.equal(free.gainPercent,null);assert.equal(free.dayPercent,null);
  assert.equal(free.weight,null);assert.equal(free.name,null);
  assert.equal(unknown.costBasis,null);assert.equal(unknown.gainPercent,null);assert.equal(unknown.dayPercent,0);
});

test('derived holdings sort numerically in both directions with unavailable entries last', () => {
  const rows=portfolioDisplayRows([],{}, {value:100,rows:[
    {ticker:'LOSS',shares:1,cost:20,value:10,dayChange:-2,gain:-10},
    {ticker:'GAIN',shares:1,cost:10,value:20,dayChange:2,gain:10},
    {ticker:'UNKNOWN',shares:1,cost:null,value:null,dayChange:null,gain:null}
  ]});
  assert.deepEqual(holdingMovers(rows,'asc','gainPercent').map(r=>r.ticker),['LOSS','GAIN','UNKNOWN']);
  assert.deepEqual(holdingMovers(rows,'desc','costBasis').map(r=>r.ticker),['LOSS','GAIN','UNKNOWN']);
});

test('sector allocation preserves source coverage and never guesses missing classifications', () => {
  const rows=[{ticker:'AAPL',value:60},{ticker:'MSFT',value:20},{ticker:'OTHER',value:20}];
  const result=portfolioSectorAllocation(rows,{AAPL:{sector:'Technology'},MSFT:{sector:'Technology'}});
  assert.equal(result.complete,true);assert.equal(result.coverage,.8);
  assert.deepEqual(result.rows,[{name:'Technology',value:80,weight:80},{name:'Sector not supplied',value:20,weight:20}]);
  assert.equal(portfolioSectorAllocation(rows,{}).coverage,0);
  assert.deepEqual(portfolioSectorAllocation([{ticker:'AAPL',value:null}],{}),{complete:false,rows:[],coverage:null});
  assert.equal(portfolioSectorAllocation([],{}).coverage,null);
});

test('portfolio price refresh deduplicates panels without repeatedly loading brokers and preserves stale prices', async t => {
  const {loadPortfolioData}=await import('../../web/space/panels/portfolio.js');
  const oldFetch=globalThis.fetch,oldStorage=globalThis.localStorage,oldNow=Date.now;
  let now=1000000,brokerCalls=0,quoteCalls=0,fail=false;
  Date.now=()=>now;
  globalThis.localStorage={getItem:()=>JSON.stringify([account('auto')])};
  globalThis.fetch=async url=>{
    if(String(url).includes('/api/broker/')){brokerCalls++;return Response.json({connected:false,accounts:[]});}
    quoteCalls++;
    return fail?Response.json({error:'unavailable'},{status:502}):Response.json({prices:{AAPL:{price:10+quoteCalls,previous:10,asOf:'2026-11-11T15:00:00Z'}},unavailable:[]});
  };
  t.after(()=>{globalThis.fetch=oldFetch;globalThis.localStorage=oldStorage;Date.now=oldNow;});
  const initial=await loadPortfolioData(true);assert.equal(initial.prices.AAPL.price,11);
  now+=60000;
  const [a,b]=await Promise.all([loadPortfolioData(false,{quotesOnly:true}),loadPortfolioData(false,{quotesOnly:true})]);
  assert.equal(a,b);assert.equal(a.prices.AAPL.price,12);assert.equal(brokerCalls,1);assert.equal(quoteCalls,2);
  fail=true;now+=60000;const failed=await loadPortfolioData(false,{quotesOnly:true});
  assert.equal(failed.prices.AAPL.price,12);assert.equal(failed.prices.AAPL.stale,true);assert.deepEqual(failed.unavailable,['AAPL']);
  assert.throws(()=>snapshotAccounts(failed.manual,failed.manual,failed.manual,failed.prices,'2026-11-11'),/Fresh prices/);
  fail=false;now+=300000;await loadPortfolioData(false,{quotesOnly:true});assert.equal(brokerCalls,2);
});

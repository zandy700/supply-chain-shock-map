import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchlistStore, migrateLegacyWatchlist, WATCHLIST_LIMIT } from '../../web/shared/watchlist-store.js';
import { mapSymbolBatches, mergeBriefings, mergeCalendars } from '../../web/shared/watchlist-data.js';
const database = entries => { const map = new Map(entries);return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}; };

test('one shared store preserves additions, removals, legacy migration and reloads up to 40 stocks',()=>{
  const db=database([['watchlist-pulse','["MSFT"]'],['space:watchlist','["NVDA","MSFT"]']]), target=new EventTarget();
  const store=createWatchlistStore({storage:db,target});let notified=[];const off=store.subscribe(list=>notified.push(list));
  assert.deepEqual(migrateLegacyWatchlist(store,db),['MSFT','NVDA']);
  store.remove('MSFT');migrateLegacyWatchlist(store,db);assert.deepEqual(store.read(),['NVDA']);
  assert.equal(db.getItem('space:watchlist'),'["NVDA","MSFT"]');
  store.write(Array.from({length:40},(_,i)=>'T'+i));assert.equal(store.add('AAPL').error,'full');
  assert.equal(WATCHLIST_LIMIT,40);assert.equal(createWatchlistStore({storage:db}).read().length,40);
  off();assert.ok(notified.length>=2);
});

test('corrupt or blocked canonical storage is not overwritten by a seemingly successful save',()=>{
  const db=database([['watchlist-pulse','{broken json']]),store=createWatchlistStore({storage:db});
  assert.equal(store.write(['MSFT']),null);assert.equal(db.getItem('watchlist-pulse'),'{broken json');
  db.setItem('watchlist-pulse','{"unexpected":"value"}');assert.equal(store.write(['MSFT']),null);
  const blocked=createWatchlistStore({storage:{getItem:()=>null,setItem(){throw new Error('Quota');}}});assert.equal(blocked.add('MSFT').error,'storage');
});

test('batch requests cover 40 symbols in original order with bounded concurrency and sanitized failures',async()=>{
  let active=0,peak=0;const seen=[];
  const symbols=Array.from({length:40},(_,i)=>'S'+i);
  const result=await mapSymbolBatches(symbols,async batch=>{seen.push(batch);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,batch[0]==='S0'?5:1));active--;if(batch[0]==='S12')throw new Error('sensitive provider body');return batch;});
  assert.equal(seen.flat().length,40);assert.ok(seen.every(b=>b.length<=12));assert.ok(peak<=2);
  assert.deepEqual(result.results.map(b=>b[0]),['S0','S24','S36']);assert.equal(result.failedSymbols.length,12);assert.equal(result.errors[0].code,'request_failed');assert.doesNotMatch(JSON.stringify(result),/sensitive/);
});

test('batch abort rejects and stops launching new requests',async()=>{
  const controller=new AbortController();let calls=0;
  await assert.rejects(mapSymbolBatches(Array.from({length:40},(_,i)=>String(i)),async()=>{calls++;controller.abort();return {};},{signal:controller.signal}),{name:'AbortError'});
  assert.ok(calls<=2);
});

test('merged briefings and calendars deduplicate repeated market events and disclose failed stock coverage',()=>{
  const first={as_of:'2026-11-12T00:00:00Z',tickers:['AAPL'],companies:[{ticker:'AAPL'}],impacts:[],news:[],quotes:[],unresolved:[],errors:[]};
  const merged=mergeBriefings({results:[first,{...first,as_of:'2026-11-12T00:01:00Z'}],failedSymbols:['MSFT']});
  assert.equal(merged.as_of,first.as_of);assert.deepEqual(merged.tickers,['AAPL']);assert.equal(merged.partial,true);assert.deepEqual(merged.unresolved,['MSFT']);
  const event={date:'2026-12-09',title:'Fed decision',source:'Federal Reserve',scope:'market'};
  const calendar=mergeCalendars({results:[{from:'2026-11-12',to:'2027-01-31',events:[event]},{events:[event]}],failedSymbols:['MSFT']});
  assert.equal(calendar.events.length,1);assert.deepEqual(calendar.unavailable,['MSFT']);
  assert.throws(()=>mergeCalendars({results:[],failedSymbols:['MSFT']}),/retained/);
});

test('partial refresh keeps failed-stock data, identifies its age, and replaces recovered results',()=>{
  const previous={as_of:'2026-11-11T00:00:00Z',tickers:['MSFT','AAPL'],companies:[],impacts:[],news:[],quotes:[{ticker:'MSFT',price:100},{ticker:'AAPL',price:150}]};
  const current={as_of:'2026-11-12T00:00:00Z',tickers:['AAPL'],companies:[],impacts:[],news:[],quotes:[{ticker:'AAPL',price:160}],errors:[]};
  const merged=mergeBriefings({results:[current],failedSymbols:['MSFT']},previous);
  assert.deepEqual(merged.quotes,[{ticker:'MSFT',price:100},{ticker:'AAPL',price:160}]);assert.deepEqual(merged.staleSymbols,['MSFT']);assert.equal(merged.as_of,previous.as_of);assert.equal(merged.hasFreshData,true);
  const unavailable=mergeBriefings({results:[{...current,quotes:[],errors:[{ticker:'MSFT',code:'not_configured'}]}],failedSymbols:[]},previous);
  assert.equal(unavailable.hasFreshData,false);assert.deepEqual(unavailable.quotes,[{ticker:'MSFT',price:100}]);
  const recovered=mergeBriefings({results:[{...current,quotes:[{ticker:'MSFT',price:110}]}],failedSymbols:[]},merged);
  assert.deepEqual(recovered.staleSymbols,[]);assert.deepEqual(recovered.quotes,[{ticker:'MSFT',price:110}]);
  const oldEvent={date:'2026-12-01',title:'MSFT earnings',ticker:'MSFT',source:'Issuer'};
  const partialCalendar=mergeCalendars({results:[{events:[],unavailable:['MSFT']}],failedSymbols:[]},{events:[oldEvent]});
  assert.deepEqual(partialCalendar.events,[oldEvent]);assert.deepEqual(partialCalendar.staleSymbols,['MSFT']);
});

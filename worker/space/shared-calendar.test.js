import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as batchData from '../../web/shared/watchlist-data.js';
const source=await readFile(new URL('../../web/calendar.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('calendar covers 40 stocks in bounded requests and keeps existing events through a failed same-scope refresh',async()=>{
  const watchlist=Array.from({length:40},(_,i)=>'T'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26));
  const requests=[];let fail=false;
  const main={innerHTML:'',querySelectorAll:()=>[]};
  const context=vm.createContext({console,Date,location:{hash:'#/calendar'},watchlist,batchData,STOCK_SYMBOL:/^[A-Z]{1,5}$/,main,heading:()=>'<h1>Calendar</h1>',escapeHTML:String,
    document:{querySelector:()=>null},api:async path=>{requests.push(path);if(fail)throw new Error('Unavailable');const symbols=new URL(path,'http://localhost').searchParams.get('tickers').split(',');return {from:'2026-11-12',to:'2027-01-31',events:symbols.map(ticker=>({ticker,date:'2026-11-20',title:ticker+' earnings',source:'Issuer',url:'https://example.com',status:'Estimated',detail:'Earnings release',scope:'watchlist'})),unavailable:[],unlisted:[]};}});
  vm.runInContext(source,context);vm.runInContext('renderCalendar()',context);await settle();
  assert.equal(requests.length,4);assert.ok(requests.every(path=>new URL(path,'http://localhost').searchParams.get('tickers').split(',').length<=12));
  assert.equal(vm.runInContext('calendarView.data.events.length',context),40);assert.match(main.innerHTML,/TAA earnings/);
  fail=true;vm.runInContext('calendarView.loaded=0;renderCalendar()',context);
  assert.match(main.innerHTML,/Refreshing events/);assert.match(main.innerHTML,/TAA earnings/);
  await settle();assert.match(main.innerHTML,/Refresh failed; previous events remain visible/);assert.match(main.innerHTML,/TAA earnings/);
  vm.runInContext("watchlist.splice(0,watchlist.length,'MSFT');renderCalendar()",context);
  assert.doesNotMatch(main.innerHTML,/TAA earnings/);await settle();assert.match(main.innerHTML,/calendar could not load/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { combinePosition, positionsByTicker, positionValue } from '../../web/shared/position.js';
import { createPositionTracker } from '../../web/space/positions.js';
import { bus, getPanel } from '../../web/space/core.js';
import { PORTFOLIOS_EVENT, writePortfolios } from '../../web/portfolio-model.js';
import { selectedPortfolioHoldings } from '../../web/space/panels/portfolio.js';
const account = (shares, cost, ticker='MSFT') => ({id:'test',name:'Test',cash:0,history:[],holdings:[{ticker,shares,cost}]});
const settle = () => new Promise(resolve=>setImmediate(resolve));
const eventBus = () => {const map=new Map();return {on(name,fn){if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);return()=>map.get(name).delete(fn);},emit(name,data){for(const fn of map.get(name)||[])fn(data);}};};
const storageEvent = key => {const event=new Event('storage');Object.defineProperty(event,'key',{value:key});return event;};

test('combined positions weight fractional holdings across accounts and label partial costs',()=>{
  const inputs=[account(1.5,100),account(.5,200),account(1,null)];
  const before=JSON.stringify(inputs),p=combinePosition(inputs,'msft');
  assert.deepEqual(p,{ticker:'MSFT',shares:3,lots:3,avgCost:125,costBasis:250,costedShares:2,partial:true});
  assert.deepEqual(positionValue(p,150),{marketValue:450,pnl:50,pnlPercent:20});
  assert.equal(JSON.stringify(inputs),before);assert.equal(positionsByTicker(inputs).size,1);
});

test('known zero costs and zero quotes remain valid while unknown costs stay unavailable',()=>{
  const free=combinePosition([account(2,0)],'MSFT');assert.equal(free.avgCost,0);assert.equal(free.partial,false);
  assert.deepEqual(positionValue(free,10),{marketValue:20,pnl:20,pnlPercent:null});
  const paid=combinePosition([account(.5,100)],'MSFT');assert.deepEqual(positionValue(paid,0),{marketValue:0,pnl:-50,pnlPercent:-100});
  const unknown=combinePosition([account(2,null)],'MSFT');assert.equal(unknown.avgCost,null);assert.equal(positionValue(unknown,20).pnl,null);
  assert.equal(combinePosition([account(-2,10),account(Infinity,10)],'MSFT'),null);
  assert.equal(positionValue(paid,NaN).marketValue,null);
});

test('position subscribers see immediate local data and same-tab/cross-tab updates without extra broker calls',async()=>{
  let manual=[account(1,100)],calls=0;const win=new EventTarget(),events=eventBus();
  const tracker=createPositionTracker({readManual:()=>manual,loadData:async()=>{calls++;return{broker:{connected:false,accounts:[]}};},eventBus:events,getWindow:()=>win});
  const seen=[];const off=tracker.onPositions(()=>seen.push(tracker.positionFor('MSFT')?.avgCost));
  assert.equal(seen[0],100);await settle();assert.equal(calls,1);
  manual=[account(1,200)];win.dispatchEvent(new Event(PORTFOLIOS_EVENT));assert.equal(tracker.positionFor('MSFT').avgCost,200);
  manual=[account(2,300)];win.dispatchEvent(storageEvent('watchlist-pulse-portfolios-v1'));assert.equal(tracker.positionFor('MSFT').avgCost,300);assert.equal(calls,1);
  events.emit('portfolio:data',{broker:{connected:true,accounts:[account(2,100)]}});assert.equal(tracker.positionFor('MSFT').avgCost,200);assert.equal(calls,1);
  const count=seen.length;events.emit('portfolio:privacy');assert.equal(seen.length,count+1);
  events.emit('portfolio:data',{broker:{connected:false,accounts:[]}});assert.equal(tracker.positionFor('MSFT').avgCost,300);
  off();manual=[account(1,900)];win.dispatchEvent(new Event(PORTFOLIOS_EVENT));assert.equal(tracker.positionFor('MSFT').avgCost,300);
});

test('late broker results cannot restore disconnected holdings or notify an unmounted panel',async()=>{
  let finish;const events=eventBus(),win=new EventTarget();
  const tracker=createPositionTracker({readManual:()=>[],loadData:()=>new Promise(resolve=>{finish=resolve;}),eventBus:events,getWindow:()=>win});
  let calls=0;const off=tracker.onPositions(()=>calls++);
  events.emit('portfolio:data',{broker:{connected:false,accounts:[]}});
  finish({broker:{connected:true,accounts:[account(1,100)]}});await settle();assert.equal(tracker.positionFor('MSFT'),null);
  const count=calls;off();events.emit('portfolio:data',{broker:{connected:true,accounts:[account(1,999)]}});assert.equal(calls,count);
});

test('broker overlays refresh while active, catch up on visibility, and stop after unmount',async()=>{
  let time=0,calls=0,tick,canceled;const win=new EventTarget(),doc=new EventTarget();doc.visibilityState='visible';win.navigator={onLine:true};
  const tracker=createPositionTracker({readManual:()=>[],loadData:async()=>{calls++;return{broker:{connected:true,accounts:[account(1,calls*100)]}};},eventBus:eventBus(),getWindow:()=>win,getDocument:()=>doc,now:()=>time,schedule:fn=>(tick=fn,42),cancel:id=>{canceled=id;}});
  const off=tracker.onPositions(()=>{});await settle();assert.equal(calls,1);
  time=300000;tick();await settle();assert.equal(tracker.positionFor('MSFT').avgCost,200);
  win.dispatchEvent(new Event('focus'));assert.equal(calls,2);
  time=600000;doc.visibilityState='hidden';tick();assert.equal(calls,2);
  doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await settle();assert.equal(calls,3);
  time=900000;win.navigator.onLine=false;tick();assert.equal(calls,3);
  win.navigator.onLine=true;win.dispatchEvent(new Event('online'));await settle();assert.equal(calls,4);
  off();assert.equal(canceled,42);time=1200000;tick();win.dispatchEvent(new Event('focus'));assert.equal(calls,4);
});

test('manual portfolio writes notify same-tab position consumers only after a successful save',()=>{
  const old=globalThis.dispatchEvent,events=[],storage={setItem(){}};
  globalThis.dispatchEvent=event=>events.push(event);
  try{writePortfolios([account(1,100)],storage);assert.equal(events[0].type,PORTFOLIOS_EVENT);assert.throws(()=>writePortfolios([account(1,100)],{setItem(){throw new Error('blocked');}}));assert.equal(events.length,1);}finally{if(old===undefined)delete globalThis.dispatchEvent;else globalThis.dispatchEvent=old;}
});

test('hidden portfolio values cannot be exported to CSV or passed into AI context',async()=>{
  const keys=['window','document','localStorage','fetch'],before=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
  const values=new Map([['space:portfolio:private','true'],['watchlist-pulse-portfolios-v1',JSON.stringify([account(1,123.45)])]]);
  const nodes=new Map();const element=()=>({innerHTML:'',textContent:'',scrollTop:0,scrollLeft:0,classList:{toggle(){}},contains:()=>false,setAttribute(){},querySelectorAll:()=>[],append(){}});
  const el={...element(),isConnected:true,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);}};
  let instance;
  try{
    globalThis.window=new EventTarget();globalThis.window.navigator={onLine:true};
    globalThis.document={visibilityState:'visible',activeElement:null,querySelector:()=>null,addEventListener(){},removeEventListener(){}};
    globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
    globalThis.fetch=async path=>Response.json(String(path).includes('/api/broker/')?{connected:false,accounts:[]}:{prices:{MSFT:{price:160,previous:150}},unavailable:[]});
    instance=getPanel('portfolio-summary').mount(el,{state:{},setState(){}});await settle();
    assert.equal(instance.csv(),null);assert.equal(instance.scoutContext(),'Portfolio values are hidden.');
    assert.doesNotMatch(nodes.get('[data-content]').innerHTML,/123\.45|160\.00|36\.55/);
    assert.deepEqual(await selectedPortfolioHoldings(),[]);
    instance.destroy();nodes.clear();instance=getPanel('portfolio-allocation').mount(el,{state:{},setState(){}});await settle();
    assert.doesNotMatch(nodes.get('[data-content]').innerHTML,/<progress|100(?:\.0)?%|160\.00/);
    values.set('space:portfolio:private','false');bus.emit('portfolio:privacy');
    assert.match(instance.csv(),/MSFT/);assert.match(instance.scoutContext(),/160/);
    assert.deepEqual(await selectedPortfolioHoldings(),[{ticker:'MSFT',shares:1,avgCost:123.45}]);
    values.set('space:portfolio:private','true');window.dispatchEvent(storageEvent('space:portfolio:private'));
    assert.equal(instance.csv(),null);assert.equal(instance.scoutContext(),'Portfolio values are hidden.');
  }finally{instance?.destroy();for(const [k,v]of Object.entries(before))v===undefined?delete globalThis[k]:globalThis[k]=v;}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createOptionRefresh,regularSession,optionSource,optionSourceHTML,panelVisible} from '../../web/space/panels/options-refresh.js';
const tick=()=>new Promise(r=>setImmediate(r));
function fixture(refresh) {
  let current=new Date('2026-11-11T15:00:00Z'),shown=true;
  const tasks=new Map();let seq=0;
  const poll=createOptionRefresh({refresh,now:()=>current,visible:()=>shown,schedule:(fn,ms)=>{assert.ok(ms>=60000);tasks.set(++seq,fn);return seq;},cancel:id=>tasks.delete(id)});
  const fire=async()=>{const [id,fn]=tasks.entries().next().value;tasks.delete(id);fn();await tick();};
  return{poll,fire,tasks,setTime:v=>current=new Date(v),setVisible:v=>shown=v};
}
test('regular US session boundary respects ET daylight saving, weekends and close',()=>{
 for(const [date,open]of [['2026-11-11T14:29:59Z',false],['2026-11-11T14:30:00Z',true],['2026-11-11T21:00:00Z',false],['2026-07-08T13:30:00Z',true],['2026-11-14T16:00:00Z',false]])assert.equal(regularSession(new Date(date)),open,date);
});
test('automatic updates require visibility, regular session, unpaused state and server permission',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;});
 f.setVisible(false);await f.fire();assert.equal(calls,0);
 f.setVisible(true);f.setTime('2026-11-11T22:00:00Z');await f.fire();assert.equal(calls,0);
 f.setTime('2026-11-11T15:00:00Z');f.poll.setPaused(true);await f.fire();assert.equal(calls,0);
 await f.poll.request();assert.equal(calls,1,'manual refresh still works while paused');
 f.poll.setPaused(false);f.poll.update({refreshAllowed:false});await f.fire();assert.equal(calls,1);
 f.poll.update({refreshAllowed:true});await f.fire();assert.equal(calls,2);f.setTime('2026-11-11T22:00:00Z');await f.fire();assert.equal(calls,2,'cached server permission cannot extend the regular session');f.poll.destroy();assert.equal(f.tasks.size,0);
});
test('slow refreshes do not overlap; restarts abort then coalesce after settlement',async()=>{
 let calls=0,active=0,max=0,release;const signals=[];const f=fixture(signal=>{calls++;signals.push(signal);active++;max=Math.max(max,active);return new Promise(r=>release=()=>{active--;r();});});
 const first=f.poll.request();await tick();assert.equal(calls,1);f.poll.request();f.poll.restart();f.poll.restart();assert.equal(signals[0].aborted,true);assert.equal(calls,1);
 release();await first;await tick();assert.equal(calls,2);assert.equal(max,1);assert.equal(f.tasks.size,0);release();await tick();f.poll.destroy();
});
test('a failed request re-arms polling and destroy cancels pending/queued work',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw Error('retryable');});await assert.rejects(f.poll.request(),/retryable/);assert.equal(f.tasks.size,1);await f.fire();assert.equal(calls,2);f.poll.destroy();
 let signal,release;const slow=fixture(s=>{signal=s;return new Promise(r=>release=r);});slow.poll.request();await tick();slow.poll.restart();slow.poll.destroy();assert.equal(signal.aborted,true);release();await tick();assert.equal(slow.tasks.size,0);
});
test('source descriptions distinguish indicative quote age from delayed trades and preserve missing timestamps',()=>{
 const text=optionSource({source:'Alpaca',feed:'indicative',indicative:true,quoteAsOf:'quote-time',tradeAsOf:'trade-time',fetchedAt:'fetch-time',unavailableMetrics:['volume','openInterest'],coverage:{partial:true,reason:'Page cap'}});
 assert.match(text,/not actual OPRA/);assert.match(text,/Trades are delayed 15 minutes; quote age varies/);assert.match(text,/quote timestamp: quote-time/i);assert.match(text,/trade timestamp: trade-time/i);assert.match(text,/Partial coverage: Page cap/);assert.match(text,/openInterest/);
 assert.match(optionSource({source:'Nasdaq',delayed:true}),/quote timestamp: unavailable/i);
 assert.match(optionSource({source:'Alpaca',quoteAsOf:'top'}, {quoteAsOf:'contract'}),/quote timestamp: contract/i);assert.match(optionSource({source:'Alpaca',quoteAsOf:'top'}, {quoteAsOf:null}),/quote timestamp: unavailable/i);
});
test('invisible or disconnected panels cannot automatically poll',()=>{
 const visible={isConnected:true,getBoundingClientRect:()=>({width:100,height:100,top:0,left:0,bottom:100,right:100})};const old=globalThis.innerHeight,oldW=globalThis.innerWidth;globalThis.innerHeight=500;globalThis.innerWidth=500;
 try{assert.equal(panelVisible(visible,{visibilityState:'hidden'}),false);assert.equal(panelVisible({...visible,isConnected:false},{visibilityState:'visible'}),false);assert.equal(panelVisible(visible,{visibilityState:'visible'}),true);}finally{globalThis.innerHeight=old;globalThis.innerWidth=oldW;}
});

test('source disclosure escapes provider text and keeps exact fallback/underlying metadata accessible',()=>{
 const html=optionSourceHTML({source:'<img src=x onerror=alert(1)>',feed:'indicative',indicative:true,note:'Fallback reason preserved',quoteAsOf:'latest',underlying:{source:'Independent spot source',asOf:'spot-time'},fallback:{requestedProvider:'alpaca',provider:'nasdaq',reason:'Fixture provider unavailable'},notices:['Credential-free fallback']});
 assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);assert.match(html,/<details/);assert.match(html,/Fallback reason preserved/);assert.match(html,/Independent spot source/);assert.match(html,/spot-time/);assert.match(html,/Credential-free fallback/);assert.match(html,/Fixture provider unavailable/);
});

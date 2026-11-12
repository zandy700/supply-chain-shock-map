import test from 'node:test';
import assert from 'node:assert/strict';
import '../../web/space/panels/markets.js';
import { getPanel } from '../../web/space/core.js';
const node = () => ({innerHTML:'',textContent:'',scrollTop:0,scrollLeft:0,classList:{toggle(){}},contains:()=>false,setAttribute(){},querySelector:()=>null});

test('saved watchlist stocks remain visible when the quote API is unavailable', async () => {
  const before=Object.fromEntries(['fetch','location','document','window','localStorage'].map(k=>[k,globalThis[k]]));
  const toolbar=node(),body=node(),footer=node(),message=node(),live=node(),pause=node();toolbar.querySelector=()=>pause;
  const nodes={'.p-market-toolbar':toolbar,'.p-market-body':body,'.p-market-footer':footer,'.p-market-message':message,'.p-market-live':live};
  const listeners={};let backupWrites=0;
  const el={...node(),isConnected:true,querySelector:s=>nodes[s],addEventListener(name,fn){listeners[name]=fn;},removeEventListener(){}};
  let instance;
  try {
    Object.assign(globalThis,{location:{origin:'http://localhost'},document:{visibilityState:'visible',activeElement:null,addEventListener(){},removeEventListener(){}},window:{navigator:{onLine:true},addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){backupWrites++;}},fetch:async()=>Response.json({error:'Quote service unavailable'},{status:503})});
    instance=getPanel('watchlist').mount(el,{state:{symbols:['MSFT','BRK.B']},setState(){return false;}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(body.innerHTML,/data-symbol="MSFT"/);assert.match(body.innerHTML,/data-symbol="BRK.B"/);
    assert.match(body.innerHTML,/Unavailable/);assert.match(message.textContent,/saved|watchlist/i);
    const input={value:'TSLA'};
    listeners.submit({preventDefault(){},target:{matches:()=>true,elements:{symbol:input}}});
    assert.match(message.textContent,/not saved/);assert.equal(input.value,'TSLA');assert.equal(backupWrites,0);
    assert.doesNotMatch(body.innerHTML,/data-symbol="TSLA"/);
    globalThis.fetch=async()=>Response.json({quotes:[{symbol:'MSFT',price:12.34}]});
    const refresh={dataset:{},hasAttribute:name=>name==='data-refresh'};
    listeners.click({target:{closest:()=>refresh}});await new Promise(resolve=>setImmediate(resolve));
    assert.match(body.innerHTML,/12\.34/);assert.equal(message.textContent,'');
    globalThis.fetch=async()=>Response.json({error:'Unavailable'},{status:503});
    listeners.click({target:{closest:()=>refresh}});await new Promise(resolve=>setImmediate(resolve));
    assert.match(body.innerHTML,/12\.34/);assert.match(message.textContent,/previous data/);
  } finally { instance?.destroy();for(const [k,v]of Object.entries(before))v===undefined?delete globalThis[k]:globalThis[k]=v; }
});

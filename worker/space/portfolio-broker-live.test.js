import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBrokers} from '../../web/portfolio-broker.js';

test('broker holdings GET has a bounded deadline and later requests recover',async t=>{
  const oldFetch=globalThis.fetch,oldTimeout=AbortSignal.timeout;
  let controller,ms;
  AbortSignal.timeout=value=>{ms=value;controller=new AbortController();return controller.signal;};
  globalThis.fetch=(_url,init)=>new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
  t.after(()=>{globalThis.fetch=oldFetch;AbortSignal.timeout=oldTimeout;});
  const pending=loadBrokers();assert.equal(ms,30000);
  controller.abort(new DOMException('Request timed out','TimeoutError'));
  const failed=await pending;assert.match(failed.error,/timed out/);assert.deepEqual(failed.accounts,[]);
  globalThis.fetch=async()=>Response.json({connected:false,accounts:[]});
  const recovered=await loadBrokers();assert.equal(recovered.connected,false);assert.equal(recovered.error,undefined);
});

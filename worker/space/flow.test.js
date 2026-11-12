import test from 'node:test';import assert from 'node:assert/strict';
import {flowRoute,flowParameters,normalizeTrade} from './flow.js';
const url=q=>new URL('https://pulse.test/api/space/options/flow?'+q);
test('flow filters map to real tape parameters and validate unsupported filters',()=>{const p=flowParameters(url('symbol=nvda&preset=big-ask&limit=25&minPremium=500&sort=premium').searchParams);assert.equal(p.get('ticker_symbol'),'NVDA');assert.equal(p.get('tags[]'),'ask_side');assert.equal(p.get('min_premium'),'100000');assert.equal(p.get('order'),'premium');assert.throws(()=>flowParameters(url('limit=999').searchParams));assert.throws(()=>flowParameters(url('symbol=<bad>').searchParams));assert.throws(()=>flowParameters(url('older_than=bad').searchParams));});
test('unconfigured flow fails explicitly without making an upstream request',async()=>{const old=global.fetch;global.fetch=()=>assert.fail('must not fetch without key');try{const r=await flowRoute(url(''),{});assert.equal(r.status,503);assert.equal((await r.json()).error,'flow_not_configured');}finally{global.fetch=old;}});
test('200 rows are supported but loaded-page volume and DTE never become unsupported provider orders',()=>{
  for(const sort of ['volume','dte']){const p=flowParameters(url('limit=200&sort='+sort+'&minVolume=1000').searchParams);assert.equal(p.get('limit'),'200');assert.equal(p.get('min_volume'),'1000');assert.equal(p.has('order'),false);}
  assert.equal(flowParameters(url('sort=size').searchParams).get('order'),'size');
  assert.throws(()=>flowParameters(url('sort=unsupported').searchParams));
});
test('200-row fixture preserves latest trade time, page-sort scope and rejects credential-bearing redirects',async()=>{
  const old=global.fetch;let calls=0;
  global.fetch=async(u,init)=>{calls++;assert.equal(init.redirect,'manual');return Response.json({data:Array.from({length:200},(_,i)=>({id:String(i),executed_at:'2026-11-11T15:00:00Z',option_chain_id:'FIXT261120C00100000',price:'2.1'}))});};
  try{
    const response=await flowRoute(url('limit=200&sort=volume'),{UNUSUAL_WHALES_API_KEY:'fixture-token'}),body=await response.json();
    assert.equal(body.rows.length,200);assert.equal(body.limit,200);assert.equal(body.hasMore,true);assert.equal(body.sortScope,'loaded-page');assert.equal(body.asOf,'2026-11-11T15:00:00Z');assert.ok(Number.isFinite(Date.parse(body.checkedAt)));
    global.fetch=async(u,init)=>{calls++;assert.equal(init.redirect,'manual');return new Response('fixture-token',{status:302,headers:{Location:'https://untrusted.example/collect'}});};
    const redirect=await flowRoute(url(''),{UNUSUAL_WHALES_API_KEY:'fixture-token'});assert.equal(redirect.status,502);assert(!(await redirect.text()).includes('fixture-token'));assert.equal(calls,2);
  }finally{global.fetch=old;}
});
test('trade normalization preserves missing values and reported execution metadata',()=>{const r=normalizeTrade({id:'x',executed_at:'2026-11-11T15:00:00Z',option_chain_id:'NVDA261120C00170000',underlying_symbol:'NVDA',price:'2.1',premium:'210',tags:['ask_side'],report_flags:['intermarket_sweep']});assert.equal(r.price,2.1);assert.equal(r.bid,null);assert.deepEqual(r.tags,['ask_side']);assert.equal(normalizeTrade({executed_at:'no'}),null);});
test('flow sends credentials only in fixed-host header and does not echo upstream errors',async()=>{const old=global.fetch;let sent;global.fetch=async(u,i)=>{sent={u,i};return Response.json({data:[{executed_at:'2026-11-11T15:00:00Z',option_chain_id:'NVDA261120C00170000',price:'2.1'}]});};try{const r=await flowRoute(url('limit=25'),{UNUSUAL_WHALES_API_KEY:'private-key'});const body=await r.json();assert.equal(body.rows.length,1);assert.equal(sent.i.headers.Authorization,'Bearer private-key');assert(!sent.u.includes('private-key'));assert(!JSON.stringify(body).includes('private-key'));global.fetch=async()=>Response.json({error:'private-key'},{status:401});const fail=await flowRoute(url(''),{UNUSUAL_WHALES_API_KEY:'private-key'});assert.equal(fail.status,502);assert(!(await fail.text()).includes('private-key'));}finally{global.fetch=old;}});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceRoute } from './router.js';
import { validateChat, resetScoutForTests } from './scout.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import { holdingsContext } from '../../web/space/panels/portfolio-workflows.js';

const KEY = 'test-scout-integration-secret';
const sse = events => new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
const toolTurn = tools => sse([
  {type:'message_start',message:{model:'test-model'}},
  ...tools.flatMap((tool,index)=>[
    {type:'content_block_start',index,content_block:{type:'tool_use',id:'t'+index,name:tool.name,input:{}}},
    {type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:JSON.stringify(tool.input||{})}},
    {type:'content_block_stop',index}
  ]),
  {type:'message_delta',delta:{stop_reason:'tool_use'}},{type:'message_stop'}
]);
const finalTurn = ()=>sse([{type:'message_start',message:{model:'test-model'}},{type:'content_block_start',index:0,content_block:{type:'text',text:'Checked.'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'}},{type:'message_stop'}]);
async function roundTrip(t, tools, context={}, provider) {
  resetScoutForTests();resetSpaceUpstreamForTests();
  const original=globalThis.fetch,modelRequests=[],providerRequests=[];
  globalThis.fetch=async (url,init={})=>{
    const u=new URL(String(url));
    if(u.hostname==='api.anthropic.com'){
      assert.equal(init.headers['x-api-key'],KEY);
      const body=JSON.parse(init.body);modelRequests.push(body);
      return modelRequests.length===1?toolTurn(tools):finalTurn();
    }
    providerRequests.push(u);return provider?provider(u):new Response('unavailable',{status:404});
  };
  t.after(()=>{globalThis.fetch=original;});
  const req=new Request('https://pulse.test/api/space/scout/chat',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.23'},body:JSON.stringify({messages:[{role:'user',content:'Check the shared data.'}],context})});
  const res=await spaceRoute(req,{ANTHROPIC_API_KEY:KEY},{});assert.equal(res.status,200);
  const stream=await res.text();assert.doesNotMatch(stream,new RegExp(KEY));
  const results=modelRequests[1]?.messages.at(-1).content||[];
  return {modelRequests,providerRequests,results,stream};
}
test('portfolio lookup sees only validated request context and cannot accept invented tool holdings',async t=>{
  const secret='PRIVATE-ACCOUNT-ID';
  const r=await roundTrip(t,[{name:'get_portfolio_context',input:{holdingsSummary:'FAKE 999'}}],{holdingsSummary:'NVDA 2 @ $100',accountId:secret,brokerSecret:secret});
  const data=JSON.parse(r.results[0].content);
  assert.equal(data.holdings,'NVDA 2 @ $100');assert.equal(data.available,true);
  assert.doesNotMatch(JSON.stringify(r.modelRequests),new RegExp(secret));
  assert.equal(r.providerRequests.length,0);
});
test('portfolio lookup without explicit sharing has no ambient account access',async t=>{
  const r=await roundTrip(t,[{name:'get_portfolio_context',input:{accountId:'anything',holdingsSummary:'FAKE'}}]);
  const data=JSON.parse(r.results[0].content);assert.equal(data.available,false);assert.equal(data.holdings,null);assert.equal(r.providerRequests.length,0);
});
test('new financial and options tools reject invalid symbols before provider access',async t=>{
  const r=await roundTrip(t,[{name:'get_financials',input:{symbol:'NVDA?token=private'}},{name:'get_options_chain',input:{symbol:'../../private'}}]);
  assert.equal(r.results.length,2);assert.ok(r.results.every(r=>r.is_error));assert.equal(r.providerRequests.length,0);
});
test('options tool passes expiry through to existing validation instead of querying arbitrary paths',async t=>{
  const r=await roundTrip(t,[{name:'get_options_chain',input:{symbol:'NVDA',expiry:'not-a-date'}}]);
  assert.equal(r.results[0].is_error,true);assert.equal(r.providerRequests.length,0);
});
test('financial tool can request actual cash-flow statements with quarterly frequency',async t=>{
  const table=rows=>({headers:{value1:'Breakdown',value2:'09/30/2026'},rows:rows.map(([value1,value2])=>({value1,value2}))});
  const r=await roundTrip(t,[{name:'get_financials',input:{symbol:'NVDA',period:'quarterly',statement:'cashflow'}}],{},u=>{
    if(u.pathname.endsWith('/info'))return Response.json({data:{symbol:'NVDA',assetClass:'STOCKS'},status:{rCode:200}});
    if(u.pathname.endsWith('/financials'))return Response.json({data:{incomeStatementTable:table([['Total Revenue','20']]),cashFlowTable:table([['Net Cash Flow-Operating','12'],['Capital Expenditures','-2']]),balanceSheetTable:table([['Total Assets','30']])},status:{rCode:200}});
    return new Response('unavailable',{status:404});
  });
  const schema=r.modelRequests[0].tools.find(t=>t.name==='get_financials').input_schema;
  assert.ok(schema.properties.statement,'financial tool must expose the requested statement');
  const body=JSON.parse(r.results[0].content);assert.equal(body.statement,'cashflow');assert.equal(body.period,'quarterly');
  assert.equal(body.rows.find(row=>row.key==='operatingCF').values.at(-1),12000);
  assert.ok(r.providerRequests.some(u=>u.pathname.endsWith('/financials')&&u.searchParams.get('frequency')==='2'));
});
test('context rejects oversized holdings and strips account fields before model serialization',()=>{
  assert.throws(()=>validateChat({messages:[{role:'user',content:'Hi'}],context:{holdingsSummary:'x'.repeat(4001)}}));
  const cleaned=validateChat({messages:[{role:'user',content:'Hi'}],context:{accountId:'secret',holdingsSummary:'AAPL 1',symbols:['aapl']}});
  assert.deepEqual(cleaned.context,{holdingsSummary:'AAPL 1',symbols:['AAPL']});
});
test('shared holdings context combines known costs but preserves unknown basis and removes identities',()=>{
  const rows=holdingsContext([{name:'Private account',id:'private',holdings:[{ticker:'NVDA',shares:10,cost:100}]},{name:'Other account',holdings:[{ticker:'NVDA',shares:10,cost:null},{ticker:'AAPL',shares:2,cost:50}]}]);
  assert.deepEqual(rows,[{ticker:'NVDA',shares:20,avgCost:null},{ticker:'AAPL',shares:2,avgCost:50}]);
  assert.doesNotMatch(JSON.stringify(rows),/Private account|private|Other account/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOCC, normalizeSnapshots, fetchAlpacaChain, resetAlpacaOptionsForTests, ALPACA_PAGE_LIMIT } from './alpaca-options.js';
import { resetOptionsStateForTests } from './options.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import { spaceRoute } from './router.js';
const env = { ALPACA_API_KEY: 'fake-key-one', ALPACA_API_SECRET: 'fake-secret-one' };
const env2 = { ALPACA_API_KEY: 'fake-key-two', ALPACA_API_SECRET: 'fake-secret-two' };
const qtime = '2026-11-12T14:45:00.123456789Z', ttime = '2026-11-12T14:30:00Z';
const C = 'TEST991231C00100000', P = 'TEST991231P00100000';
const sample = { latestQuote: { bp: 2, ap: 2.2, t: qtime }, latestTrade: { p: 2.1, t: ttime }, impliedVolatility: 0.5, greeks: { delta: 0.9 } };
const response = data => Response.json(data);
function setup(t, handler) {
  resetOptionsStateForTests(); resetSpaceUpstreamForTests(); resetAlpacaOptionsForTests();
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (href, init) => { const url = new URL(href); calls.push({ url, init }); return handler(url, init, calls.length); };
  t.after(() => { globalThis.fetch = original; resetOptionsStateForTests(); resetSpaceUpstreamForTests(); }); return calls;
}
const route = (path, credentials = env) => spaceRoute(new Request('https://pulse.test/api/space/options/' + path), credentials, {});
const nqChain = { status: { rCode: 200 }, data: { lastTrade: 'LAST TRADE: $100.00 (AS OF NOV 12, 2026)', table: { rows: [{ expirygroup: 'December 31, 2099' }, { strike: '100', c_Last: '3', c_Bid: '2.9', c_Ask: '3.1', c_Volume: '1000', c_Openinterest: '100', p_Last: '2', p_Bid: '1.9', p_Ask: '2.1', p_Volume: '500', p_Openinterest: '50' }] } } };
const nqInfo = { status: {rCode:200},data:{primaryData:{lastSalePrice:'$100.50',lastTradeTimestamp:'Nov 12, 2026 9:45 AM ET'},companyName:'Test Co'} };

test('OCC parser validates real dates, standard root and positive thousandth strikes', () => {
  assert.deepEqual(parseOCC('TEST280229P00100500','TEST'), {root:'TEST',expiry:'2028-02-29',strike:100.5,side:'put'});
  for (const contract of ['TEST270229C00100000','TEST260231C00100000','TEST261332C00100000','TEST991231X00100000','TEST991231C00000000','TEST991231C001000000']) assert.equal(parseOCC(contract,'TEST'),null);
  assert.equal(parseOCC('TEST1991231C00100000','TEST'),null);
  assert.equal(parseOCC('OTHER991231C00100000','TEST'),null);
  assert.ok(parseOCC('BRKB991231C00100000','BRK.B'));
});
test('snapshots preserve quote/trade time, drop adjusted contracts and keep unsupported values null', () => {
  const d=normalizeSnapshots({[C]:sample,[P]:{},TEST1991231C00100000:sample},'TEST');
  assert.equal(d.droppedContracts,1);assert.equal(d.contracts,2);assert.equal(d.rows[0].call.vol,null);assert.equal(d.rows[0].call.oi,null);assert.equal(d.rows[0].call.chg,null);
  assert.equal(d.rows[0].call.quoteAsOf,qtime);assert.equal(d.rows[0].call.tradeAsOf,ttime);assert.equal(d.rows[0].put.last,null);
  assert.equal(d.rows[0].call.impliedVolatility,undefined);
});
test('explicit indicative pagination uses header-only credentials and shares bounded short cache/inflight', async t => {
  const calls=setup(t,async u=>u.searchParams.has('page_token')?response({snapshots:{[P]:sample},next_page_token:null}):response({snapshots:{[C]:sample},next_page_token:'page-two'}));
  const [a,b]=await Promise.all([fetchAlpacaChain('TEST',env),fetchAlpacaChain('TEST',env)]);
  assert.equal(a,b);assert.equal(calls.length,2);assert.equal(a.coverage.partial,false);assert.equal(a.coverage.pages,2);assert.equal(a.rows.length,1);assert.equal(a.coverage.contracts,2);
  await fetchAlpacaChain('TEST',env);assert.equal(calls.length,2);
  for(const {url,init} of calls){assert.equal(url.searchParams.get('feed'),'indicative');assert.equal(url.searchParams.get('limit'),'1000');assert.equal(init.headers['APCA-API-KEY-ID'],env.ALPACA_API_KEY);assert.equal(init.headers['APCA-API-SECRET-KEY'],env.ALPACA_API_SECRET);assert.equal(init.redirect,'manual');assert.ok(!url.href.includes(env.ALPACA_API_KEY));assert.ok(!url.href.includes(env.ALPACA_API_SECRET));}
});
test('workerd-compatible manual requests reject redirects without forwarding credentials or provider bodies',async t=>{
  const calls=setup(t,(_url,init)=>{
    if(init.redirect==='error')throw new TypeError('workerd does not support this redirect mode');
    return response({snapshots:{[C]:sample}});
  });
  assert.equal((await fetchAlpacaChain('TEST',env)).provider,'alpaca');
  resetAlpacaOptionsForTests();
  globalThis.fetch=async(_url,init)=>{
    calls.push({init});
    assert.equal(init.redirect,'manual');
    return new Response(env.ALPACA_API_SECRET,{status:302,headers:{Location:'https://untrusted.example/collect'}});
  };
  await assert.rejects(fetchAlpacaChain('TEST',env),e=>e.code==='alpaca_unavailable'&&!e.message.includes(env.ALPACA_API_SECRET));
  assert.equal(calls.length,2);
});
test('cached chains are isolated by both credentials and expire after short TTL',async t=>{
  const calls=setup(t,(_u,i)=>response({snapshots:{[C]:{...sample,latestTrade:{p:i.headers['APCA-API-KEY-ID']===env.ALPACA_API_KEY?1:2,t:ttime}}}}));
  const original=Date.now;let now=original();Date.now=()=>now;t.after(()=>{Date.now=original});
  assert.equal((await fetchAlpacaChain('TEST',env)).rows[0].call.last,1);assert.equal((await fetchAlpacaChain('TEST',env2)).rows[0].call.last,2);assert.equal(calls.length,2);
  await fetchAlpacaChain('TEST',{...env,ALPACA_API_SECRET:'different-secret'});assert.equal(calls.length,3);
  now+=31000;await fetchAlpacaChain('TEST',env);assert.equal(calls.length,4);
});
test('pagination cap and repeated tokens explicitly disclose partial coverage',async t=>{
  let n=0;const calls=setup(t,()=>response({snapshots:{[C]:sample},next_page_token:'page'+(++n)}));
  const d=await fetchAlpacaChain('TEST',env);assert.equal(calls.length,ALPACA_PAGE_LIMIT);assert.equal(d.coverage.partial,true);assert.match(d.coverage.reason,/Limited/);
  resetAlpacaOptionsForTests();globalThis.fetch=async()=>response({snapshots:{[C]:sample},next_page_token:'same'});
  const repeated=await fetchAlpacaChain('TEST',env);assert.equal(repeated.coverage.pages,2);assert.match(repeated.coverage.reason,/repeated/);
});
test('429 cooldown is credential-scoped and errors never echo provider bodies',async t=>{
  const calls=setup(t,(_u,i)=>i.headers['APCA-API-KEY-ID']===env.ALPACA_API_KEY?Response.json({message:env.ALPACA_API_SECRET},{status:429,headers:{'Retry-After':'60'}}):response({snapshots:{[C]:sample}}));
  for(let i=0;i<2;i++) await assert.rejects(fetchAlpacaChain('TEST',env),e=>e.code==='alpaca_rate_limited'&&!e.message.includes(env.ALPACA_API_SECRET));
  assert.equal(calls.length,1);await fetchAlpacaChain('TEST',env2);assert.equal(calls.length,2);
});
test('malformed pages and upstream failures fail closed without secret-bearing body text',async t=>{
  setup(t,()=>Response.json({message:env.ALPACA_API_SECRET},{status:401}));
  await assert.rejects(fetchAlpacaChain('TEST',env),{message:'alpaca_access_denied'});
  resetAlpacaOptionsForTests();globalThis.fetch=async()=>response({snapshots:[],next_page_token:null});await assert.rejects(fetchAlpacaChain('TEST',env),{message:'alpaca_invalid_response'});
  globalThis.fetch=async()=>response({snapshots:{[C]:sample},next_page_token:7});await assert.rejects(fetchAlpacaChain('TEST',env),{message:'alpaca_invalid_response'});
  globalThis.fetch=async()=>{throw Error(env.ALPACA_API_SECRET)};await assert.rejects(fetchAlpacaChain('TEST',env),{message:'alpaca_unavailable'});
});
test('chain/expirations prefer indicative without mixing Nasdaq option fields; spot is labeled separately',async t=>{
  const calls=setup(t,u=>u.hostname==='data.alpaca.markets'?response({snapshots:{[C]:sample,[P]:sample}}):response(nqInfo));
  const r=await route('chain?symbol=TEST');const d=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(d.provider,'alpaca');assert.equal(d.feed,'indicative');assert.equal(d.rows[0].call.vol,null);assert.equal(d.underlying.price,100.5);assert.match(d.underlying.source,/Nasdaq/);assert.equal(d.quoteAsOf,qtime);assert.equal(d.tradeAsOf,ttime);assert.ok(d.fetchedAt);
  assert.ok(!calls.some(c=>c.url.pathname.endsWith('/option-chain')));
  const e=await(await route('expirations?symbol=TEST')).json();assert.equal(e.expirations[0].maxPain,null);assert.equal(e.totals.calls.vol,null);assert.equal(e.totals.putCallVolume,null);assert.ok(e.expirations[0].expectedMove>0);
  const unusual=await(await route('unusual?symbols=TEST')).json();assert.deepEqual(unusual.contracts,[]);assert.equal(unusual.providers[0].provider,'alpaca');assert.match(unusual.notices.join(' '),/cannot participate/);
  assert.ok(!JSON.stringify(d).includes(env.ALPACA_API_KEY));assert.ok(!JSON.stringify(d).includes(env.ALPACA_API_SECRET));
});
test('Alpaca failure falls back to whole Nasdaq chain with explicit provider notice',async t=>{
  setup(t,u=>u.hostname==='data.alpaca.markets'?Response.json({message:env.ALPACA_API_SECRET},{status:403}):response(u.pathname.endsWith('/info')?nqInfo:nqChain));
  const d=await(await route('chain?symbol=TEST')).json();assert.equal(d.provider,'nasdaq');assert.equal(d.feed,'delayed');assert.equal(d.rows[0].call.vol,1000);assert.equal(d.fallback.requestedProvider,'alpaca');assert.match(d.notices[0],/access denied/);assert.ok(!JSON.stringify(d).includes(env.ALPACA_API_SECRET));
});
test('status reports configuration only and missing credentials make no Alpaca requests',async t=>{
  const calls=setup(t,u=>response(u.pathname.endsWith('/info')?nqInfo:nqChain));
  assert.deepEqual(await(await route('status',{})).json(),{configured:false,provider:'nasdaq',feed:'delayed'});
  assert.deepEqual(await(await route('status')).json(),{configured:true,provider:'alpaca',feed:'indicative'});assert.equal(calls.length,0);
  const d=await(await route('chain?symbol=TEST',{})).json();assert.equal(d.provider,'nasdaq');assert.ok(calls.every(c=>c.url.hostname!=='data.alpaca.markets'));
});


test('untrusted snapshot object keys cannot modify aggregation prototypes',async t=>{
  setup(t,()=>new Response('{"snapshots":{"__proto__":{"polluted":true},"TEST991231C00100000":{"latestQuote":{"bp":1,"ap":2}}}}',{headers:{'content-type':'application/json'}}));
  const d=await fetchAlpacaChain('TEST',env);assert.equal(d.rows.length,1);assert.equal(d.coverage.droppedContracts,1);assert.equal({}.polluted,undefined);
});


test('an explicit expiry absent from partial coverage is preserved, while complete absent expiry is 404',async t=>{
  let paginated=true,n=0;
  setup(t,u=>u.hostname==='data.alpaca.markets'?response({snapshots:{[C]:sample},next_page_token:paginated?'page'+(++n):null}):response(nqInfo));
  const requested='2098-01-16';
  const r=await route('chain?symbol=TEST&expiry='+requested);const d=await r.json();
  assert.equal(r.status,200);assert.equal(d.expiry,requested);assert.deepEqual(d.rows,[]);assert.equal(d.coverage.partial,true);assert.match(d.notices.join(' '),/not evidence that no contracts exist/);assert.ok(d.expirations.every(e=>e.date!==requested));
  resetAlpacaOptionsForTests();paginated=false;
  const complete=await route('chain?symbol=TEST&expiry='+requested);assert.equal(complete.status,404);assert.deepEqual(await complete.json(),{error:'unknown_expiry'});
});

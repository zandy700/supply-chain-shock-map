import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {resetUpstreamStateForTests} from './index.js';
const env={FINNHUB_API_KEY:'fake-provider-test-key'};
const req = (path='/api/briefing?tickers=JPM,XOM')=>new Request('https://pulse.test'+path);
function provider(handler) {
  const original=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.headers['X-Finnhub-Token'],env.FINNHUB_API_KEY);
    assert.ok(!String(url).includes(env.FINNHUB_API_KEY));
    return handler(new URL(url));
  };
  return ()=>{globalThis.fetch=original;};
}
const article=(id,headline,url='https://example.com/'+id)=>({id,headline,url,datetime:Math.floor(Date.now()/1000)-60,source:'Test news'});
test('live provider resolves names, emits signed sourced news and real quote timestamps',async()=>{
  resetUpstreamStateForTests();
  const restore=provider(url=>{
    if(url.pathname.endsWith('/search'))return Response.json({result:[{symbol:url.searchParams.get('q')==='JPMorgan'?'JPM':'XOM',description:url.searchParams.get('q')==='JPMorgan'?'JPMORGAN CHASE':'EXXON MOBIL',type:'Common Stock'}]});
    if(url.pathname.endsWith('/quote'))return Response.json({c:100,dp:1.2,t:1700000000});
    return Response.json([article(1,'Company raises guidance'),article(2,'Company sued'),article(3,'Unclassified news'),article(4,'Company sued','javascript:alert(1)')]);
  });
  try{
    const p=await(await worker.fetch(req('/api/briefing?tickers=JPMorgan,XOM'),env)).json();
    assert.deepEqual(p.tickers,['JPM','XOM']);
    assert.deepEqual(p.unresolved,[]);
    assert.equal(p.impacts.length,4);
    assert.equal(p.quotes.length,2);
    assert.equal(p.news.length,6);
    assert.deepEqual(p.impacts.map(x=>x.sign),[1,-1,1,-1]);
    assert.equal(p.quotes[0].as_of,'2023-11-14T22:13:20.000Z');
    assert.equal(p.mode,'live');
  }finally{restore();}
});
test('US registry shares resolve by ticker and company name while warrants stay excluded', async () => {
  resetUpstreamStateForTests();
  const restore = provider(() => Response.json({result: [
    {symbol: 'ASML', description: 'ASML HOLDING NV-NY REG SHS', type: 'NY Reg Shrs'},
    {symbol: 'TESTW', description: 'ASML HOLDING WARRANT', type: 'Warrant'}
  ]}));
  try {
    for (const query of ['asml', 'ASML Holding']) {
      const result = await (await worker.fetch(req('/api/resolve?q=' + encodeURIComponent(query)), env)).json();
      assert.deepEqual(result.tickers, ['ASML']);
      assert.deepEqual(result.unresolved, []);
    }
    const warrant = await (await worker.fetch(req('/api/resolve?q=TESTW'), env)).json();
    assert.deepEqual(warrant.unresolved, ['TESTW']);
  } finally { restore(); }
});
test('invalid-looking and unknown tickers do not silently pass resolution',async()=>{
  resetUpstreamStateForTests();
  const restore=provider(()=>Response.json({result:[]}));
  try{
    const p=await(await worker.fetch(req('/api/resolve?q=ZZZZZ'),env)).json();
    assert.deepEqual(p.unresolved,['ZZZZZ']);assert.deepEqual(p.tickers,[]);
  }finally{restore();}
});
test('ambiguous company names are rejected with suggestions',async()=>{
  resetUpstreamStateForTests();
  const restore=provider(()=>Response.json({result:[{symbol:'ABC',description:'Some Company A',type:'Common Stock'},{symbol:'DEF',description:'Some Company B',type:'Common Stock'}]}));
  try{
    const p=await(await worker.fetch(req('/api/resolve?q=Some%20Company'),env)).json();
    assert.deepEqual(p.unresolved,['Some Company']);assert.equal(p.suggestions['Some Company'].length,2);
  }finally{restore();}
});
test('upstream access failure produces honest partial/empty live payload without secret',async()=>{
  resetUpstreamStateForTests();
  const restore=provider(()=>new Response('provider detail must not leak',{status:403}));
  try{
    const r=await worker.fetch(req(),env);const text=await r.text();const p=JSON.parse(text);
    assert.equal(p.impacts.length,0);assert.equal(p.errors[0].code,'provider_access_denied');
    assert.ok(!text.includes(env.FINNHUB_API_KEY));assert.ok(!text.includes('provider detail'));
  }finally{restore();}
});
test('brief Cache API cache avoids repeated provider calls and stores no token',async()=>{
  resetUpstreamStateForTests();
  const store=new Map();let calls=0;
  globalThis.caches={default:{match:async k=>store.get(k.url)?.clone(),put:async(k,v)=>{assert.ok(!k.url.includes(env.FINNHUB_API_KEY));store.set(k.url,v);}}};
  const restore=provider(url=>{
    calls++;
    if(url.pathname.endsWith('/search'))return Response.json({result:[{symbol:'IBM',description:'JPMORGAN',type:'Common Stock'}]});
    if(url.pathname.endsWith('/quote'))return Response.json({c:100,t:1700000000});
    return Response.json([]);
  });
  try{
    await worker.fetch(req('/api/briefing?tickers=IBM'),env);
    await worker.fetch(req('/api/catalysts?tickers=IBM'),env);
    assert.equal(calls,3);
  }finally{restore();delete globalThis.caches;}
});
test('rate limit retries once then reports failure and cooldown without fabricated cards',async()=>{
  resetUpstreamStateForTests();
  let calls=0;
  const restore=provider(()=>{calls++;return new Response('',{status:429,headers:{'Retry-After':'1'}});});
  try{
    const p=await(await worker.fetch(req(),env)).json();
    assert.equal(calls,2);assert.deepEqual(p.impacts,[]);assert.equal(p.errors[0].code,'rate_limited');
    const second=await(await worker.fetch(req(),env)).json();
    assert.equal(calls,2);assert.equal(second.errors[0].code,'rate_limited');
  }finally{restore();}
});

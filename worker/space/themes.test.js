import test from 'node:test';
import assert from 'node:assert/strict';
import {THEME_CATALOG,THEME_IDS,THEMES_BY_ID,searchThemes} from '../../web/space/themes.js';
import {THEMES,getBuiltin} from '../../web/space/views.js';
import {THEMES as backend,handle} from './markets.js';
import {VIEW_IDS,validateAction} from './scout.js';
import {feed,resetNewsCacheForTests} from './news.js';
import {resetSpaceUpstreamForTests} from './upstream.js';

test('all themes share constituents, discoverable frontend routes, theme-wide news and AI identifiers',()=>{
  assert.equal(THEME_IDS.length,34);assert.equal(new Set(THEME_IDS).size,THEME_IDS.length);
  for(const t of THEME_CATALOG){
    assert.equal(backend[t.id],t);assert.equal(THEMES.find(x=>x.id===t.id),t);assert.ok(t.constituents.length>=5);
    const view=getBuiltin(t.id);assert.equal(view.kind,'theme');assert.ok(view.panels.some(p=>p.type==='news'&&p.state.mode==='theme'&&p.state.theme===t.id&&p.group===null));
    assert.ok(view.panels.some(p=>p.type==='heatmap'&&p.state.theme===t.id));assert.ok(view.panels.some(p=>p.type==='chart'));assert.ok(view.panels.some(p=>p.type==='multi-chart'));
    assert.equal(view.panels.some(p=>p.state.list==='funds'),Boolean(t.sector),'only sector views expose the explicitly unavailable mutual-fund source panel');assert.ok(VIEW_IDS.includes(t.id));assert.deepEqual(validateAction('open_view',{id:t.id}),{id:t.id});
    assert.ok(searchThemes(t.name).some(x=>x.id===t.id));
    for(const c of t.constituents){assert.ok(['stock','etf','crypto'].includes(c.instrumentType));assert.ok(c.role);}
    assert.ok(t.symbols.every(s=>t.constituents.some(c=>c.symbol===s)));
  }
  assert.ok(searchThemes('housing').some(t=>t.id==='housing-rates'));assert.ok(searchThemes('Kalshi').some(t=>t.id==='prediction-markets'));assert.ok(searchThemes('RSI').some(t=>t.id==='gambling'));
});
test('prediction-market notes distinguish public parents, operating exposure and indirect investment',()=>{
  const p=THEMES_BY_ID['prediction-markets'];assert.ok(p.constituents.every(c=>c.source===undefined&&c.exposureSource.startsWith('https:')));
  assert.equal(p.constituents.find(c=>c.symbol==='ICE').exposure,'indirect: equity investment');
  assert.ok(!p.constituents.some(c=>/kalshi|polymarket/i.test(c.symbol)));
  assert.match(p.note,/not event contracts|not the/);assert.ok(THEMES_BY_ID['gambling'].symbols.includes('RSI'));
});
test('theme news requests the full catalog universe, including symbols after the former first-twelve cap',async()=>{
  const original=globalThis.fetch;resetNewsCacheForTests();const requested=[];
  globalThis.fetch=async input=>{const u=new URL(input);requested.push(u);return new Response('<rss><channel></channel></rss>',{headers:{'Content-Type':'application/rss+xml'}});};
  try{for(const t of THEME_CATALOG){const d=await feed(new URL('https://test/news?scope=theme&theme='+t.id),{});assert.deepEqual(d.symbols,t.constituents.map(c=>c.symbol));assert.equal(d.theme_name,t.name);}
    assert.ok(requested.some(u=>u.searchParams.get('symbol')==='TLT'));assert.ok(requested.some(u=>u.searchParams.get('category')==='Cryptocurrencies'));
    await assert.rejects(feed(new URL('https://test/news?scope=theme&theme=unknown'),{}),e=>e.status===404);
  }finally{globalThis.fetch=original;resetNewsCacheForTests();}
});
test('every theme has working quote and heatmap API routes; exposure sources do not overwrite data attribution',async()=>{
  const original=globalThis.fetch;resetSpaceUpstreamForTests();
  const coins=Object.fromEntries(THEMES_BY_ID['crypto-major'].constituents.map(c=>[c.symbol,{stats_24hour:{last:'10',open:'9',volume:'100'}}]));
  globalThis.fetch=async input=>{const u=new URL(input);
    if(u.hostname==='api.exchange.coinbase.com')return Response.json(coins);
    if(u.hostname==='api.coingecko.com')return Response.json([]);
    if(u.pathname.endsWith('/watchlist'))return Response.json({data:u.searchParams.getAll('symbol').map(x=>{const [symbol,asset]=x.split('|');return {symbol:symbol.toUpperCase(),assetClass:asset.toUpperCase(),companyName:symbol,lastSalePrice:'$10',netChange:'$1',previousClosePrice:'$9',percentageChange:'11.11%',marketStatus:'Closed'};})});
    if(u.pathname.endsWith('/summary'))return Response.json({data:{summaryData:{}}});
    throw new Error('Unexpected fixture request '+u.pathname);
  };
  try{for(const t of THEME_CATALOG){for(const [rest,query] of [['theme','id='+t.id],['heatmap','universe=theme:'+t.id]]){
    const u=new URL('https://test/api/space/markets/'+rest+'?'+query);const res=await handle(new Request(u),{}, {},u,rest);assert.equal(res.status,200);const d=await res.json();const rows=d.constituents||d.tiles;assert.equal(rows.length,t.constituents.length);
    if(rest==='theme'&&t.kind!=='crypto')assert.equal(rows[0].source,'Nasdaq');
  }}}finally{globalThis.fetch=original;resetSpaceUpstreamForTests();}
});
test('RSS theme news does not invent constituent relevance for unrelated generic articles',async()=>{
  const original=globalThis.fetch;resetNewsCacheForTests();
  globalThis.fetch=async()=>new Response(`<rss><channel><item><title>Unrelated semiconductor headline</title><link>https://example.com/chip</link><pubDate>${new Date().toUTCString()}</pubDate><nasdaq:tickers>NVDA</nasdaq:tickers></item><item><title>Housing update (DHI)</title><link>https://example.com/home</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
  try{const d=await feed(new URL('https://test/news?scope=theme&theme=housing-rates'),{});assert.deepEqual(d.items.map(i=>i.url),['https://example.com/home']);assert.deepEqual(d.items[0].symbols,['DHI']);}
  finally{globalThis.fetch=original;resetNewsCacheForTests();}
});
test('valid listings omitted by batch quotes use regular-close info data and preserve blank changes as null',async()=>{
  const original=globalThis.fetch;resetSpaceUpstreamForTests();
  globalThis.fetch=async input=>{const u=new URL(input);return Response.json({data:u.pathname.endsWith('/watchlist')?[]:{companyName:'Zebra Technologies',marketStatus:'After-Hours',primaryData:{lastSalePrice:'$103',netChange:'',percentageChange:'',volume:'123'},secondaryData:{lastSalePrice:'$100',netChange:'+5',percentageChange:'+5.26%',lastTradeTimestamp:'Close'}}});};
  try{const {nasdaqQuotes}=await import('./markets.js');const rows=await nasdaqQuotes(['ZBRA']);assert.equal(rows.get('ZBRA').price,100);assert.equal(rows.get('ZBRA').prevClose,95);assert.equal(rows.get('ZBRA').ext.price,103);assert.equal(rows.get('ZBRA').ext.change,null);}
  finally{globalThis.fetch=original;resetSpaceUpstreamForTests();}
});

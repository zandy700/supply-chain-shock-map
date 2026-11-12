import {brokerRoute} from "./broker.js";
export {BrokerSession} from "./broker.js";
import {calendar} from './calendar.js';
import {classify} from './classify.js';
import {workspaceSyncRoute} from './space/workspace-sync.js';
export {WorkspaceSync} from './space/workspace-sync.js';
import {spaceRoute} from './space/router.js';

const MAX_TICKERS = 12;
const SYMBOL = /^[A-Z]{1,5}(?:[.-][A-Z])?$/;
const inFlight = new Map();
const upstreamCache = new Map();
let rateLimitedUntil = 0;
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
class UpstreamError extends Error {
  constructor(code) { super(code); this.code=code; }
}
// Only the Worker calls Finnhub. Credentials never enter URLs, cache keys or errors.
async function finnhub(path, params, env, ctx, ttl=300) {
  const url = new URL('https://finnhub.io/api/v1/'+path);
  for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  const hit=upstreamCache.get(url.href);
  if (hit && hit.expires>Date.now()) return hit.body;
  if (inFlight.has(url.href)) return inFlight.get(url.href);
  const promise = (async()=>{
    if (Date.now()<rateLimitedUntil) throw new UpstreamError('rate_limited');
    for (let attempt=0; attempt<2; attempt++) {
      let response;
      try {
        response = await fetch(url,{headers:{'X-Finnhub-Token':env.FINNHUB_API_KEY},signal:AbortSignal.timeout(12000)});
      } catch { throw new UpstreamError('provider_unavailable'); }
      if (response.status===429) {
        const wait = Math.min(5,Math.max(1,Number(response.headers.get('Retry-After'))||2));
        if (!attempt) { await pause(wait*1000); continue; }
        rateLimitedUntil=Date.now()+60000;
        throw new UpstreamError('rate_limited');
      }
      if (!response.ok) throw new UpstreamError(response.status===401 || response.status===403 ? 'provider_access_denied' : 'provider_unavailable');
      let body;
      try { body = await response.json(); } catch { throw new UpstreamError('provider_unavailable'); }
      if (body?.error) throw new UpstreamError('provider_unavailable');
      if (upstreamCache.size>=512) upstreamCache.delete(upstreamCache.keys().next().value);
      upstreamCache.set(url.href,{body,expires:Date.now()+ttl*1000});
      return body;
    }
  })();
  inFlight.set(url.href,promise);
  try { return await promise; } finally { inFlight.delete(url.href); }
}
function parseInput(raw) {
  if (!raw || raw.length>750) throw new Error('Enter 1–12 tickers or company names, separated by commas.');
  const entries=[...new Map(raw.split(',').map(x=>x.trim()).filter(Boolean).map(x=>[x.toUpperCase(),x])).values()];
  if (!entries.length || entries.length>MAX_TICKERS || entries.some(x=> !/^[a-zA-Z0-9 .&'’()-]{1,60}$/.test(x))) {
    throw new Error('Enter 1–12 valid tickers or company names (up to 60 characters each).');
  }
  return entries;
}
async function portfolioQuotes(tickers, env, ctx) {
  const prices = {};
  if (!env.FINNHUB_API_KEY) return {prices, unavailable:tickers};
  const results = await Promise.allSettled(tickers.map(async ticker => {
    const quote = await finnhub('quote', {symbol:ticker}, env, ctx, 30);
    if (!Number.isFinite(quote?.c) || quote.c <= 0 || !Number.isFinite(quote.t) || quote.t <= 0) {
      throw new UpstreamError('quote_unavailable');
    }
    return {
      price:quote.c,
      previous:Number.isFinite(quote.pc) && quote.pc > 0 ? quote.pc : null,
      asOf:new Date(quote.t * 1000).toISOString()
    };
  }));
  const unavailable = [];
  results.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === 'fulfilled') prices[ticker] = result.value;
    else unavailable.push(ticker);
  });
  return {prices, unavailable};
}
async function resolve(entries,env,ctx) {
  const companies=[], unresolved=[], errors=[], suggestions={};
  for (const input of entries) {
    const q=input.toUpperCase();
    if (!env.FINNHUB_API_KEY) {
      if (SYMBOL.test(q)) companies.push({ticker:q,name:q,verified:false}); else unresolved.push(input);
      continue;
    }
    try {
      const results=await finnhub('search',{q:input,exchange:'US'},env,ctx,86400);
      const candidates=(results.result||[]).filter(x=>SYMBOL.test(x.symbol) && ['Common Stock','ETP','ADR','REIT','NY Reg Shrs'].includes(x.type));
      const exact=candidates.filter(x=>x.symbol===q || x.description?.toUpperCase()===q);
      const prefix=candidates.filter(x=>{
        const name=x.description?.toUpperCase()||'';
        return name.startsWith(q) && !/[A-Z0-9]/.test(name.charAt(q.length));
      });
      // Exact tickers win; company names must have a unique full-word prefix match.
      const matches=exact.length ? exact : prefix;
      const unique=[...new Map(matches.map(x=>[x.symbol,x])).values()];
      if (unique.length!==1) { unresolved.push(input); suggestions[input]=unique.slice(0,5).map(x=>({ticker:x.symbol,name:x.description})); continue; }
      const match=unique[0];
      companies.push({ticker:match.symbol,name:match.description,verified:true});
    } catch (error) { errors.push({input,code:error.code||'provider_unavailable'}); unresolved.push(input); }
  }
  return {companies:[...new Map(companies.map(x=>[x.ticker,x])).values()],unresolved,errors,suggestions};
}
const safeURL = value => { try { const url=new URL(value); return ['https:','http:'].includes(url.protocol)?url.href:null; } catch { return null; } };
async function cachedBriefing(entries,env,ctx,origin) {
  if (!env.FINNHUB_API_KEY) return briefing(entries,env,ctx);
  const cache=globalThis.caches?.default;
  const cacheKey=new Request(origin+'/__briefing-cache?tickers='+encodeURIComponent(entries.map(x=>x.toUpperCase()).join(',')));
  const hit=await cache?.match(cacheKey);
  if (hit) return hit.json();
  const payload=await briefing(entries,env,ctx);
  // Cache complete successful payloads only. Failures stay retryable.
  if (!payload.errors.length) {
    const write=cache?.put(cacheKey,Response.json(payload,{headers:{'Cache-Control':'public, max-age=60'}}));
    if (write) { if (ctx?.waitUntil) ctx.waitUntil(write.catch(()=>{})); else await write; }
  }
  return payload;
}
async function briefing(entries,env,ctx) {
  const resolved=await resolve(entries,env,ctx);
  const now=new Date();
  const from=new Date(now.getTime()-7*86400000).toISOString().slice(0,10);
  const to=now.toISOString().slice(0,10);
  const payload={mode:'live',provider:'Finnhub',as_of:now.toISOString(),window:{from,to},...resolved,tickers:resolved.companies.map(x=>x.ticker),impacts:[],quotes:[],news:[]};
  if (!env.FINNHUB_API_KEY) { payload.notice='Add FINNHUB_API_KEY to the Worker for live news. Sample mode remains available.'; return payload; }
  for (const company of resolved.companies) {
    const ticker=company.ticker;
    try {
      const rows=await finnhub('company-news',{symbol:ticker,from,to},env,ctx);
      if (!Array.isArray(rows)) throw new UpstreamError('provider_unavailable');
      const seen=new Set();
      for (const row of rows) {
        const url=safeURL(row.url);
        if (!row.headline || !url || seen.has(url) || !Number.isFinite(row.datetime) || row.datetime*1000>now.getTime() || row.datetime*1000<now.getTime()-7*86400000) continue;
        seen.add(url);
        const kind=classify(row.headline);
        const article={id:`${ticker}-${row.id}`,title:String(row.headline),url,source:String(row.source||'Finnhub'),date:new Date(row.datetime*1000).toISOString(),affected:[ticker],...kind};
        payload.news.push(article);
        if (kind.sign) payload.impacts.push({...article,category:kind.event_type.replaceAll('_',' '),direction:kind.sign>0?'positive':'negative',confidence:'Low',reason:'From this ticker’s Finnhub news feed. A keyword scenario, not verified exposure, propagation or a forecast.'});
      }
    } catch (error) { payload.errors.push({ticker,resource:'news',code:error.code||'provider_unavailable'}); }
    try {
      const quote=await finnhub('quote',{symbol:ticker},env,ctx,60);
      if (quote.c>0 && quote.t>0) payload.quotes.push({ticker,price:quote.c,change_percent:quote.dp,as_of:new Date(quote.t*1000).toISOString()});
      else payload.errors.push({ticker,resource:'quote',code:'quote_unavailable'});
    } catch(error) { payload.errors.push({ticker,resource:'quote',code:error.code||'provider_unavailable'}); }
  }
  payload.impacts.sort((a,b)=>b.date.localeCompare(a.date));
  payload.news.sort((a,b)=>b.date.localeCompare(a.date));
  // Bound UI response size without altering classification or inventing coverage.
  const perCompany = (items,limit) => {
    const counts=new Map();
    return items.filter(item=>{const ticker=item.affected[0]; const count=counts.get(ticker)||0; counts.set(ticker,count+1); return count<limit;});
  };
  payload.impacts=perCompany(payload.impacts,12);
  payload.news=perCompany(payload.news,20);
  return payload;
}
export function resetUpstreamStateForTests() {
  upstreamCache.clear();
  inFlight.clear();
  rateLimitedUntil = 0;
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname.startsWith('/api/broker/')) return brokerRoute(request,env);
    if (url.pathname === '/api/space/workspace') return workspaceSyncRoute(request,env);
    if (url.pathname.startsWith('/api/space/')) return spaceRoute(request,env,ctx);
    if (request.method!=='GET') return json({error:'Use GET.'},405);
    if (url.pathname==='/api/health') return json({ok:true,finnhub:Boolean(env.FINNHUB_API_KEY)});
    if (!['/api/briefing','/api/catalysts','/api/resolve','/api/calendar','/api/portfolio-quotes'].includes(url.pathname)) return json({error:'Unknown API route.'},404);
    let entries;
    try { entries=parseInput(url.searchParams.get(url.pathname==='/api/resolve'?'q':'tickers')); }
    catch(error) { return json({error:error.message,unresolved:[]},400); }
    try {
      if (url.pathname === '/api/portfolio-quotes') {
        const symbols = entries.map(entry => entry.toUpperCase());
        if (symbols.some(symbol => !SYMBOL.test(symbol))) return json({error:'Use US tickers for portfolio quotes.'},400);
        return json(await portfolioQuotes(symbols, env, ctx));
      }
      if (url.pathname==='/api/calendar') {
        const symbols = entries.map(entry => entry.toUpperCase());
        if (symbols.some(symbol => !SYMBOL.test(symbol))) return json({error:'Use watchlist tickers for the calendar.'},400);
        const peers = env.FINNHUB_API_KEY ? async ticker => {
          const result = await finnhub('stock/peers',{symbol:ticker},env,ctx,86400);
          if (!Array.isArray(result)) throw new Error('Peer lookup unavailable');
          return result.filter(symbol => typeof symbol === 'string' && SYMBOL.test(symbol));
        } : undefined;
        return json(await calendar(symbols, new Date(), peers));
      }
      if (url.pathname==='/api/resolve') {
        const result=await resolve(entries,env,ctx);
        return json({...result,tickers:result.companies.map(x=>x.ticker),verified:Boolean(env.FINNHUB_API_KEY)});
      }
      const result=await cachedBriefing(entries,env,ctx,url.origin);
      if (url.pathname==='/api/catalysts') return json({...result,events:result.impacts,calendar_note:'Recent headline catalysts, not scheduled future events. No live earnings or macro calendar is supplied.'});
      return json(result);
    } catch { return json({error:'Live provider unavailable. Try again shortly.',unresolved:entries},503); }
  }
};

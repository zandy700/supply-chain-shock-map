// Unusual Whales REST tape adapter. Latest trading day; cursor pagination, never fabricated flow.
// Schema: https://api.unusualwhales.com/api/openapi (OptionTradeController.index).
import {json,num,UpstreamError,SYMBOL} from './upstream.js';
export function flowParameters(input) {
  const out=new URLSearchParams(),symbol=(input.get('symbol')||'').trim().toUpperCase();
  if(symbol&&!SYMBOL.test(symbol))throw new UpstreamError('invalid_symbol',400);
  if(symbol)out.set('ticker_symbol',symbol);
  const limit=Number(input.get('limit')||50);if(![25,50,100,200].includes(limit))throw new UpstreamError('invalid_limit',400);out.set('limit',limit);
  const preset=input.get('preset')||'all';if(!['all','ask','bid','big-ask','big-bid','etf-ask','multi'].includes(preset))throw new UpstreamError('invalid_filter',400);
  if(preset.includes('ask'))out.append('tags[]','ask_side');if(preset.includes('bid'))out.append('tags[]','bid_side');
  if(preset.startsWith('big-')||preset==='multi')out.set('min_premium','100000');if(preset==='multi')out.set('is_multi_leg','true');if(preset==='etf-ask')out.append('issue_types[]','ETF');
  for(const [key,param] of [['minPremium','min_premium'],['minVolume','min_volume']])if(input.has(key)){const n=Number(input.get(key));if(!Number.isFinite(n)||n<0||n>1e12)throw new UpstreamError('invalid_filter',400);out.set(param,String(Math.max(n,Number(out.get(param)||0))));}
  const order=input.get('sort')||'time';if(!['time','premium','size','volume','dte'].includes(order))throw new UpstreamError('invalid_sort',400);if(['premium','size'].includes(order))out.set('order',order);
  for(const key of ['older_than','newer_than'])if(input.has(key)){const v=input.get(key);if(v.length>40||!Number.isFinite(Date.parse(v)))throw new UpstreamError('invalid_cursor',400);out.set(key,v);}
  out.set('canceled','false');return out;
}
export function normalizeTrade(r) {
  if(!r||typeof r.option_chain_id!=='string'||!Number.isFinite(Date.parse(r.executed_at)))return null;
  return {id:String(r.id||r.option_chain_id+r.executed_at),symbol:r.underlying_symbol||'',contract:r.option_chain_id,time:r.executed_at,expiry:r.expiry||null,type:r.option_type||null,strike:num(r.strike),price:num(r.price),size:num(r.size),premium:num(r.premium),volume:num(r.volume),openInterest:num(r.open_interest),bid:num(r.nbbo_bid),ask:num(r.nbbo_ask),exchange:r.exchange||null,code:r.upstream_condition_detail||null,tags:Array.isArray(r.tags)?r.tags:[],flags:Array.isArray(r.report_flags)?r.report_flags:[],underlying:num(r.underlying_price)};
}
export async function flowRoute(url,env) {
  const params=flowParameters(url.searchParams);
  if(!env.UNUSUAL_WHALES_API_KEY)return json({error:'flow_not_configured',message:'Options transaction flow requires an Unusual Whales API subscription and server key. The delayed chain and volume/OI scan remain available.'},503);
  let res;try{res=await fetch('https://api.unusualwhales.com/api/option-trades?'+params,{redirect:'manual',headers:{Accept:'application/json',Authorization:'Bearer '+env.UNUSUAL_WHALES_API_KEY},signal:AbortSignal.timeout(20000)});}catch{throw new UpstreamError('flow_provider_unavailable');}
  if(!res.ok)return json({error:res.status===429?'rate_limited':'flow_provider_unavailable',message:res.status===401||res.status===402||res.status===403?'The flow provider requires valid credentials and an eligible API subscription.':'The transaction feed is temporarily unavailable.'},res.status===429?429:502);
  let body;try{body=await res.json();}catch{throw new UpstreamError('flow_provider_unavailable');}
  if(!Array.isArray(body.data))throw new UpstreamError('flow_provider_unavailable');
  const rows=body.data.map(normalizeTrade).filter(Boolean);const times=rows.map(r=>r.time).sort((a,b)=>Date.parse(a)-Date.parse(b));
  return json({rows,source:'Unusual Whales transaction tape',asOf:times.at(-1)||null,checkedAt:new Date().toISOString(),sortScope:['volume','dte'].includes(url.searchParams.get('sort'))?'loaded-page':'provider',oldest:times[0]||null,newest:times.at(-1)||null,limit:Number(params.get('limit')),hasMore:body.data.length===Number(params.get('limit')),note:'Latest trading day only. Reported execution tags describe fills, not trader intent. Availability and latency depend on the provider subscription.'},200,0);
}

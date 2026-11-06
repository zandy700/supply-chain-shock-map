// Each browser gets an opaque cookie. Only its Durable Object can read its OAuth tokens.
const API = 'https://api.snaptrade.com';
const BASE = '/api/broker/';
const DAY = 86400000;
const privateHeaders = {'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'};
const reply = (body, status=200) => Response.json(body, {status, headers:privateHeaders});
const back = result => new Response(null, {status:303, headers:{...privateHeaders, Location:'/?broker='+result+'#/portfolio'}});
const random = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');

function cookieName(url) { return url.protocol === 'https:' ? '__Host-pulse-broker' : 'pulse-local-broker'; }
function cookie(url, id, age) {
  return cookieName(url)+'='+id+'; Max-Age='+age+'; Path=/; HttpOnly; SameSite=Lax'+(url.protocol==='https:' ? '; Secure' : '');
}

export async function brokerRoute(request, env) {
  const url = new URL(request.url);
  const action = url.pathname.slice(BASE.length);
  const method = {start:'POST', callback:'GET', holdings:'GET', disconnect:'POST'}[action];
  if (!method || typeof method !== 'string') return reply({error:'Unknown broker route.'},404);
  if (request.method!==method) return reply({error:'Unsupported method.'},405);
  if (method==='POST' && request.headers.get('Origin')!==url.origin) return reply({error:'Open this action from your portfolio.'},403);
  const enabled = Boolean(env.SNAPTRADE_OAUTH_CLIENT_ID && env.SNAPTRADE_OAUTH_CLIENT_SECRET && env.BROKER_SESSIONS);
  if (!enabled) return action==='holdings' ? reply({enabled:false,connected:false}) : reply({error:'Broker linking needs SnapTrade app credentials.'},503);
  if (url.protocol!=='https:' && !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return reply({error:'Use HTTPS or loopback.'},400);
  const entry = (request.headers.get('Cookie')||'').split(/;\s*/).find(v=>v.startsWith(cookieName(url)+'='));
  let id = entry?.slice(cookieName(url).length+1);
  if (!/^[A-Za-z0-9_-]{43}$/.test(id||'')) id=null;
  if (!id && action!=='start') return action==='callback' ? back('expired') : reply({enabled:true,connected:false});
  const fresh = !id;
  id ||= random();
  const stub = env.BROKER_SESSIONS.get(env.BROKER_SESSIONS.idFromName(url.origin+'|'+id));
  let response;
  try { response = await stub.fetch(request); }
  catch { return reply({error:'Broker service is unavailable. Try again.'},502); }
  const out = new Response(response.body,response);
  if (fresh && action==='start' && response.ok) out.headers.append('Set-Cookie',cookie(url,id,30*86400));
  if (action==='disconnect' && response.ok) out.headers.append('Set-Cookie',cookie(url,'',0));
  return out;
}

async function upstream(url, options) {
  return fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});
}
async function oauthEndpoints() {
  const response=await upstream(API+'/.well-known/oauth-authorization-server');
  if (!response.ok) throw new Error('Discovery failed');
  const data=await response.json();
  if (data.issuer!==API || new URL(data.authorization_endpoint).origin!=='https://dashboard.snaptrade.com' ||
      [data.token_endpoint,data.revocation_endpoint].some(endpoint=>new URL(endpoint).origin!==API)) throw new Error('Invalid OAuth metadata');
  return data;
}
function numeric(value) {
  return (typeof value==='number' || typeof value==='string' && value.trim()) && Number.isFinite(Number(value)) ? Number(value) : null;
}

export async function fetchBrokerAccounts(accessToken) {
  async function get(path) {
    const response=await upstream(API+path,{headers:{Authorization:'Bearer '+accessToken}});
    if (!response.ok) throw Object.assign(new Error('Account data unavailable'),{status:response.status});
    return response.json();
  }
  const list=await get('/accounts');
  const result=[];
  for (const account of list) {
    if (!/^[a-zA-Z0-9-]+$/.test(account.id)) throw new Error('Invalid account ID');
    const path='/accounts/'+account.id;
    const [positions,balances]=await Promise.all([get(path+'/positions/all'),get(path+'/balances')]);
    result.push({
      id:'broker-'+account.id, name:account.name || account.institution_name || 'Brokerage account',
      asOf:positions.data_freshness?.as_of || null,
      balances:balances.map(b=>({currency:b.currency?.code,cash:numeric(b.cash)})),
      positions:positions.results.map(p=>({
        symbol:p.instrument?.symbol || p.instrument?.description || p.instrument?.kind || 'Unknown',
        kind:p.instrument?.kind, exchange:p.instrument?.exchange, currency:p.currency || p.instrument?.currency,
        shares:numeric(p.units), price:numeric(p.price), cost:numeric(p.cost_basis), cashEquivalent:p.cash_equivalent===true
      }))
    });
  }
  return result;
}

export class BrokerSession {
  constructor(state, env) {
    this.store=state.storage;
    this.env=env;
    this.queue=Promise.resolve();
  }
  // A refresh token can be consumed only once. Serialize refresh/disconnect in this session.
  fetch(request) {
    const task=this.queue.then(()=>this.handle(request));
    this.queue=task.catch(()=>{});
    return task.catch(()=>new URL(request.url).pathname.endsWith('/callback') ? back('failed') : reply({error:'SnapTrade could not complete the request. Try again.'},502));
  }
  async alarm() { await this.store.deleteAll(); }
  async post(url, params) {
    return upstream(url,{method:'POST',headers:{
      Authorization:'Basic '+btoa(this.env.SNAPTRADE_OAUTH_CLIENT_ID+':'+this.env.SNAPTRADE_OAUTH_CLIENT_SECRET),
      'Content-Type':'application/x-www-form-urlencoded'
    },body:new URLSearchParams(params)});
  }
  async storageKey() {
    // Also encrypt local Wrangler's SQLite copy. Rotating the app secret requires re-linking.
    const bytes=new TextEncoder().encode('watchlist-pulse/oauth-storage/v1/'+this.env.SNAPTRADE_OAUTH_CLIENT_SECRET);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt']);
  }
  async readGrant() {
    const stored=await this.store.get('grant');
    if (!stored) return null;
    try {
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:stored.iv},await this.storageKey(),stored.ciphertext);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      await this.store.delete('grant');
      return null;
    }
  }
  async saveTokens(response) {
    const data=await response.json();
    if (data.token_type?.toLowerCase()!=='bearer' || !data.access_token || !data.refresh_token ||
        !(Number(data.expires_in)>0) || (data.scope && data.scope.trim()!=='read')) throw new Error('Invalid token response');
    const grant={access:data.access_token, refresh:data.refresh_token, expires:Date.now()+data.expires_in*1000};
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await this.storageKey(),new TextEncoder().encode(JSON.stringify(grant)));
    await this.store.put('grant',{iv,ciphertext});
    return grant;
  }
  async handle(request) {
    const url=new URL(request.url);
    const callback=url.origin+BASE+'callback';
    const action=url.pathname.slice(BASE.length);
    let grant=await this.readGrant();
    if (action==='start') {
      if (grant) return reply({error:'Disconnect your existing link before switching SnapTrade users.'},409);
      const meta=await oauthEndpoints();
      const state=random(), verifier=random();
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
      const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
      await this.store.put('pending',{state,verifier,expires:Date.now()+600000});
      await this.store.setAlarm(Date.now()+600000);
      const auth=new URL(meta.authorization_endpoint);
      auth.search=new URLSearchParams({client_id:this.env.SNAPTRADE_OAUTH_CLIENT_ID,redirect_uri:callback,
        response_type:'code',scope:'read',state,code_challenge:challenge,code_challenge_method:'S256'});
      return reply({url:auth.href});
    }
    if (action==='callback') {
      const pending=await this.store.get('pending');
      if (!pending || pending.expires<Date.now() || url.searchParams.get('state')!==pending.state) return back('expired');
      await this.store.delete('pending');
      if (!url.searchParams.get('code') || url.searchParams.has('error')) return back('cancelled');
      if (url.searchParams.has('iss') && url.searchParams.get('iss')!==API) return back('failed');
      const meta=await oauthEndpoints();
      const token=await this.post(meta.token_endpoint,{grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:pending.verifier,redirect_uri:callback});
      if (!token.ok) return back('failed');
      await this.saveTokens(token);
      await this.store.setAlarm(Date.now()+30*DAY);
      return back('linked');
    }
    if (!grant) return reply({enabled:true,connected:false});
    if (action==='disconnect') {
      const meta=await oauthEndpoints();
      const response=await this.post(meta.revocation_endpoint,{token:grant.refresh,token_type_hint:'refresh_token'});
      if (!response.ok) throw new Error('Revocation failed');
      await this.store.deleteAll();
      return reply({enabled:true,connected:false});
    }
    if (grant.expires>=Date.now()+60000) {
      try { return reply({enabled:true,connected:true,accounts:await fetchBrokerAccounts(grant.access)}); }
      catch (error) {
        if (error.status!==401) return reply({enabled:true,connected:true,error:'Holdings could not be loaded. Refresh or manage your broker connections.'});
      }
    }
    {
      const meta=await oauthEndpoints();
      const token=await this.post(meta.token_endpoint,{grant_type:'refresh_token',refresh_token:grant.refresh});
      if (!token.ok) {
        if ((await token.json()).error==='invalid_grant') {
          await this.store.deleteAll();
          return reply({enabled:true,connected:false,message:'Your broker link expired. Connect again.'});
        }
        throw new Error('Refresh failed');
      }
      grant=await this.saveTokens(token);
    }
    try { return reply({enabled:true,connected:true,accounts:await fetchBrokerAccounts(grant.access)}); }
    catch { return reply({enabled:true,connected:true,error:'Holdings could not be loaded. Refresh or manage your broker connections.'}); }
  }
}

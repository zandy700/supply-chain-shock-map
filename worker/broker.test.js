import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerRoute,BrokerSession} from './broker.js';
import {brokerAccount} from '../web/portfolio-broker.js';

function fixture() {
  const sessions=new Map();
  const env={SNAPTRADE_OAUTH_CLIENT_ID:'test-id',SNAPTRADE_OAUTH_CLIENT_SECRET:'test-secret',
    BROKER_SESSIONS:{idFromName:n=>n,get(n){
      if (!sessions.has(n)) {
        const values=new Map();
        sessions.set(n,new BrokerSession({storage:{get:k=>values.get(k),put:(k,v)=>values.set(k,v),
          delete:k=>values.delete(k),deleteAll:()=>values.clear(),setAlarm:()=>{}}},env));
      }
      return sessions.get(n);
    }}};
  const origin='http://127.0.0.1:8787';
  function call(path,cookie='',method='GET',from=origin) {
    return brokerRoute(new Request(origin+'/api/broker/'+path,{method,headers:{Cookie:cookie,Origin:from}}),env);
  }
  return {call,env,sessions};
}
test('broker setup and wrong-origin requests cannot expose holdings',async()=>{
  const {call,env}=fixture();
  assert.equal((await call('start','','POST','https://elsewhere.example')).status,403);
  assert.equal((await call('start')).status,405);
  assert.deepEqual(await (await call('holdings')).json(),{enabled:true,connected:false});
  delete env.SNAPTRADE_OAUTH_CLIENT_SECRET;
  assert.deepEqual(await (await call('holdings')).json(),{enabled:false,connected:false});
  assert.equal((await call('start','','POST')).status,503);
});
test('read-only PKCE, callback binding, separate browsers, refresh rotation and disconnect',async t=>{
  const {call,sessions}=fixture();
  const grants=[];
  let revoked=false;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const path=new URL(url).pathname;
    if(path.startsWith('/.well-known')) return Response.json({issuer:'https://api.snaptrade.com',
      authorization_endpoint:'https://dashboard.snaptrade.com/oauth/authorize',token_endpoint:'https://api.snaptrade.com/oauth/token/',
      revocation_endpoint:'https://api.snaptrade.com/oauth/revoke_token/'});
    if (path==='/oauth/token/') {
      grants.push(options.body);
      return Response.json({access_token:'access',refresh_token:'refresh-'+grants.length,token_type:'Bearer',expires_in:36000,scope:'read'});
    }
    if (path==='/oauth/revoke_token/') {
      assert.equal(options.body.get('token'),'refresh-2');revoked=true;return new Response();
    }
    assert.equal(options.headers.Authorization,'Bearer access');
    if (path==='/accounts') return Response.json([{id:'account-1',name:'Example'}]);
    if (path.endsWith('/balances')) return Response.json([{currency:{code:'USD'},cash:15}]);
    if (path.endsWith('/positions/all')) return Response.json({results:[{instrument:{symbol:'ASML',kind:'adr',exchange:'XNAS'},currency:'USD',units:'0.5',price:'200',cost_basis:null}],data_freshness:{as_of:'2026-11-05T00:00:00Z'}});
    throw Error('Unexpected path');
  });
  async function start() {
    const res=await call('start','','POST');
    assert.match(res.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax/);
    const url=new URL((await res.json()).url);
    assert.equal(url.searchParams.get('scope'),'read');
    assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:8787/api/broker/callback');
    return {cookie:res.headers.get('Set-Cookie').split(';')[0],params:url.searchParams};
  }
  const a=await start(), b=await start();
  const callback='callback?code=code&state='+a.params.get('state');
  assert.match((await call(callback,b.cookie)).headers.get('Location'),/expired/);
  assert.match((await call(callback,a.cookie)).headers.get('Location'),/linked/);
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(grants[0].get('code_verifier')));
  assert.equal(Buffer.from(digest).toString('base64url'),a.params.get('code_challenge'));
  assert.match((await call(callback,a.cookie)).headers.get('Location'),/expired/);
  assert.equal((await (await call('holdings',b.cookie)).json()).connected,false);
  const session=[...sessions.values()][0];
  assert.ok((await session.store.get('grant')).ciphertext);
  const future=Date.now()+36001000;
  t.mock.method(Date,'now',()=>future);
  const [first,second]=await Promise.all([call('holdings',a.cookie),call('holdings',a.cookie)]);
  assert.match(first.headers.get('Cache-Control'),/no-store/);
  assert.equal(grants.length,2);
  assert.equal(grants[1].get('refresh_token'),'refresh-1');
  assert.deepEqual(await first.clone().json(),await second.json());
  const body=await first.text();assert.doesNotMatch(body,/access_token|refresh_token|test-secret/);
  const model=brokerAccount(JSON.parse(body).accounts[0]);
  assert.equal(model.holdings[0].shares,0.5);assert.equal(model.cash,15);assert.equal(model.complete,true);
  assert.equal((await call('disconnect',a.cookie,'POST')).status,200);
  assert.equal(revoked,true);assert.equal((await (await call('holdings',a.cookie)).json()).connected,false);
});
test('mixed instruments, unknown cash, and foreign balances cannot become complete USD totals',()=>{
  const raw={positions:[{kind:'stock',symbol:'T',currency:'CAD',shares:20},{kind:'mutualfund',cashEquivalent:true}],
    balances:[{currency:'USD',cash:null},{currency:'CAD',cash:23}]};
  const account=brokerAccount(raw);
  assert.equal(account.complete,false);assert.equal(account.other.length,1);assert.equal(account.holdings.length,0);
});

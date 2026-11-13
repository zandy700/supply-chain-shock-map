import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const fixtures = {};
for (const name of ['briefing','companies','ledger','graph']) {
  fixtures[name] = JSON.parse(await readFile(new URL('../web/seed/'+name+'.json', import.meta.url), 'utf8'));
}
async function dashboard(storage = new Map(), { blocked = false, resolved = null, respond, search = '', hash = '#/watchlist' } = {}) {
  let form, html = '', removeButtons = [];
  const requests = [];
  const element = () => ({textContent:'',innerHTML:'',classList:{toggle(){}},focus(){},querySelectorAll(){return [];}});
  const nodes = Object.fromEntries(['nav','footer','.sample'].map(k=>[k,element()]));
  const main = element();
  const makeForm = () => {
    const input = {value:'',readOnly:false,focus(){}}, error=element(), button={disabled:false,textContent:'Add to watchlist'};
    return {isConnected:true,elements:{companies:input},error,button,listeners:{},querySelector:s=>s==='#form-error'?error:button,addEventListener(name,fn){this.listeners[name]=fn;}};
  };
  Object.defineProperty(main,'innerHTML',{get:()=>html,set:value=>{html=value;removeButtons=[...value.matchAll(/data-remove="([^"]+)"/g)].map(m=>({dataset:{remove:m[1]}}));if(form)form.isConnected=false;form=value.includes('id="watchlist-form"')?makeForm():null;}});
  main.querySelectorAll = selector => selector === '[data-remove]' ? removeButtons : [];
  const location={search,hash};
  const windowEvents=new EventTarget();
  const context=vm.createContext({console,URLSearchParams,AbortSignal,AbortController,location,
    localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(blocked)throw new Error('QuotaExceededError');storage.set(k,v);}},
    document:{body:element(),querySelector:s=>s==='main'?main:s==='#watchlist-form'?form:s==='#companies'?form?.elements.companies:s==='#form-error'?form?.error:nodes[s]},
    history:{pushState(_,__,hash){location.hash=hash;},replaceState(_,__,hash){location.hash=hash;}},
    window:{addEventListener:windowEvents.addEventListener.bind(windowEvents),dispatchEvent:windowEvents.dispatchEvent.bind(windowEvents),scrollTo(){}},
    fetch:async url=>{requests.push(url);if(url.startsWith('seed/'))return {ok:true,json:async()=>fixtures[url.slice(5,-5)]};if(respond){const payload=await respond(url);if(payload)return {ok:true,json:async()=>payload};}if(url.startsWith('/api/resolve')&&resolved)return {ok:true,json:async()=>resolved};return {ok:false,json:async()=>({error:'Quote and name lookup service unavailable'})};}
  });
  vm.runInContext(source,context,{filename:new URL('../web/app.js',import.meta.url).pathname,importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER});
  await vm.runInContext('sharedReady',context);
  for(let i=0;i<5&&!form;i++)await new Promise(resolve=>setImmediate(resolve));
  return {storage,requests,get html(){return html;},get error(){return form?.error.textContent;},get input(){return form?.elements.companies.value;},get stocks(){return JSON.parse(vm.runInContext('JSON.stringify(watchlist)',context));},
    run:code=>vm.runInContext(code,context),
    notify(key='watchlist-pulse'){const event=new Event('storage');event.key=key;windowEvents.dispatchEvent(event);},
    navReady(){windowEvents.dispatchEvent(new Event('ultimater:nav-ready'));},
    remove(symbol){removeButtons.find(b=>b.dataset.remove===symbol).onclick();},
    async add(value){form.elements.companies.value=value;await form.listeners.submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));}};
}

test('dashboard saves ticker additions without quote/name APIs and reload restores the exact list', async () => {
  const first=await dashboard();await first.add('MSFT, BRK.B');
  assert.deepEqual(first.stocks,['MSFT','BRK.B']);
  assert.equal(first.storage.get('watchlist-pulse'),'["MSFT","BRK.B"]');
  assert.equal(first.requests.some(u=>u.startsWith('/api/resolve')),false);
  const reloaded=await dashboard(first.storage);assert.deepEqual(reloaded.stocks,['MSFT','BRK.B']);assert.match(reloaded.html,/data-remove="MSFT"/);
  await reloaded.add('NVDA, msft');assert.deepEqual(reloaded.stocks,['MSFT','BRK.B','NVDA']);
  reloaded.remove('MSFT');assert.deepEqual((await dashboard(first.storage)).stocks,['BRK.B','NVDA']);
});

test('an empty first visit opens an overview with news, portfolio, Analyzer and setup access', async () => {
  const page=await dashboard(new Map(),{hash:''});
  assert.match(page.html,/<h1>Your market workspace<\/h1>/);
  for(const href of ['#/briefing','#/portfolio','/space?view=analysis','/setup']) assert.ok(page.html.includes(`href="${href}"`));
  assert.match(page.html,/ultimater-local-app\.zip/);
  assert.doesNotMatch(page.html,/id="watchlist-form"/);
  assert.equal(page.run('document.title'),'Overview · Ultimater');
  const nav=page.run('document.querySelector("nav").innerHTML');
  assert.match(nav,/News tracker/);assert.match(nav,/Portfolio/);assert.match(nav,/Setup &amp; download/);
  assert.equal(page.requests.some(url=>url.startsWith('/api/')),false);
  const watchlist=await dashboard();assert.match(watchlist.html,/id="watchlist-form"/);
});

test('overview keeps a real portfolio entry in sample mode without writing live storage', async () => {
  const storage=new Map([['watchlist-pulse','["INTC"]']]);
  const page=await dashboard(storage,{hash:'#/home',search:'?seed=demo'});
  assert.match(page.html,/href="\/#\/portfolio"/);
  assert.equal(storage.get('watchlist-pulse'),'["INTC"]');
  assert.equal(page.run('document.title'),'Overview · Ultimater');
});

test('failed company-name lookup or blocked browser storage never falsely claims a saved stock', async () => {
  const first=await dashboard();await first.add('An Unknown Company');assert.deepEqual(first.stocks,[]);assert.match(first.error,/unavailable|ticker/i);
  const blocked=await dashboard(new Map(),{blocked:true});await blocked.add('MSFT');assert.deepEqual(blocked.stocks,[]);assert.match(blocked.error,/storage is unavailable/);
});

test('Intel resolves to INTC offline while short company names still need verification', async () => {
  const page=await dashboard();await page.add('Intel, MSFT');assert.deepEqual(page.stocks,['INTC','MSFT']);
  assert.equal(page.requests.some(u=>u.startsWith('/api/resolve')),false);
  await page.add('Cisco');assert.deepEqual(page.stocks,['INTC','MSFT']);assert.match(page.error,/unavailable|ticker/i);
});

test('dashboard batches every saved stock, keeps a typed draft during shared updates, and isolates demo storage', async () => {
  const symbols=Array.from({length:40},(_,i)=>'T'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26));
  const storage=new Map([['watchlist-pulse',JSON.stringify(symbols)]]);
  const page=await dashboard(storage,{respond:url=>url.startsWith('/api/briefing')?{as_of:'2026-11-12T00:00:00Z',tickers:new URL(url,'http://localhost').searchParams.get('tickers').split(','),companies:[],news:[],quotes:[],impacts:[],unresolved:[],errors:[]}:null});
  await new Promise(resolve=>setImmediate(resolve));
  const batches=page.requests.filter(url=>url.startsWith('/api/briefing')).map(url=>new URL(url,'http://localhost').searchParams.get('tickers').split(','));
  assert.equal(batches.length,4);assert.ok(batches.every(batch=>batch.length<=12));assert.deepEqual(batches.flat(),symbols);
  assert.equal(page.run('liveSourceLabel()'),'Research data');
  page.run("document.querySelector('#companies').value='Draft company'");page.navReady();assert.equal(page.input,'Draft company');
  storage.set('watchlist-pulse','["NVDA"]');page.notify();assert.deepEqual(page.stocks,['NVDA']);assert.equal(page.input,'Draft company');
  const demo=await dashboard(storage,{search:'?seed=demo'});await demo.add('INTC');
  assert.equal(storage.get('watchlist-pulse'),'["NVDA"]');assert.ok(JSON.parse(storage.get('watchlist-pulse-demo')).includes('INTC'));
});


test('company-name resolution still combines with direct ticker entries', async () => {
  const page=await dashboard(new Map(),{resolved:{tickers:['ASML'],unresolved:[],errors:[],suggestions:{}}});
  await page.add('MSFT, ASML Holding');assert.deepEqual(page.stocks,['MSFT','ASML']);
  const lookup=page.requests.find(u=>u.startsWith('/api/resolve'));
  assert.equal(new URL(lookup,'http://localhost').searchParams.get('q'),'ASML HOLDING');
});

test('duplicates, invalid entries and capacity errors preserve the existing saved stocks', async () => {
  const symbols=Array.from({length:40},(_,i)=>'T'+String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26));
  const storage=new Map([['watchlist-pulse',JSON.stringify(symbols)]]), page=await dashboard(storage);
  await page.add('TAA');assert.match(page.error,/Already/);assert.deepEqual(page.stocks,symbols);
  await page.add('NFLX');assert.match(page.error,/40 companies/);assert.deepEqual(page.stocks,symbols);
  await page.add('<script>');assert.deepEqual(page.stocks,symbols);assert.equal(storage.get('watchlist-pulse'),JSON.stringify(symbols));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const fixtures = {};
for (const name of ['briefing','companies','ledger','graph']) {
  fixtures[name] = JSON.parse(await readFile(new URL('../web/seed/'+name+'.json', import.meta.url), 'utf8'));
}
async function dashboard(storage = new Map(), { blocked = false, resolved = null } = {}) {
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
  const location={search:'',hash:'#/watchlist'};
  const context=vm.createContext({console,URLSearchParams,AbortSignal,location,
    localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(blocked)throw new Error('QuotaExceededError');storage.set(k,v);}},
    document:{body:element(),querySelector:s=>s==='main'?main:s==='#watchlist-form'?form:s==='#companies'?form?.elements.companies:s==='#form-error'?form?.error:nodes[s]},
    history:{pushState(_,__,hash){location.hash=hash;},replaceState(_,__,hash){location.hash=hash;}},
    window:{addEventListener(){},scrollTo(){}},
    fetch:async url=>{requests.push(url);if(url.startsWith('seed/'))return {ok:true,json:async()=>fixtures[url.slice(5,-5)]};if(url.startsWith('/api/resolve')&&resolved)return {ok:true,json:async()=>resolved};return {ok:false,json:async()=>({error:'Quote and name lookup service unavailable'})};}
  });
  vm.runInContext(source,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {storage,requests,get html(){return html;},get error(){return form?.error.textContent;},get input(){return form?.elements.companies.value;},get stocks(){return JSON.parse(vm.runInContext('JSON.stringify(watchlist)',context));},
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

test('failed company-name lookup or blocked browser storage never falsely claims a saved stock', async () => {
  const first=await dashboard();await first.add('An Unknown Company');assert.deepEqual(first.stocks,[]);assert.match(first.error,/unavailable|ticker/i);
  const blocked=await dashboard(new Map(),{blocked:true});await blocked.add('MSFT');assert.deepEqual(blocked.stocks,[]);assert.match(blocked.error,/storage is unavailable/);
});


test('company-name resolution still combines with direct ticker entries', async () => {
  const page=await dashboard(new Map(),{resolved:{tickers:['ASML'],unresolved:[],errors:[],suggestions:{}}});
  await page.add('MSFT, ASML Holding');assert.deepEqual(page.stocks,['MSFT','ASML']);
  const lookup=page.requests.find(u=>u.startsWith('/api/resolve'));
  assert.equal(new URL(lookup,'http://localhost').searchParams.get('q'),'ASML HOLDING');
});

test('duplicates, invalid entries and capacity errors preserve the existing saved stocks', async () => {
  const symbols=['AAPL','META','NVDA','TSLA','MSFT','AMZN','GOOG','TSM','ASML','AMD','INTC','AVGO'];
  const storage=new Map([['watchlist-pulse',JSON.stringify(symbols)]]), page=await dashboard(storage);
  await page.add('MSFT');assert.match(page.error,/Already/);assert.deepEqual(page.stocks,symbols);
  await page.add('NFLX');assert.match(page.error,/12 companies/);assert.deepEqual(page.stocks,symbols);
  await page.add('<script>');assert.deepEqual(page.stocks,symbols);assert.equal(storage.get('watchlist-pulse'),JSON.stringify(symbols));
});

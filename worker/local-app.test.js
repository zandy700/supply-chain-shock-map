import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { localAppServer, saveLocalCredentials, localProviderStatus } from '../scripts/local-app.mjs';
import { buildLocalApp } from '../scripts/build-local-app.mjs';

async function temp(t) { const root = await mkdtemp(join(tmpdir(), 'ultimater-local-')); t.after(() => rm(root,{recursive:true,force:true})); return root; }
async function listen(t, server) { await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })); return `http://127.0.0.1:${server.address().port}`; }
const credentials = { provider: 'alpaca', credentials: { ALPACA_API_KEY: 'key-fixture', ALPACA_API_SECRET: 'secret-fixture' } };

test('local credential writes preserve unrelated settings, replace duplicates, and expose status only', async t => {
  const root = await temp(t), target = join(root,'.dev.vars');
  await writeFile(target,'# Keep this comment\nFINNHUB_API_KEY="news-fixture"\nOTHER="first\nsecond"\nALPACA_API_KEY="old"\nALPACA_API_KEY="duplicate"\n');
  const status = await saveLocalCredentials(root, credentials), saved = await readFile(target,'utf8');
  assert.match(saved,/# Keep this comment\nFINNHUB_API_KEY="news-fixture"\nOTHER="first\nsecond"\n/);
  assert.equal((saved.match(/ALPACA_API_KEY=/g)||[]).length,1); assert.match(saved,/ALPACA_API_SECRET="secret-fixture"/);
  if(process.platform!=='win32') assert.equal((await stat(target)).mode & 0o777,0o600);
  assert.equal(status.alpaca.configured,true); assert.equal(status.finnhub.configured,true); assert.equal(status.anthropic.configured,false);
  assert.ok(!JSON.stringify(status).includes('fixture'));
  const removed = await saveLocalCredentials(root,{provider:'alpaca',remove:true});
  assert.equal(removed.alpaca.configured,false); assert.equal(removed.finnhub.configured,true);
  assert.ok(!(await readFile(target,'utf8')).includes('ALPACA_'));
});

test('invalid and partial credentials never change existing bytes or leave temporary files', async t => {
  const root = await temp(t), target=join(root,'.dev.vars'), original='FINNHUB_API_KEY="keep"\n'; await writeFile(target,original);
  const invalid = [
    {provider:'not-a-provider',credentials:{}},
    {provider:'alpaca',credentials:{ALPACA_API_KEY:'only-one'}},
    {provider:'alpaca',credentials:{...credentials.credentials,EXTRA:'injection'}},
    {provider:'alpaca',credentials:{...credentials.credentials,ALPACA_API_SECRET:'line\ninjection=bad'}},
    {provider:'alpaca',credentials:{...credentials.credentials,ALPACA_API_SECRET:'"quote'}},
    {provider:'alpaca',remove:true,credentials:credentials.credentials},
    {provider:'alpaca',remove:false},
    {provider:'alpaca',credentials:{...credentials.credentials,ALPACA_API_SECRET:'x'.repeat(4097)}}
  ];
  for(const input of invalid){await assert.rejects(saveLocalCredentials(root,input));assert.equal(await readFile(target,'utf8'),original);}
  assert.deepEqual(await readdir(root),['.dev.vars']);
});

test('setup refuses symlink and directory credentials targets without changing their destination',async t=>{
  const root=await temp(t), destination=join(root,'outside'), target=join(root,'.dev.vars'); await writeFile(destination,'private-original');
  try{await symlink(destination,target);}catch(error){if(process.platform==='win32'&&error.code==='EPERM'){t.skip('symlinks need Windows developer permission');return;}throw error;}
  await assert.rejects(saveLocalCredentials(root,credentials),/regular/);assert.equal(await readFile(destination,'utf8'),'private-original');
  await rm(target);await mkdir(target);await assert.rejects(localProviderStatus(root),/regular/);
});

test('an unfinished existing quoted value cannot swallow unrelated settings during replacement',async t=>{
  const root=await temp(t), target=join(root,'.dev.vars'), original='ALPACA_API_KEY="unfinished\nFINNHUB_API_KEY=keep-this\n';
  await writeFile(target,original);
  await assert.rejects(saveLocalCredentials(root,credentials),/unfinished quoted/);
  assert.equal(await readFile(target,'utf8'),original);
  assert.deepEqual(await readdir(root),['.dev.vars']);
});

test('local setup validates exact browser origin, CSRF, method, body type and size',async t=>{
  const root=await temp(t), server=localAppServer({root,workerPort:1}), base=await listen(t,server);
  const status=await(await fetch(base+'/api/setup/status')).json(); assert.equal(status.mode,'local');assert.equal(status.writable,true);assert.equal(status.csrfToken.length,64);
  const post=(body,headers={})=>fetch(base+'/api/setup/credentials',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Ultimater-CSRF':status.csrfToken,...headers},body:typeof body==='string'?body:JSON.stringify(body)});
  for(const [headers,code] of [[{Origin:'https://evil.test'},403],[{Origin:''},403],[{'X-Ultimater-CSRF':'bad'},403],[{'X-Ultimater-CSRF':'é'.repeat(64)},403],[{'Content-Type':'text/plain'},415],[{'Sec-Fetch-Site':'cross-site'},403]]){
    const response=await post(credentials,headers);assert.equal(response.status,code);assert.ok(!(await response.text()).includes('secret-fixture'));
  }
  assert.equal((await fetch(base+'/api/setup/credentials')).status,405);
  assert.equal((await post('not-json')).status,400);
  assert.equal((await post('x'.repeat(20000))).status,413);
  const badHost=await new Promise(resolve=>{const req=request(base+'/api/setup/status',{headers:{Host:'evil.test'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.end();});
  assert.equal(badHost,403);assert.deepEqual(await readdir(root),[]);
});

test('saving restarts once, blocks overlapping saves, and returns no credential values',async t=>{
  const root=await temp(t);let release,started=0;const gate=new Promise(resolve=>{release=resolve;});
  const server=localAppServer({root,workerPort:1,onConfigChange:()=>{started++;return gate;}}),base=await listen(t,server);
  const initial=await(await fetch(base+'/api/setup/status')).json(),headers={Origin:base,'Content-Type':'application/json','X-Ultimater-CSRF':initial.csrfToken};
  const saved=await fetch(base+'/api/setup/credentials',{method:'POST',headers,body:JSON.stringify(credentials)}),body=await saved.json();
  assert.equal(saved.status,200);assert.equal(body.ok,true);assert.equal(body.providers.alpaca.configured,true);assert.ok(!JSON.stringify(body).includes('fixture'));assert.equal(started,1);
  assert.equal((await(await fetch(base+'/api/setup/status')).json()).restarting,true);
  assert.equal((await fetch(base+'/api/setup/credentials',{method:'POST',headers,body:JSON.stringify(credentials)})).status,409);
  release();await new Promise(setImmediate);
  assert.equal((await(await fetch(base+'/api/setup/status')).json()).restarting,false);
});

test('the local proxy preserves external Host and Origin for broker callbacks and handles restart state',async t=>{
  const root=await temp(t), upstream=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({host:req.headers.host,origin:req.headers.origin,path:req.url}));});
  await listen(t,upstream);let ready=true;
  const server=localAppServer({root,workerPort:upstream.address().port,isReady:()=>ready}),base=await listen(t,server);
  const result=await(await fetch(base+'/api/broker/status?x=1',{headers:{Origin:base}})).json();
  assert.equal(result.host,new URL(base).host);assert.equal(result.origin,base);assert.equal(result.path,'/api/broker/status?x=1');
  ready=false;assert.equal((await fetch(base+'/api/briefing?tickers=AAPL')).status,503);
  assert.equal((await fetch(base+'/api/setup/status')).status,200);
});

test('the full local archive includes runtime modules and rules but excludes keys, account data and dependencies',async t=>{
  const root=await temp(t);
  for(const dir of ['web/shared','web/data','worker/space','scripts','docs','node_modules','.wrangler'])await mkdir(join(root,dir),{recursive:true});
  const fixtures={'web/index.html':'app','web/shared/api-providers.js':'metadata','web/.dev.vars':'secret-web','web/data/private.json':'private-web','worker/index.js':'runtime','worker/rules.json':'{}','worker/a.test.js':'test','worker/space/router.js':'router','scripts/local-app.mjs':'launcher','docs/local-app.md':'setup guide','package.json':JSON.stringify({name:'watchlist-pulse',type:'module',devDependencies:{wrangler:'4.157.0'}}),'package-lock.json':'{}','wrangler.jsonc':'{}','LICENSE':'license','NOTICE':'notice','.dev.vars':'secret-root','node_modules/private.js':'dependency-private','.wrangler/user.json':'user-private'};
  for(const[name,body]of Object.entries(fixtures))await writeFile(join(root,name),body);
  const result=await buildLocalApp({root}), names=[];
  async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())await walk(path);else names.push(path.slice(result.directory.length+1));}}await walk(result.directory);
  for(const required of ['web/index.html','web/shared/api-providers.js','worker/index.js','worker/rules.json','worker/space/router.js','scripts/local-app.mjs','README.md','package-lock.json'])assert.ok(names.includes(required),required);
  for(const forbidden of ['.dev.vars','web/.dev.vars','web/data/private.json','worker/a.test.js','node_modules/private.js','.wrangler/user.json'])assert.ok(!names.includes(forbidden),forbidden);
  const manifest=JSON.parse(await readFile(join(result.directory,'package.json'),'utf8'));assert.equal(manifest.scripts.start,'node scripts/local-app.mjs');assert.equal(manifest.engines.node,'>=22');
  const zip=await readFile(result.zip);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.ok(zip.includes(Buffer.from('ultimater-local-app/README.md')));assert.ok(!zip.includes(Buffer.from('secret-root')));assert.ok(!zip.includes(Buffer.from('secret-web')));
  const unzip=spawnSync('unzip',['-t',result.zip],{encoding:'utf8'});if(!unzip.error)assert.equal(unzip.status,0,unzip.stdout+unzip.stderr);
});

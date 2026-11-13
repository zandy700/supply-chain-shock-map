// Real first-launch smoke check for the freshly built full local download.
// This script uses synthetic tokens only and never requests third-party market data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] || fileURLToPath(new URL('../dist/ultimater-local-app', import.meta.url)));
const port = Number(process.env.ULTIMATER_SMOKE_PORT || 8870), workerPort = Number(process.env.ULTIMATER_SMOKE_WORKER_PORT || 8871);
const origin = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
async function absent(path) { try { await access(path); return false; } catch { return true; } }
async function portFree(number) {
  const probe = createServer();
  await new Promise((resolveProbe,reject) => { probe.once('error',reject); probe.listen(number,'127.0.0.1',resolveProbe); });
  await new Promise(resolveClose => probe.close(resolveClose));
}
async function until(check, message, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await check(); if (result) return result; } catch (error) { if(error.fatal)throw error; /* allow the owned process to finish a restart */ }
    await pause(250);
  }
  throw new Error(message);
}
const json = async (path, options) => {
  const response = await fetch(origin + path,{...options,signal:AbortSignal.timeout(2000)});
  return {response,body:await response.json()};
};

// IPC shutdown exercises app.close() on every platform; direct process-tree cleanup
// is a fallback only when the owned smoke process cannot complete that shutdown.
const bridge = `
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const [root,port,workerPort]=process.argv.slice(1);
let app,stopping=false,requested=false;
async function close(){requested=true;if(stopping||!app)return;stopping=true;await app.close();process.send?.({type:'closed'});process.exit(0);}
process.on('message',message=>{if(message?.type==='close')close().catch(()=>process.exit(1));});
process.on('disconnect',()=>close().catch(()=>process.exit(1)));
try{
  const {startLocalApp}=await import(pathToFileURL(resolve(root,'scripts/local-app.mjs')).href);
  app=await startLocalApp({root,port:Number(port),workerPort:Number(workerPort)});
  if(requested)await close();else process.send?.({type:'ready'});
}catch{process.send?.({type:'failed'});process.exit(1);}
`;
let child, output = '', exited = false, exitCode, ready = false, failed = false;
async function closeChild() {
  if (!child || exited) return;
  if (child.connected) child.send({type:'close'});
  try { await until(() => exited,'The smoke launcher did not shut down.',30_000); return; } catch { /* exact owned tree fallback */ }
  if (process.platform === 'win32') {
    await new Promise(resolveKill => {
      const killer = spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
      killer.once('exit',resolveKill);killer.once('error',resolveKill);
    });
  } else {
    try { process.kill(-child.pid,'SIGTERM'); } catch { /* already exited */ }
  }
  await until(() => exited,'The owned smoke process could not be stopped.',10_000);
}

try {
  assert.ok(Number.isInteger(port) && Number.isInteger(workerPort) && port!==workerPort && port>=1024 && workerPort>=1024 && port<=65535 && workerPort<=65535,'Use two distinct valid smoke ports.');
  assert.ok(await absent(resolve(root,'node_modules')),'Build a fresh local download before smoke testing: node_modules must be absent.');
  assert.ok(await absent(resolve(root,'.dev.vars')),'Build a fresh local download before smoke testing: credentials must be absent.');
  await portFree(port); await portFree(workerPort);
  child = spawn(process.execPath,['--input-type=module','-e',bridge,root,String(port),String(workerPort)],{
    cwd:root,stdio:['ignore','pipe','pipe','ipc'],detached:process.platform!=='win32',windowsHide:true,
    env:{...process.env,WRANGLER_SEND_METRICS:'false'}
  });
  for(const stream of [child.stdout,child.stderr]) stream.on('data',chunk=>{output=(output+chunk.toString()).slice(-20_000);});
  child.on('message',message=>{if(message?.type==='ready')ready=true;if(message?.type==='failed')failed=true;});
  child.once('exit',code=>{exited=true;exitCode=code;}); child.once('error',()=>{failed=true;});
  await until(()=>{if(failed||exited)throw Object.assign(new Error('The fresh local download did not start.'),{fatal:true});return ready;},'The fresh local download did not become ready.',180_000);
  const initial = await json('/api/setup/status');
  assert.equal(initial.response.status,200);assert.equal(initial.body.mode,'local');assert.equal(initial.body.writable,true);assert.equal(initial.body.providers.alpaca.configured,false);
  for(const path of ['/#/home','/setup']){const response=await fetch(origin+path,{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200,path);assert.match(await response.text(),/Ultimater/,path);}
  assert.equal((await json('/api/space/options/status')).body.configured,false);
  const fixture={provider:'alpaca',credentials:{ALPACA_API_KEY:'SMOKE-ONLY-KEY',ALPACA_API_SECRET:'SMOKE-ONLY-SECRET'}};
  const headers={Origin:origin,'Content-Type':'application/json','X-Ultimater-CSRF':initial.body.csrfToken};
  const rejected=await json('/api/setup/credentials',{method:'POST',headers:{...headers,'X-Ultimater-CSRF':'wrong-token'},body:JSON.stringify(fixture)});
  assert.equal(rejected.response.status,403);assert.equal((await json('/api/setup/status')).body.providers.alpaca.configured,false);
  async function save(input, expected) {
    const result=await json('/api/setup/credentials',{method:'POST',headers,body:JSON.stringify(input)});
    assert.equal(result.response.status,200);assert.equal(result.body.ok,true);assert.ok(!JSON.stringify(result.body).includes('SMOKE-ONLY'));
    await until(async()=>{
      const status=await json('/api/setup/status');if(status.body.restarting)return false;
      const underlying=await json('/api/space/options/status');return underlying.response.ok&&underlying.body.configured===expected;
    },'The Worker did not pick up the local credential change.');
  }
  await save(fixture,true);await save({provider:'alpaca',remove:true},false);
  await closeChild();assert.equal(exitCode,0);
  await until(async()=>{await portFree(port);await portFree(workerPort);return true;},'Local ports remained occupied after shutdown.',10_000);
  console.log('Local-download smoke passed: clean dependency install, Home/setup, CSRF protection, Worker save/remove restarts, IPC shutdown, and free ports.');
} catch(error) {
  console.error(error.message);
  // Startup output contains only dependency/tool messages. The Worker never logs keys.
  if(output)console.error(output);
  process.exitCode=1;
} finally {
  try{await closeChild();}catch(error){console.error(error.message);process.exitCode=1;}
}

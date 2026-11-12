import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotPage, createSnapshotReader } from '../../web/space/prediction-snapshot.js';
import { collectSnapshot, syncFile } from '../../scripts/sync-prediction-events.mjs';
import { packServer } from '../../scripts/serve-pack.mjs';
const time = '2026-11-12T05:00:00.000Z';
const event = (id, provider = 'polymarket') => ({ id: provider + ':' + id, provider, title: 'Fed decision ' + id, markets: [{ question: 'Will the Fed cut rates?', outcomes: [{ label: 'Yes', price: 0 }], rules: 'Exact source rule.', closeTime: '2026-12-09T18:59:00Z' }] });
const saved = (events = [event('1')], fetchedAt = time) => ({ schemaVersion: 1, generatedAt: fetchedAt, refreshMinutes: 15, providers: { polymarket: { events, source: { provider: 'polymarket', status: 'ok', fetchedAt, volumeUnit: 'USD' }, upstreamHasMore: true } } });
const body = (provider, events, nextCursor = null) => ({ events, sources: [{ provider, status: 'ok', fetchedAt: time, hasMore: !!nextCursor, nextCursor }] });

test('saved pages preserve rules, zero prices, deadlines and separate venue pagination', () => {
  const snapshot = saved(Array.from({length:25},(_,i)=>event(String(i))));
  const first = snapshotPage(snapshot, {provider:'polymarket'}, {now:Date.parse(time)});
  assert.equal(first.events.length,20); assert.equal(first.events[0].markets[0].outcomes[0].price,0);
  assert.equal(first.events[0].markets[0].rules,'Exact source rule.'); assert.equal(first.sources[0].delivery,'github-snapshot');
  const second = snapshotPage(snapshot,{provider:'polymarket',cursor:first.sources[0].nextCursor});
  assert.equal(second.events.length,5); assert.equal(second.sources[0].hasMore,false);
  assert.throws(()=>snapshotPage(snapshot,{provider:'kalshi',cursor:first.sources[0].nextCursor}));
  assert.throws(()=>snapshotPage(snapshot,{status:'closed'}),/open standard/);
  assert.throws(()=>snapshotPage(snapshot,{kind:'combos'}),/open standard/);
  assert.throws(()=>snapshotPage(snapshot,{cursor:'saved:polymarket:99999999999999999999'}));
  assert.equal(snapshotPage(snapshot,{q:'Fed rates'}).events.length,20);
  assert.equal(snapshotPage(snapshot,{q:'basketball'}).events.length,0);
});

test('old retained snapshot timestamps stay old and stale, not silently fresh', () => {
  const snapshot = saved(); snapshot.generatedAt = '2026-11-12T06:00:00Z'; snapshot.sync = {polymarket:{status:'retained'}};
  const page = snapshotPage(snapshot,{}, {now:Date.parse(snapshot.generatedAt),remoteAvailable:false});
  assert.equal(page.sources[0].snapshotAsOf,time); assert.equal(page.sources[0].snapshotStale,true); assert.equal(page.sources[0].partial,true);
  assert.ok(page.notices.some(n=>n.includes('previous successful'))); assert.ok(page.notices.some(n=>n.includes('GitHub could not be reached')));
});

test('reader rechecks GitHub and discovers new events after cache expiry; concurrent pages share downloads', async () => {
  let now = Date.parse(time), calls=0, remote=saved();
  const reader=createSnapshotReader({now:()=>now,fetcher:async url=>{calls++; return Response.json(String(url).startsWith('https:')?remote:saved([]));}});
  await Promise.all([reader({provider:'polymarket'}),reader({provider:'polymarket'})]); assert.equal(calls,2);
  remote=saved([event('1'),event('NEW')],'2026-11-12T05:15:00Z');
  assert.equal((await reader({})).events.length,1); assert.equal(calls,2);
  now+=16*60000; const refreshed=await reader({}); assert.equal(refreshed.events.length,2); assert.equal(calls,4);
  const controller=new AbortController();controller.abort();await assert.rejects(reader({}, {signal:controller.signal}),{name:'AbortError'});
});

test('bundle works without GitHub and a failed recheck keeps last saved data', async () => {
  let offline=false, now=Date.parse(time);
  const reader=createSnapshotReader({now:()=>now,fetcher:async url=>{if(String(url).startsWith('https:')||offline)throw new Error('offline');return Response.json(saved());}});
  const first=await reader({});assert.equal(first.events.length,1);assert.equal(first.sources[0].remoteAvailable,false);
  offline=true;now+=61*1000;const retained=await reader({});assert.equal(retained.events[0].id,first.events[0].id);assert.equal(retained.sources[0].partial,true);
  assert.ok(retained.notices.some(n=>n.includes('recheck failed')));
  const empty=createSnapshotReader({fetcher:async()=>{throw new Error('offline');}});await assert.rejects(empty({}),/No saved events/);
});

test('collector rediscovers from first pages, de-duplicates each venue, and replaces an old selection with new events', async () => {
  const calls=[];
  const result=await collectSnapshot({previous:saved(),now:()=>time,getPage:async(p,c)=>{calls.push([p,c]);return body(p,c?[event('NEW',p)]:[event('1',p)],c?null:'next');}});
  assert.equal(result.providers.polymarket.events.length,2); assert.equal(result.providers.kalshi.events.length,2);
  assert.deepEqual(calls,[['polymarket',null],['polymarket','next'],['kalshi',null],['kalshi','next']]);
  const next=await collectSnapshot({previous:result,now:()=>time,getPage:async p=>body(p,[event('REPLACEMENT',p)])});
  assert.deepEqual(next.providers.polymarket.events.map(e=>e.id),['polymarket:REPLACEMENT']);
});

test('provider failure or incomplete discovery preserves prior venue without corrupting successful venue data', async () => {
  const previous=saved();
  for(const partial of [false,true]){
    const next=await collectSnapshot({previous,now:()=>time,getPage:async p=>{
      if(p==='kalshi')return body(p,[event('NEW',p)]);
      if(!partial)throw new Error('unavailable');const page=body(p,[event('PARTIAL',p)]);page.sources[0].partial=true;return page;
    }});
    assert.strictEqual(next.providers.polymarket,previous.providers.polymarket);assert.equal(next.sync.polymarket.status,'retained');assert.equal(next.sync.kalshi.status,'ok');
  }
  await assert.rejects(collectSnapshot({getPage:async()=>{throw new Error('outage');}}),/No event snapshot/);
  const empty=await collectSnapshot({previous,now:()=>time,getPage:async p=>body(p,[])});assert.equal(empty.providers.polymarket.events.length,0);
});

test('snapshot writes are atomic on failure and local pack routes need no backend', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ultimater-snapshot-'));
  let server;
  try{
    const file=join(dir,'latest.json');await writeFile(file,JSON.stringify(saved()));const before=await readFile(file,'utf8');
    await assert.rejects(syncFile(file,{pageLimit:0}));assert.equal(await readFile(file,'utf8'),before);
    await writeFile(join(dir,'space.html'),'<h1>Local events</h1>');
    server=packServer(dir);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
    assert.equal((await fetch(url+'/space')).status,200);assert.equal((await fetch(url+'/api/space/test')).status,503);assert.equal((await fetch(url+'/api/space/prediction-markets/stock-events')).status,501);
    assert.equal((await fetch(url+'/latest.json',{method:'HEAD'})).status,200);
    assert.notEqual((await fetch(url+'/%2e%2e%2fpackage.json')).status,200);
  }finally{if(server)await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
});

test('rate-limited discovery waits for cooldown once and then accepts fresh venue events', async () => {
  const pauses=[];let calls=0;
  const result=await collectSnapshot({previous:saved(),pause:async ms=>pauses.push(ms),now:()=>time,getPage:async p=>{
    if(p==='polymarket'&&calls++===0){const retry=body(p,[]);retry.sources[0].partial=true;retry.coverage=[{id:'fed',status:'error',error:'rate_limited'}];return retry;}
    return body(p,[event('FRESH',p)]);
  }});
  assert.deepEqual(pauses,[31000]);assert.equal(result.sync.polymarket.status,'ok');assert.equal(result.providers.polymarket.events[0].id,'polymarket:FRESH');
});

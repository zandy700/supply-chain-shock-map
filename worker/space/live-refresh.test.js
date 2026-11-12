import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveRefresh, refreshLabel } from '../../web/space/live-refresh.js';

function fixture(refresh) {
  let clock = 1000, n = 0;
  const tasks = new Map(), doc = new EventTarget(), win = new EventTarget();
  doc.visibilityState = 'visible'; win.navigator = { onLine: true };
  win.innerHeight = win.innerWidth = 1000;
  const el = { isConnected: true, getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 50, right: 50, width: 50, height: 50 }) };
  const poll = createLiveRefresh({ el, refresh, interval: 30000, doc, win, Observer: null,
    now: () => clock, schedule(fn, ms) { tasks.set(++n, { fn, ms }); return n; }, cancel: id => tasks.delete(id) });
  return { poll, doc, win, el, tasks, advance(ms = 30000) { clock += ms; }, async tick() {
    const task = tasks.entries().next().value; assert.ok(task); tasks.delete(task[0]); task[1].fn();
    await new Promise(r => setImmediate(r));
  } };
}

test('mounted visible panel repeatedly fetches advancing data; resume catches up immediately', async () => {
  let price = 100; const f = fixture(async () => ++price);
  await f.poll.request(); assert.equal(price, 101);
  f.advance(); await f.tick(); assert.equal(price, 102);
  f.doc.visibilityState = 'hidden'; f.advance(); await f.tick(); assert.equal(price, 102);
  f.doc.visibilityState = 'visible'; f.doc.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r => setImmediate(r)); assert.equal(price, 103);
  f.poll.destroy(); assert.equal(f.tasks.size, 0);
});

test('paused, offline, disconnected and offscreen panels cannot automatically fetch', async () => {
  let calls = 0; const f = fixture(async () => ++calls);
  await f.poll.request(); f.poll.setPaused(true); f.advance(); await f.tick(); assert.equal(calls, 1);
  await f.poll.request(); assert.equal(calls, 2); // Manual refresh still works when paused.
  f.poll.setPaused(false); f.win.navigator.onLine = false; f.advance(); await f.tick(); assert.equal(calls, 2);
  assert.equal(f.poll.state().status, 'offline');
  f.win.navigator.onLine = true; f.el.isConnected = false; f.advance(); await f.tick(); assert.equal(calls, 2);
  f.el.isConnected = true; f.el.getBoundingClientRect = () => ({ top: 2000, left: 0, bottom: 2050, right: 50, width: 50, height: 50 });
  f.advance(); await f.tick(); assert.equal(calls, 2); f.poll.destroy();
});

test('superseded work settles before a queued refresh, aborted results never become fresh', async () => {
  let release, signal, calls = 0;
  const f = fixture(s => { signal = s; calls++; return new Promise(r => { release = r; }); });
  const first = f.poll.request(); await Promise.resolve(); f.poll.restart();
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
  release(); await first; await Promise.resolve();
  assert.equal(calls, 2); assert.equal(f.poll.state().lastSuccessAt, null);
  release(); await new Promise(r => setImmediate(r)); assert.equal(f.poll.state().status, 'current');
  f.poll.destroy();
});

test('failure keeps last success, backs off, recovers, and destroy prevents retries', async () => {
  let fail = false, calls = 0; const f = fixture(async () => { calls++; if (fail) throw new Error('Provider unavailable'); });
  await f.poll.request(); fail = true; f.advance(); await f.tick();
  assert.equal(f.poll.state().status, 'stale'); assert.equal(f.poll.state().lastSuccessAt, 1000);
  assert.equal([...f.tasks.values()][0].ms, 60000);
  assert.match(refreshLabel(f.poll.state()), /failed.*retrying/);
  fail = false; f.advance(60000); await f.tick(); assert.equal(f.poll.state().status, 'current');
  f.poll.destroy(); f.win.dispatchEvent(new Event('focus')); await f.poll.request(); assert.equal(calls, 3);
});

test('a hung provider times out instead of permanently blocking all later updates', async () => {
  let hang = true, calls = 0;
  const f = fixture(async () => { calls++; if (hang) return new Promise(() => {}); });
  const request = f.poll.request();
  const rejected = assert.rejects(request, /timed out/);
  await Promise.resolve(); f.advance(45000); await f.tick(); await rejected;
  assert.equal(f.poll.state().busy, false); assert.equal(f.poll.state().status, 'error');
  hang = false; f.advance(60000); await f.tick(); assert.equal(calls, 2);
  assert.equal(f.poll.state().status, 'current'); f.poll.destroy();
});

test('restart resolves after its replacement fetch and destroy clears an in-flight deadline', async () => {
  const releases = [];
  const f = fixture(() => new Promise(r => releases.push(r)));
  f.poll.request(); await Promise.resolve();
  let settled = false; const replacement = f.poll.restart().then(() => { settled = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(releases.length, 2); assert.equal(settled, false);
  releases[1](); await replacement; assert.equal(settled, true);
  f.poll.request(); await Promise.resolve(); f.poll.destroy();
  await new Promise(r => setImmediate(r)); assert.equal(f.tasks.size, 0);
  releases.forEach(r => r());
});

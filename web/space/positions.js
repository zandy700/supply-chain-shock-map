// Private per-device position state shared by Analyzer panels. No public data writes.
import { bus, store } from './core.js';
import { readPortfolios, PORTFOLIOS_EVENT } from '../portfolio-model.js';
import { loadPortfolioData } from './panels/portfolio.js';
import { positionsByTicker, positionValue } from '../shared/position.js';
export { positionValue };
const PORTFOLIO_KEY = 'watchlist-pulse-portfolios-v1', PRIVATE_KEY = 'space:portfolio:private';
const REFRESH_MS = 5 * 60_000;

export function createPositionTracker({ readManual = readPortfolios, loadData = loadPortfolioData, eventBus = bus,
  getWindow = () => typeof window === 'undefined' ? null : window,
  getDocument = () => typeof document === 'undefined' ? null : document,
  now = Date.now, schedule = setInterval, cancel = clearInterval } = {}) {
  let positions = new Map(), brokerAccounts = [], started = false, generation = 0, offBus = [], timer, lastRequested = 0;
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch (error) { console.error('[space] position listener failed', error); } } };
  function rebuild() {
    let manual = []; try { manual = readManual(); } catch { /* unreadable local data is not a zero-cost position */ }
    positions = positionsByTicker([...manual, ...brokerAccounts]); notify();
  }
  function accept(data) {
    if (data?.broker?.connected === true && Array.isArray(data.broker.accounts)) brokerAccounts = data.broker.accounts;
    else if (data?.broker?.connected === false) brokerAccounts = [];
    rebuild();
  }
  async function reload() {
    lastRequested = now();
    const mine = ++generation;
    try { const data = await loadData(); if (started && mine === generation) accept(data); }
    catch { /* last supported broker holdings remain available during outages */ }
  }
  function refreshIfDue() {
    if (started && getDocument()?.visibilityState !== 'hidden' && getWindow()?.navigator?.onLine !== false && now() - lastRequested >= REFRESH_MS) reload();
  }
  function storage(event) {
    if (event.key === PORTFOLIO_KEY) rebuild();
    else if (event.key === null) { brokerAccounts = []; rebuild(); reload(); }
    else if (event.key === PRIVATE_KEY) notify();
  }
  function changed() { rebuild(); reload(); }
  function loaded(data) { lastRequested = now(); generation++; accept(data); }
  function start() {
    const target = getWindow(); if (started || !target) return;
    started = true;
    target.addEventListener('storage', storage); target.addEventListener(PORTFOLIOS_EVENT, rebuild);
    target.addEventListener('focus', refreshIfDue); target.addEventListener('online', refreshIfDue);
    getDocument()?.addEventListener('visibilitychange', refreshIfDue);
    offBus = [eventBus.on('portfolio:changed', changed), eventBus.on('portfolio:data', loaded), eventBus.on('portfolio:privacy', notify)];
    rebuild(); reload();
    timer = schedule(refreshIfDue, REFRESH_MS); timer?.unref?.();
  }
  function stop() {
    if (!started) return;
    started = false; generation++;
    const target = getWindow(); target?.removeEventListener('storage', storage); target?.removeEventListener(PORTFOLIOS_EVENT, rebuild);
    target?.removeEventListener('focus', refreshIfDue); target?.removeEventListener('online', refreshIfDue);
    getDocument()?.removeEventListener('visibilitychange', refreshIfDue); cancel(timer); timer = undefined;
    offBus.forEach(off => off()); offBus = [];
  }
  return {
    positionFor: ticker => positions.get(String(ticker ?? '').trim().toUpperCase()) || null,
    onPositions(fn) {
      // Initial data is rebuilt before the new subscriber is notified, even on a fresh mount.
      start(); listeners.add(fn); fn();
      return () => { listeners.delete(fn); if (!listeners.size) stop(); };
    }
  };
}
const tracker = createPositionTracker();
export const positionFor = tracker.positionFor;
export const onPositions = tracker.onPositions;
export const positionsPrivate = () => !!store.get('portfolio:private', false);
export function ensurePositionStyles() {
  if (typeof document === 'undefined' || !document.head) return;
  const href = new URL('../shared/position.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`)) { const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href; document.head.append(link); }
}

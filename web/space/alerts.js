import { loadNewsBatches } from '../shared/feed-batches.js';
// Device-local price alerts. Checks run while Ultimater is open and visible.
import { registerPanel, api, bus, store, esc, fmt, toCSV } from './core.js';
const SYMBOL = /^[A-Z0-9]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;
import { readWatchlist } from './panels/news.js';
const LIMIT = 24;
const CATEGORIES = { price: 'Price alerts', news: 'Company news (watchlist)', earnings: 'Earnings dates and results (watchlist)', workspace: 'Events supplied by workspace panels' };
const defaultPrefs = { price: true, news: false, earnings: false, workspace: true, browser: false };
let preferences = { ...defaultPrefs, ...store.get('notification-preferences', {}) };
const savedFeed = store.get('notification-feed', []);
let feed = Array.isArray(savedFeed) ? savedFeed.map(n => normalizeNotification(n)).filter(Boolean).slice(0, 200) : [];
let view = { tab: 'all', status: 'all', sort: 'date', category: 'all', settings: false, ...store.get('notifications-ui', {}) };
let eventsBusy = false, eventsAt = 0;
const safeURL = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
export function normalizeNotification(input, now = Date.now()) {
  if (!input || !Object.hasOwn(CATEGORIES, input.category) || typeof input.title !== 'string' || !input.title.trim() || typeof input.source !== 'string' || !input.source.trim()) return null;
  const at = input.date == null ? now : Date.parse(input.date);
  if (!Number.isFinite(at)) return null;
  return { id: String(input.id || crypto.randomUUID()).slice(0, 200), category: input.category, title: input.title.trim().slice(0, 250), message: String(input.message || '').slice(0, 2000), source: input.source.slice(0, 150), symbol: SYMBOL.test(input.symbol || '') ? input.symbol : '', url: safeURL(input.url), date: new Date(at).toISOString() };
}
export function orderedAlerts(rows, status = 'all', sort = 'date') {
  return rows.filter(a => status === 'active' ? !a.triggeredAt : status === 'triggered' ? !!a.triggeredAt : true).sort((a, b) => sort === 'symbol' ? a.symbol.localeCompare(b.symbol) : String(b.triggeredAt || b.createdAt).localeCompare(String(a.triggeredAt || a.createdAt)));
}
function notify(input) {
  const n = normalizeNotification(input);
  if (!n || !preferences[n.category] || feed.some(item => item.id === n.id)) return false;
  feed = [n, ...feed].slice(0, 200); store.set('notification-feed', feed); bus.emit('alerts:changed'); bus.emit('notifications:added', { notification: n });
  if (preferences.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') { try { new Notification(n.title, { body: n.message, tag: n.id }); } catch { /* permission or browser policy changed */ } }
  return true;
}
async function sourceEvents(force = false) {
  if (eventsBusy || document.visibilityState !== 'visible' || (!force && Date.now() - eventsAt < 15 * 60000)) return;
  const symbols = readWatchlist(); if (!symbols.length || (!preferences.news && !preferences.earnings)) return;
  eventsBusy = true; eventsAt = Date.now();
  const failures = [];
  try {
    if (preferences.news) {
      try {
      const d = await loadNewsBatches(api, symbols);
      if (d.partial) failures.push('Some watchlist news sources could not be refreshed.');
      for (const item of d.items || []) notify({ id: 'news:' + item.id, category: 'news', title: item.title, message: item.summary, source: item.source || item.provider || 'Company news feed', date: item.date, symbol: item.symbols?.[0], url: item.url });
      } catch { failures.push('Company news could not be refreshed.'); }
    }
    if (preferences.earnings) {
      try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      const to = new Date(Date.parse(today + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10);
      const d = await api('earnings/calendar', { from: today, to });
      for (const row of d.rows || []) if (symbols.includes(row.symbol)) notify({ id: `earnings:${row.symbol}:${row.date}:${row.epsActual == null ? 'scheduled' : 'reported'}`, category: 'earnings', title: `${row.symbol} earnings ${row.epsActual == null ? 'scheduled' : 'reported'}`, message: `Report date ${row.date}${row.time ? ' · ' + row.time : ''}${row.epsActual == null ? '' : ' · Actual EPS ' + row.epsActual}${row.epsEstimate == null ? '' : ' · Consensus EPS ' + row.epsEstimate}`, source: row.sources?.join(' / ') || d.sources?.join(' / ') || 'Earnings calendar', symbol: row.symbol });
      } catch { failures.push('Earnings events could not be refreshed.'); }
    }
    failure = failures.length ? failures.join(' ') + ' Existing notifications remain available.' : '';
  }
  finally { eventsBusy = false; bus.emit('alerts:changed'); }
}
async function browserPermission() {
  if (typeof Notification === 'undefined') { failure = 'This browser does not support desktop notifications.'; bus.emit('alerts:changed'); return; }
  try { const result = await Notification.requestPermission(); preferences.browser = result === 'granted'; if (result !== 'granted') failure = 'Browser notifications were not enabled. You can change permission in your browser settings.'; store.set('notification-preferences', preferences); } catch { failure = 'Browser notification permission could not be requested.'; }
  bus.emit('alerts:changed');
}
export function validateAlert(input) {
  const symbol = String(input?.symbol || '').trim().toUpperCase();
  const price = input?.price;
  if (!SYMBOL.test(symbol) || !Number.isFinite(price) || price <= 0 || !['above', 'below'].includes(input?.condition)) return null;
  return { symbol, price, condition: input.condition };
}
export function alertMatches(alert, price) { return Number.isFinite(price) && price > 0 && (alert.condition === 'above' ? price >= alert.price : alert.condition === 'below' && price <= alert.price); }
function read() { const rows = store.get('alerts', []); return Array.isArray(rows) ? rows.filter(a => validateAlert(a) && typeof a.id === 'string').slice(0, LIMIT) : []; }
let alerts = read(), lastCheck = null, failure = '', busy = false, dialog = null;
function save() { store.set('alerts', alerts); bus.emit('alerts:changed'); }
function add(input) {
  const a = validateAlert(input);
  if (!a) throw new Error('Enter a valid symbol, positive price and alert direction.');
  if (alerts.filter(r => !r.triggeredAt).length >= LIMIT) throw new Error('You can keep up to 24 active alerts. Remove an alert to add another.');
  alerts = [...alerts.slice(-(LIMIT - 1)), { ...a, id: crypto.randomUUID(), createdAt: new Date().toISOString(), triggeredAt: null }]; save(); check();
}
async function check() {
  if (busy || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) return;
  const active = alerts.filter(a => !a.triggeredAt); if (!active.length) return;
  busy = true; failure = ''; bus.emit('alerts:changed');
  try {
    const d = await api('markets/quotes', { symbols: [...new Set(active.map(a => a.symbol))].join(',') });
    const quotes = new Map(d.quotes.map(q => [q.symbol, q]));
    for (const alert of active) {
      const q = quotes.get(alert.symbol);
      if (!q || !alerts.includes(alert)) continue;
      alert.lastPrice = q.price; alert.source = q.source; alert.delayed = q.delayed;
      if (alertMatches(alert, q.price)) { alert.triggeredAt = new Date().toISOString(); notify({ id: `price:${alert.id}:${alert.triggeredAt}`, category: 'price', title: `${alert.symbol} price alert`, message: `Price $${fmt.price(q.price)} is ${alert.condition === 'above' ? 'at or above' : 'at or below'} your $${fmt.price(alert.price)} target. Quotes may be delayed.`, source: typeof q.source === 'string' ? q.source : 'Market quote provider', symbol: alert.symbol, date: alert.triggeredAt }); if (preferences.price) bus.emit('alerts:triggered', { alert: { ...alert } }); }
    }
    lastCheck = new Date().toISOString();
    if (d.missing?.length) failure = `No quote available for ${d.missing.join(', ')}.`;
    save();
  } catch { failure = 'Quotes could not be checked. Your alerts are saved; try again shortly.'; }
  finally { busy = false; bus.emit('alerts:changed'); }
}
function priceContent() {
  const shown = orderedAlerts(alerts, view.status, view.sort);
  return `<p class="p-alerts-note">Alerts check delayed quotes every minute while this page is open and visible. They are saved on this device. No email or background notifications are sent.</p>
    <div class="p-alerts-tools"><button type="button" class="s-btn s-btn-sm" data-alert-new>+ Create alert</button><button type="button" class="s-btn s-btn-ghost s-btn-sm" data-alert-check ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Check now'}</button></div>
    ${failure ? `<p class="s-down" role="alert">${esc(failure)}</p>` : ''}${lastCheck ? `<p class="p-alerts-note">Last checked ${esc(fmt.time(lastCheck))}</p>` : ''}
    ${shown.length ? `<ul class="p-alerts-list">${shown.map(a => `<li><div><strong>${esc(a.symbol)}</strong> ${a.condition === 'above' ? 'at or above' : 'at or below'} $${fmt.price(a.price)}<small>${a.triggeredAt ? `Triggered ${esc(fmt.date(a.triggeredAt))} at ${esc(fmt.time(a.triggeredAt))}` : 'Active'}${Number.isFinite(a.lastPrice) ? ` · Last $${fmt.price(a.lastPrice)}` : ''}</small></div><div>${a.triggeredAt ? `<button type="button" class="s-btn s-btn-ghost s-btn-sm" data-alert-rearm="${esc(a.id)}">Rearm</button>` : ''}<button type="button" class="s-icon-btn" data-alert-delete="${esc(a.id)}" aria-label="Delete ${esc(a.symbol)} alert">×</button></div></li>`).join('')}</ul>` : '<p class="p-alerts-note">No price alerts yet. Create one to watch a price level.</p>'}`;
}
function content() {
  const permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const setting = view.settings ? `<section class="p-alerts-settings"><h3>Notification settings</h3><p class="p-alerts-note">These preferences apply on this device. News and earnings refresh from published sources for your watchlist every 15 minutes while this page is open and visible. Workspace events appear only when a panel supplies them.</p>${Object.entries(CATEGORIES).map(([key, label]) => `<label><input type="checkbox" data-notify-category="${key}" ${preferences[key] ? 'checked' : ''}>${label}</label>`).join('')}<p class="p-alerts-note">Desktop permission: ${esc(permission)}. Notifications are not delivered when this page is closed.</p><button type="button" class="s-btn s-btn-sm" data-notify-enable>${permission === 'granted' ? 'Enable desktop notifications' : 'Request browser permission'}</button><label><input type="checkbox" data-notify-category="browser" ${preferences.browser ? 'checked' : ''} ${permission !== 'granted' ? 'disabled' : ''}>Desktop notifications while the page is open</label></section>` : '';
  const filtered = feed.filter(n => view.category === 'all' || n.category === view.category).sort((a, b) => view.sort === 'symbol' ? (a.symbol || '').localeCompare(b.symbol || '') : b.date.localeCompare(a.date));
  return `<div class="p-alerts-tabs s-tabs" role="tablist" aria-label="Notifications"><button type="button" class="s-tab" role="tab" aria-selected="${view.tab === 'all'}" data-notify-tab="all">All notifications</button><button type="button" class="s-tab" role="tab" aria-selected="${view.tab === 'price'}" data-notify-tab="price">Price alerts</button><button type="button" class="s-btn s-btn-ghost s-btn-sm" data-notify-settings aria-expanded="${view.settings}">Settings</button></div>${setting}<div class="p-alerts-tools">${view.tab === 'price' ? `<select class="s-select" data-notify-filter aria-label="Alert status">${[['all','All alerts'],['active','Active'],['triggered','Triggered']].map(([v, l]) => `<option value="${v}" ${view.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>` : `<select class="s-select" data-notify-feed aria-label="Notification category"><option value="all">All categories</option>${Object.entries(CATEGORIES).map(([v, l]) => `<option value="${v}" ${view.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button type="button" class="s-btn s-btn-ghost s-btn-sm" data-notify-refresh>Refresh events</button><button type="button" class="s-btn s-btn-ghost s-btn-sm" data-notify-clear>Clear feed</button>`}<select class="s-select" data-notify-sort aria-label="Notification sorting"><option value="date" ${view.sort === 'date' ? 'selected' : ''}>Date: newest first</option><option value="symbol" ${view.sort === 'symbol' ? 'selected' : ''}>Symbol A–Z</option></select></div>${view.tab === 'price' ? priceContent() : `<p class="p-alerts-note">Published source events and triggered alerts on this device. Source dates can differ from the time you received an event.</p>${failure ? `<p class="s-down" role="alert">${esc(failure)}</p>` : ''}<ul class="p-alerts-list p-notification-feed">${filtered.map(n => `<li><div><span class="s-badge">${esc(CATEGORIES[n.category] || n.category)}</span><h3>${n.url && safeURL(n.url) ? `<a href="${esc(safeURL(n.url))}" target="_blank" rel="noopener noreferrer">${esc(n.title)}</a>` : esc(n.title)}</h3><p>${esc(n.message)}</p><small>${esc(n.source)} · ${esc(fmt.date(n.date))} ${esc(fmt.time(n.date))}${n.symbol ? ' · ' + esc(n.symbol) : ''}</small></div></li>`).join('')}</ul>${filtered.length ? '' : '<p class="p-alerts-note">No notifications in this category yet. Create a price alert or enable source events in Settings.</p>'}`}`;
}
function changed(e) {
  const t = e.target;
  if (t.dataset.notifyCategory) { const key = t.dataset.notifyCategory; if (Object.hasOwn(defaultPrefs, key)) { preferences[key] = t.checked; store.set('notification-preferences', preferences); if (key !== 'browser') sourceEvents(true); } }
  else if (t.hasAttribute('data-notify-filter')) view.status = t.value;
  else if (t.hasAttribute('data-notify-sort')) view.sort = t.value;
  else if (t.hasAttribute('data-notify-feed')) view.category = t.value;
  else return;
  store.set('notifications-ui', view); bus.emit('alerts:changed');
}
function action(e) {
  const button = e.target.closest('button'); if (!button) return;
  if (button.dataset.notifyTab) { view.tab = button.dataset.notifyTab; store.set('notifications-ui', view); return bus.emit('alerts:changed'); }
  if (button.hasAttribute('data-notify-settings')) { view.settings = !view.settings; return bus.emit('alerts:changed'); }
  if (button.hasAttribute('data-notify-enable')) return browserPermission();
  if (button.hasAttribute('data-notify-refresh')) return sourceEvents(true);
  if (button.hasAttribute('data-notify-clear')) { feed = []; store.set('notification-feed', feed); return bus.emit('alerts:changed'); }
  if (button.hasAttribute('data-alert-new')) return open({ create: true });
  if (button.hasAttribute('data-alert-check')) return check();
  if (button.dataset.alertDelete) { alerts = alerts.filter(a => a.id !== button.dataset.alertDelete); save(); }
  if (button.dataset.alertRearm) { const a = alerts.find(a => a.id === button.dataset.alertRearm); if (a) { a.triggeredAt = null; save(); check(); } }
}
function open({ symbol = '', price, condition = 'above', create = false } = {}) {
  if (create) view.tab = 'price';
  dialog?.close(); dialog?.remove();
  dialog = document.createElement('dialog'); dialog.className = 's-dialog p-alerts-dialog'; dialog.setAttribute('aria-label', 'Notifications and price alerts');
  dialog.innerHTML = `<header><strong>Notifications</strong><button type="button" class="s-icon-btn" data-close aria-label="Close price alerts">×</button></header><div class="s-dialog-body">
    <form class="p-alerts-form" ${create ? '' : 'hidden'}><label>Symbol<input class="s-input" name="symbol" value="${esc(symbol)}" maxlength="12" required autocomplete="off"></label><label>Direction<select class="s-select" name="condition"><option value="above" ${condition === 'above' ? 'selected' : ''}>At or above</option><option value="below" ${condition === 'below' ? 'selected' : ''}>At or below</option></select></label><label>Price (USD)<input class="s-input" name="price" type="number" min="0.00000001" step="any" value="${Number.isFinite(price) && price > 0 ? price : ''}" required></label><button class="s-btn s-btn-primary">Save alert</button><p class="p-alerts-error s-down" role="alert"></p></form><div data-alert-list></div></div>`;
  const host = dialog.querySelector('[data-alert-list]');
  const paint = () => { host.innerHTML = content(); };
  const off = bus.on('alerts:changed', paint);
  const current = dialog;
  dialog.addEventListener('close', () => { off(); current.remove(); if (dialog === current) dialog = null; }, { once: true });
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  host.addEventListener('click', action); host.addEventListener('change', changed);
  dialog.querySelector('form').onsubmit = e => { e.preventDefault(); const f = e.currentTarget; try { add({ symbol: f.elements.symbol.value, price: Number(f.elements.price.value), condition: f.elements.condition.value }); f.hidden = true; paint(); } catch (error) { f.querySelector('.p-alerts-error').textContent = error.message; } };
  document.body.append(dialog); paint(); dialog.showModal();
}
registerPanel('alerts', { title: 'Notifications & Alerts', category: 'Portfolio', defaultSize: { w: 4, h: 10 }, mount(el) {
  el.classList.add('p-alerts'); const paint = () => { el.innerHTML = content(); }; const off = bus.on('alerts:changed', paint); el.addEventListener('click', action); el.addEventListener('change', changed); paint();
  return { csv: () => alerts.length ? toCSV(alerts) : null, scoutContext: () => JSON.stringify(alerts), destroy() { off(); el.removeEventListener('click', action); el.removeEventListener('change', changed); } };
} });
if (typeof document !== 'undefined') {
  bus.on('notifications:push', notify);
  bus.on('news:published', item => notify({ ...item, category: 'news' }));
  bus.on('earnings:published', item => notify({ ...item, category: 'earnings' }));
  bus.on('alerts:open', () => open());
  bus.on('alerts:create', input => { if (validateAlert(input)) { try { add(input); open(); } catch (e) { failure = e.message; open(); } } else open({ ...input, create: true }); });
  setInterval(() => { check(); sourceEvents(); }, 60000); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { check(); sourceEvents(); } });
  addEventListener('storage', e => {
    if (e.key === 'space:alerts') alerts = read();
    else if (e.key === 'space:notification-preferences') preferences = { ...defaultPrefs, ...store.get('notification-preferences', {}) };
    else if (e.key === 'space:notification-feed') { const rows = store.get('notification-feed', []); feed = Array.isArray(rows) ? rows.map(n => normalizeNotification(n)).filter(Boolean).slice(0, 200) : []; }
    else return;
    bus.emit('alerts:changed');
  });
  setTimeout(() => { check(); sourceEvents(); }, 1000);
}

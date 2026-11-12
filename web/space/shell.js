// Ultimater shell: top bar, ticker tape, sidebar, view header, panel grid, search palette, dock.
// Owned by the shell builder. Contract: docs/space-contract.md.
import { getPanel, listPanels, bus, links, api, store, esc, fmt, toCSV, state as ui } from './core.js';
import { VIEWS, THEMES, getBuiltin, isBuiltin, themeById, GOALS } from './views.js';
import { searchThemes } from './themes.js';
import { initTour } from './tour.js';
import { createLiveRefresh } from './live-refresh.js';
import { csvToXlsx, collectWorkspace, replaceWorkspace, validateWorkspaceFile, moveItem, sharedPanel } from './workspace-tools.js';

/* ------------------------------------------------------------------ icons */
const ICONS = {
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  analysis: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 12l3-3 2 2 4-4M8 20h8M12 16v4"/>',
  news: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  portfolio: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2M16 13h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>',
  options: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  rocket: '<path d="M14 4c3-1 6 0 6 0s1 3 0 6l-6 6-6-6zM8 10l-3 1-2 3 4 0M14 16l-1 3-3 2 0-4M7 17l-2 2"/>',
  seven: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6l-4 9"/>',
  bitcoin: '<path d="M8 5h6a3 3 0 010 6H8zM8 11h7a3 3 0 010 6H8zM8 5v12M10 3v2M13 3v2M10 17v2M13 17v2"/>',
  chip: '<rect x="6" y="6" width="12" height="12" rx="1"/><rect x="9" y="9" width="6" height="6"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  bank: '<path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18"/>',
  bag: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 016 0v2"/>',
  shield: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  home: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  pill: '<rect x="3" y="9" width="18" height="7" rx="3.5" transform="rotate(-35 12 12.5)"/><path d="M9.5 8.5l5 7"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14 0 9-5 15-14 15M5 19l7-7"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><path d="M12 8v1M12 15v1M8 12h1M15 12h1M6 20v1M18 20v1"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h13M17 12l4 4-4 4M21 16H8"/>',
  antenna: '<path d="M12 12v9M8 21h8M7.5 7.5a6 6 0 019 0M5 5a9.5 9.5 0 0114 0"/><circle cx="12" cy="11" r="1.5"/>',
  factory: '<path d="M3 21V10l6 4V10l6 4V5h6v16zM7 18h2M12 18h2M17 18h2"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 018-2.5A4.5 4.5 0 0120 9c0 6-8 11-8 11z"/>',
  flame: '<path d="M12 21c-4 0-7-3-7-7 0-5 5-7 5-11 3 2 4 5 4 7 1-1 2-2 2-4 2 2 3 5 3 8 0 4-3 7-7 7z"/>',
  cart: '<path d="M3 4h2l2 12h11l2-8H6"/><circle cx="9" cy="20" r="1.5"/><circle cx="17" cy="20" r="1.5"/>',
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  plug: '<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0zM12 17v4"/>',
  building: '<path d="M4 21V4h10v17M14 9h6v12M2 21h20M7 8h1M10 8h1M7 12h1M10 12h1M7 16h1M10 16h1M17 13h1M17 17h1"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.5M12 17h.01"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  exitfull: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  chevronR: '<path d="M9 6l6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  expand: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  shrink: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  drag: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  dock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/>',
  reset: '<path d="M4 12a8 8 0 108-8H8M8 1L5 4l3 3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 006 0l3-3a4 4 0 00-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 006 6l1-1"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  tour: '<path d="M4 20V5l8 3 8-3v15l-8 3z"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  logo: '<path d="M3 13h3.5l2.2-5 3.6 9 2.4-6.5 1.6 2.5H21"/>'
};
export const icon = (name, cls = '') => `<svg class="sp-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.layout}</svg>`;

/* ------------------------------------------------------------------ market session (US/Eastern) */
// NYSE full-day closures and 1:00 PM early closes, 2026–2027.
const HOLIDAYS = {
  '2026-01-01': "New Year's Day", '2026-01-19': 'Martin Luther King Jr. Day', '2026-02-16': "Presidents' Day", '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day', '2026-06-19': 'Juneteenth', '2026-07-03': 'Independence Day (observed)', '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving Day', '2026-12-25': 'Christmas Day',
  '2027-01-01': "New Year's Day", '2027-01-18': 'Martin Luther King Jr. Day', '2027-02-15': "Presidents' Day", '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day', '2027-06-18': 'Juneteenth (observed)', '2027-07-05': 'Independence Day (observed)', '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving Day', '2027-12-24': 'Christmas Day (observed)'
};
const EARLY_CLOSE = { '2026-11-27': 1, '2026-12-24': 1, '2027-11-26': 1 };
const etParts = (d) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map(p => [p.type, p.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, weekday: parts.weekday, minutes: (+parts.hour % 24) * 60 + +parts.minute };
};
export function marketSession(date = new Date()) {
  const { ymd, weekday, minutes } = etParts(date);
  if (weekday === 'Sat' || weekday === 'Sun') return { id: 'closed', label: 'CLOSED', detail: 'US markets are closed for the weekend.' };
  if (HOLIDAYS[ymd]) return { id: 'closed', label: 'CLOSED', detail: `US markets are closed for ${HOLIDAYS[ymd]}.` };
  const close = EARLY_CLOSE[ymd] ? 13 * 60 : 16 * 60;
  const afterEnd = EARLY_CLOSE[ymd] ? 17 * 60 : 20 * 60;
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return { id: 'pre', label: 'PRE-MKT', detail: 'Pre-market trading (4:00–9:30 AM ET).' };
  if (minutes >= 9 * 60 + 30 && minutes < close) return { id: 'open', label: 'OPEN', detail: `Regular session until ${EARLY_CLOSE[ymd] ? '1:00' : '4:00'} PM ET${EARLY_CLOSE[ymd] ? ' (early close)' : ''}.` };
  if (minutes >= close && minutes < afterEnd) return { id: 'after', label: 'AFTER-HRS', detail: `After-hours trading until ${EARLY_CLOSE[ymd] ? '5:00' : '8:00'} PM ET.` };
  return { id: 'closed', label: 'CLOSED', detail: 'US markets are closed. Pre-market opens at 4:00 AM ET.' };
}

/* ------------------------------------------------------------------ prefs + persistence */
const DEFAULT_PREFS = { theme: 'dark', density: 'comfortable', sidebarCollapsed: false, dock: 'open', dockWidth: 380, themesExpanded: false, sections: { views: true, themes: true, mine: true }, region: 'us', themeOrder: null, onboarded: false, noticeDismissed: false, singleKeyShortcuts: true, sectionOrder: ['views','themes','mine'], sidebarLocked: false };
const savedPrefs = store.get('prefs') || {};
let prefs = { ...DEFAULT_PREFS, ...savedPrefs };
if (!Object.hasOwn(savedPrefs, 'dock') && matchMedia('(max-width: 1023px)').matches) prefs.dock = 'collapsed';
prefs.sections = { ...DEFAULT_PREFS.sections, ...(prefs.sections || {}) };
prefs.themeOrder=Array.isArray(prefs.themeOrder)?prefs.themeOrder.filter(s=>typeof s==='string'):[];
prefs.sectionOrder=Array.isArray(prefs.sectionOrder)?prefs.sectionOrder.filter(s=>['views','themes','mine'].includes(s)):['views','themes','mine'];
const savePrefs = () => store.set('prefs', prefs);

const LINK_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F'];
const REGIONS = [
  { id: 'us', label: 'US Markets' }, { id: 'europe', label: 'Europe' }, { id: 'asia', label: 'Asia' },
  { id: 'crypto', label: 'Crypto' }, { id: 'rates', label: 'Rates' }, { id: 'commodities', label: 'Commodities' }, { id: 'fx', label: 'Currencies' }
];

const myViews = () => store.get('myviews', []);
const setMyViews = list => store.set('myviews', list);
const uid = (p = 'v') => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const layoutKey = v => v.panels.map(p => `${p.type}:${p.x},${p.y},${p.w},${p.h}`).join('|');

function loadDoc(id) {
  if (isBuiltin(id)) {
    const base = getBuiltin(id);
    const saved = store.get('view:' + id);
    if (saved && saved.layoutKey === layoutKey(base)) return { ...base, ...saved, kind: base.kind, name: base.name, icon: base.icon };
    // Keep the selected company and filters when replacing the old, duplicated
    // Earnings Hub layout. Editable copies retain their own layout unchanged.
    if (id === 'earnings' && saved) {
      return {
        ...base, layoutKey: layoutKey(base), symbols: saved.symbols || base.symbols,
        groups: saved.groups || { A: base.symbols[0] },
        panels: base.panels.map(p => {
          const previous = saved.panels?.find(old => old.type === p.type);
          return previous ? { ...p, state: { ...p.state, ...previous.state } } : p;
        })
      };
    }
    if (base.kind === 'theme' && saved) {
      return {...base,layoutKey:layoutKey(base),symbols:saved.symbols||base.symbols,groups:saved.groups||{A:base.symbols[0]},panels:base.panels.map(p=>{
        const previous=saved.panels?.find(old=>old.type===p.type&&old.state?.list===p.state?.list);
        return previous?{...p,state:{...p.state,...previous.state}}:p;
      })};
    }
    return { ...base, layoutKey: layoutKey(base), groups: { A: base.symbols[0] } };
  }
  const saved = store.get('view:' + id);
  if (saved && myViews().some(v => v.id === id)) return { ...saved, kind: 'custom' };
  return null;
}
let saveTimer = null;
function saveDoc(now = false) {
  clearTimeout(saveTimer);
  const doc = cur.doc; if (!doc) return;
  const write = () => {
    const { id } = doc;
    const data = { ...doc, panels: doc.panels.map(({ id: pid, type, x, y, w, h, group, state, variant, locked, pinned }) => ({ id: pid, type, x, y, w, h, group, state, variant, locked, pinned })) };
    return store.set('view:' + id, data);
  };
  if (now) return write(); else saveTimer = setTimeout(write, 250);
}

/* ------------------------------------------------------------------ small UI helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

let toastHost;
export function toast(msg, { action, onAction, timeout = 4000 } = {}) {
  const t = h(`<div class="sp-toast" role="status"><span>${esc(msg)}</span>${action ? `<button class="s-btn s-btn-sm">${esc(action)}</button>` : ''}</div>`);
  toastHost.append(t);
  const done = () => t.remove();
  if (action) t.querySelector('button').onclick = () => { done(); onAction?.(); };
  setTimeout(done, timeout);
}

// Accessible dropdown menu. items: {label, icon, onSelect, checked, disabled, danger, href} | {separator:true} | {heading}
let openMenuState = null;
export function openMenu(anchor, items, { align = 'start', label = 'Menu', role = 'menu' } = {}) {
  closeMenu();
  const menu = h(`<div class="s-menu" role="${role}" aria-label="${esc(label)}"></div>`);
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { menu.append(h('<hr role="separator">')); continue; }
    if (it.heading) { menu.append(h(`<div class="s-menu-label" role="presentation">${esc(it.heading)}</div>`)); continue; }
    const isRadio = it.checked !== undefined;
    const el = h(it.href
      ? `<a role="menuitem" tabindex="-1" href="${esc(it.href)}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></a>`
      : `<button type="button" role="${isRadio ? 'menuitemradio' : 'menuitem'}" tabindex="-1"${isRadio ? ` aria-checked="${!!it.checked}"` : ''}${it.disabled ? ' aria-disabled="true"' : ''} class="${it.danger ? 's-btn-danger' : ''}">${it.swatch ? `<span class="sp-swatch" style="background:${it.swatch}"></span>` : ''}${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.hint ? `<span class="sp-menu-hint">${esc(it.hint)}</span>` : ''}</button>`);
    el.addEventListener('click', (e) => { if (it.disabled) { e.preventDefault(); return; } closeMenu(false); it.onSelect?.(); });
    menu.append(el);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = align === 'end' ? r.right - mw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - mw - 8));
  let top = r.bottom + 4; if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  Object.assign(menu.style, { left: left + 'px', top: top + 'px' });
  anchor.setAttribute('aria-expanded', 'true');
  const itemsEls = () => [...menu.querySelectorAll('[role^=menuitem]:not([aria-disabled=true])')];
  const focusAt = i => { const els = itemsEls(); if (els.length) els[(i + els.length) % els.length].focus(); };
  menu.addEventListener('keydown', (e) => {
    const els = itemsEls(); const i = els.indexOf(document.activeElement);
    if(stage && (e.key==='ArrowLeft'||e.key==='Backspace')&&!input.value){e.preventDefault();stage=null;search('');return;}
    if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusAt(0); }
    else if (e.key === 'End') { e.preventDefault(); focusAt(els.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(false); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  openMenuState = { menu, anchor, outside };
  const checked = itemsEls().findIndex(el => el.getAttribute('aria-checked') === 'true');
  focusAt(checked >= 0 ? checked : 0);
  return menu;
}
function closeMenu(restoreFocus = true) {
  if (!openMenuState) return;
  const { menu, anchor, outside } = openMenuState; openMenuState = null;
  document.removeEventListener('pointerdown', outside, true);
  anchor.setAttribute('aria-expanded', 'false');
  menu.remove();
  if (restoreFocus && anchor.isConnected) anchor.focus();
}
const menuButton = (btn, items, opts) => { btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false'); btn.addEventListener('click', () => { if (openMenuState?.anchor === btn) closeMenu(); else openMenu(btn, typeof items === 'function' ? items() : items, opts); }); };

// Modal dialog on <dialog>. body: html string or Node. Returns { el, body, close }.
export function openDialog({ title, body = '', footer = '', className = '', label, onClose } = {}) {
  const opener = document.activeElement;
  const dlg = h(`<dialog class="s-dialog ${className}" aria-label="${esc(label || title || 'Dialog')}">
    ${title !== undefined ? `<header><h2>${esc(title)}</h2><button type="button" class="s-icon-btn" data-close aria-label="Close">${icon('x')}</button></header>` : ''}
    <div class="s-dialog-body"></div>${footer ? `<footer>${footer}</footer>` : ''}</dialog>`);
  const bodyEl = dlg.querySelector('.s-dialog-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  document.body.append(dlg);
  let closed = false;
  const close = (value) => { if (closed) return; closed = true; dlg.close(); dlg.remove(); onClose?.(value); if (opener?.isConnected) opener.focus(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); if (e.target.closest('[data-close]')) close(); });
  dlg.showModal();
  return { el: dlg, body: bodyEl, close };
}
export function promptDialog({ title, label, value = '', ok = 'Save' }) {
  return new Promise((resolve) => {
    let result = null;
    const d = openDialog({
      title, onClose: () => resolve(result),
      body: `<form id="sp-prompt"><label for="sp-prompt-in">${esc(label)}</label><input id="sp-prompt-in" class="s-input" maxlength="60" required value="${esc(value)}"></form>`,
      footer: `<button type="button" class="s-btn s-btn-ghost" data-close>Cancel</button><button type="submit" form="sp-prompt" class="s-btn s-btn-primary">${esc(ok)}</button>`
    });
    const input = d.body.querySelector('input'); input.select();
    d.body.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; result = v; d.close(v); });
  });
}
export function confirmDialog({ title, text, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let result = false;
    const d = openDialog({
      title, onClose: () => resolve(result), body: `<p style="margin:0">${esc(text)}</p>`,
      footer: `<button type="button" class="s-btn s-btn-ghost" data-close>Cancel</button><button type="button" class="s-btn ${danger ? 's-btn-danger' : 's-btn-primary'}" data-ok>${esc(ok)}</button>`
    });
    d.el.querySelector('[data-ok]').addEventListener('click', () => { result = true; d.close(); });
    d.el.querySelector('[data-ok]').focus();
  });
}

/* ------------------------------------------------------------------ app state */
const cur = { id: null, doc: null, mounted: new Map(), maxId: null };
let root, els = {}, focusedPanelId = null, unread = store.get('alerts-unread', 0), tour;
const editable = () => cur.doc?.kind === 'custom';
const layoutLocked = () => !editable() || !!cur.doc?.layoutLocked;
const gid = (p) => (p.locked || !p.group) ? `${cur.doc.id}:${p.id}` : `${cur.doc.id}:${p.group}`;
const primaryGroup = () => `${cur.doc.id}:A`;
const viewMeta = (id) => {
  const v = VIEWS.find(x => x.id === id); if (v) return { id, name: v.name, icon: v.icon, kind: 'builtin' };
  const t = themeById(id); if (t) return { id, name: t.name, icon: t.icon, kind: 'theme' };
  const m = myViews().find(x => x.id === id); if (m) return { id, name: m.name, icon: m.icon || 'layout', kind: 'custom' };
  return null;
};

/* ------------------------------------------------------------------ start */
export function getDock() { return document.getElementById('space-dock'); }

export function start(rootEl) {
  root = rootEl;
  root.className = 'sp-app';
  root.innerHTML = `
    <a class="sp-skip" href="#sp-grid-scroll">Skip to main content</a>
    <div class="sp-notice" role="status" hidden><span>Compact layout: open the menu for views. Swipe tables to see more columns.</span><button type="button" class="s-icon-btn s-icon-btn-sm" data-act="dismiss-notice" aria-label="Dismiss notice">${icon('x')}</button></div>
    <header class="sp-top">
      <button type="button" class="s-icon-btn sp-hamburger" data-act="drawer" aria-label="Open navigation" aria-controls="sp-side" aria-expanded="false">${icon('menu')}</button>
      <button type="button" class="sp-logo" data-act="home" aria-label="Go to Markets"><span class="sp-logo-mark">${icon('logo')}</span><span class="sp-logo-text">Ultimater</span></button>
      <div class="sp-clock"><span class="sp-clock-time"></span><span class="s-badge sp-session" tabindex="0"></span></div>
      <div class="sp-top-spacer"></div>
      <button type="button" class="s-btn sp-create" data-act="create">${icon('plus')}<span>Create view</span></button>
      <span class="sp-divider" aria-hidden="true"></span>
      <button type="button" class="s-icon-btn" data-act="alerts" aria-label="Notifications">${icon('bell')}<span class="sp-dot-badge" hidden></span></button>
      <button type="button" class="s-icon-btn" data-act="display" aria-label="Display settings">${icon('monitor')}</button>
      <button type="button" class="s-icon-btn" data-act="help" aria-label="Help">${icon('help')}</button>
      <button type="button" class="s-icon-btn" data-act="fullscreen" aria-label="Enter fullscreen">${icon('fullscreen')}</button>
    </header>
    <div class="sp-tape" role="region" aria-label="Market tape">
      <button type="button" class="sp-region" data-act="region">${icon('flag')}<span></span>${icon('chevron', 'sp-caret')}</button>
      <div class="sp-tape-viewport" tabindex="0" aria-label="Quotes"><div class="sp-tape-track"></div></div>
    </div>
    <div class="sp-body">
      <nav class="sp-side s-scroll" id="sp-side" aria-label="Views"></nav>
      <div class="sp-backdrop" hidden></div>
      <main class="sp-main" id="sp-main">
        <div class="sp-viewhead"></div>
        <div class="sp-grid-scroll s-scroll" id="sp-grid-scroll" tabindex="-1"><div class="sp-grid" id="sp-grid"></div></div>
        <button type="button" class="sp-search-pill" data-act="search" aria-label="Search (⌘K)">${icon('search')}<span>Search</span><kbd class="s-kbd">⌘</kbd><kbd class="s-kbd">K</kbd></button>
      </main>
      <div class="sp-dock-resizer" role="separator" aria-orientation="vertical" aria-label="Resize Ultimater AI panel" tabindex="0" aria-controls="space-dock"></div>
      <aside id="space-dock" class="sp-dock" aria-label="Ultimater AI"></aside>
    </div>
    <button type="button" class="s-btn sp-ai-toggle" data-act="dock-toggle" aria-label="Show Ultimater AI" aria-controls="space-dock" aria-expanded="false" aria-pressed="false">${icon('sparkle')}<span>Ask AI</span></button>
    <div class="sp-toasts" aria-live="polite"></div>`;
  toastHost = $('.sp-toasts', root);
  els = {
    top: $('.sp-top', root), clock: $('.sp-clock-time', root), session: $('.sp-session', root), side: $('.sp-side', root),
    head: $('.sp-viewhead', root), grid: $('#sp-grid', root), scroll: $('#sp-grid-scroll', root), tape: $('.sp-tape-track', root),
    tapeView: $('.sp-tape-viewport', root), region: $('.sp-region', root), dock: $('#space-dock', root), resizer: $('.sp-dock-resizer', root),
    backdrop: $('.sp-backdrop', root), notice: $('.sp-notice', root), bell: $('[data-act=alerts]', root)
  };
  applyTheme(); applyDensity(); applyDock(); applySidebar();
  wireTopBar(); startClock(); renderSidebar(); loadTape(); wireDock(); wireKeys(); wireBus(); wireResponsive();
  setUnread(unread);

  tour = initTour({ openCatalog, openView: (id) => navigate(id), createFromTemplate, getDoc: () => cur.doc, prefs: () => prefs, savePrefs: (patch) => { Object.assign(prefs, patch); savePrefs(); }, openDialog, icon, getBuiltin, VIEWS, THEMES, GOALS });

  window.addEventListener('popstate', () => { saveDoc(true); openView(routeId(), { push: false }); });
  openView(routeId(), { push: false, replace: true });
  bus.emit('shell:ready', { dock: getDock() });
  const q = new URLSearchParams(location.search);
  if(q.has('panel')){try{const spec=JSON.parse(q.get('panel'));if(!getPanel(spec.type)||JSON.stringify(spec)!==JSON.stringify(sharedPanel(spec,spec.symbol)))throw new Error('Invalid shared panel');confirmDialog({title:'Open shared panel',text:'Create a local view containing '+getPanel(spec.type).title+(spec.symbol?' for '+spec.symbol:'')+'?',ok:'Open panel'}).then(ok=>{if(ok)createCustom('Shared '+getPanel(spec.type).title,[{type:spec.type,variant:spec.variant,x:0,y:0,w:12,h:14}],spec.symbol?[spec.symbol]:undefined);});}catch{toast('This shared panel link is invalid.');}const clean=new URL(location.href);clean.searchParams.delete('panel');history.replaceState({},'',clean);}else if (!prefs.onboarded && q.get('onboarding') !== '0') setTimeout(() => tour.onboard(), 400);
  window.__spaceShell = { navigate, addPanel, openSearch, marketSession, cur };
}

function routeId() {
  const id = new URLSearchParams(location.search).get('view') || store.get('lastView') || 'markets';
  return viewMeta(id) ? id : 'markets';
}
export function navigate(id) { saveDoc(true); openView(id, { push: true }); }

/* ------------------------------------------------------------------ theme / density / fullscreen */
const mql = matchMedia('(prefers-color-scheme: light)');
function applyTheme() {
  const t = prefs.theme === 'system' ? (mql.matches ? 'light' : 'dark') : prefs.theme;
  document.documentElement.dataset.spaceTheme = t;
}
mql.addEventListener?.('change', () => prefs.theme === 'system' && applyTheme());
function applyDensity() { document.documentElement.dataset.spaceDensity = prefs.density; }

/* ------------------------------------------------------------------ top bar */
function wireTopBar() {
  const act = (name) => $(`[data-act=${name}]`, root);
  act('home').onclick = () => navigate('markets');
  menuButton(act('create'), () => [
    { label: 'Start from scratch', icon: 'plus', onSelect: createFromScratch },
    { label: 'Select a template', icon: 'layout', onSelect: () => tour.templates() }
  ], { align: 'end', label: 'Create view' });
  act('alerts').onclick = () => { setUnread(0); bus.emit('alerts:open'); };
  menuButton(act('display'), () => [
    { heading: 'Theme' },
    { label: 'System', checked: prefs.theme === 'system', onSelect: () => setPref('theme', 'system') },
    { label: 'Dark', checked: prefs.theme === 'dark', onSelect: () => setPref('theme', 'dark') },
    { label: 'Light', checked: prefs.theme === 'light', onSelect: () => setPref('theme', 'light') },
    { label: 'Blue Steel', checked: prefs.theme === 'blue-steel', onSelect: () => setPref('theme', 'blue-steel') },
    { label: 'Cycle themes', hint: 'T', onSelect: cycleTheme },
    { separator: true }, { heading: 'Density' },
    { label: 'Comfortable', checked: prefs.density === 'comfortable', onSelect: () => setPref('density', 'comfortable') },
    { label: 'Compact', checked: prefs.density === 'compact', onSelect: () => setPref('density', 'compact') }
  ], { align: 'end', label: 'Display settings' });
  menuButton(act('help'), () => [
    { label: 'Explore all stock themes',icon:'search',onSelect:openThemeBrowser },
    { label: 'Getting started', icon: 'layout', onSelect: () => tour.onboard() },
    { label: 'Product tour', icon: 'tour', onSelect: () => tour.start() },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onSelect: showShortcuts },
    { label: 'Data disclaimer', icon: 'info', onSelect: showDisclaimer },
    { separator: true },
    { label: 'Back to watchlist', icon: 'back', href: '/#/briefing' }
  ], { align: 'end', label: 'Help' });
  act('dock-toggle').onclick = () => setDock(prefs.dock === 'collapsed' ? 'open' : 'collapsed');
  act('fullscreen').onclick = toggleFullscreen;
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement, b = act('fullscreen');
    b.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen'); b.innerHTML = icon(on ? 'exitfull' : 'fullscreen');
  });
  act('drawer').onclick = () => setDrawer(!root.classList.contains('drawer-open'));
  act('dismiss-notice').onclick = () => { prefs.noticeDismissed = true; savePrefs(); els.notice.hidden = true; };
  menuButton(els.region, () => REGIONS.map(r => ({ label: r.label, checked: prefs.region === r.id, onSelect: () => { prefs.region = r.id; savePrefs(); loadTape(); } })), { label: 'Market region' });
  $('[data-act=search]', root).onclick = () => openSearch();
}
function setPref(key, value) { prefs[key] = value; savePrefs(); if (key === 'theme') applyTheme(); if (key === 'density') applyDensity(); }
function cycleTheme() { const themes=['dark','light','blue-steel'];setPref('theme',themes[(themes.indexOf(prefs.theme)+1)%themes.length]);toast('Theme: '+prefs.theme); }
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen is not available in this browser.'));
}
function setUnread(n) {
  unread = n; store.set('alerts-unread', n);
  const b = $('.sp-dot-badge', els.bell); b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n || '');
  els.bell.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
}

function startClock() {
  const tick = () => {
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
    const date = now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
    const text = `${time} ET · ${date}`;
    if (els.clock.textContent !== text) els.clock.textContent = text;
    const s = marketSession(now);
    if (els.session.textContent !== s.label) { els.session.textContent = s.label; els.session.dataset.session = s.id; }
    els.session.title = s.detail; els.session.setAttribute('aria-label', `Market session: ${s.label}. ${s.detail}`);
  };
  tick(); setInterval(tick, 1000);
}

/* ------------------------------------------------------------------ ticker tape */
let tapePoll;
function loadTape() {
  if (new URL(location.href).searchParams.get('marketData') === 'snapshot') {
    tapePoll?.destroy(); tapePoll = null;
    els.tape.classList.remove('is-moving');
    els.tape.innerHTML = '<span class="sp-tape-msg">Saved prediction events · GitHub sync scheduled every 15 minutes · Read saved timestamps</span>';
    $('span', els.region).textContent = 'EVENT PACK';
    els.region.setAttribute('aria-label', 'Saved prediction event pack'); els.region.disabled = true;
    return Promise.resolve();
  }
  if (!tapePoll) tapePoll = createLiveRefresh({ el: els.tapeView, interval: 30000, refresh: fetchTape,
    onState(state) {
      let status = els.tapeView.querySelector('.sp-tape-status');
      if (!status) { status = document.createElement('span'); status.className = 'sp-tape-status'; status.setAttribute('role', 'status'); els.tapeView.append(status); }
      status.hidden = !state.error && state.status !== 'offline';
      status.textContent = state.status === 'offline' ? 'Offline · quotes retained' : 'Quotes stale · retrying';
    }
  });
  return tapePoll.restart().catch(() => {});
}
async function fetchTape(signal) {
  const region = REGIONS.find(r => r.id === prefs.region) || REGIONS[0];
  $('span', els.region).textContent = region.label.toUpperCase();
  els.region.setAttribute('aria-label', `Market region: ${region.label}`);
  if (!els.tape.children.length || els.tape.dataset.region !== region.id) els.tape.innerHTML = `<span class="sp-tape-msg">Loading ${esc(region.label)} quotes…</span>`;
  els.tape.dataset.region = region.id;
  try {
    const res = await api('markets/tape', { region: region.id }, { signal });
    if (signal.aborted || prefs.region !== region.id) return;
    const rows = (Array.isArray(res) ? res : res?.items || res?.quotes || res?.data || []).filter(Boolean);
    if (!rows.length) throw new Error('No quotes returned');
    renderTape(rows, res);
  } catch (e) {
    if (e.name === 'AbortError') return;
    if (!els.tape.querySelector('.sp-tape-set')) {
      els.tape.classList.remove('is-moving');
      els.tape.innerHTML = `<span class="sp-tape-msg">Market tape unavailable · ${esc(e.status === 404 ? 'quote service not ready' : e.message)}</span> <button type="button" class="s-btn s-btn-ghost s-btn-sm" data-retry>Retry</button>`;
      $('[data-retry]', els.tape).onclick = loadTape;
    }
    throw e;
  }
}
function renderTape(rows, meta = {}) {
  const item = (q) => {
    const pct = q.changePercent ?? q.changePct ?? q.pct ?? q.percentChange;
    const price = q.price ?? q.last ?? q.value;
    const label = q.label || q.name || q.symbol;
    return `<button type="button" class="sp-tape-item" data-symbol="${esc(q.symbol || '')}" title="${esc(q.name || label)}${meta.delayed !== false ? ' · delayed' : ''}"><b>${esc(label)}</b><span class="s-num">${fmt.price(price)}</span><span class="s-num ${fmt.dir(pct)}">${fmt.pct(pct)}</span></button>`;
  };
  const once = rows.map(item).join('');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  els.tape.innerHTML = `<div class="sp-tape-set">${once}</div>${reduce ? '' : `<div class="sp-tape-set" aria-hidden="true">${once}</div>`}`;
  els.tape.querySelectorAll('[aria-hidden=true] button').forEach(b => { b.tabIndex = -1; });
  els.tape.style.setProperty('--tape-dur', `${Math.max(30, rows.length * 6)}s`);
  els.tape.classList.toggle('is-moving', !reduce);
  if (meta.source) els.tapeView.title = `Source: ${meta.source}${meta.asOf ? ' · as of ' + fmt.time(meta.asOf) : ''}`;
  els.tape.onclick = (e) => { const b = e.target.closest('.sp-tape-item'); if (b?.dataset.symbol && cur.doc) links.set(primaryGroup(), b.dataset.symbol); };
}

/* ------------------------------------------------------------------ sidebar */
function themeList() {
  const order = prefs.themeOrder || [];
  const byId = new Map(THEMES.map(t => [t.id, t]));
  const out = order.map(id => byId.get(id)).filter(Boolean);
  for (const t of THEMES) if (!out.includes(t)) out.push(t);
  return out;
}
let reorderMode = false;
function renderSidebar() {
  const s = prefs.sections;
  const item = (m, extra = '') => `<li><button type="button" class="sp-nav-item" data-view="${esc(m.id)}" title="${esc(m.name)}"${m.id === cur.id ? ' aria-current="page"' : ''}>${icon(m.icon)}<span class="sp-nav-label">${esc(m.name)}</span></button>${extra}</li>`;
  const themes = themeList();
  const shown = reorderMode || prefs.themesExpanded ? themes : themes.slice(0, 5);
  if (!reorderMode && !prefs.themesExpanded && cur.id && themes.findIndex(t => t.id === cur.id) >= 5) shown.push(themes.find(t => t.id === cur.id));
  const mine = myViews();
  els.side.innerHTML = `
    <div class="sp-side-scroll">
      <a class="sp-research-home" href="/#/briefing" aria-label="Back to research dashboard" title="Back to research dashboard">${icon('back')}<span>Research dashboard</span></a>
      <section class="sp-sec" data-section="views">
        <div class="sp-sec-head"><button type="button" class="sp-sec-toggle" data-sec="views" aria-expanded="${s.views}">${icon('chevron', 'sp-caret')}<span>VIEWS</span></button>
          <button type="button" class="s-icon-btn s-icon-btn-sm sp-collapse" data-act="collapse-side" aria-label="${prefs.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}" aria-pressed="${prefs.sidebarCollapsed}">${icon('sidebar')}</button></div>
        <ul class="sp-nav" ${s.views ? '' : 'hidden'}>${VIEWS.map(v => item(v)).join('')}</ul>
      </section>
      <section class="sp-sec" data-section="themes">
        <div class="sp-sec-head"><button type="button" class="sp-sec-toggle" data-sec="themes" aria-expanded="${s.themes}">${icon('chevron', 'sp-caret')}<span>THEMES</span></button>
          <button type="button" class="s-icon-btn s-icon-btn-sm sp-sec-action" data-act="reorder" aria-label="Reorder Themes section" aria-pressed="${reorderMode}">${icon(reorderMode ? 'x' : 'swap')}</button></div>
        <div class="sp-theme-discovery"><button class="s-btn s-btn-sm" data-act="browse-themes">${icon('search')} Browse all ${THEMES.length} themes</button><div class="sp-theme-featured">${['housing-rates','gambling'].map(id=>{const t=THEMES.find(t=>t.id===id);return `<button data-view="${id}" class="sp-featured-theme">${icon(t.icon)}${esc(t.name)}</button>`;}).join('')}<button data-view="prediction-board" class="sp-featured-theme">${icon('target')}Market events</button></div></div>
        <ul class="sp-nav${reorderMode ? ' is-reorder' : ''}" ${s.themes ? '' : 'hidden'}>${shown.map((t, i) => item(t, reorderMode ? `<span class="sp-reorder"><button type="button" class="s-icon-btn s-icon-btn-sm" data-move="-1" data-theme="${t.id}" aria-label="Move ${esc(t.name)} up" ${i === 0 ? 'disabled' : ''}>${icon('up')}</button><button type="button" class="s-icon-btn s-icon-btn-sm" data-move="1" data-theme="${t.id}" aria-label="Move ${esc(t.name)} down" ${i === shown.length - 1 ? 'disabled' : ''}>${icon('down')}</button></span>` : '')).join('')}
          ${reorderMode ? '' : `<li><button type="button" class="sp-more-link" data-act="themes-more" aria-expanded="${prefs.themesExpanded}">${prefs.themesExpanded ? 'Show less' : `View more (${themes.length - 5})`}</button></li>`}</ul>
      </section>
      <section class="sp-sec" data-section="mine">
        <div class="sp-sec-head"><button type="button" class="sp-sec-toggle" data-sec="mine" aria-expanded="${s.mine}">${icon('chevron', 'sp-caret')}<span>MY VIEWS</span></button>
          <button type="button" class="s-icon-btn s-icon-btn-sm sp-sec-action" data-act="create-mine" aria-label="Create view">${icon('plus')}</button></div>
        <ul class="sp-nav" ${s.mine ? '' : 'hidden'}>${mine.length ? mine.map(m => item({ ...m, icon: m.icon || 'layout' }, `<button type="button" class="s-icon-btn s-icon-btn-sm sp-item-lock" data-sidebar-view-lock="${esc(m.id)}" aria-label="${(m.id===cur.id?cur.doc:loadDoc(m.id))?.layoutLocked?'Unlock':'Lock'} ${esc(m.name)} layout">${icon((m.id===cur.id?cur.doc:loadDoc(m.id))?.layoutLocked?'lock':'unlock')}</button><button type="button" class="s-icon-btn s-icon-btn-sm sp-item-more" data-more="${esc(m.id)}" aria-label="More actions for ${esc(m.name)}">${icon('more')}</button>`)).join('') : '<li class="sp-nav-empty">Clone a view or create one to customize your workspace.</li>'}</ul>
      </section>
    </div>
    <footer class="sp-side-foot">
      <div class="sp-legal"><button type="button" class="sp-link" data-act="disclaimer">Data Disclaimer</button><button type="button" class="sp-link" data-act="terms">Terms</button><button type="button" class="sp-link" data-act="privacy">Privacy</button></div>
      <button type="button" class="sp-account" data-act="workspace" title="Local workspace">${icon('user', 'sp-avatar')}<span class="sp-account-text"><b>Local workspace</b><small>Saved on this device</small></span><span class="s-badge s-badge-accent">LOCAL</span></button>
    </footer>`;
  const container=$('.sp-side-scroll',els.side);
  const order=[...new Set([...(Array.isArray(prefs.sectionOrder)?prefs.sectionOrder:[]),'views','themes','mine'])];
  for(const id of order){const section=$(`[data-section="${id}"]`,container);if(section)container.append(section);}
  const arrange=h(`<div class="sp-sidebar-arrange"><button class="s-btn s-btn-sm s-btn-ghost" data-sidebar-settings>${icon(prefs.sidebarLocked?'lock':'swap')} Sidebar layout</button></div>`);container.prepend(arrange);
  wireSidebar();
}
function wireSidebar() {
  const side = els.side;
  $('[data-sidebar-settings]',side).onclick=sidebarSettings;
  $('[data-act=browse-themes]',side).onclick=openThemeBrowser;
  side.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { navigate(b.dataset.view); setDrawer(false); }));
  side.querySelectorAll('[data-sec]').forEach(b => b.addEventListener('click', () => { prefs.sections[b.dataset.sec] = !prefs.sections[b.dataset.sec]; savePrefs(); renderSidebar(); $(`[data-sec=${b.dataset.sec}]`, side).focus(); }));
  $('[data-act=collapse-side]', side).onclick = () => { prefs.sidebarCollapsed = !prefs.sidebarCollapsed; savePrefs(); applySidebar(); renderSidebar(); $('[data-act=collapse-side]', side).focus(); };
  $('[data-act=reorder]', side).disabled=!!prefs.sidebarLocked;
  $('[data-act=reorder]', side).onclick = () => { reorderMode = !reorderMode; renderSidebar(); $('[data-act=reorder]', side).focus(); };
  side.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
    const list = themeList().map(t => t.id); const i = list.indexOf(b.dataset.theme), j = i + +b.dataset.move;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]]; prefs.themeOrder = list; savePrefs(); renderSidebar();
    $(`[data-move="${b.dataset.move}"][data-theme="${b.dataset.theme}"]`, side)?.focus();
  }));
  const more = $('[data-act=themes-more]', side);
  if (more) more.onclick = () => { prefs.themesExpanded = !prefs.themesExpanded; savePrefs(); renderSidebar(); $('[data-act=themes-more]', side)?.focus(); };
  $('[data-act=create-mine]', side).onclick = createFromScratch;
  side.querySelectorAll('[data-sidebar-view-lock]').forEach(b=>b.onclick=()=>toggleViewLayout(b.dataset.sidebarViewLock));
  side.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => openMenu(b, myViewMenu(b.dataset.more), { label: 'View actions' })));
  side.querySelectorAll('.sp-nav-item').forEach(b => b.addEventListener('contextmenu', (e) => {
    const id = b.dataset.view; e.preventDefault();
    const items = myViews().some(v => v.id === id) ? myViewMenu(id) : [{ label: 'Open', icon: 'chevronR', onSelect: () => navigate(id) }, { label: 'Clone view', icon: 'copy', onSelect: () => cloneView(id) }];
    openMenu(b, items, { label: 'View actions' });
  }));
  $('[data-act=disclaimer]', side).onclick = showDisclaimer;
  $('[data-act=terms]', side).onclick = () => openDialog({ title: 'Terms', body: '<p>Ultimater is a research tool provided as part of Ultimater for informational purposes only. Nothing here is investment, tax or legal advice, and nothing is an offer to buy or sell any security. You are responsible for your own decisions.</p>' });
  $('[data-act=privacy]', side).onclick = () => openDialog({ title: 'Privacy', body: '<p>Your views, layouts, linked symbols, recent searches and display settings are stored in this browser by default. Portable workspace files and optional encrypted workspace sync transfer layouts and settings; portfolio holdings, broker selections and AI conversations are excluded. Sync uses a code you keep, rather than a Ultimater account. Market data requests go through the Ultimater server to the listed data providers; questions you send to Ultimater AI are processed to generate an answer.</p>' });
  menuButton($('[data-act=workspace]', side), () => [
    { heading: 'Local workspace · portable files' },
    { label: 'Export workspace', icon: 'download', onSelect: exportWorkspace },
    { label: 'Encrypted workspace sync…', icon: 'swap', onSelect: syncWorkspace },
    { label: 'Import workspace…', icon: 'up', onSelect: importWorkspace },
    { separator: true },
    { label: 'Reset workspace…', icon: 'reset', danger: true, onSelect: resetWorkspace }
  ], { label: 'Workspace' });
}
export function openThemeBrowser() {
  const groups=[...new Set(THEMES.map(t=>t.group))];
  const d=openDialog({title:'Explore stock themes',className:'sp-theme-browser',body:`<p>Explore editorial research groups. Stocks and ETFs are identified separately; these lists are not portfolios or recommendations.</p><div class="sp-theme-filters"><input class="s-input" type="search" data-theme-query placeholder="Search housing, prediction markets, tickers or companies…" aria-label="Search all themes"><select class="s-select" data-theme-group aria-label="Theme category"><option value="all">All categories</option>${groups.map(g=>`<option>${esc(g)}</option>`).join('')}</select></div><p class="s-muted" role="status" data-theme-count></p><div class="sp-theme-cards"></div>`});
  const input=$('[data-theme-query]',d.body),group=$('[data-theme-group]',d.body),cards=$('.sp-theme-cards',d.body);
  function draw(){const found=searchThemes(input.value,group.value);$('[data-theme-count]',d.body).textContent=found.length+' of '+THEMES.length+' themes';cards.innerHTML=found.length?found.map(t=>`<button class="sp-theme-card" data-theme-open="${t.id}"><span>${icon(t.icon)}<b>${esc(t.name)}</b></span><small>${esc(t.group)} · ${t.constituents.filter(r=>r.instrumentType==='stock').length} stocks${t.kind==='crypto'?' · crypto':''}${t.constituents.some(r=>r.instrumentType==='etf')?' + ETFs':''}</small><p>${esc(t.description)}</p><span class="sp-theme-symbols">${t.symbols.slice(0,6).map(esc).join(' · ')}</span></button>`).join(''):'<p>No themes match. Try a ticker, industry or company name.</p>';cards.querySelectorAll('[data-theme-open]').forEach(b=>b.onclick=()=>{d.close();navigate(b.dataset.themeOpen);setDrawer(false);});}
  input.oninput=draw;group.onchange=draw;input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();cards.querySelector('[data-theme-open]')?.click();}};draw();input.focus();
}
function myViewMenu(id) {
  const doc=id===cur.id?cur.doc:loadDoc(id);
  return [
    { label: 'Change icon', icon: doc?.icon || 'layout', onSelect: () => chooseViewIcon(id) },
    { label: doc?.layoutLocked?'Unlock layout':'Lock layout', icon:doc?.layoutLocked?'unlock':'lock', onSelect:()=>toggleViewLayout(id) },
    { label: 'Move up', disabled:prefs.sidebarLocked||myViews()[0]?.id===id,onSelect:()=>moveMyView(id,-1) },
    { label: 'Move down', disabled:prefs.sidebarLocked||myViews().at(-1)?.id===id,onSelect:()=>moveMyView(id,1) },
    { label: 'Rename', icon: 'edit', onSelect: () => renameView(id) },
    { label: 'Duplicate', icon: 'copy', onSelect: () => cloneView(id) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, onSelect: () => deleteView(id) }
  ];
}

function moveMyView(id,offset) {const views=myViews();const ids=moveItem(views.map(v=>v.id),id,offset);setMyViews(ids.map(i=>views.find(v=>v.id===i)));renderSidebar();}
function toggleViewLayout(id) {const doc=id===cur.id?cur.doc:loadDoc(id);if(!doc)return;doc.layoutLocked=!doc.layoutLocked;store.set('view:'+id,doc);if(id===cur.id){renderHead();renderGrid();}renderSidebar();toast(doc.layoutLocked?'Layout locked':'Layout unlocked');}
function chooseViewIcon(id) {
  const doc=id===cur.id?cur.doc:loadDoc(id);if(!doc)return;
  const names=['layout','pulse','analysis','news','portfolio','calendar','options','rocket','seven','bitcoin','chip','bank','globe','star','heart','target','leaf','bag','shield','bolt','home','pill','dice','vault','swap','antenna','factory','flame','cart','cube','plug','building'];
  const d=openDialog({title:'Choose a view icon',body:`<div class="sp-icon-picker">${names.map(n=>`<button class="s-btn" data-icon="${n}" aria-label="${n}" aria-pressed="${doc.icon===n}">${icon(n)}</button>`).join('')}</div>`});
  d.body.querySelectorAll('[data-icon]').forEach(b=>b.onclick=()=>{doc.icon=b.dataset.icon;store.set('view:'+id,doc);setMyViews(myViews().map(v=>v.id===id?{...v,icon:doc.icon}:v));renderSidebar();if(id===cur.id)renderHead();d.close();});
}
function sidebarSettings() {
  const d=openDialog({title:'Sidebar layout',body:'<div data-section-settings></div>',footer:'<button class="s-btn" data-close>Done</button>'});
  function draw(){const order=[...new Set([...(Array.isArray(prefs.sectionOrder)?prefs.sectionOrder:[]),'views','themes','mine'])].filter(k=>['views','themes','mine'].includes(k));const box=$('[data-section-settings]',d.body);box.innerHTML=`<label><input type="checkbox" data-side-lock ${prefs.sidebarLocked?'checked':''}> Lock sidebar order</label>${order.map((id,i)=>`<div class="sp-order-row"><span>${({views:'Views',themes:'Themes',mine:'My Views'})[id]}</span><button class="s-btn s-btn-sm" data-shift="-1" data-id="${id}" aria-label="Move ${id} up" ${prefs.sidebarLocked||!i?'disabled':''}>↑</button><button class="s-btn s-btn-sm" data-shift="1" data-id="${id}" aria-label="Move ${id} down" ${prefs.sidebarLocked||i===order.length-1?'disabled':''}>↓</button></div>`).join('')}`;$('[data-side-lock]',box).onchange=e=>{prefs.sidebarLocked=e.target.checked;if(prefs.sidebarLocked)reorderMode=false;savePrefs();renderSidebar();draw();};box.querySelectorAll('[data-shift]').forEach(b=>b.onclick=()=>{prefs.sectionOrder=moveItem(order,b.dataset.id,+b.dataset.shift);savePrefs();renderSidebar();draw();});}draw();
}
function applySidebar() { root.classList.toggle('side-collapsed', !!prefs.sidebarCollapsed); }
function setDrawer(open) {
  root.classList.toggle('drawer-open', open); els.backdrop.hidden = !open;
  $('[data-act=drawer]', root).setAttribute('aria-expanded', String(open));
  if (open) $('.sp-nav-item', els.side)?.focus();
}

/* ------------------------------------------------------------------ workspace file ops */
function workspaceSnapshot() {saveDoc(true);return collectWorkspace(localStorage);}
function exportWorkspace() {
  download(`ultimater-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(workspaceSnapshot(), null, 2), 'application/json');
}
async function syncWorkspace() {
  try{const sync=await import('./workspace-sync.js');sync.openWorkspaceSync({getWorkspace:workspaceSnapshot,importWorkspace:file=>{replaceWorkspace(file,listPanels().map(p=>p.type),localStorage);location.reload();}});}catch(e){toast('Workspace sync could not open: '+e.message);}
}
function importWorkspace() {
  const input = h('<input type="file" accept="application/json,.json" hidden>');
  input.onchange = async () => {
    try {
      if(!input.files[0])return;
      if(input.files[0].size>5e6)throw new Error('Workspace files must be smaller than 5 MB.');
      const parsed = JSON.parse(await input.files[0].text());
      const validated=validateWorkspaceFile(parsed,listPanels().map(p=>p.type));
      if (!(await confirmDialog({ title: 'Import workspace', text: 'This replaces your views and settings on this device with the imported workspace.', ok: 'Import' }))) return;
      replaceWorkspace({...parsed,data:validated},listPanels().map(p=>p.type),localStorage);
      location.reload();
    } catch (e) { toast(`Import failed: ${e.message}`); }
  };
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60_000);
}
function clearWorkspace() { const keys = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith('space:')) keys.push(k); } keys.forEach(k => localStorage.removeItem(k)); }
async function resetWorkspace() {
  if (await confirmDialog({ title: 'Reset workspace', text: 'Delete all of your views, layouts and settings on this device? This cannot be undone.', ok: 'Reset', danger: true })) { clearWorkspace(); location.href = location.pathname; }
}
function download(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h(`<a download="${esc(name)}" href="${url}" hidden></a>`); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ dialogs: shortcuts / disclaimer */
const SHORTCUTS = [
  ['⌘K / Ctrl K', 'Search symbols and commands'], ['/', 'Search'], ['?', 'Keyboard shortcuts'], ['[', 'Collapse or expand the sidebar'], [']', 'Show or hide Ultimater AI'],
  ['T', 'Cycle Dark, Light and Blue Steel'], ['>', 'Command mode (type in search)'], ['A', 'Add a panel'], ['G then M / A / N / B / P / E / O', 'Go to Markets, Analysis, News, Prediction Markets, My Portfolio, Earnings Hub, Options'],
  ['Esc', 'Close menus and dialogs, restore an expanded panel'], ['Arrow keys on a panel’s move handle', 'Move the panel (custom views)'], ['Shift + arrows on the move handle', 'Resize the panel']
];
function showShortcuts() {
  openDialog({ title: 'Keyboard shortcuts', body: `<table class="s-table sp-shortcuts"><tbody>${SHORTCUTS.map(([k, d]) => `<tr><td>${k.split(' / ').map(x => `<kbd class="s-kbd">${esc(x)}</kbd>`).join(' ')}</td><td>${esc(d)}</td></tr>`).join('')}</tbody></table><label class="sp-shortcut-setting"><input type="checkbox" data-single-keys ${prefs.singleKeyShortcuts !== false?'checked':''}> Enable single-key shortcuts outside text fields</label>` });
  const input=document.querySelector('[data-single-keys]');input.onchange=()=>setPref('singleKeyShortcuts',input.checked);
}
function showDisclaimer() {
  openDialog({ title: 'Data disclaimer', body: `
    <p>Quotes, charts, fundamentals, options and news in Ultimater come from third-party providers (Nasdaq, Finnhub, Coinbase and others listed on each panel). Stock and index data may be delayed by 15 minutes or more; crypto quotes are near real time. Data can be incomplete or wrong, and is provided as-is.</p>
    <p>Some figures are <strong>derived</strong> by Ultimater rather than reported, for example implied volatility (Black-Scholes), max pain and unusual-options scans. They are labeled as derived where shown.</p>
    <p>Ultimater AI answers are generated by an AI model and can be mistaken. Double-check anything important.</p>
    <p>Nothing in Ultimater is investment advice.</p>` });
}

/* ------------------------------------------------------------------ dock */
function applyDock() {
  const st = prefs.dock;
  els.dock.dataset.state = st;
  root.dataset.dock = st;
  root.style.setProperty('--sp-dock-w', `${Math.round(prefs.dockWidth)}px`);
  const b = $('[data-act=dock-toggle]', root);
  if (b) { b.setAttribute('aria-pressed', String(st !== 'collapsed')); b.setAttribute('aria-expanded', String(st !== 'collapsed')); b.setAttribute('aria-label', st === 'collapsed' ? 'Show Ultimater AI' : 'Hide Ultimater AI'); b.title = b.getAttribute('aria-label'); }
  els.resizer.hidden = st === 'collapsed';
  els.resizer.setAttribute('aria-valuenow', String(Math.round(prefs.dockWidth)));
  els.resizer.setAttribute('aria-valuemin', '300'); els.resizer.setAttribute('aria-valuemax', '720');
}
export function setDock(st) { if (prefs.dock === st) return; prefs.dock = st; savePrefs(); applyDock(); bus.emit('dock:state', { state: st }); if (st !== 'collapsed') bus.emit('ai:open'); }
function wireDock() {
  const clamp = w => Math.max(300, Math.min(720, w, innerWidth - 480));
  els.resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault(); els.resizer.setPointerCapture(e.pointerId); root.classList.add('is-resizing');
    const move = (ev) => { prefs.dockWidth = clamp(innerWidth - ev.clientX); if (prefs.dock === 'expanded') prefs.dock = 'open'; applyDock(); };
    const up = () => { els.resizer.removeEventListener('pointermove', move); root.classList.remove('is-resizing'); savePrefs(); };
    els.resizer.addEventListener('pointermove', move); els.resizer.addEventListener('pointerup', up, { once: true });
  });
  els.resizer.addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? 24 : e.key === 'ArrowRight' ? -24 : 0; if (!d) return;
    e.preventDefault(); prefs.dockWidth = clamp(prefs.dockWidth + d); savePrefs(); applyDock();
  });
  els.resizer.addEventListener('dblclick', () => { prefs.dockWidth = 380; savePrefs(); applyDock(); });
}

/* ------------------------------------------------------------------ responsive */
function wireResponsive() {
  const check = () => {
    const narrow = innerWidth < 1024;
    root.classList.toggle('is-narrow', narrow);
    els.notice.hidden = !narrow || prefs.noticeDismissed;
    if (!narrow) setDrawer(false);
  };
  check(); addEventListener('resize', check);
  els.backdrop.addEventListener('click', () => { setDrawer(false); if (root.classList.contains('is-narrow') && prefs.dock !== 'collapsed') setDock('collapsed'); });
}

/* ------------------------------------------------------------------ keyboard */
let gPending = 0;
function wireKeys() {
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (document.querySelector('dialog[open]') || openMenuState) return;
    if (k === 'Escape' && cur.maxId) { toggleMax(cur.maxId); return; }
    if (k === 'Escape' && root.classList.contains('drawer-open')) { setDrawer(false); return; }
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || prefs.singleKeyShortcuts === false) return;
    if (gPending && Date.now() - gPending < 1200) {
      gPending = 0;
      const map = { m: 'markets', a: 'analysis', n: 'news', b: 'prediction-board', p: 'my-portfolio', e: 'earnings', o: 'options' };
      if (map[k]) { e.preventDefault(); navigate(map[k]); }
      return;
    }
    if (k === '/') { e.preventDefault(); openSearch(); }
    else if (k === '?') { e.preventDefault(); showShortcuts(); }
    else if (k === '[') { prefs.sidebarCollapsed = !prefs.sidebarCollapsed; savePrefs(); applySidebar(); renderSidebar(); }
    else if (k === ']') setDock(prefs.dock === 'collapsed' ? 'open' : 'collapsed');
    else if (k === 'a' && !e.target.closest?.('.sp-panel-body')) { e.preventDefault(); openCatalog(); }
    else if (k === 'g') gPending = Date.now();
    else if (k.toLowerCase() === 't') { e.preventDefault();cycleTheme(); }
  });
}

/* ------------------------------------------------------------------ bus wiring */
function wireBus() {
  bus.on('workspace:sync',syncWorkspace);
  bus.on('symbol', ({ group, symbol }) => {
    if (!cur.doc || !group.startsWith(cur.doc.id + ':')) return;
    const key = group.slice(cur.doc.id.length + 1);
    cur.doc.groups = { ...(cur.doc.groups || {}), [key]: symbol };
    if (key === 'A' && !cur.doc.symbols.includes(symbol)) cur.doc.symbols = [symbol, ...cur.doc.symbols].slice(0, 30);
    saveDoc();
    for (const m of cur.mounted.values()) {
      if (gid(m.p) !== group) continue;
      updatePanelSymbol(m);
      if (m.def?.symbolLinked) { try { m.inst?.onSymbol?.(symbol); } catch (err) { console.error('[space] onSymbol failed', err); } }
    }
    if (key === 'A') renderHeadChips();
  });
  bus.on('view:open', (d) => d?.id && navigate(d.id));
  bus.on('view:create', (d) => createCustom(d?.name || 'New view', d?.panels || [], d?.symbols));
  bus.on('panel:add', (d) => d?.type && addPanel(d.type, d.state || {}));
  bus.on('panel:share', d => { const m = cur.mounted.get(d?.id); if (m) sharePanel(m); });
  bus.on('earnings:open-detail', d => {
    const existing = [...cur.mounted.values()].find(m => m.p.type === 'earnings-detail' && gid(m.p) === d?.group);
    if (!existing) return addPanel('earnings-detail');
    if (cur.maxId && cur.maxId !== existing.p.id) toggleMax(cur.maxId);
    setFocused(existing.p.id);
    existing.el.scrollIntoView({ block: 'start' });
    existing.el.querySelector('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  });
  bus.on('search:open', (d) => openSearch(d || {}));
  bus.on('ai:open', () => prefs.dock === 'collapsed' && setDock('open'));
  bus.on('ai:ask', () => prefs.dock === 'collapsed' && setDock('open'));
  bus.on('ai:layout', d => { if (d?.open === false) setDock('collapsed'); });
  bus.on('dock:open', () => setDock('open'));
  bus.on('dock:close', () => setDock('collapsed'));
  bus.on('dock:toggle', () => setDock(prefs.dock === 'collapsed' ? 'open' : 'collapsed'));
  bus.on('dock:expand', () => setDock(prefs.dock === 'expanded' ? 'open' : 'expanded'));
  bus.on('alerts:triggered', () => setUnread(unread + 1));
  bus.on('notifications:added', n => { if(n.category!=='price')setUnread(unread+1); });
}

/* ------------------------------------------------------------------ views */
function openView(id, { push = true, replace = false } = {}) {
  const doc = loadDoc(id) || loadDoc('markets');
  teardown();
  cur.id = doc.id; cur.doc = doc; cur.maxId = null; focusedPanelId = null;
  doc.symbols = doc.symbols?.length ? doc.symbols : ['NVDA'];
  doc.groups = { A: doc.symbols[0], ...(doc.groups || {}) };
  store.set('lastView', doc.id);
  const url = new URL(location.href); url.searchParams.set('view', doc.id);
  if (replace) history.replaceState({ view: doc.id }, '', url); else if (push) history.pushState({ view: doc.id }, '', url);
  document.title = `${doc.name} · Ultimater`;
  // Seed link groups for this view.
  for (const p of doc.panels) {
    const g = gid(p), key = g.slice(doc.id.length + 1);
    const sym = doc.groups[key] || (p.locked && p.pinned) || doc.groups.A;
    if (sym && links.get(g) !== sym) links.set(g, sym);
  }
  root.classList.toggle('is-editable', editable());
  renderSidebar(); renderHead(); renderGrid();
  els.scroll.scrollTop = 0;
  bus.emit('view:changed', { id: doc.id, name: doc.name, kind: doc.kind, symbol: doc.symbolFree ? null : doc.groups.A });
}
function teardown() {
  cur.maxId = null; els.grid?.classList.remove('has-max');
  for (const m of cur.mounted.values()) destroyPanel(m);
  cur.mounted.clear();
  if (els.grid) els.grid.innerHTML = '';
}

function renderHead() {
  const d = cur.doc;
  els.head.innerHTML = `
    <h1 class="sp-view-title">${editable() ? `<button type="button" class="sp-title-btn" data-act="rename" title="Rename view">${esc(d.name)}</button>` : esc(d.name)}</h1>
    <div class="sp-chips" role="group" aria-label="Linked symbols"></div>
    <div class="sp-head-spacer"></div>
    ${editable() ? `<button type="button" class="s-icon-btn" data-act="lock-view" aria-pressed="${!!d.layoutLocked}" aria-label="${d.layoutLocked ? 'Unlock layout' : 'Lock layout'}" title="${d.layoutLocked ? 'Layout locked' : 'Lock layout'}">${icon(d.layoutLocked ? 'lock' : 'unlock')}</button>
      <button type="button" class="s-btn" data-act="add-panel">${icon('plus')}<span>Add Panel</span></button>` : ''}
    <button type="button" class="s-btn" data-act="clone">${icon('copy')}<span>Clone View</span></button>
    <button type="button" class="s-icon-btn sp-head-more" data-act="view-more" aria-label="More view actions">${icon('more')}</button>`;
  renderHeadChips();
  if (d.symbolFree) $('.sp-chips', els.head).setAttribute('aria-label', 'Market data providers');
  const a = (n) => $(`[data-act=${n}]`, els.head);
  a('clone').onclick = () => cloneView(d.id);
  if (editable()) {
    a('rename').onclick = () => renameView(d.id);
    a('add-panel').onclick = () => openCatalog();
    a('lock-view').onclick = () => { d.layoutLocked = !d.layoutLocked; saveDoc(true); renderHead(); renderGrid(); $('[data-act=lock-view]', els.head).focus(); toast(d.layoutLocked ? 'Layout locked' : 'Layout unlocked'); };
  }
  menuButton(a('view-more'), () => editable() ? [
    { label: 'Add panel', icon: 'plus', onSelect: () => openCatalog() },
    { label: d.layoutLocked ? 'Unlock layout' : 'Lock layout', icon: d.layoutLocked ? 'unlock' : 'lock', onSelect: () => a('lock-view').click() },
    { label: 'Change icon', icon:d.icon || 'layout', onSelect:()=>chooseViewIcon(d.id) },
    { label: 'Remove selected panel',icon:'trash',disabled:layoutLocked()||!focusedPanelId||!!cur.mounted.get(focusedPanelId)?.p.locked,onSelect:()=>removePanel(focusedPanelId) },
    { label: 'Clear all panels…',icon:'trash',disabled:layoutLocked(),danger:true,onSelect:clearPanels },
    { label: 'Rename', icon: 'edit', onSelect: () => renameView(d.id) },
    { label: 'Duplicate', icon: 'copy', onSelect: () => cloneView(d.id) },
    { separator: true },
    { label: 'Delete view', icon: 'trash', danger: true, onSelect: () => deleteView(d.id) }
  ] : [
    { label: 'Clone to My Views', icon: 'copy', onSelect: () => cloneView(d.id) },
    { label: 'Add panel (creates a copy)', icon: 'plus', onSelect: () => openCatalog() },
    { label: 'Reset view to default', icon: 'reset', onSelect: () => { store.remove('view:' + d.id); openView(d.id, { push: false }); toast('View reset'); } }
  ], { align: 'end', label: 'View actions' });
}

async function clearPanels() {
  const doc=cur.doc;if(layoutLocked())return;
  if(!await confirmDialog({title:'Clear all panels',text:'Remove all unlocked panels from this custom view? Locked panels remain.',ok:'Clear panels',danger:true}))return;
  if(cur.doc!==doc||layoutLocked())return;
  const before=JSON.parse(JSON.stringify(doc.panels));doc.panels=doc.panels.filter(p=>p.locked);saveDoc(true);renderGrid();
  toast('Cleared unlocked panels',{action:'Undo',onAction:()=>{if(cur.doc!==doc)return;doc.panels=before;saveDoc(true);renderGrid();}});
}
function renderHeadChips() {
  const box = $('.sp-chips', els.head); if (!box) return;
  if (cur.doc.symbolFree) { box.innerHTML = '<span class="sp-view-subtitle">Kalshi · Polymarket</span>'; return; }
  const d = cur.doc, active = links.get(primaryGroup()) || d.groups.A;
  const syms = d.symbols.includes(active) ? d.symbols : [active, ...d.symbols];
  const MAX = 3;
  const ordered = [active, ...syms.filter(s => s !== active)];
  const visible = syms.slice(0, MAX).includes(active) ? syms.slice(0, MAX) : ordered.slice(0, MAX);
  const rest = syms.filter(s => !visible.includes(s));
  const chip = (s) => `<span class="s-chip sp-sym-chip${s === active ? ' is-active' : ''}"><button type="button" class="sp-chip-main" data-sym="${esc(s)}" aria-pressed="${s === active}" aria-label="${esc(s)}${s === active ? ' (active symbol)' : ''}">${s === active ? '<span class="s-chip-dot"></span>' : ''}${esc(s)}</button>${syms.length > 1 ? `<button type="button" class="s-chip-x" data-remove="${esc(s)}" aria-label="Remove ${esc(s)}">×</button>` : ''}</span>`;
  box.innerHTML = visible.map(chip).join('') + (rest.length ? `<button type="button" class="s-chip sp-chip-more" data-act="chips-more" aria-label="${rest.length} more symbols">+${rest.length}</button>` : '') +
    `<button type="button" class="sp-add-ticker" data-act="add-ticker" aria-label="Add ticker">${icon('plus')}</button>`;
  box.querySelectorAll('[data-sym]').forEach(b => b.onclick = () => links.set(primaryGroup(), b.dataset.sym));
  box.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => removeChip(b.dataset.remove));
  const more = $('[data-act=chips-more]', box);
  if (more) menuButton(more, () => rest.map(s => ({ label: s, onSelect: () => links.set(primaryGroup(), s) })), { label: 'More symbols' });
  $('[data-act=add-ticker]', box).onclick = () => openSearch({ mode: 'add' });
}
function removeChip(sym) {
  const d = cur.doc; if (d.symbols.length <= 1) return;
  const wasActive = links.get(primaryGroup()) === sym;
  d.symbols = d.symbols.filter(s => s !== sym); saveDoc();
  if (wasActive) links.set(primaryGroup(), d.symbols[0]); else renderHeadChips();
  $('.sp-add-ticker', els.head)?.focus();
}

/* ------------------------------------------------------------------ custom views: create / clone / rename / delete */
function createCustom(name, panels = [], symbols, source = {}) {
  const id = uid('my-');
  const syms = symbols?.length ? symbols : [links.get(cur.doc ? primaryGroup() : '') || 'NVDA'];
  const doc = {
    id, name, kind: 'custom', icon: source.icon || 'layout', theme: source.theme, symbols: syms, groups: { A: syms[0], ...(source.groups || {}) }, layoutLocked: false,
    panels: panels.map((p, i) => ({ id: `${id}-${i}`, group: 'A', state: {}, ...p, x: p.x ?? 0, y: p.y ?? 0, w: p.w ?? 4, h: p.h ?? 8 }))
  };
  for (const p of doc.panels) if ((p.locked || !p.group) && p.pinned) doc.groups[p.id] = p.pinned;
  resolveLayout(doc.panels);
  store.set('view:' + id, doc);
  setMyViews([{ id, name, icon: doc.icon }, ...myViews()]);
  navigate(id);
  return id;
}
async function createFromScratch() {
  const name = await promptDialog({ title: 'Create view', label: 'View name', value: `My view ${myViews().length + 1}`, ok: 'Create' });
  if (!name) return;
  createCustom(name, []);
  setTimeout(() => tour.start('scratch'), 150);
}
// Used by the template picker (tour.js): copy a built-in/theme layout into My Views.
function createFromTemplate(templateId) {
  const base = getBuiltin(templateId); if (!base) return;
  createCustom(`${base.name} Copy`, base.panels.map(({ id, ...p }) => p), base.symbols, base);
  toast(`Created “${base.name} Copy” in My Views`);
}
function cloneView(id) {
  const src = id === cur.id ? cur.doc : loadDoc(id); if (!src) return;
  if (id === cur.id) saveDoc(true);
  const newId = createCustom(`${src.name} Copy`, src.panels.map(({ id: oldId, ...p }) => ({ ...JSON.parse(JSON.stringify(p)), ...((p.locked || !p.group) ? { pinned: src.groups?.[oldId] || p.pinned || src.groups?.A } : {}) })), src.symbols.slice(), src);
  toast(`Cloned to My Views as “${src.name} Copy”`);
}
async function renameView(id) {
  const meta = myViews().find(v => v.id === id); if (!meta) return;
  const name = await promptDialog({ title: 'Rename view', label: 'View name', value: meta.name });
  if (!name) return;
  setMyViews(myViews().map(v => v.id === id ? { ...v, name } : v));
  const doc = id === cur.id ? cur.doc : store.get('view:' + id);
  if (doc) { doc.name = name; store.set('view:' + id, doc); }
  if (id === cur.id) { document.title = `${name} · Ultimater`; renderHead(); }
  renderSidebar();
}
async function deleteView(id) {
  const meta = myViews().find(v => v.id === id); if (!meta) return;
  if (!(await confirmDialog({ title: 'Delete view', text: `Delete “${meta.name}”? Its layout will be removed from this device.`, ok: 'Delete', danger: true }))) return;
  setMyViews(myViews().filter(v => v.id !== id)); store.remove('view:' + id);
  if (id === cur.id) navigate('markets'); else renderSidebar();
  toast(`Deleted “${meta.name}”`);
}
// Built-in views have a fixed layout (like the original); editing actions copy them into My Views first.
function ensureEditable() {
  if (editable()) return true;
  saveDoc(true);
  const src = cur.doc;
  createCustom(`${src.name} Copy`, src.panels.map(({ id: oldId, ...p }) => ({ ...JSON.parse(JSON.stringify(p)), ...((p.locked || !p.group) ? { pinned: src.groups?.[oldId] || p.pinned || src.groups?.A } : {}) })), src.symbols.slice(), src);
  toast(`Built-in views are fixed — made an editable copy, “${src.name} Copy”`);
  return true;
}

/* ------------------------------------------------------------------ grid layout engine */
const overlap = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// Moved item keeps its spot; anything it collides with is pushed down; then everything floats up to fill gaps.
export function resolveLayout(panels, movedId) {
  for (const p of panels) { p.w = Math.max(1, Math.min(12, p.w | 0)); p.x = Math.max(0, Math.min(12 - p.w, p.x | 0)); p.y = Math.max(0, p.y | 0); p.h = Math.max(2, p.h | 0); }
  const moved = panels.find(p => p.id === movedId);
  const rest = panels.filter(p => p !== moved).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed = moved ? [moved] : [];
  for (const p of rest) {
    let hit; while ((hit = placed.filter(q => overlap(q, p))).length) p.y = Math.max(...hit.map(q => q.y + q.h));
    placed.push(p);
  }
  const out = [];
  for (const p of [...placed].sort((a, b) => a.y - b.y || a.x - b.x || (a === moved ? -1 : 1))) {
    while (p.y > 0 && !out.some(q => overlap(q, { ...p, y: p.y - 1 }))) p.y--;
    while (out.some(q => overlap(q, p))) p.y++;
    out.push(p);
  }
  return panels;
}
function findSpot(w, h) {
  const ps = cur.doc.panels, bottom = Math.max(0, ...ps.map(p => p.y + p.h));
  for (let y = 0; y <= bottom; y++) for (let x = 0; x <= 12 - w; x++) { const c = { x, y, w, h }; if (!ps.some(p => overlap(p, c))) return { x, y }; }
  return { x: 0, y: bottom };
}
function placeAll() {
  for (const m of cur.mounted.values()) {
    const { p, el } = m;
    el.style.setProperty('--sp-panel-h', p.h);
    el.style.gridColumn = `${p.x + 1} / span ${p.w}`; el.style.gridRow = `${p.y + 1} / span ${p.h}`;
  }
}

/* ------------------------------------------------------------------ panels */
function renderGrid() {
  teardown();
  const d = cur.doc;
  els.grid.dataset.view = d.id;
  els.grid.classList.toggle('is-locked', layoutLocked());
  if (!d.panels.length) {
    els.grid.innerHTML = `<div class="sp-empty">${ui.empty('This view has no panels yet.')}<button type="button" class="s-btn s-btn-primary" data-act="first-panel">${icon('plus')}<span>Add a panel</span></button></div>`;
    $('[data-act=first-panel]', els.grid).onclick = () => openCatalog();
    return;
  }
  resolveLayout(d.panels);
  for (const p of d.panels) mountPanel(p);
  placeAll();
}

function panelHeadHTML(p, def) {
  const linked = !!def?.symbolLinked;
  const canEdit = !layoutLocked();
  const groupLabel = p.locked ? 'Locked to ticker' : p.group ? `Link group ${p.group}` : 'Unlinked';
  return `<header class="sp-panel-head">
      ${canEdit ? `<button type="button" class="sp-drag" aria-label="Move panel. Arrow keys move, Shift + arrows resize." ${p.locked ? 'disabled' : ''}>${icon('drag')}</button>` : ''}
      ${linked ? `<button type="button" class="sp-panel-sym" data-act="psym" aria-label="Change symbol"></button>
        <button type="button" class="sp-link-chip" data-act="link" data-group="${p.locked ? 'L' : (p.group || '')}" aria-label="${esc(groupLabel)}" title="${esc(groupLabel)}">${p.locked ? icon('lock') : p.group ? esc(p.group) : icon('plus')}</button>` : ''}
      <button type="button" class="sp-panel-title" data-act="variant" ${def?.variants?.length ? '' : 'disabled'}><span class="sp-title-text"></span><span data-variant-caret ${def?.variants?.length?'':'hidden'}>${icon('chevron', 'sp-caret')}</span></button>
      ${['chart','multi-chart','news'].includes(p.type)?`<button type="button" class="s-icon-btn s-icon-btn-sm" data-act="panel-symbol-add" aria-label="${p.type==='news'?'Add ticker':'Add comparison'}" title="${p.type==='news'?'Add ticker':'Add comparison'}">${icon('plus')}</button>`:''}
      <span class="sp-panel-sub"></span>
      <span class="sp-head-spacer"></span>
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="csv" aria-label="Download data" hidden>${icon('download')}</button>
      ${linked ? `<button type="button" class="s-icon-btn s-icon-btn-sm" data-act="lock" aria-pressed="${!!p.locked}" aria-label="${p.locked ? 'Unlock panel' : 'Lock panel to current ticker'}" title="${p.locked ? 'Unlock panel' : 'Lock panel to current ticker'}">${icon(p.locked ? 'lock' : 'unlock')}</button>` : ''}
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="panel-more" aria-label="More panel actions">${icon('more')}</button>
      <button type="button" class="s-icon-btn s-icon-btn-sm sp-ai-btn" data-act="ai" aria-label="Ask Ultimater AI about this panel">${icon('sparkle')}</button>
      <button type="button" class="s-icon-btn s-icon-btn-sm" data-act="max" aria-label="Expand panel" aria-pressed="false">${icon('expand')}</button>
      ${editable() ? `<button type="button" class="s-icon-btn s-icon-btn-sm" data-act="close" aria-label="Remove panel" ${p.locked || layoutLocked() ? 'disabled' : ''}>${icon('trash')}</button>` : ''}
    </header>`;
}

function mountPanel(p) {
  const def = getPanel(p.type);
  if (p.type === 'news' && p.state?.mode) {
    const mode = ({ ticker: 'linked', top: 'market' })[p.state.mode] || p.state.mode;
    if (def?.variants?.some(v => v.id === mode)) p.variant = mode;
  }
  const el = h(`<section class="sp-panel" data-id="${esc(p.id)}" data-type="${esc(p.type)}" aria-label="${esc(def?.title || p.type)}">${panelHeadHTML(p, def)}<div class="sp-panel-body"></div>${!layoutLocked() ? '<div class="sp-resize" aria-hidden="true"></div>' : ''}</section>`);
  els.grid.append(el);
  const body = $('.sp-panel-body', el);
  const m = { p, def, el, body, inst: null, title: null, sub: '' };
  cur.mounted.set(p.id, m);
  if (!def) {
    body.innerHTML = ui.unavailable(p.type, 'This panel type is not installed yet.');
  } else {
    if (def.variants?.length && !def.variants.some(v => v.id === p.variant)) p.variant = def.variants[0].id;
    const ctx = {
      type: p.type, id: p.id,
      get group() { return gid(p); },
      get symbol() { return def.symbolLinked ? links.get(gid(p)) : null; },
      get state() { return p.state || (p.state = {}); },
      setState(patch) {
        const previous = p.state;
        p.state = { ...(p.state || {}), ...patch };
        const saved = saveDoc(p.type === 'watchlist' && Array.isArray(patch.symbols));
        if (saved === false) p.state = previous;
        return saved;
      },
      setTitle(t) { m.title = t; updateTitle(m); },
      setSubtitle(t) { m.sub = t || ''; updateTitle(m); },
      openSymbol(sym) { if (sym) links.set(gid(p), sym); },
      get variant() { return p.variant || null; },
      setVariant(id) { if (!(m.variantOptions||def.variants)?.some(v => v.id === id)) return false; p.variant = id; saveDoc(); updateTitle(m); return true; },
      setVariantOptions(options) { m.variantOptions=options; const b=$('[data-act=variant]',el);b.disabled=!options.length;$('[data-variant-caret]',b).hidden=!options.length;updateTitle(m); },
      pickTicker() { openSearch({mode: p.type === 'news' ? 'news-ticker' : 'panel', panelId:p.id}); },
      api, links, bus, fmt, esc, toCSV, ui,
      get locked() { return !!p.locked; }
    };
    try { m.inst = def.mount(body, ctx) || {}; }
    catch (e) { console.error(`[space] mount ${p.type} failed`, e); body.innerHTML = ui.error(`This panel failed to load: ${e.message}`, false); m.inst = {}; }
  }
  updatePanelSymbol(m); updateTitle(m);
  $('[data-act=csv]', el).hidden = typeof m.inst?.csv !== 'function';
  el.classList.toggle('is-linked', !!def?.symbolLinked && p.group === 'A' && !p.locked);
  wirePanel(m);
  return m;
}
function destroyPanel(m) { if(m.p.aiAttached){bus.emit('ai:attach',{id:m.p.id,attached:false});m.p.aiAttached=false;}try { m.inst?.destroy?.(); } catch (e) { console.error('[space] destroy failed', e); } m.el.remove(); }
function updatePanelSymbol(m) {
  const b = $('[data-act=psym]', m.el); if (!b) return;
  const s = links.get(gid(m.p)) || '—'; b.textContent = s; b.setAttribute('aria-label', `Symbol ${s}. Change symbol`);
}
function updateTitle(m) {
  const def = m.def, variants=m.variantOptions||def?.variants||[], v = variants.find(x => x.id === m.p.variant);
  const t = m.title || def?.title || m.p.type;
  $('.sp-title-text', m.el).textContent = t;
  $('.sp-panel-sub', m.el).textContent = m.sub;
  const vb = $('[data-act=variant]', m.el);
  if (variants.length) vb.setAttribute('aria-label', `${t}${v ? ` — ${v.label}` : ''}. Change view`);else vb.removeAttribute('aria-label');
  m.el.setAttribute('aria-label', t);
}
function panelTitle(m) { return $('.sp-title-text', m.el).textContent; }

function wirePanel(m) {
  const { p, def, el } = m;
  const q = (a) => $(`[data-act=${a}]`, el);
  el.addEventListener('pointerdown', () => setFocused(p.id), true);
  el.addEventListener('focusin', () => setFocused(p.id));
  if(q('panel-symbol-add'))q('panel-symbol-add').onclick=()=>openSearch({mode:p.type==='news'?'news-ticker':'compare',panelId:p.id});
  q('psym') && (q('psym').onclick = () => openSearch({ mode: 'panel', panelId: p.id }));
  q('link') && menuButton(q('link'), () => [
    { heading: 'Link group' },
    ...LINK_GROUPS.map(g => ({ label: `Group ${g}${g === 'A' ? ' (view symbols)' : ''}${links.get(`${cur.doc.id}:${g}`) ? ` · ${links.get(`${cur.doc.id}:${g}`)}` : ''}`, swatch: `var(--s-link-${g.toLowerCase()})`, checked: !p.locked && p.group === g, onSelect: () => setGroup(m, g) })),
    { label: 'Unlinked (own symbol)', checked: !p.locked && !p.group, onSelect: () => setGroup(m, null) }
  ], { label: 'Link group' });
  menuButton(q('variant'), () => (m.variantOptions||def?.variants||[]).map(v => ({ label: v.label, checked: p.variant === v.id, onSelect: () => {
    p.variant = v.id; saveDoc(); updateTitle(m);
    try { m.inst?.onVariant?.(v.id); } catch (e) { console.error('[space] onVariant failed', e); }
  } })), { label: `${def.title} views` });
  q('csv').onclick = () => {
    let text = null; try { text = m.inst.csv(); } catch (e) { console.error(e); }
    if (!text) { toast('No data to download yet.'); return; }
    const sym = def?.symbolLinked ? links.get(gid(p)) : '';
    download(`${[sym, panelTitle(m)].filter(Boolean).join('-').replace(/[^\w.-]+/g, '-').toLowerCase()}.csv`, text);
  };
  menuButton(q('panel-more'),()=>[
    {label:'Share panel…',icon:'share',onSelect:()=>sharePanel(m)},
    {label:'Export CSV',icon:'download',disabled:typeof m.inst?.csv!=='function',onSelect:()=>exportPanel(m,'csv')},
    {label:'Export Excel (.xlsx)',icon:'download',disabled:typeof m.inst?.csv!=='function',onSelect:()=>exportPanel(m,'xlsx')},
    ...(['chart','multi-chart','news'].includes(p.type)?[{label:p.type==='news'?'Add ticker':'Add comparison',icon:'plus',onSelect:()=>openSearch({mode:p.type==='news'?'news-ticker':'compare',panelId:p.id})}]:[]),
    ...(def?.symbolLinked ? [{label:p.locked?'Unlock panel':'Lock panel to current ticker',icon:p.locked?'unlock':'lock',onSelect:()=>toggleLock(m)}] : []),
    {label:'Ask Ultimater AI about this panel',icon:'sparkle',onSelect:()=>q('ai').click()},
    {label:p.aiAttached?'Detach from Ultimater AI':'Attach to Ultimater AI',checked:!!p.aiAttached,icon:'sparkle',onSelect:()=>toggleAttachment(m)},
    {label:'Remove panel',icon:'trash',disabled:!editable()||layoutLocked()||p.locked,onSelect:()=>removePanel(p.id)}
  ],{label:'Panel actions',align:'end'});
  q('lock') && (q('lock').onclick = () => toggleLock(m));
  q('ai').onclick = () => {
    let context = ''; try { context = m.inst?.scoutContext?.() || ''; } catch (e) { console.error(e); }
    const sym = def?.symbolLinked ? links.get(gid(p)) : null, title = panelTitle(m);
    setDock(prefs.dock === 'collapsed' ? 'open' : prefs.dock);
    bus.emit('ai:ask', { prompt: `Summarize what the ${sym ? sym + ' ' : ''}${title} panel is showing and what stands out.`, context, panelType: p.type, symbol: sym, title });
  };
  q('max').onclick = () => toggleMax(p.id);
  q('close') && (q('close').onclick = () => removePanel(p.id));
  const drag = $('.sp-drag', el);
  if (drag) {
    drag.addEventListener('pointerdown', (e) => startDrag(e, m, 'move'));
    drag.addEventListener('keydown', (e) => keyMove(e, m));
  }
  const rz = $('.sp-resize', el);
  if (rz && !p.locked) rz.addEventListener('pointerdown', (e) => startDrag(e, m, 'resize'));
  if (!layoutLocked()) $('.sp-panel-head', el).addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleMax(p.id); });
}

function exportPanel(m,format) {
  try{const csv=m.inst?.csv?.();if(!csv){toast('No data to download yet.');return;}const name=[m.def?.symbolLinked?links.get(gid(m.p)):'',panelTitle(m)].filter(Boolean).join('-').replace(/[^\w.-]+/g,'-').toLowerCase();
    download(name+'.'+format,format==='xlsx'?csvToXlsx(csv):csv,format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv');
  }catch(e){toast('Export failed: '+e.message);}
}
function toggleAttachment(m) {
  let context='';try{context=m.inst?.scoutContext?.()||'';}catch(e){toast('Panel context unavailable.');return;}
  m.p.aiAttached=!m.p.aiAttached;
  bus.emit('ai:attach',{id:m.p.id,attached:m.p.aiAttached,title:panelTitle(m),symbol:m.def?.symbolLinked?links.get(gid(m.p)):null,panelType:m.p.type,context,getContext:()=>{try{return m.inst?.scoutContext?.()||'';}catch{return '';}}});
  m.el.classList.toggle('is-ai-attached',m.p.aiAttached);toast(m.p.aiAttached?'Panel attached to Ultimater AI':'Panel detached from Ultimater AI');
}
function sharePanel(m) {
  const url=new URL(location.pathname,location.origin);url.searchParams.set('panel',JSON.stringify(sharedPanel(m.p,m.def?.symbolLinked?links.get(gid(m.p)):null)));
  let snapshot = null; try { snapshot = m.inst?.shareImage?.(); } catch { /* Link sharing remains available. */ }
  const preview = snapshot ? URL.createObjectURL(new Blob([snapshot.svg], {type:'image/svg+xml'})) : null;
  const d=openDialog({title:'Share panel',className:preview?'sp-image-share':'',onClose:()=>{if(preview)URL.revokeObjectURL(preview);},body:`<p>This link shares the panel type and linked ticker. Your portfolio, account selection, panel data and AI history are excluded.</p>${preview ? `<img class="sp-share-preview" src="${esc(preview)}" alt="Earnings image preview"><p class="s-muted">The downloadable image contains the public earnings chart shown above.</p>` : ''}<label>Panel link<input class="s-input sp-share-link" readonly value="${esc(url.href)}"></label><p role="status"></p>`,footer:`${preview ? '<button class="s-btn" data-image>Download image</button>' : ''}<button class="s-btn" data-copy>Copy link</button><button class="s-btn" data-close>Done</button>`});
  $('[data-copy]',d.el).onclick=async()=>{try{await navigator.clipboard.writeText(url.href);$('[role=status]',d.body).textContent='Link copied.';}catch{$('.sp-share-link',d.body).select();$('[role=status]',d.body).textContent='Select and copy the link above.';}};
  if(preview)$('[data-image]',d.el).onclick=async()=>{const button=$('[data-image]',d.el);button.disabled=true;try{const img=new Image();img.src=preview;await img.decode();const canvas=document.createElement('canvas');canvas.width=snapshot.width;canvas.height=snapshot.height;const context=canvas.getContext('2d');if(!context)throw new Error('Image export is unavailable.');context.drawImage(img,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Image export is unavailable.');download(snapshot.name+'.png',blob,'image/png');$('[role=status]',d.body).textContent='Image download started.';}catch(e){$('[role=status]',d.body).textContent=e.message||'Image export failed.';}finally{button.disabled=false;}};
}
function setFocused(id) {
  if (focusedPanelId === id) return;
  cur.mounted.get(focusedPanelId)?.el.classList.remove('is-focused');
  focusedPanelId = id; cur.mounted.get(id)?.el.classList.add('is-focused');
}
function setGroup(m, g) {
  const { p } = m; const before = links.get(gid(p));
  if (p.locked) { p.locked = false; p.pinned = null; }
  if (!g) { p.group = null; if (!links.get(gid(p)) && before) links.set(gid(p), before); }
  else { p.group = g; if (!links.get(gid(p))) links.set(gid(p), before || cur.doc.groups.A); }
  saveDoc(); refreshPanelChrome(m);
  const sym = links.get(gid(p)); if (sym && sym !== before) { try { m.inst?.onSymbol?.(sym); } catch (e) { console.error(e); } }
}
function toggleLock(m) {
  const { p } = m; const sym = links.get(gid(p));
  if (!p.locked) { p.locked = true; p.pinned = sym; links.set(gid(p), sym); toast(`Panel locked to ${sym}`); }
  else {
    p.locked = false; p.pinned = null;
    if (!p.group) p.group = 'A';
    const now = links.get(gid(p)); if (now && now !== sym) { try { m.inst?.onSymbol?.(now); } catch (e) { console.error(e); } }
  }
  saveDoc(); refreshPanelChrome(m); $('[data-act=lock]', m.el)?.focus();
}
// Re-render the header only (keeps the mounted panel body).
function refreshPanelChrome(m) {
  const head = $('.sp-panel-head', m.el);
  head.replaceWith(h(panelHeadHTML(m.p, m.def)));
  updatePanelSymbol(m); updateTitle(m);
  $('[data-act=csv]', m.el).hidden = typeof m.inst?.csv !== 'function';
  m.el.classList.toggle('is-linked', !!m.def?.symbolLinked && m.p.group === 'A' && !m.p.locked);
  const rz = $('.sp-resize', m.el); if (rz) rz.replaceWith(rz.cloneNode());
  wirePanel(m);
}
function toggleMax(id) {
  const m = cur.mounted.get(id); if (!m) return;
  const on = cur.maxId !== id;
  if (cur.maxId) { const prev = cur.mounted.get(cur.maxId); prev?.el.classList.remove('is-max'); const b = prev && $('[data-act=max]', prev.el); if (b) { b.innerHTML = icon('expand'); b.setAttribute('aria-label', 'Expand panel'); b.setAttribute('aria-pressed', 'false'); } }
  cur.maxId = on ? id : null;
  els.grid.classList.toggle('has-max', on);
  m.el.classList.toggle('is-max', on);
  const b = $('[data-act=max]', m.el); b.innerHTML = icon(on ? 'shrink' : 'expand'); b.setAttribute('aria-label', on ? 'Restore panel' : 'Expand panel'); b.setAttribute('aria-pressed', String(on));
  b.focus();
  if (!on) m.el.scrollIntoView({ block: 'nearest' });
}
function removePanel(id) {
  const m = cur.mounted.get(id); if (!m || m.p.locked || layoutLocked()) return;
  if (cur.maxId === id) toggleMax(id);
  const idx = cur.doc.panels.indexOf(m.p);
  const snapshot = JSON.parse(JSON.stringify(m.p));
  cur.doc.panels.splice(idx, 1); destroyPanel(m); cur.mounted.delete(id);
  resolveLayout(cur.doc.panels); placeAll(); saveDoc();
  if (!cur.doc.panels.length) renderGrid();
  toast(`Removed ${m.def?.title || m.p.type}`, { action: 'Undo', onAction: () => { cur.doc.panels.splice(idx, 0, snapshot); saveDoc(); renderGrid(); } });
}
export function addPanel(type, state = {}, opts = {}) {
  if (!cur.doc) return;
  if (!editable()) { ensureEditable(); }
  const def = getPanel(type);
  const size = def?.defaultSize || { w: 4, h: 8 };
  const w = Math.min(12, size.w || 4), hh = size.h || 8;
  const spot = findSpot(w, hh);
  const t = cur.doc.theme;
  const p = { id: uid(`${cur.doc.id}-`), type, x: spot.x, y: spot.y, w, h: hh, group: 'A', state: { ...(t && /theme|heatmap/.test(type) ? { theme: t } : {}), ...state }, variant: opts.variant };
  if (!cur.doc.panels.length) els.grid.innerHTML = '';
  cur.doc.panels.push(p); resolveLayout(cur.doc.panels); saveDoc(true);
  const m = mountPanel(p); placeAll();
  requestAnimationFrame(() => { m.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); ($('.sp-drag', m.el) || $('[data-act=max]', m.el))?.focus({ preventScroll: true }); });
  m.el.classList.add('is-new'); setTimeout(() => m.el.classList.remove('is-new'), 1200);
  return p.id;
}

/* drag / resize with pointer, plus keyboard alternative */
function gridMetrics() {
  const r = els.grid.getBoundingClientRect();
  const cs = getComputedStyle(els.grid);
  const gap = parseFloat(cs.columnGap) || 12, row = parseFloat(cs.gridAutoRows) || 40;
  return { r, colPitch: (r.width - gap * 11) / 12 + gap, rowPitch: row + gap };
}
function startDrag(e, m, mode) {
  if (layoutLocked() || m.p.locked || e.button !== 0) return;
  e.preventDefault();
  const { colPitch, rowPitch } = gridMetrics();
  const p = m.p, start = { x: p.x, y: p.y, w: p.w, h: p.h, cx: e.clientX, cy: e.clientY };
  const target = e.currentTarget; target.setPointerCapture(e.pointerId);
  m.el.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing'); root.classList.add('is-dragging-panel');
  let scrollV = 0, raf = 0;
  const autoscroll = () => { if (scrollV) { els.scroll.scrollTop += scrollV; raf = requestAnimationFrame(autoscroll); } else raf = 0; };
  const move = (ev) => {
    const dx = Math.round((ev.clientX - start.cx) / colPitch), dy = Math.round((ev.clientY - start.cy + 0) / rowPitch);
    let nx = p.x, ny = p.y, nw = p.w, nh = p.h;
    if (mode === 'move') { nx = Math.max(0, Math.min(12 - p.w, start.x + dx)); ny = Math.max(0, start.y + dy); }
    else { nw = Math.max(2, Math.min(12 - p.x, start.w + dx)); nh = Math.max(3, start.h + dy); }
    if (nx !== p.x || ny !== p.y || nw !== p.w || nh !== p.h) { Object.assign(p, { x: nx, y: ny, w: nw, h: nh }); resolveLayout(cur.doc.panels, p.id); placeAll(); }
    const sr = els.scroll.getBoundingClientRect();
    scrollV = ev.clientY > sr.bottom - 40 ? 14 : ev.clientY < sr.top + 30 ? -14 : 0;
    if (scrollV && !raf) raf = requestAnimationFrame(autoscroll);
  };
  const up = () => {
    target.removeEventListener('pointermove', move); scrollV = 0;
    m.el.classList.remove('is-dragging', 'is-resizing'); root.classList.remove('is-dragging-panel');
    resolveLayout(cur.doc.panels); placeAll(); saveDoc(true);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up, { once: true });
  target.addEventListener('pointercancel', up, { once: true });
}
function keyMove(e, m) {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (!d || layoutLocked() || m.p.locked) return;
  e.preventDefault();
  const p = m.p;
  if (e.shiftKey) { p.w = Math.max(2, Math.min(12 - p.x, p.w + d[0])); p.h = Math.max(3, p.h + d[1]); }
  else { p.x = Math.max(0, Math.min(12 - p.w, p.x + d[0])); p.y = Math.max(0, p.y + d[1]); }
  resolveLayout(cur.doc.panels, p.id); placeAll(); saveDoc();
  liveAnnounce(`${panelTitle(m)}: column ${p.x + 1}, row ${p.y + 1}, ${p.w} columns wide, ${p.h} rows tall`);
  m.el.scrollIntoView({ block: 'nearest' });
}
let liveEl;
function liveAnnounce(text) { if (!liveEl) { liveEl = h('<div class="s-sr" aria-live="polite"></div>'); document.body.append(liveEl); } liveEl.textContent = text; }

/* ------------------------------------------------------------------ add-panel catalog */
export function openCatalog() {
  const all = listPanels().slice().sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  const d = openDialog({
    title: 'Add panel', className: 'sp-catalog',
    body: `<input class="s-input sp-cat-search" type="search" placeholder="Search panels" aria-label="Search panels"><div class="sp-cat-list" role="list"></div>
      ${editable() ? '' : '<p class="s-muted sp-cat-note">Built-in views are fixed. Adding a panel makes an editable copy in My Views.</p>'}`
  });
  const list = $('.sp-cat-list', d.body), input = $('.sp-cat-search', d.body);
  const render = () => {
    const qq = input.value.trim().toLowerCase();
    const hits = all.filter(p => !qq || `${p.title} ${p.category} ${p.type} ${p.description || ''}`.toLowerCase().includes(qq));
    const cats = [...new Set(hits.map(p => p.category))];
    list.innerHTML = cats.length ? cats.map(c => `<section class="sp-cat-group"><h3>${esc(c)}</h3><div class="sp-cat-grid">${hits.filter(p => p.category === c).map(p => `
      <button type="button" class="sp-cat-item" data-type="${esc(p.type)}"><span class="sp-cat-title">${esc(p.title)}</span><span class="sp-cat-desc">${esc(p.description || (p.symbolLinked ? 'Follows the linked symbol' : p.category))}</span><span class="sp-cat-size s-muted">${p.defaultSize?.w || 4}×${p.defaultSize?.h || 6}</span></button>`).join('')}</div></section>`).join('')
      : ui.empty(all.length ? 'No panels match your search.' : 'No panels are installed yet.');
    list.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { d.close(); addPanel(b.dataset.type); });
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const first = $('[data-type]', list); if (first) { e.preventDefault(); first.click(); } } });
  render(); input.focus();
}

/* ------------------------------------------------------------------ search palette (⌘K) */
const RECENT_KEY = 'recent-search';
let paletteOpen = false;
export function openSearch({ mode = 'focus', panelId = null } = {}) {
  if (paletteOpen) return; paletteOpen = true;
  const targetPanel = panelId ? cur.mounted.get(panelId) : (mode === 'focus' && focusedPanelId ? cur.mounted.get(focusedPanelId) : null);
  const targetGroup = targetPanel?.def?.symbolLinked ? gid(targetPanel.p) : primaryGroup();
  const placeholder = mode === 'add' ? 'Add a ticker to this view…' : 'Search tickers or views; > for commands…';
  const d = openDialog({
    className: 'sp-palette', label: 'Search', onClose: () => { paletteOpen = false; ctrl?.abort(); },
    body: `<div class="sp-pal-input">${icon('search')}<input class="sp-pal-q" type="text" role="combobox" aria-expanded="true" aria-controls="sp-pal-list" aria-autocomplete="list" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" aria-label="${esc(placeholder)}"><kbd class="s-kbd">Esc</kbd></div>
      <div class="sp-pal-list" id="sp-pal-list" role="listbox" aria-label="Results"></div>
      <div class="sp-pal-foot s-muted"><span><kbd class="s-kbd">↑</kbd><kbd class="s-kbd">↓</kbd> navigate</span><span><kbd class="s-kbd">↵</kbd> select</span>${targetPanel ? `<span>Sets symbol for <b>${esc(panelTitle(targetPanel))}</b></span>` : ''}</div>`
  });
  const input = $('.sp-pal-q', d.body), list = $('.sp-pal-list', d.body);
  let items = [], active = 0, ctrl = null, timer = null, symbols = [], symState = 'idle', stage = null;
  const commands = () => mode === 'add' ? [] : [
    ...VIEWS.map(v => ({ kind: 'view', viewId:v.id, label: `Go to ${v.name}`, hint: 'View', icon: v.icon, run: () => navigate(v.id) })),
    ...themeList().map(t => ({ kind: 'view', viewId:t.id, label: `Go to ${t.name}`, hint: 'Theme', icon: t.icon, run: () => navigate(t.id) })),
    ...myViews().map(v => ({ kind: 'view', viewId:v.id, label: `Go to ${v.name}`, hint: 'My view', icon: 'layout', run: () => navigate(v.id) })),
    ...listPanels().map(p => ({ kind: 'cmd', label: `Add panel: ${p.title}`, hint: p.category, icon: 'plus', run: () => addPanel(p.type) })),
    { kind: 'cmd',label:'Browse all stock themes',hint:'Themes',icon:'search',run:openThemeBrowser },
    { kind: 'cmd', label: 'Create view', hint: 'Action', icon: 'plus', run: createFromScratch },
    { kind: 'cmd', label: 'Clone this view', hint: 'Action', icon: 'copy', run: () => cloneView(cur.id) },
    { kind: 'cmd', label: `Switch to ${document.documentElement.dataset.spaceTheme === 'dark' ? 'light' : 'dark'} theme`, hint: 'Display', icon: 'monitor', run: () => setPref('theme', document.documentElement.dataset.spaceTheme === 'dark' ? 'light' : 'dark') },
    { kind: 'cmd', label: 'Toggle Ultimater AI', hint: 'Action', icon: 'sparkle', run: () => setDock(prefs.dock === 'collapsed' ? 'open' : 'collapsed') },
    { kind: 'cmd', label: 'Keyboard shortcuts', hint: 'Help', icon: 'keyboard', run: showShortcuts },
    { kind: 'cmd', label: 'Product tour', hint: 'Help', icon: 'tour', run: () => tour.start() }
  ];
  function applySymbol(it) {
    const sym = String(it.symbol).toUpperCase();
    const recent = [{ symbol: sym, name: it.name || '' }, ...store.get(RECENT_KEY, []).filter(r => r.symbol !== sym)].slice(0, 8);
    store.set(RECENT_KEY, recent);
    if(mode==='compare'||mode==='news-ticker') {bus.emit(mode==='compare'?'chart:compare':'news:ticker',{id:targetPanel?.p.id,symbol:sym});return;}
    if (mode === 'add' || targetGroup === primaryGroup()) {
      if (!cur.doc.symbols.includes(sym)) { cur.doc.symbols = [...cur.doc.symbols, sym]; saveDoc(); }
    }
    links.set(targetGroup, sym);renderHeadChips();bus.emit('search:select', { symbol:sym,group:targetGroup });
  }
  const pick = it => {
    if(!it)return;
    if(it.kind==='view') {stage={view:it};input.value='';active=0;ctrl?.abort();clearTimeout(timer);render();return;}
    if(it.kind==='sym'&&mode==='focus') {stage={symbol:it};input.value='';active=0;ctrl?.abort();clearTimeout(timer);render();return;}
    if(it.stay){it.run();return;}
    d.close();if(it.kind==='cmd'){it.run();return;}applySymbol(it);
  };
  const render = () => {
    const q = input.value.trim();
    const commandMode=q.startsWith('>');
    const ql = (commandMode?q.slice(1):q).trim().toLowerCase();
    const sections = [];
    if(stage) {
      const actions=[{kind:'cmd',label:'← Back to search',hint:'Back',icon:'back',stay:true,run:()=>{stage=null;input.value='';search('');input.focus();}}];
      if(stage.symbol){const it=stage.symbol,sym=it.symbol;actions.push(
        {kind:'cmd',label:'Use '+sym+' in linked panels',hint:'Ticker',icon:'link',run:()=>applySymbol(it)},
        {kind:'cmd',label:'Open '+sym+' in Analysis',hint:'View',icon:'analysis',run:()=>{navigate('analysis');links.set(primaryGroup(),sym);}},
        {kind:'cmd',label:'Add a chart for '+sym,hint:'Panel',icon:'plus',run:()=>{const id=addPanel('chart');const m=cur.mounted.get(id);if(m){setGroup(m,null);links.set(gid(m.p),sym);}}},
        {kind:'cmd',label:'Add news for '+sym,hint:'Panel',icon:'news',run:()=>{const id=addPanel('news',{mode:'linked'});const m=cur.mounted.get(id);if(m){setGroup(m,null);links.set(gid(m.p),sym);}}});
      }else{const v=stage.view;actions.push({kind:'cmd',label:'Open view',hint:v.label,icon:v.icon,run:()=>navigate(v.viewId)},{kind:'cmd',label:'Duplicate view',hint:'My Views',icon:'copy',run:()=>cloneView(v.viewId)});if(myViews().some(m=>m.id===v.viewId))actions.push({kind:'cmd',label:'Rename view',hint:'My Views',icon:'edit',run:()=>renameView(v.viewId)},{kind:'cmd',label:'Choose icon',hint:'My Views',icon:'layout',run:()=>chooseViewIcon(v.viewId)},{kind:'cmd',label:'Lock / unlock layout',hint:'My Views',icon:'lock',run:()=>toggleViewLayout(v.viewId)},{kind:'cmd',label:'Delete view…',hint:'My Views',icon:'trash',run:()=>deleteView(v.viewId)});}
      sections.push([stage.symbol?'Actions for '+stage.symbol.symbol:stage.view.label,actions.filter(a=>!ql||a.label.toLowerCase().includes(ql))]);
    } else if (commandMode) { sections.push(['Commands',commands().filter(c=>!ql||c.label.toLowerCase().includes(ql)||c.hint.toLowerCase().includes(ql))]);
    } else if (!q) {
      const rec = store.get(RECENT_KEY, []);
      if (rec.length) sections.push(['Recent', rec.map(r => ({ kind: 'sym', symbol: r.symbol, name: r.name, recent: true }))]);
      const cmds = commands().filter(c => c.hint === 'View' || c.hint === 'Action').slice(0, 9);
      if (cmds.length) sections.push(['Go to', cmds]);
    } else {
      const symItems = symbols.map(s => ({ kind: 'sym', ...s }));
      const looksTicker = /^[\^A-Za-z0-9.=\-]{1,12}$/.test(q);
      if (looksTicker && !symItems.some(s => s.symbol?.toUpperCase() === q.toUpperCase())) symItems.push({ kind: 'sym', symbol: q.toUpperCase(), name: symState === 'error' ? 'Use this symbol (search unavailable)' : 'Use this symbol', direct: true });
      if (symItems.length || symState === 'loading') sections.push([symState === 'loading' ? 'Symbols · searching…' : 'Symbols', symItems]);
      const cmds = commands().filter(c => c.label.toLowerCase().includes(ql) || c.hint.toLowerCase().includes(ql)).slice(0, 8);
      if (cmds.length) sections.push(['Commands', cmds]);
    }
    items = sections.flatMap(([, arr]) => arr);
    active = Math.min(active, Math.max(0, items.length - 1));
    let i = 0;
    list.innerHTML = sections.length ? sections.map(([title, arr]) => `<div class="sp-pal-sec" role="presentation">${esc(title)}</div>${arr.map(it => {
      const idx = i++;
      return `<div class="sp-pal-item${idx === active ? ' is-active' : ''}" role="option" id="sp-pal-${idx}" data-i="${idx}" aria-selected="${idx === active}">${it.kind === 'sym'
        ? `<span class="sp-pal-sym">${esc(it.symbol)}</span><span class="sp-pal-name">${esc(it.name || '')}</span><span class="sp-pal-hint">${esc([it.exchange, it.type].filter(Boolean).join(' · ') || (it.recent ? 'Recent' : ''))}</span>`
        : `${icon(it.icon)}<span class="sp-pal-name">${esc(it.label)}</span><span class="sp-pal-hint">${esc(it.hint)}</span>`}</div>`;
    }).join('')}`).join('') : `<div class="sp-pal-empty">${q ? 'No results' : 'Type a company name or ticker'}</div>`;
    input.setAttribute('aria-activedescendant', items.length ? `sp-pal-${active}` : '');
    $('.is-active', list)?.scrollIntoView({ block: 'nearest' });
  };
  const search = (q) => {
    clearTimeout(timer); ctrl?.abort();
    if(stage||q.startsWith('>')){symbols=[];symState='idle';render();return;}
    if (!q) { symbols = []; symState = 'idle'; render(); return; }
    symState = 'loading'; render();
    timer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const res = await api('company/search', { q }, { signal: ctrl.signal });
        const arr = Array.isArray(res) ? res : res?.results || res?.items || res?.data || [];
        symbols = arr.filter(r => r?.symbol).slice(0, 8).map(r => ({ symbol: r.symbol, name: r.name || r.description || '', exchange: r.exchange || r.exchangeShortName || '', type: r.type || '' }));
        symState = 'done';
      } catch (e) { if (e.name === 'AbortError') return; symbols = []; symState = 'error'; }
      if (input.value.trim() === q) render();
    }, 180);
  };
  input.addEventListener('input', () => { active = 0; search(input.value.trim()); });
  input.addEventListener('keydown', (e) => {
    if(stage && (e.key==='ArrowLeft'||e.key==='Backspace')&&!input.value){e.preventDefault();stage=null;search('');return;}
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) pick(items[active]); }
  });
  list.addEventListener('click', (e) => { const el = e.target.closest('[data-i]'); if (el) pick(items[+el.dataset.i]); });
  list.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-i]'); if (el && +el.dataset.i !== active) { active = +el.dataset.i; list.querySelectorAll('.sp-pal-item').forEach(x => { const on = +x.dataset.i === active; x.classList.toggle('is-active', on); x.setAttribute('aria-selected', String(on)); }); input.setAttribute('aria-activedescendant', `sp-pal-${active}`); } });
  render(); input.focus();
}

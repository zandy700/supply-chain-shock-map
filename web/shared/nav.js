// One navigation model for the whole app. Both the research dashboard (/ , index.html) and the
// Analyzer (/space, space/shell.js) import this module, so the item lists cannot drift apart.

const ICONS = {
  logo: '<path d="M3 13h3.5l2.2-5 3.6 9 2.4-6.5 1.6 2.5H21"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  sparkle: '<path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z"/>',
  layout: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 10h18M10 10v11"/>',
  // research
  home: '<path d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  pie: '<path d="M12 3v9h9"/><path d="M21 12a9 9 0 11-9-9"/>',
  calendarDays: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>',
  book: '<path d="M5 5a2 2 0 012-2h12v15H7a2 2 0 00-2 2zM5 20a2 2 0 002 2h12v-4M9 7h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--s-surface)"/><circle cx="15" cy="17" r="3" fill="var(--s-surface)"/>',
  // analyzer (same paths as space/shell.js)
  pulse: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  analysis: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 12l3-3 2 2 4-4M8 20h8M12 16v4"/>',
  news: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  portfolio: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M8 6V4h8v2M16 13h5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>',
  options: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/>'
};

export const navIcon = (name, cls = '') => `<svg class="sp-ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.layout}</svg>`;

/** Research dashboard routes (hash routes on /). */
export const RESEARCH_NAV = [
  { id: 'home', name: 'Overview', icon: 'home' },
  { id: 'briefing', name: 'News tracker', icon: 'news' },
  { id: 'portfolio', name: 'Portfolio', icon: 'pie' },
  { id: 'watchlist', name: 'Watchlist', icon: 'eye' },
  { id: 'calendar', name: 'Calendar', icon: 'calendarDays' },
  { id: 'ledger', name: 'Ledger', icon: 'book' },
  { id: 'setup', name: 'Setup & download', icon: 'settings', href: '/setup' }
].map(item => ({ ...item, href: item.href || '/#/' + item.id }));

/** Analyzer built-in views, in sidebar order. Names match space/views.js. */
export const ANALYZER_NAV = [
  { id: 'markets', name: 'Markets', icon: 'pulse' },
  { id: 'analysis', name: 'Analysis', icon: 'analysis' },
  { id: 'news', name: 'News', icon: 'news' },
  { id: 'prediction-board', name: 'Prediction Markets', icon: 'target' },
  { id: 'my-portfolio', name: 'My Portfolio', icon: 'portfolio' },
  { id: 'earnings', name: 'Earnings Hub', icon: 'calendar' },
  { id: 'options', name: 'Options', icon: 'options' }
].map(item => ({ ...item, href: '/space?view=' + item.id }));

/** Theme shortcuts shown under THEMES on both pages. */
export const FEATURED_THEMES = [
  { id: 'housing-rates', name: 'Housing & Rates', icon: 'home' },
  { id: 'gambling', name: 'Gambling & Betting', icon: 'dice' },
  { id: 'prediction-board', name: 'Market events', icon: 'target' }
].map(item => ({ ...item, href: '/space?view=' + item.id }));

export const THEME_BROWSER_HREF = '/space?open=themes';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const navLinkHTML = (item, current) =>
  `<li><a class="sp-nav-item" href="${esc(item.href)}" title="${esc(item.name)}"${current ? ' aria-current="page"' : ''}>${navIcon(item.icon)}<span class="sp-nav-label">${esc(item.name)}</span></a></li>`;

export const sectionHeadHTML = (id, label, expanded, extra = '') =>
  `<div class="sp-sec-head"><button type="button" class="sp-sec-toggle" data-sec="${id}" aria-expanded="${expanded}">${navIcon('chevron', 'sp-caret')}<span>${label}</span></button>${extra}</div>`;

export const collapseButtonHTML = collapsed =>
  `<button type="button" class="s-icon-btn s-icon-btn-sm sp-collapse" data-act="collapse-side" aria-label="${collapsed ? 'Expand sidebar' : 'Collapse sidebar'}" aria-pressed="${!!collapsed}">${navIcon('sidebar')}</button>`;

/** Research list items. `ids` limits which routes are available; `current` is the active route id.
 *  `base` prefixes the hash route: '/' from the Analyzer, '' on the dashboard (keeps ?seed=demo). */
export const researchItemsHTML = (ids = RESEARCH_NAV.map(i => i.id), current = '', base = '/') =>
  RESEARCH_NAV.filter(item => ids.includes(item.id)).map(item => navLinkHTML({ ...item, href: item.id === 'setup' ? '/setup' : base + '#/' + item.id }, item.id === current)).join('');

/** Full RESEARCH section (used by the Analyzer sidebar; the dashboard fills its list from app.js). */
export const researchSectionHTML = ({ expanded = true, collapsed = false, current = '' } = {}) =>
  `<section class="sp-sec" data-section="research">${sectionHeadHTML('research', 'RESEARCH', expanded, collapseButtonHTML(collapsed))}<ul class="sp-nav" ${expanded ? '' : 'hidden'}>${researchItemsHTML(undefined, current)}</ul></section>`;

/* ------------------------------------------------------------------ dashboard shell wiring */
const PREFS_KEY = 'space:prefs';
function readPrefs() { try { const p = JSON.parse(localStorage.getItem(PREFS_KEY)); return p && typeof p === 'object' ? p : {}; } catch { return {}; } }
function writePrefs(patch) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch })); return true; } catch { return false; }
}
function myViews() {
  try { const list = JSON.parse(localStorage.getItem('space:myviews')); return Array.isArray(list) ? list.filter(v => v && typeof v.id === 'string' && typeof v.name === 'string') : []; } catch { return []; }
}

/** Mount the Analyzer-style chrome on the research dashboard: sidebar sections, drawer, collapse, display menu. */
export function mountDashboardShell(doc = document) {
  const app = doc.querySelector('.dash-app');
  const side = doc.getElementById('dash-side');
  if (!app || !side || app.dataset.shellReady) return;
  app.dataset.shellReady = 'true';
  const backdrop = doc.querySelector('.dash-app .sp-backdrop');
  const hamburger = doc.querySelector('[data-act=drawer]');
  const sections = () => ({ research: true, views: true, themes: true, mine: true, ...(readPrefs().sections || {}) });

  function renderAnalyzerSections() {
    const s = sections(), mine = myViews();
    const slot = side.querySelector('[data-analyzer-nav]');
    slot.innerHTML = `
      <section class="sp-sec" data-section="views">${sectionHeadHTML('views', 'VIEWS', s.views !== false)}
        <ul class="sp-nav" ${s.views !== false ? '' : 'hidden'}>${ANALYZER_NAV.map(i => navLinkHTML(i)).join('')}</ul></section>
      <section class="sp-sec" data-section="themes">${sectionHeadHTML('themes', 'THEMES', s.themes !== false)}
        <ul class="sp-nav" ${s.themes !== false ? '' : 'hidden'}>${navLinkHTML({ name: 'Browse all themes', icon: 'search', href: THEME_BROWSER_HREF })}${FEATURED_THEMES.map(i => navLinkHTML(i)).join('')}</ul></section>
      <section class="sp-sec" data-section="mine">${sectionHeadHTML('mine', 'MY VIEWS', s.mine !== false)}
        <ul class="sp-nav" ${s.mine !== false ? '' : 'hidden'}>${mine.length ? mine.map(v => navLinkHTML({ name: v.name, icon: typeof v.icon === 'string' && ICONS[v.icon] ? v.icon : 'layout', href: '/space?view=' + encodeURIComponent(v.id) })).join('') : '<li class="sp-nav-empty">Clone a view or create one in the Analyzer to customize your workspace.</li>'}</ul></section>`;
    const savedOrder = readPrefs().sectionOrder;
    const order = [...new Set([...(Array.isArray(savedOrder) ? savedOrder : []), 'views', 'themes', 'mine'])];
    order.filter(id => ['views', 'themes', 'mine'].includes(id)).forEach(id => slot.append(slot.querySelector(`[data-section="${id}"]`)));
  }
  function applyCollapsed() {
    const collapsed = !!readPrefs().sidebarCollapsed;
    app.classList.toggle('side-collapsed', collapsed);
    const btn = side.querySelector('[data-act=collapse-side]');
    if (btn) { btn.setAttribute('aria-pressed', String(collapsed)); btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar'); }
  }
  function applySections() {
    const s = sections();
    side.querySelectorAll('.sp-sec').forEach(sec => {
      const open = s[sec.dataset.section] !== false;
      sec.querySelector('.sp-sec-toggle')?.setAttribute('aria-expanded', String(open));
      const list = sec.querySelector('.sp-nav'); if (list) list.hidden = !open;
    });
  }
  function setDrawer(open, { focus = true } = {}) {
    app.classList.toggle('drawer-open', open);
    if (backdrop) backdrop.hidden = !open;
    hamburger?.setAttribute('aria-expanded', String(open));
    hamburger?.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    if (open && focus) side.querySelector('.sp-nav-item')?.focus();
    else if (!open && focus && side.contains(doc.activeElement)) hamburger?.focus();
  }

  renderAnalyzerSections(); applySections(); applyCollapsed();
  side.addEventListener('click', e => {
    const toggle = e.target.closest('.sp-sec-toggle');
    if (toggle) {
      const id = toggle.dataset.sec, s = sections();
      writePrefs({ sections: { ...s, [id]: s[id] === false } });
      applySections(); return;
    }
    if (e.target.closest('[data-act=collapse-side]')) { writePrefs({ sidebarCollapsed: !readPrefs().sidebarCollapsed }); applyCollapsed(); return; }
    if (e.target.closest('a.sp-nav-item')) setDrawer(false, { focus: false });
  });
  hamburger?.addEventListener('click', () => setDrawer(!app.classList.contains('drawer-open')));
  backdrop?.addEventListener('click', () => setDrawer(false));
  doc.addEventListener('keydown', e => {
    if (!app.classList.contains('drawer-open')) return;
    if (e.key === 'Escape') { e.preventDefault(); setDrawer(false); }
    if (e.key === 'Tab') {
      const items = [...side.querySelectorAll('a[href],button:not(:disabled)')].filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && (doc.activeElement === first || !side.contains(doc.activeElement))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (doc.activeElement === last || !side.contains(doc.activeElement))) { e.preventDefault(); first?.focus(); }
    }
  });
  const wide = matchMedia('(min-width: 1024px)');
  const onWide = () => { if (wide.matches) setDrawer(false, { focus: false }); };
  wide.addEventListener?.('change', onWide);
  addEventListener('storage', e => { if (e.key === PREFS_KEY || e.key === 'space:myviews' || e.key === null) { renderAnalyzerSections(); applySections(); applyCollapsed(); } });

  // "Ask AI" opens the Analyzer with its assistant dock expanded.
  doc.querySelector('[data-act=ask-ai]')?.addEventListener('click', () => { writePrefs({ dock: 'open' }); });
  mountDisplayMenu(doc);
}

/* Display choices share the Analyzer's persisted theme and density preferences. */
const THEME_CHOICES = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light'], ['blue-steel', 'Blue Steel']];
function mountDisplayMenu(doc) {
  const btn = doc.querySelector('[data-act=display]');
  if (!btn) return;
  let menu = null;
  const close = (refocus = true) => {
    if (!menu) return;
    menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('pointerdown', outside, true);
    if (refocus) btn.focus();
  };
  const outside = e => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(false); };
  const open = () => {
    const current = readPrefs().theme || 'dark';
    menu = doc.createElement('div');
    menu.className = 's-menu'; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Display settings');
    menu.innerHTML = `<div class="s-menu-label" role="presentation">Theme</div>` + THEME_CHOICES.map(([id, label]) =>
      `<button type="button" role="menuitemradio" aria-checked="${id === current}" data-theme="${id}" tabindex="-1">${label}</button>`).join('') +
      `<div role="separator"></div><div class="s-menu-label" role="presentation">Density</div>` + ['comfortable', 'compact'].map(id =>
        `<button type="button" role="menuitemradio" aria-checked="${id === (readPrefs().density || 'comfortable')}" data-density="${id}" tabindex="-1">${id === 'compact' ? 'Compact' : 'Comfortable'}</button>`).join('');
    doc.body.append(menu);
    const r = btn.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + 'px';
    menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
    btn.setAttribute('aria-expanded', 'true');
    const items = [...menu.querySelectorAll('[role=menuitemradio]')];
    (items.find(i => i.getAttribute('aria-checked') === 'true') || items[0]).focus();
    menu.addEventListener('click', e => {
      const item = e.target.closest('[data-theme],[data-density]'); if (!item) return;
      if (item.dataset.theme) writePrefs({ theme: item.dataset.theme });
      else writePrefs({ density: item.dataset.density });
      window.ultimaterApplyTheme?.();
      close();
    });
    menu.addEventListener('keydown', e => {
      const i = items.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items.at(-1).focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'Tab') close(false);
    });
    doc.addEventListener('pointerdown', outside, true);
  };
  btn.addEventListener('click', () => (menu ? close() : open()));
}

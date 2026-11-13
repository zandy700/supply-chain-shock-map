import { THEME_CATALOG } from '../themes.js';
// News panels: `news` (market / ticker / watchlist / theme feed with reader pane) and `predictions`
// (the app's classified-headline scenarios from /api/briefing). Owned by the news-earnings builder.
import { registerPanel, store, esc, fmt, toCSV, bus, state as ui } from '../core.js';
import { createLiveRefresh, refreshLabel } from '../live-refresh.js';
import { NEWS_TOPIC_GROUPS, newsTopic, matchesNewsTopic } from './news-topics.js';
import { createWatchlistStore } from '../../shared/watchlist-store.js';
import { mapSymbolBatches, mergeBriefings } from '../../shared/watchlist-data.js';
import { loadNewsBatches } from '../../shared/feed-batches.js';

const REFRESH_MS = 120000;
const SYMBOL = /^[A-Z0-9]{1,6}(?:[.-][A-Z0-9]{1,4})?$/;
const THEMES = THEME_CATALOG.map(t=>[t.id,t.name]);

const CATEGORIES = [['general', 'Top news'], ['stocks', 'Stocks'], ['earnings', 'Earnings'], ['economy', 'Economy'], ['technology', 'Technology'],
  ['forex', 'Forex'], ['crypto', 'Crypto'], ['commodities', 'Commodities'], ['ipos', 'IPOs'], ['merger', 'Mergers (Finnhub)']];
const MODES = [{ id: 'linked', label: 'Ticker News' }, { id: 'market', label: 'Top News' }, { id: 'watchlist', label: 'Watchlist News' }, { id: 'theme', label: 'Theme News' }];

// Watchlist: the one list shared by the dashboard and the Analyzer (web/shared/watchlist-store.js),
// limited to symbols the news feeds accept.
const watchlist = createWatchlistStore();
export function readWatchlist() { return watchlist.read().filter(s => SYMBOL.test(s)); }
export const onWatchlistChange = fn => watchlist.subscribe(fn);

export function ago(iso, now = Date.now()) {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return fmt.date(iso);
}
const errText = e => ({
  provider_not_configured: 'This source needs the Finnhub key, which is not configured on this server.',
  rate_limited: 'The news provider is rate limiting requests. Try again shortly.',
  provider_unavailable: 'The news provider is unavailable right now.',
  invalid_symbol: 'That symbol is not supported for news.'
}[e?.message] || e?.message || 'Request failed.');
const scenarioBadge = p => p ? `<span class="s-badge ${p.direction === 'positive' ? 's-badge-up' : 's-badge-down'} p-news-scn" title="${esc(p.reason)}">${p.direction === 'positive' ? '▲' : '▼'} ${esc(p.direction)} scenario · ${esc(p.category)}</span>` : '';
const chips = (symbols, max = 1) => {
  if (!symbols?.length) return '';
  const shown = symbols.slice(0, max).map(s => `<button type="button" class="s-chip p-news-tk" data-sym="${esc(s)}" title="Open ${esc(s)}">${esc(s)}</button>`).join('');
  const more = symbols.length - max;
  return shown + (more > 0 ? `<button type="button" class="s-chip p-news-more" data-more title="${esc(symbols.slice(max).join(', '))}">+${more}</button>` : '');
};

export async function copyArticleLink(url, clipboard = globalThis.navigator?.clipboard) {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || !clipboard?.writeText) throw new Error('copy_unavailable');
  await clipboard.writeText(target.href);
}
// ---------------------------------------------------------------------------
registerPanel('news', {
  title: 'News', category: 'News', defaultSize: { w: 4, h: 14 }, symbolLinked: true, variants: MODES,
  mount(el, ctx) {
    let st = { mode: 'linked', category: 'general', theme: 'mag-7', extra: [], source: '', q: '', unread: false, topic: '', ...ctx.state };
    if (st.topic && !newsTopic(st.topic)) st.topic = '';
    // Built-in view presets use ticker/top aliases; preserve their scope when the shell defaults the variant.
    st.mode = ({ ticker: 'linked', top: 'market' })[st.mode] || st.mode;
    if (!ctx.state?.mode && ctx.variant && MODES.some(m => m.id === ctx.variant)) st.mode = ctx.variant;
    let data = null, error = null, loading = false, openId = null, openArticle = null, dead = false, serial = 0, lastIds = new Set(), fresh = new Set();
    let shareOpen = false, copyStatus = '';
    const shareId = `news-share-${ctx.id || 'article'}`;
    const read = new Set(store.get('news:read', []));
    const save = patch => { st = { ...st, ...patch }; ctx.setState(st); };
    const markRead = id => { read.add(id); store.set('news:read', [...read].slice(-600)); };

    el.innerHTML = `<div class="p-news">
      <div class="p-news-bar">
        <select class="s-select p-news-mode" aria-label="Choose news source">${MODES.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join('')}</select>
        <select class="s-select p-news-cat" aria-label="News category">${CATEGORIES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        <select class="s-select p-news-theme" aria-label="Theme">${THEMES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
        <select class="s-select p-news-src" aria-label="Filter by source"><option value="">All sources</option></select>
        <input class="s-input p-news-q" type="search" placeholder="Search headlines" aria-label="Search headlines">
        <button type="button" class="s-chip p-news-unread" aria-pressed="false" title="Show unread only">Unread</button>
        <button type="button" class="s-icon-btn p-news-add" title="Add ticker to this feed" aria-label="Add ticker to this feed">+</button>
        <button type="button" class="s-icon-btn p-news-refresh" title="Refresh" aria-label="Refresh news">↻</button>
      </div>
      <div class="p-news-topicbar"><label>Topic filter<select class="s-select p-news-topic" aria-label="Filter loaded headlines by topic"><option value="">All loaded headlines</option>${NEWS_TOPIC_GROUPS.map(group => `<optgroup label="${esc(group.label)}">${group.topics.map(t => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</optgroup>`).join('')}</select></label><span data-news-topic-status>Filters loaded headlines from your selected sources.</span></div>
      <form class="p-news-addform" hidden><input class="s-input" name="t" placeholder="Ticker, e.g. AMD" aria-label="Ticker to add" maxlength="12" autocomplete="off"><button class="s-btn s-btn-sm">Add</button><button type="button" class="s-btn s-btn-ghost s-btn-sm" data-cancel>Cancel</button></form>
      <div class="p-news-extra"></div>
      <div class="p-news-meta s-muted"><span data-news-live></span><span data-news-meta></span></div>
      <div class="p-news-main"><div class="p-news-list s-scroll" role="feed" aria-busy="false"></div><div class="p-news-reader s-scroll" tabindex="-1"></div></div>
    </div>`;
    const $ = s => el.querySelector(s);
    const root = $('.p-news'), list = $('.p-news-list'), reader = $('.p-news-reader');
    const metaText = $('[data-news-meta]'), live = $('[data-news-live]');
    const selectedArticle = () => openArticle?.id === openId ? openArticle : data?.items.find(x => x.id === openId);
    function refreshState(state) {
      if (dead) return;
      live.textContent = refreshLabel(state) + ' · ';
      live.classList.toggle('s-down', ['error', 'stale', 'offline'].includes(state.status));
      live.title = state.error ? `Showing previous headlines. ${errText({ message: state.error })}` : 'Checks every 2 minutes while visible; article publication times are separate.';
    }

    function symbolsFor() {
      if (st.mode === 'linked') return [ctx.symbol, ...st.extra].filter(Boolean);
      if (st.mode === 'watchlist') return [...new Set([...readWatchlist(), ...st.extra])];
      if (st.mode === 'theme') return THEME_CATALOG.find(t=>t.id===st.theme)?.constituents.map(c=>c.symbol)||[];
      return [];
    }
    function label() {
      if (st.mode === 'market') return (CATEGORIES.find(c => c[0] === st.category)?.[1] || 'Top news').replace(' (Finnhub)', '');
      if (st.mode === 'linked') return `${ctx.symbol || 'Ticker'} News`;
      if (st.mode === 'watchlist') return 'Watchlist News';
      return (THEMES.find(t => t[0] === st.theme)?.[1] || 'Theme') + ' News';
    }

    async function fetchNews(signal) {
      const ticket = serial, silent = !!data;
      loading = !silent; error = null;
      if (!silent) render();
      try {
        let params;
        if (st.mode === 'market') params = { scope: 'market', category: st.category };
        else if(st.mode==='theme') params={scope:'theme',theme:st.theme};
        else {
          const syms = symbolsFor();
          if (!syms.length) {
            data = null; loading = false;
            error = { empty: st.mode === 'watchlist' ? 'Your watchlist is empty. Add tickers in Ultimater or use + to add one here.' : st.mode === 'theme' ? 'No constituents available for this theme.' : 'Link a symbol to see its news.' };
            return render();
          }
          params = { scope: st.mode === 'linked' ? 'symbol' : st.mode === 'theme' ? 'theme' : 'watchlist', symbols: syms.join(',') };
        }
        const body = params.symbols ? await loadNewsBatches(ctx.api, params.symbols.split(','), { signal, scope: params.scope }) : await ctx.api('news/feed', params, { signal });
        if (dead || signal.aborted || ticket !== serial) return;
        if (body.partial) body.note = (body.note || '') + ' Some symbols could not be checked; available headlines are shown.';
        const ids = new Set(body.items.map(i => i.id));
        fresh = silent ? new Set([...ids].filter(id => !lastIds.has(id))) : new Set();
        lastIds = ids; data = body;
      } catch (e) {
        if (dead || signal.aborted || ticket !== serial || e.name === 'AbortError') return;
        error = e; loading = false;
        if (!data) render();
        throw e;
      }
      loading = false;
      render({ background: silent });
    }
    const poll = createLiveRefresh({ el, refresh: fetchNews, interval: REFRESH_MS, onState: refreshState });
    function load({ reset = false } = {}) {
      serial++;
      if (reset) { data = null; error = null; openId = null; openArticle = null; root.classList.remove('is-reading'); lastIds = new Set(); fresh = new Set(); loading = true; render(); }
      return poll.restart().catch(() => {});
    }

    function filtered() {
      if (!data) return [];
      const q = st.q.trim().toLowerCase();
      return data.items.filter(i => matchesNewsTopic(i, st.topic) && (!st.source || i.source === st.source) && (!st.unread || !read.has(i.id)) &&
        (!q || i.title.toLowerCase().includes(q) || i.summary.toLowerCase().includes(q) || i.symbols.some(s => s.toLowerCase() === q)));
    }

    function renderBar({ background = false } = {}) {
      $('.p-news-mode').value = st.mode;
      $('.p-news-topic').value = st.topic;
      $('.p-news-cat').value = st.category; $('.p-news-cat').hidden = st.mode !== 'market';
      $('.p-news-theme').value = st.theme; $('.p-news-theme').hidden = st.mode !== 'theme';
      $('.p-news-add').hidden = !['linked', 'watchlist'].includes(st.mode);
      $('.p-news-unread').setAttribute('aria-pressed', String(!!st.unread));
      if (!background && document.activeElement !== $('.p-news-q')) $('.p-news-q').value = st.q;
      const sources = [...new Set([...(data?.items || []).map(i => i.source), st.source].filter(Boolean))].sort();
      if (!background) $('.p-news-src').innerHTML = `<option value="">All sources</option>` + sources.map(s => `<option${s === st.source ? ' selected' : ''}>${esc(s)}</option>`).join('');
      $('.p-news-extra').innerHTML = ['linked', 'watchlist'].includes(st.mode) && st.extra.length
        ? st.extra.map(s => `<span class="s-chip">${esc(s)}<button type="button" class="s-chip-x" data-rm="${esc(s)}" aria-label="Remove ${esc(s)} from this feed">×</button></span>`).join('') : '';
      ctx.setTitle(label());
    }

    function render({ background = false } = {}) {
      renderBar({ background });
      const top = list.scrollTop, readerTop = reader.scrollTop;
      const focusId = list.contains(document.activeElement) ? document.activeElement?.dataset.open : null;
      list.setAttribute('aria-busy', String(loading));
      if (loading && !data) { list.innerHTML = ui.loading('Loading news…'); metaText.textContent = ''; reader.innerHTML = ''; return; }
      if (error?.empty) { list.innerHTML = ui.empty(error.empty); metaText.textContent = ''; reader.innerHTML = ''; return; }
      if (error && !data) { list.innerHTML = ui.error(errText(error)); metaText.textContent = ''; reader.innerHTML = ''; return; }
      if (!data) return;
      const items = filtered();
      $('[data-news-topic-status]').textContent = st.topic ? `${items.length} of ${data.items.length} loaded headlines match. This is a text/tag filter, not access to a named editorial feed.` : 'Filters loaded headlines from your selected sources.';
      const unread = data.items.filter(i => !read.has(i.id)).length;
      metaText.innerHTML = `${esc(data.providers.join(' + ') || 'No provider')}${data.theme_name?' · '+esc(data.theme_name)+' · '+data.symbols.length+' constituents requested':''} · ${data.items.length} headlines · ${unread} unread · source response ${esc(fmt.time(data.as_of))}` +
        (data.errors?.length ? ` · <span class="s-down" title="${esc(data.errors.map(e => (e.symbol || e.category) + ' ' + e.provider + ': ' + e.code).join('; '))}">partial</span>` : '');
      if (!items.length) list.innerHTML = ui.empty(st.topic ? `No loaded headlines match ${newsTopic(st.topic).label}. Connected sources may not cover this topic. Try another topic or All loaded headlines.` : data.items.length ? 'No headlines match these filters.' : 'No recent headlines from this source.');
      else list.innerHTML = items.map(i => `<article class="p-news-item${read.has(i.id) ? ' is-read' : ''}${i.id === openId ? ' is-open' : ''}" data-id="${esc(i.id)}">
        <div class="p-news-txt">
          <h3><button type="button" class="p-news-open" data-open="${esc(i.id)}">${read.has(i.id) ? '' : '<span class="p-news-dot" aria-label="Unread"></span>'}${fresh.has(i.id) ? '<span class="s-badge s-badge-accent">New</span> ' : ''}${esc(i.title)}</button></h3>
          ${i.summary ? `<p class="p-news-sum">${esc(i.summary)}</p>` : ''}
          <div class="p-news-foot"><strong>${esc(i.source)}</strong><time datetime="${esc(i.date)}" title="${esc(new Date(i.date).toLocaleString())}">${esc(ago(i.date))}</time>${chips(i.symbols)}${scenarioBadge(i.prediction)}</div>
        </div>
        ${i.image ? `<img class="p-news-img" src="${esc(i.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      </article>`).join('');
      list.querySelectorAll('img').forEach(img => img.addEventListener('error', () => img.remove(), { once: true }));
      if (!background || !openId) renderReader();
      list.scrollTop = top; reader.scrollTop = readerTop;
      if (focusId) [...list.querySelectorAll('[data-open]')].find(b => b.dataset.open === focusId)?.focus({ preventScroll: true });
    }

    function renderReader() {
      const i = selectedArticle();
      root.classList.toggle('is-reading', !!i);
      if (!i) { reader.innerHTML = `<div class="s-state p-news-hint">Select a headline to read its summary here.</div>`; return; }
      reader.innerHTML = `<div class="p-news-art">
        <button type="button" class="s-btn s-btn-ghost s-btn-sm p-news-back" data-back>← Back to list</button>
        <div class="p-news-eyebrow">${esc(i.source)} · <time datetime="${esc(i.date)}">${esc(new Date(i.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</time> · ${esc(ago(i.date))}</div>
        <h2>${esc(i.title)}</h2>
        ${i.image ? `<img class="p-news-hero" src="${esc(i.image)}" alt="" referrerpolicy="no-referrer">` : ''}
        <p class="p-news-body">${i.summary ? esc(i.summary) : '<span class="s-muted">No summary was supplied by the source.</span>'}</p>
        ${i.symbols.length ? `<div class="p-news-rel"><span class="s-muted">Related</span> ${i.symbols.slice(0, 12).map(s => `<button type="button" class="s-chip p-news-tk" data-sym="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
        ${i.prediction ? `<div class="p-news-pred p-news-pred-${esc(i.prediction.direction)}"><div>${scenarioBadge(i.prediction)} <span class="s-badge">${esc(i.prediction.confidence)} confidence</span></div><p>${esc(i.prediction.reason)}</p><p class="s-muted">Rule: ${esc(i.prediction.method)}. Not financial advice.</p></div>`
          : `<div class="p-news-pred"><p class="s-muted">No keyword scenario matched this headline.</p></div>`}
        <div class="p-news-actions">
          <a class="s-btn s-btn-primary" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">Open original ↗</a>
          <div class="p-news-share"><button type="button" class="s-btn" data-share aria-expanded="${shareOpen}" aria-controls="${esc(shareId)}">Share article</button>${shareOpen ? `<div class="p-news-share-menu" id="${esc(shareId)}" role="dialog" aria-label="Share article"><button type="button" class="s-btn" data-copy-link>Copy link</button><button type="button" class="s-btn s-btn-ghost" data-share-close aria-label="Close article sharing">Close</button><span role="status" data-copy-status>${esc(copyStatus)}</span></div>` : ''}</div>
          <button type="button" class="s-btn" data-ask>✦ Ask Ultimater AI</button>
        </div>
        <p class="s-muted p-news-src-note">Summary from ${esc(i.provider)}. The full article is on the publisher's site.</p>
      </div>`;
      reader.querySelector('img')?.addEventListener('error', e => e.target.remove(), { once: true });
    }

    function open(id) {
      shareOpen = false; copyStatus = '';
      openId = id; openArticle = data?.items.find(x => x.id === id) || null; markRead(id);
      list.querySelectorAll('.p-news-item').forEach(n => { n.classList.toggle('is-open', n.dataset.id === id); if (n.dataset.id === id) { n.classList.add('is-read'); n.querySelector('.p-news-dot')?.remove(); } });
      renderReader(); reader.scrollTop = 0; reader.focus({ preventScroll: true });
    }

    el.addEventListener('click', e => {
      const t = e.target.closest('button,a,[data-id]');
      if (!t || !el.contains(t)) return;
      if (t.dataset.sym) { e.stopPropagation(); ctx.openSymbol(t.dataset.sym); return; }
      if (t.hasAttribute('data-more')) { const it = data?.items.find(x => x.id === t.closest('[data-id]')?.dataset.id); if (it) open(it.id); return; }
      if (t.dataset.open) return open(t.dataset.open);
      if (t.hasAttribute('data-back')) { shareOpen = false; openId = null; renderReader(); list.querySelector('.is-open')?.classList.remove('is-open'); return; }
      if (t.hasAttribute('data-share') || t.hasAttribute('data-share-close')) { shareOpen = t.hasAttribute('data-share') && !shareOpen; copyStatus = ''; renderReader(); reader.querySelector(shareOpen ? '[data-copy-link]' : '[data-share]')?.focus(); return; }
      if (t.hasAttribute('data-copy-link')) {
        const article = selectedArticle(); if (!article) return;
        const publish = message => { if (!dead && shareOpen && selectedArticle()?.id === article.id) { copyStatus = message; const status = reader.querySelector('[data-copy-status]'); if (status) status.textContent = message; } };
        copyArticleLink(article.url).then(() => publish('Link copied.'), () => publish('Copy is unavailable. Open the original article to copy its link.'));
        return;
      }
      if (t.hasAttribute('data-retry')) return load();
      if (t.dataset.rm) { save({ extra: st.extra.filter(s => s !== t.dataset.rm) }); return load({ reset: true }); }
      if (t.hasAttribute('data-ask')) { const it = selectedArticle(); if (it) bus.emit('ai:ask', { prompt: `What does this headline mean for ${it.symbols.slice(0, 3).join(', ') || 'the market'}? "${it.title}"`, context: `${it.title}\n${it.source}, ${it.date}\n${it.summary}\n${it.url}`, panelType: 'news' }); return; }
      if (t.classList.contains('p-news-refresh')) return load();
      if (t.classList.contains('p-news-unread')) { save({ unread: !st.unread }); return render(); }
      if (t.classList.contains('p-news-add')) { if (ctx.pickTicker) { ctx.pickTicker(); return; } const f = $('.p-news-addform'); f.hidden = !f.hidden; if (!f.hidden) f.t.focus(); return; }
      if (t.hasAttribute('data-cancel')) { $('.p-news-addform').hidden = true; return; }
      if (t.dataset.id && t.tagName === 'ARTICLE') open(t.dataset.id);
    });
    $('.p-news-addform').addEventListener('submit', e => {
      e.preventDefault();
      const v = e.target.t.value.trim().toUpperCase();
      if (!SYMBOL.test(v)) { e.target.t.setCustomValidity('Enter a ticker like AMD'); e.target.t.reportValidity(); return; }
      e.target.t.setCustomValidity('');
      if (!st.extra.includes(v) && v !== ctx.symbol) save({ extra: [...st.extra, v].slice(0, 8) });
      e.target.t.value = ''; e.target.hidden = true; load({ reset: true });
    });
    $('.p-news-addform').t.addEventListener('input', e => e.target.setCustomValidity(''));
    $('.p-news-mode').addEventListener('change', e => { save({ mode: e.target.value, source: '' }); load({ reset: true }); });
    $('.p-news-cat').addEventListener('change', e => { save({ category: e.target.value, source: '' }); load({ reset: true }); });
    $('.p-news-theme').addEventListener('change', e => { save({ theme: e.target.value, source: '' }); load({ reset: true }); });
    $('.p-news-src').addEventListener('change', e => { save({ source: e.target.value }); render(); });
    $('.p-news-topic').addEventListener('change', e => { save({ topic: newsTopic(e.target.value) ? e.target.value : '' }); openId = null; openArticle = null; shareOpen = false; root.classList.remove('is-reading'); render(); });
    let qt; $('.p-news-q').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { save({ q: e.target.value }); render(); }, 150); });
    el.addEventListener('keydown', e => { if (e.key === 'Escape' && shareOpen) { shareOpen = false; renderReader(); reader.querySelector('[data-share]')?.focus(); e.stopPropagation(); } else if (e.key === 'Escape' && openId) { openId = null; renderReader(); } });

    const offTicker=bus.on('news:ticker',({id,symbol}={})=>{if(id!==ctx.id||!SYMBOL.test(symbol))return;save({extra:[...new Set([...st.extra,symbol])]});load({ reset: true });});
    const offWatchlist=onWatchlistChange(()=>{if(!dead&&st.mode==='watchlist')load({ reset: true });});
    load({ reset: true });

    return {
      onSymbol() { if (st.mode === 'linked') load({ reset: true }); },
      onVariant(id) { if (MODES.some(m => m.id === id)) { save({ mode: id, source: '' }); load({ reset: true }); } },
      csv() {
        const rows = filtered().map(i => ({ date: i.date, source: i.source, title: i.title, symbols: i.symbols.join(' '), scenario: i.prediction ? i.prediction.direction : '', event_type: i.prediction?.event_type || '', provider: i.provider, url: i.url }));
        return rows.length ? toCSV(rows) : null;
      },
      scoutContext() {
        const items = filtered().slice(0, 15);
        if (!items.length) return `${label()}: no headlines loaded.`;
        return `${label()} (${data.providers.join(' + ')}; keyword scenarios are unreviewed, not forecasts):\n` +
          items.map(i => `- ${ago(i.date)} · ${i.source}: ${i.title}${i.symbols.length ? ` [${i.symbols.slice(0, 4).join(', ')}]` : ''}${i.prediction ? ` (${i.prediction.direction} scenario: ${i.prediction.category})` : ''}`).join('\n');
      },
      destroy() { dead = true; serial++; offTicker(); offWatchlist(); clearTimeout(qt); poll.destroy(); }
    };
  }
});

// ---------------------------------------------------------------------------
registerPanel('predictions', {
  title: 'Predictions', category: 'News', defaultSize: { w: 4, h: 12 }, symbolLinked: true,
  mount(el, ctx) {
    let st = { scope: 'linked', dir: 'all', ...ctx.state };
    let data = null, error = null, dead = false, serial = 0;
    const save = p => { st = { ...st, ...p }; ctx.setState(st); };
    el.innerHTML = `<div class="p-pred">
      <div class="p-news-bar">
        <div class="s-seg" role="group" aria-label="Scope"><button type="button" data-scope="linked">Linked symbol</button><button type="button" data-scope="watchlist">Watchlist</button></div>
        <div class="s-seg" role="group" aria-label="Direction"><button type="button" data-dir="all">All</button><button type="button" data-dir="positive">Positive</button><button type="button" data-dir="negative">Negative</button></div>
        <a class="s-btn s-btn-ghost s-btn-sm p-pred-ledger" href="/#/ledger" target="_blank" rel="noopener">Prediction ledger ↗</a>
        <button type="button" class="s-icon-btn" data-pred-refresh aria-label="Refresh predictions" title="Refresh predictions">↻</button>
      </div>
      <div class="p-news-meta s-muted"><span data-pred-live></span><span data-pred-meta></span></div>
      <div class="p-pred-body s-scroll"></div>
      <p class="p-pred-disc">Keyword scenarios from the briefing pipeline: unreviewed, not forecasts. Not financial advice.</p>
    </div>`;
    const body = el.querySelector('.p-pred-body'), meta = el.querySelector('[data-pred-meta]'), live = el.querySelector('[data-pred-live]');
    const tickers = () => st.scope === 'linked' ? [ctx.symbol].filter(Boolean) : readWatchlist();

    async function fetchPredictions(signal) {
      const ticket = serial;
      const list = tickers();
      error = null;
      if (!list.length) { render(st.scope === 'watchlist' ? 'Your watchlist is empty. Add companies in Ultimater.' : 'Link a symbol to see its predictions.'); return; }
      if (!data) body.innerHTML = ui.loading('Classifying recent headlines…');
      try {
        const result = await mapSymbolBatches(list, async batch => {
          const response = await fetch('/api/briefing?tickers=' + encodeURIComponent(batch.join(',')), { signal, headers: { Accept: 'application/json' } });
          const payload = await response.json().catch(() => null);
          if (!response.ok || !payload) throw new Error(payload?.error || 'Predictions unavailable');
          return payload;
        }, { signal });
        if (dead || signal.aborted || ticket !== serial) return;
        data = mergeBriefings(result);
      } catch (e) {
        if (dead || signal.aborted || ticket !== serial || e.name === 'AbortError') return;
        error = e;
        if (!data) render();
        throw e;
      }
      render();
    }
    const poll = createLiveRefresh({ el, refresh: fetchPredictions, interval: REFRESH_MS, onState(state) {
      if (dead) return;
      live.textContent = refreshLabel(state) + ' · ';
      live.classList.toggle('s-down', ['error', 'stale', 'offline'].includes(state.status));
      live.title = state.error ? `Showing previous scenarios. ${state.error}` : 'Checks every 2 minutes while visible; these are keyword scenarios, not forecasts.';
    } });
    function load({ reset = false } = {}) {
      serial++;
      if (reset) { data = null; error = null; meta.textContent = ''; body.innerHTML = ui.loading('Classifying recent headlines…'); }
      return poll.restart().catch(() => {});
    }
    function items() { return (data?.impacts || []).filter(i => st.dir === 'all' || i.direction === st.dir); }
    function render(emptyMsg) {
      el.querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === st.scope)));
      el.querySelectorAll('[data-dir]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.dir === st.dir)));
      ctx.setTitle(st.scope === 'linked' ? `${ctx.symbol || ''} Predictions`.trim() : 'Watchlist Predictions');
      if (emptyMsg) { meta.textContent = ''; body.innerHTML = ui.empty(emptyMsg); return; }
      if (error && !data) { meta.textContent = ''; body.innerHTML = ui.error(error.message); return; }
      if (!data) return;
      meta.innerHTML = `${esc(data.provider || 'Finnhub')} · ${esc(data.window?.from || '')} → ${esc(data.window?.to || '')} · ${data.impacts.length} classified of ${data.news.length} headlines · ${esc(fmt.time(data.as_of))}`;
      let html = '';
      if (data.notice) html += ui.unavailable('Live predictions', data.notice);
      if (data.unresolved?.length) html += `<div class="p-pred-note s-down">Unresolved: ${esc(data.unresolved.join(', '))}</div>`;
      if (data.errors?.length) html += `<div class="p-pred-note">Some data unavailable: ${esc(data.errors.map(e => `${e.ticker || e.input} ${e.resource || ''}: ${String(e.code).replaceAll('_', ' ')}`).join('; '))}</div>`;
      if (data.quotes?.length) html += `<div class="p-pred-quotes">${data.quotes.map(q => `<button type="button" class="s-chip" data-sym="${esc(q.ticker)}">${esc(q.ticker)} <span class="s-num">${fmt.price(q.price)}</span> <span class="${fmt.dir(q.change_percent)}">${fmt.pct(q.change_percent)}</span></button>`).join('')}</div>`;
      const list = items();
      if (!data.notice) html += list.length ? list.map(i => `<article class="p-pred-item">
          <span class="p-pred-dir p-pred-${esc(i.direction)}" aria-label="${esc(i.direction)}">${i.direction === 'positive' ? '+' : '−'}</span>
          <div><div class="p-news-eyebrow">${esc(i.category)} · <span class="s-badge">${esc(i.confidence)} confidence</span></div>
          <h3><a href="${esc(i.url)}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a></h3>
          <p>${esc(i.reason)}</p>
          <div class="p-news-foot">${(i.affected || []).map(t => `<button type="button" class="s-chip p-news-tk" data-sym="${esc(t)}">${esc(t)}</button>`).join('')}<strong>${esc(i.source)}</strong><time datetime="${esc(i.date)}">${esc(ago(i.date))}</time><span class="${i.direction === 'positive' ? 's-up' : 's-down'}">${esc(i.direction)} scenario</span></div></div>
        </article>`).join('') : ui.empty('No classified headlines in the seven-day window.');
      const top = body.scrollTop;
      body.innerHTML = html; body.scrollTop = top;
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.sym) return ctx.openSymbol(t.dataset.sym);
      if (t.dataset.scope) { save({ scope: t.dataset.scope }); return load({ reset: true }); }
      if (t.dataset.dir) { save({ dir: t.dataset.dir }); return render(); }
      if (t.hasAttribute('data-retry')) return load();
      if (t.hasAttribute('data-pred-refresh')) return load();
    });
    load({ reset: true });
    const offWatchlist = onWatchlistChange(() => { if (!dead && st.scope === 'watchlist') load({ reset: true }); });
    return {
      onSymbol() { if (st.scope === 'linked') load({ reset: true }); },
      csv() { const r = items().map(i => ({ date: i.date, tickers: (i.affected || []).join(' '), direction: i.direction, category: i.category, confidence: i.confidence, title: i.title, source: i.source, url: i.url })); return r.length ? toCSV(r) : null; },
      scoutContext() {
        const list = items().slice(0, 15);
        return `Classified headline scenarios for ${tickers().join(', ') || 'none'} (keyword heuristic, unreviewed, not forecasts):\n` + (list.length ? list.map(i => `- ${i.direction} · ${i.category} · ${(i.affected || []).join(',')}: ${i.title} (${i.source})`).join('\n') : data?.notice || 'none');
      },
      destroy() { dead = true; serial++; offWatchlist(); poll.destroy(); }
    };
  }
});

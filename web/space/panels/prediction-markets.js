import { registerPanel, esc, fmt, toCSV, state as ui } from '../core.js';
import { createLiveRefresh, refreshLabel } from '../live-refresh.js';
import { STOCK_TOPICS, stockEvent } from './prediction-relevance.js';

const VENUES = { kalshi: 'Kalshi', polymarket: 'Polymarket' };
const finite = v => typeof v === 'number' && Number.isFinite(v);
const price = v => finite(v) && v >= 0 && v <= 1 ? `${fmt.num(v * 100, Number.isInteger(v * 100) ? 0 : 1)}¢` : '—';
const chance = v => finite(v) && v >= 0 && v <= 1 ? `${fmt.num(v * 100, Number.isInteger(v * 100) ? 0 : 1)}%` : '—';
const stamp = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString() : 'Not supplied';
const ends = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No close date';
const volume = (v, unit) => finite(v) ? `${unit === 'USD' ? '$' : ''}${fmt.compact(v)}${unit === 'contracts' ? ' contracts' : ''}` : '—';
const errorText = message => ({
  provider_unavailable: 'Temporarily unavailable. Retrying automatically.',
  prediction_providers_unavailable: 'Both venues are temporarily unavailable. Try again shortly.',
  rate_limited: 'The venue request limit was reached. Retrying shortly.',
  provider_access_denied: 'The venue could not serve this public-data request.',
  invalid_cursor: 'This catalog page is no longer valid. Change the venue or catalog to start again.'
}[message] || (/^[a-z]+(?:_[a-z]+)+$/.test(String(message)) ? 'This page could not be checked. Previous data is retained.' : String(message || 'Temporarily unavailable. Try again shortly.')));
function sourceURL(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && ['kalshi.com', 'www.kalshi.com', 'polymarket.com', 'www.polymarket.com', 'external-api.kalshi.com', 'gamma-api.polymarket.com'].includes(u.hostname) ? u.href : null;
  } catch { return null; }
}
const link = (url, text) => sourceURL(url) ? `<a href="${esc(sourceURL(url))}" target="_blank" rel="noopener noreferrer">${esc(text)} <span aria-hidden="true">↗</span></a>` : '';
const option = (value, label, selected) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;

registerPanel('prediction-markets', {
  title: 'Prediction Markets', category: 'Markets', defaultSize: { w: 12, h: 22 }, symbolLinked: false,
  mount(el, ctx) {
    let st = { provider: 'polymarket', status: 'open', kind: 'standard', q: '', search: '', category: 'all', topic: 'all', sort: 'activity', paused: false, ...ctx.state };
    if (st.stockOnlyVersion !== 1) {
      const migration = { stockOnlyVersion: 1, provider: 'polymarket', kind: 'standard', search: '', q: '', category: 'all', topic: 'all', sort: 'activity' };
      Object.assign(st, migration); ctx.setState(migration);
    }
    if (!STOCK_TOPICS.some(t => t.id === st.topic)) st.topic = 'all';
    st.search = typeof st.search === 'string' ? st.search.slice(0, 200).trim() : '';
    if (st.search) { st.provider = 'polymarket'; st.kind = 'standard'; }
    if (!['all', 'kalshi', 'polymarket'].includes(st.provider)) st.provider = 'all';
    if (!['open', 'closed'].includes(st.status)) st.status = 'open';
    if (!['standard', 'combos'].includes(st.kind)) st.kind = 'standard';
    if (st.kind === 'combos') st.provider = 'kalshi';
    let pages = [], sources = new Map(), failedPages = new Map(), notices = [], revision = 0, dead = false, initial = true;
    let task = { kind: 'initial' }, rotation = 0, liveState = null, lastError = null;
    const expanded = new Set(), openDetails = new Set();
    const save = patch => { st = { ...st, ...patch }; ctx.setState(patch); };
    const venues = () => st.provider === 'all' ? Object.keys(VENUES) : [st.provider];
    const searchId = 'pm-search-' + crypto.randomUUID();
    el.innerHTML = `<div class="p-pm">
      <div class="p-pm-intro"><div><h2>Market-moving events</h2><p>Prediction-market odds for companies and the economy.</p></div><span class="p-pm-access">Stocks only</span></div>
      <form class="p-pm-event-search" data-pm-search-form><label class="s-sr" for="${searchId}">Search stock-relevant Polymarket events</label><div><input id="${searchId}" class="s-input" type="search" data-pm-search value="${esc(st.search)}" maxlength="200" placeholder="Search companies, rates, tariffs…"><button type="submit" class="s-btn s-btn-primary">Search</button><button type="button" class="s-btn s-btn-ghost" data-pm-act="browse">Discover</button></div><p><span>Quick search</span><button type="button" data-pm-search-topic="Jensen Huang">Jensen Huang</button><button type="button" data-pm-search-topic="Fed rates">Fed rates</button><button type="button" data-pm-search-topic="tariffs">Tariffs</button></p></form>
      <div class="p-pm-topics" role="tablist" aria-label="Stock event topics">${[{ id: 'all', label: 'All events' }, ...STOCK_TOPICS].map(t=>`<button id="${searchId}-${t.id}" type="button" role="tab" data-pm-topic="${t.id}" aria-controls="${searchId}-results" aria-selected="${st.topic === t.id}">${t.label}<span></span></button>`).join('')}</div>
      <div class="p-pm-toolbar p-pm-controls">
        <label class="p-pm-sort"><span class="s-sr">Sort loaded events</span><select class="s-select" data-pm-control="sort">${[['activity','Most active'],['closing','Closing soon'],['title','A–Z'],['default','Source order']].map(([v,l])=>option(v,l,st.sort)).join('')}</select></label>
        <details class="p-pm-extra-filters"><summary>Filters</summary><div class="p-pm-extra-controls">
        <label>Venue<select class="s-select" data-pm-control="provider">${[['polymarket','Polymarket'],['all','Both venues'],['kalshi','Kalshi']].map(([v,l])=>option(v,l,st.provider)).join('')}</select></label>
        <label class="p-pm-search">Filter loaded events<input class="s-input" type="search" data-pm-query value="${esc(st.q)}" placeholder="Question, outcome or keyword"></label>
        <label>Event status<select class="s-select" data-pm-control="status">${[['open','Open events'],['closed','Closed events']].map(([v,l])=>option(v,l,st.status)).join('')}</select></label>
        <label>Catalog<select class="s-select" data-pm-control="kind">${[['standard','Standard markets'],['combos','Kalshi combos']].map(([v,l])=>option(v,l,st.kind)).join('')}</select></label>
        <label>Loaded category<select class="s-select" data-pm-category></select></label>
        </div></details>
        <span data-pm-live role="status"></span><button type="button" class="s-btn s-btn-sm" data-pm-act="refresh">Refresh</button><button type="button" class="s-btn s-btn-sm s-btn-ghost" data-pm-act="pause">Pause</button>
      </div>
      <div id="${searchId}-results" class="p-pm-scroll s-scroll" role="tabpanel" aria-labelledby="${searchId}-${st.topic}" tabindex="0"><div class="p-pm-count" role="status"></div><div class="p-pm-grid"></div><div class="p-pm-more"></div></div>
      <details class="p-pm-sources"><summary>Coverage &amp; sources · screened for stock relevance</summary><div class="p-pm-source-content"></div></details>
      <p class="p-pm-foot">Market-implied probabilities · Read contract deadlines and rules.</p>
    </div>`;
    const $ = selector => el.querySelector(selector);
    const scroll = $('.p-pm-scroll'), grid = $('.p-pm-grid');
    let compactFilters = null;
    const filterResize = new ResizeObserver(entries => {
      const compact = entries[0].contentRect.width <= 600;
      if (compact !== compactFilters) { compactFilters = compact; $('.p-pm-extra-filters').open = false; }
    });
    filterResize.observe($('.p-pm'));

    function allEvents() {
      const byId = new Map();
      [...pages].sort((a,b) => (a.checkedAt || 0) - (b.checkedAt || 0)).forEach(p => {
        for (const raw of p.events) { const event = stockEvent(raw); if (event) byId.set(event.id, { ...event, __checkedAt: p.checkedAt, __page: pages.indexOf(p), __pageError: p.error }); }
      });
      const groups = Object.fromEntries(Object.keys(VENUES).map(provider => [provider, [...byId.values()].filter(e => e.provider === provider)]));
      if (st.provider !== 'all') return groups[st.provider] || [];
      const rows = [];
      for (let i = 0; i < Math.max(groups.kalshi.length, groups.polymarket.length); i++) {
        for (const provider of Object.keys(VENUES)) if (groups[provider][i]) rows.push(groups[provider][i]);
      }
      return rows;
    }
    function filtered() {
      const q = String(st.q || '').trim().toLowerCase();
      const list = allEvents().filter(e => (st.topic === 'all' || e.stockTopics?.includes(st.topic)) && (st.category === 'all' || e.category === st.category) && (!q ||
        [e.title, e.subtitle, ...(e.tags || []), ...(e.markets || []).flatMap(m => [m.question, m.subtitle, ...(m.outcomes || []).map(o => o.label)])].join(' ').toLowerCase().includes(q)));
      if (st.sort === 'title') list.sort((a,b) => String(a.title).localeCompare(String(b.title)));
      if (st.sort === 'closing') list.sort((a,b) => (Date.parse(a.closeTime) || Infinity) - (Date.parse(b.closeTime) || Infinity));
      if (st.sort === 'activity' && st.provider !== 'all') list.sort((a,b) => (b.volume24h ?? -1) - (a.volume24h ?? -1));
      return list;
    }
    function categories() {
      const control = $('[data-pm-category]');
      const values = [...new Set(allEvents().map(e => e.category).filter(Boolean))].sort();
      if (st.category !== 'all' && !values.includes(st.category)) values.push(st.category);
      if (document.activeElement !== control) control.innerHTML = option('all', 'All loaded categories', st.category) + values.map(v=>option(v,v,st.category)).join('');
      const activity = $('[data-pm-control="sort"] option[value="activity"]');
      activity.disabled = st.provider === 'all';
      if (st.provider === 'all' && st.sort === 'activity') { save({ sort: 'default' }); $('[data-pm-control="sort"]').value = 'default'; }
    }
    function card(event) {
      const markets = Array.isArray(event.markets) ? event.markets : [];
      const shown = expanded.has(event.id) ? markets : markets.slice(0, 1);
      const total = finite(event.marketCount) ? event.marketCount : markets.length;
      const multipleDeadlines = new Set(markets.map(m => m.closeTime).filter(Boolean)).size > 1;
      return `<article class="p-pm-card" data-pm-event="${esc(event.id)}" data-pm-page="${event.__page}">
        <header class="p-pm-event-head"><div><h3>${esc(event.title || 'Untitled event')}</h3><div class="p-pm-card-meta"><span class="p-pm-venue p-pm-venue-${esc(event.provider)}">${esc(VENUES[event.provider] || event.provider)}</span><span>${esc(event.stockRelevance || 'Stock-relevant event')}</span><span class="p-pm-expiry">${multipleDeadlines ? 'Multiple deadlines' : `${st.status === 'closed' ? 'Closed' : 'Closes'} ${esc(ends(event.closeTime))}`}</span></div></div><div class="p-pm-activity"><strong>${esc(volume(event.volume24h, event.volumeUnit))}</strong><span>24h activity</span></div></header>
        ${event.subtitle && event.subtitle !== event.title ? `<p class="p-pm-subtitle">${esc(event.subtitle)}</p>` : ''}
        <div class="p-pm-outcomes">${shown.map(market => marketRow(event, market)).join('') || '<p class="s-muted">No nested contracts supplied. Open the venue for its full event details.</p>'}</div>
        ${markets.length > 1 ? `<button type="button" class="p-pm-expand" data-pm-act="expand" data-pm-id="${esc(event.id)}" aria-expanded="${expanded.has(event.id)}">${expanded.has(event.id) ? 'Show fewer contracts' : `Show all ${markets.length} contracts`}</button>` : ''}
        <div class="p-pm-card-foot"><span title="${esc(stamp(event.__checkedAt ? new Date(event.__checkedAt).toISOString() : null))}">Checked ${event.__checkedAt ? esc(new Date(event.__checkedAt).toLocaleTimeString()) : 'not yet'}</span>${link(event.url, event.urlLabel || `Open ${VENUES[event.provider] || 'venue'}`)}</div>
        ${event.__pageError ? '<p class="p-pm-partial">This page could not be refreshed. Previous data is retained; retrying automatically.</p>' : ''}
        ${event.partial || total > markets.length ? `<p class="p-pm-partial">Partial event coverage: ${markets.length} of ${total} contracts supplied.</p>` : ''}
      </article>`;
    }
    function marketRow(event, market) {
      const key = event.id + '/' + market.id;
      const outcomes = Array.isArray(market.outcomes) ? market.outcomes : [];
      return `<section class="p-pm-market"><h4>${esc(market.question || market.subtitle || 'Contract')}</h4>
        ${market.subtitle && market.subtitle !== market.question ? `<p class="p-pm-market-sub">${esc(market.subtitle)}</p>` : ''}
        <div class="p-pm-prices">${outcomes.map(o => `<div class="p-pm-price${String(o.label).toLowerCase() === 'yes' ? ' is-yes' : String(o.label).toLowerCase() === 'no' ? ' is-no' : ''}" title="${esc(o.priceKind === 'settlement' ? 'Settlement' : event.provider === 'polymarket' ? market.status === 'open' ? 'Market-implied probability' : 'Last implied probability (closed)' : 'Ask price')}"><span>${esc(o.label)}</span><strong>${event.provider === 'polymarket' ? chance(o.price) : price(o.price)}</strong></div>`).join('') || '<span class="s-muted">Outcome prices unavailable</span>'}</div>
        <details class="p-pm-details" data-pm-detail="${esc(key)}"${openDetails.has(key) ? ' open' : ''}><summary>Rules &amp; contract details${market.status ? ` · ${esc(market.status)}` : ''}</summary>
          <div class="p-pm-facts"><span>Last trade <b>${price(market.lastPrice)}</b></span><span>24h activity <b>${esc(volume(market.volume24h, market.volumeUnit))}</b></span><span>Close <b>${esc(ends(market.closeTime))}</b></span>${finite(market.openInterest) ? `<span>Open interest <b>${esc(fmt.compact(market.openInterest))}${event.provider === 'kalshi' ? ' contracts' : ''}</b></span>` : ''}</div>
          <p class="p-pm-rules">${esc(market.rules || 'Resolution rules were not supplied. Check the venue before interpreting this contract.')}</p>${market.rulesTruncated ? '<p class="p-pm-partial">Rules are shortened here. Read the full resolution rules at the source.</p>' : ''}${link(market.url || event.url, market.urlLabel || event.urlLabel || 'View at source')} ${link(market.dataUrl, 'Official contract data')}
        </details></section>`;
    }
    function renderSources() {
      $('.p-pm-source-content').innerHTML = venues().map(provider => {
        const source = sources.get(provider);
        const count = allEvents().filter(e => e.provider === provider).length;
        const failed = source?.status === 'error';
        return `<div class="p-pm-source${failed ? ' is-error' : ''}"><strong>${VENUES[provider]}</strong><span>${failed ? esc(errorText(source.error)) : source?.status === 'skipped' ? 'Not included in this catalog' : initial ? 'Loading…' : `${count} events loaded`}</span>${failed ? `<button type="button" class="s-btn s-btn-sm s-btn-ghost" data-pm-act="retry" data-pm-provider="${provider}">Retry ${VENUES[provider]}</button>` : ''}</div>`;
      }).join('') + (notices.length ? `<details class="p-pm-notices"><summary>Data &amp; coverage</summary>${notices.map(n=>`<p>${esc(n)}</p>`).join('')}</details>` : '');
    }
    function render() {
      if (dead) return;
      const top = scroll.scrollTop;
      const ruleScroll = new Map([...grid.querySelectorAll('[data-pm-detail]')].map(d => [d.dataset.pmDetail, d.querySelector('.p-pm-rules')?.scrollTop || 0]));
      const active = grid.contains(document.activeElement) ? document.activeElement : null;
      const focus = active ? { act: active.dataset.pmAct, id: active.dataset.pmId, detail: active.closest('[data-pm-detail]')?.dataset.pmDetail, summary: active.tagName === 'SUMMARY' } : null;
      categories(); renderSources();
      const all = allEvents(), list = filtered();
      scroll.setAttribute('aria-labelledby', searchId + '-' + st.topic);
      for (const b of el.querySelectorAll('[data-pm-topic]')) { b.setAttribute('aria-selected', String(b.dataset.pmTopic === st.topic)); b.tabIndex = b.dataset.pmTopic === st.topic ? 0 : -1; b.querySelector('span').textContent = b.dataset.pmTopic === 'all' ? all.length : all.filter(e=>e.stockTopics?.includes(b.dataset.pmTopic)).length; }
      $('.p-pm-count').innerHTML = `<span><strong>${list.length}</strong> stock-relevant events${st.search ? ' · ' + esc(st.search) : ''}</span><span>${[...sources.values()].some(s=>s.partial) ? '<span class="p-pm-warning">Some categories unavailable · </span>' : ''}${list.reduce((n,e)=>n+(e.markets?.length || 0),0)} contracts · loaded results</span>`;
      if (initial && !pages.length) grid.innerHTML = ui.loading('Loading prediction markets…');
      else if (!list.length) grid.innerHTML = `<div class="p-pm-empty">${ui.empty(lastError && !all.length ? 'Market data could not be checked. Refresh to retry.' : st.q || st.category !== 'all' || st.topic !== 'all' ? 'No loaded stock-relevant events match. Clear filters or load more events.' : st.search ? 'No stock-relevant matches on these search pages. Try a company or economic topic.' : 'No stock-relevant events on these pages. More provider results may be available.')}<button type="button" class="s-btn s-btn-sm" data-pm-act="${st.search ? 'browse' : 'clear'}">${st.search ? 'Discover events' : 'Clear filters'}</button></div>`;
      else grid.innerHTML = list.map(card).join('');
      for (const details of grid.querySelectorAll('[data-pm-detail]')) {
        const rules = details.querySelector('.p-pm-rules'); if (rules) rules.scrollTop = ruleScroll.get(details.dataset.pmDetail) || 0;
      }
      $('.p-pm-more').innerHTML = venues().map(provider => {
        const source = sources.get(provider);
        const last = pages.filter(p => p.provider === provider).at(-1);
        const more = source?.hasMore && source?.nextCursor;
        return `<div><span>${VENUES[provider]} · ${source?.status === 'error' ? 'Refresh failed' : more ? 'More events available' : last ? 'End of returned catalog' : 'Not loaded'}</span><button type="button" class="s-btn" data-pm-act="more" data-pm-provider="${provider}"${!more || liveState?.busy ? ' disabled' : ''}>Load more ${VENUES[provider]}</button></div>`;
      }).join('');
      if (focus) {
        const target = focus.summary ? [...grid.querySelectorAll('[data-pm-detail]')].find(d => d.dataset.pmDetail === focus.detail)?.querySelector('summary') : [...grid.querySelectorAll('[data-pm-act]')].find(b => b.dataset.pmAct === focus.act && b.dataset.pmId === focus.id);
        target?.focus({ preventScroll: true });
      }
      scroll.scrollTop = top;
    }
    function updateLive(state) {
      if (dead) return;
      liveState = state;
      $('[data-pm-live]').title = refreshLabel(state) + ' · 30s checks; up to 4 loaded pages per cycle';
      $('[data-pm-live]').textContent = state.paused ? 'Updates paused' : state.busy ? 'Checking…' : state.error ? 'Update delayed' : state.status === 'offline' ? 'Offline' : 'Auto refresh · 30s';
      $('[data-pm-live]').classList.toggle('is-stale', !!state.error || state.status === 'offline');
      const pause = $('[data-pm-act="pause"]'); pause.textContent = state.paused ? 'Resume' : 'Pause'; pause.setAttribute('aria-pressed', String(state.paused));
      for (const button of el.querySelectorAll('[data-pm-act="more"]')) button.disabled = state.busy || !sources.get(button.dataset.pmProvider)?.nextCursor;
    }
    function applyPage(response, provider, cursor, seq) {
      if (dead || seq !== revision) return false;
      const source = response.sources?.find(s => s.provider === provider);
      if (!source) throw new Error(`${VENUES[provider]} returned no source status.`);
      const current = pages.find(p => p.provider === provider && p.cursor === cursor);
      const last = pages.filter(p => p.provider === provider).at(-1);
      // Refreshing an earlier page must never rewind the next-page cursor.
      if (source.status !== 'ok') { markFailed({ provider, cursor }, source.error || 'Venue unavailable'); return false; }
      failedPages.delete(JSON.stringify([provider, cursor]));
      const remaining = [...failedPages.values()].find(p => p.provider === provider);
      sources.set(provider, { ...(sources.get(provider) || {}), ...source,
        ...(!current || last === current ? {} : { nextCursor: sources.get(provider)?.nextCursor, hasMore: sources.get(provider)?.hasMore }),
        status: remaining ? 'error' : 'ok', error: remaining?.error || null });
      const events = (response.events || []).filter(e => e.provider === provider);
      const checkedAt = Date.parse(source.fetchedAt || response.fetchedAt) || Date.now();
      if (current) Object.assign(current, { events, checkedAt, error: null });
      else pages.push({ provider, cursor, events, checkedAt });
      return true;
    }
    function markFailed(page, error) {
      const key = JSON.stringify([page.provider, page.cursor]); failedPages.delete(key);
      failedPages.set(key, { ...page, error: errorText(error) });
      sources.set(page.provider, { ...(sources.get(page.provider) || {}), provider: page.provider, status: 'error', error: errorText(error) });
      const current = pages.find(p => p.provider === page.provider && p.cursor === page.cursor);
      if (current) current.error = error;
    }
    async function fetchPage(page, signal, seq) {
      try {
        const response = await requestPage(page.provider, page.cursor, signal);
        if (signal.aborted || seq !== revision || dead) throw new DOMException('Aborted', 'AbortError');
        notices = [...new Set([...notices, ...(response.notices || [])])];
        if (!applyPage(response, page.provider, page.cursor, seq)) throw new Error(`${VENUES[page.provider]} could not be refreshed.`);
      } catch (e) {
        if (!signal.aborted && seq === revision && !dead && e.name !== 'AbortError') markFailed(page, e.message || 'Update failed');
        throw e;
      }
    }
    function requestPage(provider, cursor, signal) {
      const path = provider === 'polymarket' && st.kind === 'standard' && !st.search ? 'prediction-markets/stock-events' : 'prediction-markets/catalog';
      return ctx.api(path, { provider, cursor, limit: 12, status: st.status, kind: st.kind, scope: 'stocks', ...(st.search ? { q: st.search } : {}) }, { signal });
    }
    async function refresh(signal) {
      const seq = revision, job = task; task = null;
      try {
        if (job?.kind === 'more' || job?.kind === 'retry') {
          await fetchPage({ provider: job.provider, cursor: job.cursor || null }, signal, seq);
        } else if (job?.kind === 'initial' || !pages.length) {
          const response = await requestPage(st.provider, null, signal);
          if (signal.aborted || seq !== revision || dead) return;
          notices = response.notices || [];
          const results = venues().map(provider => applyPage(response, provider, null, seq));
          if (!results.some(Boolean)) throw new Error('Neither venue returned a market page.');
          if (results.some(v => !v)) throw new Error('Some venue pages could not be loaded.');
        } else {
          const batch = [...failedPages.values()].slice(0, 2);
          let scanned = 0;
          for (; scanned < pages.length && batch.length < 4; scanned++) {
            const page = pages[(rotation + scanned) % pages.length];
            if (!batch.some(p => p.provider === page.provider && p.cursor === page.cursor)) batch.push(page);
          }
          rotation = (rotation + Math.max(1, scanned)) % Math.max(1, pages.length);
          const results = await Promise.allSettled(batch.map(page => fetchPage(page, signal, seq)));
          if (results.some(r => r.status === 'rejected')) throw results.find(r => r.status === 'rejected').reason;
        }
        lastError = null;
      } catch (e) {
        if (signal.aborted || seq !== revision || dead || e.name === 'AbortError') throw e;
        lastError = e;
        // Transport errors may occur before a normalized source status exists.
        const provider = job?.provider;
        if (provider) markFailed({ provider, cursor: job.cursor || null }, e.message || 'Update failed');
        else if (job?.kind === 'initial' || !pages.length) for (const venue of venues()) if (!pages.some(p => p.provider === venue)) markFailed({ provider: venue, cursor: null }, e.message || 'Update failed');
        throw e;
      } finally {
        if (!dead && seq === revision && !signal.aborted) { initial = false; render(); }
      }
    }
    const poll = createLiveRefresh({ el, refresh, interval: 30000, paused: !!st.paused, onState: updateLive });
    function reset() {
      revision++; pages = []; sources = new Map(); failedPages = new Map(); notices = []; lastError = null; rotation = 0; initial = true; expanded.clear(); openDetails.clear(); task = { kind: 'initial' };
      render(); return poll.restart().catch(() => {});
    }
    function searchEvents(value) {
      save({ search: String(value).trim().slice(0, 200), provider: 'polymarket', kind: 'standard', q: '', category: 'all', topic: 'all', sort: 'activity' });
      $('[data-pm-search]').value = st.search; $('[data-pm-query]').value = '';
      $('[data-pm-control="provider"]').value = st.provider; $('[data-pm-control="kind"]').value = st.kind; $('[data-pm-control="sort"]').value = st.sort;
      reset();
    }
    const submitSearch = e => { e.preventDefault(); searchEvents($('[data-pm-search]').value); };
    $('[data-pm-search-form]').addEventListener('submit', submitSearch);
    const click = e => {
      const topicTab = e.target.closest('[data-pm-topic]');
      if (topicTab) { save({ topic: topicTab.dataset.pmTopic }); render(); scroll.scrollTop = 0; return; }
      const topic = e.target.closest('[data-pm-search-topic]');
      if (topic) { searchEvents(topic.dataset.pmSearchTopic); return; }
      const button = e.target.closest('[data-pm-act]'); if (!button) return;
      const act = button.dataset.pmAct;
      if (act === 'browse') searchEvents('');
      else if (act === 'pause') { save({ paused: !poll.state().paused }); poll.setPaused(st.paused); }
      else if (act === 'refresh') poll.request(true).catch(() => {});
      else if (act === 'more' || act === 'retry') {
        const provider = button.dataset.pmProvider;
        task = { kind: act, provider, cursor: act === 'more' ? sources.get(provider)?.nextCursor : [...failedPages.values()].find(p=>p.provider===provider)?.cursor || null };
        poll.request(true).catch(() => {});
      } else if (act === 'expand') {
        expanded.has(button.dataset.pmId) ? expanded.delete(button.dataset.pmId) : expanded.add(button.dataset.pmId); render();
      } else if (act === 'clear') { save({ q: '', category: 'all', topic: 'all' }); $('[data-pm-query]').value = ''; render(); }
    };
    const change = e => {
      const control = e.target.dataset.pmControl;
      if (control === 'sort') { save({ sort: e.target.value }); render(); return; }
      if (e.target.hasAttribute('data-pm-category')) { save({ category: e.target.value }); render(); return; }
      if (!['provider','status','kind'].includes(control)) return;
      const patch = { [control]: e.target.value, category: 'all' };
      if (control === 'kind' && patch.kind === 'combos') patch.provider = 'kalshi';
      if (control === 'provider' && patch.provider === 'polymarket') patch.kind = 'standard';
      if (control === 'provider' || control === 'kind') { patch.search = ''; $('[data-pm-search]').value = ''; }
      save(patch);
      $('[data-pm-control="provider"]').value = st.provider; $('[data-pm-control="kind"]').value = st.kind;
      reset();
    };
    const input = e => { if (e.target.hasAttribute('data-pm-query')) { save({ q: e.target.value }); render(); } };
    const toggle = e => { const id = e.target.dataset?.pmDetail; if (id) e.target.open ? openDetails.add(id) : openDetails.delete(id); };
    const topicKey = e => {
      const current = e.target.closest('[data-pm-topic]');
      if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); const buttons = [...el.querySelectorAll('[data-pm-topic]')], i = buttons.indexOf(current);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      save({ topic: buttons[next].dataset.pmTopic }); render(); scroll.scrollTop = 0; buttons[next].focus();
    };
    el.addEventListener('keydown', topicKey);
    el.addEventListener('click', click); el.addEventListener('change', change); el.addEventListener('input', input); el.addEventListener('toggle', toggle, true);
    render(); poll.request(true).catch(() => {});
    return {
      csv() { const rows = filtered().flatMap(e => (e.markets || []).flatMap(m => (m.outcomes || []).map(o=>({ venue: VENUES[e.provider], event:e.title, contract:m.question, outcome:o.label, price:o.price, priceKind:o.priceKind, bid:o.bid, ask:o.ask, status:m.status, close:m.closeTime, activity24h:m.volume24h, activityUnit:m.volumeUnit, checked:new Date(e.__checkedAt).toISOString(), url:m.url || e.url })))); return rows.length ? toCSV(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[\s]*[=+\-@]/.test(value) ? "'" + value : value])))) : null; },
      scoutContext() { return `Prediction markets, ${st.status} ${st.kind} events from ${venues().map(v=>VENUES[v]).join(' + ')}${st.search ? ', Polymarket search: ' + st.search : ''}. Local filters cover loaded pages only; percentages are market-implied probabilities, not independent forecasts.\n` + filtered().slice(0,20).map(e => `${e.title} (${VENUES[e.provider]}): ${(e.markets || []).slice(0,10).map(m=>`${m.question}: ${(m.outcomes || []).map(o=>`${o.label} ${e.provider === 'polymarket' ? chance(o.price) : price(o.price)}`).join(', ')}`).join('; ')}`).join('\n'); },
      destroy() { dead = true; revision++; poll.destroy(); filterResize.disconnect(); $('[data-pm-search-form]').removeEventListener('submit', submitSearch); el.removeEventListener('click', click); el.removeEventListener('change', change); el.removeEventListener('input', input); el.removeEventListener('toggle', toggle, true); el.removeEventListener('keydown', topicKey); }
    };
  }
});

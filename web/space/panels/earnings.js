// Earnings panels: `earnings-calendar` (Earnings Hub), `earnings-detail` (per-symbol EPS / revenue / estimates),
// `economic-calendar` (CPI, FOMC from worker/calendar.js). Owned by the news-earnings builder.
import { registerPanel, esc, fmt, toCSV, bus, state as ui } from '../core.js';
import { readWatchlist } from './news.js';
import { createLiveRefresh, refreshLabel } from '../live-refresh.js';

function earningsRefresh(el, load, interval = 300000) {
  let next = null;
  const status = document.createElement('div'); status.className = 'p-earn-live'; status.setAttribute('role', 'status');
  el.querySelector('.p-earn').append(status);
  const poll = createLiveRefresh({ el, interval, refresh: signal => {
      const options = next || { fresh: true, silent: true }; next = null;
      return load({ ...options, signal });
    },
    enabled: () => !el.contains(document.activeElement) || !document.activeElement?.matches('input,select,textarea'),
    onState(state) {
      status.textContent = refreshLabel(state) + ` · ${interval / 60000} min checks while visible`;
    }
  });
  return { ...poll, load(options = {}) { next = options; return poll.restart().catch(() => {}); } };
}

const DAY = 86400000;
const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const weekStart = s => addDays(s, -new Date(s + 'T00:00:00Z').getUTCDay()); // Sunday
const dt = (s, o) => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
const TIME_LABEL = { BMO: 'Before market open', AMC: 'After market close', DMH: 'During market hours' };
const ICON = {
  BMO: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor"/><g stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/></g></svg>',
  AMC: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.8 2.2A6 6 0 1 0 13.8 10 4.8 4.8 0 0 1 10.8 2.2z" fill="currentColor"/></svg>',
  DMH: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  none: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/></svg>'
};
const timeIcon = t => `<span class="p-earn-time p-earn-time-${esc(t || 'none')}" title="${esc(TIME_LABEL[t] || 'Time not supplied')}" aria-label="${esc(TIME_LABEL[t] || 'Time not supplied')}">${ICON[t] || ICON.none}</span>`;
const eps = v => (Number.isFinite(v) ? fmt.num(v, 2) : '—');
const usd = v => (Number.isFinite(v) ? '$' + fmt.compact(v) : '—');
const surprise = v => (Number.isFinite(v) ? `<span class="${fmt.dir(v)}">${fmt.pct(v)}</span>` : '—');
const errMsg = e => ({ provider_unavailable: 'Earnings data provider is unavailable right now.', rate_limited: 'Provider rate limit reached. Try again shortly.', invalid_symbol: 'Earnings are not available for this symbol.' }[e?.message] || e?.message || 'Request failed.');
const CAPS = [['all', 'All market caps', 0, Infinity], ['mega', 'Mega (≥ $200B)', 200e9, Infinity], ['large', 'Large ($10B–200B)', 10e9, 200e9], ['mid', 'Mid ($2B–10B)', 2e9, 10e9], ['small', 'Small ($300M–2B)', 3e8, 2e9], ['micro', 'Micro (< $300M)', 0, 3e8]];
const COLS = [
  ['symbol', 'Symbol', false], ['company', 'Company', false], ['time', 'Time', false], ['epsEstimate', 'Estimated EPS', true], ['epsActual', 'Actual EPS', true],
  ['surprisePct', 'Surprise', true], ['revenueEstimate', 'Revenue est.', true], ['revenueActual', 'Revenue actual', true], ['marketCap', 'Market cap', true],
  ['fiscalQuarter', 'Fiscal qtr', false], ['estimates', '# Ests', true]
];
const uiIcon = name => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ prev: '<path d="m12 5-5 5 5 5"/>', next: '<path d="m8 5 5 5-5 5"/>', calendar: '<rect x="3" y="4" width="14" height="13" rx="2"/><path d="M6 2v4m8-4v4M3 8h14"/>', star: '<path d="m10 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z"/>', search: '<circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/>' })[name] || ''}</svg>`;
let earningsInstance = 0;

// ---------------------------------------------------------------------------
registerPanel('earnings-calendar', {
  title: 'Earnings Calendar', category: 'Earnings', defaultSize: { w: 5, h: 18 },
  mount(el, ctx) {
    let today = nyToday();
    let st = { week: null, day: today, watch: false, cap: 'all', time: 'all', q: '', allColumns: false, sort: { key: 'marketCap', dir: 'desc' }, ...ctx.state };
    let data = null, error = null, ctrl = null, expanded = null, loadedWeek = null;
    const cache = new Map();
    const save = p => { st = { ...st, ...p }; ctx.setState(st); };
    function syncToday() { const date = nyToday(); if (date !== today) { const follow = !st.week && st.day === today; today = date; if (follow) save({ day: today }); } }
    const wk = () => { syncToday(); return st.week || weekStart(today); };

    el.innerHTML = `<div class="p-earn p-earn-calendar">
      <div class="p-earn-nav">
        <strong class="p-earn-range"></strong>
        <div class="p-earn-step" role="group" aria-label="Week navigation">
          <button type="button" class="s-icon-btn" data-step="-7" aria-label="Previous week">${uiIcon('prev')}</button>
          <label class="p-earn-pick s-icon-btn" title="Pick a date">${uiIcon('calendar')}<input type="date" aria-label="Pick a date"></label>
          <button type="button" class="s-icon-btn" data-step="7" aria-label="Next week">${uiIcon('next')}</button>
        </div>
        <div class="s-seg p-earn-quick" role="group" aria-label="Quick range"><button type="button" data-jump="today">Today</button><button type="button" data-jump="this">This week</button><button type="button" data-jump="next">Next week</button></div>
      </div>
      <div class="p-earn-strip" role="group" aria-label="Filter reports by day"></div>
      <div class="p-earn-filters">
        <label class="p-earn-search">${uiIcon('search')}<input class="s-input" type="search" data-q placeholder="Search symbol or company" aria-label="Search symbol or company"></label>
        <button type="button" class="s-chip" data-watch aria-pressed="false">${uiIcon('star')} Watchlist</button>
        <select class="s-select" data-cap aria-label="Market cap">${CAPS.map(c => `<option value="${c[0]}">${esc(c[1])}</option>`).join('')}</select>
        <select class="s-select" data-time aria-label="Call time"><option value="all">All times</option><option value="BMO">Before open</option><option value="AMC">After close</option><option value="DMH">Market hours</option><option value="none">Time not supplied</option></select>
      </div>
      <div class="p-earn-listhead">
        <span class="s-muted p-earn-count" aria-live="polite"></span>
        <button type="button" class="s-btn s-btn-ghost s-btn-sm" data-columns aria-pressed="false">Show all columns</button>
      </div>
      <div class="p-earn-body s-scroll"></div>
      <div class="p-earn-foot s-muted"></div>
    </div>`;
    const $ = s => el.querySelector(s);
    const body = $('.p-earn-body');

    function load(options) { return poll.load(options); }
    async function fetchData({ fresh = false, silent = false, signal } = {}) {
      const from = wk(), to = addDays(from, 6);
      if (loadedWeek !== from) data = null;
      ctrl?.abort(); ctrl = new AbortController();
      const request = ctrl;
      signal?.addEventListener('abort', () => request.abort(), { once: true });
      error = null;
      if (!fresh && cache.has(from)) { data = cache.get(from); loadedWeek = from; render(); return; }
      if (!silent) { data = null; render(); }
      try {
        const d = await ctx.api('earnings/calendar', { from, to }, { signal: ctrl.signal });
        if (request.signal.aborted) return;
        cache.set(from, d); if (wk() === from) { data = d; loadedWeek = from; }
      } catch (e) { if (request.signal.aborted || e.name === 'AbortError') throw e; error = e; if (silent) throw e; render(); throw e; }
      if (request.signal.aborted) return;
      const scroll = body.scrollTop;
      render();
      if (silent) body.scrollTop = scroll;
    }
    function rows() {
      if (!data) return [];
      const cap = CAPS.find(c => c[0] === st.cap) || CAPS[0];
      const watch = st.watch ? new Set(readWatchlist()) : null;
      const q = st.q.trim().toLowerCase();
      return data.rows.filter(r => (!watch || watch.has(r.symbol)) &&
        (cap[0] === 'all' || (Number.isFinite(r.marketCap) && r.marketCap >= cap[2] && r.marketCap < cap[3])) &&
        (st.time === 'all' || (st.time === 'none' ? !r.time : r.time === st.time)) &&
        (!q || r.symbol.toLowerCase().startsWith(q) || (r.company || '').toLowerCase().includes(q)));
    }
    function sorted(list) {
      const { key, dir } = st.sort, m = dir === 'asc' ? 1 : -1;
      return [...list].sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return a.symbol.localeCompare(b.symbol);
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * m || a.symbol.localeCompare(b.symbol);
      });
    }
    function head() {
      return `<thead><tr><th class="p-earn-tcol"><span class="s-sr">Details</span></th>${COLS.map(([k, l, n]) => {
        const s = st.sort.key === k ? (st.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
        return `<th class="${n ? 's-num ' : ''}p-earn-c-${k}" aria-sort="${s}"><button type="button" class="p-earn-sort" data-sort="${k}" aria-label="Sort by ${esc(l)}">${esc(l)}</button></th>`;
      }).join('')}</tr></thead>`;
    }
    function row(r) {
      const id = r.symbol + '|' + r.date, open = expanded === id;
      const beat = Number.isFinite(r.surprisePct) ? (r.surprisePct >= 0 ? 'beat' : 'miss') : '';
      let html = `<tr data-row="${esc(id)}" data-symbol="${esc(r.symbol)}" class="${open ? 'is-open' : ''}" title="Select ${esc(r.symbol)}">
        <td class="p-earn-tcol">${timeIcon(r.time)}<button type="button" class="p-earn-exp" data-exp="${esc(id)}" aria-expanded="${open}" aria-label="Toggle ${esc(r.symbol)} earnings call details">${open ? '▾' : '›'}</button></td>
        <td class="p-earn-c-symbol"><button type="button" class="p-earn-symbol" data-select-symbol="${esc(r.symbol)}" data-select-row="${esc(id)}" aria-label="Select ${esc(r.symbol)} earnings">${esc(r.symbol)}</button><span class="p-earn-company" title="${esc(r.company || '')}">${esc(r.company || '—')}</span></td><td class="p-earn-c-company" title="${esc(r.company || '')}">${esc(r.company || '—')}</td>
        <td class="p-earn-c-time"><span class="p-earn-timing">${timeIcon(r.time)}${esc(({BMO:'Before open',AMC:'After close',DMH:'Market hours'})[r.time] || 'Not supplied')}</span></td>
        <td class="s-num p-earn-c-epsEstimate">${eps(r.epsEstimate)}</td><td class="s-num p-earn-c-epsActual ${beat ? 'p-earn-' + beat : ''}">${eps(r.epsActual)}</td>
        <td class="s-num p-earn-c-surprisePct">${surprise(r.surprisePct)}</td><td class="s-num p-earn-c-revenueEstimate">${usd(r.revenueEstimate)}</td>
        <td class="s-num p-earn-c-revenueActual">${usd(r.revenueActual)}</td><td class="s-num p-earn-c-marketCap">${usd(r.marketCap)}</td>
        <td class="p-earn-c-fiscalQuarter">${esc(r.fiscalQuarter || '—')}</td><td class="s-num p-earn-c-estimates">${Number.isFinite(r.estimates) ? r.estimates : '—'}</td></tr>`;
      if (open) html += `<tr class="p-earn-detail"><td colspan="${st.allColumns ? COLS.length + 1 : 7}"><div class="p-earn-dgrid">
          <div><span>Company</span>${esc(r.company || '—')}</div>
          <div><span>Report date</span>${esc(dt(r.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</div>
          <div><span>Call time</span>${esc(TIME_LABEL[r.time] || 'Not supplied')}</div>
          <div><span>Fiscal quarter</span>${esc(r.fiscalQuarter || '—')}</div>
          <div><span>Consensus EPS</span>${eps(r.epsEstimate)}${Number.isFinite(r.estimates) ? ` <small>(${r.estimates} est.)</small>` : ''}</div>
          <div><span>Reported EPS</span>${eps(r.epsActual)} ${surprise(r.surprisePct)}</div>
          <div><span>Revenue est. / actual</span>${usd(r.revenueEstimate)} / ${usd(r.revenueActual)}</div>
          <div><span>Last year</span>${r.lastYearDate ? esc(fmt.date(r.lastYearDate + 'T12:00:00Z')) : '—'} · EPS ${eps(r.lastYearEPS)}</div>
          <div><span>Market cap</span>${usd(r.marketCap)}</div>
        </div><div class="p-earn-dact">
          <button type="button" class="s-btn s-btn-sm" data-add-detail="${esc(r.symbol)}">Open earnings detail</button>
          <button type="button" class="s-btn s-btn-sm" data-ask="${esc(id)}">✦ Ask Ultimater AI about this report</button>
          <a class="s-btn s-btn-ghost s-btn-sm" href="https://www.nasdaq.com/market-activity/stocks/${esc(r.symbol.toLowerCase())}/earnings" target="_blank" rel="noopener noreferrer">Source: Nasdaq ↗</a>
          <span class="s-muted">Data: ${esc(r.sources.join(' + '))}</span>
        </div></td></tr>`;
      return html;
    }

    function render() {
      const from = wk(), to = addDays(from, 6);
      if (data && loadedWeek !== from) { data = null; queueMicrotask(() => load({ fresh: true })); }
      $('.p-earn-range').textContent = `${dt(from, { month: 'short', day: 'numeric' })} — ${dt(to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
      $('[type=date]').value = st.day || from;
      $('[data-watch]').setAttribute('aria-pressed', String(!!st.watch));
      $('[data-columns]').setAttribute('aria-pressed', String(!!st.allColumns));
      $('[data-columns]').textContent = st.allColumns ? 'Show key columns' : 'Show all columns';
      el.querySelector('.p-earn-calendar').classList.toggle('has-all-columns', !!st.allColumns);
      $('[data-cap]').value = st.cap; $('[data-time]').value = st.time;
      if (document.activeElement !== $('[data-q]')) $('[data-q]').value = st.q;
      const thisWeek = weekStart(today);
      el.querySelectorAll('.p-earn-quick [data-jump]').forEach(b => b.setAttribute('aria-pressed', String(
        b.dataset.jump === 'today' ? from === thisWeek && st.day === today : b.dataset.jump === 'this' ? from === thisWeek && !st.day : from === addDays(thisWeek, 7) && !st.day)));
      const filtered = rows();
      const counts = new Map(); filtered.forEach(r => counts.set(r.date, (counts.get(r.date) || 0) + 1));
      $('.p-earn-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
        const d = addDays(from, i), n = data ? (counts.get(d) || 0) : null, sel = d === st.day;
        const label = n === null ? 'Loading' : `${n} report${n === 1 ? '' : 's'}`;
        return `<button type="button" class="p-earn-day${sel ? ' is-sel' : ''}${d === today ? ' is-today' : ''}${n === 0 ? ' is-empty' : ''}" data-day="${d}" aria-pressed="${sel}" aria-label="${esc(dt(d, { weekday: 'long', month: 'short', day: 'numeric' }))}, ${label}${d === today ? ', today' : ''}">
          <span>${esc(dt(d, { weekday: 'short' }))}${d === today ? '<i class="p-earn-today-dot" aria-hidden="true"></i>' : ''}</span><b>${esc(dt(d, { month: 'short', day: 'numeric' }))}</b><em>${label}</em></button>`;
      }).join('');
      const selectedDay = $('.p-earn-strip .is-sel');
      if (selectedDay) $('.p-earn-strip').scrollLeft = Math.max(0, selectedDay.offsetLeft - $('.p-earn-strip').offsetLeft - $('.p-earn-strip').clientWidth / 2 + selectedDay.offsetWidth / 2);
      const foot = $('.p-earn-foot');
      if (error && !data) { body.innerHTML = ui.error(errMsg(error)); foot.textContent = ''; $('.p-earn-count').textContent = ''; return; }
      if (!data) { body.innerHTML = ui.loading('Loading earnings calendar…'); foot.textContent = ''; $('.p-earn-count').textContent = ''; return; }
      const visible = st.day ? filtered.filter(r => r.date === st.day) : filtered;
      $('.p-earn-count').textContent = `${visible.length} report${visible.length === 1 ? '' : 's'}${st.day ? ' on selected day' : ' this week'} · ${filtered.length} match this week`;
      foot.innerHTML = `Source: ${esc(data.sources.join(' + '))} (consensus via Zacks; dates may be estimated) · ${esc(fmt.time(data.as_of))}` +
        (data.errors.length ? ` · <span class="s-down">${data.errors.length} day(s) unavailable</span>` : '');
      if (st.watch && !readWatchlist().length) { body.innerHTML = ui.empty('Your watchlist is empty. Add companies in Ultimater to use this filter.'); return; }
      const sections = (st.day ? [st.day] : Array.from({ length: 7 }, (_, i) => addDays(from, i))).map(d => {
        const list = filtered.filter(r => r.date === d);
        const failed = data.days.find(x => x.date === d)?.unavailable;
        return `<section class="p-earn-sec" data-sec="${d}"><h3 class="p-earn-dayhead${d === st.day ? ' is-sel' : ''}">${esc(dt(d, { weekday: 'long', month: 'long', day: 'numeric' }))}<span class="s-muted">${list.length ? list.length + ' reporting' : ''}</span></h3>
          ${failed ? ui.error('This day could not be loaded.') : list.length ? `<table class="s-table p-earn-table" aria-label="${esc(dt(d, { weekday: 'long', month: 'short', day: 'numeric' }))} earnings reports">${head()}<tbody>${sorted(list).map(row).join('')}</tbody></table>` : `<p class="p-earn-none s-muted">${data.rows.some(r => r.date === d) ? 'No reports match these filters.' : 'No earnings reports scheduled for this day.'}</p>`}
        </section>`;
      }).join('');
      body.innerHTML = sections;
    }
    function scrollToDay(d) { const s = body.querySelector(`[data-sec="${d}"]`); if (s) body.scrollTop = s.offsetTop - body.offsetTop; }

    function jump(kind) {
      syncToday();
      const tw = weekStart(today);
      if (kind === 'today') save({ week: null, day: today });
      if (kind === 'this') save({ week: null, day: null });
      if (kind === 'next') save({ week: addDays(tw, 7), day: null });
      load().then(() => (st.day ? scrollToDay(st.day) : (body.scrollTop = 0)));
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('button,tr[data-symbol],a'); if (!t || t.tagName === 'A') return;
      if (t.dataset.step) { const w = addDays(wk(), +t.dataset.step); save({ week: w === weekStart(today) ? null : w, day: null }); expanded = null; load().then(() => { body.scrollTop = 0; }); return; }
      if (t.dataset.jump) return jump(t.dataset.jump);
      if (t.dataset.day) { const day = t.dataset.day, keepFocus = document.activeElement === t; save({ day }); render(); scrollToDay(day); if (keepFocus) $(`[data-day="${day}"]`).focus({ preventScroll: true }); return; }
      if (t.hasAttribute('data-watch')) { save({ watch: !st.watch }); return render(); }
      if (t.hasAttribute('data-columns')) { save({ allColumns: !st.allColumns }); return render(); }
      if (t.dataset.sort) { const k = t.dataset.sort; save({ sort: { key: k, dir: st.sort.key === k && st.sort.dir === 'desc' ? 'asc' : st.sort.key === k ? 'desc' : (COLS.find(c => c[0] === k)[2] ? 'desc' : 'asc') } }); return render(); }
      if (t.hasAttribute('data-retry')) { cache.delete(wk()); return load(); }
      if (t.dataset.addDetail) { ctx.openSymbol(t.dataset.addDetail); bus.emit('earnings:open-detail', { symbol: t.dataset.addDetail, group: ctx.group }); return; }
      if (t.dataset.ask) {
        const r = data?.rows.find(x => x.symbol + '|' + x.date === t.dataset.ask); if (!r) return;
        bus.emit('ai:ask', { prompt: `Give me earnings insights for ${r.symbol} (${r.company || ''}) reporting ${r.date}.`, context: rowContext(r), panelType: 'earnings-calendar' }); return;
      }
      if (t.dataset.exp) { e.stopPropagation(); const id = t.dataset.exp, keepFocus = document.activeElement === t; expanded = expanded === id ? null : id; render(); if (keepFocus) [...el.querySelectorAll('[data-exp]')].find(b => b.dataset.exp === id)?.focus({ preventScroll: true }); return; }
      if (t.dataset.selectSymbol) { const sym = t.dataset.selectSymbol, keepFocus = document.activeElement === t; ctx.openSymbol(sym); expanded = t.dataset.selectRow; render(); if (keepFocus) [...el.querySelectorAll('[data-select-symbol]')].find(b => b.dataset.selectSymbol === sym)?.focus({ preventScroll: true }); return; }
      if (t.dataset.symbol && t.dataset.row) { ctx.openSymbol(t.dataset.symbol); expanded = t.dataset.row; render(); }
    });
    el.addEventListener('keydown', e => {
      const tr = e.target.closest?.('tr[data-symbol]');
      if (tr && (e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); tr.click(); }
    });
    $('[type=date]').addEventListener('change', e => { const v = e.target.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return; const w = weekStart(v); save({ week: w === weekStart(today) ? null : w, day: v }); load().then(() => scrollToDay(v)); });
    $('[data-cap]').addEventListener('change', e => { save({ cap: e.target.value }); render(); });
    $('[data-time]').addEventListener('change', e => { save({ time: e.target.value }); render(); });
    let qt; $('[data-q]').addEventListener('input', e => { clearTimeout(qt); qt = setTimeout(() => { save({ q: e.target.value }); render(); }, 150); });
    const rowContext = r => `${r.symbol} ${r.company || ''}: reports ${r.date} ${TIME_LABEL[r.time] || '(time not supplied)'}; fiscal quarter ${r.fiscalQuarter || '—'}; consensus EPS ${eps(r.epsEstimate)} (${r.estimates ?? '—'} estimates); actual ${eps(r.epsActual)}; surprise ${Number.isFinite(r.surprisePct) ? fmt.pct(r.surprisePct) : '—'}; revenue est ${usd(r.revenueEstimate)}, actual ${usd(r.revenueActual)}; market cap ${usd(r.marketCap)}; last year EPS ${eps(r.lastYearEPS)}. Source: ${r.sources.join(' + ')}.`;
    const poll = earningsRefresh(el, fetchData);
    load().then(() => st.day && scrollToDay(st.day));
    return {
      csv() { const r = sorted(rows().filter(r => !st.day || r.date === st.day)); return r.length ? toCSV(r.map(x => ({ ...x, sources: x.sources.join(' + ') })), ['date', 'time', 'symbol', 'company', 'epsEstimate', 'epsActual', 'surprisePct', 'revenueEstimate', 'revenueActual', 'marketCap', 'fiscalQuarter', 'estimates', 'lastYearDate', 'lastYearEPS', 'sources']) : null; },
      scoutContext() {
        const list = rows(); const day = st.day ? list.filter(r => r.date === st.day) : list;
        const top = [...day].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, 25);
        return `Earnings calendar ${wk()} to ${addDays(wk(), 6)}${st.day ? `, focus ${st.day}` : ''} (${data?.sources.join(' + ') || 'not loaded'}). ${day.length} reports in the selected range after filters. Largest:\n` + top.map(rowContext).join('\n');
      },
      destroy() { poll.destroy(); clearTimeout(qt); ctrl?.abort(); }
    };
  }
});

// ---------------------------------------------------------------------------
// SVG helpers (no libraries). Width comes from the container so text stays crisp.
function epsChart(points, w, h = 190) {
  const pad = { l: 40, r: 12, t: 14, b: 44 };
  const vals = points.flatMap(p => [p.estimate, p.actual]).filter(Number.isFinite);
  if (!vals.length) return '';
  let lo = Math.min(0, ...vals), hi = Math.max(...vals); if (hi === lo) hi = lo + 1;
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.12;
  const x = i => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : i * (w - pad.l - pad.r) / (points.length - 1));
  const y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  const ticks = Array.from({ length: 4 }, (_, i) => lo + (hi - lo) * i / 3);
  let s = `<svg class="p-earn-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="EPS estimate versus actual by quarter">`;
  s += ticks.map(t => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" class="p-earn-grid"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" class="p-earn-ax">${fmt.num(t, 2)}</text>`).join('');
  if (lo < 0) s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" class="p-earn-zero"/>`;
  points.forEach((p, i) => {
    const cx = x(i);
    if (Number.isFinite(p.estimate)) s += `<circle cx="${cx}" cy="${y(p.estimate)}" r="6" class="p-earn-est${p.upcoming ? ' is-up' : ''}"><title>${esc(p.period)} estimate ${fmt.num(p.estimate, 2)}</title></circle>`;
    if (Number.isFinite(p.actual)) s += `<circle cx="${cx}" cy="${y(p.actual)}" r="6" class="p-earn-act ${p.actual >= (p.estimate ?? -Infinity) ? 'is-beat' : 'is-miss'}"><title>${esc(p.period)} actual ${fmt.num(p.actual, 2)}</title></circle>`;
    s += `<text x="${cx}" y="${h - pad.b + 16}" text-anchor="middle" class="p-earn-ax">${esc(p.period.replace(/ (\d\d)(\d\d)$/, " '$2"))}</text>`;
    const sub = Number.isFinite(p.surprisePct) ? fmt.pct(p.surprisePct, 1) : p.upcoming ? 'Est.' : '';
    if (sub) s += `<text x="${cx}" y="${h - pad.b + 31}" text-anchor="middle" class="p-earn-ax ${Number.isFinite(p.surprisePct) ? (p.surprisePct >= 0 ? 'p-earn-upt' : 'p-earn-dnt') : ''}">${esc(sub)}</text>`;
  });
  return s + '</svg>';
}
function finChart(rows, w, h = 200) {
  const pad = { l: 52, r: 10, t: 12, b: 28 };
  const vals = rows.flatMap(r => [r.revenue, r.netIncome]).filter(Number.isFinite);
  if (!vals.length) return '';
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); if (hi === lo) hi = lo + 1;
  const y = v => pad.t + (hi - v) / (hi - lo) * (h - pad.t - pad.b);
  const gw = (w - pad.l - pad.r) / rows.length, bw = Math.max(4, Math.min(28, gw * 0.32));
  let s = `<svg class="p-earn-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Revenue and net income by period">`;
  s += Array.from({ length: 4 }, (_, i) => lo + (hi - lo) * i / 3).map(t => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t)}" y2="${y(t)}" class="p-earn-grid"/><text x="${pad.l - 6}" y="${y(t) + 4}" text-anchor="end" class="p-earn-ax">${esc('$' + fmt.compact(t))}</text>`).join('');
  s += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(0)}" y2="${y(0)}" class="p-earn-zero"/>`;
  rows.forEach((r, i) => {
    const cx = pad.l + gw * i + gw / 2;
    const bar = (v, dx, cls, lab) => Number.isFinite(v) ? `<rect x="${cx + dx}" y="${Math.min(y(v), y(0))}" width="${bw}" height="${Math.max(1, Math.abs(y(v) - y(0)))}" rx="2" class="${cls}"><title>${esc(r.period)} ${lab} $${fmt.compact(v)}</title></rect>` : '';
    s += bar(r.revenue, -bw - 1, 'p-earn-rev', 'revenue') + bar(r.netIncome, 1, r.netIncome >= 0 ? 'p-earn-ni' : 'p-earn-ni is-neg', 'net income');
    s += `<text x="${cx}" y="${h - 9}" text-anchor="middle" class="p-earn-ax">${esc(r.label)}</text>`;
  });
  return s + '</svg>';
}

registerPanel('earnings-detail', {
  title: 'Earnings', category: 'Earnings', defaultSize: { w: 4, h: 14 }, symbolLinked: true,
  mount(el, ctx) {
    const variantTab = { revenue: 'fin', eps: 'eps', insights: 'estimates' };
    let st = { tab: variantTab[ctx.variant] || 'overview', freq: 'quarterly', est: 'eps', horizon: 'all', history: '8', ...ctx.state };
    let data = null, error = null, ctrl = null;
    const save = p => { st = { ...st, ...p }; ctx.setState(st); };
    const TABS = [['overview', 'Overview'], ['eps', 'Earnings per share'], ['fin', 'Revenue vs. earnings'], ['estimates', 'Earnings insights'], ['related', 'Related']];
    const panelId = `earnings-detail-${++earningsInstance}`;
    el.innerHTML = `<div class="p-earn p-earnd"><div class="p-earnd-sharebar"><button type="button" class="s-btn s-btn-sm s-btn-ghost" data-earnings-share>Share earnings</button></div><div class="s-tabs p-earnd-tabs" role="tablist" aria-label="Company earnings analysis">${TABS.map(([k, l]) => `<button type="button" class="s-tab" role="tab" id="${panelId}-${k}" aria-controls="${panelId}-body" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="p-earnd-body s-scroll" id="${panelId}-body" role="tabpanel" tabindex="0"></div><div class="p-earn-foot s-muted"></div></div>`;
    const body = el.querySelector('.p-earnd-body'), foot = el.querySelector('.p-earn-foot');
    const width = () => Math.max(240, body.clientWidth - 40);

    function load(options) { return poll.load(options); }
    async function fetchData({ silent = false, signal } = {}) {
      const sym = ctx.symbol;
      ctrl?.abort(); ctrl = new AbortController();
      const request = ctrl;
      signal?.addEventListener('abort', () => request.abort(), { once: true });
      if (!silent) data = null;
      error = null;
      ctx.setTitle(sym ? `${sym} Earnings` : 'Earnings');
      if (!sym) { render(); return; }
      if (!silent) render();
      try { const d = await ctx.api('earnings/detail', { symbol: sym }, { signal: ctrl.signal }); if (!request.signal.aborted && sym === ctx.symbol) data = d; }
      catch (e) { if (request.signal.aborted || e.name === 'AbortError') throw e; error = e; if (silent) throw e; render(); throw e; }
      if (request.signal.aborted || sym !== ctx.symbol) return;
      const scroll = body.scrollTop;
      render();
      if (silent) body.scrollTop = scroll;
    }
    const nextCard = n => {
      if (!n) return `<div class="p-earnd-card"><div class="p-earnd-k">Next earnings</div><div class="p-earnd-big s-muted">Not announced</div><p class="s-muted">No upcoming date is listed by the source yet.</p></div>`;
      const days = Math.round((Date.parse(n.date + 'T12:00:00Z') - Date.parse(nyToday() + 'T12:00:00Z')) / DAY);
      return `<div class="p-earnd-card p-earnd-next"><div class="p-earnd-k">Next earnings ${n.estimated ? '<span class="s-badge s-badge-warn" title="Projected by Zacks; not confirmed by the company">Estimated</span>' : ''}</div>
        <div class="p-earnd-big">${esc(dt(n.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</div>
        <div class="p-earnd-sub">${timeIcon(n.time)} ${esc(TIME_LABEL[n.time] || 'Time not supplied')} · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 0 ? `${Math.abs(days)} days ago` : `in ${days} days`}</div>
        <dl class="p-earnd-dl"><div><dt>Fiscal quarter</dt><dd>${esc(n.fiscalQuarter || '—')}</dd></div><div><dt>Consensus EPS</dt><dd>${eps(n.epsEstimate)}</dd></div>
        <div><dt>Analysts</dt><dd>${n.estimates ?? '—'}</dd></div><div><dt>Year-ago EPS</dt><dd>${eps(n.lastYearEPS)}</dd></div>
        ${n.revenueEstimate != null ? `<div><dt>Revenue est.</dt><dd>${usd(n.revenueEstimate)}</dd></div>` : ''}</dl></div>`;
    };
    const lastCard = () => {
      const last = [...(data.eps || [])].reverse().find(p => !p.upcoming && Number.isFinite(p.actual));
      if (!last) return '';
      return `<div class="p-earnd-card"><div class="p-earnd-k">Last reported · ${esc(last.period)}</div>
        <div class="p-earnd-big">${eps(last.actual)} <small class="s-muted">vs ${eps(last.estimate)} est.</small></div>
        <div class="p-earnd-sub">${Number.isFinite(last.surprisePct) ? `<span class="s-badge ${last.surprisePct >= 0 ? 's-badge-up' : 's-badge-down'}">${last.surprisePct >= 0 ? 'Beat' : 'Missed'} ${fmt.pct(last.surprisePct)}</span>` : ''} ${last.reported ? `Reported ${esc(fmt.date(last.reported + 'T12:00:00Z'))}` : ''}</div></div>`;
    };
    const epsBlock = full => {
      const pts = data.eps.slice(-Number(st.history || 8));
      if (!pts.length) return ui.empty('No EPS data available for this symbol.');
      return `<div class="p-earnd-row"><label>History <select class="s-select" data-history aria-label="EPS history length">${[4, 8, 12].map(v => `<option value="${v}" ${+st.history === v ? 'selected' : ''}>${v} quarters</option>`).join('')}</select></label></div><div class="p-earnd-legend"><span><i class="p-lg-est"></i>Estimate</span><span><i class="p-lg-beat"></i>Actual (beat)</span><span><i class="p-lg-miss"></i>Actual (miss)</span></div>
        <div class="p-earnd-chart" data-chart="eps">${epsChart(pts, Math.max(width(), pts.length * 56))}</div>` + (full ? `<table class="s-table"><thead><tr><th>Quarter</th><th>Reported</th><th class="s-num">Estimate</th><th class="s-num">Actual</th><th class="s-num">Surprise</th></tr></thead><tbody>
        ${[...pts].reverse().map(p => `<tr><td>${esc(p.period)}${p.upcoming ? ' <span class="s-badge">Upcoming</span>' : ''}</td><td>${p.reported ? esc(fmt.date(p.reported + 'T12:00:00Z')) : '—'}</td><td class="s-num">${eps(p.estimate)}</td><td class="s-num">${eps(p.actual)}</td><td class="s-num">${surprise(p.surprisePct)}</td></tr>`).join('')}</tbody></table>` : '');
    };
    const finRows = () => (data.financials[st.freq] || []).map(r => ({ ...r, label: st.freq === 'annual' ? r.period.slice(0, 4) : dt(r.period, { month: 'short', year: '2-digit' }) }));
    const finBlock = () => {
      const rows = finRows();
      return `<div class="p-earnd-row"><div class="s-seg" role="group" aria-label="Period"><button type="button" data-freq="annual" aria-pressed="${st.freq === 'annual'}">Annual</button><button type="button" data-freq="quarterly" aria-pressed="${st.freq === 'quarterly'}">Quarterly</button></div>
        <div class="p-earnd-legend"><span><i class="p-lg-rev"></i>Revenue</span><span><i class="p-lg-ni"></i>Net income</span></div></div>` +
        (rows.length ? `<div class="p-earnd-chart" data-chart="fin">${finChart(rows, width())}</div><table class="s-table"><thead><tr><th>Period ending</th><th class="s-num">Revenue</th><th class="s-num">Net income</th><th class="s-num">Net margin</th></tr></thead><tbody>
          ${[...rows].reverse().map(r => `<tr><td>${esc(fmt.date(r.period + 'T12:00:00Z'))}</td><td class="s-num">${usd(r.revenue)}</td><td class="s-num ${fmt.dir(r.netIncome)}">${usd(r.netIncome)}</td><td class="s-num">${Number.isFinite(r.revenue) && Number.isFinite(r.netIncome) && r.revenue ? fmt.pct(r.netIncome / r.revenue * 100, 1).replace('+', '') : '—'}</td></tr>`).join('')}</tbody></table>
          <p class="s-muted p-earnd-note">Income statement as reported to Nasdaq (values in USD).</p>` : ui.empty('No revenue and earnings data available for this symbol.'));
    };
    const estBlock = () => {
      const f = data.forecast, m = data.momentum, n = data.next;
      const tabs = `<div class="p-earnd-row"><label>Forecast periods <select class="s-select" data-horizon aria-label="Forecast periods">${[['all','Quarterly + annual'],['quarterly','Quarterly'],['annual','Annual']].map(([v,label]) => `<option value="${v}" ${st.horizon === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="s-tabs p-earnd-sub-tabs" role="tablist"><button type="button" class="s-tab" role="tab" data-est="eps" aria-selected="${st.est === 'eps'}">Earnings Estimate</button><button type="button" class="s-tab" role="tab" data-est="rev" aria-selected="${st.est === 'rev'}">Revenue Estimate</button></div>`;
      if (st.est === 'rev') {
        if (st.horizon === 'annual') return tabs + ui.unavailable('Annual revenue estimates', 'The current providers publish only the upcoming quarter revenue estimate through the earnings calendar. Annual revenue consensus and ranges are unavailable.');
        return tabs + (n?.revenueEstimate != null
          ? `<table class="s-table"><thead><tr><th></th><th class="s-num">Current qtr (${esc(n.fiscalQuarter || n.date)})</th></tr></thead><tbody><tr><td>Avg. revenue estimate</td><td class="s-num">${usd(n.revenueEstimate)}</td></tr></tbody></table><p class="s-muted p-earnd-note">Source: Finnhub earnings calendar.</p>`
          : ui.unavailable('Revenue estimates', 'Analyst revenue estimates come from the Finnhub earnings calendar, which has no estimate for this symbol or is not configured on this server. Free sources do not publish low/high revenue ranges.'));
      }
      if (!f) return tabs + ui.empty('No analyst estimates available for this symbol.');
      const cols = [...(st.horizon !== 'annual' ? [['Current Qtr.', f.quarterly[0]], ['Next Qtr.', f.quarterly[1]]] : []), ...(st.horizon !== 'quarterly' ? [['Current Year', f.yearly[0]], ['Next Year', f.yearly[1]]] : [])];
      const cell = (fn, num = true) => cols.map(([, c], i) => `<td class="${num ? 's-num' : ''}">${c ? fn(c, i) : '—'}</td>`).join('');
      const trend = key => cols.map(([, c], i) => `<td class="s-num">${!c ? '—' : c === f.quarterly[0] && m?.quarter ? eps(m.quarter[key]) : c === f.yearly[0] && m?.year ? eps(m.year[key]) : '—'}</td>`).join('');
      return tabs + `<div class="p-earnd-tablewrap"><table class="s-table p-earnd-est"><thead><tr><th>Forecast</th>${cols.map(([l, c]) => `<th class="s-num">${esc(l)}${c ? `<br><small>(${esc(c.fiscalEnd)})</small>` : ''}</th>`).join('')}</tr></thead><tbody>
        <tr><td>No. of Analysts</td>${cell(c => c.analysts ?? '—')}</tr>
        <tr><td>Avg. Estimate</td>${cell(c => eps(c.avg))}</tr>
        <tr><td>Low Estimate</td>${cell(c => eps(c.low))}</tr>
        <tr><td>High Estimate</td>${cell(c => eps(c.high))}</tr>
        <tr class="p-earnd-grp"><td colspan="${cols.length + 1}">Year over Year</td></tr>
        <tr><td>Year Ago EPS</td>${cell((c, i) => c === f.quarterly[0] && n && n.fiscalQuarter === c.fiscalEnd ? eps(n.lastYearEPS) : '—')}</tr>
        <tr class="p-earnd-grp"><td colspan="${cols.length + 1}">Estimate Trend</td></tr>
        <tr><td>Current Estimate</td>${trend('current')}</tr>
        <tr><td>1 Week Ago</td>${trend('weekAgo')}</tr>
        <tr><td>1 Month Ago</td>${trend('monthAgo')}</tr>
        <tr class="p-earnd-grp"><td colspan="${cols.length + 1}">Revisions (last 4 weeks)</td></tr>
        <tr><td>Up</td>${cell(c => c.up ?? '—')}</tr>
        <tr><td>Down</td>${cell(c => c.down ?? '—')}</tr>
      </tbody></table></div><p class="s-muted p-earnd-note">Consensus via Zacks (Nasdaq). Trend history beyond one month is not published by this source.</p>`;
    };
    const relBlock = () => data.related.length ? `<ul class="p-earnd-rel">${data.related.map(r => `<li>
        <button type="button" class="s-chip" data-sym="${esc(r.symbol)}">${esc(r.symbol)}</button>
        <div><div class="p-earnd-k">${esc(r.links.map(l => l.kind).join(' · '))} · ${r.next ? `reports ${esc(dt(r.next.date, { month: 'short', day: 'numeric' }))}${r.next.time ? ' ' + esc(r.next.time) : ''}` : 'next date not listed'}</div>
        ${r.links.map(l => `<p>${esc(l.detail)} <a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a></p>`).join('')}</div></li>`).join('')}</ul>
      <p class="s-muted p-earnd-note">Relationships from the app's curated earnings links (and Finnhub peers when configured). Context, not verified exposure.</p>`
      : ui.empty('No related-company earnings links for this symbol.');

    function render() {
      el.querySelectorAll('[data-tab]').forEach(b => { const selected = b.dataset.tab === st.tab; b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1; });
      body.setAttribute('aria-labelledby', `${panelId}-${st.tab}`);
      if (!ctx.symbol) { body.innerHTML = ui.empty('Link a symbol to see its earnings.'); foot.textContent = ''; return; }
      if (error && !data) { body.innerHTML = ui.error(errMsg(error)); foot.textContent = ''; return; }
      if (!data) { body.innerHTML = ui.loading(`Loading ${ctx.symbol} earnings…`); foot.textContent = ''; return; }
      const t = st.tab;
      body.innerHTML = t === 'overview' ? `<div class="p-earnd-cards">${nextCard(data.next)}${lastCard()}</div>${epsBlock(false)}`
        : t === 'eps' ? epsBlock(true) : t === 'fin' ? finBlock() : t === 'estimates' ? estBlock() : relBlock();
      foot.innerHTML = `Source: ${esc(data.sources.join(' + '))} · <a href="${esc(data.links.nasdaq)}" target="_blank" rel="noopener noreferrer">Nasdaq earnings ↗</a>${data.errors.length ? ` · <span title="${esc(data.errors.map(e => e.part + ': ' + e.code).join('; '))}">some parts unavailable</span>` : ''}`;
    }
    function redraw() {
      if (!data) return;
      const c = body.querySelector('[data-chart]'); if (!c) return;
      const pts = data.eps.slice(-Number(st.history || 8));
      c.innerHTML = c.dataset.chart === 'eps' ? epsChart(pts, Math.max(width(), pts.length * 56)) : finChart(finRows(), width());
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.hasAttribute('data-earnings-share')) { bus.emit('panel:share', { id: ctx.id }); return; }
      if (t.dataset.tab) { save({ tab: t.dataset.tab }); return render(); }
      if (t.dataset.freq) { save({ freq: t.dataset.freq }); return render(); }
      if (t.dataset.est) { save({ est: t.dataset.est }); return render(); }
      if (t.dataset.sym) return ctx.openSymbol(t.dataset.sym);
      if (t.hasAttribute('data-retry')) return load();
    });
    el.addEventListener('change', e => { if (e.target.hasAttribute('data-horizon')) { save({ horizon: e.target.value }); render(); } if (e.target.hasAttribute('data-history')) { save({ history: e.target.value }); render(); } });
    el.addEventListener('keydown', e => {
      if (!e.target.matches('[data-tab]') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const tabs = [...el.querySelectorAll('[data-tab]')], i = tabs.indexOf(e.target);
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].click(); tabs[next].focus();
    });
    let raf = 0, lastW = 0;
    const ro = new ResizeObserver(() => { const w = body.clientWidth; if (Math.abs(w - lastW) < 8) return; lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); });
    ro.observe(body);
    const poll = earningsRefresh(el, fetchData);
    load();
    return {
      onSymbol() { load(); },
      onVariant(id) { if (variantTab[id]) { save({ tab: variantTab[id] }); render(); } },
      shareImage() {
        if (!data) return null;
        const revenue = st.tab === 'fin', points = data.eps.slice(-Number(st.history || 8));
        const chart = revenue ? finChart(finRows(), 1120, 330) : epsChart(points, 1120, 330);
        if (!chart) return null;
        const style = getComputedStyle(el);
        const tokens = ['bg','panel','text','muted','faint','border','border-strong','accent','up','down','warn'];
        const colors = tokens.map(k => `--s-${k}:${style.getPropertyValue('--s-' + k).trim()}`).join(';');
        const title = `${data.symbol} · ${revenue ? 'Revenue and net income' : 'Earnings per share'}`;
        return { width: 1200, height: 560, name: `${data.symbol}-earnings`, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="560" viewBox="0 0 1200 560" style="${esc(colors)};font-family:Arial,sans-serif"><style>.p-earn-grid{stroke:var(--s-border);stroke-width:1;stroke-dasharray:3 4}.p-earn-zero{stroke:var(--s-border-strong);stroke-width:1}.p-earn-ax{fill:var(--s-muted);font:12px Arial,sans-serif}.p-earn-est{fill:var(--s-panel);stroke:var(--s-accent);stroke-width:2}.p-earn-act.is-beat,.p-earn-ni{fill:var(--s-up)}.p-earn-act.is-miss,.p-earn-ni.is-neg{fill:var(--s-down)}.p-earn-act{stroke:var(--s-panel);stroke-width:1}.p-earn-rev{fill:var(--s-accent)}</style><rect width="1200" height="560" fill="var(--s-panel)"/><text x="40" y="52" fill="var(--s-accent)" font-size="18">Ultimater</text><text x="40" y="94" fill="var(--s-text)" font-size="28" font-weight="700">${esc(title)}</text><svg x="40" y="125" width="1120" height="330" viewBox="0 0 1120 330" preserveAspectRatio="xMidYMid meet">${chart}</svg><text x="40" y="490" fill="var(--s-muted)" font-size="14">${revenue ? 'Revenue and net income · USD · ' + st.freq : 'Estimate vs. actual · EPS · USD'}</text><text x="40" y="520" fill="var(--s-muted)" font-size="12">Source: ${esc((data.sources || []).join(' / '))} · Snapshot ${esc(new Date().toISOString())}</text><text x="40" y="543" fill="var(--s-muted)" font-size="11">Reported data and estimates may be incomplete. Not investment advice.</text></svg>` };
      },
      csv() { return data?.eps.length ? toCSV(data.eps.map(p => ({ symbol: data.symbol, quarter: p.period, reported: p.reported || '', estimate: p.estimate ?? '', actual: p.actual ?? '', surprisePct: p.surprisePct ?? '', upcoming: p.upcoming }))) : null; },
      scoutContext() {
        if (!data) return `${ctx.symbol || 'No symbol'} earnings: not loaded.`;
        const n = data.next;
        return `${data.symbol} earnings (${data.sources.join(' + ')}). Next: ${n ? `${n.date} ${TIME_LABEL[n.time] || ''}, quarter ${n.fiscalQuarter || '—'}, consensus EPS ${eps(n.epsEstimate)} from ${n.estimates ?? '—'} analysts, year-ago ${eps(n.lastYearEPS)}${n.estimated ? ' (estimated date)' : ''}` : 'not announced'}.\nEPS history: ` +
          data.eps.map(p => `${p.period}: est ${eps(p.estimate)}${p.upcoming ? '' : `, actual ${eps(p.actual)}, surprise ${Number.isFinite(p.surprisePct) ? fmt.pct(p.surprisePct) : '—'}`}`).join('; ') +
          (data.financials.quarterly.length ? `\nQuarterly revenue: ${data.financials.quarterly.map(r => `${r.period} $${fmt.compact(r.revenue)} (NI $${fmt.compact(r.netIncome)})`).join('; ')}` : '') +
          (data.related.length ? `\nRelated reporters: ${data.related.map(r => `${r.symbol} (${r.links[0]?.kind}${r.next ? ', ' + r.next.date : ''})`).join(', ')}` : '');
      },
      destroy() { poll.destroy(); ctrl?.abort(); ro.disconnect(); cancelAnimationFrame(raf); }
    };
  }
});

// ---------------------------------------------------------------------------
registerPanel('economic-calendar', {
  title: 'Economic Calendar', category: 'Earnings', defaultSize: { w: 4, h: 12 },
  mount(el, ctx) {
    let st = { kind: 'all', past: false, ...ctx.state };
    let data = null, error = null, ctrl = null;
    const save = p => { st = { ...st, ...p }; ctx.setState(st); };
    const today = nyToday;
    el.innerHTML = `<div class="p-earn p-econ"><div class="p-earn-filters">
        <div class="s-seg" role="group" aria-label="Event type"><button type="button" data-kind="all">All</button><button type="button" data-kind="inflation">Inflation (CPI)</button><button type="button" data-kind="rates">Fed</button></div>
        <button type="button" class="s-chip" data-past aria-pressed="false">Show past</button></div>
      <div class="p-econ-body s-scroll"></div><div class="p-earn-foot s-muted"></div></div>`;
    const body = el.querySelector('.p-econ-body'), foot = el.querySelector('.p-earn-foot');
    function load(options) { return poll.load(options); }
    async function fetchData({ silent = false, signal } = {}) {
      ctrl?.abort(); ctrl = new AbortController();
      const request = ctrl;
      signal?.addEventListener('abort', () => request.abort(), { once: true });
      error = null; if (!silent) body.innerHTML = ui.loading('Loading economic calendar…');
      try { const d = await ctx.api('earnings/economic', { from: addDays(today(), -45), to: addDays(today(), 180) }, { signal: request.signal }); if (!request.signal.aborted) data = d; }
      catch (e) { if (request.signal.aborted || e.name === 'AbortError') throw e; error = e; if (silent) throw e; render(); throw e; }
      if (request.signal.aborted) return;
      const scroll = body.scrollTop;
      render();
      if (silent) body.scrollTop = scroll;
    }
    const events = () => (data?.events || []).filter(e => (st.kind === 'all' || e.kind === st.kind) && (st.past || e.date >= today()));
    function render() {
      el.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === st.kind)));
      el.querySelector('[data-past]').setAttribute('aria-pressed', String(!!st.past));
      if (error && !data) { body.innerHTML = ui.error(errMsg(error)); foot.textContent = ''; return; }
      if (!data) return;
      const list = events();
      foot.textContent = data.coverage;
      if (!list.length) { body.innerHTML = ui.empty('No scheduled events in this range.'); return; }
      let month = '';
      body.innerHTML = list.map(e => {
        const m = dt(e.date, { month: 'long', year: 'numeric' });
        const hdr = m !== month ? `<h3 class="p-earn-dayhead">${esc((month = m))}</h3>` : '';
        const past = e.date < today();
        return hdr + `<article class="p-econ-ev${past ? ' is-past' : ''}${e.date === today() ? ' is-today' : ''}">
          <div class="p-econ-date"><span>${esc(dt(e.date, { weekday: 'short' }))}</span><b>${esc(dt(e.date, { day: 'numeric' }))}</b><span>${esc(dt(e.date, { month: 'short' }))}</span></div>
          <div class="p-econ-txt"><div class="p-earnd-k"><span class="s-badge ${e.kind === 'inflation' ? 's-badge-warn' : 's-badge-accent'}">${e.kind === 'inflation' ? 'Inflation' : e.kind === 'rates' ? 'Fed' : 'Macro'}</span> ${esc(e.timing || 'Time not listed')} · ${esc(past ? 'Released' : e.status)}</div>
          <h4>${esc(e.title)}</h4><p>${esc(e.detail)}</p><a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.source)} ↗</a></div></article>`;
      }).join('');
      const next = body.querySelector('.is-today, .p-econ-ev:not(.is-past)');
      if (next) body.scrollTop = Math.max(0, next.offsetTop - body.offsetTop);
    }
    el.addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.kind) { save({ kind: t.dataset.kind }); return render(); }
      if (t.hasAttribute('data-past')) { save({ past: !st.past }); return render(); }
      if (t.hasAttribute('data-retry')) return load();
    });
    const poll = earningsRefresh(el, fetchData, 900000);
    load();
    return {
      csv() { const l = events(); return l.length ? toCSV(l, ['date', 'title', 'kind', 'timing', 'status', 'source', 'url']) : null; },
      scoutContext() { return `Economic calendar (${data?.coverage || 'not loaded'}):\n` + events().map(e => `- ${e.date} ${e.title} ${e.timing || ''} (${e.source})`).join('\n'); },
      destroy() { poll.destroy(); ctrl?.abort(); }
    };
  }
});

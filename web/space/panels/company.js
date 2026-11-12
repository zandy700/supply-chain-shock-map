// Company research panels. Sources and missing fields are reported by the company API.
import { registerPanel, api, esc, fmt, toCSV, state as ui } from '../core.js';
import { createLiveRefresh } from '../live-refresh.js';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const n = (v, unit = '') => !finite(v) ? '—' : unit === 'integer' ? fmt.num(v, 0) : unit === 'compact' ? fmt.compact(v) : unit === 'usd' ? '$' + fmt.compact(v) : unit === 'percent' ? fmt.num(v) + '%' : unit === 'multiple' ? fmt.num(v) + '×' : fmt.num(v);
const price = v => finite(v) ? '$' + fmt.price(v) : '—';
const pct = v => finite(v) ? fmt.pct(v) : '—';
const text = v => esc(v ?? '—');
const safeURL = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
const notes = d => `<footer class="p-company-foot">${text(d.priceSource || d.source || d.sources?.join(' · ') || 'Company research')}${d.currency ? ` · ${text(d.currency)}` : ''}${(d.notes || []).map(s => `<p>${esc(s)}</p>`).join('')}${d.unavailable?.length ? `<details><summary>Data availability (${d.unavailable.length})</summary>${d.unavailable.map(x => `<p>${text(x.field)}: ${text(x.reason)}</p>`).join('')}</details>` : ''}</footer>`;
const facts = rows => `<dl class="p-company-facts">${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;
const tabs = (values, selected, key) => `<div class="s-tabs" role="tablist" aria-label="${esc(key)}">${values.map(([v, label]) => `<button type="button" class="s-tab" role="tab" aria-selected="${selected === v}" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</div>`;
const periodControl = st => `<select class="s-select" aria-label="Reporting frequency" data-key="period"><option value="annual" ${!['quarterly','ltm'].includes(st.period) ? 'selected' : ''}>Annual</option><option value="quarterly" ${st.period === 'quarterly' ? 'selected' : ''}>Quarterly</option>${['income','cashflow'].includes(st.statement) ? `<option value="ltm" ${st.period === 'ltm' ? 'selected' : ''}>LTM (rolling 12 months)</option>` : ''}</select>`;
const messages = { unknown_symbol: 'No company data was found for this symbol.', provider_unavailable: 'Company data is temporarily unavailable.', rate_limited: 'The provider rate limit was reached. Try again shortly.', financials_unavailable: 'Financial statements are not available for this symbol.', invalid_symbol: 'Choose a supported stock or ETF symbol.' };

// Each mount cancels superseded requests; symbol changes must never show a previous company's response.
function researchPanel(type, def) {
  registerPanel(type, { category: 'Company', symbolLinked: true, defaultSize: { w: 4, h: 12 }, ...def,
    mount(el, ctx) {
      let st = { period: 'annual', ...def.initial, ...ctx.state }, symbol = ctx.symbol || 'NVDA';
      let data = null, controller = null, dead = false, serial = 0, checkedAt = null, refreshError = null, liveState = null, loading = false;
      const refreshMs = type === 'quote' ? 30000 : type === 'peers' ? 60000 : ['profile','segments'].includes(type) ? 900000 : 300000;
      const editing = () => { const active = globalThis.document?.activeElement; return !!active && !!el.contains?.(active) && !!active.matches?.('input,select,textarea,[contenteditable=true]'); };
      const statusText = () => `${liveState?.status === 'offline' ? 'Offline; showing last successful data. ' : refreshError || liveState?.error || liveState?.status === 'stale' ? 'Update failed; showing last successful data. ' : liveState?.busy ? 'Updating… ' : ''}${checkedAt ? 'Checked ' + new Date(checkedAt).toLocaleTimeString() : 'Not checked yet'} · Auto ${refreshMs < 60000 ? refreshMs / 1000 + 's' : refreshMs / 60000 + ' min'} while visible`;
      el.classList.add('p-company');
      const paint = () => {
        if (!data || dead) return;
        const scroll = el.scrollTop, contentScroll = el.querySelector?.('.p-company-content')?.scrollTop || 0;
        const active = globalThis.document?.activeElement;
        const focus = el.contains?.(active) ? ['data-key','data-value','data-company-refresh'].map(k => active.hasAttribute?.(k) ? `[${k}=${JSON.stringify(active.getAttribute(k))}]` : '').join('') : '';
        el.innerHTML = (def.controls?.(st, data) || '') + `<div class="p-company-content">${def.render(data, st)}</div>` + notes(data) + `<div class="p-company-live"><span role="status" data-company-live>${esc(statusText())}</span><button type="button" class="s-btn s-btn-sm s-btn-ghost" data-company-refresh>Refresh</button></div>`;
        if (Number.isFinite(scroll)) el.scrollTop = scroll;
        const content = el.querySelector?.('.p-company-content'); if (content) content.scrollTop = contentScroll;
        if (focus) el.querySelector?.(focus)?.focus?.({preventScroll:true});
      };
      const updateStatus = () => { const node = el.querySelector?.('[data-company-live]'); if (node) { node.textContent = statusText(); node.classList.toggle('s-down', !!refreshError || !!liveState?.error || liveState?.status === 'stale'); } };
      async function load({ silent = false, signal } = {}) {
        const ticket = ++serial; loading = true;
        controller?.abort(); controller = new AbortController();
        const deadline = AbortSignal.timeout(45000);
        const requestSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : []), deadline]);
        requestSignal.addEventListener('abort', () => { if(ticket === serial) loading = false; }, {once:true});
        if (!silent) { data = null; refreshError = null; el.innerHTML = ui.loading(`Loading ${symbol}…`); }
        try {
          const d = await api(`company/${typeof def.route === 'function' ? def.route(st) : def.route}`, { symbol, ...def.params?.(st) }, { signal: requestSignal });
          if (dead || ticket !== serial || requestSignal.aborted) { if(signal) throw new DOMException('Aborted','AbortError'); return; }
          if (def.compare && st.compare) {
            const symbols = [...new Set(String(st.compare).toUpperCase().split(/[ ,]+/).filter(v => /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(v) && v !== symbol))].slice(0, 2);
            const results = await Promise.allSettled(symbols.map(symbol => api(`company/${typeof def.route === 'function' ? def.route(st) : def.route}`, { symbol, ...def.params?.(st) }, { signal: requestSignal })));
            if (dead || ticket !== serial || requestSignal.aborted) { if(signal) throw new DOMException('Aborted','AbortError'); return; }
            d.comparisons = results.map((r, i) => r.status === 'fulfilled' ? { ...r.value, symbol: symbols[i] } : { symbol: symbols[i], error: 'Comparison data unavailable.' });
          }
          data = d; checkedAt = Date.now(); refreshError = null; if (!signal) poll.recordSuccess(); ctx.setSubtitle?.(symbol); paint();
        } catch (e) {
          if (dead || ticket !== serial || (!deadline.aborted && (requestSignal.aborted || e.name === 'AbortError'))) { if(signal) throw new DOMException('Aborted','AbortError'); return; }
          if (deadline.aborted) e = new Error('Company data request timed out.');
          refreshError = e;
          if (data) updateStatus(); else el.innerHTML = ui.error(messages[e.message] || (deadline.aborted ? 'Company data request timed out. Automatic retry is enabled.' : 'Company data could not be loaded. Try again.'));
          if (silent) throw e;
        } finally { if(ticket === serial) loading = false; }
      }
      function click(e) {
        if (e.target.closest('[data-retry]') || e.target.closest('[data-company-refresh]')) { load({silent:!!data}).catch(()=>{}); return; }
        const metric = e.target.closest('[data-company-metric]');
        if (metric?.dataset?.companyMetric != null) {
          const expanded = new Set(st.expandedRows || []), key = metric.dataset.companyMetric;
          expanded.has(key) ? expanded.delete(key) : expanded.add(key);
          st.expandedRows = [...expanded]; ctx.setState(st); paint(); return;
        }
        const button = e.target.closest('[data-key][data-value]');
        if (button) { st[button.dataset.key] = button.dataset.value; if (button.dataset.key === 'statement' && st.period === 'ltm' && !['income','cashflow'].includes(st.statement)) st.period = 'quarterly'; ctx.setState(st); if (def.localControls || def.localKeys?.includes(button.dataset.key)) paint(); else load(); }
        const row = e.target.closest('[data-symbol]');
        if (row) ctx.openSymbol(row.dataset.symbol);
      }
      function change(e) { if (e.target.dataset.key) { st[e.target.dataset.key] = e.target.value; ctx.setState(st); if (def.localControls || def.localKeys?.includes(e.target.dataset.key)) paint(); else load(); } }
      function keydown(e) { const row = e.target.closest('[data-symbol]'); if (row && ['Enter', ' '].includes(e.key)) { e.preventDefault(); ctx.openSymbol(row.dataset.symbol); } }
      function submit(e) { if (e.target.matches?.('[data-company-compare]')) { e.preventDefault(); const input = e.target.elements.compare; st.compare = input.value; ctx.setState(st); load(); } }
      el.addEventListener('submit', submit);
      el.addEventListener('click', click); el.addEventListener('change', change); el.addEventListener('keydown', keydown);
      const poll = createLiveRefresh({el, interval:refreshMs, enabled:() => !loading && !editing(), refresh:signal => load({silent:true,signal}), onState:state=>{liveState=state;updateStatus();}});
      load();
      return {
        onSymbol(s) { symbol = s; load(); },
        onVariant(v) { if (def.variantKey) { st[def.variantKey] = v; ctx.setState(st); def.localControls ? paint() : load(); } },
        csv() { if (!data) return null; const rows = def.rows ? def.rows(data, st) : Object.entries(data).filter(([, v]) => v === null || typeof v !== 'object').map(([field, value]) => ({ field, value })); return rows?.length ? toCSV(rows) : null; },
        scoutContext() { return data ? `${type} for ${symbol}. Sources: ${data.sources?.join(', ') || data.source || 'Company API'}.\n${JSON.stringify(data).slice(0, 14000)}` : `${type} for ${symbol}: data unavailable.`; },
        destroy() { dead = true; poll.destroy(); controller?.abort(); el.removeEventListener('submit', submit); el.removeEventListener('click', click); el.removeEventListener('change', change); el.removeEventListener('keydown', keydown); }
      };
    }
  });
}

researchPanel('quote', {
  title: 'Quote', route: 'quote',
  render(d) {
    const metric = (key, label, unit) => [label, n(d[key], unit)];
    return `<div class="p-company-heading"><strong>${text(d.name)}</strong><span>${text(d.exchange)} · ${text(d.assetClass)} · ${d.delayed ? 'Delayed quote' : 'Nasdaq trades'}</span></div>
      <div class="p-company-price">${price(d.price)} <span class="${fmt.dir(d.changePercent)}">${finite(d.change) ? fmt.change(d.change) : '—'} (${pct(d.changePercent)})</span></div>
      <p class="p-company-caption">${d.regularClosed ? 'At close' : 'Latest regular-session trade'} · ${text(d.regularTime)}</p>
      ${d.extended ? `<div class="p-company-extended">${d.extended.session === 'pre' ? 'Pre-market' : 'After-hours'} <b>${price(d.extended.price)}</b> <span class="${fmt.dir(d.extended.changePercent)}">${pct(d.extended.changePercent)}</span><small>${text(d.extended.time)}</small></div>` : ''}
      ${facts([
        ['Previous close', price(d.previousClose)], ['Open' + (d.openDerived ? ' (derived)' : ''), price(d.open)],
        ['Bid / ask', `${price(d.bid)} / ${price(d.ask)}`], ['Bid / ask size', `${n(d.bidSize, 'integer')} / ${n(d.askSize, 'integer')}`], ['Day range', `${price(d.dayLow)} – ${price(d.dayHigh)}`],
        ['52-week range', `${price(d.yearLow)} – ${price(d.yearHigh)}`], metric('volume', 'Volume', 'compact'), metric('avgVolume', 'Avg. volume', 'compact'), metric('marketCap', 'Market cap', 'usd'),
        metric('pe', 'P/E (TTM)', 'multiple'), metric('eps', 'EPS (TTM)' + (d.epsDerived ? ' (derived)' : ''), 'usd'), metric('beta', 'Beta'),
        ['Dividend / yield', `${price(d.dividendRate)} / ${n(d.dividendYield, 'percent')}`], ['Earnings date', text(d.earningsDate)], ['Ex-dividend date', text(d.exDividendDate)],
        ['52-week return' + (d.week52Derived ? ' (derived)' : ''), pct(d.week52Change)], ['1-year target', price(d.targetMean)], ['Target low / high', `${price(d.targetLow)} / ${price(d.targetHigh)}`], ['S&P 500 proxy 52-week return', pct(d.sp500Change52)], ['Market session', text(d.marketStatus)], ...(d.etf ? [['ETF assets', n(d.etf.aum, 'usd')], ['Expense ratio', n(d.etf.expenseRatio, 'percent')]] : [])
      ])}`;
  }
});

const statements = [['metrics', 'Key Metrics'], ['income', 'Income Statement'], ['balance', 'Balance Sheet'], ['cashflow', 'Cash Flow'], ['operating', 'Operating Metrics'], ['valuation', 'Valuation Multiples'], ['segments', 'Segments']];
const metricsTabs = ['metrics', 'operating', 'valuation'];
function financialRows(d, st = {}) {
  if (!d.sections) return d.rows || [];
  const wanted = st.statement === 'operating' ? ['Operational', 'Profitability', 'Financial Health'] : st.statement === 'valuation' ? ['Valuation', 'Multiples', 'Dividend Yield'] : null;
  return d.sections.filter(s => !wanted || wanted.includes(s.section)).flatMap(s => [{ section: s.section }, ...s.rows]);
}
export function displayFinancial(v, unit, scale = 'auto') {
  if (!finite(v)) return '—';
  if (unit !== 'usd') return unit === 'perShare' ? price(v) : n(v, unit);
  if (scale === 'auto') return n(v, unit);
  const factors = { K: 1e3, MM: 1e6, B: 1e9 };
  return '$' + fmt.num(v / (factors[scale] || 1)) + (factors[scale] ? ' ' + scale : '');
}
export function financialColumns(d, order = 'newest') {
  const cols = (d.columns || []).map((c, i) => ({ ...c, index: i }));
  return cols.sort((a, b) => a.id === 'ttm' ? -1 : b.id === 'ttm' ? 1 : String(a.end || a.label).localeCompare(String(b.end || b.label)) * (order === 'oldest' ? 1 : -1));
}
export function financialGrowth(row, columns, column) {
  if (column.id === 'ttm' || !column.end) return null;
  const previous = columns.find(c => c.id !== 'ttm' && (Date.parse(column.end) - Date.parse(c.end)) / 86400000 >= 330 && (Date.parse(column.end) - Date.parse(c.end)) / 86400000 <= 400);
  const current = row?.values?.[column.index], prior = row?.values?.[previous?.index];
  return finite(current) && finite(prior) && prior !== 0 ? (current - prior) / Math.abs(prior) * 100 : null;
}
function renderFinancialRow(r, loaded, cols, st) {
  const key = r.key || r.label, open = (st.expandedRows || []).includes(key);
  const cells = (growth = false) => loaded.map((x, i) => {
    const cr = financialRows(x, st).find(v => r.key ? v.key === r.key : v.label === r.label);
    return cols[i].map(c => `<td class="s-num">${growth ? pct(financialGrowth(cr, cols[i], c)) : displayFinancial(cr?.values?.[c.index], r.unit, st.units)}</td>`).join('');
  }).join('');
  return `<tr><th scope="row" title="${text(r.tip || r.noteIfEmpty || '')}"><button type="button" class="p-company-metric-toggle" data-company-metric="${esc(key)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${text(r.label)} year-over-year change"><span aria-hidden="true">${open ? '▾' : '▸'}</span>${text(r.label)}${r.derived ? '*' : ''}</button></th>${cells()}</tr>${open ? `<tr class="p-company-yoy"><th scope="row">% Change YoY</th>${cells(true)}</tr>` : ''}`;
}
const unitsControl = st => `<select class="s-select" data-key="units" aria-label="Financial units">${['auto', 'K', 'MM', 'B'].map(v => `<option value="${v}" ${st.units === v ? 'selected' : ''}>${v === 'auto' ? 'Auto units' : v}</option>`).join('')}</select>`;
function segmentControls(st, d) {
  const selected = d.breakdowns?.[+st.breakdown] || d.breakdowns?.[0];
  return `${d.breakdowns?.length ? `<select class="s-select" data-key="breakdown" aria-label="Revenue breakdown">${d.breakdowns.map((b, i) => `<option value="${i}" ${+st.breakdown === i ? 'selected' : ''}>${text(b.title)}</option>`).join('')}</select>` : ''}${selected?.periods?.length ? `<select class="s-select" data-key="reporting" aria-label="Segment reporting period">${selected.periods.map((p, i) => ({ p, i })).sort((a, b) => String(a.p.end).localeCompare(String(b.p.end)) * (st.order === 'oldest' ? 1 : -1)).map(({ p, i }) => `<option value="${i}" ${+st.reporting === i ? 'selected' : ''}>${text(p.start)} – ${text(p.end)} (${p.months} months)</option>`).join('')}</select>` : ''}`;
}
function renderSegments(d, st) {
  const b = d.breakdowns?.[+st.breakdown] || d.breakdowns?.[0];
  const p = b?.periods?.[+st.reporting] || b?.periods?.[0];
  if (!p) return ui.empty(d.unavailable?.[0]?.reason || 'Revenue segment data is not available for this symbol.');
  const total = p.total || p.sum;
  return `<p class="p-company-caption">${text(b.title)} · ${text(p.start)} – ${text(p.end)} · ${text(p.currency)}${p.overlapping ? ' · Tags overlap; values do not form an allocation.' : ''}</p><div class="p-company-segments">${p.items.map(i => `<div><span>${text(i.label)}</span><b>${displayFinancial(i.value, 'usd', st.units)}</b><div class="p-company-track"><span style="width:${finite(total) && total > 0 ? Math.max(0, Math.min(100, i.value / total * 100)).toFixed(2) : 0}%"></span></div></div>`).join('')}</div>${facts([['Reported total', displayFinancial(p.total, 'usd', st.units)], ['Sum of displayed tags', displayFinancial(p.sum, 'usd', st.units)]])}${safeURL(d.filing?.url) ? `<p class="p-company-caption"><a href="${esc(safeURL(d.filing.url))}" target="_blank" rel="noopener noreferrer">Read ${text(d.filing.form)} filing (${text(d.filing.filed)})</a></p>` : ''}`;
}
researchPanel('fundamentals', {
  title: 'Fundamentals', defaultSize: { w: 8, h: 13 }, initial: { statement: 'metrics', units: 'auto', order: 'newest', compare: '', breakdown: '0', reporting: '0' }, compare: true,
  localKeys: ['units', 'order', 'breakdown', 'reporting'],
  route: st => metricsTabs.includes(st.statement) ? 'metrics' : st.statement === 'segments' ? 'segments' : 'financials', params: st => ({ statement: st.statement, period: st.period }),
  controls: (st, d) => `<div class="p-company-toolbar">${tabs(statements, st.statement, 'statement')}${periodControl(st)}${unitsControl(st)}<select class="s-select" data-key="order" aria-label="Date order"><option value="newest" ${st.order !== 'oldest' ? 'selected' : ''}>Newest dates first</option><option value="oldest" ${st.order === 'oldest' ? 'selected' : ''}>Oldest dates first</option></select>${st.statement === 'segments' ? segmentControls(st, d) : ''}<form data-company-compare><input class="s-input" name="compare" value="${esc(st.compare)}" placeholder="Compare: AMD, INTC" maxlength="20" aria-label="Compare up to two stock symbols"><button class="s-btn s-btn-sm">Compare</button></form></div>`,
  render(d, st) {
    const companies = [d, ...(d.comparisons || [])];
    const errors = companies.filter(x => x.error).map(x => `<p role="status" class="p-company-caption">${text(x.symbol)}: ${text(x.error)}</p>`).join('');
    if (st.statement === 'segments') {
      const title = (d.breakdowns?.[+st.breakdown] || d.breakdowns?.[0])?.title;
      return companies.filter(x => !x.error).map(x => { const index = x.breakdowns?.findIndex(b => b.title === title) ?? -1; return `<h3>${text(x.symbol)}</h3>${index >= 0 ? renderSegments(x, { ...st, breakdown: String(index) }) : ui.empty('This company does not publish the selected revenue breakdown.')}`; }).join('') + errors;
    }
    if (d.etf?.length) return facts(d.etf.map(r => [r.label, text(r.value)]));
    const loaded = companies.filter(x => !x.error);
    const rows = financialRows(d, st);
    if (!rows.length) return ui.empty('No financial statements are available for this symbol.') + errors;
    const cols = loaded.map(x => financialColumns(x, st.order));
    return `<p class="p-company-caption">${text(d.currency || 'USD')} · Units: ${text(st.units || 'auto')}. Dates are each company’s fiscal period ending. Derived fields marked *. YoY compares fiscal dates about one year apart using the absolute prior value; unavailable comparisons show a dash. Company-specific operating KPIs are shown only when published by these sources.</p><div class="p-company-table"><table class="s-table"><thead>${loaded.length > 1 ? `<tr><th>Company</th>${loaded.map((x, i) => `<th scope="colgroup" colspan="${cols[i].length}">${text(x.symbol)} · ${text(x.source || x.sources?.join(' / '))}</th>`).join('')}</tr>` : ''}<tr><th scope="col">Metric</th>${cols.flatMap(c => c.map(v => `<th scope="col" class="s-num">${text(v.label)}</th>`)).join('')}</tr></thead><tbody>${rows.map(r => r.section ? `<tr class="p-company-section"><th scope="row" colspan="${cols.reduce((a, c) => a + c.length, 1)}">${text(r.section)}</th></tr>` : renderFinancialRow(r, loaded, cols, st)).join('')}</tbody></table></div>${errors}`;
  },
  rows: (d, st) => st.statement === 'segments' ? [d, ...(d.comparisons || []).filter(x => !x.error)].flatMap(x => { const title = (d.breakdowns?.[+st.breakdown] || d.breakdowns?.[0])?.title; const b = x.breakdowns?.find(b => b.title === title); const p = b?.periods?.[+st.reporting] || b?.periods?.[0]; return (p?.items || []).map(i => ({symbol:x.symbol,breakdown:b.title,start:p.start,end:p.end,currency:p.currency,...i})); }) : [d, ...(d.comparisons || []).filter(x => !x.error)].flatMap(x => financialRows(x, st).filter(r => !r.section).map(r => Object.fromEntries([['symbol', x.symbol], ['metric', r.label], ['unit', r.unit], ['derived', !!r.derived], ...financialColumns(x, st.order).map(c => [c.label, r.values?.[c.index] ?? null])])) )
});

researchPanel('analyst', {
  title: 'Analyst Ratings', route: 'analyst', initial: { tab: 'verdict' }, localControls: true,
  controls: st => tabs([['verdict', 'Verdict'], ['targets', 'Targets'], ['actions', 'Actions'], ['track', 'Track record']], st.tab, 'tab'),
  render(d, st) {
    if (!d.covered) return ui.empty(d.reason || 'No analyst coverage is available for this symbol.');
    const t = d.targets, dist = d.distribution;
    if (st.tab === 'track') return ui.unavailable('Analyst accuracy track record', d.trackRecord?.reason || 'The current sources do not publish per-analyst accuracy or realized recommendation returns. Consensus history below is not an accuracy score.') + `<div class="p-company-table"><table class="s-table" aria-label="Analyst firm accuracy"><thead><tr><th>Rank</th><th>Firm</th><th>Overall</th><th>Direction</th><th>Price</th><th>Target</th></tr></thead><tbody><tr><td colspan="6">No analyst-accuracy feed connected. Proprietary scores and rankings are unavailable.</td></tr></tbody></table></div>` + (d.history?.length ? `<h3>Consensus history (not analyst accuracy)</h3><table class="s-table"><thead><tr><th>Date</th><th>Consensus</th><th>Buy</th><th>Hold</th><th>Sell</th></tr></thead><tbody>${d.history.map(h => `<tr><td>${text(h.date)}</td><td>${text(h.consensus)}</td><td>${n(h.buy, 'integer')}</td><td>${n(h.hold, 'integer')}</td><td>${n(h.sell, 'integer')}</td></tr>`).join('')}</tbody></table>` : '');
    if (st.tab === 'actions') return d.actions?.length ? `<div class="p-company-table"><table class="s-table"><thead><tr><th>Date</th><th>Firm</th><th>Action</th><th>From</th><th>To</th><th>Target</th></tr></thead><tbody>${d.actions.map(a => `<tr><td>${text(a.date)}</td><td>${text(a.firm)}</td><td>${text(a.action)}</td><td>${text(a.from)}</td><td>${text(a.to)}</td><td>${price(a.target)}</td></tr>`).join('')}</tbody></table></div>` : ui.empty(d.actionsNote || 'No recent analyst actions available.');
    if (st.tab === 'targets') return t ? `${facts([['Average target', price(t.mean)], ['Median', price(t.median)], ['Low', price(t.low)], ['High', price(t.high)], ['Latest price', price(d.price)], ['Implied upside', pct(t.upsidePercent)], ['Analysts', n(t.analysts, 'integer')], ['Updated', text(t.updated)]])}<p class="p-company-caption">Targets are analyst estimates, not guaranteed returns. Source: ${text(t.source)}</p>` : ui.empty('Price targets are unavailable.');
    return `<div class="p-company-verdict">${text(d.consensus || 'Consensus unavailable')}<small>${finite(dist?.total) ? dist.total + ' analyst ratings' : 'Analyst consensus'}</small></div>${dist?.buckets?.length ? `<div class="p-company-ratings">${dist.buckets.map(b => `<div><span>${text(b.label)}</span><meter min="0" max="100" value="${finite(b.percent) ? b.percent : 0}" aria-label="${text(b.label)}: ${b.count} ratings"></meter><b>${n(b.count, 'integer')}</b></div>`).join('')}</div>` : ui.empty('Rating distribution unavailable.')}${t ? facts([['Average target', price(t.mean)], ['Implied upside', pct(t.upsidePercent)]]) : ''}${dist?.period ? `<p class="p-company-caption">Ratings as of ${text(dist.period)}</p>` : ''}`;
  },
  rows: (d, st) => st.tab === 'track' ? d.history : st.tab === 'actions' ? d.actions : st.tab === 'targets' ? (d.targets ? [d.targets] : []) : d.distribution?.buckets
});

researchPanel('profile', {
  title: 'Company Profile', route: 'profile',
  render(d) { const site = safeURL(d.website); return `<div class="p-company-heading"><strong>${text(d.name)}</strong><span>${text(d.exchange)} · ${text(d.assetClass)}</span></div><p class="p-company-description">${text(d.description || 'A company description is not available from the current sources.')}</p>${facts([['Sector', text(d.sector)], ['Industry', text(d.industry)], ['Country', text(d.country)], ['Headquarters', text(d.headquarters)], ['Phone', text(d.phone)], ['Website', site ? `<a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(new URL(site).hostname)}</a>` : '—'], ['Employees', n(d.employees)], ['IPO', text(d.ipoDate || d.ipoYear)], ['Fiscal year end', text(d.fiscalYearEnd)], ['SEC classification', text(d.sic)], ['Shares outstanding', n(d.sharesOutstanding)]])}`; }
});

researchPanel('peers', {
  title: 'Peers', route: 'peers', defaultSize: { w: 6, h: 12 },
  render(d) {
    if (!d.peers?.length) return ui.empty('No comparable companies are available for this symbol.');
    return `<p class="p-company-caption">${text(d.method)} · Select a company to link its symbol.</p><div class="p-company-table"><table class="s-table"><thead><tr><th>Company</th><th class="s-num">Price</th><th class="s-num">Change</th><th class="s-num">Market cap</th><th class="s-num">P/E</th><th class="s-num">P/S</th><th class="s-num">Net margin</th></tr></thead><tbody>${d.peers.map(r => `<tr data-symbol="${esc(r.symbol)}" tabindex="0" aria-label="View ${esc(r.symbol)}" ${r.self ? 'class="p-company-self"' : ''}><th scope="row"><b>${text(r.symbol)}</b><small>${text(r.name)}</small></th><td class="s-num">${price(r.price)}</td><td class="s-num ${fmt.dir(r.changePercent)}">${pct(r.changePercent)}</td><td class="s-num">${n(r.marketCap, 'usd')}</td><td class="s-num">${n(r.pe, 'multiple')}</td><td class="s-num">${n(r.ps, 'multiple')}</td><td class="s-num">${n(r.netMargin, 'percent')}</td></tr>`).join('')}</tbody></table></div>`;
  }, rows: d => d.peers
});

researchPanel('segments', {
  title: 'Revenue Segments', route: 'segments', initial: { breakdown: '0', reporting: '0', units: 'auto' }, params: st => ({ period: st.period }), localKeys: ['breakdown', 'reporting', 'units'],
  controls: (st, d) => `<div class="p-company-toolbar">${periodControl(st)}${unitsControl(st)}${segmentControls(st, d)}</div>`,
  render: renderSegments,
  rows: (d, st) => { const b = d.breakdowns?.[+st.breakdown] || d.breakdowns?.[0]; return (b?.periods?.[+st.reporting] || b?.periods?.[0])?.items; }
});

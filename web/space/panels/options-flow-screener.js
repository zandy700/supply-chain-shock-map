import { registerPanel, bus, fmt, esc, toCSV, state as ui } from '../core.js';
import { createOptionRefresh, observePanel } from './options-refresh.js';
import { FLOW_COLUMNS, normalizeFlowColumns, moveFlowColumn, flowDTE, flowFillPosition, flowSide, sortedFlowRows } from './flow-columns.js';

const cash = value => Number.isFinite(value) ? '$' + fmt.num(value, 2) : '—';
const presets = [['all', 'All trades'], ['ask', 'Ask flow'], ['bid', 'Bid flow'], ['big-ask', 'Large ask trades'], ['big-bid', 'Large bid trades'], ['etf-ask', 'ETF ask flow'], ['multi', 'Large multi-leg trades']];
const sorts = [['time', 'Time'], ['premium', 'Premium'], ['size', 'Size'], ['volume', 'Volume (loaded page)'], ['dte', 'DTE (loaded page)']];
const PARAMS = ['symbol', 'preset', 'limit', 'sort', 'minPremium', 'minVolume'];
const list = value => Array.isArray(value) ? value.join(', ') : '';

registerPanel('options-flow', { title: 'Options Flow Screener', category: 'Options', defaultSize: { w: 8, h: 13 }, mount(el, ctx) {
  let st = { symbol: '', preset: 'all', limit: 50, sort: 'time', minPremium: 0, minVolume: 0, ...ctx.state };
  const initialColumns = normalizeFlowColumns(st.columnOrder, st.hiddenColumns);
  st.columnOrder = initialColumns.order; st.hiddenColumns = initialColumns.hidden;
  let paused = !!ctx.state.optionsPaused, data = null, error = null, dead = false, cursor = null, previous = [], generation = 0, columnsOpen = false;
  const visibility = observePanel(el);
  const poll = createOptionRefresh({ refresh: fetchFlow, visible: () => {
    const active = globalThis.document?.activeElement;
    return visibility.visible() && !cursor && !columnsOpen && !(active && el.contains(active) && active.matches('input,select'));
  }, paused });
  const load = () => poll.restart();
  const save = patch => { st = { ...st, ...patch }; ctx.setState(patch); };

  function columnSettings() {
    return `<section class="p-flow-columns" role="dialog" aria-label="Flow columns"><header><strong>Columns</strong><span>Time is always first.</span><button class="s-btn s-btn-sm" data-columns-reset>Reset columns</button><button class="s-btn s-btn-sm" data-columns-close aria-label="Close flow columns">Close</button></header>${st.columnOrder.map((key, i) => {
      const label = FLOW_COLUMNS.find(c => c.key === key).label;
      return `<div class="p-flow-column-row"><label><input type="checkbox" data-flow-column="${key}" ${st.hiddenColumns.includes(key) ? '' : 'checked'}>${esc(label)}</label><button class="s-btn s-btn-sm" data-flow-move="-1" data-column="${key}" aria-label="Move ${esc(label)} column left" ${i ? '' : 'disabled'}>↑</button><button class="s-btn s-btn-sm" data-flow-move="1" data-column="${key}" aria-label="Move ${esc(label)} column right" ${i === st.columnOrder.length - 1 ? 'disabled' : ''}>↓</button></div>`;
    }).join('')}</section>`;
  }
  function cell(row, key, index) {
    switch (key) {
      case 'symbol': return esc(row.symbol || '—');
      case 'side': return esc(flowSide(row) || '—');
      case 'contract': return `<button class="s-btn s-btn-ghost" data-contract="${index}">${esc(row.contract)}</button>`;
      case 'dte': return fmt.num(flowDTE(row), 0);
      case 'underlying': return cash(row.underlying);
      case 'bidAsk': return `${cash(row.bid)} / ${cash(row.ask)}`;
      case 'price': return cash(row.price);
      case 'fillPosition': { const value = flowFillPosition(row); return value == null ? '—' : fmt.num(value, 1) + '%'; }
      case 'size': return fmt.num(row.size, 0);
      case 'premium': return cash(row.premium);
      case 'volume': return fmt.compact(row.volume);
      case 'openInterest': return fmt.compact(row.openInterest);
      case 'code': return `${esc(row.code || '—')}<small>${esc(row.exchange || '')}</small>`;
      case 'flags': return esc(list(row.flags) || '—');
      case 'tags': return esc(list(row.tags) || '—');
      default: return '—'; // Chain-specific quotes and leg counts are not supplied by this adapter.
    }
  }
  function render() {
    const scroll = el.querySelector('.p-flow-table')?.scrollLeft || 0;
    if (!data && error?.body?.error === 'flow_not_configured') {
      el.innerHTML = `<section class="p-flow p-flow-unavailable" role="status"><div><h3>Options flow isn’t connected</h3><p>This panel shows individual options trades and needs a separate data subscription.</p><p>Use the Options Chain to explore contracts and quotes.</p><button type="button" class="s-btn" data-open-chain>Open Options Chain</button><details><summary>Connection details</summary><p>This site’s flow feed uses Unusual Whales. A subscription with API access must be connected by the site owner. Alpaca chain quotes don’t include this transaction feed.</p><a class="s-btn s-btn-sm" href="/setup#api-unusual-whales">API setup</a> <button type="button" class="s-btn s-btn-sm" data-check-flow>Check connection</button></details></div></section>`;
      el.querySelector('[data-check-flow]').onclick = load;
      el.querySelector('[data-open-chain]').onclick = () => {
        const chain = document.querySelector('.sp-panel[data-type="options-chain"]');
        if (chain) { chain.scrollIntoView({ block: 'start', behavior: 'smooth' }); chain.querySelector('button')?.focus({ preventScroll: true }); }
        else bus.emit('panel:add', { type: 'options-chain' });
      };
      return;
    }
    el.innerHTML = `<div class="p-flow"><form class="p-flow-tools"><input class="s-input" name="symbol" aria-label="Flow ticker" placeholder="All tickers" value="${esc(st.symbol)}" maxlength="8"><select class="s-select" name="preset" aria-label="Flow filter">${presets.map(([v, label]) => `<option value="${v}" ${st.preset === v ? 'selected' : ''}>${label}</option>`).join('')}</select><label>Min premium<input class="s-input" name="minPremium" aria-label="Minimum trade premium" type="number" min="0" value="${esc(st.minPremium)}"></label><label>Min volume<input class="s-input" name="minVolume" aria-label="Minimum contract volume" type="number" min="0" value="${esc(st.minVolume)}"></label><select class="s-select" aria-label="Flow volume preset" data-volume-preset>${[0, 100, 1000].map(n => `<option value="${n}" ${+st.minVolume === n ? 'selected' : ''}>${n ? n + '+' : 'All volumes'}</option>`).join('')}${[0, 100, 1000].includes(+st.minVolume) ? '' : '<option value="custom" selected>Custom minimum</option>'}</select><select class="s-select" name="limit" aria-label="Flow result count">${[25, 50, 100, 200].map(n => `<option ${+st.limit === n ? 'selected' : ''}>${n}</option>`).join('')}</select><select class="s-select" name="sort" aria-label="Flow sort">${sorts.map(([v, label]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${label}</option>`).join('')}</select><button class="s-btn">Apply</button></form><div class="p-flow-tools"><button class="s-btn" data-pause>${paused ? 'Resume updates' : 'Pause updates'}</button><button class="s-btn" data-refresh>Refresh</button><button class="s-btn" data-columns aria-expanded="${columnsOpen}">Columns</button><button class="s-btn" data-newer ${previous.length ? '' : 'disabled'}>Newer</button><button class="s-btn" data-older ${data?.hasMore && st.sort === 'time' ? '' : 'disabled'}>Older</button></div>${columnsOpen ? columnSettings() : ''}<div data-flow-body></div><p class="p-portfolio-note">Transaction tape · Checks every 60 seconds while visible during regular US market hours. Flow access requires a configured provider subscription. Execution tags do not establish trade intent. DTE uses the execution date in New York; fill position is derived from the reported trade and bid/ask spread. Stock is the reported underlying price; Spot is the option trade price. Chain-specific quotes and leg counts remain unavailable. Volume sorts highest first and DTE shortest first within the loaded page.</p>${data ? `<p class="p-portfolio-note">${esc(data.source || 'Source unavailable')} · Latest trade ${esc(data.asOf || 'unavailable')} · Checked ${esc(data.checkedAt || 'unavailable')}</p>` : ''}</div>`;
    const form = el.querySelector('form');
    form.onsubmit = event => { event.preventDefault(); save(Object.fromEntries(PARAMS.map(key => [key, form.elements[key].value]))); cursor = null; previous = []; load(); };
    el.querySelector('[data-volume-preset]').onchange = event => { if (event.target.value !== 'custom') form.elements.minVolume.value = event.target.value; };
    el.querySelector('[data-pause]').onclick = () => { paused = !paused; poll.setPaused(paused); ctx.setState({ optionsPaused: paused }); render(); if (!paused) load(); };
    el.querySelector('[data-refresh]').onclick = load;
    el.querySelector('[data-columns]').onclick = () => { columnsOpen = !columnsOpen; render(); el.querySelector(columnsOpen ? '[data-columns-close]' : '[data-columns]')?.focus(); };
    el.querySelector('[data-older]').onclick = () => { if (!data?.oldest || st.sort !== 'time') return; previous.push(cursor); cursor = data.oldest; load(); };
    el.querySelector('[data-newer]').onclick = () => { cursor = previous.pop() || null; load(); };
    if (columnsOpen) {
      el.querySelector('[data-columns-close]').onclick = () => { columnsOpen = false; render(); el.querySelector('[data-columns]')?.focus(); };
      el.querySelector('[data-columns-reset]').onclick = () => { const defaults = normalizeFlowColumns(); save({ columnOrder: defaults.order, hiddenColumns: [] }); render(); };
      for (const input of el.querySelectorAll('[data-flow-column]')) input.onchange = () => { const hidden = new Set(st.hiddenColumns); input.checked ? hidden.delete(input.dataset.flowColumn) : hidden.add(input.dataset.flowColumn); save({ hiddenColumns: [...hidden] }); render(); el.querySelector(`[data-flow-column="${input.dataset.flowColumn}"]`)?.focus(); };
      for (const button of el.querySelectorAll('[data-flow-move]')) button.onclick = () => { save({ columnOrder: moveFlowColumn(st.columnOrder, button.dataset.column, Number(button.dataset.flowMove)) }); render(); el.querySelector(`[data-flow-move="${button.dataset.flowMove}"][data-column="${button.dataset.column}"]`)?.focus(); };
    }
    const body = el.querySelector('[data-flow-body]');
    const displayed = data?.rows ? sortedFlowRows(data.rows, st.sort) : [], columns = st.columnOrder.filter(key => !st.hiddenColumns.includes(key));
    const warning = error ? ui.error((data ? 'Update failed; showing previous trades. ' : '') + (error.body?.message || error.message)) : '';
    body.innerHTML = warning + (!data ? error ? '' : ui.loading('Loading transaction flow…') : displayed.length ? `<div class="p-flow-table"><table class="s-table"><thead><tr><th scope="col">Time</th>${columns.map(key => `<th scope="col">${FLOW_COLUMNS.find(c => c.key === key).label}</th>`).join('')}</tr></thead><tbody>${displayed.map((row, i) => `<tr><td title="${esc(row.time)}">${esc(fmt.time(row.time))}</td>${columns.map(key => `<td>${cell(row, key, i)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ui.empty('No trades matched these filters.'));
    const retry = body.querySelector('[data-retry]'); if (retry) retry.onclick = load;
    const table = body.querySelector('.p-flow-table'); if (table) table.scrollLeft = scroll;
    for (const button of body.querySelectorAll('[data-contract]')) button.onclick = () => { const row = displayed[Number(button.dataset.contract)]; ctx.openSymbol(row.symbol); bus.emit('options:contract', { symbol: row.symbol, expiry: row.expiry, strike: row.strike, kind: row.type }); };
  }
  async function fetchFlow(signal) {
    const ticket = ++generation;
    try {
      const result = await ctx.api('options/flow', { ...Object.fromEntries(PARAMS.map(key => [key, st[key]])), older_than: cursor }, { signal });
      if (signal.aborted || ticket !== generation) return;
      data = result; error = null; poll.update(result);
    } catch (failure) {
      if (signal.aborted || dead || ticket !== generation) return;
      error = failure;
      if (failure.body?.error === 'flow_not_configured') poll.update({ refreshAllowed: false });
    }
    if (!dead && !signal.aborted) render();
  }
  const keydown = event => { if (event.key === 'Escape' && columnsOpen) { columnsOpen = false; render(); el.querySelector('[data-columns]')?.focus(); event.preventDefault(); event.stopPropagation(); } };
  el.addEventListener('keydown', keydown);
  render(); load();
  return { csv: () => data?.rows ? toCSV(data.rows.map(row => ({ ...row, tags: list(row.tags), flags: list(row.flags) }))) : null,
    scoutContext: () => data?.rows ? JSON.stringify(data.rows.slice(0, 12)) : 'Transaction feed unavailable.',
    destroy() { dead = true; generation++; poll.destroy(); visibility.destroy(); el.removeEventListener('keydown', keydown); } };
} });

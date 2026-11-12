// Market research panels. Quotes are provider data; theme membership is editorial.
import { registerPanel, api, esc, fmt, toCSV, state as ui, store } from '../core.js';
import { THEMES } from '../views.js';
import { createLiveRefresh } from '../live-refresh.js';

const finite = v => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
const price = v => finite(v) ? fmt.price(+v) : '—';
const compact = v => finite(v) ? fmt.compact(+v) : '—';
const pct = v => finite(v) ? fmt.pct(+v) : '—';
const dir = v => finite(v) ? fmt.dir(+v) : 's-muted';
const PERIODS = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
const stockVariants = [{ id: 'most-active', label: 'Most Active' }, { id: 'trending', label: 'Trending' }, { id: 'gainers', label: 'Gainers' }, { id: 'losers', label: 'Losers' }];
const cryptoVariants = [{ id: 'crypto-all', label: 'All' }, { id: 'crypto-most-active', label: 'Most Active' }, { id: 'crypto-gainers', label: 'Gainers' }, { id: 'crypto-losers', label: 'Losers' }];
const ASSETS = [['stocks','Stocks'],['crypto','Crypto'],['etfs','ETFs'],['funds','Mutual Funds'],['options','Options'],['indices','Indices'],['futures','Futures'],['bonds','Bonds'],['currencies','Currencies']];
export async function loadMoverAsset(asset, variant, signal) {
  if (asset === 'stocks') return get('movers', {type:stockVariants.some(v=>v.id===variant)?variant:'most-active',scope:'large'}, signal);
  if (asset === 'crypto') return get('movers', {type:cryptoVariants.some(v=>v.id===variant)?variant:'crypto-all'}, signal);
  if (asset === 'indices') return get('movers', {type:'indexes'}, signal);
  const samples = {etfs:['SPY','QQQ','IWM','DIA','VTI','VOO'],bonds:['US2Y','US5Y','US10Y','US30Y'],currencies:['EURUSD','GBPUSD','AUDUSD','USDJPY','USDCAD','USDCHF']};
  if (samples[asset]) {
    const d = await get('quotes', {symbols:samples[asset].join(',')}, signal);
    const description = {etfs:'Selected US ETFs, not a full-market mover ranking.',bonds:'Daily US Treasury yields, not individual bond prices or executable quotes.',currencies:'Daily ECB reference exchange rates, not intraday FX quotes.'}[asset];
    return {rows:(d.quotes||[]).map(r=>({...r,name:r.name||r.label||r.symbol})),source:[...new Set((d.quotes||[]).map(r=>r.source).filter(Boolean))].join(' · '),missing:d.missing,notice:description,definition:description};
  }
  return {rows:[],unavailable:`${ASSETS.find(a=>a[0]===asset)?.[1]||'This asset class'} needs a connected market-wide data feed. ${asset==='options'?'The Options workspace has per-stock contracts; these are not market-wide movers.':'The current providers do not supply this universe.'}`,source:'Source not connected'};
}
const option = (v, label, selected) => `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(label)}</option>`;
const select = (key, label, options, selected) => `<label class="p-market-control">${esc(label)}<select class="s-select" data-control="${key}">${options.map(o => option(o.id ?? o, o.label ?? o, selected)).join('')}</select></label>`;
const themes = THEMES.map(t => ({ id: t.id, label: t.name }));
const baseColumns = [
  { key: 'symbol', name: 'Symbol', text: true }, { key: 'name', name: 'Name', text: true },
  { key: 'price', name: 'Price', format: price }, { key: 'changePercent', name: 'Change %', format: pct, color: true },
  { key: 'volume', name: 'Volume', format: compact }
];

// Exported pure helpers make missing-value sorting and theme filtering testable.
export function sortedMarketRows(rows, key, asc = true) {
  return [...rows].sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null || av === '') return bv == null || bv === '' ? 0 : 1;
    if (bv == null || bv === '') return -1;
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return asc ? result : -result;
  });
}
export function themeListRows(rows, list = 'companies') {
  if (list === 'etfs') return rows.filter(r => r.instrumentType==='etf'||r.assetClass === 'etf');
  if (list === 'funds') return []; // The available feed does not supply mutual funds.
  return rows.filter(r => r.instrumentType!=='etf'&&r.assetClass !== 'etf');
}

function table(rows, columns, sort, { remove = false } = {}) {
  if (!rows.length) return ui.empty('No matching instruments.');
  const ordered = sort?.key ? sortedMarketRows(rows, sort.key, sort.asc) : rows;
  return `<table class="s-table p-market-table"><thead><tr>${columns.map(c => `<th scope="col"${c.text ? '' : ' class="s-num"'} aria-sort="${sort?.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}"><button data-sort="${c.key}">${esc(c.name)}${sort?.key === c.key ? (sort.asc ? ' ↑' : ' ↓') : ''}</button></th>`).join('')}${remove ? '<th><span class="s-sr">Remove</span></th>' : ''}</tr></thead><tbody>${ordered.map(r => `<tr>${columns.map(c => {
    const value = r[c.key];
    if(c.key==='role'){let source='';try{const u=new URL(r.exposureSource);if(['https:','http:'].includes(u.protocol))source=u.href;}catch{}return `<td class="p-market-role">${esc(value||'Editorial theme constituent')}${r.exposure?`<small>${esc(r.exposure)}</small>`:''}${source?`<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">Issuer / fund source</a>`:''}</td>`;}
    if (c.key === 'symbol') return `<th scope="row"><button class="p-market-symbol" data-symbol="${esc(r.symbol)}">${esc(r.symbol)}</button>${r.missing ? '<span class="p-market-missing">Unavailable</span>' : ''}</th>`;
    return `<td class="${c.text ? 'p-market-name' : 's-num'} ${c.color ? dir(value) : ''}"${c.text ? ` title="${esc(value)}"` : ''}>${c.format ? c.format(value) : esc(value ?? '—')}</td>`;
  }).join('')}${remove ? `<td><button class="s-icon-btn s-icon-btn-sm" data-remove="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)}">×</button></td>` : ''}</tr>`).join('')}</tbody></table>`;
}

// All async loads are cancellable; a late response cannot replace a newer filter/symbol selection.
function mountMarket(el, ctx, config) {
  let data = null, rows = [], revision = 0, dead = false;
  let settings = { ...config.defaults, ...ctx.state };
  if (config.watchlist && !Array.isArray(ctx.state.symbols)) {
    let existing = [];
    try { existing = JSON.parse(localStorage.getItem('watchlist-pulse')) || []; } catch { /* unavailable */ }
    const saved = store.get('watchlist', []);
    settings.symbols = [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(saved) ? saved : saved?.symbols || [])].map(s => typeof s === 'string' ? s : s?.symbol).filter(s => typeof s === 'string' && /^\^?[A-Z0-9]{1,7}(?:[.-][A-Z0-9]{1,4})?$/.test(s)))].slice(0, 40);
  }
  const currentAsset = () => settings.asset || config.moverAsset;
  const allVariants = () => !config.moverAsset ? config.variants || [] : currentAsset()==='stocks' ? stockVariants : currentAsset()==='crypto' ? cryptoVariants : [];
  const visibleVariants = () => {const all=allVariants(),hidden=settings.hiddenTabs?.[currentAsset()],visible=all.filter(v=>!Array.isArray(hidden)||!hidden.includes(v.id));return visible.length?visible:all.slice(0,1);};
  let variant = settings.asset && settings.asset !== config.moverAsset ? settings.variant || allVariants()[0]?.id : ctx.variant || settings.variant || config.variant;
  if (allVariants().length && !visibleVariants().some(v=>v.id===variant)) variant=visibleVariants()[0]?.id || allVariants()[0].id;
  let syncedVariant = null;
  let settingsOpen = false;
  let sort = settings.sort || null;
  const resultsId = `market-results-${ctx.id || config.type}`;
  el.innerHTML = `<div class="p-market"><div class="p-market-toolbar"></div><div class="p-market-live" role="status" aria-live="off"></div><div class="p-market-message" role="status"></div><div class="p-market-body" id="${esc(resultsId)}"${config.variants || config.moverAsset ? ` role="tabpanel" aria-label="${esc(config.title)} results"` : ''}></div><div class="p-market-footer"></div></div>`;
  const toolbar = el.querySelector('.p-market-toolbar'), body = el.querySelector('.p-market-body'), footer = el.querySelector('.p-market-footer'), message = el.querySelector('.p-market-message'), live = el.querySelector('.p-market-live');
  const save = patch => { settings = { ...settings, ...patch }; ctx.setState(patch); if (config.watchlist && patch.symbols) store.set('watchlist', patch.symbols); };
  function controls() {
    const variants = visibleVariants();
    if(config.moverAsset){ctx.setVariantOptions?.(variants);if(variants.some(v=>v.id===variant)){if(ctx.variant!==variant&&syncedVariant!==variant)ctx.setVariant?.(variant);syncedVariant=variant;}}
    const tabs = variants.length ? `<div class="p-market-tabs" role="tablist" aria-label="${esc(config.title)} views">${variants.map(v => `<button type="button" role="tab" data-market-variant="${esc(v.id)}" aria-selected="${v.id === variant}" aria-controls="${esc(resultsId)}" tabindex="${v.id === variant ? '0' : '-1'}">${esc(v.label)}</button>`).join('')}</div>` : '';
    const menu = config.moverAsset ? `<button type="button" class="s-btn s-btn-sm s-btn-ghost" data-market-settings aria-label="Market list settings" aria-expanded="${settingsOpen}" aria-controls="${esc(resultsId)}-settings">Settings</button><div class="p-market-settings" id="${esc(resultsId)}-settings" ${settingsOpen?'':'hidden'} role="region" aria-label="Market list settings">${select('asset','Asset class',ASSETS.map(([id,label])=>({id,label})),currentAsset())}${allVariants().length?`<fieldset><legend>Visible tabs</legend>${allVariants().map(v=>`<label><input type="checkbox" data-market-tab-choice="${v.id}" ${variants.some(x=>x.id===v.id)?'checked':''}>${esc(v.label)}</label>`).join('')}</fieldset>`:''}<button type="button" class="s-btn s-btn-sm" data-market-settings-close>Done</button></div>` : '';
    toolbar.innerHTML = tabs + (!settings.asset || settings.asset===config.moverAsset ? config.controls?.(settings, data, variant) || '' : '') + menu + '<button class="s-btn s-btn-sm s-btn-ghost" data-refresh aria-label="Refresh market data">Refresh</button><button class="s-btn s-btn-sm s-btn-ghost" data-market-pause aria-pressed="false">Pause updates</button>';
    if(config.moverAsset) {const label=ASSETS.find(a=>a[0]===currentAsset())?.[1];ctx.setTitle?.(currentAsset()===config.moverAsset?config.title:`${label}${['stocks','crypto','indices'].includes(currentAsset())?' Movers':''}`);}
    else if(config.titleFor)ctx.setTitle?.(config.titleFor(settings));
    updateLive(poll.state());
  }
  function render({ updateControls = false } = {}) {
    if (updateControls) controls();
    const top = body.scrollTop, left = body.scrollLeft;
    const focused = body.contains(document.activeElement) ? document.activeElement : null;
    const identity = focused ? ['symbol', 'sort', 'remove'].map(key => [key, focused.dataset[key]]).find(([, value]) => value != null) : null;
    rows = config.rows(data, settings);
    const columns = config.moverAsset && currentAsset() !== config.moverAsset ? currentAsset()==='bonds' ? [baseColumns[0],baseColumns[1],{key:'price',name:'Yield (%)',format:v=>finite(v)?fmt.num(+v,3)+'%':'—'}] : baseColumns : config.columns || baseColumns;
    body.innerHTML = data.unavailable ? ui.unavailable('Market-wide feed unavailable',data.unavailable) : config.render ? config.render(data, rows, settings, sort) : table(rows, columns, sort, { remove: !!config.watchlist });
    const quoteTimes = [...new Set(rows.map(r => r.asOf).filter(Boolean))];
    const sourceTime = data.asOf ? `Source time ${data.asOf}` : quoteTimes.length === 1 ? `Quote time ${quoteTimes[0]}` : quoteTimes.length ? `Sample quote time ${quoteTimes[0]} (times vary by instrument)` : 'Source time unavailable';
    footer.textContent = [data.source || config.source || [...new Set(rows.map(r => r.source).filter(Boolean))].join(' · '), data.delayed || rows.some(r => r.delayed) ? 'Delayed quotes' : '', sourceTime, data.definition || data.description, data.note, data.missing?.length ? `Unavailable: ${data.missing.join(', ')}` : ''].filter(Boolean).join(' · ');
    body.scrollTop = top; body.scrollLeft = left;
    if (identity) [...body.querySelectorAll('button')].find(b => b.dataset[identity[0]] === identity[1])?.focus({ preventScroll: true });
  }
  async function fetchData(signal) {
    const current = revision;
    const first = !data;
    try {
      const result = await (config.moverAsset && currentAsset() !== config.moverAsset ? loadMoverAsset(currentAsset(), variant, signal) : config.load(settings, variant, signal));
      if (dead || signal.aborted || current !== revision) return;
      data = result; message.textContent = result.notice || ''; render({ updateControls: first });
    } catch (e) {
      if (dead || signal.aborted || current !== revision || e.name === 'AbortError') return;
      const detail = ({ provider_unavailable: 'The market data provider is unavailable. Try again shortly.', rate_limited: 'The data provider’s request limit was reached. Try again shortly.', provider_access_denied: 'The data provider could not serve this request.' })[e.message] || e.message || 'Market data could not be loaded.';
      if (data) message.textContent = `Update failed; showing previous data. ${detail} Retrying automatically.`;
      else { rows = []; body.innerHTML = ui.error(detail); }
      throw e;
    }
  }
  function updateLive(state) {
    if (dead) return;
    const checked = state.lastSuccessAt != null ? ` · Checked ${new Date(state.lastSuccessAt).toLocaleTimeString()}` : '';
    live.textContent = data?.unavailable ? 'Source not connected; no quotes are being shown.' : (state.status === 'offline' ? 'Offline; showing previous data' : state.paused ? 'Automatic updates paused' : state.busy ? 'Checking market data…' : state.error ? 'Update failed; retrying automatically' : state.status === 'stale' ? 'Data check overdue; retrying automatically' : 'Auto refresh every 60s while visible') + checked;
    live.classList.toggle('is-stale', !!state.error || state.status === 'stale' || state.status === 'offline');
    const button = toolbar.querySelector('[data-market-pause]');
    if (button) { button.textContent = state.paused ? 'Resume updates' : 'Pause updates'; button.setAttribute('aria-pressed', String(state.paused)); }
  }
  const poll = createLiveRefresh({ el, refresh: fetchData, interval: 60000, paused: !!settings.marketPaused, onState: updateLive });
  function load() {
    revision++; data = null; rows = []; message.textContent = ''; footer.textContent = ''; body.innerHTML = ui.loading();
    // Selection changes replace the old universe; background checks keep it visible.
    controls();
    return poll.restart().catch(() => {});
  }
  function click(event) {
    const button = event.target.closest('button'); if (!button) return;
    if (button.hasAttribute('data-market-settings') || button.hasAttribute('data-market-settings-close')) { settingsOpen=button.hasAttribute('data-market-settings')?!settingsOpen:false; controls(); if(settingsOpen)toolbar.querySelector('[data-control=asset]')?.focus();else toolbar.querySelector('[data-market-settings]')?.focus(); return; }
    if (button.dataset.marketVariant) { chooseVariant(button.dataset.marketVariant); return; }
    if (button.hasAttribute('data-retry') || button.hasAttribute('data-refresh')) { poll.request(true).catch(() => {}); return; }
    if (button.hasAttribute('data-market-pause')) { save({ marketPaused: !poll.state().paused }); poll.setPaused(settings.marketPaused); return; }
    if (button.dataset.symbol) { ctx.openSymbol(button.dataset.symbol); return; }
    if (button.dataset.sort) { const key = button.dataset.sort; sort = { key, asc: sort?.key === key ? !sort.asc : key === 'symbol' || key === 'name' }; save({ sort }); if (data) render(); return; }
    if (button.dataset.remove) { save({ symbols: (settings.symbols || []).filter(s => s !== button.dataset.remove) }); load(); }
  }
  function chooseVariant(id) {
    if (id === variant || !visibleVariants().some(v => v.id === id)) return;
    variant = id; ctx.setVariant?.(id); syncedVariant=id; save({ variant: id }); load();
  }
  function keydown(event) {
    const tab = event.target.closest('[data-market-variant]');
    if (!tab) return;
    const variants = visibleVariants(); if(!variants.length)return;
    const index = variants.findIndex(v => v.id === tab.dataset.marketVariant);
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % variants.length;
    else if (event.key === 'ArrowLeft') next = (index + variants.length - 1) % variants.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = variants.length - 1;
    else return;
    event.preventDefault();
    chooseVariant(variants[next].id);
    toolbar.querySelector(`[data-market-variant="${variants[next].id}"]`)?.focus();
  }
  function change(event) {
    const choice=event.target.dataset.marketTabChoice;
    if(choice){const hidden={...(settings.hiddenTabs||{})},list=new Set(Array.isArray(hidden[currentAsset()])?hidden[currentAsset()]:[]);event.target.checked?list.delete(choice):list.add(choice);if(allVariants().every(v=>list.has(v.id))){event.target.checked=true;message.textContent='Keep at least one tab visible.';return;}hidden[currentAsset()]=[...list];save({hiddenTabs:hidden});if(!visibleVariants().some(v=>v.id===variant)){variant=visibleVariants()[0].id;save({variant});if(currentAsset()===config.moverAsset)ctx.setVariant?.(variant);load();}else controls();return;}
    const key = event.target.dataset.control; if (!key) return;
    if(key==='asset'){if(!ASSETS.some(a=>a[0]===event.target.value))return;save({asset:event.target.value});variant=visibleVariants()[0]?.id;save({variant});if(currentAsset()===config.moverAsset&&variant)ctx.setVariant?.(variant);sort=null;save({sort:null});load();return;}
    const patch = { [key]: event.target.value };
    if (config.type === 'heatmap' && key === 'universe') patch.period = '1D';
    if(config.type==='theme-overview'&&key==='theme')patch.list='companies';
    save(patch); load();
  }
  function submit(event) {
    if (!event.target.matches('[data-watch-add]')) return;
    event.preventDefault(); const input = event.target.elements.symbol;
    const symbol = input.value.trim().toUpperCase();
    if (!/^\^?[A-Z0-9]{1,7}(?:[.-][A-Z0-9]{1,4})?$/.test(symbol)) { message.textContent = 'Enter a valid ticker, such as NVDA or BTC-USD.'; return; }
    const symbols = settings.symbols || [];
    if (symbols.includes(symbol)) { message.textContent = `${symbol} is already on this watchlist.`; return; }
    if (symbols.length >= 40) { message.textContent = 'This watchlist holds up to 40 instruments.'; return; }
    save({ symbols: [...symbols, symbol] }); input.value = ''; load();
  }
  el.addEventListener('click', click); el.addEventListener('change', change); el.addEventListener('submit', submit); el.addEventListener('keydown', keydown);
  load();
  return {
    onVariant: chooseVariant,
    csv() { return rows.length ? toCSV(rows.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v == null || typeof v !== 'object')))) : null; },
    scoutContext() { return `${config.title}\n${footer.textContent}\n${JSON.stringify(rows.slice(0, 20))}`; },
    destroy() { dead = true; revision++; poll.destroy(); el.removeEventListener('click', click); el.removeEventListener('change', change); el.removeEventListener('submit', submit); el.removeEventListener('keydown', keydown); }
  };
}
const get = (path, params, signal) => api('markets/' + path, params, { signal });
function register(config) {
  registerPanel(config.type, { title: config.title, category: 'Markets', defaultSize: config.size || { w: 4, h: 11 }, variants: config.variants,
    mount: (el, ctx) => mountMarket(el, ctx, config) });
}
register({ type: 'index-movers', moverAsset:'indices', title: 'Index Movers', load: (_, __, s) => get('movers', { type: 'indexes' }, s), rows: d => d.rows,
  columns: baseColumns.filter(c => c.key !== 'volume') });
register({ type: 'stock-movers', moverAsset:'stocks', title: 'Stock Movers', variants: stockVariants, variant: 'most-active', defaults: { scope: 'large' },
  controls: (s, _, v) => ['gainers', 'losers'].includes(v) ? select('scope', 'Universe', [{ id: 'large', label: 'Large caps' }, { id: 'all', label: 'All listings' }], s.scope) : '',
  load: (s, v, signal) => get('movers', { type: v, scope: s.scope }, signal), rows: d => d.rows });
register({ type: 'crypto-movers', moverAsset:'crypto', title: 'Crypto Movers', variants: cryptoVariants, variant: 'crypto-all',
  load: (_, v, s) => get('movers', { type: v }, s), rows: d => d.rows,
  columns: [...baseColumns.filter(c => c.key !== 'volume'), { key: 'dollarVolume', name: '24h volume (USD)', format: compact }, { key: 'marketCap', name: 'Market cap', format: compact }] });
register({ type: 'watchlist', title: 'Watchlist', watchlist: true, defaults: { symbols: [] }, source: 'Nasdaq · Coinbase · other sources as indicated',
  controls: () => '<form data-watch-add class="p-market-add"><input class="s-input" name="symbol" aria-label="Ticker to watch" placeholder="Add ticker" maxlength="14" required><button class="s-btn s-btn-sm" type="submit">Add</button></form>',
  load: (s, _, signal) => s.symbols.length ? get('quotes', { symbols: s.symbols.join(',') }, signal) : Promise.resolve({ quotes: [] }),
  rows: (d, s) => s.symbols.map(symbol => d.quotes.find(r => r.symbol === symbol) || { symbol, missing: true }),
  render: (_, rows, __, sort) => rows.length ? table(rows, baseColumns, sort, { remove: true }) : ui.empty('Add a ticker to build a watchlist saved with this panel.') });
register({ type: 'sector-performance', title: 'Sector Performance', defaults: { period: '1D' },
  controls: (s, d) => select('period', 'Period', d?.periods || PERIODS, s.period), load: (_, __, s) => get('sectors', {}, s),
  rows: (d, s) => d.rows.map(r => ({ ...r, changePercent: r.perf?.[s.period] ?? null })),
  render: (_, rows, __, sort) => table(rows, [baseColumns[0], { key: 'name', name: 'Sector', text: true }, baseColumns[2], baseColumns[3]], sort) });
register({ type: 'market-summary', title: 'Market Summary', size: { w: 6, h: 13 }, load: (_, __, s) => get('summary', {}, s),
  rows: d => d.groups.flatMap(g => g.items.map(r => ({ ...r, group: g.name }))),
  render: (d, _, __, sort) => d.groups.map(g => `<section class="p-market-group"><h3>${esc(g.name)}</h3>${table(g.items, [baseColumns[0], { key: 'label', name: 'Instrument', text: true }, baseColumns[2], baseColumns[3]], sort)}</section>`).join('') + `<p class="p-market-note">${(d.notes || []).map(esc).join(' · ')}</p>` });
register({ type: 'theme-overview', title: 'Theme Overview', size: { w: 6, h: 12 }, defaults: { theme: 'mag-7', list: 'companies' },
  titleFor: s=>s.list==='funds'?'Top Mutual Funds':s.list==='etfs'?'Top ETFs':THEMES.find(t=>t.id===s.theme)?.kind==='crypto'?'Top Crypto':'Top Companies',
  controls: s => select('theme', 'Theme', themes, s.theme) + select('list', 'Instruments', [{ id: 'companies', label: 'Companies / crypto' }, ...(THEMES.find(t=>t.id===s.theme)?.constituents.some(r=>r.instrumentType==='etf')?[{id:'etfs',label:'ETFs'}]:[]),...(THEMES.find(t=>t.id===s.theme)?.sector?[{id:'funds',label:'Mutual Funds'}]:[])], s.list),
  load: (s, _, signal) => s.list==='funds'?Promise.resolve({constituents:[],source:'Source not connected',unavailable:'The connected providers do not supply a mutual-fund universe. Companies and ETF lists remain available.'}):get('theme', { id: s.theme }, signal), rows: (d, s) => themeListRows(d.constituents, s.list),
  render: (d, rows, s, sort) => {
    if (s.list === 'funds') return ui.unavailable('Mutual fund data', 'The connected sources do not provide a mutual fund universe. Choose Companies or ETFs.');
    const a = d.aggregate || {};
    return `<div class="p-market-theme-intro"><h3>${esc(d.name)}</h3><p>${esc(d.description)}</p></div><div class="p-market-theme-stats"><div><span>Equal-weight change</span><strong class="${dir(a.equalWeightChangePercent)}">${pct(a.equalWeightChangePercent)}</strong></div><div><span>Advancing / declining</span><strong>${a.advancers ?? '—'} / ${a.decliners ?? '—'}</strong></div><div><span>Quotes available</span><strong>${a.quoted ?? '—'} / ${a.count ?? '—'}</strong></div></div>${table(rows, [baseColumns[0],baseColumns[1],{key:'instrumentType',name:'Type',text:true},{key:'role',name:'Role / exposure',text:true},baseColumns[2],baseColumns[3],{key:'marketCap',name:'Market cap',format:compact}],sort)}`;
  } });
register({ type: 'heatmap', title: 'Market Heatmap', size: { w: 8, h: 12 }, defaults: { period: '1D', size: 'marketCap' },
  controls: (s, d) => select('universe', 'Universe', [{ id: 'sp500-top', label: 'US Large Caps' }, ...themes.map(t => ({ id: `theme:${t.id}`, label: t.label }))], s.universe || (s.theme ? `theme:${s.theme}` : 'sp500-top')) + select('period', 'Period', d?.periods || ['1D'], s.period) + select('size', 'Size by', (d?.sizes || ['marketCap', 'volume']).map(id => ({ id, label: ({ marketCap: 'Market cap', volume: 'Volume', avgVolume: 'Average volume' })[id] })), s.size),
  load: (s, _, signal) => get('heatmap', { universe: s.universe || (s.theme ? `theme:${s.theme}` : 'sp500-top'), period: s.period }, signal), rows: d => d.tiles,
  render: (_, rows, s) => {
    if (!rows.length) return ui.empty('No heatmap data is available.');
    const max = Math.max(...rows.map(r => finite(r[s.size]) ? Math.max(0, +r[s.size]) : 0), 1);
    return `<div class="p-market-heatmap">${rows.map(r => {
      const weight = finite(r[s.size]) ? Math.max(0, +r[s.size]) / max : 0;
      const intensity = finite(r.changePercent) ? Math.min(Math.abs(+r.changePercent) / 5, 1) : 0;
      const tone = finite(r.changePercent) ? (+r.changePercent >= 0 ? 'up' : 'down') : 'neutral';
      return `<button class="p-market-tile p-market-tile-${tone}" style="--tile-weight:${Math.max(1, Math.round(Math.sqrt(weight) * 5))};--tile-intensity:${Math.round(12 + intensity * 52)}%" data-symbol="${esc(r.symbol)}" title="${esc(r.name)} · ${price(r.price)} · ${pct(r.changePercent)} · ${esc(r.sector)}"><b>${esc(r.symbol)}</b><span>${pct(r.changePercent)}</span><small>${price(r.price)}</small></button>`;
    }).join('')}</div><p class="p-market-note">Tile area approximates ${esc(s.size === 'marketCap' ? 'market capitalization' : s.size === 'avgVolume' ? 'average volume' : 'volume')}; unavailable sizes use the minimum area. Color shows the selected period’s return.</p>`;
  } });
register({ type: 'screener', title: 'Stock Screener', size: { w: 6, h: 12 }, defaults: { preset: 'large-gainers', query: '' },
  controls: (s, d) => select('preset', 'Screen', d?.presets || [{ id: s.preset, label: 'Loading screens…' }], s.preset) + `<label class="p-market-control">Filter results<input class="s-input" data-control="query" value="${esc(s.query)}" placeholder="Symbol or name"></label>`,
  load: async (s, _, signal) => { const [catalog, data] = await Promise.all([get('screener', {}, signal), get('screener', { preset: s.preset }, signal)]); return { ...data, presets: catalog.presets.map(p => ({ id: p.id, label: p.name })) }; },
  rows: (d, s) => d.rows.filter(r => !s.query || `${r.symbol} ${r.name}`.toLowerCase().includes(s.query.toLowerCase())),
  columns: [...baseColumns, { key: 'marketCap', name: 'Market cap', format: compact }, { key: 'sector', name: 'Sector', text: true }] });

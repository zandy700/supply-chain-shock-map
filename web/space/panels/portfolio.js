import { registerPanel, bus, esc, fmt, toCSV, store, state as ui } from '../core.js';
import { readPortfolios, writePortfolios, summarize, combinedHistory } from '../../portfolio-model.js';
import { loadBrokers } from '../../portfolio-broker.js';
import { editAccount } from '../../portfolio-editor.js';
import { portfolioRisk, holdingMovers, holdingsContext } from './portfolio-workflows.js';
import { renderChart } from '../../portfolio-chart.js';
import { createLiveRefresh } from '../live-refresh.js';

const usd = n => n == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(n);
let pending, cached, loadedAt = 0, cacheVersion = 0, brokerLoadedAt = 0, pendingVersion = -1, cachedVersion = -1;
export async function loadPortfolioData(force = false, { quotesOnly = false } = {}) {
  if (!force && cached && cachedVersion === cacheVersion && Date.now() - loadedAt < (quotesOnly ? 5000 : 60000)) return cached;
  if (pending && pendingVersion === cacheVersion) return pending;
  const version = cacheVersion;
  const request = (async () => {
    const manual = readPortfolios();
    let broker;
    if (quotesOnly && cached && Date.now() - brokerLoadedAt < 300000) broker = cached.broker;
    else {
      const result = await loadBrokers();
      if (result.error && cached?.broker.connected) broker = {...cached.broker, error:result.error, stale:true};
      else { broker = result; brokerLoadedAt = Date.now(); }
    }
    const symbols = [...new Set([...manual, ...broker.accounts].flatMap(a => a.holdings.map(h => h.ticker)))];
    const prices = {};
    const unavailable = [];
    await Promise.all(Array.from({length:Math.ceil(symbols.length/12)}, async (_, i) => {
      const batch = symbols.slice(i*12,i*12+12);
      try {
        const r = await fetch('/api/portfolio-quotes?tickers='+encodeURIComponent(batch.join(',')), {signal:AbortSignal.timeout(45000)});
        if (!r.ok) throw new Error('Quotes unavailable');
        const data = await r.json(); Object.assign(prices, data.prices); unavailable.push(...(data.unavailable || []));
      } catch { unavailable.push(...batch); }
    }));
    // A failed background quote must not erase the last observed price or masquerade as a new trade.
    if (cached) for (const symbol of unavailable) {
      if (cached.prices[symbol]) prices[symbol] = {...cached.prices[symbol], stale:true};
    }
    const anyFresh = Object.values(prices).some(q => q && !q.stale);
    const result = {manual, broker, prices, unavailable, quoteCheckedAt:Date.now(), quoteSuccessAt:anyFresh || !symbols.length ? Date.now() : cached?.quoteSuccessAt || null};
    if (version === cacheVersion) {
      cached = result; cachedVersion = version; loadedAt = Date.now();
      bus.emit('portfolio:data', result);
    }
    return result;
  })();
  pending = request; pendingVersion = version;
  try { return await request; } finally { if (pending === request) pending = null; }
}
function refresh() { cacheVersion++; bus.emit('portfolio:changed'); }

export function portfolioSelection(data, source, selected) {
  const all = source === 'linked' ? data.broker.accounts : data.manual;
  if (!all.some(a => a.id === selected)) selected = '';
  const accounts = selected ? all.filter(a => a.id === selected) : all;
  const prices = Object.assign({}, ...(source === 'linked' ? accounts.map(a => a.prices) : []), data.prices);
  const totals = summarize(accounts, prices);
  const incomplete = accounts.some(a => a.complete === false);
  if (incomplete) for (const key of ['value', 'cash', 'dayChange', 'dayPercent', 'gain', 'gainPercent']) totals[key] = null;
  return { all, selected, accounts, prices, totals, incomplete };
}

export function portfolioDisplayRows(accounts, prices, totals) {
  return totals.rows.map(row => {
    const quote = prices[row.ticker];
    const holding = accounts.flatMap(a => a.holdings).find(h => h.ticker === row.ticker && typeof h.name === 'string' && h.name.trim());
    const name = [quote?.name, quote?.companyName, holding?.name].find(value => typeof value === 'string' && value.trim())?.trim() || null;
    const costBasis = Number.isFinite(row.cost) && Number.isFinite(row.shares) ? row.cost * row.shares : null;
    const previousValue = Number.isFinite(row.value) && Number.isFinite(row.dayChange) ? row.value - row.dayChange : null;
    const dayPercent = previousValue > 0 && Number.isFinite(row.dayChange) ? 100 * row.dayChange / previousValue : null;
    return { ...row, name, costBasis,
      weight:totals.value > 0 && Number.isFinite(row.value) ? 100 * row.value / totals.value : null,
      dayPercent, dayGainPercent:dayPercent,
      gainPercent:costBasis > 0 && Number.isFinite(row.gain) ? 100 * row.gain / costBasis : null };
  });
}

export function portfolioSectorAllocation(rows, prices) {
  if (rows.some(row => !Number.isFinite(row.value))) return { complete:false, rows:[], coverage:null };
  const total = rows.reduce((sum,row)=>sum+row.value,0), groups = new Map();
  let known = 0;
  for (const row of rows) {
    const supplied = prices[row.ticker]?.sector;
    const sector = typeof supplied === 'string' && supplied.trim() ? supplied.trim() : null;
    if (sector) known += row.value;
    const key = sector || 'Sector not supplied';
    groups.set(key,(groups.get(key)||0)+row.value);
  }
  return { complete:true, coverage:total>0?known/total:null, rows:[...groups].map(([name,value])=>({name,value,weight:total>0?100*value/total:null})).sort((a,b)=>b.value-a.value) };
}

const holdingColumns = [
  ['ticker','Symbol'], ['name','Name'], ['shares','Shares'], ['price','Price'], ['dayPercent','Chg %'],
  ['cost','Avg. cost'], ['costBasis','Cost basis'], ['value','Market value'], ['weight','Weight'],
  ['dayChange','Day P&L'], ['dayGainPercent','Day P&L %'], ['gain','Total P&L'], ['gainPercent','Total P&L %']
];

export function snapshotAccounts(current, baseline, selected, prices, date) {
  if (JSON.stringify(current) !== JSON.stringify(baseline)) throw new Error('Your portfolios changed. Refresh before saving.');
  const ids = new Set(selected.map(a => a.id));
  return current.map(a => {
    if (!ids.has(a.id)) return a;
    if (a.holdings.some(h => prices[h.ticker]?.stale)) throw new Error('Fresh prices are required before saving. Refresh quotes and try again.');
    const value = summarize([a], prices).value;
    if (value === null) throw new Error('A complete price is required for every holding before saving.');
    return {...a, history:[...a.history.filter(p => p.date !== date), {date, value}]};
  });
}
const types = [
  ['portfolio-summary','Portfolio summary',6,5], ['portfolio-holdings','Holdings',6,12],
  ['portfolio-performance','Portfolio value history',6,10], ['portfolio-allocation','Allocation',6,10]
];
for (const [type,title,w,h] of types) registerPanel(type, {
  title, category:'Portfolio', defaultSize:{w,h},
  mount(el, ctx) {
    let data, accounts = [], totals, selected = ctx.state.account || '', source = ctx.state.source || '', dead = false, generation = 0, checkedAt = null, refreshError = null, liveState = null, loading = false;
    let privateValues = store.get('portfolio:private', false), tab = ctx.state.tab || 'holdings', sort = ctx.state.sort || 'ticker', order = ctx.state.order || 'asc', newsController;
    let insightView = ctx.state.insightView || 'performance', riskView = ctx.state.riskView || 'beta', moverSort = ctx.state.moverSort || 'dayPercent', moverOrder = ctx.state.moverOrder || 'desc';
    const statusText = () => `${liveState?.status === 'offline' ? 'Offline; showing last available prices. ' : refreshError || liveState?.error || liveState?.status === 'stale' ? 'Update incomplete; showing last available prices. ' : liveState?.busy ? 'Updating prices… ' : ''}${checkedAt ? 'Quotes checked ' + new Date(checkedAt).toLocaleTimeString() : 'Quotes not checked yet'} · Auto 60s while visible; broker holdings up to 5 min`;
    const updateStatus = () => { const n = el.querySelector('[data-portfolio-live]'); if (n) { n.textContent=statusText(); n.classList.toggle('s-down',!!refreshError || !!liveState?.error || liveState?.status === 'stale'); } };
    const editing = () => !!document.querySelector('.portfolio-editor[open]') || (el.contains(document.activeElement) && document.activeElement?.matches('input,select,textarea,[contenteditable=true]'));
    const money = n => privateValues ? '••••' : usd(n);
    const chartState = {range:ctx.state.range || '6M',from:ctx.state.from,to:ctx.state.to};
    const riskChartState = {range:ctx.state.riskRange || '6M',from:ctx.state.riskFrom,to:ctx.state.riskTo};
    function openEditor(account) {
      const baseline = JSON.stringify(data.manual);
      return editAccount(account, value => {
        const current = readPortfolios();
        if (JSON.stringify(current) !== baseline) throw new Error('Your portfolios changed while editing. Close this editor and refresh.');
        writePortfolios(account ? current.map(a => a.id === account.id ? value : a) : [...current, value]);
        refresh();
      });
    }
    function save() { ctx.setState({account:selected,source});store.set('portfolio:active',{source,account:selected});bus.emit('portfolio:selection',{source,account:selected}); }
    function render() {
      const scroll = el.querySelector('.p-portfolio')?.scrollTop || 0;
      const tableScroll = el.querySelector('.p-portfolio-scroll')?.scrollLeft || 0;
      const active = document.activeElement;
      const focus = el.contains(active) ? ['data-source','data-account','data-refresh','data-private','data-sort','data-tab','data-symbol','data-mover-sort','data-insight-view','data-risk-view'].map(k => active?.hasAttribute(k) ? `[${k}=${JSON.stringify(active.getAttribute(k))}]` : '').join('') : '';
      paint();
      const panel = el.querySelector('.p-portfolio'); if(panel)panel.scrollTop=scroll;
      const table = el.querySelector('.p-portfolio-scroll'); if(table)table.scrollLeft=tableScroll;
      if(focus)el.querySelector(focus)?.focus({preventScroll:true});
    }
    function paint() {
      newsController?.abort();
      const linked = source === 'linked';
      const selection = portfolioSelection(data, source, selected);
      const { all, prices, incomplete } = selection;
      ({ selected, accounts, totals } = selection);
      const missing = totals.rows.filter(r => r.price === null).map(r => r.ticker);
      const times = totals.rows.map(r => prices[r.ticker]).map(q => Date.parse(q?.asOf)).filter(Number.isFinite);
      const stamp = times.length ? ' · Oldest quote ' + new Date(Math.min(...times)).toLocaleString() : '';
      el.innerHTML = `<div class="p-portfolio"><div class="p-portfolio-tools"><select class="s-select" data-source aria-label="Portfolio source"><option value="manual" ${!linked?'selected':''}>Manual portfolios</option><option value="linked" ${linked?'selected':''}>Linked brokers</option></select><select class="s-select" data-account aria-label="Portfolio"><option value="">All portfolios</option>${all.map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)}</option>`).join('')}</select><button class="s-btn s-btn-sm" data-refresh>Refresh</button><button class="s-btn s-btn-sm" data-private aria-pressed="${privateValues}">${privateValues?'Show values':'Hide values'}</button>${!linked?'<button class="s-btn s-btn-sm" data-new>+ Portfolio</button>':''}<a class="s-btn s-btn-sm" href="/#/portfolio">Manage portfolios</a></div><div data-content></div><p class="p-portfolio-note">USD · ${linked?'Broker holdings':'Saved on this device'}${incomplete?' · Total unavailable: unsupported positions or cash currencies.':''}${missing.length?' · Quotes unavailable: '+esc(missing.join(', ')):''}${esc(stamp)}</p><p class="p-portfolio-live" role="status" data-portfolio-live>${esc(statusText())}</p><p class="p-portfolio-message" role="status"></p></div>`;
      const body = el.querySelector('[data-content]');
      el.querySelector('[data-source]').onchange = e => { source=e.target.value;selected='';save();render(); };
      el.querySelector('[data-account]').onchange = e => { selected=e.target.value;save();render(); };
      el.querySelector('[data-refresh]').onclick = () => refresh();
      el.querySelector('[data-private]').onclick = () => {store.set('portfolio:private',!privateValues);bus.emit('portfolio:privacy');};
      const create = el.querySelector('[data-new]');
      if (create) create.onclick = () => openEditor(null);
      if (!accounts.length) { body.innerHTML=ui.empty(linked ? (data.broker.error || 'No linked accounts. Open Manage portfolios to connect a broker.') : 'Add a portfolio or import a holdings CSV to begin.'); return; }
      if (type==='portfolio-summary') {
        body.innerHTML=`<div class="p-portfolio-metrics">${[['Portfolio value',money(totals.value)],['Day change',money(totals.dayChange)],['Unrealized gain/loss',money(totals.gain)],['Cash',money(incomplete?null:totals.cash)]].map(([k,v])=>`<div><span>${k}</span><strong>${v}</strong></div>`).join('')}</div><p class="p-portfolio-note">Day change assumes current quantities. Gains exclude realized returns and cash flows.</p>`;
      } else if (type==='portfolio-holdings') {
        if (tab !== 'holdings') { renderWorkflow(body,prices); return; }
        const displayRows = portfolioDisplayRows(accounts, prices, totals);
        const percentKeys = ['dayPercent','dayGainPercent','gainPercent'];
        const cell = (row, key) => key === 'name' ? esc(row.name || '—') : privateValues ? '••••' : key === 'shares' ? fmt.num(row[key],4) : key === 'weight' ? (row[key] == null ? '—' : fmt.num(row[key],2)+'%') : percentKeys.includes(key) ? fmt.pct(row[key]) : money(row[key]);
        body.innerHTML=displayRows.length?`<div class="p-portfolio-scroll"><table class="s-table p-portfolio-holdings-table"><thead><tr>${holdingColumns.map(([key,label])=>`<th scope="col" aria-sort="${sort===key?(order==='asc'?'ascending':'descending'):'none'}"><button class="s-btn s-btn-ghost s-btn-sm" data-sort="${key}">${label}</button></th>`).join('')}</tr></thead><tbody>${holdingMovers(displayRows,order,sort).map(row=>`<tr><th scope="row"><button class="s-btn s-btn-ghost s-btn-sm" data-symbol="${esc(row.ticker)}">${esc(row.ticker)}</button></th>${holdingColumns.slice(1).map(([key])=>`<td class="${key === 'name' ? 'p-portfolio-holding-name' : 's-num'} ${['dayChange','gain',...percentKeys].includes(key) ? fmt.dir(row[key]) : ''}"${key === 'name' && row.name ? ` title="${esc(row.name)}"` : ''}>${cell(row,key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="p-portfolio-note">Weights include selected USD cash. Day percentages use previous market value at current quantities; total P&amp;L uses recorded cost basis. ${displayRows.some(row=>!row.name)?'Company names are unavailable where the holdings or quote source does not supply them.':''}</p>`:ui.empty(incomplete ? 'No supported stock holdings. This account includes positions or cash balances that cannot be included in USD totals.' : 'This portfolio holds cash only.');
        for(const b of body.querySelectorAll('[data-sort]')) b.onclick=()=>{order=sort===b.dataset.sort&&order==='asc'?'desc':'asc';sort=b.dataset.sort;ctx.setState({sort,order});render();};
        for (const b of body.querySelectorAll('[data-symbol]')) b.onclick=()=>ctx.openSymbol(b.dataset.symbol);
        if (linked) {
          for (const a of accounts) {
            const detail = document.createElement('section'); detail.className='p-portfolio-broker-detail';
            const other = (a.other || []).map(p => [p.symbol || p.kind || 'Other position',p.shares,p.price,p.currency]);
            const balances = (a.balances || []).map(b => ['Cash',null,b.cash,b.currency]);
            const asOf = a.asOf && Number.isFinite(Date.parse(a.asOf)) ? new Date(a.asOf).toLocaleString() : 'time unavailable';
            detail.innerHTML=`<h3>${esc(a.name)}</h3><p class="p-portfolio-note">Broker positions as of ${esc(asOf)}. Other positions and cash below remain in their reported currency.</p>${other.length || balances.length ? `<div class="p-portfolio-scroll"><table class="s-table"><thead><tr><th>Other position / cash</th><th>Units</th><th>Price / cash</th><th>Currency</th></tr></thead><tbody>${[...other,...balances].map(row=>`<tr>${row.map((v,i)=>`<td>${i===1 || i===2 ? (privateValues?'••••':fmt.num(v,4)) : esc(v ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:''}`;
            body.append(detail);
          }
        }
        if (!linked) {
          const edit=document.createElement('div'); edit.className='p-portfolio-tools';
          for (const a of accounts) { const b=document.createElement('button');b.className='s-btn s-btn-sm';b.textContent='Edit '+a.name;b.onclick=()=>openEditor(a);edit.append(b); }
          body.append(edit);
        }
      } else if (type==='portfolio-performance') {
        if (privateValues) {body.innerHTML=ui.empty('Portfolio values are hidden. Choose Show values to display history.');return;}
        const chart = document.createElement('div'); body.append(chart);
        renderChart(chart,combinedHistory(accounts),chartState);
        const saveRange = () => ctx.setState({range:chartState.range,from:chartState.from,to:chartState.to});
        chart.addEventListener('click',saveRange);chart.addEventListener('submit',saveRange);
        const note=document.createElement('p');note.className='p-portfolio-note';note.textContent='Recorded account values only. Current shares do not reconstruct historical performance.';body.append(note);
        if (!linked) {
          const b=document.createElement('button');b.className='s-btn s-btn-sm';b.textContent='Save today’s value';b.disabled=totals.value==null;
          b.onclick=()=>{try {const now=new Date();const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');writePortfolios(snapshotAccounts(readPortfolios(),data.manual,accounts,prices,date));refresh();}catch(e){el.querySelector('.p-portfolio-message').textContent=e.message;}};body.append(b);
        }
      } else {
        if (totals.value==null || totals.value<=0) { body.innerHTML=ui.empty('Allocation requires a complete, positive portfolio value. Refresh quotes or review holdings.');return; }
        const rows=[...totals.rows.map(r=>({name:r.ticker,value:r.value})),{name:'Cash',value:totals.cash}].filter(r=>r.value>0).sort((a,b)=>b.value-a.value);
        body.innerHTML=rows.map(r=>`<div class="p-portfolio-allocation"><span>${esc(r.name)}</span><strong>${money(r.value)} · ${privateValues?'••••':fmt.num(r.value/totals.value*100,1)+'%'}</strong>${privateValues?'':`<progress max="100" value="${r.value/totals.value*100}" aria-label="${esc(r.name)} allocation"></progress>`}</div>`).join('');
      }
      if(type==='portfolio-holdings') addTabs(body);
    }
    function addTabs(body) {
      const tabs=document.createElement('div');tabs.className='s-tabs p-portfolio-tabs';tabs.setAttribute('role','tablist');
      tabs.innerHTML=['holdings','news','insights','movers','risk'].map(t=>`<button class="s-tab" role="tab" aria-selected="${tab===t}" data-tab="${t}">${t[0].toUpperCase()+t.slice(1)}</button>`).join('');
      tabs.onclick=e=>{const b=e.target.closest('[data-tab]');if(!b)return;tab=b.dataset.tab;ctx.setState({tab});render();};body.prepend(tabs);
    }
    function renderWorkflow(body, prices) {
      newsController?.abort();
      const risk=portfolioRisk(totals.rows,totals.cash);
      const displayRows=portfolioDisplayRows(accounts,prices,totals);
      const percent=value=>privateValues?'••••':fmt.pct(value);
      const number=(value,digits=1)=>privateValues?'••••':fmt.num(value,digits);
      const subTabs=(values,selected,key,label)=>`<div class="s-tabs p-portfolio-subtabs" role="tablist" aria-label="${label}">${values.map(([value,title])=>`<button class="s-tab" role="tab" aria-selected="${value===selected}" data-${key}="${value}">${title}</button>`).join('')}</div>`;
      const allocation=rows=>rows.map(row=>`<div class="p-portfolio-allocation"><span>${esc(row.name)}</span><strong>${money(row.value)} · ${privateValues?'••••':fmt.num(row.weight,1)+'%'}</strong>${privateValues?'':`<progress max="100" value="${row.weight}" aria-label="${esc(row.name)} allocation"></progress>`}</div>`).join('');
      if(tab==='movers') {
        const columns=[['ticker','Symbol'],['name','Name'],['price','Price'],['dayChange','Day P&L'],['dayPercent','Day P&L %']];
        body.innerHTML=`<h3>Daily movers</h3><p class="p-portfolio-note">Day movement at current quantities, including losses. Missing prices sort last.</p><div class="p-portfolio-scroll"><table class="s-table p-portfolio-movers-table"><thead><tr>${columns.map(([key,label])=>`<th scope="col" aria-sort="${moverSort===key?(moverOrder==='asc'?'ascending':'descending'):'none'}"><button class="s-btn s-btn-ghost s-btn-sm" data-mover-sort="${key}">${label}</button></th>`).join('')}</tr></thead><tbody>${holdingMovers(displayRows,moverOrder,moverSort).map(row=>`<tr><th scope="row"><button class="s-btn s-btn-ghost" data-open="${esc(row.ticker)}">${esc(row.ticker)}</button></th><td class="p-portfolio-holding-name">${esc(row.name||'—')}</td><td class="s-num">${money(row.price)}</td><td class="s-num ${fmt.dir(row.dayChange)}">${money(row.dayChange)}</td><td class="s-num ${fmt.dir(row.dayPercent)}">${percent(row.dayPercent)}</td></tr>`).join('')}</tbody></table></div>${displayRows.some(row=>!row.name)?'<p class="p-portfolio-note">Company names are unavailable where the holdings or quote source does not supply them.</p>':''}`;
        for(const button of body.querySelectorAll('[data-mover-sort]'))button.onclick=()=>{moverOrder=moverSort===button.dataset.moverSort&&moverOrder==='desc'?'asc':'desc';moverSort=button.dataset.moverSort;ctx.setState({moverSort,moverOrder});render();};
      } else if(tab==='risk') {
        const views=[['beta','Beta'],['volatility','Volatility'],['valuation','Valuation'],['history','History']];
        if(!views.some(([value])=>value===riskView))riskView='beta';
        let content;
        if(riskView==='beta')content=ui.unavailable('Portfolio beta','Aligned, benchmark-relative investment returns are not supplied by the current holdings source. Recorded account values do not establish beta.')+(risk.complete?`<h3>Position concentration</h3><p class="p-portfolio-note">Calculated from current USD values. Concentration is separate from beta and volatility.</p><dl class="p-portfolio-facts"><dt>Largest position</dt><dd>${esc(risk.largest?.symbol||'Cash only')} · ${risk.largest?percent(risk.largest.weight*100):'—'}</dd><dt>Cash weight</dt><dd>${percent(risk.cashWeight==null?null:risk.cashWeight*100)}</dd><dt>Effective stock positions</dt><dd>${number(risk.effectivePositions)}</dd><dt>Top three positions</dt><dd>${percent(risk.weights.slice(0,3).reduce((sum,row)=>sum+row.weight*100,0))}</dd></dl>`:ui.empty('Concentration needs complete USD prices and cash. Review missing quotes or unsupported positions.'));
        else if(riskView==='volatility')content=ui.unavailable('Portfolio volatility','A return series adjusted for deposits, withdrawals and position changes is required. Dated portfolio values alone cannot measure investment-return volatility.');
        else if(riskView==='valuation')content=ui.unavailable('Portfolio fair valuation','The current source does not supply intrinsic fair values or a valuation model. Cost basis and analyst price targets are not fair-value classifications.')+'<p class="p-portfolio-note">Overvalued, Near Fair Value and Undervalued classifications and their return contributions remain unavailable until a valuation source is configured.</p>';
        else content=privateValues?ui.empty('Portfolio values are hidden. Choose Show values to display history.'):'<h3>Recorded value history</h3><div data-risk-chart></div><p class="p-portfolio-note">Recorded account values only. These observations are not a benchmark-relative or cash-flow-adjusted return history. A combined observation requires a value for every selected portfolio on the same date.</p>';
        body.innerHTML=subTabs(views,riskView,'risk-view','Portfolio risk view')+content;
        for(const button of body.querySelectorAll('[data-risk-view]'))button.onclick=()=>{riskView=button.dataset.riskView;ctx.setState({riskView});render();};
        const chart=body.querySelector('[data-risk-chart]');if(chart){renderChart(chart,combinedHistory(accounts),riskChartState);const saveRiskRange=()=>ctx.setState({riskRange:riskChartState.range,riskFrom:riskChartState.from,riskTo:riskChartState.to});chart.addEventListener('click',saveRiskRange);chart.addEventListener('submit',saveRiskRange);}
      } else if(tab==='insights') {
        const views=[['performance','Performance'],['assets','Asset allocation'],['sectors','Sector allocation']];
        if(!views.some(([value])=>value===insightView))insightView='performance';
        let content;
        if(insightView==='performance'){
          const basis=displayRows.every(row=>row.costBasis!=null)?displayRows.reduce((sum,row)=>sum+row.costBasis,0):null;
          content=`<h3>Current holdings performance</h3><div class="p-portfolio-metrics">${[['Market value',money(totals.value)],['Supported-stock cost basis',money(basis)],['Unrealized P&L',money(totals.gain)],['Unrealized return',percent(totals.gainPercent)]].map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div><p class="p-portfolio-note">Current quantities and recorded purchase costs. Market value includes USD cash. Returns exclude realized trades, dividends, deposits and withdrawals.</p>`;
        }else if(insightView==='assets')content=risk.complete&&risk.total>0?'<h3>Asset allocation</h3>'+allocation([{name:'USD stocks',value:risk.total-totals.cash,weight:100*(risk.total-totals.cash)/risk.total},{name:'USD cash',value:totals.cash,weight:100*totals.cash/risk.total}])+'<p class="p-portfolio-note">Supported USD stocks and cash only. Other broker positions or currencies require complete USD valuation before an allocation can be shown.</p>':ui.unavailable('Asset allocation','A complete positive USD total is required. Missing prices, unsupported positions or other cash currencies prevent a complete allocation.');
        else{
          const sectors=portfolioSectorAllocation(totals.rows,prices);
          content=sectors.complete&&sectors.coverage>0?'<h3>Sector allocation</h3><p class="p-portfolio-note">'+number(sectors.coverage*100)+'% of supported-stock value has a sector classification. Weights use stocks only; USD cash is shown in Asset allocation.</p>'+allocation(sectors.rows):ui.unavailable('Sector allocation',sectors.complete?'The current holdings and quote sources do not supply sector classifications for these positions. No sectors are inferred from ticker names.':'Complete stock prices and sector classifications are required.');
        }
        body.innerHTML=subTabs(views,insightView,'insight-view','Portfolio insights view')+content+'<button class="s-btn" data-insight-ai>Ask about these holdings</button>';
        for(const button of body.querySelectorAll('[data-insight-view]'))button.onclick=()=>{insightView=button.dataset.insightView;ctx.setState({insightView});render();};
        body.querySelector('[data-insight-ai]').onclick=()=>bus.emit('ai:ask',{prompt:'Review the concentration and upcoming events for my selected holdings.',context:totals.rows.map(r=>r.ticker).join(', '),panelType:'portfolio-holdings'});
      } else if(tab==='news') {
        body.innerHTML=ui.loading('Loading news for selected holdings…');const symbols=totals.rows.map(r=>r.ticker);newsController=new AbortController();const signal=newsController.signal;
        if(!symbols.length)body.innerHTML=ui.empty('Add holdings to see portfolio news.');
        else Promise.all(Array.from({length:Math.ceil(symbols.length/12)},(_,i)=>ctx.api('news/feed',{scope:'watchlist',symbols:symbols.slice(i*12,i*12+12).join(',')},{signal}))).then(results=>{
          if(dead||signal.aborted||tab!=='news')return;const items=[...new Map(results.flatMap(d=>d.items||[]).map(i=>[i.id,i])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)).slice(0,30);
          body.innerHTML=items.length?items.map(i=>{let url='';try{const u=new URL(i.url);if(['http:','https:'].includes(u.protocol))url=u.href;}catch{}return `<article class="p-portfolio-story"><a href="${esc(url||'#')}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><p>${esc(i.summary||'')}</p><small>${esc(i.source)} · ${esc(fmt.date(i.date))}</small></article>`;}).join(''):ui.empty('No recent news returned for selected holdings.');addTabs(body);
        }).catch(e=>{if(dead||signal.aborted)return;body.innerHTML=ui.error(e.message);body.querySelector('[data-retry]').onclick=()=>render();addTabs(body);});
      }
      for(const b of body.querySelectorAll('[data-open]')) b.onclick=()=>ctx.openSymbol(b.dataset.open);
      addTabs(body);
    }
    async function update({silent=false,signal}={}) {
      const seq=++generation;loading=true;
      signal?.addEventListener('abort',()=>{if(seq===generation)loading=false;},{once:true});if(!data)el.innerHTML=ui.loading('Loading portfolios…');
      try {
        const value=await loadPortfolioData(false,{quotesOnly:silent});
        if(dead||seq!==generation||signal?.aborted){if(signal)throw new DOMException('Aborted','AbortError');return;}
        data=value;checkedAt=value.quoteCheckedAt;refreshError=value.unavailable.length || value.broker.stale ? new Error('Some quotes or broker holdings could not be updated.') : null;
        if(!source)source=data.broker.connected?'linked':'manual';if(!silent&&!refreshError)poll.recordSuccess();render();
        if(silent&&refreshError)throw refreshError;
      } catch(e){
        if(dead||seq!==generation||signal?.aborted){if(signal)throw new DOMException('Aborted','AbortError');return;}
        refreshError=e;
        if(data)updateStatus();else{el.innerHTML=ui.error(e.message);el.querySelector('[data-retry]').onclick=()=>update();}
        if(silent)throw e;
      } finally {if(seq===generation)loading=false;}
    }
    const poll=createLiveRefresh({el,interval:60000,enabled:()=>!loading&&!editing(),refresh:signal=>update({silent:true,signal}),onState:state=>{liveState=state;updateStatus();}});
    const off=bus.on('portfolio:changed',()=>update());
    const syncPrivacy=()=>{privateValues=store.get('portfolio:private',false);if(data)render();};
    const offPrivacy=bus.on('portfolio:privacy',syncPrivacy);
    const storage=e=>{if(e.key==='watchlist-pulse-portfolios-v1'||e.key===null)refresh();if(e.key==='space:portfolio:private'||e.key===null)syncPrivacy();};window.addEventListener('storage',storage);
    update();
    return {csv(){return !privateValues&&totals?.rows.length?toCSV(totals.rows):null;},scoutContext(){return privateValues?'Portfolio values are hidden.':totals?`Portfolio USD value: ${totals.value??'unavailable'}. Holdings: ${totals.rows.map(r=>r.ticker).join(', ')}.`:'';},destroy(){dead=true;poll.destroy();newsController?.abort();off();offPrivacy();window.removeEventListener('storage',storage);}};
  }
});

export async function selectedPortfolioHoldings() {
  if (store.get('portfolio:private',false)) return [];
  const d=await loadPortfolioData();
  if (store.get('portfolio:private',false)) return [];
  const active=store.get('portfolio:active',{}),source=active.source||(d.broker.connected?'linked':'manual');
  return holdingsContext(portfolioSelection(d,source,active.account||'').accounts);
}

import {readPortfolios, writePortfolios, summarize, combinedHistory} from './portfolio-model.js';
import {brokerControls, loadBrokers} from './portfolio-broker.js';
import {editAccount} from './portfolio-editor.js';
import {renderChart} from './portfolio-chart.js';

const cashFormat = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'});
const money = n => n == null ? '—' : cashFormat.format(n);
const signed = n => n == null ? '—' : (n > 0 ? '+' : '') + money(n);
const tint = n => n < 0 ? 'pf-down' : n > 0 ? 'pf-up' : '';
const esc = text => String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fmtDay = date => new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
let selected = '', generation = 0;
const chartState = {range:'6M'};

function metric(title,value,change,percentage) {
  return `<div><span>${title}</span><strong class="${tint(change)}">${value}${percentage == null ? '' : ' <small>('+percentage.toFixed(2)+'%)</small>'}</strong></div>`;
}

function holdingsTable(rows) {
  if (!rows.length) return '<p class="pf-muted">This account holds cash only.</p>';
  return `<div class="pf-scroll"><table><thead><tr>${['Ticker','Shares','Price','Value','Day change','Unrealized G/L'].map(t=>'<th scope="col">'+t+'</th>').join('')}</tr></thead>
    <tbody>${rows.map(row=>`<tr><th scope="row">${esc(row.ticker)}</th><td>${row.shares.toLocaleString('en-US',{maximumFractionDigits:8})}</td><td>${money(row.price)}</td><td>${money(row.value)}</td><td class="${tint(row.dayChange)}">${signed(row.dayChange)}</td><td class="${tint(row.gain)}">${signed(row.gain)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function getJSON(path, tickers) {
  const res = await fetch('/api/'+path+'?tickers='+encodeURIComponent(tickers.join(',')),{signal:AbortSignal.timeout(45000)});
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}

async function loadEvents(target, symbols) {
  if (!symbols.length) {
    target.textContent = 'Add a stock to see related events.';
    return;
  }
  try {
    const batches = await Promise.allSettled(chunks(symbols).map(batch => getJSON('calendar',batch)));
    const events = new Map();
    for (const r of batches) if (r.status === 'fulfilled') for (const e of r.value.events) events.set(e.date+e.title,e);
    const items = [...events.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4);
    target.innerHTML = items.map(e=>`<div class="pf-event"><time>${fmtDay(e.date)}</time><span>${esc(e.title)}<small>${e.scope==='related' ? 'Related to ' + esc(e.connections.map(c=>c.holding).join(', ')) : e.ticker ? esc(e.ticker)+' · Your holdings' : 'Market-wide'}</small></span></div>`).join('');
    if (!items.length) target.textContent = 'No upcoming events available.';
    if (batches.some(r=>r.status==='rejected')) target.insertAdjacentHTML('beforeend','<p>Some event lookups are unavailable.</p>');
  } catch { target.textContent = 'Event dates are unavailable right now.'; }
}
function chunks(items) {
  const out = [];
  for (let i=0;i<items.length;i+=12) out.push(items.slice(i,i+12));
  return out;
}

let preferLinked = true;
export async function mountPortfolio(main) {
  const load = ++generation;
  const broker = await loadBrokers();
  if (load !== generation || location.hash !== '#/portfolio') return;
  const url=new URL(location.href);
  const result=url.searchParams.get('broker');
  if (result) {
    const messages={linked:'Broker access authorized.',cancelled:'Broker authorization was cancelled.',expired:'The broker sign-in expired. Try again.',failed:'Broker authorization failed. Try again.'};
    broker.message=broker.error || messages[result] || broker.message;
    if (result==='linked') preferLinked=true;
    url.searchParams.delete('broker'); history.replaceState(null,'',url);
  }
  renderPortfolio(main,broker);
}

function renderPortfolio(main,broker) {
  const request = ++generation;
  let saved;
  try { saved = readPortfolios(); }
  catch { main.innerHTML='<h1>Portfolios</h1><p>Your saved portfolios could not be read on this device.</p>'; return; }
  const linkedView=Boolean(preferLinked && broker.connected);
  const accounts = linkedView ? broker.accounts : saved;
  function controls() {
    brokerControls(main.querySelector('#pf-brokers'),broker,()=>mountPortfolio(main),()=>{
      preferLinked=!preferLinked; selected=''; renderPortfolio(main,broker);
    },linkedView);
  }
  if (!accounts.some(a=>a.id===selected)) selected='';
  const shown = selected ? accounts.filter(a=>a.id===selected) : accounts;
  const symbols = [...new Set(shown.flatMap(a=>a.holdings.map(h=>h.ticker)))];
  const name = selected ? shown[0].name + ' holdings' : 'All Portfolio Holdings';
  const active = () => request === generation && location.hash === '#/portfolio' && main.querySelector('#pf-summary');
  if (!accounts.length) {
    main.innerHTML = `<div class="pf-page-tabs"><a href="#/watchlist">Watchlists</a><h1>Portfolios</h1></div>
      <section class="pf-section"><div id="pf-brokers" class="pf-brokers"></div><h2>${linkedView?'Linked accounts':'Add your first portfolio'}</h2><p>${linkedView?(broker.error?'Your linked holdings are currently unavailable.':'Link a brokerage account in SnapTrade, then refresh holdings.'):'Import a CSV file or enter your tickers and shares. Manually entered portfolios stay in this browser.'}</p>
      ${linkedView?'':'<button id="pf-new" class="pf-pill">Add holdings</button>'}</section>`;
    controls();
    if (linkedView) return;
    main.querySelector('#pf-new').onclick=()=>editor(null);
    return;
  }
  main.innerHTML = `<div class="pf-layout"><section class="pf-primary"><div class="pf-top"><div class="pf-page-tabs"><a href="#/watchlist">Watchlists</a><h1>Portfolios</h1></div>${linkedView?'':'<button id="pf-new" class="pf-pill">+ New portfolio</button>'}</div>
    <div id="pf-brokers" class="pf-brokers"></div>
    <div class="pf-filters" aria-label="Portfolio selection">${[['','All'],...accounts.map(a=>[a.id,a.name])].map(([id,title])=>`<button data-account="${esc(id)}" aria-pressed="${id===selected}">${esc(title)}</button>`).join('')}</div>
    <div id="pf-summary"></div><div id="pf-chart"></div>
    <section class="pf-section pf-recap"><div><h2>How are my portfolios doing today?</h2><p id="pf-recap"></p></div><div><h3>At a glance</h3><div id="pf-movers"></div></div></section>
    <section class="pf-section"><div class="pf-head"><h2>Holdings</h2>${!linkedView && shown.length===1 ? '<button class="pf-pill" id="pf-edit">Edit holdings</button>' : ''}</div><div id="pf-table"></div></section></section>
    <aside class="pf-dock" aria-label="Portfolio insights"><div class="pf-dock-head">Portfolio insights</div><section class="pf-card"><h2>Holdings breakdown</h2><div id="pf-allocation"></div></section><section class="pf-card"><h2>Upcoming events</h2><div id="pf-events" class="pf-muted" aria-live="polite">Loading events…</div></section>
    <section class="pf-card"><h2>Balance history</h2><p class="pf-muted">Save today’s USD value on this device or enter dated balances in Edit holdings.</p><button class="pf-pill" id="pf-snapshot" disabled>Save today’s value</button><p id="pf-saved" role="status"></p></section></aside></div>`;
  controls();
  for (const btn of main.querySelectorAll('[data-account]')) btn.onclick=()=>{selected=btn.dataset.account;renderPortfolio(main,broker);};
  function editor(account) {
    const baseline = JSON.stringify(saved);
    editAccount(account, next=>{
      const latest = readPortfolios();
      if (JSON.stringify(latest)!==baseline) throw new Error('Your portfolios changed in another tab. Reload and try again.');
      writePortfolios([...latest.filter(a=>a.id!==next.id),next]);
      selected=next.id;renderPortfolio(main,broker);
    });
  }
  if (!linkedView) main.querySelector('#pf-new').onclick=()=>editor(null);
  const edit = main.querySelector('#pf-edit');
  if (edit) edit.onclick=()=>editor(shown[0]);
  function paint(prices, pending) {
    const s = summarize(shown,prices);
    const incomplete=linkedView && shown.some(a=>!a.complete);
    if (incomplete) Object.assign(s,{value:null,dayChange:null,dayPercent:null,gain:null,gainPercent:null,cash:null});
    const missing = s.rows.filter(row=>row.price===null).map(row=>row.ticker);
    const times = Object.values(prices).map(q=>Date.parse(q.asOf)).filter(Number.isFinite);
    const stamp = times.length ? ' · Oldest quote '+new Date(Math.min(...times)).toLocaleString() : '';
    main.querySelector('#pf-summary').innerHTML=`<p class="pf-muted">${esc(name)}</p><div class="pf-value">${money(s.value)}</div>
      <div class="pf-metrics">${metric('Cash holdings',money(s.cash))}${metric('Day change',signed(s.dayChange),s.dayChange,s.dayPercent)}${metric('Unrealized gain/loss',signed(s.gain),s.gain,s.gainPercent)}<div title="Realized gains require a record of completed sales."><span>Realized gain/loss</span><strong>—</strong></div></div>
      <p class="pf-note">${incomplete?'USD totals unavailable for this mix of positions or cash balances. ':''}${pending ? 'Loading quotes…' : missing.length ? 'Quotes unavailable for '+esc(missing.join(', ')) : 'USD'+esc(stamp)}</p>`;
    const points = combinedHistory(shown);
    if (s.value !== null && !points.some(p=>p.date===today())) points.push({date:today(),value:s.value});
    if (linkedView) main.querySelector('#pf-chart').hidden=true;
    else renderChart(main.querySelector('#pf-chart'),points,chartState);
    main.querySelector('#pf-table').innerHTML=holdingsTable(s.rows);
    if (linkedView) {
      const details=main.querySelector('#pf-table');
      if (!s.rows.length) details.innerHTML='';
      for (const a of shown) {
        const rows=[...a.other.map(p=>[p.symbol,p.shares??'—',p.price??'—',p.currency??'—']),
          ...a.balances.map(b=>['Cash','—',b.cash??'—',b.currency??'—'])];
        details.insertAdjacentHTML('beforeend',`<h3>${esc(a.name)}</h3><p class="pf-note">Broker positions as of ${a.asOf && Number.isFinite(Date.parse(a.asOf))?esc(new Date(a.asOf).toLocaleString()):'an unreported time'}.</p>${rows.length?`<div class="pf-scroll"><table><thead><tr><th>Asset</th><th>Units</th><th>Price or cash</th><th>Currency</th></tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')}</tbody></table></div>`:''}`);
      }
    }
    const movers=s.rows.filter(r=>r.dayChange!==null).sort((a,b)=>Math.abs(b.dayChange)-Math.abs(a.dayChange)).slice(0,4);
    const movement = s.dayChange === 0 ? 'are flat' : s.dayChange > 0 ? 'are up ' + money(s.dayChange) : 'are down ' + money(Math.abs(s.dayChange));
    main.querySelector('#pf-recap').textContent = s.dayChange == null ? 'The daily summary needs a current price and previous close for each position.' : 'Your selected holdings ' + movement + ' since the previous close, based on your current share counts.';
    const weights = [...s.rows.map(row=>({name:row.ticker,value:row.value})),{name:'Cash',value:s.cash}].filter(row=>row.value>0).sort((a,b)=>b.value-a.value);
    main.querySelector('#pf-allocation').innerHTML = s.value > 0 ? weights.slice(0,4).map(row=>{
      const percent=row.value / s.value * 100;
      return `<div class="pf-weight"><div><strong>${esc(row.name)}</strong><span>${percent.toFixed(1)}%</span></div><progress value="${percent}" max="100" aria-label="${esc(row.name)} share of holdings value"></progress></div>`;
    }).join('') : '<p class="pf-muted">Weights appear when your holdings have a total market value.</p>';
    main.querySelector('#pf-movers').innerHTML=movers.length ? movers.map(r=>`<div class="pf-mover"><strong>${esc(r.ticker)}</strong><span class="${tint(r.dayChange)}">${signed(r.dayChange)}</span></div>`).join('')+'<p class="pf-note">Price change × current shares, since the prior close.</p>' : '<p class="pf-muted">Day changes appear when current and previous prices are available.</p>';
    const snapshot=main.querySelector('#pf-snapshot');
    if (linkedView && snapshot) snapshot.closest('section').hidden=true;
    if (snapshot && !linkedView) {
      snapshot.disabled=s.value===null || pending;
      snapshot.onclick=()=>{
        try {
          const current=readPortfolios();
          if (JSON.stringify(current)!==JSON.stringify(saved)) throw new Error('Your portfolios changed. Reload before saving.');
          saved=writePortfolios(current.map(a=>{
            if (!shown.some(x=>x.id===a.id)) return a;
            const history = a.history.filter(p=>p.date!==today());
            return {...a,history:[...history,{date:today(),value:summarize([a],prices).value}]};
          }));
          renderPortfolio(main,broker);
          main.querySelector('#pf-saved').textContent='Today’s balance saved.';
        } catch (err) { main.querySelector('#pf-saved').textContent=err.message; }
      };
    }
  }
  const brokerPrices=Object.assign({},...shown.map(a=>a.prices));
  paint(brokerPrices, symbols.length>0);
  loadEvents(main.querySelector('#pf-events'),symbols);
  if (!symbols.length) return;
  Promise.allSettled(chunks(symbols).map(batch=>getJSON('portfolio-quotes',batch))).then(results=>{
    if (!active()) return;
    const prices=Object.assign({},brokerPrices,...results.filter(r=>r.status==='fulfilled').map(r=>r.value.prices));
    paint(prices,false);
  });
}

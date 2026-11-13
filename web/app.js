'use strict';
const sampleMode = new URLSearchParams(location.search).get('seed') === 'demo';
const KEY = sampleMode ? 'watchlist-pulse-demo' : 'watchlist-pulse';
const MAX_WATCHLIST = 40;
const STOCK_SYMBOL = /^[A-Z]{1,5}(?:[.-][A-Z])?$/;
let watchStore, batchData, writingWatchlist = false, liveController;
let live = null;
let liveError = '';
let liveLoading = false;
let requestVersion = 0;
const demo = ['AAPL', 'META', 'NVDA', 'TSLA'];
const main = document.querySelector('main');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let watchlist = sampleMode ? demo : [];
let data;
let storageAvailable = true;
try {
  const stored = JSON.parse(localStorage.getItem(KEY));
  if (Array.isArray(stored)) watchlist = stored.filter(x => typeof x === 'string');
} catch { storageAvailable = false; }
const navItems = sampleMode ? ['Home', 'Briefing', 'Watchlist', 'Ledger'] : ['Home', 'Briefing', 'Portfolio', 'Calendar', 'Watchlist', 'Ledger'];
const pageNames = { home: 'Overview', briefing: 'News tracker', portfolio: 'Portfolio', calendar: 'Calendar', watchlist: 'Watchlist', ledger: 'Ledger', setup: 'Setup & download' };
const affected = item => item.affected.filter(t => watchlist.includes(t));
const tickers = names => names.map(t => `<a class="ticker" href="#/company/${encodeURIComponent(t)}">${escapeHTML(t)}</a>`).join('');
const confidence = item => `<span class="confidence">${item.confidence} confidence</span>`;
const direction = item => `<span class="direction ${item.direction}" aria-label="${item.direction}">${item.direction === 'positive' ? '+' : '−'}</span>`;
const heading = (title, sub, eyebrow = 'Your watchlist, in context') => `<div class="page-head"><h1>${title}</h1><p class="muted">${sub}</p><div class="page-meta">${eyebrow}</div></div>`;
function impacts(items) {
  return items.length ? `<div class="panel">${items.map(item => `<article class="impact">${direction(item)}<div><div class="eyebrow">${item.category || item.id}</div><h3>${item.title}</h3><p>${item.reason}</p><div class="meta">${tickers(affected(item))}<span class="small ${item.direction}">${item.direction === 'positive' ? 'Positive' : 'Negative'} impact</span></div>${item.logged ? `<div class="hint">Logged ${item.logged} · ${item.status}</div>` : ''}</div>${confidence(item)}</article>`).join('')}</div>` : '<div class="panel empty">No sample predictions cover these names. Edit your watchlist to explore AAPL, META, NVDA or TSLA.</div>';
}
const brokerLink = '<a class="link" href="#/portfolio">SnapTrade broker connection</a>';
function editor(onboarding = false) {
  return `<form class="${onboarding ? '' : 'panel editor'}" id="watchlist-form">
    <label for="companies">Add companies</label>
    <input id="companies" name="companies" autocomplete="off" placeholder="e.g. Apple, NVDA, Tesla" aria-describedby="company-hint" required maxlength="500">
    <div id="company-hint" class="hint">Tickers save on this device without a live data connection. Company names need lookup. Use commas to follow up to 40 companies.</div>
    <div id="form-error" class="error" role="alert"></div>
    <button class="button" type="submit">${onboarding ? 'Create watchlist' : 'Add to watchlist'}</button>
  </form>`;
}

function saveWatchlist(values) {
  try {
    writingWatchlist = true;
    if (watchStore) {
      const saved = watchStore.write(values);
      if (saved === null) throw new Error('Storage unavailable');
      values = saved;
    }
    else localStorage.setItem(KEY, JSON.stringify(values));
    storageAvailable = true;
  } catch {
    storageAvailable = false;
    document.querySelector('#form-error').textContent = 'Browser storage is unavailable. Enable local storage to save your watchlist.';
    return;
  } finally { writingWatchlist = false; }
  watchlist = values;
  live = null;
  liveError = '';
  ++requestVersion;
  liveLoading = false;
  if (location.hash !== '#/watchlist') history.pushState(null, '', '#/watchlist');
  render();
  document.querySelector('#companies').focus();
  if (!sampleMode && values.length) loadLive();
}

function bindForm() {
  const form = document.querySelector('#watchlist-form');
  if (!form) return;
  for (const button of main.querySelectorAll('[data-remove]')) {
    button.onclick = () => saveWatchlist(watchlist.filter(ticker => ticker !== button.dataset.remove));
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const aliases = {APPLE:'AAPL','APPLE INC':'AAPL',META:'META',FACEBOOK:'META',NVIDIA:'NVDA',TESLA:'TSLA',INTEL:'INTC','INTEL CORPORATION':'INTC'};
    const rawEntries = [...new Set(form.elements.companies.value.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean))];
    const entries = rawEntries.map(raw => ({ raw, value: aliases[raw.toUpperCase()] || raw.toUpperCase(),
      explicit: !!aliases[raw.toUpperCase()] || STOCK_SYMBOL.test(raw.toUpperCase()) && (raw === raw.toUpperCase() || raw === raw.toLowerCase()) }));
    let values = [...new Set(entries.map(entry => entry.value))];
    const error = form.querySelector('#form-error');
    if (!values.length || values.some(x => !/^[A-Z0-9 .&'’()-]{1,60}$/.test(x)) || values.length > MAX_WATCHLIST) {
      error.textContent = 'Enter 1–40 tickers or company names, separated by commas (up to 60 characters each).';
      return;
    }
    error.textContent = '';
    const button = form.querySelector('button');
    if (button.disabled) return;
    const label = button.textContent;
    try {
      values = values.filter(ticker => !watchlist.includes(ticker));
      const names = entries.filter(entry => !entry.explicit && !watchlist.includes(entry.value)).map(entry => entry.value);
      if (!sampleMode && names.length) {
        button.disabled = true;
        button.textContent = 'Resolving…';
        form.elements.companies.readOnly = true;
        const batches = await batchData.mapSymbolBatches(names, batch => api('/api/resolve?q=' + encodeURIComponent(batch.join(','))));
        const resolved = batches.results;
        if (batches.failedSymbols.length || resolved.some(result => result.unresolved?.length || result.errors?.length || result.companies?.some(company => company.verified === false))) {
          throw new Error('Company-name lookup is unavailable or ambiguous. Enter ticker symbols, such as MSFT or INTC, or try the company names again when lookup is available.');
        }
        values = [...entries.filter(entry => entry.explicit).map(entry => entry.value), ...resolved.flatMap(result => result.tickers || [])];
      }
      if (!form.isConnected) return;
      const updated = [...new Set([...watchlist, ...values])];
      if (updated.length === watchlist.length) {
        error.textContent = 'Already on your watchlist.';
      } else if (updated.length > MAX_WATCHLIST) {
        error.textContent = 'Your watchlist can hold 40 companies. Remove a company or add fewer at once.';
      } else {
        saveWatchlist(updated);
      }
    } catch (failure) {
      error.textContent = failure.message;
    } finally {
      button.disabled = false;
      button.textContent = label;
      form.elements.companies.readOnly = false;
    }
  });
}
function renderNavigation(page = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home') {
  const routes = [...navItems.map(name => name.toLowerCase()), 'setup'];
  const currentRoute = page === 'company' ? 'watchlist' : page;
  // Shared app navigation (web/shared/nav.js) renders the sidebar's Research list; plain links are the no-module fallback.
  const sharedNav = window.UltimaterNav;
  const researchNav = document.querySelector('#research-nav') || document.querySelector('nav');
  researchNav.innerHTML = sharedNav ? sharedNav.researchItemsHTML(routes, currentRoute, '') : routes.map(id => `<a href="${id === 'setup' ? '/setup' : '#/' + id}"${id === currentRoute ? ' aria-current="page"' : ''}>${pageNames[id]}</a>`).join('') + '<a href="/space?view=analysis">Analyzer</a>';
}
window.addEventListener('ultimater:nav-ready', () => { if (data) renderNavigation(); });
function liveSourceLabel(fallback = 'Research data') {
  return live?.hasFreshData ? 'Live · Finnhub' : live?.quotes?.length || live?.news?.length ? 'Previously retrieved · Finnhub' : fallback;
}
function renderOverview() {
  const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  main.innerHTML = `<section class="home-intro"><h1>Your market workspace</h1><p>Track company news, manage your portfolio, and research stocks in one place.</p></section>
    <nav class="home-workspaces" aria-label="Choose a workspace">
      <a class="home-workspace home-workspace-primary" href="#/briefing"><div><h2>News tracker</h2><p>Follow the companies you care about and read the news that could affect them.</p><span>${watchlist.length ? `${watchlist.length} ${watchlist.length === 1 ? 'company' : 'companies'} on your watchlist` : 'Start with your watchlist'}</span></div><span class="home-workspace-action">Open news tracker ${arrow}</span></a>
      <a class="home-workspace" href="${sampleMode ? '/#/portfolio' : '#/portfolio'}"><div><h2>Portfolio</h2><p>Keep holdings, purchase costs, allocation, and account history together.</p></div><span class="home-workspace-action">Open portfolio ${arrow}</span></a>
      <a class="home-workspace" href="/space?view=analysis"><div><h2>Stock Analyzer</h2><p>Explore charts, company financials, earnings, options, and market themes.</p></div><span class="home-workspace-action">Open Analyzer ${arrow}</span></a>
    </nav>
    <section class="home-local"><div><h2>Run the full app on your computer</h2><p>Download Ultimater from GitHub, then connect your data providers in Setup. Includes the news tracker, portfolio, and Analyzer.</p><span class="hint">Requires Node.js 22 or newer.</span></div><div class="home-local-actions"><a class="button" href="https://github.com/zandy700/supply-chain-shock-map/releases/latest/download/ultimater-local-app.zip">Download local app</a><a class="link" href="/setup">API setup & installation guide</a></div></section>`;
}
function render() {
  if (!data) return;
  document.querySelector('.sample').textContent = sampleMode ? 'Sample data' : liveSourceLabel('Research dashboard');
  document.querySelector('footer').innerHTML = sampleMode
    ? 'Illustrative scenarios only. <a class="link" href="/#/briefing">Switch to Live</a>'
    : 'Headline heuristics are unreviewed scenarios, not financial advice or verified supply-chain effects. <a class="link" href="?seed=demo#/briefing">Explore Sample mode</a>';
  let [page, symbol] = location.hash.replace(/^#\/?/, '').split('/');
  if (!page) page = 'home';
  if (page === 'catalysts') {
    history.replaceState(history.state, '', '#/briefing');
    page = 'briefing';
  }
  if (!['home','briefing','watchlist','ledger','company','calendar','portfolio'].includes(page) || (sampleMode && ['portfolio','calendar'].includes(page))) page = 'briefing';
  const portfolio = page === 'portfolio';
  document.body.classList.toggle('portfolio-page',portfolio);
  const onboarding = !watchlist.length && !portfolio && page !== 'home';
  renderNavigation(page);
  if (page === 'home') {
    document.querySelector('.sample').textContent = sampleMode ? 'Sample data' : 'Overview';
    renderOverview();
  } else if (onboarding) {
    main.innerHTML = `<section class="onboarding"><div class="panel"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M3 13h3.5l2.2-5 3.6 9 2.4-6.5 1.6 2.5H21"/></svg></span><h1>A little context.<br>A clearer watchlist.</h1><p>See how other companies and the wider market could affect the names you follow.</p>${editor(true)}<div class="hint">${storageAvailable ? 'Saved on this device. No account needed.' : 'Enable browser storage to save your watchlist.'}</div>${sampleMode ? '' : '<p>'+brokerLink+'</p>'}</div><div class="hint onboarding-note">${sampleMode ? 'Sample data only. Explore illustrative scenarios.' : 'Live news depends on source availability. Sample mode is available from the footer.'}</div></section>`;
  } else if (portfolio) {
    document.querySelector('.sample').textContent = 'Portfolio';
    document.querySelector('footer').textContent = 'Portfolio quantities, costs and balances are stored in this browser. Only ticker symbols are sent for quotes and events.';
    main.innerHTML = '<p class="loading" role="status">Loading portfolio…</p>';
    import('./portfolio.js').then(module => {
      if (location.hash === '#/portfolio') module.mountPortfolio(main);
    }).catch(() => { if (location.hash === '#/portfolio') main.innerHTML = '<p role="alert">The portfolio could not load. Refresh to try again.</p>'; });
  } else if (page === 'calendar') {
    document.querySelector('.sample').textContent = 'Event calendar';
    renderCalendar();
  } else if (!sampleMode && ['briefing','company'].includes(page)) {
    renderLive(page,symbol);
  } else if (page === 'briefing') {
    const items = data.briefing.impacts.filter(i => affected(i).length);
    main.innerHTML = heading('Daily briefing', 'The developments beyond your watchlist that could move it.', data.briefing.date + ' · Sample edition') + `<section class="summary panel"><div><h2>The market in a minute</h2><p>${data.briefing.summary}</p></div><div class="market">${data.briefing.market.map(x => `<div><span>${x.label}</span><strong class="${x.direction}">${x.value}</strong></div>`).join('')}<div class="muted">Illustrative moves, not live quotes</div></div></section><div class="section-head"><h2>What could move your watchlist</h2><span class="muted small">${items.length} sample signals</span></div>${impacts(items)}`;
  } else if (page === 'watchlist') {
    main.innerHTML = heading('Your watchlist', 'Follow the companies you care about. Saved on this device.') + editor() +
      `<div class="section-head"><h2>Following (${watchlist.length}/40)</h2><a class="link" href="#/briefing">View briefing ›</a></div>
      <div class="panel">${watchlist.map(t => `<div class="watch-row">
        <a class="company-link" href="#/company/${encodeURIComponent(t)}"><strong>${escapeHTML(t)}</strong><span class="muted small" data-name="${escapeHTML(t)}">${escapeHTML(companyName(t))}</span></a>
        <button type="button" class="button secondary" data-remove="${escapeHTML(t)}" aria-label="Remove ${escapeHTML(t)} from watchlist">Remove</button>
      </div>`).join('')}</div>`;
  } else if (page === 'company') {
    try { symbol = decodeURIComponent(symbol || ''); } catch { symbol = ''; }
    const company = Object.hasOwn(data.companies, symbol) ? data.companies[symbol] : null;
    main.innerHTML = `<a class="link" href="#/watchlist">‹ Your watchlist</a>` + heading(escapeHTML(company?.name || symbol || 'Company'), company ? `${escapeHTML(symbol)} · ${company.sector}` : 'No sample relationship coverage for this company.', 'Company context · Sample data') + (company ? `<div class="panel notice">Illustrative relationship map. These examples are not verified supply-chain research.</div><div class="relation-grid">${['suppliers','customers','competitors'].map(key => `<section class="panel relation"><h2>${key[0].toUpperCase() + key.slice(1)}</h2><ul>${company[key].map(x => `<li>${x}</li>`).join('')}</ul></section>`).join('')}</div><div class="section-head"><h2>Recent impact predictions</h2><span class="muted small">Sample scenarios</span></div>${impacts(data.briefing.impacts.filter(i => i.affected.includes(symbol)).map(i => ({...i, affected:[symbol]})))}` : '<div class="panel empty">Try NVDA, AAPL, META or TSLA to explore sample company context.</div>');
  } else if (page === 'ledger') {
    main.innerHTML = heading('Prediction ledger', 'A record of the call, before the result.') + '<div class="panel notice"><strong>Not financial advice. Predictions are logged before outcomes; scores come later.</strong><p class="hint">These are seeded demonstration entries, not real forecasts or records from the research ledger. No outcomes have been scored.</p></div><div class="section-head"><h2>Sample predictions</h2><span class="muted small">Outcomes pending</span></div>' + impacts(data.ledger.entries.filter(i => affected(i).length));
  }
  document.title = `${onboarding ? 'Create your watchlist' : page === 'company' ? symbol : pageNames[page] || 'News tracker'} · Ultimater`;
  bindForm();
}
async function api(path, { signal } = {}) {
  const timeout = AbortSignal.timeout(90000);
  const response = await fetch(path, {signal:signal ? AbortSignal.any([signal, timeout]) : timeout});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Live briefing unavailable. Try again shortly.');
  return payload;
}
function companyName(ticker) {
  const name = sampleMode ? data.companies[ticker]?.name : live?.companies.find(c => c.ticker === ticker)?.name;
  return name === ticker ? '' : name || '';
}

function refreshLiveView() {
  if (location.hash === '#/portfolio') return;
  // Live responses may arrive while someone is typing or resolving the next company.
  if (!document.querySelector('#watchlist-form')) { render(); return; }
  for (const label of main.querySelectorAll('[data-name]')) label.textContent = companyName(label.dataset.name);
}

async function loadLive(extraSymbol) {
  const version = ++requestVersion;
  liveController?.abort(); liveController = new AbortController();
  liveLoading = true; liveError = ''; refreshLiveView();
  try {
    const names = [...new Set([...watchlist, ...(extraSymbol ? [extraSymbol] : [])])];
    const supported = names.filter(name => STOCK_SYMBOL.test(name));
    const batches = await batchData.mapSymbolBatches(supported, (batch, options) => api('/api/briefing?tickers=' + encodeURIComponent(batch.join(',')), options), { signal: liveController.signal });
    batches.failedSymbols.push(...names.filter(name => !STOCK_SYMBOL.test(name)));
    const briefing = batchData.mergeBriefings(batches, live);
    if (version !== requestVersion) return;
    live = briefing;
  } catch (error) { if (version === requestVersion && error.name !== 'AbortError') liveError = error.name === 'TimeoutError' ? 'Live request timed out. Try again shortly.' : error.message; }
  finally { if (version === requestVersion) { liveLoading = false; refreshLiveView(); } }
}

function liveImpacts(items) {
  if (!items.length) return '<div class="panel empty">No classified headlines for these names in the recent seven-day window. Unclassified company news appears on company pages.</div>';
  return '<div class="panel">' + items.map(item => `<article class="impact">${direction(item)}<div><div class="small muted">${escapeHTML(item.category)} · ${escapeHTML(item.date.slice(0,10))}</div><h3><a class="article-link" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a></h3><p>${escapeHTML(item.reason)}</p><div class="meta">${tickers(item.affected)}<span class="small muted">${escapeHTML(item.source)} · ${item.sign > 0 ? 'Positive' : 'Negative'} scenario</span></div></div><span class="confidence">Low confidence</span></article>`).join('') + '</div>';
}
function quoteRows(quotes) {
  return quotes.length ? '<div class="panel quote-strip">' + quotes.map(q=>`<div><strong>${escapeHTML(q.ticker)}</strong><span>$${Number(q.price).toFixed(2)} <span class="${q.change_percent >= 0 ? 'positive' : 'negative'}">${q.change_percent == null ? '' : Number(q.change_percent).toFixed(2)+'%'}</span></span><span class="hint">Quote as of ${escapeHTML(new Date(q.as_of).toLocaleString())}</span></div>`).join('') + '</div>' : '';
}
function renderLive(page,rawSymbol) {
  let symbol = '';
  try { symbol = decodeURIComponent(rawSymbol || '').toUpperCase(); } catch { /* invalid route */ }
  const title = page === 'company' ? (live?.companies.find(c=>c.ticker===symbol)?.name || symbol || 'Company') : 'Daily briefing';
  main.innerHTML = heading(escapeHTML(title), page === 'company' ? escapeHTML(symbol) + ' · Company news and context' : 'Recent developments from your companies’ news feeds, without inferred propagation.', liveSourceLabel());
  if (page === 'briefing') main.innerHTML += '<aside class="panel notice"><a class="link" href="#/calendar">View upcoming earnings and market events ›</a><div>'+brokerLink+'</div></aside>';
  if (liveLoading) { main.innerHTML += '<div class="panel notice loading" role="status">Refreshing news and quotes…</div>'; if (!live) return; }
  if (liveError) { main.innerHTML += `<div class="panel notice" role="alert">${escapeHTML(liveError)} <button class="button secondary" id="retry-live">Try again</button></div>`; document.querySelector('#retry-live').onclick=()=>loadLive(page==='company'?symbol:undefined); if (!live) return; }
  if (!live) { main.innerHTML += '<div class="panel empty loading" role="status">Live briefing is loading…</div>'; return; }
  main.innerHTML += `<div class="panel notice live-notice"><strong>${liveSourceLabel('No live data available')}</strong><span>Seven-day window · Retrieved ${escapeHTML(new Date(live.as_of).toLocaleString())}. Keyword scenarios are unreviewed, not forecasts.</span></div>`;
  if (live.notice) main.innerHTML += `<div class="panel notice">${escapeHTML(live.notice)} <a class="link" href="/setup#api-finnhub">API setup</a> · <a class="link" href="?seed=demo#/briefing">Explore Sample mode</a></div>`;
  if (live.staleSymbols?.length) main.innerHTML += `<p class="hint" role="status">Refresh incomplete. Previously retrieved results remain visible for ${escapeHTML(live.staleSymbols.join(', '))}.</p>`;
  if (live.unresolved.length) main.innerHTML += `<div class="panel notice error" role="alert">Unresolved: ${escapeHTML(live.unresolved.join(', '))}. <a class="link" href="#/watchlist">Edit watchlist</a></div>`;
  if (live.errors.length) main.innerHTML += `<div class="panel notice" role="alert">Some live data is unavailable: ${live.errors.map(e=>escapeHTML((e.ticker||e.input) + ' ' + (e.resource||'resolution') + ': ' + e.code.replaceAll('_',' '))).join('; ')}. Available results are shown. <button class="button secondary" id="retry-live">Retry</button></div>`;
  const items = live.impacts.filter(i=>page!=='company' || i.affected.includes(symbol));
  main.innerHTML += quoteRows(live.quotes.filter(q=>page!=='company'||q.ticker===symbol));
  if (page === 'company') {
    const mapped = data.graph.nodes.some(n=>n.ticker===symbol);
    if (!mapped) main.innerHTML += '<div class="panel notice">No SEC relationship map for this name in the 12-node graph. Live company news can still appear below.</div>';
    else {
      const edges = data.graph.edges.filter(e=>e.source===symbol || e.target===symbol);
      main.innerHTML += '<div class="panel notice"><strong>Illustrative relationship context · 12-node SEC graph</strong><p>Existing research relationships; not live evidence or verified propagation from these headlines.</p>' + (edges.length ? '<p>'+edges.map(e=>escapeHTML(e.source+' → '+e.target)).join(' · ')+'</p>' : '<p>No relationships recorded for this node.</p>') + '</div>';
    }
  }
  main.innerHTML += `<div class="section-head"><h2>Classified headlines</h2><span class="muted small">${items.length} live scenarios</span></div>` + (page === 'company' && !items.length ? '<div class="panel notice">No classified headlines for this name in the recent seven-day window.</div>' : liveImpacts(items));
  if (page==='company') {
    const news=live.news.filter(n=>n.affected.includes(symbol) && !n.sign).slice(0,12);
    main.innerHTML += '<div class="section-head"><h2>More company news</h2><span class="muted small">Unclassified mentions</span></div>' + (news.length ? '<div class="panel">'+news.map(n=>`<article class="news-row"><h3><a class="article-link" href="${escapeHTML(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(n.title)}</a></h3><p class="hint">${escapeHTML(n.source)} · ${escapeHTML(n.date.slice(0,10))} · No impact classification</p></article>`).join('')+'</div>' : '<div class="panel empty">No additional news available for this name.</div>');
    if (!live.tickers.includes(symbol) && !live.unresolved.includes(symbol) && /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(symbol)) {
      main.innerHTML += '<button class="button secondary" id="load-company">Load this company’s live news</button>';
      document.querySelector('#load-company').onclick=()=>loadLive(symbol);
    }
  }
  document.querySelector('#retry-live')?.addEventListener('click',()=>loadLive(page==='company'?symbol:undefined));
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); main.focus({preventScroll:true}); });
const sharedReady = Promise.all([import('./shared/watchlist-store.js'), import('./shared/watchlist-data.js'), import('./shared/nav.js')]).then(([shared, batches, nav]) => {
  batchData = batches;
  window.UltimaterNav = window.UltimaterNav || nav;
  watchStore = shared.createWatchlistStore({ key: KEY, storage: localStorage, target: window });
  if (!sampleMode) shared.migrateLegacyWatchlist(watchStore, localStorage);
  watchlist = watchStore.read(sampleMode ? demo : []);
  storageAvailable = watchStore.available();
  watchStore.subscribe(list => {
    if (writingWatchlist || list.join(',') === watchlist.join(',')) return;
    watchlist = list; live = null; liveError = ''; liveLoading = false; ++requestVersion; liveController?.abort();
    const draft = document.querySelector('#companies')?.value;
    render();
    if (draft && document.querySelector('#companies')) document.querySelector('#companies').value = draft;
    if (!sampleMode && watchlist.length) loadLive();
  });
});
Promise.all([sharedReady, Promise.all(['briefing','companies','ledger','graph'].map(async name => {
  const response = await fetch(name === 'graph' ? 'seed/graph.json' : `seed/${name}.json`);
  if (!response.ok) throw new Error('Sample data unavailable');
  return [name, await response.json()];
}))]).then(([, entries]) => { data = Object.fromEntries(entries); render(); if (!sampleMode && watchlist.length) loadLive(); }).catch(() => {
  main.innerHTML = '<div class="panel empty"><h1>Dashboard could not load</h1><p>Check your connection and reload this page.</p><button class="button" onclick="location.reload()">Reload</button></div>';
});

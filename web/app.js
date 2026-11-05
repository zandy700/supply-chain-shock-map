'use strict';
const KEY = 'watchlist-pulse';
const demo = ['AAPL', 'META', 'NVDA', 'TSLA'];
const main = document.querySelector('main');
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
let watchlist = [];
let data;
let storageAvailable = true;
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || '[]');
  watchlist = Array.isArray(stored) ? stored.filter(x => typeof x === 'string') : [];
  if (new URLSearchParams(location.search).get('seed') === 'demo') {
    watchlist = demo;
    localStorage.setItem(KEY, JSON.stringify(watchlist));
  }
} catch { storageAvailable = false; }
const navItems = ['Briefing', 'Catalysts', 'Watchlist', 'Ledger'];
const affected = item => item.affected.filter(t => watchlist.includes(t));
const tickers = names => names.map(t => `<a class="ticker" href="#/company/${encodeURIComponent(t)}">${escapeHTML(t)}</a>`).join('');
const confidence = item => `<span class="confidence">${item.confidence} confidence</span>`;
const direction = item => `<span class="direction ${item.direction}" aria-label="${item.direction}">${item.direction === 'positive' ? '+' : '−'}</span>`;
const heading = (title, sub, eyebrow = 'Your watchlist, in context') => `<div class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="muted">${sub}</p></div>`;
function impacts(items) {
  return items.length ? `<div class="panel">${items.map(item => `<article class="impact">${direction(item)}<div><div class="eyebrow">${item.category || item.id}</div><h3>${item.title}</h3><p>${item.reason}</p><div class="meta">${tickers(affected(item))}<span class="small ${item.direction}">${item.direction === 'positive' ? 'Positive' : 'Negative'} impact</span></div>${item.logged ? `<div class="hint">Logged ${item.logged} · ${item.status}</div>` : ''}</div>${confidence(item)}</article>`).join('')}</div>` : '<div class="panel empty">No sample predictions cover these names. Edit your watchlist to explore AAPL, META, NVDA or TSLA.</div>';
}
function editor(onboarding = false) {
  return `<form class="${onboarding ? '' : 'panel editor'}" id="watchlist-form"><label for="companies">${onboarding ? 'Tickers or company names' : 'Your companies'}</label><input id="companies" name="companies" autocomplete="off" placeholder="e.g. Apple, NVDA, Tesla" value="${escapeHTML(watchlist.join(', '))}" required maxlength="500"><div class="hint">Separate names with commas. Sample coverage: AAPL, META, NVDA, TSLA.</div><div id="form-error" class="error" role="alert"></div><button class="button" type="submit">${onboarding ? 'Create watchlist' : 'Save watchlist'}</button></form>`;
}
function bindForm() {
  document.querySelector('form')?.addEventListener('submit', event => {
    event.preventDefault();
    const aliases = {APPLE:'AAPL','APPLE INC':'AAPL',META:'META',FACEBOOK:'META',NVIDIA:'NVDA',TESLA:'TSLA'};
    const values = [...new Set(document.querySelector('input').value.split(/[,;\n]+/).map(x => x.trim().toUpperCase()).filter(Boolean).map(x => aliases[x] || x))];
    const error = document.querySelector('#form-error');
    if (!values.length || values.some(x => !/^[A-Z0-9 .&-]{1,60}$/.test(x)) || values.length > 30) {
      error.textContent = 'Enter 1–30 tickers or company names, separated by commas (up to 60 characters each).';
      return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(values)); storageAvailable = true; }
    catch { error.textContent = 'Browser storage is unavailable. Enable local storage to save your watchlist.'; return; }
    watchlist = values;
    if (location.hash === '#/briefing') render(); else location.hash = '/briefing';
  });
}
function render() {
  if (!data) return;
  let [page = 'briefing', symbol] = location.hash.replace(/^#\/?/, '').split('/');
  if (!['briefing','catalysts','watchlist','ledger','company'].includes(page)) page = 'briefing';
  const onboarding = !watchlist.length;
  document.querySelector('nav').innerHTML = onboarding ? '' : navItems.map(name => `<a href="#/${name.toLowerCase()}" ${page === name.toLowerCase() || (page === 'company' && name === 'Watchlist') ? 'class="active" aria-current="page"' : ''}>${name}</a>`).join('');
  if (onboarding) {
    main.innerHTML = `<section class="onboarding"><div class="panel"><span class="brand-mark">⌁</span><h1>A little context.<br>A clearer watchlist.</h1><p>See how other companies and the wider market could affect the names you follow.</p>${editor(true)}<div class="hint">${storageAvailable ? 'Saved on this device. No account needed.' : 'Enable browser storage to save your watchlist.'}</div></div><div class="hint" style="text-align:center;margin-top:20px">Sample data only. Explore illustrative scenarios.</div></section>`;
  } else if (page === 'briefing') {
    const items = data.briefing.impacts.filter(i => affected(i).length);
    main.innerHTML = heading('Daily briefing', 'The developments beyond your watchlist that could move it.', data.briefing.date + ' · Sample edition') + `<section class="summary panel"><div><h2>The market in a minute</h2><p>${data.briefing.summary}</p></div><div class="market">${data.briefing.market.map(x => `<div><span>${x.label}</span><strong class="${x.direction}">${x.value}</strong></div>`).join('')}<div class="muted">Illustrative moves, not live quotes</div></div></section><div class="section-head"><h2>What could move your watchlist</h2><span class="muted small">${items.length} sample signals</span></div>${impacts(items)}<aside class="panel callout"><div><h3>Next on the calendar</h3><p class="muted small">Earnings, inflation and the Fed. See what could matter.</p></div><a class="link" href="#/catalysts">View catalysts</a></aside>`;
  } else if (page === 'catalysts') {
    const events = data.catalysts.events.filter(i => affected(i).length);
    main.innerHTML = heading('Upcoming catalysts', 'A look ahead at events that could affect your companies.') + `<div class="panel notice">Sample calendar. Dates, expectations and scenarios are illustrative, not a real event schedule.</div>` + (events.length ? `<div class="panel">${events.map(item => `<article class="impact event"><div class="datebox"><span>${item.month}</span><strong>${item.day}</strong></div><div><div class="eyebrow">${item.type} · ${item.time}</div><h3>${item.title}</h3><p>${item.reason}</p><div class="meta">${tickers(affected(item))}<span class="small ${item.direction}">${item.direction === 'positive' ? '+' : '−'} ${item.direction} scenario</span></div></div>${confidence(item)}</article>`).join('')}</div>` : '<div class="panel empty">No sample catalysts cover your watchlist yet.</div>');
  } else if (page === 'watchlist') {
    main.innerHTML = heading('Your watchlist', 'Follow the companies you care about. Saved on this device.') + editor() + `<div class="section-head"><h2>Following</h2><span class="muted small">${watchlist.length} companies</span></div><div class="panel">${watchlist.map(t => `<a class="watch-row" href="#/company/${encodeURIComponent(t)}"><div><strong>${escapeHTML(t)}</strong><div class="muted small">${escapeHTML(data.companies[t]?.name || 'No sample company coverage')}</div></div><span class="muted small">View company ›</span></a>`).join('')}</div>`;
  } else if (page === 'company') {
    try { symbol = decodeURIComponent(symbol || ''); } catch { symbol = ''; }
    const company = Object.hasOwn(data.companies, symbol) ? data.companies[symbol] : null;
    main.innerHTML = `<a class="link" href="#/watchlist">‹ Your watchlist</a>` + heading(escapeHTML(company?.name || symbol || 'Company'), company ? `${escapeHTML(symbol)} · ${company.sector}` : 'No sample relationship coverage for this company.', 'Company context · Sample data') + (company ? `<div class="panel notice">Illustrative relationship map. These examples are not verified supply-chain research.</div><div class="relation-grid">${['suppliers','customers','competitors'].map(key => `<section class="panel relation"><h2>${key[0].toUpperCase() + key.slice(1)}</h2><ul>${company[key].map(x => `<li>${x}</li>`).join('')}</ul></section>`).join('')}</div><div class="section-head"><h2>Recent impact predictions</h2><span class="muted small">Sample scenarios</span></div>${impacts(data.briefing.impacts.filter(i => i.affected.includes(symbol)).map(i => ({...i, affected:[symbol]})))}` : '<div class="panel empty">Try NVDA, AAPL, META or TSLA to explore sample company context.</div>');
  } else if (page === 'ledger') {
    main.innerHTML = heading('Prediction ledger', 'A record of the call, before the result.') + '<div class="panel notice"><strong>Not financial advice. Predictions are logged before outcomes; scores come later.</strong><p class="hint">These are seeded demonstration entries, not real forecasts or records from the research ledger. No outcomes have been scored.</p></div><div class="section-head"><h2>Sample predictions</h2><span class="muted small">Outcomes pending</span></div>' + impacts(data.ledger.entries.filter(i => affected(i).length));
  }
  document.title = `${onboarding ? 'Create your watchlist' : page === 'company' ? symbol : navItems.find(x => x.toLowerCase() === page) || 'Briefing'} · Watchlist Pulse`;
  bindForm();
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0,0); main.focus({preventScroll:true}); });
Promise.all(['briefing','catalysts','companies','ledger'].map(async name => {
  const response = await fetch(`seed/${name}.json`);
  if (!response.ok) throw new Error('Sample data unavailable');
  return [name, await response.json()];
})).then(entries => { data = Object.fromEntries(entries); render(); }).catch(() => {
  main.innerHTML = '<div class="panel empty"><h1>Sample data could not load</h1><p>Check your connection and reload this page.</p><button class="button" onclick="location.reload()">Reload</button></div>';
});

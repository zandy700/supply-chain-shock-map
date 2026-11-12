// Options panels: options-chain, options-overview, unusual-options. Owned by the options-portfolio builder.
// Data: /api/space/options/* (delayed Nasdaq chains). IV and greeks are DERIVED client-side with
// Black-Scholes (options-math.js) from bid/ask mids; every derived figure is labeled as such.
import { registerPanel, api, bus, fmt, esc, toCSV, state as ui } from '../core.js';
import { analyze, yearsToExpiry, etCloseMs, payoffStats, payoffAt, profitChance, expectedMove, RISK_FREE_RATE } from './options-math.js';
import { createOptionRefresh, observePanel, refreshControls, refreshHTML, optionSource, optionSourceHTML } from './options-refresh.js';
import { readPortfolios } from '../../portfolio-model.js';

// Option premiums trade in cents: always two decimals.
const opx = v => fmt.num(v, 2);
const COLS = {
  last: { label: 'Last', get: q => q.last, f: opx },
  chg: { label: 'Chg', get: q => q.chg, f: v => fmt.change(v), dir: true },
  bid: { label: 'Bid', get: q => q.bid, f: opx },
  ask: { label: 'Ask', get: q => q.ask, f: opx },
  vol: { label: 'Vol', get: q => q.vol, f: v => fmt.compact(v), bar: true },
  oi: { label: 'Open Int.', get: q => q.oi, f: v => fmt.compact(v) },
  iv: { label: 'IV*', get: (q, a) => a.iv, f: v => (v == null ? '—' : fmt.num(v * 100, 1) + '%'), derived: true },
  delta: { label: 'Δ*', get: (q, a) => a.delta, f: v => fmt.num(v, 3), derived: true },
  gamma: { label: 'Γ*', get: (q, a) => a.gamma, f: v => fmt.num(v, 4), derived: true },
  theta: { label: 'Θ*', get: (q, a) => a.theta, f: v => fmt.num(v, 3), derived: true },
  vega: { label: 'Vega*', get: (q, a) => a.vega, f: v => fmt.num(v, 3), derived: true }
};
const COL_TITLES = { iv: 'Implied volatility (derived)', delta: 'Delta (derived)', gamma: 'Gamma (derived)', theta: 'Theta per day (derived)', vega: 'Vega per vol point (derived)', oi: 'Open interest (prior day)' };
const DEFAULT_COLS = ['bid', 'ask', 'vol', 'oi', 'iv', 'delta'];
const DERIVED_NOTE = `*Derived: Black-Scholes on bid/ask mid, r = ${(RISK_FREE_RATE * 100).toFixed(1)}% (fixed assumption), no dividends, European exercise.`;
const SOURCE_LABEL = 'Options source not loaded.';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const expLabel = (iso, withYear) => { const [y, m, d] = iso.split('-'); const thisYear = String(new Date().getFullYear()); return `${MONTHS[+m - 1]} ${+d}${withYear || y !== thisYear ? ', ' + y : ''}`; };
const money = v => (v != null && Number.isFinite(+v) ? '$' + fmt.price(v) : '—');
const omoney = v => (v != null && Number.isFinite(+v) ? '$' + fmt.num(v, 2) : '—');
const usd0 = v => (v === Infinity ? 'Unlimited' : v != null && Number.isFinite(+v) ? '$' + fmt.num(v, 0) : '—');
const isLive = iso => (etCloseMs(iso) ?? 0) > Date.now();
const errText = e => ({ no_options_for_symbol: 'No listed options for this symbol.', invalid_symbol: 'Not a valid symbol.', rate_limited: 'Data provider is rate limiting. Try again shortly.' }[e?.message] || 'Options data is unavailable right now.');

function bindRetry(el, fn) { el.querySelector('[data-retry]')?.addEventListener('click', fn); }

// Popup menu of checkboxes (column chooser). Closes on outside click / Escape.
let closeColumnMenu = null;
function checkMenu(anchor, items, onToggle, {onMove,onReset}={}) {
  closeColumnMenu?.();
  const m = document.createElement('div');
  m.className = 's-menu p-opt-menu'; m.setAttribute('role', 'menu');
  const draw = () => {m.innerHTML = '<div class="s-menu-label">Columns</div>' + items.map((i,index) => `<div class="p-opt-column-row" role="presentation"><button role="menuitemcheckbox" aria-checked="${i.on}" data-id="${i.id}">${esc(i.label)}</button>${onMove?`<button role="menuitem" data-column-move="-1" data-id="${i.id}" aria-label="Move ${esc(i.label)} up" ${index===0?'disabled':''}>↑</button><button role="menuitem" data-column-move="1" data-id="${i.id}" aria-label="Move ${esc(i.label)} down" ${index===items.length-1?'disabled':''}>↓</button>`:''}</div>`).join('')+(onReset?'<button role="menuitem" data-column-reset>Reset columns</button>':'');};draw();
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, Math.min(r.right - m.offsetWidth, innerWidth - m.offsetWidth - 8)) + 'px';
  const close = () => { m.remove(); document.removeEventListener('pointerdown', outside, true); if (closeColumnMenu === close) closeColumnMenu = null; if (anchor.isConnected) anchor.focus(); };
  closeColumnMenu = close;
  const outside = e => { if (!m.contains(e.target) && e.target !== anchor) close(); };
  document.addEventListener('pointerdown', outside, true);
  m.addEventListener('keydown', e => {
    const btns = [...m.querySelectorAll('button')].filter(b=>!b.disabled), i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length].focus(); }
  });
  m.addEventListener('click', e => {
    const reset=e.target.closest('[data-column-reset]');if(reset){items=onReset();draw();m.querySelector('[data-column-reset]').focus();return;}
    const b = e.target.closest('button[data-id]'); if (!b) return;
    if(b.hasAttribute('data-column-move')){items=onMove(b.dataset.id,+b.dataset.columnMove);draw();m.querySelector(`[data-id="${b.dataset.id}"][data-column-move="${b.dataset.columnMove}"]`)?.focus();return;}
    const on = b.getAttribute('aria-checked') !== 'true';
    const next=onToggle(b.dataset.id,on);if(next!==false){if(Array.isArray(next)){items=next;draw();m.querySelector(`[data-id="${b.dataset.id}"][role=menuitemcheckbox]`)?.focus();}else b.setAttribute('aria-checked',on);}
  });
  m.querySelector('button')?.focus();
}

// ---------------------------------------------------------------- Contract detail popover
function contractDetail(host, { symbol, expiry, strike, kind, quote, spot, analysis, dte, sourceData, onClose }) {
  bus.emit('options:contract',{symbol,expiry,strike,kind});
  host.querySelector('.p-opt-pop')?.remove();
  const pop = document.createElement('div');
  pop.className = 'p-opt-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false');
  const title = `${symbol} $${fmt.price(strike)} ${kind === 'call' ? 'Call' : 'Put'}`;
  pop.setAttribute('aria-label', `${title} contract detail`);
  host.append(pop);
  let position = 'long';
  const T = yearsToExpiry(expiry);
  const render = () => {
    const premium = analysis.price;
    const st = premium ? payoffStats(kind, position, strike, premium) : null;
    const chance = st && analysis.iv ? profitChance(kind, position, spot, st.breakEven, T, analysis.iv) : null;
    const em = analysis.iv ? expectedMove(spot, analysis.iv, T) : null;
    const g = k => (analysis[k] == null ? '—' : COLS[k].f(analysis[k]));
    pop.innerHTML = `<div class="p-opt-pop-head"><div><strong>${esc(title)}</strong><span class="s-muted">${esc(expLabel(expiry, true))} · ${dte}D</span></div>
      <div class="s-seg" role="group" aria-label="Position"><button data-pos="long" aria-pressed="${position === 'long'}">Long</button><button data-pos="short" aria-pressed="${position === 'short'}">Short</button></div>
      <button class="s-icon-btn" data-close aria-label="Close contract detail">✕</button></div>
      <div class="p-opt-pop-grid">
        <div><span>Spot</span><b>${money(spot)}</b></div>
        <div><span>Premium (${esc(analysis.priceBasis || '—')})</span><b>${omoney(premium)}</b></div>
        <div><span>Bid / Ask</span><b>${omoney(quote.bid)} / ${omoney(quote.ask)}</b></div>
        <div><span>Last · Chg</span><b>${omoney(quote.last)} <i class="${fmt.dir(quote.chg)}">${fmt.change(quote.chg)}</i></b></div>
        <div><span>Volume · OI</span><b>${fmt.compact(quote.vol)} · ${fmt.compact(quote.oi)}</b></div>
        <div><span>Break even</span><b>${st ? money(st.breakEven) : '—'}</b></div>
        <div><span>Max gain</span><b class="s-up">${st ? usd0(st.maxGain) : '—'}</b></div>
        <div><span>Max loss</span><b class="s-down">${st ? usd0(st.maxLoss) : '—'}</b></div>
        <div><span>Profit chance*</span><b>${chance == null ? '—' : fmt.num(chance * 100, 1) + '%'}</b></div>
        <div><span>Expected move*</span><b>${em == null ? '—' : '±' + money(em)}</b></div>
        <div><span>IV*</span><b>${g('iv')}</b></div>
        <div><span>Δ* Γ*</span><b>${g('delta')} · ${g('gamma')}</b></div>
        <div><span>Θ*/day · Vega*</span><b>${g('theta')} · ${g('vega')}</b></div>
      </div>
      <div class="p-opt-payoff" aria-label="Profit and loss at expiry per contract">${premium ? payoffSVG(kind, position, strike, premium, spot, em) : '<p class="s-muted">No price to chart.</p>'}</div>
      <p class="p-opt-note">Per contract (×100) at expiry. *Derived from the displayed quotes (Black-Scholes, risk-neutral, IV from mid). Not advice.</p>
      <div class="p-opt-source">${optionSourceHTML(sourceData,quote)}</div><div class="p-opt-pop-actions"><button class="s-btn s-btn-sm" data-ask>Ask Ultimater AI</button><button class="s-btn s-btn-sm" data-alert>Alert on ${esc(symbol)}</button></div>`;
  };
  render();
  const close = () => { pop.remove(); onClose?.(); };
  pop.addEventListener('click', e => {
    const pos = e.target.closest('[data-pos]');
    if (pos) { position = pos.dataset.pos; render(); pop.querySelector(`[data-pos="${position}"]`).focus(); return; }
    if (e.target.closest('[data-close]')) close();
    if (e.target.closest('[data-ask]')) bus.emit('ai:ask', { prompt: `Explain the risk/reward of a ${position} ${title} expiring ${expiry}.`, context: `${title} exp ${expiry} (${dte} DTE). Spot ${spot}. Bid ${quote.bid} Ask ${quote.ask} Last ${quote.last} Vol ${quote.vol} OI ${quote.oi}. Derived IV ${analysis.iv == null ? 'n/a' : (analysis.iv * 100).toFixed(1) + '%'}, delta ${analysis.delta?.toFixed(3) ?? 'n/a'}. ${optionSource(sourceData,quote)}`, panelType: 'options-chain' });
    if (e.target.closest('[data-alert]')) bus.emit('alerts:create', { symbol, price: spot });
  });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  pop.querySelector('[data-close]').focus();
  return close;
}

function payoffSVG(kind, position, K, premium, spot, em) {
  const W = 320, H = 150, pad = { l: 44, r: 8, t: 8, b: 20 };
  const span = Math.max(em ? em * 2.2 : 0, spot * 0.12, Math.abs(K - spot) * 1.4, premium * 3);
  const x0 = Math.max(0.01, Math.min(spot, K) - span), x1 = Math.max(spot, K) + span;
  const N = 80, pts = [];
  for (let i = 0; i <= N; i++) { const s = x0 + (x1 - x0) * i / N; pts.push([s, payoffAt(kind, position, K, premium, s)]); }
  let lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  if (hi === lo) { hi += 1; lo -= 1; }
  const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
  const X = s => pad.l + (s - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = v => pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b);
  const line = pts.map(([s, v]) => `${X(s).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const zero = Y(0);
  const area = `${X(x0).toFixed(1)},${zero.toFixed(1)} ${line} ${X(x1).toFixed(1)},${zero.toFixed(1)}`;
  const id = 'pf' + Math.random().toString(36).slice(2, 8);
  const be = kind === 'call' ? K + premium : K - premium;
  const ticks = [hi - padY, 0, lo + padY].filter((v, i, a) => a.indexOf(v) === i);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Payoff at expiry: breakeven ${fmt.price(be)}">
    <defs><clipPath id="${id}u"><rect x="0" y="0" width="${W}" height="${Math.max(0, zero)}"/></clipPath><clipPath id="${id}d"><rect x="0" y="${zero}" width="${W}" height="${Math.max(0, H - zero)}"/></clipPath></defs>
    <polygon points="${area}" class="p-opt-gain" clip-path="url(#${id}u)"/><polygon points="${area}" class="p-opt-loss" clip-path="url(#${id}d)"/>
    <line x1="${pad.l}" x2="${W - pad.r}" y1="${zero}" y2="${zero}" class="p-opt-axis"/>
    <polyline points="${line}" class="p-opt-line"/>
    <line x1="${X(spot)}" x2="${X(spot)}" y1="${pad.t}" y2="${H - pad.b}" class="p-opt-spotline"/>
    ${be > x0 && be < x1 ? `<circle cx="${X(be)}" cy="${zero}" r="3.5" class="p-opt-be"/>` : ''}
    ${ticks.map(v => `<text x="${pad.l - 4}" y="${Y(v) + 3}" text-anchor="end">${v >= 0 ? '' : '−'}$${fmt.compact(Math.abs(v))}</text>`).join('')}
    <text x="${X(spot)}" y="${H - 6}" text-anchor="middle">${fmt.price(spot)}</text>
    <text x="${pad.l}" y="${H - 6}">${fmt.price(x0)}</text><text x="${W - pad.r}" y="${H - 6}" text-anchor="end">${fmt.price(x1)}</text>
  </svg>`;
}

// ---------------------------------------------------------------- options-chain
registerPanel('options-chain', {
  title: 'Options Chain', category: 'Options', defaultSize: { w: 6, h: 14 }, symbolLinked: true,
  mount(el, ctx) {
    const st = () => ({ view: 'straddle', strikes: 10, cols: DEFAULT_COLS, ...ctx.state });
    let data = null, ctrl = null, rows = [], closePop = null, requestedExpiry=ctx.state.expiry;
    el.innerHTML = `<div class="p-opt">${refreshHTML}
      <div class="p-opt-bar">
        <div class="s-seg" role="group" aria-label="Chain layout">${[['straddle', 'Straddle'], ['calls', 'Calls'], ['puts', 'Puts']].map(([v, l]) => `<button data-view="${v}">${l}</button>`).join('')}</div>
        <label class="p-opt-lab">Strikes <select class="s-select p-opt-sel" data-strikes aria-label="Strikes shown">${[[5, '±5 near money'], [10, '±10 near money'], [20, '±20 near money'], ['all', 'All strikes']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
        <button class="s-btn s-btn-sm" data-cols aria-haspopup="menu">Columns</button>
        <span class="p-opt-under" aria-live="polite"></span>
      </div>
      <div class="p-opt-exp"><button class="s-icon-btn s-icon-btn-sm" data-step="-1" aria-label="Previous expiration">‹</button><div class="p-opt-exp-list s-scroll" role="tablist" aria-label="Expiration dates"></div><button class="s-icon-btn s-icon-btn-sm" data-step="1" aria-label="Next expiration">›</button></div>
      <div class="p-opt-body s-scroll"></div>
      <div class="p-opt-foot"><div class="p-opt-source" data-options-source>${SOURCE_LABEL}</div><span title="${esc(DERIVED_NOTE)}">${esc(DERIVED_NOTE)}</span></div>
    </div>`;
    const root = el.firstElementChild, body = root.querySelector('.p-opt-body'), expList = root.querySelector('.p-opt-exp-list');

    const visibility=observePanel(el);let controls;
    const poll=createOptionRefresh({refresh:fetchChain,visible:()=>visibility.visible()&&!closePop,paused:!!ctx.state.optionsPaused,onState:()=>controls?.render()});
    controls=refreshControls(root,poll,ctx);
    function load(expiry){requestedExpiry=expiry;return poll.restart();}

    function syncControls() {
      const s = st();
      for (const b of root.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', b.dataset.view === s.view);
      root.querySelector('[data-strikes]').value = String(s.strikes);
    }

    async function fetchChain(signal) {
      const expiry=requestedExpiry;
      const sym = ctx.symbol; if (!sym) { body.innerHTML = ui.empty('Pick a symbol to see its options chain.'); return; }
      ctrl = {signal}; const my = ctrl;
      closePop?.();
      body.innerHTML = ui.loading(`Loading ${sym} options…`);
      try {
        let d;
        try { d = await api('options/chain', { symbol: sym, expiry }, { signal: my.signal }); }
        catch (e) { if (expiry && e.status === 404 && e.message === 'unknown_expiry') d = await api('options/chain', { symbol: sym }, { signal: my.signal }); else throw e; }
        // Skip an expiry that already closed today (greeks would be meaningless) unless explicitly chosen.
        if (!expiry && !isLive(d.expiry)) { const next = d.expirations.find(x => isLive(x.date)); if (next) d = await api('options/chain', { symbol: sym, expiry: next.date }, { signal: my.signal }); }
        if (my !== ctrl || my.signal.aborted) return;
        data = d;poll.update(d); ctx.setState({ expiry: d.expiry });
        render();
      } catch (e) {
        if (e.name === 'AbortError') return;
        data = null; body.innerHTML = ui.error(errText(e), e.status !== 404 && e.status !== 400); bindRetry(body, () => load(expiry));
        expList.innerHTML = ''; root.querySelector('.p-opt-under').textContent = '';
      }
    }

    function renderExpirations() {
      expList.innerHTML = (!data.expirations.some(e=>e.date===data.expiry)?`<button role="tab" class="p-opt-exp-chip" data-exp="${esc(data.expiry)}" aria-selected="true">${esc(expLabel(data.expiry,true))} · not in snapshot</button>`:'')+data.expirations.map(x => `<button role="tab" class="p-opt-exp-chip" data-exp="${x.date}" aria-selected="${x.date === data.expiry}">${esc(expLabel(x.date))} <small>${x.dte}D</small></button>`).join('');
      expList.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    function compute() {
      const S = data.underlying.price, T = yearsToExpiry(data.expiry);
      rows = data.rows.map(r => ({ ...r, ca: r.call ? analyze('call', r.call, S, r.strike, T) : null, pa: r.put ? analyze('put', r.put, S, r.strike, T) : null }));
    }

    function visibleRows() {
      const s = st(), S = data.underlying.price;
      if (s.strikes === 'all' || !(S > 0)) return rows;
      const n = +s.strikes;
      const below = rows.filter(r => r.strike < S).slice(-n), above = rows.filter(r => r.strike >= S).slice(0, n);
      return [...below, ...above];
    }

    function render() {
      if (!data) return;
      syncControls(); renderExpirations(); compute();root.querySelector('[data-options-source]').innerHTML=optionSourceHTML(data);
      const s = st(), u = data.underlying, S = u.price;
      const ah = Number.isFinite(u.last) && u.last !== S ? ` · <span title="${esc(u.lastTime || '')}">${esc(u.marketStatus || 'Latest')} ${fmt.price(u.last)} <i class="${fmt.dir(u.changePct)}">${fmt.pct(u.changePct)}</i></span>` : '';
      root.querySelector('.p-opt-under').innerHTML = `${esc(data.symbol)} <b>${fmt.price(S)}</b> <span class="s-muted">last trade ${esc(u.asOf || '')} · ${esc(u.source||'Underlying source unavailable')}</span>${ah}`;
      ctx.setSubtitle?.(`${fmt.price(S)} · exp ${expLabel(data.expiry, true)}`);
      const list = visibleRows();
      if (!list.length) { body.innerHTML = ui.empty(data.coverage?.partial ? `No contracts for the requested ${data.expiry} expiration in this partial snapshot. Refresh or choose another expiration; your selection has been preserved.` : 'No strikes for this expiration.'); return; }
      const cols = s.cols.filter(c => COLS[c]);
      const live = isLive(data.expiry);
      const maxVol = { call: Math.max(1, ...list.map(r => r.call?.vol || 0)), put: Math.max(1, ...list.map(r => r.put?.vol || 0)) };
      const cell = (kind, r, c, first) => {
        const q = r[kind], a = r[kind === 'call' ? 'ca' : 'pa'], def = COLS[c];
        if (!q) return '<td class="s-num">—</td>';
        const v = def.get(q, a);
        const bar = def.bar && v ? ` style="--w:${(100 * v / maxVol[kind]).toFixed(1)}%"` : '';
        const txt = def.f(v);
        const inner = first ? `<button class="p-opt-pick" data-side="${kind}" aria-label="${esc(`${data.symbol} ${fmt.price(r.strike)} ${kind} details`)}">${txt}</button>` : txt;
        return `<td class="s-num${def.bar ? ' p-opt-vol p-opt-vol-' + kind : ''}${def.dir ? ' ' + fmt.dir(v) : ''}" data-side="${kind}"${bar}>${inner}</td>`;
      };
      const head = c => `<th class="s-num" scope="col"${COL_TITLES[c] ? ` title="${COL_TITLES[c]}"` : ''}>${COLS[c].label}</th>`;
      const spotIdx = list.findIndex(r => r.strike >= S);
      const width = s.view === 'straddle' ? cols.length * 2 + 1 : cols.length + 1;
      const spotRow = `<tr class="p-opt-spot" aria-hidden="true"><td colspan="${width}"><span>${fmt.price(S)}</span></td></tr>`;
      let html;
      if (s.view === 'straddle') {
        const pc = [...cols].reverse(); // mirrored so each side reads outward from the strike
        html = `<table class="s-table p-opt-table p-opt-straddle"><thead><tr class="p-opt-sides"><th colspan="${cols.length}" class="p-opt-side-call">Calls</th><th></th><th colspan="${cols.length}" class="p-opt-side-put">Puts</th></tr>
          <tr>${cols.map(head).join('')}<th class="p-opt-strike" scope="col">Strike</th>${pc.map(head).join('')}</tr></thead><tbody>${list.map((r, i) => `${i === spotIdx ? spotRow : ''}<tr data-i="${rows.indexOf(r)}">
            ${cols.map((c, j) => cell('call', r, c, j === 0)).join('').replace(/<td class="/g, `<td class="${r.strike < S ? 'p-opt-itm ' : ''}`)}
            <th scope="row" class="p-opt-strike">${fmt.price(r.strike)}</th>
            ${pc.map((c, j) => cell('put', r, c, j === pc.length - 1)).join('').replace(/<td class="/g, `<td class="${r.strike > S ? 'p-opt-itm ' : ''}`)}</tr>`).join('')}${spotIdx === -1 ? spotRow : ''}</tbody></table>`;
      } else {
        const kind = s.view === 'calls' ? 'call' : 'put';
        html = `<table class="s-table p-opt-table"><thead><tr><th class="p-opt-strike" scope="col">Strike</th>${cols.map(head).join('')}</tr></thead><tbody>${list.map((r, i) => {
          const itm = kind === 'call' ? r.strike < S : r.strike > S;
          return `${i === spotIdx ? spotRow : ''}<tr data-i="${rows.indexOf(r)}" class="${itm ? 'p-opt-itm-row' : ''}"><th scope="row" class="p-opt-strike">${fmt.price(r.strike)}</th>${cols.map((c, j) => cell(kind, r, c, j === 0)).join('').replace(/<td class="/g, `<td class="${itm ? 'p-opt-itm ' : ''}`)}</tr>`;
        }).join('')}${spotIdx === -1 ? spotRow : ''}</tbody></table>`;
      }
      body.innerHTML = (live ? '' : '<p class="p-opt-warn">This expiration has closed; greeks and IV are not computed.</p>') + html;
      body.querySelector('.p-opt-spot')?.scrollIntoView({ block: 'center' });
    }

    function openDetail(i, kind) {
      const r = rows[i]; if (!r || !r[kind]) return;
      const opener = document.activeElement;
      closePop = contractDetail(root, {
        sourceData:data, symbol: data.symbol, expiry: data.expiry, strike: r.strike, kind, quote: r[kind], spot: data.underlying.price,
        analysis: kind === 'call' ? r.ca : r.pa, dte: data.expirations.find(x => x.date === data.expiry)?.dte ?? '—',
        onClose: () => { closePop = null; if (opener && root.contains(opener)) opener.focus(); }
      });
    }

    root.addEventListener('click', e => {
      const v = e.target.closest('button[data-view]'); if (v && root.contains(v)) { ctx.setState({ view: v.dataset.view }); render(); return; }
      const x = e.target.closest('[data-exp]'); if (x) { load(x.dataset.exp); return; }
      const step = e.target.closest('[data-step]');
      if (step && data) { const i = data.expirations.findIndex(z => z.date === data.expiry) + +step.dataset.step; if (data.expirations[i]) load(data.expirations[i].date); return; }
      const cb = e.target.closest('[data-cols]');
      if (cb) {const order=()=>[...new Set([...(st().columnOrder||st().cols),...Object.keys(COLS)])].filter(id=>COLS[id]),items=()=>order().map(id=>({id,label:COLS[id].label.replace('*','')+(COLS[id].derived?' (derived)':''),on:st().cols.includes(id)}));checkMenu(cb,items(),(id,on)=>{const cols=order().filter(k=>k===id?on:st().cols.includes(k));if(!cols.length)return false;ctx.setState({cols});render();return items();},{onMove(id,direction){const ids=order(),from=ids.indexOf(id),to=from+direction;if(to>=0&&to<ids.length)[ids[from],ids[to]]=[ids[to],ids[from]];ctx.setState({columnOrder:ids,cols:ids.filter(k=>st().cols.includes(k))});render();return items();},onReset(){ctx.setState({cols:DEFAULT_COLS.slice(),columnOrder:[...DEFAULT_COLS,...Object.keys(COLS).filter(k=>!DEFAULT_COLS.includes(k))]});render();return items();}});return;}
      const td = e.target.closest('td[data-side]'), tr = e.target.closest('tr[data-i]');
      if (td && tr && !e.target.closest('.p-opt-pop')) openDetail(+tr.dataset.i, td.dataset.side);
    });
    root.querySelector('[data-strikes]').addEventListener('change', e => { ctx.setState({ strikes: e.target.value === 'all' ? 'all' : +e.target.value }); render(); });
    expList.addEventListener('keydown', e => {
      if (!data || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault(); const i = data.expirations.findIndex(z => z.date === data.expiry) + (e.key === 'ArrowRight' ? 1 : -1);
      if (data.expirations[i]) load(data.expirations[i].date).then(() => expList.querySelector('[aria-selected=true]')?.focus());
    });

    load(ctx.state.expiry);
    return {
      onSymbol() { ctx.setState({ expiry: null }); load(); },
      csv() {
        if (!data) return null;
        return toCSV(rows.map(r => {
          const o = { source:data.source,feed:data.feed,quoteAsOf:data.quoteAsOf,tradeAsOf:data.tradeAsOf,fetchedAt:data.fetchedAt, symbol: data.symbol, expiry: data.expiry, strike: r.strike };
          for (const [k, q, a] of [['call', r.call, r.ca], ['put', r.put, r.pa]]) if (q) Object.assign(o, { [`${k}_last`]: q.last, [`${k}_change`]: q.chg, [`${k}_bid`]: q.bid, [`${k}_ask`]: q.ask, [`${k}_volume`]: q.vol, [`${k}_open_interest`]: q.oi, [`${k}_iv_derived`]: a.iv?.toFixed(4), [`${k}_delta_derived`]: a.delta?.toFixed(4), [`${k}_gamma_derived`]: a.gamma?.toFixed(5), [`${k}_theta_derived`]: a.theta?.toFixed(4), [`${k}_vega_derived`]: a.vega?.toFixed(4) });
          return o;
        }));
      },
      scoutContext() {
        if (!data) return null;
        const S = data.underlying.price, near = visibleRows().filter(r => Math.abs(r.strike - S) / S < 0.08).slice(0, 12);
        const line = (k, q, a) => q ? `${k} bid ${q.bid ?? '—'}/ask ${q.ask ?? '—'} vol ${q.vol ?? '—'} OI ${q.oi ?? '—'} IV ${a?.iv ? (a.iv * 100).toFixed(1) + '%' : '—'} Δ ${a?.delta?.toFixed(2) ?? '—'}` : '';
        return `${data.symbol} options chain, expiry ${data.expiry} (${data.expirations.find(x => x.date === data.expiry)?.dte} DTE). Underlying last trade ${S} (as of ${data.underlying.asOf}). ${optionSource(data)}; IV/greeks derived via Black-Scholes (r=${RISK_FREE_RATE}).\n` +
          near.map(r => `K ${r.strike}: ${line('C', r.call, r.ca)} | ${line('P', r.put, r.pa)}`).join('\n');
      },
      destroy() { poll.destroy();controls.destroy();visibility.destroy();closePop?.(); closeColumnMenu?.(); }
    };
  }
});

// ---------------------------------------------------------------- options-overview
function smileSVG(points, spot, width) {
  const W = Math.max(260, width), H = 150, pad = { l: 40, r: 10, t: 10, b: 20 };
  const all = points.flatMap(p => [p.c, p.p]).filter(v => v != null);
  if (all.length < 2) return '<p class="s-muted p-opt-smile-empty">Not enough two-sided quotes to derive an IV curve.</p>';
  const xs = points.map(p => p.k), x0 = Math.min(...xs), x1 = Math.max(...xs);
  let lo = Math.min(...all), hi = Math.max(...all); const py = (hi - lo) * 0.1 || 0.05; lo = Math.max(0, lo - py); hi += py;
  const X = k => pad.l + (k - x0) / ((x1 - x0) || 1) * (W - pad.l - pad.r), Y = v => pad.t + (hi - v) / (hi - lo) * (H - pad.t - pad.b);
  const path = key => { let d = '', pen = false; for (const p of points) { if (p[key] == null) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${X(p.k).toFixed(1)},${Y(p[key]).toFixed(1)}`; pen = true; } return d; };
  const ticks = [hi, (hi + lo) / 2, lo];
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Implied volatility by strike (derived)">
    ${ticks.map(v => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}" class="p-opt-grid"/><text x="${pad.l - 4}" y="${Y(v) + 3}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`).join('')}
    ${spot >= x0 && spot <= x1 ? `<line x1="${X(spot)}" x2="${X(spot)}" y1="${pad.t}" y2="${H - pad.b}" class="p-opt-spotline"/>` : ''}
    <path d="${path('c')}" class="p-opt-smile-call"/><path d="${path('p')}" class="p-opt-smile-put"/>
    <text x="${pad.l}" y="${H - 5}">${fmt.price(x0)}</text><text x="${W - pad.r}" y="${H - 5}" text-anchor="end">${fmt.price(x1)}</text>${spot >= x0 && spot <= x1 ? `<text x="${X(spot)}" y="${H - 5}" text-anchor="middle">${fmt.price(spot)}</text>` : ''}
  </svg>`;
}

registerPanel('options-overview', {
  title: 'Options Overview', category: 'Options', defaultSize: { w: 6, h: 12 }, symbolLinked: true,
  mount(el, ctx) {
    let data = null, smile = null, ctrl = null, smileCtrl = null, smileBusy=false;
    el.innerHTML = `<div class="p-opt p-opt-ov s-scroll">${refreshHTML}<div class="p-opt-ov-stats"></div>
      <section class="p-opt-ov-smile"><header><strong>IV smile*</strong><span class="s-muted">OTM strikes</span> <select class="s-select p-opt-sel" data-smile aria-label="Expiration for IV smile"></select><span class="p-opt-legend"><i class="c"></i>Calls <i class="p"></i>Puts</span></header><div class="p-opt-smile-plot"></div><div class="p-opt-source" data-smile-source></div></section>
      <div class="p-opt-ov-table"></div>
      <div class="p-opt-foot"><div class="p-opt-source" data-options-source>${SOURCE_LABEL}</div><span>*Derived: put/call ratios, max pain (open interest only), expected move (ATM straddle mid), IV (Black-Scholes on mid, r = ${(RISK_FREE_RATE * 100).toFixed(1)}%).</span></div></div>`;
    const root = el.firstElementChild, stats = root.querySelector('.p-opt-ov-stats'), table = root.querySelector('.p-opt-ov-table'), plot = root.querySelector('.p-opt-smile-plot'), sel = root.querySelector('[data-smile]');
    const visibility=observePanel(el);let controls;
    const poll=createOptionRefresh({refresh:fetchOverview,visible:()=>visibility.visible()&&!smileBusy,paused:!!ctx.state.optionsPaused,onState:()=>controls?.render()});
    controls=refreshControls(root,poll,ctx);
    const load=()=>poll.restart();
    const ratio = v => (v == null ? '—' : fmt.num(v, 2));

    async function fetchOverview(signal) {
      const sym = ctx.symbol; if (!sym) { table.innerHTML = ui.empty('Pick a symbol.'); return; }
      smileCtrl?.abort();smileBusy=false;smile=null;ctrl = {signal}; const my = ctrl;
      stats.innerHTML = ''; table.innerHTML = ui.loading(`Loading ${sym} expirations…`); plot.innerHTML = '';root.querySelector('[data-smile-source]').innerHTML='';
      try {
        const d = await api('options/expirations', { symbol: sym }, { signal: my.signal });
        if (my !== ctrl || my.signal.aborted) return; data = d;poll.update(d);root.querySelector('[data-options-source]').innerHTML=optionSourceHTML(d);
        if (!d.expirations?.length) { table.innerHTML = ui.empty('No expirations are available for this symbol.'); sel.innerHTML = ''; return; }
        renderTable();
        const want = ctx.state.smileExpiry && d.expirations.some(e => e.expiry === ctx.state.smileExpiry) ? ctx.state.smileExpiry : (d.expirations.find(e => isLive(e.expiry) && e.dte >= 5) || d.expirations.find(e => isLive(e.expiry)) || d.expirations[0]).expiry;
        await loadSmile(want,signal);
      } catch (e) {
        if (e.name === 'AbortError') return;
        data = null;smileBusy=false; table.innerHTML = ui.error(errText(e), e.status !== 404 && e.status !== 400); bindRetry(table, load);
      }
    }

    function renderTable() {
      const t = data.totals, u = data.underlying, near = data.expirations.find(e => isLive(e.expiry)) || data.expirations[0];
      ctx.setSubtitle?.(`${fmt.price(u.price)} · ${data.expirations.length} expirations`);
      const atm = smile?.atmIV;
      stats.innerHTML = [
        ['Underlying (last trade)', fmt.price(u.price), `${u.source||'Underlying source unavailable'} · ${u.asOf||'Timestamp unavailable'}`],
        ['Call volume', fmt.compact(t.calls.vol), `OI ${fmt.compact(t.calls.oi)}`],
        ['Put volume', fmt.compact(t.puts.vol), `OI ${fmt.compact(t.puts.oi)}`],
        ['Put/Call vol*', ratio(t.putCallVolume), `OI ratio ${ratio(t.putCallOI)}`],
        ['Max pain*', near?.maxPain == null ? '—' : fmt.price(near.maxPain), near ? `${expLabel(near.expiry)} expiry` : ''],
        ['Expected move*', near?.expectedMove == null ? '—' : '±' + fmt.price(near.expectedMove), near?.expectedMovePct == null ? 'no ATM two-sided quote' : `±${fmt.num(near.expectedMovePct, 1)}% by ${expLabel(near.expiry)}`],
        ['ATM IV*', atm == null ? '—' : fmt.num(atm * 100, 1) + '%', smile ? `${expLabel(smile.expiry)} expiry` : '']
      ].map(([k, v, s]) => `<div><span>${k}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');
      table.innerHTML = `<table class="s-table"><thead><tr><th scope="col">Expiry</th><th class="s-num" scope="col">DTE</th><th class="s-num" scope="col">Call vol</th><th class="s-num" scope="col">Put vol</th><th class="s-num" scope="col" title="Put/call volume ratio (derived)">P/C vol*</th><th class="s-num" scope="col">Call OI</th><th class="s-num" scope="col">Put OI</th><th class="s-num" scope="col" title="Put/call open-interest ratio (derived)">P/C OI*</th><th class="s-num" scope="col" title="Strike minimizing option holders' payout, from open interest (derived)">Max pain*</th><th class="s-num" scope="col" title="ATM straddle mid (derived)">Exp. move*</th></tr></thead>
        <tbody>${data.expirations.map(e => `<tr class="is-clickable${smile?.expiry === e.expiry ? ' p-opt-sel-row' : ''}" data-exp="${e.expiry}" tabindex="0" aria-label="Show IV smile for ${esc(expLabel(e.expiry, true))}">
          <th scope="row">${esc(expLabel(e.expiry))}</th><td class="s-num">${e.dte}</td><td class="s-num">${fmt.compact(e.calls.vol)}</td><td class="s-num">${fmt.compact(e.puts.vol)}</td><td class="s-num">${ratio(e.putCallVolume)}</td>
          <td class="s-num">${fmt.compact(e.calls.oi)}</td><td class="s-num">${fmt.compact(e.puts.oi)}</td><td class="s-num">${ratio(e.putCallOI)}</td><td class="s-num">${e.maxPain == null ? '—' : fmt.price(e.maxPain)}</td>
          <td class="s-num">${e.expectedMove == null ? '—' : `±${fmt.price(e.expectedMove)} <small class="s-muted">${fmt.num(e.expectedMovePct, 1)}%</small>`}</td></tr>`).join('')}</tbody></table>`;
      sel.innerHTML = data.expirations.map(e => `<option value="${e.expiry}"${smile?.expiry === e.expiry ? ' selected' : ''}>${esc(expLabel(e.expiry, true))} (${e.dte}D)</option>`).join('');
    }

    async function loadSmile(expiry,parentSignal) {
      smileBusy=true;
      smileCtrl?.abort(); smileCtrl = new AbortController(); const my = smileCtrl;const abort=()=>my.abort();parentSignal?.addEventListener('abort',abort,{once:true});
      ctx.setState({ smileExpiry: expiry }); sel.value = expiry;
      plot.innerHTML = ui.loading('Deriving implied volatility…');
      try {
        const d = await api('options/chain', { symbol: data.symbol, expiry }, { signal: my.signal });
        if (my !== smileCtrl || my.signal.aborted || d.symbol !== ctx.symbol) return;
        const S = d.underlying.price, T = yearsToExpiry(expiry);
        // Out-of-the-money side of each strike (plus a small overlap at the money): ITM quotes are wide and noisy.
        const all = d.rows.filter(r => r.strike > S * 0.6 && r.strike < S * 1.4).map(r => ({ k: r.strike, c: analyze('call', r.call, S, r.strike, T).iv, p: analyze('put', r.put, S, r.strike, T).iv }));
        const pts = all.map(p => ({ k: p.k, c: p.k >= S * 0.97 ? p.c : null, p: p.k <= S * 1.03 ? p.p : null }));
        let atmRow = null; for (const p of all) if (!atmRow || Math.abs(p.k - S) < Math.abs(atmRow.k - S)) atmRow = p;
        const atmVals = atmRow ? [atmRow.c, atmRow.p].filter(v => v != null) : [];
        smile = { sourceData:d, expiry, S, pts, live: isLive(expiry), atmIV: atmVals.length ? atmVals.reduce((a, b) => a + b) / atmVals.length : null };
        drawSmile(); renderTable();
      } catch (e) { if (e.name !== 'AbortError') { plot.innerHTML = ui.error(errText(e)); bindRetry(plot, () => {ctx.setState({smileExpiry:expiry});load();}); } } finally {parentSignal?.removeEventListener('abort',abort);if(my===smileCtrl)smileBusy=false;}
    }
    const drawSmile = () => { if (smile) {plot.innerHTML = smile.live ? smileSVG(smile.pts, smile.S, plot.clientWidth - 4) : ui.empty('This expiration has closed; IV is not computed.');root.querySelector('[data-smile-source]').innerHTML=optionSourceHTML(smile.sourceData);}};
    const ro = new ResizeObserver(() => drawSmile()); ro.observe(plot);

    sel.addEventListener('change', () => {ctx.setState({smileExpiry:sel.value});load();});
    table.addEventListener('click', e => { const tr = e.target.closest('tr[data-exp]'); if (tr && data) {ctx.setState({smileExpiry:tr.dataset.exp});load();} });
    table.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-exp]'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.setState({smileExpiry:tr.dataset.exp});load(); } });
    load();
    return {
      onSymbol() { smileCtrl?.abort(); smileCtrl = null;smileBusy=false; ctx.setState({ smileExpiry: null }); smile = null; data = null; load(); },
      csv() { return data ? toCSV(data.expirations.map(e => ({ symbol: data.symbol, expiry: e.expiry, dte: e.dte, call_volume: e.calls.vol, put_volume: e.puts.vol, put_call_volume_derived: e.putCallVolume?.toFixed(3), call_oi: e.calls.oi, put_oi: e.puts.oi, put_call_oi_derived: e.putCallOI?.toFixed(3), max_pain_derived: e.maxPain, atm_strike: e.atmStrike, expected_move_derived: e.expectedMove?.toFixed(2), expected_move_pct_derived: e.expectedMovePct?.toFixed(2) }))) : null; },
      scoutContext() {
        if (!data) return null; const t = data.totals;
        return `${data.symbol} options overview (${optionSource(data)}; derived metrics). Underlying ${data.underlying.price}. Total call vol ${t.calls.vol}, put vol ${t.puts.vol}, P/C vol ${t.putCallVolume?.toFixed(2)}, P/C OI ${t.putCallOI?.toFixed(2)}.` +
          (smile?.atmIV ? ` ATM IV ${(smile.atmIV * 100).toFixed(1)}% for ${smile.expiry}. IV source: ${optionSource(smile.sourceData)}.` : '') + '\n' +
          data.expirations.slice(0, 10).map(e => `${e.expiry} (${e.dte}D): callVol ${e.calls.vol} putVol ${e.puts.vol} P/C ${e.putCallVolume?.toFixed(2) ?? '—'} maxPain ${e.maxPain ?? '—'} expMove ±${e.expectedMove?.toFixed(2) ?? '—'}`).join('\n');
      },
      destroy() { poll.destroy();controls.destroy();visibility.destroy();smileCtrl?.abort(); ro.disconnect(); }
    };
  }
});

// ---------------------------------------------------------------- unusual-options
function watchlistSymbols() {
  try { const v = JSON.parse(localStorage.getItem('watchlist-pulse')); return Array.isArray(v) ? v.filter(s => typeof s === 'string') : []; } catch { return []; }
}
function portfolioSymbols() {
  try { return [...new Set(readPortfolios().flatMap(a => a.holdings.map(h => h.ticker)))]; } catch { return []; }
}

registerPanel('unusual-options', {
  title: 'Unusual Options Activity', category: 'Options', defaultSize: { w: 12, h: 10 }, symbolLinked: true,
  mount(el, ctx) {
    const st = () => ({ scope: 'symbol', minVolume: 500, minRatio: 1, sort: 'volume', ...ctx.state });
    let data = null, ctrl = null;
    el.innerHTML = `<div class="p-opt p-opt-un">
      <div class="p-opt-bar">
        <div class="s-seg" role="group" aria-label="Symbols to scan">${[['symbol', 'Linked symbol'], ['watchlist', 'Watchlist'], ['portfolio', 'Portfolio']].map(([v, l]) => `<button data-scope="${v}">${l}</button>`).join('')}</div>
        <label class="p-opt-lab">Min vol <select class="s-select p-opt-sel" data-k="minVolume">${[100, 500, 1000, 5000, 10000].map(v => `<option value="${v}">${fmt.compact(v)}</option>`).join('')}</select></label>
        <label class="p-opt-lab">Vol/OI ≥ <select class="s-select p-opt-sel" data-k="minRatio">${[0, 0.5, 1, 2, 5].map(v => `<option value="${v}">${v}×</option>`).join('')}</select></label>
        <label class="p-opt-lab">Sort <select class="s-select p-opt-sel" data-k="sort"><option value="volume">Volume</option><option value="ratio">Vol/OI</option><option value="premium">Premium</option></select></label>
        <button class="s-btn s-btn-sm" data-refresh aria-label="Refresh scan">Refresh</button>
        <span class="p-opt-count s-muted" aria-live="polite"></span>
      </div>
      <div class="p-opt-body s-scroll"></div>
      <div class="p-opt-foot"><div class="p-opt-source" data-options-source>${SOURCE_LABEL} · Derived scan</div><span>Contracts whose delayed session volume is high relative to prior-day open interest. Not a trade-by-trade flow feed: trade side, sweeps and sentiment are not known.</span></div>
    </div>`;
    const root = el.firstElementChild, body = root.querySelector('.p-opt-body'), count = root.querySelector('.p-opt-count');

    function symbols() {
      const s = st();
      if (s.scope === 'watchlist') return watchlistSymbols();
      if (s.scope === 'portfolio') return portfolioSymbols();
      return ctx.symbol ? [ctx.symbol] : [];
    }

    async function load() {
      const s = st();
      for (const b of root.querySelectorAll('[data-scope]')) b.setAttribute('aria-pressed', b.dataset.scope === s.scope);
      for (const k of ['minVolume', 'minRatio', 'sort']) root.querySelector(`[data-k=${k}]`).value = String(s[k]);
      const all = symbols();
      if (!all.length) { data = null; count.textContent = ''; body.innerHTML = ui.empty(s.scope === 'watchlist' ? 'Your watchlist is empty. Add tickers on the Watchlist page.' : s.scope === 'portfolio' ? 'No portfolio holdings on this device.' : 'Pick a symbol.'); return; }
      const syms = all.slice(0, 12);
      ctrl?.abort(); ctrl = new AbortController(); const my = ctrl;
      body.innerHTML = ui.loading(`Scanning ${syms.join(', ')}…`); count.textContent = '';
      try {
        const d = await api('options/unusual', { symbols: syms.join(','), minVolume: s.minVolume, minRatio: s.minRatio, sort: s.sort, limit: 150 }, { signal: my.signal });
        if (my !== ctrl) return; data = d; render(all.length > 12);
      } catch (e) {
        if (e.name === 'AbortError') return;
        data = null; body.innerHTML = ui.error(errText(e), e.status !== 400); bindRetry(body, load);
      }
    }

    function render(truncated) {
      const d = data;root.querySelector('[data-options-source]').innerHTML=optionSourceHTML(d);
      ctx.setSubtitle?.(d.symbols.length === 1 ? d.symbols[0] : `${d.symbols.length} symbols`);
      count.textContent = `${d.contracts.length}${d.total > d.contracts.length ? ` of ${d.total}` : ''} contracts${d.unavailable.length ? ` · unavailable: ${d.unavailable.join(', ')}` : ''}${truncated ? ' · first 12 symbols' : ''}`;
      if (!d.contracts.length) { body.innerHTML = ui.empty(d.unavailableMetrics?.length ? 'This feed does not publish volume/open interest, so this scan and its volume/OI thresholds are unavailable.' : d.notices?.length ? d.notices.join(' ') : 'No contracts match these thresholds.'); return; }
      body.innerHTML = `<table class="s-table"><thead><tr><th scope="col">Symbol</th><th scope="col">Contract</th><th class="s-num" scope="col">DTE</th><th class="s-num" scope="col">Spot</th><th class="s-num" scope="col">Bid–Ask</th><th class="s-num" scope="col">Last</th><th class="s-num" scope="col">Volume</th><th class="s-num" scope="col">Open Int.</th><th class="s-num" scope="col" title="Volume ÷ prior-day open interest (derived)">Vol/OI*</th><th class="s-num" scope="col" title="Volume × mid (or last) × 100 (derived)">Premium*</th><th class="s-num" scope="col" title="Distance from strike to spot (derived)">Moneyness*</th></tr></thead>
        <tbody>${d.contracts.map(c => `<tr data-symbol="${esc(c.symbol)}" tabindex="0"><th scope="row">${esc(c.symbol)}</th>
          <td><span class="${c.side === 'call' ? 's-up' : 's-down'}">${fmt.price(c.strike)} ${c.side}</span> <span class="s-muted">${esc(expLabel(c.expiry))}</span></td>
          <td class="s-num">${c.dte}d</td><td class="s-num">${fmt.price(c.spot)}</td><td class="s-num">${opx(c.bid)} – ${opx(c.ask)}</td><td class="s-num">${opx(c.last)}</td>
          <td class="s-num"><b>${fmt.compact(c.vol)}</b></td><td class="s-num">${c.oi == null ? '<span class="s-muted" title="Open interest not reported">n/a</span>' : fmt.compact(c.oi)}</td>
          <td class="s-num">${c.volOI == null ? '—' : fmt.num(c.volOI, 1) + '×'}</td><td class="s-num">${c.premium == null ? '—' : '$' + fmt.compact(c.premium)}</td>
          <td class="s-num">${c.moneyness == null ? '—' : `<span class="s-badge ${c.moneyness >= 0 ? 's-badge-accent' : ''}">${c.moneyness >= 0 ? 'ITM' : 'OTM'}</span> ${fmt.num(Math.abs(c.moneyness), 1)}%`}</td></tr>`).join('')}</tbody></table>`;
    }

    root.addEventListener('click', e => {
      const sc = e.target.closest('[data-scope]'); if (sc) { ctx.setState({ scope: sc.dataset.scope }); load(); return; }
      if (e.target.closest('[data-refresh]')) { load(); return; }
      const tr = e.target.closest('tr[data-symbol]'); if (tr && st().scope !== 'symbol') ctx.openSymbol(tr.dataset.symbol);
    });
    root.addEventListener('keydown', e => { const tr = e.target.closest('tr[data-symbol]'); if (tr && e.key === 'Enter' && st().scope !== 'symbol') ctx.openSymbol(tr.dataset.symbol); });
    root.addEventListener('change', e => { const k = e.target.dataset.k; if (!k) return; ctx.setState({ [k]: k === 'sort' ? e.target.value : +e.target.value }); load(); });
    load();
    return {
      onSymbol() { if (st().scope === 'symbol') load(); },
      csv() { return data?.contracts.length ? toCSV(data.contracts.map(c => ({ symbol: c.symbol, expiry: c.expiry, dte: c.dte, strike: c.strike, side: c.side, spot: c.spot, bid: c.bid, ask: c.ask, last: c.last, volume: c.vol, open_interest: c.oi, vol_oi_derived: c.volOI?.toFixed(2), premium_derived: c.premium?.toFixed(0), moneyness_pct_derived: c.moneyness?.toFixed(2) }))) : null; },
      scoutContext() {
        if (!data) return null;
        return `Unusual options scan (${optionSource(data)}; derived from reported volume vs prior-day open interest; not a trade flow feed) for ${data.symbols.join(', ')}, min volume ${data.minVolume}, min vol/OI ${data.minRatio}. Top contracts:\n` +
          data.contracts.slice(0, 15).map(c => `${c.symbol} ${c.strike} ${c.side} ${c.expiry} (${c.dte}d): vol ${c.vol}, OI ${c.oi ?? 'n/a'}, vol/OI ${c.volOI?.toFixed(1) ?? 'n/a'}, premium ~$${c.premium?.toFixed(0) ?? 'n/a'}, ${c.moneyness >= 0 ? 'ITM' : 'OTM'} ${Math.abs(c.moneyness ?? 0).toFixed(1)}%`).join('\n');
      },
      destroy() { ctrl?.abort(); }
    };
  }
});

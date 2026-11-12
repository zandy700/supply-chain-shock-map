// Ultimater onboarding ("What's your main goal right now?"), template picker and the 7-step coach-mark tour.
// Owned by the shell builder. The shell passes its helpers in via initTour() to avoid an import cycle.
import { esc, store, bus } from './core.js';

const STEPS = [
  { sel: '.sp-side [data-section=views]', title: 'Views', text: 'Ready-made workspaces for markets, company analysis, news, prediction markets, your portfolio, earnings and options. Pick one to load its panels.' },
  { sel: '.sp-side [data-section=themes]', title: 'Themes', text: 'Investing themes and sectors — Magnificent Seven, crypto, AI & tech and more — each with a chart, news, a constituent list and a heatmap.' },
  { sel: '.sp-viewhead .sp-chips', title: 'Linked symbols', text: 'The active symbol drives every linked panel in the view. Click a chip to switch, × to remove, or + to add a ticker.' },
  { sel: '.sp-grid .sp-panel .sp-panel-head', title: 'Panel controls', text: 'Each panel shows its symbol and link group. Download its data as CSV, lock it to the current ticker, ask Ultimater AI about it, or expand it to fill the grid.' },
  { sel: '.sp-search-pill', title: 'Search anything', text: 'Press ⌘K (Ctrl K) to find a company, jump to a view or theme, or add a panel without leaving the keyboard.' },
  { sel: '#space-dock', title: 'Ultimater AI', text: 'Ask questions about the market or any panel. Answers use the data on your screen; always double-check important details.', before: (api) => { if (api.prefs().dock === 'collapsed') document.querySelector('[data-act=dock-toggle]')?.click(); } },
  { sel: '.sp-viewhead [data-act=clone], .sp-top .sp-create', title: 'Make it yours', text: 'Clone any view into My Views, or create one from scratch or a template. Custom views let you drag, resize, add and remove panels.' }
];

export function getTourSteps(goal, doc) {
  const intro = goal === 'scratch' ? [
    {sel:'.sp-viewhead [data-act=add-panel]',title:'Build your own workspace',text:'Start with Add Panel. Pick a chart, company data, news or portfolio tools from the catalog.'},
    {sel:'.sp-grid',title:'Arrange your panels',text:'Drag panel handles to move them and use the bottom corner to resize. Arrow keys on a handle move a panel; Shift plus arrows resize it.'},
    {sel:'.sp-viewhead [data-act=lock-view]',title:'Protect this layout',text:'Lock the layout when it is arranged how you want. Rename it, choose an icon and reorder it under My Views.'}
  ] : goal === 'portfolio' ? [
    {sel:'.sp-grid [data-type=portfolio-holdings], .sp-grid [data-type=portfolio-summary]',title:'Your portfolio workspace',text:'Choose manual portfolios or linked broker accounts. Incomplete prices or unsupported positions keep totals unavailable rather than showing partial values.'},
    {sel:'.sp-grid [data-type=portfolio-holdings]',title:'Research your holdings',text:'Use the Holdings, News, Insights, Movers and Risk tabs to investigate the selected accounts. Select a ticker to link the other panels.'},
    {sel:'.sp-grid [data-type=portfolio-performance]',title:'Understand value history',text:'History uses recorded account values. Save a complete manual portfolio value or import dated balances; current shares do not reconstruct past performance.'}
  ] : goal === 'analysis' ? [
    {sel:'.sp-grid [data-type=chart]',title:'Analyze a company',text:'Start with the linked ticker. Use the chart’s controls for price history, comparisons, indicators and drawings.'},
    {sel:'.sp-grid [data-type=fundamentals]',title:'Read the numbers',text:'Explore company metrics and statements. Choose a reporting period, unit scale or comparison, and check source and currency labels.'},
    {sel:'.sp-grid [data-type=analyst]',title:'Compare expectations',text:'Ratings and price targets describe analyst expectations. They are separate from your own judgment and can be unavailable or delayed.'}
  ] : [{sel:'.sp-grid [data-type=index-movers], .sp-grid [data-type=chart]',title:'Monitor the market',text:'Follow indexes, movers and cryptocurrencies, then select a symbol to investigate its chart and news.'}];
  return [...intro, ...STEPS.filter(s=>goal!=='scratch'||!s.title.includes('Make it'))];
}

// Small schematic of a layout, drawn from its panel rectangles (stands in for a preview screenshot).
function preview(view) {
  if (!view) return '';
  const rows = Math.max(...view.panels.map(p => p.y + p.h));
  const H = Math.min(rows, 40), sx = 100 / 12, sy = 62 / H;
  const rects = view.panels.filter(p => p.y < H).map(p => `<rect x="${p.x * sx + 0.6}" y="${p.y * sy + 0.6}" width="${p.w * sx - 1.2}" height="${Math.min(p.h, H - p.y) * sy - 1.2}" rx="1.4"></rect><text x="${p.x * sx + 2.2}" y="${p.y * sy + 4.6}">${esc(p.type.replace(/-/g, ' '))}</text>`).join('');
  return `<svg class="sp-onb-preview-svg" viewBox="0 0 100 62" role="img" aria-label="Layout preview of ${esc(view.name)}">${rects}</svg>`;
}

export function initTour(api) {
  const { openDialog, icon, getBuiltin, VIEWS, THEMES, GOALS } = api;

  // mode 'onboard': choose a goal → open that view → coach marks. mode 'template': choose any template → copy into My Views.
  function picker(mode) {
    let chosen = mode === 'onboard' ? null : null;
    const templates = mode === 'template'
      ? [...VIEWS.map(v => ({ id: v.id, name: v.name, kind: 'View' })), ...THEMES.map(t => ({ id: t.id, name: t.name, kind: 'Theme' }))]
      : [];
    const d = openDialog({
      title: mode === 'onboard' ? 'Getting Started' : 'Select a template', className: 'sp-onboard',
      onClose: () => { if (mode === 'onboard') api.savePrefs({ onboarded: true }); },
      body: `<div class="sp-onb">
        <div class="sp-onb-left">
          <h3 class="sp-onb-h">${mode === 'onboard' ? 'What’s your main goal right now?' : 'Start from a template'}</h3>
          <p class="sp-onb-sub">${mode === 'onboard' ? 'Pick what you want to follow and Ultimater opens a workspace set up for it. You can switch or customize views any time.' : 'Choose a layout to copy into My Views. You can then add, move, resize and remove panels.'}</p>
          <div class="sp-onb-goals" role="radiogroup" aria-label="Goal">
            ${GOALS.map(g => `<button type="button" class="sp-onb-goal" role="radio" aria-checked="false" data-view="${g.view}"><b>${esc(g.title)}</b><span>${esc(g.text)}</span></button>`).join('')}
          </div>
          ${templates.length ? `<label class="sp-onb-more-label" for="sp-onb-select">Or any view or theme</label>
            <select id="sp-onb-select" class="s-select"><option value="">Choose a template…</option>${['View', 'Theme'].map(k => `<optgroup label="${k}s">${templates.filter(t => t.kind === k).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>`).join('')}</select>` : ''}
        </div>
        <div class="sp-onb-right" aria-live="polite"><div class="sp-onb-preview"><span class="s-muted">Select an option to preview its layout</span></div></div>
      </div>`,
      footer: `${mode === 'onboard' ? '<button type="button" class="s-btn s-btn-ghost" data-close>Skip</button>' : '<button type="button" class="s-btn s-btn-ghost" data-close>Cancel</button>'}<button type="button" class="s-btn s-btn-primary" data-next disabled>${mode === 'onboard' ? 'Next' : 'Create view'}</button>`
    });
    const next = d.el.querySelector('[data-next]'), prev = d.el.querySelector('.sp-onb-preview');
    const goals = [...d.el.querySelectorAll('.sp-onb-goal')], sel = d.el.querySelector('#sp-onb-select');
    const choose = (id) => {
      chosen = id;
      goals.forEach(g => g.setAttribute('aria-checked', String(g.dataset.view === id)));
      if (sel && goals.some(g => g.dataset.view === id)) sel.value = '';
      const v = getBuiltin(id);
      prev.innerHTML = v ? `${preview(v)}<div class="sp-onb-caption"><b>${esc(v.name)}</b> · ${v.panels.length} panels</div>` : '';
      next.disabled = !id;
    };
    goals.forEach((g, i) => {
      g.addEventListener('click', () => choose(g.dataset.view));
      g.addEventListener('keydown', (e) => {
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return; e.preventDefault(); const n = goals[(i + dir + goals.length) % goals.length]; n.focus(); choose(n.dataset.view);
      });
    });
    sel?.addEventListener('change', () => { goals.forEach(g => g.setAttribute('aria-checked', 'false')); choose(sel.value); });
    next.addEventListener('click', () => {
      if (!chosen) return;
      d.close();
      if (mode === 'onboard') { const goal = chosen === 'my-portfolio' ? 'portfolio' : chosen === 'analysis' ? 'analysis' : 'markets'; store.set('goal', goal); bus.emit('workspace:goal', { goal }); api.savePrefs({ onboarded: true }); api.openView(chosen); setTimeout(start, 350); }
      else api.createFromTemplate(chosen);
    });
    goals[0].focus();
  }

  let active = null;
  function start(kind) {
    stop();
    const goal=typeof kind==='string'?kind:(api.getDoc()?.kind==='custom'&&!api.getDoc()?.panels.length?'scratch':store.get('goal','markets'));
    const steps=getTourSteps(goal,api.getDoc());
    const layer = document.createElement('div');
    layer.className = 'sp-tour';
    layer.innerHTML = `<div class="sp-tour-spot" aria-hidden="true"></div>
      <div class="sp-tour-card" role="dialog" aria-modal="true" aria-labelledby="sp-tour-title" tabindex="-1">
        <div class="sp-tour-step s-muted"></div><h3 id="sp-tour-title"></h3><p class="sp-tour-text"></p>
        <div class="sp-tour-actions"><button type="button" class="s-btn s-btn-ghost" data-skip>Skip tour</button><span style="flex:1"></span>
        <button type="button" class="s-btn" data-back>Back</button><button type="button" class="s-btn s-btn-primary" data-next>Next</button></div>
      </div>`;
    document.body.append(layer);
    const opener = document.activeElement;
    const spot = layer.querySelector('.sp-tour-spot'), card = layer.querySelector('.sp-tour-card');
    let i = 0;
    const place = () => {
      const st = steps[i];
      const target = [...document.querySelectorAll(st.sel)].find(el => el.offsetParent !== null && el.getBoundingClientRect().width > 0);
      const cw = Math.min(340, innerWidth - 24);
      card.style.width = cw + 'px';
      if (!target) {
        spot.style.cssText = 'left:50%;top:50%;width:0;height:0';
        card.style.left = (innerWidth - cw) / 2 + 'px'; card.style.top = Math.max(24, innerHeight / 2 - card.offsetHeight / 2) + 'px';
        return;
      }
      target.scrollIntoView({ block: 'nearest' });
      const r = target.getBoundingClientRect(), pad = 6;
      const top = Math.max(4, r.top - pad), height = Math.min(r.height + pad * 2, innerHeight - top - 4);
      Object.assign(spot.style, { left: r.left - pad + 'px', top: top + 'px', width: r.width + pad * 2 + 'px', height: height + 'px' });
      const ch = card.offsetHeight;
      let left, cardTop;
      if (r.right + 16 + cw < innerWidth) { left = r.right + 16; cardTop = r.top; }
      else if (r.left - 16 - cw > 0) { left = r.left - 16 - cw; cardTop = r.top; }
      else { left = Math.min(Math.max(12, r.left), innerWidth - cw - 12); cardTop = r.bottom + 16 + ch < innerHeight ? r.bottom + 16 : r.top - ch - 16; }
      card.style.left = left + 'px'; card.style.top = Math.max(12, Math.min(cardTop, innerHeight - ch - 12)) + 'px';
    };
    const show = () => {
      const st = steps[i];
      st.before?.(api);
      layer.querySelector('.sp-tour-step').textContent = `Step ${i + 1} of ${steps.length}`;
      layer.querySelector('#sp-tour-title').textContent = st.title;
      layer.querySelector('.sp-tour-text').textContent = st.text;
      layer.querySelector('[data-back]').disabled = i === 0;
      layer.querySelector('[data-next]').textContent = i === steps.length - 1 ? 'Done' : 'Next';
      requestAnimationFrame(() => { place(); card.focus(); });
    };
    const go = (d) => { const n = i + d; if (n < 0) return; if (n >= steps.length) { stop(); if(goal==='scratch')api.openCatalog?.(); return; } i = n; show(); };
    layer.querySelector('[data-next]').onclick = () => go(1);
    layer.querySelector('[data-back]').onclick = () => go(-1);
    layer.querySelector('[data-skip]').onclick = () => stop();
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); stop(); }
      else if (e.key === 'ArrowRight' && !e.target.closest('button')) go(1);
      else if (e.key === 'ArrowLeft' && !e.target.closest('button')) go(-1);
      else if (e.key === 'Tab') { // keep focus inside the card
        const f = [...card.querySelectorAll('button:not(:disabled)')]; if (!f.length) return;
        const idx = f.indexOf(document.activeElement);
        if (e.shiftKey && idx <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && idx === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', place);
    active = { layer, cleanup: () => { document.removeEventListener('keydown', onKey, true); removeEventListener('resize', place); if (opener?.isConnected) opener.focus(); } };
    api.savePrefs({ tourDone: true, ['tourDone:'+goal]:true });
    show();
  }
  function stop() { if (!active) return; active.layer.remove(); active.cleanup(); active = null; }

  return { onboard: () => picker('onboard'), templates: () => picker('template'), start, stop };
}

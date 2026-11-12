import { registerPanel, api, esc, fmt, state as ui, toCSV, store, bus } from '../core.js';
import { createLiveRefresh, refreshLabel } from '../live-refresh.js';
import { INDICATORS, computeIndicator, defaultParams, heikinAshi, niceTicks, stepValueAt, FIB_LEVELS, paneLayout, STYLE_PRESETS, chartSourceStamp } from './chart-math.js';

const css = new URL('./chart.css', import.meta.url).href;
if (!document.querySelector(`link[href="${css}"]`)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = css; document.head.append(l); }
const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX'];
const TYPES = ['Line', 'Area', 'Candles', 'OHLC', 'Heikin Ashi', 'Baseline'];
const COLORS = ['--s-accent', '--s-gold', '--s-up', '--s-down', '--s-muted'];
const PRICE_BASIS_STUDIES = new Set(['sma', 'ema', 'wma', 'dema', 'tema']);
const EXTRA_STYLE_COLORS = { backgroundEnd:'#101b2e',crosshair:'#8d98aa',priceAxis:'#9aa6b8',timeAxis:'#9aa6b8',lastUp:'#0b9953',lastUpText:'#ffffff',lastDown:'#c43b4b',lastDownText:'#ffffff' };
const symbolOK = s => /^[A-Z^][A-Z0-9.^-]{0,19}$/.test(s);
const options = (values, selected) => values.map(v => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join('');
const dateLabel = (t, intraday) => new Date(t).toLocaleString('en-US', { timeZone: intraday ? 'America/New_York' : 'UTC', month: 'short', day: 'numeric', year: 'numeric', ...(intraday ? { hour: '2-digit', minute: '2-digit' } : {}) });
function intervals(symbol, range, allowed) {
  if (allowed?.[range]) return allowed[range];
  if (symbol.endsWith('-USD')) return range === '1D' ? ['1m', '5m', '15m', '1h'] : range === '5D' ? ['5m', '15m', '1h', '1d'] : range === '1M' ? ['1h', '4h', '1d'] : ['1d', '1wk', '1mo'];
  return range === '1D' ? ['1m', '2m', '5m', '15m', '30m', '1h'] : range === '5D' ? ['1d'] : range === '1M' ? ['1d', '1wk'] : ['1d', '1wk', '1mo'];
}
function mountChart(el, ctx, { compact = false, symbol: initialSymbol, onCrosshair } = {}) {
  let symbol = initialSymbol || ctx.symbol || 'NVDA', data = null, comparisons = [], metrics = [], controller, requestId = 0, destroyed = false;
  let st = { range: '1Y', interval: '1d', chartType: 'Candles', log: false, volume: true, indicators: [], compare: '', metric: '', drawings: [], extended: true, ohlcv: true, hoverLegend: true, verticalCrosshair: true, horizontalCrosshair: true, watermarkOn: false, snap: true, metricPeriod: 'quarterly', metricType: 'Line', lineWidth: 1.5, lineDash: 'Solid', appearance: {}, ...ctx.state };
  let poll = null, resetRequested = true, refreshState = null;
  let replay = 1, cursor = null, zoom = 1, pan = 0, drag = null, drawingStart = null, geometry = null, replayTimer = null, selectedDrawing = null, manageStudies = false, fullMetricsLoaded = false;
  const save = patch => { st = { ...st, ...patch }; ctx.setState(patch); };
  const styleColor = (key,label) => `<label>${esc(label)}<input type="color" data-color="${key}" aria-label="${esc(label)} color" value="${esc(st.appearance[key] || STYLE_PRESETS.Default[key] || EXTRA_STYLE_COLORS[key] || ['#a970d1','#92ca79','#f8c857','#ee6666','#73c0de'][parseInt(key.replace('comparison',''))%5] || '#4c8dff')}"></label>`;
  const styleSection = (name,body) => `<details class="p-chart-style-section"><summary>${name}</summary><div class="p-chart-config">${body}</div></details>`;
  function stylePanel(){const parts=st.watermarkParts||{ticker:true,interval:false,description:false};return `<div class="p-chart-config"><label>Preset <select class="s-select" data-preset>${options(['Default','High contrast','Mono','Ocean','Accessible','Terminal'],st.preset || 'Default')}</select></label><button class="s-btn s-btn-sm" data-reset-style>Reset style</button></div>`+
    styleSection('Chart frame',`<label>Background <select class="s-select" data-background-mode>${options(['Solid','Gradient'],st.backgroundMode||'Solid')}</select></label>${styleColor('background','Background')}${styleColor('backgroundEnd','Gradient end')}${styleColor('grid','Grid lines')}${styleColor('crosshair','Crosshair')}`)+
    styleSection('Text watermark',`${['ticker','interval','description'].map(key=>`<label><input type="checkbox" data-watermark="${key}" ${st.watermarkOn&&parts[key]?'checked':''}>${key[0].toUpperCase()+key.slice(1)}</label>`).join('')}${styleColor('watermark','Watermark text')}`)+
    styleSection('Price scale',`${styleColor('priceAxis','Price axis labels')}${styleColor('lastUp','Last price up')}${styleColor('lastUpText','Last price up text')}${styleColor('lastDown','Last price down')}${styleColor('lastDownText','Last price down text')}`)+
    styleSection('Time axis',styleColor('timeAxis','Time axis labels'))+
    styleSection('Candles & bars',styleColor('up','Up (gain)')+styleColor('down','Down (loss)'))+
    styleSection('Line & mountain',`${styleColor('line','Line')}<label>Line width <input type="range" aria-label="Line width" min="0.5" max="5" step="0.5" data-width value="${st.lineWidth}"></label><label>Line style <select class="s-select" data-line-dash>${options(['Solid','Dashed','Dotted'],st.lineDash)}</select></label>`)+
    styleSection('Comparison series',Array.from({length:10},(_,i)=>styleColor('comparison'+(i+1),'Series '+(i+1))).join(''))+
    styleSection('Metrics',`${styleColor('metric','Metric overlay')}<label>Opacity <input type="range" data-metric-opacity aria-label="Metric opacity" min="0" max="1" step="0.05" value="${st.metricOpacity??.85}"><output data-metric-opacity-label>${Math.round((st.metricOpacity??.85)*100)}%</output></label>`);}
  el.innerHTML = `<div class="p-chart ${compact ? 'p-chart-compact' : ''}">
    <div class="p-chart-toolbar"><label>Range <select class="s-select" data-range>${options(RANGES, st.range)}</select></label><label>Interval <select class="s-select" data-interval></select></label><label>Style <select class="s-select" data-type>${options(TYPES, st.chartType)}</select></label><button class="s-btn s-btn-sm" data-log aria-pressed="${st.log}">Log</button><button class="s-btn s-btn-sm" data-volume aria-pressed="${st.volume}">Volume</button><button class="s-btn s-btn-sm" data-style-toggle aria-expanded="false">Customize style</button><button class="s-btn s-btn-sm" data-settings aria-expanded="false">Studies & tools</button><button class="s-btn s-btn-sm" data-fullscreen aria-label="Full screen chart">⤢</button></div>
    <div class="p-chart-style" hidden>${stylePanel()}</div><div class="p-chart-settings" hidden>
      <div class="p-chart-config">${[['extended','Extended hours'],['ohlcv','OHLCV legend'],['hoverLegend','Hover legend'],['watermarkOn','Watermark'],['verticalCrosshair','Vertical crosshair'],['horizontalCrosshair','Horizontal crosshair'],['snap','Snap to candle']].map(([key,label])=>`<label><input type="checkbox" data-toggle="${key}" ${st[key]?'checked':''}>${label}</label>`).join('')}<span class="p-chart-data-gates"></span></div>
      <div class="p-chart-config"><label>Compare symbols <input class="s-input" data-compare value="${esc(st.compare)}" placeholder="SPY, QQQ" aria-label="Compare symbols"></label><button class="s-btn s-btn-sm" data-apply-compare>Apply</button><label>Period <select class="s-select" data-metric-period>${options(['quarterly','annual'],st.metricPeriod)}</select></label><label>Metric style <select class="s-select" data-metric-type>${options(['Bars','Line','Area'],st.metricType)}</select></label><label>Find metric <input class="s-input" data-metric-search type="search" aria-label="Search fundamentals"></label><label>Metric <select class="s-select" data-metric><option value="">None</option></select></label></div>
      <div class="p-chart-config"><input class="s-input" type="search" data-study-search aria-label="Search indicators" placeholder="Search indicators"><button class="s-btn s-btn-sm" data-manage-studies aria-pressed="false">Manage all</button><button class="s-btn s-btn-sm" data-remove-studies>Remove all studies</button></div><div class="p-chart-studies">${Object.entries(INDICATORS).map(([id, d]) => `<div data-study-card="${id}"><small class="s-muted">${esc(d.category || (d.pane === 'volume' || d.needsVolume ? 'Volume' : d.pane === 'overlay' ? 'Trend & averages' : 'Momentum & volatility'))}</small><label><input type="checkbox" data-study="${id}" ${st.indicators.some(i => i.id === id) ? 'checked' : ''}> ${esc(d.label)}</label>${d.params.map(p => `<label class="p-chart-param">${esc(p.label)} <input type="number" data-param="${id}:${p.key}" min="${p.min}" max="${p.max}" step="${p.step}" value="${st.indicators.find(i => i.id === id)?.params?.[p.key] ?? p.def}" aria-label="${esc(d.short + ' ' + p.label)}"></label>`).join('')}</div>`).join('')}</div>
      <div class="p-chart-config"><label>Drawing <select class="s-select" data-tool>${options(['Crosshair', 'Select', 'Horizontal', 'Vertical', 'Trend line', 'Fibonacci', 'Channel', 'Pitchfork', 'Rectangle', 'Circle', 'Ellipse', 'Measure', 'Time range', 'Text'], 'Crosshair')}</select></label><button class="s-btn s-btn-sm" data-clear>Clear drawings</button><label>Bar replay <input type="range" data-replay min="0" max="1" step="any" value="1"></label><button class="s-btn s-btn-sm" data-play>Play</button><label>Speed <select class="s-select" data-speed>${options(['0.5','1','2','5','10'],'1')}</select> bars/s</label><label>Replay date <input class="s-input" type="date" data-replay-date></label><button class="s-btn s-btn-sm" data-step>Next bar</button><button class="s-btn s-btn-sm" data-reset>Reset zoom</button></div>
      <div class="p-chart-drawings"></div><div class="p-chart-config"><input class="s-input" data-set-name placeholder="Chart set name" aria-label="Chart set name"><button class="s-btn s-btn-sm" data-save-set>Save set</button><select class="s-select" data-set aria-label="Load chart set"><option value="">Load chart set</option></select><button class="s-btn s-btn-sm" data-delete-set>Delete set</button></div>
    </div><div class="p-chart-live"><button class="s-btn s-btn-sm" data-chart-refresh>Refresh</button><button class="s-btn s-btn-sm" data-chart-pause aria-pressed="false">Pause updates</button><span data-chart-status role="status"></span></div><div class="p-chart-legend" aria-live="off"></div><div class="p-chart-message" role="status"></div><div class="p-chart-plot"><canvas tabindex="0" role="img" aria-label="Price chart. Arrow keys move the crosshair; plus and minus zoom. Use Download for the data table."></canvas></div><div class="p-chart-foot"></div></div>`;
  el.querySelector('[data-log]').insertAdjacentHTML('afterend', `<button class="s-btn s-btn-sm" data-percent aria-pressed="${!!st.percent}">Percent</button>`);
  el.querySelector('.p-chart-toolbar').insertAdjacentHTML('beforeend', '<label data-baseline-control hidden>Baseline <input class="s-input" type="number" min="0" step="any" data-baseline-price aria-label="Baseline price"><button class="s-btn s-btn-sm" data-baseline-reset type="button">Reset baseline</button></label>');
  for(const card of el.querySelectorAll('[data-study-card]')){const id=card.dataset.studyCard,study=st.indicators.find(i=>i.id===id);card.insertAdjacentHTML('beforeend',`${PRICE_BASIS_STUDIES.has(id)?`<label class="p-chart-param">Source <select class="s-select" data-study-source="${id}" aria-label="${esc(INDICATORS[id].short)} price basis">${options(['Close','Open','High','Low'],study?.source||'Close')}</select></label>`:''}<label class="p-chart-param">Color <input type="color" data-study-color="${id}" data-custom="${!!study?.color}" value="${esc(study?.color||'#e7b04a')}" aria-label="${esc(INDICATORS[id].short)} color"></label>`);}
  const $ = s => el.querySelector(s), canvas = $('canvas'), plot = $('.p-chart-plot'), legend = $('.p-chart-legend'), message = $('.p-chart-message');
  const g = canvas.getContext('2d');
  function updateIntervals() { const a = intervals(symbol, st.range, data?.allowed); if (!a.includes(st.interval)) save({ interval: a.includes('1d') ? '1d' : a.includes('5m') ? '5m' : a[0] }); $('[data-interval]').innerHTML = options(a, st.interval); }
  function chartSets() { const sets = store.get('chartSets', {}); $('[data-set]').innerHTML = '<option value="">Load chart set</option>' + Object.keys(sets).map(n => `<option>${esc(n)}</option>`).join(''); }
  chartSets(); drawList();
  function activeBars() { if (!data) return []; const available = st.extended ? data.bars : data.bars.filter(b => !b.ext); const b = available.slice(0, Math.max(1, Math.ceil(available.length * replay))); const n = Math.max(8, Math.floor(b.length / zoom)); const end = Math.max(Math.min(b.length, b.length - pan), Math.min(n, b.length)); return b.slice(Math.max(0, end - n), end); }
  function render() {
    if (destroyed) return;
    const rect = plot.getBoundingClientRect(), w = Math.max(100, plot.clientWidth), layout = paneLayout(Math.max(130, rect.height), st.indicators.filter(i => INDICATORS[i.id]?.pane === 'sub').length), h = layout.height, dpr = devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    $('[data-baseline-control]').hidden = st.chartType !== 'Baseline';
    const raw = activeBars(); if (!raw.length) return;
    const baselinePrice = st.baselineSymbol === symbol && Number.isFinite(st.baselinePrice) && st.baselinePrice > 0 ? st.baselinePrice : data.bars[0].c;
    if (document.activeElement !== $('[data-baseline-price]')) $('[data-baseline-price]').value = baselinePrice;
    const b = st.chartType === 'Heikin Ashi' ? heikinAshi(raw) : raw;
    const styles = getComputedStyle(el), color = name => styles.getPropertyValue(name).trim();
    const appearance = st.appearance || {}, palette = [appearance.line || color('--s-accent'), ...Array.from({length:10},(_,i)=>appearance['comparison'+(i+1)] || COLORS.map(color)[(i+1)%COLORS.length])], up = appearance.up || color('--s-up'), down = appearance.down || color('--s-down'), border = appearance.grid || color('--s-border'), muted = appearance.text || color('--s-muted');
    if(st.backgroundMode==='Gradient'){const gradient=g.createLinearGradient(0,0,0,h);gradient.addColorStop(0,appearance.background||color('--s-panel'));gradient.addColorStop(1,appearance.backgroundEnd||EXTRA_STYLE_COLORS.backgroundEnd);g.fillStyle=gradient;}else g.fillStyle = appearance.background || color('--s-panel'); g.fillRect(0,0,w,h);
    const normalized = comparisons.length > 0 || !!st.percent;
    const normBase = raw[0].c;
    const val = v => v == null ? null : normalized ? (v / normBase - 1) * 100 : v;
    const subs = st.indicators.filter(i => INDICATORS[i.id]?.pane === 'sub' && (!INDICATORS[i.id]?.needsVolume || raw.some(b => b.v != null)));
    const paneH = layout.paneH, left = 12, right = w - 66, top = 12, bottom = h - 30 - subs.length * paneH, width = Math.max(20, right - left);
    const x = i => left + (i + .5) / b.length * width;
    const series = st.indicators.filter(i => !INDICATORS[i.id]?.needsVolume || raw.some(b => b.v != null)).map(i => {const key={Open:'o',High:'h',Low:'l'}[i.source],input=PRICE_BASIS_STUDIES.has(i.id)&&key?raw.map(b=>({...b,c:b[key]??b.c})):raw;return { ...i, def: INDICATORS[i.id], result: computeIndicator(i.id, input, i.params, { periodsPerYear: symbol.endsWith('-USD') ? 365 : 252, sessionKey: bar => new Date(bar.t).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) }) };}).filter(i => i.def);
    const compareLines = comparisons.map(c => { const base = stepValueAt(c.bars.map(p => ({ t: p.t, v: p.c })), raw[0].t) ?? c.bars[0]?.c; return { name: c.symbol, values: raw.map(p => { const v = stepValueAt(c.bars.map(z => ({ t: z.t, v: z.c })), p.t); return v == null || !base ? null : (v / base - 1) * 100; }) }; });
    const values = b.flatMap(z => [val(z.l ?? z.c), val(z.h ?? z.c)]);
    if (st.chartType === 'Baseline') values.push(val(baselinePrice));
    for (const s of series.filter(i => i.def.pane === 'overlay')) for (const line of s.result.lines) values.push(...line.values.map(val).filter(v => v != null));
    for (const line of compareLines) values.push(...line.values.filter(v => v != null));
    let min = Math.min(...values), max = Math.max(...values); const pad = (max - min || Math.abs(max) * .02 || 1) * .08; min -= pad; max += pad;
    const useLog = st.log && !normalized && min > 0;
    const scale = v => useLog ? Math.log(v) : v;
    const y = v => bottom - (scale(v) - scale(min)) / (scale(max) - scale(min)) * (bottom - top);
    geometry = { x, y, raw, left, right, top, bottom, min, max, normBase, normalized, invert: py => { const t = (bottom - py) / (bottom - top); const value = useLog ? Math.exp(scale(min) + t * (scale(max) - scale(min))) : min + t * (max - min); return normalized ? (value / 100 + 1) * normBase : value; } };
    g.font = '10px ' + styles.getPropertyValue('--s-mono'); g.textAlign = 'left';
    for (const t of niceTicks(min, max, 5).ticks) { const yy = y(t); g.strokeStyle = border; g.beginPath(); g.moveTo(left, yy); g.lineTo(right, yy); g.stroke(); g.fillStyle = appearance.priceAxis||muted; g.fillText(normalized ? t.toFixed(1) + '%' : fmt.price(t), right + 5, yy + 3); }
    const line = (values2, yFn, c, dash = false, kind = 'line', paneBottom = bottom) => {
      g.strokeStyle = c; g.fillStyle = c; g.lineWidth = st.lineWidth; g.setLineDash(dash || st.lineDash === 'Dashed' ? [4, 3] : st.lineDash === 'Dotted' ? [1,3] : []); g.beginPath(); let started = false;
      values2.slice(0, b.length).forEach((v, i) => { if (v == null || !Number.isFinite(v)) { started = false; return; } const yy = yFn(v); if (kind === 'hist') { g.fillRect(x(i) - width / b.length * .3, Math.min(yy, yFn(0)), width / b.length * .6, Math.max(1, Math.abs(yFn(0) - yy))); } else if (kind === 'dots') { g.moveTo(x(i) + 2, yy); g.arc(x(i), yy, 2, 0, Math.PI * 2); } else if (!started) { g.moveTo(x(i), yy); started = true; } else g.lineTo(x(i), yy); });
      g.stroke(); g.setLineDash([]); void paneBottom;
    };
    // Clip the financial plot so drawing/indicator paths cannot overlap toolbar and axes.
    g.save(); g.beginPath(); g.rect(left, top, width, bottom - top); g.clip();
    if (st.volume) { const mv = Math.max(...raw.map(z => z.v ?? 0), 1); raw.forEach((z, i) => { if (z.v == null) return; g.globalAlpha = .18; g.fillStyle = z.c >= (z.o ?? z.c) ? up : down; const vh = z.v / mv * (bottom - top) * .22; g.fillRect(x(i) - width / b.length * .35, bottom - vh, Math.max(1, width / b.length * .7), vh); }); g.globalAlpha = 1; }
    if (st.volume) for (const s of series.filter(i => i.def.pane === 'volume')) {
      const mv = Math.max(...raw.map(z => z.v ?? 0), 1);
      s.result.lines.forEach(l => line(l.values, v => bottom - v / mv * (bottom - top) * .22, s.color||palette[1]));
    }
    if (['Candles', 'OHLC', 'Heikin Ashi'].includes(st.chartType)) b.forEach((z, i) => { const c = z.c >= (z.o ?? z.c) ? up : down; const xx = x(i), cw = Math.max(1, Math.min(12, width / b.length * .65)); g.strokeStyle = c; g.fillStyle = c; g.beginPath(); g.moveTo(xx, y(val(z.h ?? z.c))); g.lineTo(xx, y(val(z.l ?? z.c))); if (st.chartType === 'OHLC') { g.moveTo(xx - cw / 2, y(val(z.o ?? z.c))); g.lineTo(xx, y(val(z.o ?? z.c))); g.moveTo(xx, y(val(z.c))); g.lineTo(xx + cw / 2, y(val(z.c))); } else g.fillRect(xx - cw / 2, Math.min(y(val(z.o ?? z.c)), y(val(z.c))), cw, Math.max(1, Math.abs(y(val(z.o ?? z.c)) - y(val(z.c))))); g.stroke(); });
    else { const cv = b.map(z => val(z.c)); if (st.chartType === 'Baseline') {
      const baseY = y(val(baselinePrice));
      for (const [c, clipTop, clipBottom] of [[up, top, baseY], [down, baseY, bottom]]) {
        g.save(); g.beginPath(); g.rect(left, clipTop, width, Math.max(0, clipBottom - clipTop)); g.clip();
        g.beginPath(); g.moveTo(x(0), baseY); cv.forEach((v, i) => g.lineTo(x(i), y(v))); g.lineTo(x(b.length - 1), baseY); g.closePath(); g.globalAlpha = .15; g.fillStyle = c; g.fill(); g.globalAlpha = 1; line(cv, y, c); g.restore();
      }
      g.strokeStyle = muted; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(left, baseY); g.lineTo(right, baseY); g.stroke(); g.setLineDash([]);
    } else { if (st.chartType === 'Area') { g.beginPath(); g.moveTo(x(0), bottom); cv.forEach((v, i) => g.lineTo(x(i), y(v))); g.lineTo(x(b.length - 1), bottom); g.closePath(); g.globalAlpha = .13; g.fillStyle = palette[0]; g.fill(); g.globalAlpha = 1; } line(cv, y, palette[0]); } }
    for(const profile of series.filter(s=>s.result.volumeProfile)){const bins=profile.result.volumeProfile,mv=Math.max(1,...bins.map(b=>b.volume));g.globalAlpha=.18;g.fillStyle=profile.color||palette[1];for(const bin of bins)g.fillRect(left,y(val(bin.price))-2,bin.volume/mv*width*.3,4);g.globalAlpha=1;}
    for (const s of series.filter(i => i.def.pane === 'overlay')) s.result.lines.forEach((l, j) => {
      if (l.kind === 'fill-to' && s.result.lines[l.ref]) {
        const other = s.result.lines[l.ref].values; g.fillStyle = s.color||palette[(j + 1) % palette.length]; g.globalAlpha = .12;
        for (let k = 1; k < Math.min(b.length, l.values.length, other.length); k++) if ([l.values[k - 1], l.values[k], other[k - 1], other[k]].every(v => v != null)) {
          g.beginPath(); g.moveTo(x(k - 1), y(val(l.values[k - 1]))); g.lineTo(x(k), y(val(l.values[k]))); g.lineTo(x(k), y(val(other[k]))); g.lineTo(x(k - 1), y(val(other[k - 1]))); g.closePath(); g.fill();
        } g.globalAlpha = 1;
      }
      line(l.values.map(val), y, s.color||palette[(j + 1) % palette.length], l.dash, l.kind);
    });
    compareLines.forEach((l, i) => line(l.values, y, palette[(i + 1) % palette.length]));
    if (st.watermarkOn) {const parts=st.watermarkParts||{ticker:true},labels=[parts.ticker?symbol:'',parts.interval?`${st.range} · ${st.interval}`:'',parts.description?data.name||symbol:''].filter(Boolean);g.save();g.globalAlpha=.4;g.fillStyle=appearance.watermark||border;g.font='bold '+Math.min(48,Math.max(16,width/12))+'px '+styles.getPropertyValue('--s-font');g.textAlign='center';labels.forEach((label,i)=>g.fillText(label,(left+right)/2,(top+bottom)/2+(i-(labels.length-1)/2)*36,width-20));g.restore();}
    for (const [di,d] of st.drawings.entries()) if (d.symbol === symbol) {
      const ix = t => { const found = raw.findIndex(p => p.t >= t); return found === -1 ? b.length - 1 : found; };
      const ax=x(ix(d.a.t)), ay=y(val(d.a.v)), bx=d.b?x(ix(d.b.t)):right, by=d.b?y(val(d.b.v)):ay;
      g.strokeStyle=d.color || palette[1]; g.fillStyle=d.color || palette[1]; g.lineWidth=di===selectedDrawing?2.5:1.4; g.setLineDash([]);
      const segment=(x1,y1,x2,y2)=>{g.beginPath();g.moveTo(x1,y1);g.lineTo(x2,y2);g.stroke();};
      if(d.type==='Horizontal') segment(left,ay,right,ay);
      else if(d.type==='Vertical') segment(ax,top,ax,bottom);
      else if(d.type==='Text') g.fillText(d.text || 'Note',ax,ay);
      else if(d.type==='Rectangle'||d.type==='Time range') { const t=d.type==='Time range'?top:ay, hh=d.type==='Time range'?bottom-top:by-ay;g.strokeRect(ax,t,bx-ax,hh);g.globalAlpha=.08;g.fillRect(ax,t,bx-ax,hh);g.globalAlpha=1;if(d.type==='Time range')g.fillText(Math.abs(ix(d.b.t)-ix(d.a.t))+' bars · '+Math.round(Math.abs(d.b.t-d.a.t)/86400000)+' days',Math.min(ax,bx),top+14); }
      else if(d.type==='Circle'||d.type==='Ellipse') {g.beginPath();g.ellipse((ax+bx)/2,(ay+by)/2,Math.max(1,Math.abs(bx-ax)/2),Math.max(1,d.type==='Circle'?Math.abs(bx-ax)/2:Math.abs(by-ay)/2),0,0,Math.PI*2);g.stroke();}
      else if(d.type==='Fibonacci') for(const level of FIB_LEVELS){const yy=ay+(by-ay)*level;segment(Math.min(ax,bx),yy,right,yy);g.fillText(String(level),Math.min(ax,bx),yy-3);}
      else if(d.type==='Pitchfork'&&d.c){const cx=x(ix(d.c.t)),cy=y(val(d.c.v)),mx=(bx+cx)/2,my=(by+cy)/2,dx=mx-ax,dy=my-ay;segment(bx,by,cx,cy);for(const [xx,yy] of [[ax,ay],[bx,by],[cx,cy]])segment(xx-dx*5,yy-dy*5,xx+dx*5,yy+dy*5);}
      else { const dx=bx-ax,dy=by-ay; if(d.type==='Trend line'||d.type==='Channel') {const slope=dx?dy/dx:0;segment(left,ay+(left-ax)*slope,right,ay+(right-ax)*slope);if(d.type==='Channel'&&d.c){const cx=x(ix(d.c.t)),cy=y(val(d.c.v));segment(left,cy+(left-cx)*slope,right,cy+(right-cx)*slope);}}else segment(ax,ay,bx,by);if(d.type==='Measure'&&d.b)g.fillText(fmt.change(d.b.v-d.a.v)+' ('+fmt.pct((d.b.v/d.a.v-1)*100)+') · '+Math.abs(ix(d.b.t)-ix(d.a.t))+' bars',Math.min(ax,bx),Math.min(ay,by)-7); }
      if(di===selectedDrawing)for(const point of [d.a,d.b,d.c].filter(Boolean)){g.beginPath();g.arc(x(ix(point.t)),y(val(point.v)),4,0,Math.PI*2);g.fill();}
    }
    g.restore();
    for (let k = 0; k < subs.length; k++) {
      const s = series.find(i => i.id === subs[k].id), pTop = bottom + k * paneH + 16, pBottom = pTop + paneH - 22;
      const vv = s.result.lines.flatMap(l => l.values.filter(v => v != null)); const lo = s.result.range?.[0] ?? Math.min(0, ...vv), hi = s.result.range?.[1] ?? Math.max(0, ...vv), yy = v => pBottom - (v - lo) / (hi - lo || 1) * (pBottom - pTop);
      g.strokeStyle = border; g.beginPath(); g.moveTo(left, pTop - 8); g.lineTo(right, pTop - 8); g.stroke(); g.fillStyle = muted; g.fillText(s.def.short, right + 4, pTop + 4);
      for (const level of s.result.levels || []) { g.strokeStyle = border; g.beginPath(); g.moveTo(left, yy(level)); g.lineTo(right, yy(level)); g.stroke(); }
      s.result.lines.forEach((l, j) => line(l.values, yy, s.color||palette[j % palette.length], l.dash, l.kind));
    }
    const metric = metrics.find(m => m.id === st.metric && m.available);
    if (metric) {
      let vv=raw.map(p=>stepValueAt(metric.points,p.t));
      if(st.metricType==='Bars'){
        vv=raw.map(()=>null);
        for(const p of metric.points)if(p.t>=raw[0].t&&p.t<=raw.at(-1).t){const i=raw.findIndex(b=>b.t>=p.t);if(i>=0)vv[i]=p.v;}
      }
      const reported=vv.filter(v=>v!=null),metricColor=appearance.metric || palette[1];
      if(reported.length){
        const lo=Math.min(...reported,...(st.metricType==='Line'?[]:[0])),hi=Math.max(...reported,...(st.metricType==='Line'?[]:[0]));
        const metricY=v=>bottom-(v-lo)/(hi-lo||1)*(bottom-top);
        g.save();g.beginPath();g.rect(left,top,width,bottom-top);g.clip();
        const opacity=Math.max(0,Math.min(1,st.metricOpacity??.85));g.globalAlpha=opacity;
        if(st.metricType==='Area'){g.beginPath();g.moveTo(x(0),bottom);vv.forEach((v,i)=>{if(v!=null)g.lineTo(x(i),metricY(v));});g.lineTo(x(b.length-1),bottom);g.closePath();g.globalAlpha=.15*opacity;g.fillStyle=metricColor;g.fill();g.globalAlpha=opacity;}
        line(vv,metricY,metricColor,true,st.metricType==='Bars'?'hist':'line');g.restore();
      }
      g.fillStyle=metricColor;g.fillText(metric.label+' '+(reported.length?(metric.unit==='$'?'$'+fmt.compact(reported.at(-1)):fmt.compact(reported.at(-1))+metric.unit):'No fiscal period-end in view; choose Line')+' · '+st.metricPeriod+' · independent scale',left+6,top+12);
    }
    const last=raw.at(-1),lastValue=val(last.c),lastY=Math.max(top+8,Math.min(bottom-8,y(lastValue))),rising=last.c>=(last.o??raw.at(-2)?.c??last.c),priceText=normalized?lastValue.toFixed(1)+'%':fmt.price(last.c);g.fillStyle=rising?appearance.lastUp||up:appearance.lastDown||down;g.fillRect(right+2,lastY-8,64,16);g.fillStyle=(rising?appearance.lastUpText:appearance.lastDownText)||'#ffffff';g.fillText(priceText,right+5,lastY+3);
    const ticks = Math.max(2, Math.floor(width / 110)); for (let i = 0; i < ticks; i++) { const bi = Math.floor(i / (ticks - 1) * (b.length - 1)); g.fillStyle = appearance.timeAxis||muted; g.textAlign = i === ticks - 1 ? 'right' : 'left'; g.fillText(new Date(b[bi].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: /[mh]$/.test(data.interval) ? 'America/New_York' : 'UTC', ...(i === 0 ? { year: 'numeric' } : {}) }), x(bi), h - 8); } g.textAlign = 'left';
    if (cursor != null) { const i = Math.max(0, Math.min(raw.length - 1, cursor)), z = raw[i]; g.strokeStyle = appearance.crosshair||muted; g.setLineDash([3, 3]); g.beginPath(); if(st.verticalCrosshair){g.moveTo(x(i), top); g.lineTo(x(i), h - 24);} if(st.horizontalCrosshair){g.moveTo(left, y(val(z.c))); g.lineTo(right, y(val(z.c)));} g.stroke(); g.setLineDash([]); showLegend(st.hoverLegend ? z : raw.at(-1)); } else showLegend(raw.at(-1));
    canvas.setAttribute('aria-label', `${symbol} ${st.range} ${st.chartType} chart${normalized?', percent scale':useLog?', logarithmic scale':''}, ${raw.length} visible bars, last close ${fmt.price(raw.at(-1).c)}. Arrow keys move crosshair; plus and minus zoom.`);
    function showLegend(z) { legend.hidden = !st.ohlcv; legend.innerHTML = `<b>${esc(symbol)}</b><span>${esc(dateLabel(z.t, /[mh]$/.test(data.interval)))}${/[mh]$/.test(data.interval) ? ' ET' : ''}</span><span>O ${z.o == null ? '—' : fmt.price(z.o)} H ${z.h == null ? '—' : fmt.price(z.h)} L ${z.l == null ? '—' : fmt.price(z.l)} <b>C ${fmt.price(z.c)}</b> V ${z.v == null ? '—' : fmt.compact(z.v)}</span>${comparisons.map((c, i) => `<span style="color:${esc(st.appearance['comparison'+(i+1)] || color(COLORS[(i + 1) % COLORS.length]))}">${esc(c.symbol)}</span>`).join('')}${normalized ? '<span>Comparison: % from first visible close</span>' : ''}`; }
  }
  const refreshInterval = () => symbol.endsWith('-USD') ? 15000 : 30000;
  function showRefresh(state = refreshState) {
    if (state) refreshState = state;
    if (!refreshState || destroyed) return;
    const b = $('[data-chart-pause]');
    b.textContent = refreshState.paused ? 'Resume updates' : 'Pause updates';
    b.setAttribute('aria-pressed', String(refreshState.paused));
    const replaying = replay < 1 || replayTimer;
    $('[data-chart-status]').textContent = (replaying ? 'Replay mode · automatic updates paused' : refreshLabel(refreshState)) + ` · ${refreshInterval() / 1000}s checks while visible`;
    $('[data-chart-status]').title = refreshState.error || 'Checks do not remove provider delays. Unchanged prices may mean the market is closed or no new source bars are available.';
    if (!data) return;
    const latest = data.asOf || (data.bars.at(-1) ? new Date(data.bars.at(-1).t).toISOString() : null);
    const stamp = chartSourceStamp(latest,data.interval,data.asOfKind==='sample');
    const kind = data.asOfKind === 'sample' ? 'Latest source sample' : /[mh]$/.test(data.interval) ? 'Latest bar starts' : 'Latest period';
    $('.p-chart-foot').textContent = `${data.source} · ${data.delayed ? 'delayed source' : 'source data'} · USD · ${data.interval} bars · ${kind}: ${stamp} · ${(data.notes || []).join(' ')}`;
  }
  function load() {
    if (destroyed) return;
    stopReplay(); replay = 1; $('[data-replay]').value = 1;
    controller?.abort(); requestId++; resetRequested = true;
    updateIntervals(); data = null; comparisons = []; metrics = [];
    message.innerHTML = ui.loading('Loading price history…'); render();
    poll.restart().catch(() => {});
  }
  async function refreshPrices(signal) {
    const id = requestId, full = resetRequested;
    resetRequested = false;
    const params = { symbol, range: st.range, interval: st.interval };
    try {
      const result = await api('chart/history', params, { signal });
      if (id !== requestId || destroyed || signal.aborted) return;
      if (!result.bars?.length) throw new Error('No price bars returned.');
      const oldLength = data?.bars.length || 0, oldLastTime = data?.bars.at(-1)?.t;
      const visibleCount = activeBars().length, replayCount = Math.ceil(oldLength * replay);
      data = result;
      if (full) {
        fullMetricsLoaded = false; comparisons = []; metrics = []; zoom = 1; pan = 0; cursor = null;
        const cap = result.capabilities || {};
        $('[data-toggle=extended]').disabled = !cap.extendedHours;
        $('[data-toggle=extended]').title = cap.reasons?.extendedHours || '';
        $('.p-chart-data-gates').textContent = [!cap.totalReturn ? 'Total return unavailable: ' + (cap.reasons?.totalReturn || 'adjusted data unavailable') : '', !cap.corporateEvents ? 'Dividend/split markers unavailable: ' + (cap.reasons?.corporateEvents || 'events feed unavailable') : ''].filter(Boolean).join(' · ');
        for (const input of el.querySelectorAll('[data-study]')) {
          const unavailable = INDICATORS[input.dataset.study]?.needsVolume && !result.bars.some(b => b.v != null);
          input.disabled = !!unavailable; input.title = unavailable ? 'Volume is not reported for this series.' : '';
        }
        updateIntervals();
      } else {
        if (replay < 1) { replay = Math.min(1, replayCount / result.bars.length); $('[data-replay]').value = replay; }
        if (zoom > 1 && visibleCount) zoom = Math.max(1, Math.ceil(result.bars.length * replay) / visibleCount);
        if (pan > 0 && oldLastTime != null) pan += result.bars.filter(b => b.t > oldLastTime).length;
      }
      $('[data-replay-date]').min = new Date(result.bars[0].t).toISOString().slice(0, 10);
      $('[data-replay-date]').max = new Date(result.bars.at(-1).t).toISOString().slice(0, 10);
      if (replay >= 1) $('[data-replay-date]').value = $('[data-replay-date]').max;
      message.innerHTML = ''; showRefresh(); render();
      const symbols = [...new Set(st.compare.split(/[ ,]+/).map(s => s.trim().toUpperCase()).filter(s => s && s !== symbol && symbolOK(s)))].slice(0, 10);
      const results = await Promise.allSettled(symbols.map(s => api('chart/history', { ...params, symbol: s }, { signal })));
      if (id !== requestId || destroyed || signal.aborted) return;
      const previous = new Map(comparisons.map(c => [c.symbol, c]));
      comparisons = results.flatMap((r, i) => r.status === 'fulfilled' ? [r.value] : previous.has(symbols[i]) ? [previous.get(symbols[i])] : []);
      const failed = results.flatMap((r, i) => r.status === 'rejected' ? [symbols[i] + ': comparison update unavailable'] : []);
      if (failed.length) message.textContent = failed.join(' · ');
      render();
      if (full) {
        try {
          const period = st.metricPeriod;
          const m = await api('chart/metrics', { symbol: params.symbol, period }, { signal });
          if (id !== requestId || destroyed || signal.aborted || period !== st.metricPeriod) return;
          metrics = m.series; metricMenu(); render();
          if (st.metric && !metrics.some(m => m.id === st.metric)) loadMetrics();
        } catch (e) {
          if (e.name !== 'AbortError' && id === requestId && !destroyed) message.textContent = 'Financial metric history is unavailable; price updates remain active.';
        }
      }
    } catch (e) {
      if (!data && id === requestId && !destroyed) resetRequested = true;
      if (e.name === 'AbortError' || id !== requestId || destroyed) throw e;
      if (!data) message.innerHTML = ui.error(e.message);
      throw e;
    }
  }
  function filterStudies(){const q=$('[data-study-search]').value.trim().toLowerCase();for(const card of el.querySelectorAll('[data-study-card]')){const id=card.dataset.studyCard;card.hidden=!(card.textContent.toLowerCase().includes(q)&&(!manageStudies||st.indicators.some(i=>i.id===id)));}}
  $('[data-study-search]').addEventListener('input',filterStudies);
  function metricMenu(){const q=$('[data-metric-search]').value.toLowerCase();const groups=[...new Set(metrics.filter(m=>m.label.toLowerCase().includes(q)).map(m=>m.group||'Key metrics'))];$('[data-metric]').innerHTML='<option value="">None</option>'+groups.map(group=>'<optgroup label="'+esc(group)+'">'+metrics.filter(m=>(m.group||'Key metrics')===group&&m.label.toLowerCase().includes(q)).map(m=>`<option value="${esc(m.id)}" ${st.metric===m.id?'selected':''} ${m.available?'':'disabled'}>${esc(m.label+(m.derived?' (derived)':'')+(m.available?'':' — '+m.reason))}</option>`).join('')+'</optgroup>').join('');}
  $('[data-metric-search]').addEventListener('input',metricMenu);
  async function loadMetrics(){const id=requestId;const period=st.metricPeriod;message.textContent='Loading financial metric history…';try{const m=await api('chart/metrics',{symbol,period:st.metricPeriod,full:1});if(destroyed||id!==requestId||period!==st.metricPeriod)return;metrics=m.series;fullMetricsLoaded=true;message.textContent='Fundamentals use fiscal period-end dates, not publication dates.';metricMenu();render();if(m.notes?.length)message.textContent=m.notes.join(' ');}catch(e){if(!destroyed)message.textContent='Fundamentals: '+e.message;}}
  function stopReplay(){clearInterval(replayTimer);replayTimer=null;const button=$('[data-play]');if(button)button.textContent='Play';showRefresh();}
  function playReplay(){if(!data?.bars.length)return;if(replay>=1)replay=1/data.bars.length;$('[data-play]').textContent='Pause';replayTimer=setInterval(()=>{replay=Math.min(1,replay+1/data.bars.length);$('[data-replay]').value=replay;$('[data-replay-date]').value=new Date(data.bars[Math.max(0,Math.ceil(replay*data.bars.length)-1)].t).toISOString().slice(0,10);render();if(replay>=1)stopReplay();},1000/+$('[data-speed]').value);}
  function drawList(){const box=$('.p-chart-drawings');box.innerHTML=st.drawings.map((d,i)=>d.symbol===symbol?`<div class="p-chart-drawing-row"><button class="s-btn s-btn-sm" data-drawing-edit="${i}" aria-pressed="${selectedDrawing===i}">${esc(d.type)} ${i+1}</button><button class="s-btn s-btn-sm" data-drawing-delete="${i}" aria-label="Delete drawing ${i+1}">Delete</button></div>`:'').join('');if(selectedDrawing==null||!st.drawings[selectedDrawing])return;const d=st.drawings[selectedDrawing];const form=document.createElement('form');form.className='p-chart-config';form.innerHTML=`${['a','b','c'].filter(k=>d[k]).map(k=>`<label>Point ${k.toUpperCase()} date (UTC)<input class="s-input" type="datetime-local" name="${k}-t" value="${new Date(d[k].t).toISOString().slice(0,16)}" required></label><label>Price<input class="s-input" type="number" step="any" name="${k}-v" value="${d[k].v}" required></label>`).join('')}<label>Color<input type="color" name="color" value="${d.color||'#e7b04a'}"></label>${d.type==='Text'?`<label>Text<input class="s-input" name="text" value="${esc(d.text||'')}" maxlength="160"></label>`:''}<button class="s-btn s-btn-sm">Apply drawing edits</button>`;box.append(form);form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),next={...d,color:f.get('color')};for(const k of ['a','b','c'])if(d[k]){const t=Date.parse(f.get(k+'-t')+'Z'),v=Number(f.get(k+'-v'));if(!Number.isFinite(t)||!Number.isFinite(v))return;next[k]={t,v};}if(d.type==='Text')next.text=f.get('text');save({drawings:st.drawings.map((d,i)=>i===selectedDrawing?next:d)});drawList();render();};}
  el.addEventListener('change', change);
  function change(e) {
    const t = e.target;
    if(t.matches('[data-tool]')){drawingStart=null;message.textContent='';return;}
    if(t.matches('[data-baseline-price]')){const price=Number(t.value);if(Number.isFinite(price)&&price>0){save({baselinePrice:price,baselineSymbol:symbol});message.textContent='';}else{message.textContent='Enter a baseline price greater than zero.';}render();return;}
    if(t.matches('[data-toggle]')) { save({[t.dataset.toggle]:t.checked});if(t.dataset.toggle==='watermarkOn'){const parts=st.watermarkParts||{ticker:true};if(t.checked&&!Object.values(parts).some(Boolean))parts.ticker=true;save({watermarkParts:parts});for(const input of el.querySelectorAll('[data-watermark]'))input.checked=t.checked&&!!parts[input.dataset.watermark];}render(); return; }
    if(t.matches('[data-background-mode]')){save({backgroundMode:t.value});render();return;}
    if(t.matches('[data-watermark]')){const parts=Object.fromEntries([...el.querySelectorAll('[data-watermark]')].map(input=>[input.dataset.watermark,input.checked]));save({watermarkParts:parts,watermarkOn:Object.values(parts).some(Boolean)});$('[data-toggle="watermarkOn"]').checked=st.watermarkOn;render();return;}
    if(t.matches('[data-metric-opacity]')){save({metricOpacity:Math.max(0,Math.min(1,+t.value))});$('[data-metric-opacity-label]').textContent=Math.round(st.metricOpacity*100)+'%';render();return;}
    if(t.matches('[data-preset]')) {save({preset:t.value,appearance:{...STYLE_PRESETS[t.value]}});for(const input of el.querySelectorAll('[data-color]'))if(st.appearance[input.dataset.color])input.value=st.appearance[input.dataset.color];render();return;}
    if(t.matches('[data-color]')) {save({appearance:{...st.appearance,[t.dataset.color]:t.value}});render();return;}
    if(t.matches('[data-width]')) {save({lineWidth:+t.value});render();return;}
    if(t.matches('[data-line-dash]')) {save({lineDash:t.value});render();return;}
    if(t.matches('[data-metric-period]')) {save({metricPeriod:t.value});loadMetrics();return;}
    if(t.matches('[data-metric-type]')) {save({metricType:t.value});render();return;}
    if(t.matches('[data-speed]')&&replayTimer){stopReplay();playReplay();return;}
    if(t.matches('[data-replay-date]')&&data){const at=Date.parse(t.value+'T23:59:59Z'),n=data.bars.filter(b=>b.t<=at).length;replay=Math.max(1,n)/data.bars.length;$('[data-replay]').value=replay;render();return;}
    if (t.matches('[data-range]')) { save({ range: t.value }); load(); }
    else if (t.matches('[data-interval]')) { save({ interval: t.value }); load(); }
    else if (t.matches('[data-type]')) { save({ chartType: t.value }); render(); }
    else if (t.matches('[data-study], [data-param], [data-study-source], [data-study-color]')) {if(t.matches('[data-study-color]'))t.dataset.custom='true';const indicators = [...el.querySelectorAll('[data-study]:checked')].map(input => { const id = input.dataset.study, params = defaultParams(id); for (const p of INDICATORS[id].params) { const field=$(`[data-param="${id}:${p.key}"]`),n = Number(field.value); params[p.key] = Number.isFinite(n) ? Math.max(p.min, Math.min(p.max, n)) : p.def;field.value=params[p.key];}const source=$(`[data-study-source="${id}"]`)?.value,color=$(`[data-study-color="${id}"]`);return { id, params,...(source?{source}:{}),...(color.dataset.custom==='true'?{color:color.value}:{}) }; }); save({ indicators }); filterStudies(); if(indicators.some(i=>i.id==='volprofile'))message.textContent="Volume by Price buckets each bar's volume at its close; this is not trade-at-price volume.";else if(message.textContent.startsWith('Volume by Price buckets'))message.textContent=''; render(); }
    else if (t.matches('[data-metric]')) { save({ metric: t.value }); render(); }
    else if (t.matches('[data-set]') && t.value) { const set = store.get('chartSets', {})[t.value]; if (set) { save(set); // Recreate the controls to reflect the restored set, without reusing listeners.
      const name = t.value; instance.destroy(); const next = mountChart(el, ctx, { compact, symbol }); Object.assign(instance, next); $('[data-set]').value = name;
    } }
  }
  el.addEventListener('click', click);
  function click(e) {
    const t = e.target.closest('button'); if (!t) return;
    if(t.matches('[data-baseline-reset]')) { save({baselinePrice:null,baselineSymbol:null});message.textContent='';render(); }
    else if(t.matches('[data-chart-refresh]')) { poll.request(true).catch(() => {}); }
    else if(t.matches('[data-chart-pause]')) { poll.setPaused(!poll.state().paused); save({updatesPaused:poll.state().paused}); }
    else if(t.matches('[data-style-toggle]')){const box=$('.p-chart-style');box.hidden=!box.hidden;t.setAttribute('aria-expanded',String(!box.hidden));if(!box.hidden){$('.p-chart-settings').hidden=true;$('[data-settings]').setAttribute('aria-expanded','false');}render();}
    else if(t.matches('[data-reset-style]')){save({preset:'Default',appearance:{},lineWidth:1.5,lineDash:'Solid',backgroundMode:'Solid',metricOpacity:.85,watermarkOn:false,watermarkParts:{ticker:true,interval:false,description:false}});$('.p-chart-style').innerHTML=stylePanel();$('[data-toggle="watermarkOn"]').checked=false;render();}
    else if(t.matches('[data-manage-studies]')){manageStudies=!manageStudies;t.setAttribute('aria-pressed',String(manageStudies));filterStudies();}
    else if(t.matches('[data-remove-studies]')){save({indicators:[]});el.querySelectorAll('[data-study]').forEach(e=>e.checked=false);filterStudies();render();}
    else if(t.matches('[data-play]')){if(replayTimer)stopReplay();else playReplay();}
    else if(t.matches('[data-drawing-edit]')){selectedDrawing=+t.dataset.drawingEdit;drawList();render();}
    else if(t.matches('[data-drawing-delete]')){const n=+t.dataset.drawingDelete;save({drawings:st.drawings.filter((_,i)=>i!==n)});selectedDrawing=null;drawList();render();}
    else if(t.matches('[data-retry]')) load();
    else if (t.matches('[data-settings]')) { const box = $('.p-chart-settings'); box.hidden = !box.hidden; t.setAttribute('aria-expanded', String(!box.hidden));if(!box.hidden){$('.p-chart-style').hidden=true;$('[data-style-toggle]').setAttribute('aria-expanded','false');}if(!box.hidden&&!fullMetricsLoaded)loadMetrics(); render(); }
    else if (t.matches('[data-percent]')) { save({ percent: !st.percent, log: false }); t.setAttribute('aria-pressed', String(st.percent)); $('[data-log]').setAttribute('aria-pressed', 'false'); render(); }
    else if (t.matches('[data-log]')) { save({ log: !st.log, percent: false }); t.setAttribute('aria-pressed', String(st.log)); $('[data-percent]').setAttribute('aria-pressed', 'false'); render(); }
    else if (t.matches('[data-volume]')) { save({ volume: !st.volume }); t.setAttribute('aria-pressed', String(st.volume)); render(); }
    else if (t.matches('[data-apply-compare]')) { const input = $('[data-compare]').value; const symbols = input.toUpperCase().split(/[ ,]+/).filter(Boolean); if (symbols.length > 10 || symbols.some(s => !symbolOK(s))) { message.textContent = 'Enter up to ten valid ticker symbols.'; return; } save({ compare: symbols.join(', ') }); load(); }
    else if (t.matches('[data-clear]')) { save({ drawings: st.drawings.filter(d => d.symbol !== symbol) }); drawingStart = null; selectedDrawing=null; drawList(); render(); }
    else if (t.matches('[data-step]')) { replay = Math.min(1, replay + 1 / (data?.bars.length || 1)); $('[data-replay]').value = replay; render(); }
    else if (t.matches('[data-reset]')) { zoom = 1; pan = 0; render(); }
    else if (t.matches('[data-fullscreen]')) { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else $('.p-chart').requestFullscreen?.().catch(() => { message.textContent = 'Full screen is unavailable in this browser.'; }); }
    else if (t.matches('[data-save-set]')) { const name = $('[data-set-name]').value.trim().slice(0, 80); if (!name) { message.textContent = 'Enter a chart set name.'; return; } const sets = store.get('chartSets', {}); Object.defineProperty(sets, name, { value: { ...st, drawings: [] }, enumerable: true, configurable: true, writable: true }); store.set('chartSets', sets); chartSets(); message.textContent = `Saved chart set “${name}”.`; }
    else if (t.matches('[data-delete-set]')) { const name = $('[data-set]').value; const sets = store.get('chartSets', {}); delete sets[name]; store.set('chartSets', sets); chartSets(); }
  }
  const replayInput = () => { replay = +$('[data-replay]').value; cursor = null; render(); };
  const styleInput = e => {if(e.target.matches('[data-width], [data-metric-opacity]'))change(e);};el.addEventListener('input',styleInput);
  $('[data-replay]').addEventListener('input', replayInput);
  function point(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function move(e) { if (!geometry) return; const p = point(e), a = geometry; cursor = Math.max(0, Math.min(a.raw.length - 1, Math.floor((p.x - a.left) / (a.right - a.left) * a.raw.length))); onCrosshair?.(a.raw[cursor]?.t); if (drag) { pan = Math.max(0, Math.min((data?.bars.length || 0) - a.raw.length, drag.pan + Math.round((drag.x - p.x) / (a.right - a.left) * a.raw.length))); } render(); }
  function down(e) {
    if(!geometry)return;const p=point(e),a=geometry,tool=$('[data-tool]').value;
    if(p.y<a.top||p.y>a.bottom||p.x<a.left||p.x>a.right)return;
    if(tool==='Crosshair'){drag={x:p.x,pan};canvas.setPointerCapture(e.pointerId);return;}
    const i=Math.max(0,Math.min(a.raw.length-1,Math.floor((p.x-a.left)/(a.right-a.left)*a.raw.length))),bar=a.raw[i];let price=a.invert(p.y);
    if(st.snap)price=[bar.o,bar.h,bar.l,bar.c].filter(v=>v!=null).sort((v,w)=>Math.abs(v-price)-Math.abs(w-price))[0];
    const at={t:bar.t,v:price};
    if(tool==='Select'){let best=Infinity;selectedDrawing=null;st.drawings.forEach((d,index)=>{if(d.symbol!==symbol)return;for(const z of [d.a,d.b,d.c].filter(Boolean)){const idx=Math.max(0,a.raw.findIndex(b=>b.t>=z.t)),dist=Math.hypot(a.x(idx)-p.x,a.y(a.normalized?(z.v/a.normBase-1)*100:z.v)-p.y);if(dist<best){best=dist;selectedDrawing=index;}}});drawList();render();return;}
    const add=d=>{save({drawings:[...st.drawings,{symbol,...d}]});selectedDrawing=st.drawings.length-1;drawingStart=null;message.textContent='';drawList();render();};
    if(['Horizontal','Vertical','Text'].includes(tool)){add({type:tool,a:at,...(tool==='Text'?{text:'Note'}:{})});return;}
    if(!drawingStart){drawingStart={a:at};message.textContent='Select the second point on the chart.';}
    else if(['Channel','Pitchfork'].includes(tool)&&!drawingStart.b){drawingStart.b=at;message.textContent='Select a third point for '+tool.toLowerCase()+'.';}
    else add({type:tool,...drawingStart,...(drawingStart.b?{c:at}:{b:at})});
  }
  function up() { drag = null; }
  function leave() { if (!drag) { cursor = null; onCrosshair?.(null); render(); } }
  function wheel(e) { if (!data) return; if(plot.scrollHeight>plot.clientHeight+1&&!e.ctrlKey&&!e.metaKey)return; e.preventDefault(); zoom = Math.min(Math.max(1, data.bars.length / 8), Math.max(1, zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2))); render(); }
  function key(e) { if (!data) return; if (['ArrowLeft', 'ArrowRight', '+', '-', '=', 'Escape'].includes(e.key)) e.preventDefault(); if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') cursor = Math.max(0, Math.min(activeBars().length - 1, (cursor ?? activeBars().length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))); if (e.key === '+' || e.key === '=') zoom = Math.min(Math.max(1, data.bars.length / 8), zoom * 1.2); if (e.key === '-') zoom = Math.max(1, zoom / 1.2); if (e.key === 'Escape') { drawingStart = null; cursor = null; } render(); }
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); canvas.addEventListener('pointerleave', leave); canvas.addEventListener('wheel', wheel, { passive: false }); canvas.addEventListener('keydown', key);
  const ro = new ResizeObserver(render); ro.observe(plot); const mo = new MutationObserver(render); mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-space-theme'] });
  const instance = { onTime(t) { const bars = activeBars(); cursor = t == null ? null : Math.max(0, bars.findIndex(b => b.t >= t)); render(); }, onSymbol(s) { symbol = s; selectedDrawing=null;drawList(); drawingStart = null; replay = 1; $('[data-replay]').value = 1; load(); }, csv() { return data ? toCSV(data.bars.map(b => ({ date: new Date(b.t).toISOString(), ...b }))) : null; }, scoutContext() { return data ? `${symbol} ${data.range} ${data.interval} price history from ${data.source}, delayed. Last checked ${refreshState?.lastSuccessAt ? new Date(refreshState.lastSuccessAt).toISOString() : 'not yet'}. Latest bars: ${JSON.stringify(data.bars.slice(-10))}` : `${symbol} price history unavailable.`; }, destroy() { destroyed = true; poll?.destroy(); stopReplay(); offCompare(); controller?.abort(); ro.disconnect(); mo.disconnect(); el.removeEventListener('change', change); el.removeEventListener('click', click);el.removeEventListener('input',styleInput); } };
  const offCompare = bus.on('chart:compare', d => {if(d?.id!==ctx.id || !symbolOK(String(d.symbol).toUpperCase()))return;const symbols=[...new Set([st.compare,...String(d.symbol).toUpperCase().split(',')].join(',').split(/[ ,]+/).filter(Boolean))].slice(0,10);save({compare:symbols.join(', ')});$('[data-compare]').value=st.compare;load();});
  poll = createLiveRefresh({ el, refresh: refreshPrices, interval: refreshInterval, enabled: () => replay >= 1 && !replayTimer && !drawingStart && !drag, paused: !!st.updatesPaused, onState: showRefresh });
  load(); return instance;
}
registerPanel('chart', { title: 'Chart', category: 'Charts', symbolLinked: true, defaultSize: { w: 8, h: 11 }, mount: mountChart });
registerPanel('multi-chart', {
  title: 'Multi-chart', category: 'Charts', symbolLinked: true, defaultSize: { w: 8, h: 14 },
  mount(el, ctx) {
    let count = [2, 4, 6].includes(ctx.state.count) ? ctx.state.count : 4, instances = [], symbols = ctx.state.symbols || [ctx.symbol || 'NVDA', 'AAPL', 'MSFT', 'SPY', 'QQQ', 'BTC-USD'], range = ctx.state.range || '1Y';
    const multi = document.createElement('div'); multi.className = 'p-chart-multi'; el.append(multi);
    function build() { instances.forEach(i => i.destroy()); instances = []; multi.innerHTML = `<div class="p-chart-multi-tools"><label>Charts <select class="s-select" data-count>${options(['2', '4', '6'], String(count))}</select></label><label>Linked range <select class="s-select" data-linked-range>${options(RANGES, range)}</select></label></div><div class="p-chart-multi-grid"></div>`; const grid = multi.querySelector('.p-chart-multi-grid');
      symbols.slice(0, count).forEach((s, i) => { const cell = document.createElement('div'); cell.className = 'p-chart-multi-cell'; cell.innerHTML = `<form><input class="s-input" aria-label="Chart ${i + 1} symbol" value="${esc(s)}" maxlength="20"><button class="s-btn s-btn-sm">Load</button></form><div class="p-chart-multi-body"></div>`; grid.append(cell); let local = { range, chartType: 'Line', ...ctx.state['chart' + i], range }; const childCtx = { ...ctx, symbol: s, get state() { return local; }, setState(p) { local = { ...local, ...p }; ctx.setState({ ['chart' + i]: local }); } }; const inst = mountChart(cell.querySelector('.p-chart-multi-body'), childCtx, { compact: true, symbol: s, onCrosshair: t => instances.forEach((other, j) => { if (j !== i) other.onTime(t); }) }); instances.push(inst); cell.querySelector('form').onsubmit = e => { e.preventDefault(); const next = cell.querySelector('input').value.trim().toUpperCase(); if (!symbolOK(next)) { cell.querySelector('input').setCustomValidity('Enter a ticker symbol.'); cell.querySelector('input').reportValidity(); return; } cell.querySelector('input').setCustomValidity(''); symbols[i] = next; ctx.setState({ symbols }); inst.onSymbol(next); }; });
      multi.querySelector('[data-count]').onchange = e => { count = +e.target.value; ctx.setState({ count }); build(); }; multi.querySelector('[data-linked-range]').onchange = e => { range = e.target.value; ctx.setState({ range }); build(); };
    }
    build(); return { onSymbol(s) { symbols[0] = s; ctx.setState({ symbols }); instances[0]?.onSymbol(s); multi.querySelector('input').value = s; }, csv() { return null; }, scoutContext() { return instances.map(i => i.scoutContext()).join('\n'); }, destroy() { instances.forEach(i => i.destroy()); } };
  }
});

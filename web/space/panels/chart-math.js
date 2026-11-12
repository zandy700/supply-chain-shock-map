// Pure chart math for the Space chart panels: indicators, transforms and axis ticks.
// No DOM access at import time so worker tests (node:test) can import it directly.

const nan = n => new Array(n).fill(null);
const closes = bars => bars.map(b => b.c);

export function sma(values, n) {
  const out = nan(values.length); let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) { sum = 0; count = 0; continue; }
    sum += v; count++;
    if (count > n) { sum -= values[i - n]; count = n; }
    if (count === n) out[i] = sum / n;
  }
  return out;
}
export function ema(values, n) {
  const out = nan(values.length), k = 2 / (n + 1); let prev = null, seed = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) { seed.push(v); if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; } continue; }
    prev = v * k + prev * (1 - k); out[i] = prev;
  }
  return out;
}
// Wilder's smoothing (RMA), used by RSI and ATR.
export function rma(values, n) {
  const out = nan(values.length); let prev = null, seed = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) { seed.push(v); if (seed.length === n) { prev = seed.reduce((a, b) => a + b, 0) / n; out[i] = prev; } continue; }
    prev = (prev * (n - 1) + v) / n; out[i] = prev;
  }
  return out;
}
export function wma(values, n) {
  const out = nan(values.length), denom = n * (n + 1) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < n; j++) { const v = values[i - j]; if (v == null) { ok = false; break; } s += v * (n - j); }
    if (ok) out[i] = s / denom;
  }
  return out;
}
export function stdev(values, n) {
  const out = nan(values.length), mean = sma(values, n);
  for (let i = n - 1; i < values.length; i++) {
    if (mean[i] == null) continue;
    let s = 0; for (let j = 0; j < n; j++) s += (values[i - j] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}
export function bollinger(values, n = 20, k = 2) {
  const mid = sma(values, n), sd = stdev(values, n);
  return { mid, upper: mid.map((m, i) => m == null ? null : m + k * sd[i]), lower: mid.map((m, i) => m == null ? null : m - k * sd[i]) };
}
export function rsi(values, n = 14) {
  const gains = [null], losses = [null];
  for (let i = 1; i < values.length; i++) { const d = values[i] - values[i - 1]; gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0)); }
  const ag = rma(gains, n), al = rma(losses, n);
  return values.map((_, i) => ag[i] == null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]));
}
export function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = ema(values, fast), s = ema(values, slow);
  const line = values.map((_, i) => f[i] == null || s[i] == null ? null : f[i] - s[i]);
  const sig = ema(line, signal);
  return { macd: line, signal: sig, hist: line.map((v, i) => v == null || sig[i] == null ? null : v - sig[i]) };
}
const hi = b => b.h ?? b.c, lo = b => b.l ?? b.c, op = b => b.o ?? b.c;
export function trueRange(bars) {
  return bars.map((b, i) => i === 0 ? hi(b) - lo(b) : Math.max(hi(b) - lo(b), Math.abs(hi(b) - bars[i - 1].c), Math.abs(lo(b) - bars[i - 1].c)));
}
export const atr = (bars, n = 14) => rma(trueRange(bars), n);
export function stochastic(bars, kLen = 14, dLen = 3, smooth = 3) {
  const raw = nan(bars.length);
  for (let i = kLen - 1; i < bars.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - kLen + 1; j <= i; j++) { h = Math.max(h, hi(bars[j])); l = Math.min(l, lo(bars[j])); }
    raw[i] = h === l ? 50 : (bars[i].c - l) / (h - l) * 100;
  }
  const k = smooth > 1 ? sma(raw, smooth) : raw;
  return { k, d: sma(k, dLen) };
}
export function obv(bars) {
  const out = nan(bars.length); let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i].v ?? 0;
    if (i > 0) acc += bars[i].c > bars[i - 1].c ? v : bars[i].c < bars[i - 1].c ? -v : 0;
    out[i] = acc;
  }
  return out;
}
// VWAP anchored per session (resetKey(bar) changes -> restart). Daily bars anchor at the first bar.
export function vwap(bars, resetKey = () => 0) {
  const out = nan(bars.length); let pv = 0, vol = 0, key;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], k = resetKey(b);
    if (k !== key) { pv = 0; vol = 0; key = k; }
    const v = b.v ?? 0, tp = (hi(b) + lo(b) + b.c) / 3;
    pv += tp * v; vol += v;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}
const midpoint = (bars, i, n) => {
  if (i < n - 1) return null;
  let h = -Infinity, l = Infinity;
  for (let j = i - n + 1; j <= i; j++) { h = Math.max(h, hi(bars[j])); l = Math.min(l, lo(bars[j])); }
  return (h + l) / 2;
};
// Ichimoku. spanA/spanB are displaced forward (length n + disp); lagging is displaced back.
export function ichimoku(bars, conv = 9, base = 26, spanBLen = 52, disp = 26) {
  const n = bars.length;
  const tenkan = bars.map((_, i) => midpoint(bars, i, conv));
  const kijun = bars.map((_, i) => midpoint(bars, i, base));
  const spanA = nan(n + disp), spanB = nan(n + disp);
  for (let i = 0; i < n; i++) {
    if (tenkan[i] != null && kijun[i] != null) spanA[i + disp] = (tenkan[i] + kijun[i]) / 2;
    spanB[i + disp] = midpoint(bars, i, spanBLen);
  }
  const lagging = nan(n);
  for (let i = disp; i < n; i++) lagging[i - disp] = bars[i].c;
  return { tenkan, kijun, spanA, spanB, lagging };
}
export function psar(bars, step = 0.02, maxStep = 0.2) {
  const n = bars.length, out = nan(n);
  if (n < 2) return out;
  let up = bars[1].c >= bars[0].c, af = step, ep = up ? hi(bars[0]) : lo(bars[0]), sar = up ? lo(bars[0]) : hi(bars[0]);
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, lo(bars[i - 1]), i > 1 ? lo(bars[i - 2]) : lo(bars[i - 1]));
      if (lo(bars[i]) < sar) { up = false; sar = ep; ep = lo(bars[i]); af = step; }
      else if (hi(bars[i]) > ep) { ep = hi(bars[i]); af = Math.min(af + step, maxStep); }
    } else {
      sar = Math.max(sar, hi(bars[i - 1]), i > 1 ? hi(bars[i - 2]) : hi(bars[i - 1]));
      if (hi(bars[i]) > sar) { up = true; sar = ep; ep = hi(bars[i]); af = step; }
      else if (lo(bars[i]) < ep) { ep = lo(bars[i]); af = Math.min(af + step, maxStep); }
    }
    out[i] = sar;
  }
  return out;
}
export function heikinAshi(bars) {
  const out = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], c = (op(b) + hi(b) + lo(b) + b.c) / 4;
    const o = i === 0 ? (op(b) + b.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ ...b, o, c, h: Math.max(hi(b), o, c), l: Math.min(lo(b), o, c) });
  }
  return out;
}
export function drawdown(values) {
  let peak = -Infinity;
  return values.map(v => { if (v == null) return null; peak = Math.max(peak, v); return (v / peak - 1) * 100; });
}
// Annualized close-to-close volatility in percent. periodsPerYear: 252 for daily bars.
export function histVol(values, n = 20, periodsPerYear = 252) {
  const r = values.map((v, i) => i === 0 || v == null || values[i - 1] == null ? null : Math.log(v / values[i - 1]));
  const sd = stdev(r.map(x => x ?? 0), n);
  return sd.map((s, i) => i < n || s == null ? null : s * Math.sqrt(periodsPerYear) * 100);
}
export function rollingExtreme(values, n, fn) {
  return values.map((_, i) => { if (i < n - 1) return null; let m = values[i]; for (let j = i - n + 1; j <= i; j++) m = fn(m, values[j]); return m; });
}

// Indicator registry. pane: 'overlay' (price pane), 'volume' (volume overlay) or 'sub' (own pane below).
// compute(bars, params, meta) -> { lines: [{ name, values, kind: 'line'|'hist'|'dots'|'fill-to' , ref? }], levels?: [n], range?: [min,max] }
const P = (key, label, def, min = 1, max = 500, stepv = 1) => ({ key, label, def, min, max, step: stepv });
export const INDICATORS = {
  sma: { label: 'Simple Moving Average', short: 'SMA', pane: 'overlay', params: [P('period', 'Period', 20)], compute: (b, p) => ({ lines: [{ name: `SMA ${p.period}`, values: sma(closes(b), p.period) }] }) },
  ema: { label: 'Exponential Moving Average', short: 'EMA', pane: 'overlay', params: [P('period', 'Period', 50)], compute: (b, p) => ({ lines: [{ name: `EMA ${p.period}`, values: ema(closes(b), p.period) }] }) },
  wma: { label: 'Weighted Moving Average', short: 'WMA', pane: 'overlay', params: [P('period', 'Period', 20)], compute: (b, p) => ({ lines: [{ name: `WMA ${p.period}`, values: wma(closes(b), p.period) }] }) },
  bb: { label: 'Bollinger Bands', short: 'BB', pane: 'overlay', params: [P('period', 'Period', 20), P('mult', 'Std dev', 2, 0.5, 5, 0.5)], compute: (b, p) => { const r = bollinger(closes(b), p.period, p.mult); return { lines: [{ name: 'Upper', values: r.upper, kind: 'fill-to', ref: 2 }, { name: `BB ${p.period}`, values: r.mid, dash: true }, { name: 'Lower', values: r.lower }] }; } },
  vwap: { label: 'Volume Weighted Average Price', short: 'VWAP', pane: 'overlay', params: [], needsVolume: true, compute: (b, p, m) => ({ lines: [{ name: 'VWAP', values: vwap(b, m?.sessionKey || (() => 0)) }] }) },
  ichimoku: { label: 'Ichimoku Cloud', short: 'Ichimoku', pane: 'overlay', params: [P('conv', 'Conversion', 9), P('base', 'Base', 26), P('spanB', 'Span B', 52), P('disp', 'Displacement', 26)], compute: (b, p) => { const r = ichimoku(b, p.conv, p.base, p.spanB, p.disp); return { lines: [{ name: 'Conversion', values: r.tenkan }, { name: 'Base', values: r.kijun }, { name: 'Span A', values: r.spanA, kind: 'fill-to', ref: 3, cloud: true }, { name: 'Span B', values: r.spanB }, { name: 'Lagging', values: r.lagging, dash: true }] }; } },
  psar: { label: 'Parabolic SAR', short: 'PSAR', pane: 'overlay', params: [P('step', 'Step', 0.02, 0.001, 0.5, 0.01), P('max', 'Max', 0.2, 0.01, 1, 0.01)], compute: (b, p) => ({ lines: [{ name: 'PSAR', values: psar(b, p.step, p.max), kind: 'dots' }] }) },
  hl52: { label: '52-week high / low', short: '52W H/L', pane: 'overlay', group: 'metric', params: [P('period', 'Bars', 252)], compute: (b, p) => ({ lines: [{ name: 'High', values: rollingExtreme(b.map(hi), p.period, Math.max), dash: true }, { name: 'Low', values: rollingExtreme(b.map(lo), p.period, Math.min), dash: true }] }) },
  volma: { label: 'Volume Moving Average', short: 'Vol MA', pane: 'volume', params: [P('period', 'Period', 20)], needsVolume: true, compute: (b, p) => ({ lines: [{ name: `Vol MA ${p.period}`, values: sma(b.map(x => x.v), p.period) }] }) },
  rsi: { label: 'Relative Strength Index', short: 'RSI', pane: 'sub', params: [P('period', 'Period', 14)], compute: (b, p) => ({ lines: [{ name: `RSI ${p.period}`, values: rsi(closes(b), p.period) }], levels: [30, 70], range: [0, 100] }) },
  macd: { label: 'MACD', short: 'MACD', pane: 'sub', params: [P('fast', 'Fast', 12), P('slow', 'Slow', 26), P('signal', 'Signal', 9)], compute: (b, p) => { const r = macd(closes(b), p.fast, p.slow, p.signal); return { lines: [{ name: 'Histogram', values: r.hist, kind: 'hist' }, { name: `MACD ${p.fast},${p.slow}`, values: r.macd }, { name: `Signal ${p.signal}`, values: r.signal }], levels: [0] }; } },
  stoch: { label: 'Stochastic Oscillator', short: 'Stoch', pane: 'sub', params: [P('k', '%K', 14), P('d', '%D', 3), P('smooth', 'Smooth', 3)], compute: (b, p) => { const r = stochastic(b, p.k, p.d, p.smooth); return { lines: [{ name: `%K ${p.k}`, values: r.k }, { name: `%D ${p.d}`, values: r.d }], levels: [20, 80], range: [0, 100] }; } },
  atr: { label: 'Average True Range', short: 'ATR', pane: 'sub', params: [P('period', 'Period', 14)], compute: (b, p) => ({ lines: [{ name: `ATR ${p.period}`, values: atr(b, p.period) }] }) },
  obv: { label: 'On-Balance Volume', short: 'OBV', pane: 'sub', params: [], needsVolume: true, compute: b => ({ lines: [{ name: 'OBV', values: obv(b) }] }) },
  dd: { label: 'Drawdown from peak', short: 'Drawdown', pane: 'sub', group: 'metric', params: [], compute: b => ({ lines: [{ name: 'Drawdown %', values: drawdown(closes(b)) }], levels: [0] }) },
  hv: { label: 'Historical volatility', short: 'HV', pane: 'sub', group: 'metric', params: [P('period', 'Period', 20)], compute: (b, p, m) => ({ lines: [{ name: `HV ${p.period} %`, values: histVol(closes(b), p.period, m?.periodsPerYear || 252) }] }) }
};
export function defaultParams(id) {
  return Object.fromEntries((INDICATORS[id]?.params || []).map(p => [p.key, p.def]));
}
export function computeIndicator(id, bars, params, meta) {
  const def = INDICATORS[id];
  if (!def) return null;
  const p = { ...defaultParams(id), ...(params || {}) };
  for (const d of def.params) { const v = Number(p[d.key]); p[d.key] = Number.isFinite(v) ? Math.min(d.max, Math.max(d.min, v)) : d.def; }
  return def.compute(bars, p, meta);
}

// ---- axes -----------------------------------------------------------------------------------------
export function niceStep(span, count) {
  const raw = span / Math.max(1, count), mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}
export function niceTicks(min, max, count = 5) {
  if (!(max > min)) return { ticks: [min], step: 1 };
  const step = niceStep(max - min, count), ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return { ticks, step };
}
export function logTicks(min, max, count = 5) {
  if (!(min > 0) || !(max > min)) return niceTicks(min, max, count);
  if (max / min < 3) return niceTicks(min, max, count);
  const ticks = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (v >= min && v <= max) ticks.push(v); }
  }
  return { ticks, step: null };
}
export function decimalsFor(step, value) {
  if (step != null && step > 0 && step < 1) return Math.min(6, Math.max(2, Math.ceil(-Math.log10(step))));
  return Math.abs(value) < 1 ? 4 : 2;
}

// Time-axis labels: choose a unit so labels sit >= minPx apart. fmtParts(t) -> {y, m, d, H, M} in display tz.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function timeTicks(bars, from, to, pxPerBar, { intraday = false, parts, minPx = 64 } = {}) {
  const lo = Math.max(0, Math.ceil(from)), hiI = Math.min(bars.length - 1, Math.floor(to));
  if (hiI < lo) return [];
  const span = bars[hiI].t - bars[lo].t, day = 86400000;
  const units = intraday
    ? [['m', 5], ['m', 15], ['m', 30], ['H', 1], ['H', 2], ['d', 1], ['d', 2], ['w', 1]]
    : [['d', 1], ['d', 2], ['w', 1], ['w', 2], ['mo', 1], ['mo', 3], ['y', 1], ['y', 2], ['y', 5], ['y', 10]];
  const keyOf = (p, [u, n]) => u === 'm' ? Math.floor((p.H * 60 + p.M) / n) + p.d * 10000 + p.m * 1e6 : u === 'H' ? Math.floor(p.H / n) + p.d * 100 + p.m * 1e4 : u === 'd' ? Math.floor(p.dayIndex / n) : u === 'w' ? Math.floor((p.dayIndex + 3) / (7 * n)) : u === 'mo' ? Math.floor((p.y * 12 + p.m) / n) : Math.floor(p.y / n);
  const cache = new Map();
  const P2 = i => { if (!cache.has(i)) { const p = parts(bars[i].t); p.dayIndex = Math.floor((Date.UTC(p.y, p.m, p.d)) / day); cache.set(i, p); } return cache.get(i); };
  let chosen = units[units.length - 1];
  for (const u of units) {
    let count = 0, prev = null;
    for (let i = lo; i <= hiI; i++) { const k = keyOf(P2(i), u); if (prev !== null && k !== prev) count++; prev = k; }
    if (count === 0 || (hiI - lo + 1) * pxPerBar / Math.max(1, count) >= minPx) { chosen = u; break; }
  }
  void span;
  const out = [];
  let prev = keyOf(P2(lo), chosen), lastX = -Infinity, lastYear = null;
  for (let i = lo + 1; i <= hiI; i++) {
    const p = P2(i), k = keyOf(p, chosen);
    if (k === prev) continue;
    prev = k;
    const x = (i - from) * pxPerBar;
    if (x - lastX < minPx * 0.8) continue;
    const prevP = P2(i - 1);
    let label, major = false;
    const [u] = chosen;
    if (u === 'm' || u === 'H') { if (p.d !== prevP.d) { label = `${MON[p.m]} ${p.d}`; major = true; } else label = `${p.H % 12 || 12}:${String(p.M).padStart(2, '0')}${p.H < 12 ? 'a' : 'p'}`; }
    else if (u === 'd' || u === 'w') { if (p.y !== prevP.y) { label = String(p.y); major = true; } else label = `${MON[p.m]} ${p.d}`; }
    else if (u === 'mo') { if (p.y !== prevP.y) { label = String(p.y); major = true; } else label = MON[p.m]; }
    else label = String(p.y);
    out.push({ i, label, major });
    lastX = x; lastYear = p.y;
  }
  void lastYear;
  // First visible bar label carries the year for daily units (e.g. "Nov 17 2026"), matching the trace.
  if (out.length && !intraday && (chosen[0] === 'd' || chosen[0] === 'w')) {
    const p = P2(lo), first = { i: lo, label: `${MON[p.m]} ${p.d} ${p.y}`, major: true };
    if ((out[0].i - from) * pxPerBar - (lo - from) * pxPerBar >= minPx * 1.3) out.unshift(first);
  }
  return out;
}

// Map a timestamp to a fractional bar index (extrapolates past either end using the median spacing).
export function indexOfTime(bars, t) {
  const n = bars.length;
  if (!n) return 0;
  const stepMs = n > 1 ? (bars[n - 1].t - bars[0].t) / (n - 1) : 86400000;
  if (t <= bars[0].t) return (t - bars[0].t) / stepMs;
  if (t >= bars[n - 1].t) return n - 1 + (t - bars[n - 1].t) / stepMs;
  let lo = 0, hiI = n - 1;
  while (hiI - lo > 1) { const mid = (lo + hiI) >> 1; if (bars[mid].t <= t) lo = mid; else hiI = mid; }
  return lo + (t - bars[lo].t) / (bars[hiI].t - bars[lo].t || 1);
}
export function timeOfIndex(bars, idx) {
  const n = bars.length;
  if (!n) return 0;
  const stepMs = n > 1 ? (bars[n - 1].t - bars[0].t) / (n - 1) : 86400000;
  if (idx <= 0) return bars[0].t + idx * stepMs;
  if (idx >= n - 1) return bars[n - 1].t + (idx - n + 1) * stepMs;
  const i = Math.floor(idx), f = idx - i;
  return bars[i].t + f * (bars[i + 1].t - bars[i].t);
}
// Value of a sparse series (sorted {t,v}) at time t: last point at or before t.
export function stepValueAt(points, t) {
  let lo = 0, hiI = points.length - 1, ans = null;
  while (lo <= hiI) { const mid = (lo + hiI) >> 1; if (points[mid].t <= t) { ans = points[mid].v; lo = mid + 1; } else hiI = mid - 1; }
  return ans;
}
export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

// Price gets at least 160px; study panes scroll instead of collapsing the price plot.
export function paneLayout(viewHeight, studyCount) {
  const count = Math.max(0, Math.floor(studyCount));
  const height = Math.max(240, viewHeight, 220 + count * 84);
  return { height, paneH: 84, bottom: height - 30 - count * 84 };
}
export const STYLE_PRESETS = {
  Default: { background: '#14181d', grid: '#252c35', text: '#8b95a1', up: '#2ebd85', down: '#f0616d', line: '#4c8dff', watermark: '#323b46', metric: '#e7b04a' },
  'High contrast': { background: '#000000', grid: '#454545', text: '#ffffff', up: '#00ff9c', down: '#ff536f', line: '#00bfff', watermark: '#444444', metric: '#ffff00' },
  Mono: { background: '#151515', grid: '#333333', text: '#aaaaaa', up: '#eeeeee', down: '#888888', line: '#eeeeee', watermark: '#454545', metric: '#cccccc' },
  Ocean: { background: '#071e2b', grid: '#173d50', text: '#9ac6d7', up: '#2dd4bf', down: '#fb923c', line: '#38bdf8', watermark: '#245267', metric: '#c4b5fd' },
  Accessible: { background: '#111827', grid: '#334155', text: '#cbd5e1', up: '#38bdf8', down: '#fb923c', line: '#facc15', watermark: '#475569', metric: '#e879f9' },
  Terminal: { background: '#07110b', grid: '#173622', text: '#95c9a3', up: '#4ade80', down: '#fbbf24', line: '#86efac', watermark: '#244a31', metric: '#67e8f9' }
};
const period = [P('period', 'Period', 14)];
const addStudy = (id, label, pane, compute, params = period, needsVolume = false, category = 'Momentum') => { INDICATORS[id] = { label, short: label, pane, params, compute, needsVolume, category }; };
const one = (name, values, extra = {}) => ({ lines: [{ name, values }], ...extra });
const subtract = (a, b) => a.map((v, i) => v == null || b[i] == null ? null : v - b[i]);
const roll = (v, n, fn) => v.map((_, i) => i < n - 1 ? null : fn(v.slice(i - n + 1, i + 1)));
addStudy('dema', 'Double Exponential Moving Average', 'overlay', (b,p) => { const a = ema(closes(b),p.period), c = ema(a,p.period); return one('DEMA',a.map((v,i)=>v==null||c[i]==null?null:2*v-c[i])); }, period, false, 'Moving Averages');
addStudy('tema', 'Triple Exponential Moving Average', 'overlay', (b,p) => { const a=ema(closes(b),p.period), c=ema(a,p.period), d=ema(c,p.period); return one('TEMA',a.map((v,i)=>v==null||c[i]==null||d[i]==null?null:3*v-3*c[i]+d[i])); }, period, false, 'Moving Averages');
addStudy('channel','Price Channel','overlay',(b,p)=>({lines:[{name:'High',values:rollingExtreme(b.map(hi),p.period,Math.max)},{name:'Low',values:rollingExtreme(b.map(lo),p.period,Math.min)}]}),period,false,'Bands & Channels');
addStudy('envelopes','Price Envelopes','overlay',(b,p)=>{const a=sma(closes(b),p.period);return{lines:[{name:'Upper',values:a.map(v=>v==null?null:v*(1+p.percent/100))},{name:'Lower',values:a.map(v=>v==null?null:v*(1-p.percent/100))}]};},[...period,P('percent','Envelope %',2.5,.1,30,.1)],false,'Bands & Channels');
addStudy('keltner','Keltner Channels','overlay',(b,p)=>{const a=ema(closes(b),p.period), r=atr(b,p.period);return{lines:[{name:'Upper',values:a.map((v,i)=>v==null||r[i]==null?null:v+2*r[i])},{name:'Middle',values:a},{name:'Lower',values:a.map((v,i)=>v==null||r[i]==null?null:v-2*r[i])}]};},period,false,'Bands & Channels');
addStudy('momentum','Momentum','sub',(b,p)=>one('Momentum',closes(b).map((v,i)=>i<p.period?null:v-b[i-p.period].c)));
addStudy('roc','Rate of Change','sub',(b,p)=>one('ROC %',closes(b).map((v,i)=>i<p.period||!b[i-p.period].c?null:(v/b[i-p.period].c-1)*100)));
addStudy('williams','Williams %R','sub',(b,p)=>{const h=rollingExtreme(b.map(hi),p.period,Math.max),l=rollingExtreme(b.map(lo),p.period,Math.min);return one('%R',b.map((v,i)=>h[i]==null||h[i]===l[i]?null:-100*(h[i]-v.c)/(h[i]-l[i])),{range:[-100,0],levels:[-80,-20]});});
addStudy('awesome','Awesome Oscillator','sub',b=>{const v=b.map(z=>(hi(z)+lo(z))/2);return one('Awesome',subtract(sma(v,5),sma(v,34)));},[]);
addStudy('cmo','Chande Momentum Oscillator','sub',(b,p)=>{const changes=b.map((v,i)=>i?v.c-b[i-1].c:0);return one('CMO',roll(changes,p.period,a=>{const up=a.reduce((s,v)=>s+Math.max(v,0),0),dn=a.reduce((s,v)=>s+Math.max(-v,0),0);return up+dn?100*(up-dn)/(up+dn):0;}),{range:[-100,100]});});
addStudy('disparity','Disparity Index','sub',(b,p)=>{const a=sma(closes(b),p.period);return one('Disparity %',b.map((v,i)=>a[i]?100*(v.c/a[i]-1):null));});
addStudy('natr','Normalized ATR','sub',(b,p)=>one('NATR %',atr(b,p.period).map((v,i)=>v==null?null:v/b[i].c*100)),period,false,'Volatility');
addStudy('cci','Commodity Channel Index','sub',(b,p)=>{const tp=b.map(z=>(hi(z)+lo(z)+z.c)/3);return one('CCI',roll(tp,p.period,a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length,dev=a.reduce((s,v)=>s+Math.abs(v-mean),0)/a.length;return dev?(a.at(-1)-mean)/(.015*dev):0;}),{levels:[-100,100]});},period,false,'Volatility');
const money = b => b.map(z=>{const range=hi(z)-lo(z);return range?((z.c-lo(z))-(hi(z)-z.c))/range*(z.v??0):0;});
addStudy('ad','Accumulation/Distribution','sub',b=>{let total=0;return one('A/D',money(b).map(v=>(total+=v)));},[],true,'Volume');
addStudy('cmf','Chaikin Money Flow','sub',(b,p)=>{const m=sma(money(b),p.period),v=sma(b.map(z=>z.v??0),p.period);return one('CMF',m.map((x,i)=>x==null||!v[i]?null:x/v[i]));},period,true,'Volume');
addStudy('chaikin','Chaikin Oscillator','sub',b=>{let total=0;const a=money(b).map(v=>(total+=v));return one('Chaikin',subtract(ema(a,3),ema(a,10)));},[],true,'Volume');
addStudy('mfi','Money Flow Index','sub',(b,p)=>{const tp=b.map(z=>(hi(z)+lo(z)+z.c)/3);return one('MFI',b.map((_,i)=>{if(i<p.period)return null;let pos=0,neg=0;for(let j=i-p.period+1;j<=i;j++){const mf=tp[j]*(b[j].v??0);if(tp[j]>tp[j-1])pos+=mf;else if(tp[j]<tp[j-1])neg+=mf;}return pos+neg?100*pos/(pos+neg):50;}),{range:[0,100],levels:[20,80]});},period,true,'Volume');
addStudy('apo','Absolute Price Oscillator','sub',b=>one('APO',subtract(ema(closes(b),12),ema(closes(b),26))),[]);
addStudy('ppo','Percentage Price Oscillator','sub',b=>{const a=ema(closes(b),12),c=ema(closes(b),26);return one('PPO %',a.map((v,i)=>v==null||!c[i]?null:(v/c[i]-1)*100));},[]);
addStudy('trix','TRIX','sub',(b,p)=>{const a=ema(ema(ema(closes(b),p.period),p.period),p.period);return one('TRIX %',a.map((v,i)=>!i||v==null||!a[i-1]?null:(v/a[i-1]-1)*100));});
addStudy('accbands','Acceleration Bands','overlay',(b,p)=>{const upper=b.map(z=>hi(z)*(1+4*(hi(z)-lo(z))/(hi(z)+lo(z)||1))),lower=b.map(z=>lo(z)*(1-4*(hi(z)-lo(z))/(hi(z)+lo(z)||1)));return {lines:[{name:'Upper',values:sma(upper,p.period)},{name:'Middle',values:sma(closes(b),p.period)},{name:'Lower',values:sma(lower,p.period)}]};},period,false,'Bands & Channels');
addStudy('pivots','Pivot Points','overlay',b=>({lines:['Pivot','R1','S1','R2','S2'].map((name,k)=>({name,values:b.map((_,i)=>{if(!i)return null;const z=b[i-1],h=hi(z),l=lo(z),p=(h+l+z.c)/3;return[p,2*p-l,2*p-h,p+h-l,p-h+l][k];})}))}),[],false,'Bands & Channels');
function regression(values,n){const slope=nan(values.length),intercept=nan(values.length),end=nan(values.length);const sx=n*(n-1)/2,sxx=n*(n-1)*(2*n-1)/6,denom=n*sxx-sx*sx;for(let i=n-1;i<values.length;i++){let sy=0,sxy=0;for(let j=0;j<n;j++){const v=values[i-n+1+j];sy+=v;sxy+=j*v;}const m=denom?(n*sxy-sx*sy)/denom:0,a=(sy-m*sx)/n;slope[i]=m;intercept[i]=a;end[i]=a+m*(n-1);}return{slope,intercept,end};}
for(const [id,label,kind] of [['linreg','Linear Regression','end'],['regangle','Linear Regression Angle','angle'],['regintercept','Linear Regression Intercept','intercept'],['regslope','Linear Regression Slope','slope']])addStudy(id,label,kind==='end'?'overlay':'sub',(b,p)=>{const r=regression(closes(b),p.period);return one(label,kind==='angle'?r.slope.map(v=>v==null?null:Math.atan(v)*180/Math.PI):r[kind]);},period,false,'Regression');
addStudy('trendline','Trendline','overlay',b=>{const r=regression(closes(b),b.length),m=r.slope.at(-1),a=r.intercept.at(-1);return one('Least-squares trendline',b.map((_,i)=>a+m*i));},[],false,'Trend');
addStudy('zigzag','Zig Zag','overlay',(b,p)=>{const a=nan(b.length);if(!b.length)return one('Zig Zag',a);let pivot=0,extreme=0,trend=0;a[0]=b[0].c;for(let i=1;i<b.length;i++){const move=(b[i].c/b[extreme].c-1)*100;if(!trend){if(Math.abs(move)>=p.percent){trend=Math.sign(move);extreme=i;}}else if((trend>0&&b[i].c>=b[extreme].c)||(trend<0&&b[i].c<=b[extreme].c))extreme=i;else if(Math.abs(move)>=p.percent){a[extreme]=b[extreme].c;for(let j=pivot+1;j<extreme;j++)a[j]=b[pivot].c+(b[extreme].c-b[pivot].c)*(j-pivot)/(extreme-pivot);pivot=extreme;trend=-trend;extreme=i;}}for(let j=pivot+1;j<b.length;j++)a[j]=b[pivot].c+(b.at(-1).c-b[pivot].c)*(j-pivot)/(b.length-1-pivot||1);return one('Zig Zag (latest leg repaints)',a);},[P('percent','Reversal %',5,.1,100,.1)],false,'Trend');
addStudy('supertrend','Super Trend','overlay',(b,p)=>{const a=atr(b,p.period),out=nan(b.length);let upper=null,lower=null,trend=1;for(let i=0;i<b.length;i++){if(a[i]==null)continue;const mid=(hi(b[i])+lo(b[i]))/2,u=mid+p.mult*a[i],l=mid-p.mult*a[i];const prevU=upper,prevL=lower;upper=upper==null||u<upper||b[i-1]?.c>upper?u:upper;lower=lower==null||l>lower||b[i-1]?.c<lower?l:lower;if(prevU!=null&&b[i].c>prevU)trend=1;else if(prevL!=null&&b[i].c<prevL)trend=-1;out[i]=trend===1?lower:upper;}return one('Super Trend',out);},[...period,P('mult','ATR multiplier',3,.1,20,.1)],false,'Trend');
addStudy('dmi','Directional Movement Index','sub',(b,p)=>{const plus=[null],minus=[null];for(let i=1;i<b.length;i++){const up=hi(b[i])-hi(b[i-1]),dn=lo(b[i-1])-lo(b[i]);plus.push(up>dn&&up>0?up:0);minus.push(dn>up&&dn>0?dn:0);}const a=atr(b,p.period),pp=rma(plus,p.period),mm=rma(minus,p.period),dp=pp.map((v,i)=>v==null||!a[i]?null:100*v/a[i]),dm=mm.map((v,i)=>v==null||!a[i]?null:100*v/a[i]);const dx=dp.map((v,i)=>v==null||dm[i]==null?null:v+dm[i]?100*Math.abs(v-dm[i])/(v+dm[i]):0);return{lines:[{name:'+DI',values:dp},{name:'−DI',values:dm},{name:'ADX',values:rma(dx,p.period)}]};},period,false,'Trend');
function aroon(b,n){const up=nan(b.length),down=nan(b.length);for(let i=n;i<b.length;i++){let hiI=i-n,loI=i-n;for(let j=i-n;j<=i;j++){if(hi(b[j])>=hi(b[hiI]))hiI=j;if(lo(b[j])<=lo(b[loI]))loI=j;}up[i]=100*(n-(i-hiI))/n;down[i]=100*(n-(i-loI))/n;}return{up,down};}
addStudy('aroon','Aroon','sub',(b,p)=>{const r=aroon(b,p.period);return{lines:[{name:'Aroon Up',values:r.up},{name:'Aroon Down',values:r.down}],range:[0,100]};},period,false,'Trend');
addStudy('aroonosc','Aroon Oscillator','sub',(b,p)=>{const r=aroon(b,p.period);return one('Aroon oscillator',subtract(r.up,r.down),{range:[-100,100]});},period,false,'Regression');
addStudy('slowstoch','Slow Stochastic','sub',(b,p)=>{const r=stochastic(b,p.period,3,3);return{lines:[{name:'Slow %K',values:r.k},{name:'Slow %D',values:r.d}],levels:[20,80],range:[0,100]};});
addStudy('dpo','Detrended Price Oscillator','sub',(b,p)=>{const a=sma(closes(b),p.period),shift=Math.floor(p.period/2)+1;return one('DPO',b.map((_,i)=>i<shift||a[i]==null?null:b[i-shift].c-a[i]));});
addStudy('klinger','Klinger Oscillator','sub',b=>{let trend=1,cm=0,lastDm=0;const force=b.map((z,i)=>{const dm=hi(z)-lo(z),sum=hi(z)+lo(z)+z.c,prev=i?hi(b[i-1])+lo(b[i-1])+b[i-1].c:sum,next=sum>prev?1:sum<prev?-1:trend;cm=next===trend?cm+dm:lastDm+dm;trend=next;lastDm=dm;return cm?(z.v??0)*Math.abs(2*(dm/cm-1))*trend*100:0;});const k=subtract(ema(force,34),ema(force,55));return{lines:[{name:'Klinger',values:k},{name:'Signal',values:ema(k,13)}]};},[],true,'Volume');
addStudy('volprofile','Volume by Price','overlay',(b,p)=>{if(!b.length)return{lines:[]};const min=Math.min(...b.map(lo)),max=Math.max(...b.map(hi)),step=(max-min||1)/p.bins,bins=Array.from({length:p.bins},(_,i)=>({price:min+(i+.5)*step,volume:0}));for(const z of b){const i=Math.max(0,Math.min(p.bins-1,Math.floor((z.c-min)/step)));bins[i].volume+=z.v??0;}return{lines:[],volumeProfile:bins};},[P('bins','Price bins',20,5,100)],true,'Volume');

// Daily/weekly/monthly period dates must not shift into the previous local day.
export function chartSourceStamp(timestamp, interval, sample = false) {
  if(timestamp==null||timestamp===''||!Number.isFinite(new Date(timestamp).getTime()))return 'unavailable';
  const timed=sample||/[mh]$/.test(interval);
  return new Date(timestamp).toLocaleString('en-US',{timeZone:timed?'America/New_York':'UTC',month:'short',day:'numeric',year:'numeric',...(timed?{hour:'2-digit',minute:'2-digit'}:{})})+(timed?' ET':'');
}

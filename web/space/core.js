// Space workspace core: panel registry, event bus, symbol link groups, API + format helpers.
// Contract: docs/space-contract.md. Panel modules import from here and call registerPanel().

const panels = new Map();
export function registerPanel(type, def) {
  if (panels.has(type)) throw new Error(`Panel type already registered: ${type}`);
  panels.set(type, { type, symbolLinked: false, defaultSize: { w: 4, h: 6 }, category: 'Other', ...def });
}
export const getPanel = type => panels.get(type);
export const listPanels = () => [...panels.values()];

// Tiny event bus. Events used across modules are listed in docs/space-contract.md.
const listeners = new Map();
export const bus = {
  on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return () => listeners.get(event)?.delete(fn); },
  emit(event, detail) { for (const fn of [...(listeners.get(event) || [])]) { try { fn(detail); } catch (e) { console.error(`[space] ${event} listener failed`, e); } } }
};

// Symbol link groups: panels sharing a group follow the same symbol (AlphaSpace's "+" link chip).
const groups = new Map(); // groupId -> symbol
export const links = {
  get: group => groups.get(group) || null,
  set(group, symbol) { if (!group || !symbol) return; symbol = String(symbol).toUpperCase(); if (groups.get(group) === symbol) return; groups.set(group, symbol); bus.emit('symbol', { group, symbol }); },
  all: () => Object.fromEntries(groups)
};

// GET /api/space/<path>. Throws Error(message) with .status on non-2xx. Responses are JSON.
export async function api(path, params = {}, { signal } = {}) {
  const url = new URL('/api/space/' + path.replace(/^\/+/, ''), location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  let body = null; try { body = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) { const err = new Error(body?.error || `Request failed (${res.status})`); err.status = res.status; err.body = body; throw err; }
  return body;
}

// Persistent per-device storage, namespaced. Never throws.
export const store = {
  get(key, fallback = null) { try { const v = localStorage.getItem('space:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem('space:' + key, JSON.stringify(value)); return true; } catch { return false; } },
  remove(key) { try { localStorage.removeItem('space:' + key); } catch { /* ignore */ } }
};

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const numeric = v => v !== null && v !== undefined && v !== '' && Number.isFinite(+v);
const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmt = {
  price: v => (numeric(v) ? nf(Math.abs(+v) >= 1 ? 2 : 4).format(+v) : '—'),
  num: (v, d = 2) => (numeric(v) ? nf(d).format(+v) : '—'),
  pct: (v, d = 2) => (numeric(v) ? `${+v > 0 ? '+' : ''}${nf(d).format(+v)}%` : '—'),
  change: (v, d = 2) => (numeric(v) ? `${+v > 0 ? '+' : ''}${nf(d).format(+v)}` : '—'),
  compact: v => (numeric(v) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(+v) : '—'),
  date: v => { const d = new Date(v == null || v === '' ? NaN : v); return Number.isNaN(+d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); },
  time: v => { const d = new Date(v == null || v === '' ? NaN : v); return Number.isNaN(+d) ? '—' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); },
  dir: v => (+v > 0 ? 's-up' : +v < 0 ? 's-down' : 's-muted')
};

// Rows -> CSV string, for the panel "Download" action.
export function toCSV(rows, columns) {
  const cols = columns || Object.keys(rows[0] || {});
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

// Standard panel states so every panel looks the same while loading / failing / empty.
export const state = {
  loading: (msg = 'Loading…') => `<div class="s-state" role="status">${esc(msg)}</div>`,
  error: (msg, retry = true) => `<div class="s-state s-state-error" role="alert">${esc(msg)}${retry ? ' <button class="s-btn s-btn-ghost" data-retry>Retry</button>' : ''}</div>`,
  empty: msg => `<div class="s-state">${esc(msg)}</div>`,
  unavailable: (what, why) => `<div class="s-state"><strong>${esc(what)} unavailable</strong><br><span class="s-muted">${esc(why)}</span></div>`
};

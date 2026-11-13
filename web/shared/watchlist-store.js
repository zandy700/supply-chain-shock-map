// One watchlist for the dashboard and the Analyzer.
// localStorage 'watchlist-pulse' is the single source of truth (sample mode on the
// dashboard uses 'watchlist-pulse-demo'). Writes fire a same-tab 'watchlist:changed'
// event; other tabs see the native 'storage' event. Never throws.
export const WATCHLIST_KEY = 'watchlist-pulse';
export const SAMPLE_WATCHLIST_KEY = 'watchlist-pulse-demo';
export const WATCHLIST_EVENT = 'watchlist:changed';
export const WATCHLIST_LIMIT = 40; // Requests are batched around the server's 12-symbol limits.
export const STORED_LIMIT = WATCHLIST_LIMIT;
export const SYMBOL = /^\^?[A-Z0-9]{1,7}(?:[.-][A-Z0-9]{1,4})?$/;
const LEGACY_KEY = 'space:watchlist';
const MIGRATED_KEY = 'space:watchlist-migrated';

const defaultStorage = () => { try { return globalThis.localStorage; } catch { return undefined; } };

export function normalizeSymbol(value, pattern = SYMBOL) {
  const raw = value && typeof value === 'object' ? value.symbol : value;
  const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return pattern.test(symbol) ? symbol : null;
}

// Valid, de-duplicated symbols in their original order. Accepts arrays or { symbols: [] }.
export function normalizeList(list, pattern = SYMBOL) {
  const values = Array.isArray(list) ? list : Array.isArray(list?.symbols) ? list.symbols : [];
  const out = [];
  for (const value of values) {
    const symbol = normalizeSymbol(value, pattern);
    if (symbol && !out.includes(symbol)) out.push(symbol);
  }
  return out.slice(0, STORED_LIMIT);
}

export function createWatchlistStore({ key = WATCHLIST_KEY, storage, target = globalThis, pattern = SYMBOL } = {}) {
  // Without an explicit storage, resolve localStorage on each call (it may be blocked or replaced).
  const db = () => storage || defaultStorage();
  const parse = () => { const text = db().getItem(key); return text === null ? null : JSON.parse(text); };
  const api = {
    key,
    // Saved list, or `fallback` when nothing is saved or storage is unreadable.
    read(fallback = []) {
      try { const saved = parse(); return saved === null ? fallback : normalizeList(saved, pattern); } catch { return fallback; }
    },
    available() {
      try { db().getItem(key); return true; } catch { return false; }
    },
    // Replaces the list. Returns the saved symbols, or null when storage is unavailable.
    write(list) {
      const symbols = normalizeList(list, pattern);
      try {
        const previous = parse();
        if (previous !== null && !Array.isArray(previous) && !Array.isArray(previous?.symbols)) return null;
        db().setItem(key, JSON.stringify(symbols));
      } catch { return null; }
      try { target?.dispatchEvent?.(new CustomEvent(WATCHLIST_EVENT, { detail: { key, symbols } })); } catch { /* no event target */ }
      return symbols;
    },
    // { ok, symbols, error: 'invalid' | 'duplicate' | 'full' | 'storage' }
    add(value, { limit = WATCHLIST_LIMIT } = {}) {
      const current = api.read();
      const symbol = normalizeSymbol(value, pattern);
      if (!symbol) return { ok: false, error: 'invalid', symbols: current };
      if (current.includes(symbol)) return { ok: false, error: 'duplicate', symbol, symbols: current };
      if (current.length >= limit) return { ok: false, error: 'full', symbol, symbols: current };
      const saved = api.write([...current, symbol]);
      return saved ? { ok: true, symbol, symbols: saved } : { ok: false, error: 'storage', symbol, symbols: current };
    },
    remove(value) {
      const current = api.read();
      const symbol = normalizeSymbol(value, pattern) || String(value ?? '').toUpperCase();
      const saved = api.write(current.filter(s => s !== symbol));
      return saved ? { ok: true, symbol, symbols: saved } : { ok: false, error: 'storage', symbol, symbols: current };
    },
    // Union with other lists (existing order first). No-op write when nothing new.
    merge(...lists) {
      const current = api.read();
      const merged = normalizeList([...current, ...lists.flatMap(list => normalizeList(list, pattern))], pattern);
      if (merged.length === current.length) return current;
      return api.write(merged);
    },
    // fn(symbols) on same-tab writes and cross-tab storage events for this key. Returns unsubscribe.
    subscribe(fn) {
      const own = event => { if (event?.detail?.key === key) fn(api.read()); };
      const other = event => { if (event?.key === key || event?.key === null) fn(api.read()); };
      target?.addEventListener?.(WATCHLIST_EVENT, own);
      target?.addEventListener?.('storage', other);
      return () => { target?.removeEventListener?.(WATCHLIST_EVENT, own); target?.removeEventListener?.('storage', other); };
    }
  };
  return api;
}

// One-time merge of the Analyzer's old 'space:watchlist' into the shared list.
// The marker stops removed symbols from coming back on the next load; the legacy
// key is left in place as a backup and is no longer written.
export function migrateLegacyWatchlist(store = createWatchlistStore(), storage) {
  try {
    storage = storage || defaultStorage();
    if (storage.getItem(MIGRATED_KEY)) return store.read();
    let legacy = null;
    try { legacy = JSON.parse(storage.getItem(LEGACY_KEY)); } catch { /* unreadable legacy value */ }
    const merged = store.merge(legacy);
    if (!merged) return store.read();
    storage.setItem(MIGRATED_KEY, '1');
    return merged;
  } catch { return store.read(); }
}

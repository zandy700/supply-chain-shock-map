// Shared upstream helpers for /api/space/* modules. Only the Worker calls providers.
// Finnhub credentials never enter URLs, cache keys, logs or error bodies.
const cache = new Map();
const inFlight = new Map();
let finnhubCooldownUntil = 0;

export class UpstreamError extends Error {
  constructor(code, status = 502) { super(code); this.code = code; this.status = status; }
}
export const json = (body, status = 200, maxAge = 0) =>
  Response.json(body, { status, headers: { 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store' } });
export const fail = (error) =>
  json({ error: error instanceof UpstreamError ? error.code : 'provider_unavailable' }, error?.status || 502);

export const SYMBOL = /^\^?[A-Z0-9]{1,6}(?:[.=-][A-Z0-9]{1,4})?$/;
export function symbolParam(url, name = 'symbol') {
  const v = (url.searchParams.get(name) || '').trim().toUpperCase();
  if (!SYMBOL.test(v)) throw new UpstreamError('invalid_symbol', 400);
  return v;
}

// Cached JSON GET with in-flight de-duplication. ttl in seconds.
export async function getJSON(href, { headers = {}, ttl = 60, timeout = 12000, cacheKey = href } = {}) {
  const hit = cache.get(cacheKey);
  // A slow research caller must not make a fast price caller reuse an older sample.
  if (hit && hit.expires > Date.now() && Date.now() - hit.fetchedAt < ttl * 1000) return hit.body;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey);
  const p = (async () => {
    let res;
    try { res = await fetch(href, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeout) }); }
    catch { throw new UpstreamError('provider_unavailable'); }
    if (res.status === 429) throw new UpstreamError('rate_limited', 429);
    if (res.status === 401 || res.status === 403) throw new UpstreamError('provider_access_denied');
    if (!res.ok) throw new UpstreamError('provider_unavailable');
    let body; try { body = await res.json(); } catch { throw new UpstreamError('provider_unavailable'); }
    if (cache.size >= 1024) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { body, fetchedAt: Date.now(), expires: Date.now() + ttl * 1000 });
    return body;
  })();
  inFlight.set(cacheKey, p);
  try { return await p; } finally { inFlight.delete(cacheKey); }
}

export async function finnhub(path, params, env, ttl = 300) {
  if (!env.FINNHUB_API_KEY) throw new UpstreamError('provider_not_configured', 503);
  if (Date.now() < finnhubCooldownUntil) throw new UpstreamError('rate_limited', 429);
  const url = new URL('https://finnhub.io/api/v1/' + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  try {
    const body = await getJSON(url.href, { headers: { 'X-Finnhub-Token': env.FINNHUB_API_KEY }, ttl });
    if (body?.error) throw new UpstreamError('provider_unavailable');
    return body;
  } catch (e) {
    if (e.code === 'rate_limited') finnhubCooldownUntil = Date.now() + 30000;
    throw e;
  }
}

// Nasdaq public JSON API (api.nasdaq.com). Requires a browser-like UA. Delayed data.
export async function nasdaq(path, params, ttl = 120) {
  const url = new URL('https://api.nasdaq.com/api/' + path.replace(/^\/+/, ''));
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const body = await getJSON(url.href, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) WatchlistPulse', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' }, ttl });
  if (body?.status?.rCode && body.status.rCode !== 200) throw new UpstreamError('provider_unavailable');
  return body?.data ?? null;
}

// Parse Nasdaq-formatted numbers like "$1,234.50", "-2.3%", "12,300", "N/A".
export const num = v => { if (v === null || v === undefined) return null; const n = Number(String(v).replace(/[$,%+\s]/g, '')); return Number.isFinite(n) ? n : null; };

export function resetSpaceUpstreamForTests() { cache.clear(); inFlight.clear(); finnhubCooldownUntil = 0; }

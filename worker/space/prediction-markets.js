// Public, read-only catalogs. No accounts, positions, order submission or API keys.
import { json, UpstreamError } from './upstream.js';
import { STOCK_SOURCES, stockEvent, rankStockEvents } from '../../web/space/panels/prediction-relevance.js';

const KALSHI = 'https://external-api.kalshi.com/trade-api/v2';
const POLY = 'https://gamma-api.polymarket.com';
const pages = new Map(), pending = new Map(), cooldowns = new Map(), pageBudgets = new Map();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 8 * 1024 * 1024, MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const PROVIDERS = ['kalshi', 'polymarket'];
const stockFeeds = new Map(), stockPending = new Map();
const text = (v, max = 1000) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const fullText = v => typeof v === 'string' ? v.trim() : '';
const numeric = v => ['number', 'string'].includes(typeof v) && !(typeof v === 'string' && !v.trim()) && Number.isFinite(Number(v)) ? Number(v) : null;
const positive = v => { const n = numeric(v); return n !== null && n >= 0 ? n : null; };
const probability = v => { const n = numeric(v); return n !== null && n >= 0 && n <= 1 ? n : null; };
const date = v => { if (!v) return null; const n = typeof v === 'number' ? v * 1000 : Date.parse(v); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const array = v => { if (Array.isArray(v)) return v; if (typeof v !== 'string') return []; try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; } };
const idPart = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v) ? v : null;
const slugPart = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,499}$/.test(v) ? v : null;
const lastDate = values => values.filter(Boolean).sort().at(-1) || null;
const firstDate = values => values.filter(Boolean).sort()[0] || null;
const sum = values => values.length && values.every(v => v !== null) ? values.reduce((a, b) => a + b, 0) : null;

function dollars(row, key) {
  if (row[key + '_dollars'] !== undefined && row[key + '_dollars'] !== null) return probability(row[key + '_dollars']);
  const cents = numeric(row[key]); return cents === null ? null : probability(cents / 100);
}
function count(row, key) { return positive(row[key + '_fp'] ?? row[key]); }
function lifecycle(value) {
  if (['active', 'open'].includes(value)) return 'open';
  if (['initialized', 'unopened'].includes(value)) return 'unopened';
  if (['settled', 'finalized'].includes(value)) return 'settled';
  return text(value, 40) || 'unknown';
}
function rules(value) {
  const original = typeof value === 'string' ? value.trim() : '';
  return { rules: original.slice(0, 40000), rulesTruncated: original.length > 40000 };
}

export function normalizeKalshiMarket(row, event) {
  const ticker = idPart(row?.ticker); if (!ticker) return null;
  const volume = count(row, 'volume');
  let yesAsk = dollars(row, 'yes_ask'), noAsk = dollars(row, 'no_ask');
  const noQuotes = yesAsk === 0 && noAsk === 0;
  if (noQuotes) { yesAsk = null; noAsk = null; }
  const suppliedLast = dollars(row, 'last_price');
  const lastPrice = suppliedLast === 0 && (volume === 0 || volume === null) ? null : suppliedLast;
  const url = event.url, status = lifecycle(row.status);
  let yesPrice = yesAsk, noPrice = noAsk, priceKind = 'ask';
  if (status !== 'open') {
    const settlement = status === 'settled' ? probability(row.settlement_value_dollars) ?? (row.result === 'yes' ? 1 : row.result === 'no' ? 0 : null) : null;
    yesPrice = settlement; noPrice = settlement === null ? null : 1 - settlement;
    yesAsk = noAsk = null; priceKind = settlement === null ? 'unavailable' : 'settlement';
  }
  const legs = (Array.isArray(row.mve_selected_legs) ? row.mve_selected_legs : []).filter(l => idPart(l?.market_ticker) && ['yes','no'].includes(l.side)).map(l => ({ marketId: l.market_ticker, eventId: idPart(l.event_ticker), side: l.side }));
  return {
    id: 'kalshi:' + ticker, provider: 'kalshi', ticker,
    question: fullText(row.title) || event.title, subtitle: fullText(row.yes_sub_title || row.subtitle),
    status,
    outcomes: [
      { label: 'Yes', price: yesPrice, bid: status === 'open' && !noQuotes ? dollars(row, 'yes_bid') : null, ask: yesAsk, priceKind: yesPrice === null ? 'unavailable' : priceKind },
      { label: 'No', price: noPrice, bid: status === 'open' && !noQuotes ? dollars(row, 'no_bid') : null, ask: noAsk, priceKind: noPrice === null ? 'unavailable' : priceKind }
    ],
    lastPrice, volume, volume24h: count(row, 'volume_24h'), volumeUnit: 'contracts',
    openInterest: count(row, 'open_interest'), closeTime: date(row.close_time || row.expiration_time),
    updatedAt: date(row.updated_time), url, dataUrl: `${KALSHI}/markets/${encodeURIComponent(ticker)}`, legs,
    ...rules([row.rules_primary, row.rules_secondary, legs.length ? 'Combination legs (provider supplied):\n' + legs.map(l => `- ${l.side.toUpperCase()} ${l.marketId}${l.eventId ? ' · event ' + l.eventId : ''}`).join('\n') : ''].filter(v => typeof v === 'string' && v.trim()).join('\n\n'))
  };
}

export function normalizeKalshiCombo(row) {
  const ticker = idPart(row?.ticker); if (!ticker) return null;
  const event = normalizeKalshiEvent({ event_ticker: idPart(row.event_ticker) || ticker, series_ticker: row.mve_collection_ticker, title: fullText(row.title) || ticker, category: 'Combos', markets: [row] });
  if (!event) return null;
  // One combination ticket per card. Grouping by event across provider pages
  // could cause frontend de-duplication to replace other tickets from that event.
  event.id = 'kalshi:combo:' + ticker;
  event.kind = 'combo';
  event.url = 'https://kalshi.com'; event.urlLabel = 'Open Kalshi';
  event.markets.forEach(market => { market.url = event.url; });
  return event;
}

export function normalizeKalshiEvent(row) {
  const ticker = idPart(row?.event_ticker), series = idPart(row?.series_ticker);
  if (!ticker || !text(row.title)) return null;
  const event = {
    id: 'kalshi:' + ticker, provider: 'kalshi', ticker, title: fullText(row.title), subtitle: fullText(row.sub_title),
    category: text(row.category, 100) || 'Uncategorized', tags: row.category ? [text(row.category, 100)] : [],
    // The public event payload has no canonical website slug. Link to its series, not an invented event URL.
    url: series ? `https://kalshi.com/markets/${encodeURIComponent(series.toLowerCase())}` : 'https://kalshi.com/markets',
    urlLabel: 'Open Kalshi series', dataUrl: `${KALSHI}/events/${encodeURIComponent(ticker)}`,
    volumeUnit: 'contracts'
  };
  const supplied = Array.isArray(row.markets) ? row.markets : [];
  event.markets = supplied.map(m => normalizeKalshiMarket(m, event)).filter(Boolean);
  event.marketCount = supplied.length;
  event.partial = !Array.isArray(row.markets) || event.markets.length !== supplied.length;
  event.volume24h = sum(event.markets.map(m => m.volume24h));
  event.closeTime = firstDate(event.markets.map(m => m.closeTime));
  event.updatedAt = date(row.last_updated_ts) || lastDate(event.markets.map(m => m.updatedAt));
  return event;
}

export function normalizePolymarketMarket(row, event) {
  const id = idPart(String(row?.id ?? '')); if (!id) return null;
  const labels = array(row.outcomes), prices = array(row.outcomePrices), binary = labels.length === 2 && labels[0] === 'Yes' && labels[1] === 'No';
  const outcomes = labels.map((label, i) => ({
    label: fullText(label), price: probability(prices[i]),
    bid: binary && String(label).toLowerCase() === 'yes' ? probability(row.bestBid) : null,
    ask: binary && String(label).toLowerCase() === 'yes' ? probability(row.bestAsk) : null,
    priceKind: 'snapshot'
  }));
  const slug = slugPart(row.slug);
  return {
    id: 'polymarket:' + id, provider: 'polymarket',
    question: fullText(row.question || row.groupItemTitle) || event.title, subtitle: fullText(row.groupItemTitle),
    status: row.closed === true ? 'closed' : row.active === true ? 'open' : 'unopened', outcomes,
    lastPrice: probability(row.lastTradePrice), volume: positive(row.volumeNum ?? row.volume),
    volume24h: positive(row.volume24hr), volumeUnit: 'USD', openInterest: positive(row.openInterest),
    closeTime: date(row.endDate || row.endDateIso), updatedAt: date(row.updatedAt),
    url: slug && event.slug && slug !== event.slug ? `https://polymarket.com/event/${event.slug}/${slug}` : event.url,
    dataUrl: `${POLY}/markets/${encodeURIComponent(id)}`, ...rules(row.description)
  };
}

export function normalizePolymarketEvent(row) {
  const id = idPart(String(row?.id ?? '')), slug = slugPart(row?.slug);
  if (!id || !text(row.title)) return null;
  const tags = (Array.isArray(row.tags) ? row.tags : []).map(t => text(typeof t === 'string' ? t : t?.label, 100)).filter(Boolean);
  const event = {
    id: 'polymarket:' + id, provider: 'polymarket', slug,
    title: fullText(row.title), subtitle: '', category: text(row.category, 100) || tags[0] || 'Uncategorized', tags,
    url: slug ? `https://polymarket.com/event/${slug}` : 'https://polymarket.com', urlLabel: 'Open Polymarket event',
    dataUrl: `${POLY}/events/${encodeURIComponent(id)}`, volumeUnit: 'USD'
  };
  const supplied = Array.isArray(row.markets) ? row.markets : [];
  event.markets = supplied.map(m => normalizePolymarketMarket(m, event)).filter(Boolean);
  event.marketCount = supplied.length;
  event.partial = !Array.isArray(row.markets) || event.markets.length !== supplied.length;
  event.volume24h = positive(row.volume24hr);
  event.closeTime = date(row.endDate) || firstDate(event.markets.map(m => m.closeTime));
  event.updatedAt = date(row.updatedAt);
  return event;
}

function encodeCursor(provider, status, kind, limit, value) {
  return btoa(JSON.stringify({ v: 1, p: provider, s: status, k: kind, l: limit, c: value })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeCursor(token, provider, status, kind, limit) {
  if (!token) return provider === 'polymarket' ? 0 : '';
  try {
    if (provider === 'all' || token.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw 0;
    const data = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
    if (data.v !== 1 || data.p !== provider || data.s !== status || data.k !== kind || data.l !== limit) throw 0;
    if (provider === 'polymarket') {
      if (!Number.isSafeInteger(data.c) || data.c < 0 || data.c > 10000000) throw 0;
    } else if (typeof data.c !== 'string' || data.c.length > 4000 || !/^[A-Za-z0-9_+=/:.-]*$/.test(data.c)) throw 0;
    return data.c;
  } catch { throw new UpstreamError('invalid_cursor', 400); }
}

async function publicPage(url) {
  const key = url.href, hit = pages.get(key), origin = url.origin;
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) { cacheBytes -= hit.bytes; pages.delete(key); }
  if ((cooldowns.get(origin) || 0) > Date.now()) throw new UpstreamError('rate_limited', 429);
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 4) throw new UpstreamError('rate_limited', 429);
  const request = (async () => {
    let response;
    try { response = await fetch(key, { headers: { Accept: 'application/json', 'User-Agent': 'WatchlistPulse public market browser' }, redirect: 'manual', signal: AbortSignal.timeout(12000) }); }
    catch { throw new UpstreamError('provider_unavailable'); }
    if (response.status === 429) { cooldowns.set(origin, Date.now() + 30000); throw new UpstreamError('rate_limited', 429); }
    if (!response.ok) throw new UpstreamError(response.status === 403 || response.status === 401 ? 'provider_access_denied' : 'provider_unavailable');
    let body, bytes;
    try {
      const raw = await boundedBody(response);
      // The parsed object costs more than its wire JSON. Budget conservatively.
      bytes = raw.length * 4;
      body = JSON.parse(raw);
    } catch (e) { if (e instanceof UpstreamError) throw e; throw new UpstreamError('invalid_provider_response'); }
    const value = { body, fetchedAt: new Date().toISOString() };
    if (bytes <= MAX_CACHE_BYTES) {
      while (pages.size && (pages.size >= 128 || cacheBytes + bytes > MAX_CACHE_BYTES)) {
        const oldest = pages.keys().next().value; cacheBytes -= pages.get(oldest).bytes; pages.delete(oldest);
      }
      pages.set(key, { value, bytes, expires: Date.now() + 30000 }); cacheBytes += bytes;
    }
    return value;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

async function catalogPage(provider, status, kind, limit, cursor) {
  const url = new URL(provider === 'kalshi' ? `${KALSHI}/${kind === 'combos' ? 'markets' : 'events'}` : `${POLY}/events`);
  const budgetKey = `${provider}:${status}:${kind}`, budget = pageBudgets.get(budgetKey);
  let pageLimit = Math.min(provider === 'polymarket' ? 2 : limit, budget && budget.expires > Date.now() ? Math.min(limit, budget.limit) : limit);
  url.searchParams.set('limit', String(pageLimit));
  if (provider === 'kalshi') {
    if (kind === 'combos') url.searchParams.set('mve_filter', 'only');
    else url.searchParams.set('with_nested_markets', 'true');
    url.searchParams.set('status', status);
    if (cursor) url.searchParams.set('cursor', cursor);
  } else {
    url.searchParams.set('closed', String(status === 'closed'));
    if (status === 'open') url.searchParams.set('active', 'true');
    url.searchParams.set('offset', String(cursor));
    url.searchParams.set('order', 'volume24hr'); url.searchParams.set('ascending', 'false');
  }
  let page;
  for (;;) {
    try { page = await publicPage(url); break; }
    catch (e) {
      // One event may contain hundreds of outcomes. Reduce event count, never
      // silently remove its child markets to make a page fit the Worker budget.
      if (e.code !== 'provider_page_too_large' || pageLimit === 1) throw e;
      pageLimit = Math.max(1, Math.floor(pageLimit / 2));
      url.searchParams.set('limit', String(pageLimit));
      pageBudgets.set(budgetKey, { limit: pageLimit, expires: Date.now() + 1800000 });
    }
  }
  const { body, fetchedAt } = page;
  const rows = provider === 'kalshi' ? kind === 'combos' ? body?.markets : body?.events : body;
  if (!Array.isArray(rows) || (provider === 'kalshi' && typeof body.cursor !== 'string')) throw new UpstreamError('invalid_provider_response');
  const normalize = provider === 'kalshi' ? kind === 'combos' ? normalizeKalshiCombo : normalizeKalshiEvent : normalizePolymarketEvent;
  const normalized = rows.map(normalize).filter(Boolean);
  const events = normalized;
  const next = provider === 'kalshi' ? body.cursor || null : rows.length === pageLimit ? cursor + rows.length : null;
  return {
    events,
    source: { provider, status: 'ok', fetchedAt, hasMore: next !== null,
      nextCursor: next === null ? null : encodeCursor(provider, status, kind, limit, next),
      returnedEvents: events.length, upstreamEvents: rows.length, requestedLimit: limit, pageLimit, pageScope: kind === 'combos' ? 'combo contracts' : 'events',
      droppedEvents: rows.length - normalized.length,
      returnedMarkets: events.reduce((n, e) => n + e.markets.length, 0) }
  };
}

async function boundedBody(response) {
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError('provider_page_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const parts = [], decoder = new TextDecoder(); let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => {}); throw new UpstreamError('provider_page_too_large'); }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join('');
  } finally { reader.releaseLock(); }
}

function searchCursor(token, query, status, limit) {
  if (!token) return 1;
  try {
    if (token.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw 0;
    const raw = atob(token.replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, c => c.charCodeAt(0))));
    if (data.v !== 2 || data.q !== query || data.s !== status || data.l !== limit || !Number.isSafeInteger(data.p) || data.p < 1 || data.p > 10000) throw 0;
    return data.p;
  } catch { throw new UpstreamError('invalid_cursor', 400); }
}

async function searchPolymarket(query, status, limit, pageNumber) {
  const url = new URL(`${POLY}/public-search`), pageLimit = Math.min(limit, 5);
  for (const [key, value] of Object.entries({ q: query, events_status: status === 'open' ? 'active' : 'closed', limit_per_type: pageLimit, page: pageNumber, search_profiles: false, search_tags: false })) url.searchParams.set(key, String(value));
  const { body, fetchedAt } = await publicPage(url);
  if (!body || (body.events != null && !Array.isArray(body.events)) || typeof body.pagination?.hasMore !== 'boolean') throw new UpstreamError('invalid_provider_response');
  const rows = body.events || [], events = rows.map(normalizePolymarketEvent).filter(Boolean);
  const next = { v: 2, q: query, s: status, l: limit, p: pageNumber + 1 };
  const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(next)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { events, source: { provider: 'polymarket', status: 'ok', fetchedAt, query, pageScope: 'Polymarket search results', hasMore: body.pagination.hasMore,
    nextCursor: body.pagination.hasMore ? encoded : null, requestedLimit: limit, pageLimit, returnedEvents: events.length, upstreamEvents: rows.length,
    droppedEvents: rows.length - events.length, returnedMarkets: events.reduce((n, e) => n + e.markets.length, 0),
    totalResults: Number.isSafeInteger(body.pagination.totalResults) && body.pagination.totalResults >= 0 ? body.pagination.totalResults : null } };
}

async function stockTagPage(source, status, offset) {
  const budgetKey = `stocks:${source.id}:${status}`, budget = pageBudgets.get(budgetKey);
  let limit = budget?.expires > Date.now() ? Math.min(4, budget.limit) : 4;
  const url = new URL(`${POLY}/events`);
  for (const [key, value] of Object.entries({ tag_id: source.tagId, related_tags: true, closed: status === 'closed', order: 'volume24hr', ascending: false, offset })) url.searchParams.set(key, String(value));
  if (status === 'open') url.searchParams.set('active', 'true');
  for (;;) {
    url.searchParams.set('limit', String(limit));
    try {
      const { body, fetchedAt } = await publicPage(url);
      if (!Array.isArray(body)) throw new UpstreamError('invalid_provider_response');
      const events = body.map(normalizePolymarketEvent).filter(Boolean).map(stockEvent).filter(Boolean);
      return { events, coverage: { ...source, status: 'ok', fetchedAt, scanned: body.length, retained: events.length, hasMore: body.length === limit, nextOffset: body.length === limit ? offset + body.length : null } };
    } catch (e) {
      if (e.code !== 'provider_page_too_large' || limit === 1) throw e;
      limit = Math.max(1, Math.floor(limit / 2)); pageBudgets.set(budgetKey, { limit, expires: Date.now() + 1800000 });
    }
  }
}

async function stockFeed(url) {
  const status = url.searchParams.get('status') || 'open', token = url.searchParams.get('cursor') || '';
  if (!['open', 'closed'].includes(status)) throw new UpstreamError('invalid_prediction_query', 400);
  let offsets = STOCK_SOURCES.map(() => 0);
  if (token) {
    try {
      if (token.length > 6000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw 0;
      const data = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
      if (data.v !== 3 || data.s !== status || !Array.isArray(data.o) || data.o.length !== offsets.length || data.o.some(n => n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 10000000))) throw 0;
      offsets = data.o;
    } catch { throw new UpstreamError('invalid_cursor', 400); }
  }
  const key = status + ':' + token, cached = stockFeeds.get(key);
  if (cached?.until > Date.now()) return json(cached.body, 200, 0);
  if (stockPending.has(key)) { const b = await stockPending.get(key); return json(b, b.error ? 503 : 200, 0); }
  if (stockPending.size >= 2) throw new UpstreamError('rate_limited', 429);
  const work = (async () => {
    const results = [];
    // Keep the existing public-request concurrency bound, including shared caching.
    for (let i = 0; i < STOCK_SOURCES.length; i += 3) {
      results.push(...await Promise.all(STOCK_SOURCES.slice(i, i + 3).map(async (source, j) => {
        const offset = offsets[i + j];
        if (offset === null) return { events: [], coverage: { ...source, status: 'ok', scanned: 0, retained: 0, nextOffset: null, hasMore: false } };
        try { return await stockTagPage(source, status, offset); }
        catch (e) { return { events: [], coverage: { ...source, status: 'error', error: ['rate_limited', 'provider_page_too_large', 'invalid_provider_response', 'provider_access_denied'].includes(e.code) ? e.code : 'provider_unavailable', scanned: 0, retained: 0, nextOffset: offset, hasMore: true } }; }
      })));
    }
    const coverage = results.map(r => r.coverage), unique = new Map();
    results.flatMap(r => r.events).forEach(e => { if (!unique.has(e.id)) unique.set(e.id, e); });
    const events = rankStockEvents([...unique.values()]);
    const activeSources = coverage.filter((_, i) => offsets[i] !== null), failed = activeSources.filter(c => c.status === 'error');
    const allFailed = activeSources.length > 0 && failed.length === activeSources.length;
    const hasMore = coverage.some(c => c.hasMore), next = btoa(JSON.stringify({ v: 3, s: status, o: coverage.map(c => c.nextOffset) })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const fetchedAt = firstDate(coverage.map(c => c.fetchedAt));
    const body = { ...(allFailed ? { error: 'prediction_providers_unavailable' } : {}), events, coverage,
      sources: [{ provider: 'polymarket', status: allFailed ? 'error' : 'ok', partial: failed.length > 0, ...(allFailed ? { error: 'provider_unavailable' } : {}), fetchedAt, hasMore,
        nextCursor: hasMore ? next : null, returnedEvents: events.length, returnedMarkets: events.reduce((n, e) => n + e.markets.length, 0),
        pageScope: 'stock-relevant events across ' + STOCK_SOURCES.length + ' categories' }],
      fetchedAt: new Date().toISOString(), notices: [
        `Screened ${coverage.reduce((n, c) => n + c.scanned, 0)} provider events across ${STOCK_SOURCES.length} stock, business, technology, economic, energy, trade and geopolitical categories; duplicate events are combined.`,
        'Relevance is editorial title/tag screening, not a forecast of stock-price impact. Sports, entertainment, personal-life and unrelated questions are excluded. Coverage is a paginated selection, not every important market.',
        'Events are ranked by available 24-hour Polymarket USD activity. Probabilities are outcome-price snapshots; read individual deadlines and resolution rules.',
        ...(failed.length ? [`${failed.length} categories could not be checked. Other results are retained; refresh to retry.`] : [])
      ] };
    if (!allFailed && JSON.stringify(body).length <= 4 * 1024 * 1024) { if (stockFeeds.size >= 2) stockFeeds.delete(stockFeeds.keys().next().value); stockFeeds.set(key, { until: Date.now() + 30000, body }); }
    return body;
  })();
  stockPending.set(key, work);
  try { const body = await work; return json(body, body.error ? 503 : 200, 0); } finally { stockPending.delete(key); }
}

// Deliberate economic/company series, verified against the public series catalog.
// The general /events page is dominated by sports; never treat it as stock discovery.
export const KALSHI_STOCK_SOURCES = [
  ['KXFEDDECISION', 'Fed decisions'], ['KXCPI', 'CPI'], ['KXCPIYOY', 'Annual inflation'],
  ['KXCPICORE', 'Core CPI'], ['KXCPICOREYOY', 'Core annual inflation'], ['KXGDP', 'US GDP'],
  ['KXU3', 'Unemployment'], ['KXPAYROLLS', 'Payrolls'], ['KXJOBLESSCLAIMS', 'Jobless claims'],
  ['KXMORTGAGERATE', 'Mortgage rates'], ['KXHOUSINGSTART', 'Housing starts'],
  ['KXIPOANTHROPIC', 'Anthropic IPO'], ['KXIPOOPENAI', 'OpenAI IPO'], ['KXIPOSPACEX', 'SpaceX IPO']
].map(([id, label]) => ({ id, label }));

async function kalshiStockFeed(url) {
  const status = url.searchParams.get('status') || 'open', token = url.searchParams.get('cursor') || '';
  if (!['open', 'closed'].includes(status)) throw new UpstreamError('invalid_prediction_query', 400);
  let cursors = KALSHI_STOCK_SOURCES.map(() => '');
  if (token) {
    try {
      if (token.length > 64000 || !/^[A-Za-z0-9_-]+$/.test(token)) throw 0;
      const d = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
      if (d.v !== 4 || d.s !== status || !Array.isArray(d.c) || d.c.length !== cursors.length ||
        d.c.some(c => c !== null && (typeof c !== 'string' || c.length > 4000 || !/^[A-Za-z0-9_+=/:.-]*$/.test(c)))) throw 0;
      cursors = d.c;
    } catch { throw new UpstreamError('invalid_cursor', 400); }
  }
  const key = 'kalshi:' + status + ':' + token, cached = stockFeeds.get(key);
  if (cached?.until > Date.now()) return json(cached.body, 200, 0);
  if (stockPending.has(key)) { const b = await stockPending.get(key); return json(b, b.error ? 503 : 200, 0); }
  if (stockPending.size >= 2) throw new UpstreamError('rate_limited', 429);
  const work = (async () => {
    const eventsById = new Map(), coverage = [];
    // One Kalshi request at a time leaves three shared slots for Polymarket.
    for (const [i, source] of KALSHI_STOCK_SOURCES.entries()) {
      if (cursors[i] === null) { coverage.push({ ...source, status: 'ok', scanned: 0, retained: 0, nextCursor: null }); continue; }
      const endpoint = new URL(KALSHI + '/events');
      for (const [k, v] of Object.entries({ series_ticker: source.id, status, with_nested_markets: true, limit: 2 })) endpoint.searchParams.set(k, String(v));
      if (cursors[i]) endpoint.searchParams.set('cursor', cursors[i]);
      try {
        const { body, fetchedAt } = await publicPage(endpoint);
        if (!Array.isArray(body?.events) || typeof body.cursor !== 'string' || body.cursor.length > 4000 || !/^[A-Za-z0-9_+=/:.-]*$/.test(body.cursor)) throw new UpstreamError('invalid_provider_response');
        let retained = 0;
        for (const row of body.events) {
          const event = stockEvent(normalizeKalshiEvent(row));
          if (!event) continue;
          // Open events may also contain already settled date/threshold contracts.
          // Only open child contracts belong in the live discovery feed.
          if (status === 'open') {
            const markets = event.markets.filter(m => m.status === 'open');
            if (!markets.length) continue;
            event.excludedLifecycleMarkets = event.markets.length - markets.length;
            event.markets = markets; event.marketCount = markets.length;
            event.closeTime = firstDate(markets.map(m => m.closeTime));
            event.volume24h = sum(markets.map(m => m.volume24h));
          }
          eventsById.set(event.id, event); retained++;
        }
        coverage.push({ ...source, status: 'ok', fetchedAt, scanned: body.events.length, retained, nextCursor: body.cursor || null });
      } catch (e) {
        coverage.push({ ...source, status: 'error', error: ['rate_limited', 'provider_access_denied', 'invalid_provider_response', 'provider_page_too_large'].includes(e.code) ? e.code : 'provider_unavailable', scanned: 0, retained: 0, nextCursor: cursors[i] });
      }
    }
    const failed = coverage.filter(c => c.status === 'error'), active = coverage.filter((_, i) => cursors[i] !== null);
    const allFailed = active.length > 0 && failed.length === active.length;
    const hasMore = coverage.some(c => c.nextCursor !== null);
    const next = btoa(JSON.stringify({ v: 4, s: status, c: coverage.map(c => c.nextCursor) })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const events = rankStockEvents([...eventsById.values()]);
    const body = { ...(allFailed ? { error: 'prediction_providers_unavailable' } : {}), events, coverage,
      sources: [{ provider: 'kalshi', status: allFailed ? 'error' : 'ok', partial: failed.length > 0, ...(allFailed ? { error: 'provider_unavailable' } : {}),
        fetchedAt: firstDate(coverage.map(c => c.fetchedAt)), hasMore, nextCursor: hasMore ? next : null,
        returnedEvents: events.length, returnedMarkets: events.reduce((n, e) => n + e.markets.length, 0), pageScope: 'stock-relevant events across ' + KALSHI_STOCK_SOURCES.length + ' selected series' }],
      fetchedAt: new Date().toISOString(), notices: [
        'Kalshi discovery covers selected Fed, inflation, GDP, employment, housing, mortgage and IPO series. This is a paginated selection, not the entire exchange.',
        'Kalshi prices are ask prices in cents, not Polymarket probability snapshots. Contract volumes and USD turnover are kept separate.',
        'On the combined board, Polymarket takes priority for recognized overlapping events. Kalshi adds unmatched events from loaded pages. Kalshi-only browsing retains its full selected catalog; contract prices and rules are never merged.',
        ...(failed.length ? [`${failed.length} Kalshi series could not be checked. Other results are retained; refresh to retry.`] : [])
      ] };
    if (!allFailed && JSON.stringify(body).length <= 4 * 1024 * 1024) {
      if (stockFeeds.size >= 4) stockFeeds.delete(stockFeeds.keys().next().value);
      stockFeeds.set(key, { until: Date.now() + 30000, body });
    }
    return body;
  })();
  stockPending.set(key, work);
  try { const body = await work; return json(body, body.error ? 503 : 200, 0); } finally { stockPending.delete(key); }
}

export async function handle(request, env, ctx, url, rest) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (rest === 'stock-events') {
    const provider = url.searchParams.get('provider') || 'polymarket';
    if (!['kalshi', 'polymarket'].includes(provider)) throw new UpstreamError('invalid_prediction_query', 400);
    return provider === 'kalshi' ? kalshiStockFeed(url) : stockFeed(url);
  }
  if (rest !== 'catalog') return json({ error: 'Unknown prediction-market route.' }, 404);
  const q = url.searchParams, provider = q.get('provider') || 'all', status = q.get('status') || 'open', kind = q.get('kind') || 'standard';
  const rawLimit = q.get('limit') || '12', limit = Number(rawLimit);
  if (!['all', ...PROVIDERS].includes(provider) || !['open', 'closed'].includes(status) || !['standard', 'combos'].includes(kind) || !/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new UpstreamError('invalid_prediction_query', 400);
  if (provider === 'polymarket' && kind === 'combos') throw new UpstreamError('combos_available_only_on_kalshi', 400);
  if (q.has('q')) {
    const query = q.get('q').trim();
    if (!query || query.length > 200 || /[\u0000-\u001f\u007f]/.test(query)) throw new UpstreamError('invalid_prediction_search', 400);
    if (provider !== 'polymarket' || kind !== 'standard') throw new UpstreamError('search_available_only_on_polymarket', 400);
    const pageNumber = searchCursor(q.get('cursor'), query, status, limit);
    try {
      const result = await searchPolymarket(query, status, limit, pageNumber);
      const events = q.get('scope') === 'stocks' ? result.events.map(stockEvent).filter(Boolean) : result.events;
      return json({ events, sources: [{ ...result.source, returnedEvents: events.length, returnedMarkets: events.reduce((n, e) => n + e.markets.length, 0) }], query, fetchedAt: new Date().toISOString(), notices: [
        'Search results come from Polymarket, with provider pagination. Loaded category and text filters apply within these results.',
        'Percentages are market-implied probabilities from outcome price snapshots, not independent forecasts or guaranteed executable quotes. Read each contract’s deadline and resolution rules.',
        'Provider update times may reflect metadata; checked time records this application fetch.'
      ] }, 200, 0);
    } catch (e) {
      const error = ['rate_limited', 'provider_access_denied', 'invalid_provider_response', 'provider_page_too_large'].includes(e.code) ? e.code : 'provider_unavailable';
      return json({ error: 'prediction_providers_unavailable', query, events: [], sources: [{ provider: 'polymarket', status: 'error', error, hasMore: false, nextCursor: null }], notices: ['Polymarket search is unavailable. This is not evidence that no matching markets exist.'] }, 503, 0);
    }
  }
  const cursor = decodeCursor(q.get('cursor'), provider, status, kind, limit);
  const providers = provider === 'all' ? kind === 'combos' ? ['kalshi'] : PROVIDERS : [provider];
  const results = await Promise.all(providers.map(async p => {
    try { return await catalogPage(p, status, kind, limit, provider === 'all' ? p === 'polymarket' ? 0 : '' : cursor); }
    catch (e) { return { events: [], source: { provider: p, status: 'error', error: ['rate_limited', 'provider_access_denied', 'invalid_provider_response', 'provider_page_too_large'].includes(e.code) ? e.code : 'provider_unavailable', fetchedAt: null, hasMore: false, nextCursor: null } }; }
  }));
  const notices = [
    kind === 'combos' ? 'Paginated public combo-contract catalog; this response is a page, not the entire catalog.' : 'Paginated public event catalogs; this response is a page, not the entire catalog. Child market lifecycle statuses may differ from the selected event status.',
    'Kalshi outcome prices are available asks; Polymarket outcome prices are Gamma snapshots. Prices are not guaranteed executable quotes or forecasts.',
    'Kalshi volume is contracts; Polymarket volume is USD. Volumes are not directly comparable or summed across venues.',
    'Provider updated timestamps may describe metadata, not quote time. Checked time describes this application fetch.'
  ];
  if (kind === 'combos') notices.push('Combo browsing covers Kalshi multivariate contracts only, using the market endpoint’s native status and combo filters. Each card is one combination ticket; its provider-supplied legs are retained in the details. Polymarket is not included in this mode.');
  if (status === 'closed' && providers.includes('kalshi')) notices.push('Kalshi nested historical markets older than its historical cutoff are not included by the event endpoint; this is not a complete settled-market archive.');
  const sources = results.map(r => r.source), failed = sources.filter(s => s.status === 'error');
  if (sources.some(s => s.pageLimit < s.requestedLimit)) notices.push('A provider page contains many outcomes, so its event page size was reduced to fit the response budget. All nested markets are retained; use that provider’s next page to continue.');
  if (failed.length) notices.push('Some requested provider catalogs are unavailable; successful provider results remain visible.');
  const allFailed = failed.length === providers.length;
  const returned = results.flatMap(r => r.events);
  const events = q.get('scope') === 'stocks' ? returned.map(stockEvent).filter(Boolean) : returned;
  if (q.get('scope') === 'stocks') for (const source of sources) { const retained = events.filter(e => e.provider === source.provider); source.returnedEvents = retained.length; source.returnedMarkets = retained.reduce((n, e) => n + e.markets.length, 0); }
  return json({ ...(allFailed ? { error: 'prediction_providers_unavailable' } : {}), events, sources, fetchedAt: new Date().toISOString(), notices }, allFailed ? 503 : 200, 0);
}

export function resetPredictionMarketCacheForTests() { pages.clear(); pending.clear(); cooldowns.clear(); pageBudgets.clear(); stockFeeds.clear(); stockPending.clear(); cacheBytes = 0; }

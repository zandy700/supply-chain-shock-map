import { THEMES_BY_ID } from '../../web/space/themes.js';
// /api/space/news/* — market, symbol and theme news. Owned by the news-earnings builder (docs/space-contract.md).
// Finnhub (when keyed) supplies headlines with images; the Nasdaq public RSS feeds are the keyless source.
// Every headline is run through the existing classify() keyword rules, the same semantics as /api/briefing.
import { json, UpstreamError, SYMBOL, finnhub } from './upstream.js';
import { classify } from '../classify.js';

const FINNHUB_CATEGORIES = new Set(['general', 'forex', 'crypto', 'merger']);
// Nasdaq RSS category feeds (probed 2026-11-11; unknown names silently return a generic feed, so only these are used).
const RSS_CATEGORIES = { general: 'Markets', forex: 'Forex', crypto: 'Cryptocurrencies', earnings: 'Earnings', economy: 'Economy', technology: 'Technology', commodities: 'Commodities', ipos: 'IPOs', stocks: 'Stocks' };
export const CATEGORIES = ['general', 'forex', 'crypto', 'merger', 'earnings', 'economy', 'technology', 'commodities', 'ipos', 'stocks'];
const MAX_SYMBOLS = 12;
const MAX_ITEMS = 120;

export const safeURL = value => { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

// Same mapping as /api/briefing impacts: a keyword scenario, never a forecast.
export function prediction(title) {
  const kind = classify(String(title || ''));
  if (!kind.sign) return null;
  return {
    direction: kind.sign > 0 ? 'positive' : 'negative', event_type: kind.event_type,
    category: kind.event_type.replaceAll('_', ' '), severity: kind.severity, confidence: 'Low',
    method: kind.classification_method,
    reason: 'Headline keyword scenario. Not verified exposure, propagation or a forecast.'
  };
}

const text = new Map(); // tiny cache for RSS text
async function getText(href, ttl = 120) {
  const hit = text.get(href);
  if (hit && hit.expires > Date.now()) return hit.body;
  let res;
  try { res = await fetch(href, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) WatchlistPulse', Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new UpstreamError('provider_unavailable'); }
  if (res.status === 429) throw new UpstreamError('rate_limited', 429);
  if (!res.ok) throw new UpstreamError('provider_unavailable');
  const body = await res.text();
  if (text.size >= 256) text.delete(text.keys().next().value);
  text.set(href, { body, expires: Date.now() + ttl * 1000 });
  return body;
}
export function resetNewsCacheForTests() { text.clear(); }

const decode = s => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]) : ''; };

// Parse Nasdaq RSS <item>s into feed rows. Exported for tests.
export function parseRSS(xml, category) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1];
    const url = safeURL(tag(item, 'link'));
    const title = tag(item, 'title');
    const ms = Date.parse(tag(item, 'pubDate'));
    if (!url || !title || !Number.isFinite(ms)) continue;
    const symbols = [...new Set(tag(item, 'nasdaq:tickers').split(',').map(s => s.trim().toUpperCase()).filter(s => SYMBOL.test(s)))];
    out.push({
      id: 'nq-' + (url.split('/').pop() || '').replace(/[^a-z0-9-]/gi, '').slice(0, 80), title, summary: tag(item, 'description'),
      source: tag(item, 'dc:creator') || 'Nasdaq', url, image: null, date: new Date(ms).toISOString(), symbols,
      category, topic: tag(item, 'category') || null, provider: 'Nasdaq RSS'
    });
  }
  return out;
}

function fromFinnhub(row, category, fallbackSymbol) {
  const url = safeURL(row?.url);
  if (!row?.headline || !url || !Number.isFinite(row.datetime) || row.datetime <= 0) return null;
  let related = [...new Set(String(row.related || '').split(',').map(s => s.trim().toUpperCase()).filter(s => SYMBOL.test(s)))];
  if (fallbackSymbol) related = [fallbackSymbol, ...related.filter(s => s !== fallbackSymbol)];
  return {
    id: 'fh-' + String(row.id ?? url).replace(/[^a-z0-9-]/gi, '').slice(0, 80), title: String(row.headline), summary: String(row.summary || ''),
    source: String(row.source || 'Finnhub'), url, image: safeURL(row.image), date: new Date(row.datetime * 1000).toISOString(),
    symbols: related, category: row.category || category, provider: 'Finnhub'
  };
}

const ymd = d => d.toISOString().slice(0, 10);

async function symbolNews(sym, env, errors, providers) {
  if (env.FINNHUB_API_KEY) {
    try {
      const now = new Date();
      const rows = await finnhub('company-news', { symbol: sym, from: ymd(new Date(now - 7 * 86400000)), to: ymd(now) }, env, 300);
      if (!Array.isArray(rows)) throw new UpstreamError('provider_unavailable');
      providers.add('Finnhub');
      return rows.map(r => fromFinnhub(r, 'company', sym)).filter(Boolean);
    } catch (e) { errors.push({ symbol: sym, provider: 'Finnhub', code: e.code || 'provider_unavailable' }); }
  }
  try {
    const rows = parseRSS(await getText('https://www.nasdaq.com/feed/rssoutbound?symbol=' + encodeURIComponent(sym)), 'company');
    providers.add('Nasdaq RSS');
    // RSS endpoints may include broad market articles. Do not invent a ticker
    // relationship merely because it was the requested feed parameter.
    return rows.filter(r=>r.symbols.includes(sym)||r.title.includes('('+sym+')')).map(r => ({ ...r, symbols: [sym, ...r.symbols.filter(x => x !== sym)] }));
  } catch (e) { errors.push({ symbol: sym, provider: 'Nasdaq RSS', code: e.code || 'provider_unavailable' }); return []; }
}

async function categoryNews(category, env, errors, providers) {
  if (env.FINNHUB_API_KEY && FINNHUB_CATEGORIES.has(category)) {
    try {
      const rows = await finnhub('news', { category }, env, 180);
      if (!Array.isArray(rows)) throw new UpstreamError('provider_unavailable');
      providers.add('Finnhub');
      return rows.map(r => fromFinnhub(r, category)).filter(Boolean);
    } catch (e) { errors.push({ category, provider: 'Finnhub', code: e.code || 'provider_unavailable' }); }
  }
  const feed = RSS_CATEGORIES[category];
  if (!feed) {
    if (!errors.length) errors.push({ category, provider: 'Finnhub', code: 'provider_not_configured' });
    return [];
  }
  try {
    const rows = parseRSS(await getText('https://www.nasdaq.com/feed/rssoutbound?category=' + encodeURIComponent(feed)), category);
    providers.add('Nasdaq RSS');
    return rows;
  } catch (e) { errors.push({ category, provider: 'Nasdaq RSS', code: e.code || 'provider_unavailable' }); return []; }
}

export async function feed(url, env) {
  const scope = url.searchParams.get('scope') || 'market';
  if (!['market', 'symbol', 'theme', 'watchlist'].includes(scope)) throw new UpstreamError('invalid_scope', 400);
  const category = url.searchParams.get('category') || 'general';
  if (!CATEGORIES.includes(category)) throw new UpstreamError('invalid_category', 400);
  let symbols = [];
  const themeId=scope==='theme'?url.searchParams.get('theme'):null;
  const theme=themeId?THEMES_BY_ID[themeId]:null;
  if(themeId&&!theme)throw new UpstreamError('unknown_theme',404);
  if(theme)symbols=theme.constituents.map(c=>c.symbol);
  else if (scope !== 'market') {
    const raw = [url.searchParams.get('symbol'), url.searchParams.get('symbols')].filter(Boolean).join(',');
    symbols = [...new Set(raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean))];
    if (!symbols.length || symbols.some(s => !SYMBOL.test(s) || s.startsWith('^'))) throw new UpstreamError('invalid_symbol', 400);
    symbols = symbols.slice(0, MAX_SYMBOLS);
  }
  const errors = [], providers = new Set();
  const lists=[];
  if(scope==='market'||theme?.kind==='crypto')lists.push(await categoryNews(theme?.kind==='crypto'?'crypto':category,env,errors,providers));
  else {
    for(let i=0;i<symbols.length;i+=4)lists.push(...await Promise.all(symbols.slice(i,i+4).map(s=>symbolNews(s,env,errors,providers))));
  }
  const seen = new Set(), now = Date.now();
  const items = lists.flat()
    .filter(x => x && Date.parse(x.date) <= now + 5 * 60000 && !seen.has(x.url) && seen.add(x.url))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ITEMS)
    .map(x => ({ ...x, prediction: prediction(x.title) }));
  if (!items.length && errors.length && errors.length >= (scope === 'market'||theme?.kind==='crypto' ? 1 : symbols.length)) {
    const code = errors.find(e => e.code !== 'provider_not_configured')?.code || errors[0].code;
    throw new UpstreamError(code, code === 'rate_limited' ? 429 : code === 'provider_not_configured' ? 503 : 502);
  }
  return {
    scope, theme:themeId, theme_name:theme?.name||null, category: scope === 'market' ? category : null, symbols, items, errors,
    providers: [...providers], as_of: new Date().toISOString(),
    note: 'Prediction badges are headline keyword scenarios (the same rules as the briefing), unreviewed and not forecasts.'
  };
}

export async function handle(request, env, ctx, url, rest) {
  if (rest === 'feed') return json(await feed(url, env), 200, 60);
  return json({ error: 'Unknown news route.' }, 404);
}

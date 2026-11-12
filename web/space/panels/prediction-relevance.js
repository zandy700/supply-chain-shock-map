// Editorial stock-relevance rules, not a forecast of price impact.
export const STOCK_TOPICS = [
  { id: 'companies', label: 'Companies', reason: 'Company performance or leadership' },
  { id: 'technology', label: 'AI & chips', reason: 'Technology and semiconductor exposure' },
  { id: 'economy', label: 'Economy & Fed', reason: 'Rates, growth or market conditions' },
  { id: 'policy', label: 'Policy & trade', reason: 'Policy, regulation or trade exposure' },
  { id: 'energy', label: 'Energy', reason: 'Energy or commodity supply' },
  { id: 'healthcare', label: 'Healthcare', reason: 'Drug approvals or healthcare policy' },
  { id: 'geopolitics', label: 'Geopolitics', reason: 'Geopolitical market risk' }
];
// Public Polymarket taxonomy IDs verified against /tags/slug on 2026-11-12.
export const STOCK_SOURCES = [
  ['stocks', '604', 'Stocks'], ['business', '107', 'Business'], ['earnings', '1013', 'Earnings'],
  ['finance', '120', 'Finance'], ['economy', '100328', 'Economy'], ['fed', '159', 'Fed'],
  ['inflation', '702', 'Inflation'], ['cpi', '101701', 'CPI'], ['gdp', '370', 'GDP'],
  ['recession', '100201', 'Recession'], ['tariffs', '101758', 'Tariffs'], ['ipo', '102599', 'IPO'],
  ['tech', '1401', 'Technology'], ['ai', '439', 'AI'], ['trade', '311', 'Trade'],
  ['energy', '404', 'Energy'], ['healthcare', '101422', 'Healthcare'], ['geopolitics', '100265', 'Geopolitics']
].map(([id, tagId, label]) => ({ id, tagId, label }));
const COMPANY = /\b(?:nvidia|jensen huang|tesla|elon musk|apple|tim cook|microsoft|satya nadella|amazon|andy jassy|alphabet|google|sundar pichai|meta|zuckerberg|amd|lisa su|intel|broadcom|tsmc|asml|openai|anthropic|spacex|palantir|oracle|netflix|disney|nike|boeing|jpmorgan|jamie dimon|goldman sachs|coinbase|robinhood|draftkings|uber|berkshire|walmart|exxon|chevron)\b/i;
const FINANCIAL = /\b(?:earnings|revenue|profit|stock price|share price|market cap|ipo|acquisition|acquire|merger|bankrupt|buyout|dividend|antitrust|ceo|chief executive|resign|resignation|removal|fired|layoffs|deliveries)\b/i;
const SPORT = /\b(?:basketball|nba|wnba|nfl|nhl|mlb|ncaa|fifa|uefa|tennis|soccer|football|baseball|cricket|golf|hockey|olympics?|super bowl|world cup|stanley cup|champions league|grand slam|esports?|dota|valorant|league of legends|counter.strike|touchdowns?|rebounds?|playoffs?|championship|tournament)\b|\bvs\.?\s/i;
const PERSONAL = /\b(?:divorce|married|marriage|wedding|dating|girlfriend|boyfriend|romance|album|grammys?|oscars?|box office|movie|reality show|celebrity|eurovision|miss universe|mascot)\b/i;
const TRIVIA = /\b(?:tweet|tweets|post the word|say the word|mention the word|wear|eat|smoke|public appearance|be photographed)\b/i;
const CRYPTO_PROP = /\b(?:bitcoin|ethereum|solana|btc|eth|xrp|dogecoin)\b.*\b(?:up or down|price|above|below|reach|hit|all.time high)\b/i;
const PATTERNS = {
  companies: FINANCIAL,
  technology: /\b(?:artificial intelligence|ai model|ai bubble|semiconductor|chips?|data cent(?:er|re)|nvidia|jensen huang|openai|anthropic|gpt[- ]?\d|deepseek|agi|tsmc|asml|cuda)\b/i,
  economy: /\b(?:federal reserve|fed|fomc|interest rates?|rate cuts?|rate hikes?|inflation|cpi|pce|gdp|recession|unemployment|payrolls?|treasury|bond yields?|s&p|nasdaq|dow jones|stock market|housing|mortgage|bank failure|banking crisis|debt ceiling)\b/i,
  policy: /\b(?:tariffs?|sanctions?|export (?:ban|control|restriction)|antitrust|sec approval|corporate tax|regulat(?:ion|or|ory)|government shutdown|stimulus|trade (?:deal|war)|presidential|senate|congress|midterms?|house majority|white house|trump)\b/i,
  energy: /\b(?:energy|crude|brent|wti|oil|opec|natural gas|lng|uranium|nuclear (?:power|energy|reactor)|power grid|electricity|copper|gold price|silver price|rare earth)\b/i,
  healthcare: /\b(?:fda|drug approval|clinical trial|medicare|medicaid|drug pricing|pfizer|eli lilly|novo nordisk|moderna|astrazeneca|vaccine approval)\b/i,
  geopolitics: /\b(?:war|ceasefire|invasion|blockade|strait of hormuz|nato|military strike|nuclear (?:weapon|test))\b/i
};
export function stockTopicsFor(event, market) {
  const title = [event?.title, event?.subtitle, market?.question, market?.subtitle].filter(v => typeof v === 'string').join(' ');
  const tags = [event?.category, ...(event?.tags || [])].filter(v => typeof v === 'string').join(' ');
  const specific = market?.question || market?.subtitle || event?.title || '';
  const corporate = COMPANY.test(specific) && FINANCIAL.test(specific);
  if ((SPORT.test(title) || /\b(?:sports|games|esports)\b/i.test(tags)) && !corporate) return [];
  if ((PERSONAL.test(title) || TRIVIA.test(title)) && !corporate) return [];
  if (CRYPTO_PROP.test(title) && !/\b(?:etf|stock|shares|coinbase|microstrategy|strategy inc)\b/i.test(title)) return [];
  if (/\b(?:weather|temperature|rainfall|snowfall)\b/i.test(tags + ' ' + title) && !PATTERNS.energy.test(title)) return [];
  const ids = STOCK_TOPICS.filter(t => PATTERNS[t.id].test(title)).map(t => t.id);
  if (COMPANY.test(title) && !ids.includes('companies')) ids.unshift('companies');
  if (!ids.length && /\b(?:stocks|earnings|business|finance|economy|economics|fed|technology|artificial intelligence|energy|trade)\b/i.test(tags)) {
    ids.push(/\b(?:econom|fed)\b/i.test(tags) ? 'economy' : /tech|artificial intelligence/i.test(tags) ? 'technology' : /energy/i.test(tags) ? 'energy' : /geopolitics/i.test(tags) ? 'geopolitics' : /trade/i.test(tags) ? 'policy' : 'companies');
  }
  return ids;
}
export function stockEvent(event) {
  if (!event || !Array.isArray(event.markets)) return null;
  const markets = event.markets.map(m => ({ ...m, stockTopics: stockTopicsFor(event, m) })).filter(m => m.stockTopics.length);
  if (!markets.length) return null;
  const stockTopics = [...new Set(markets.flatMap(m => m.stockTopics))];
  const removed = event.markets.length - markets.length;
  return { ...event, markets, stockTopics, stockRelevance: STOCK_TOPICS.find(t => t.id === stockTopics[0])?.reason,
    marketCount: Math.max(markets.length, (event.marketCount || event.markets.length) - removed),
    excludedMarkets: (event.excludedMarkets || 0) + removed };
}
export function rankStockEvents(events) {
  return [...events].sort((a, b) => (b.volume24h ?? -1) - (a.volume24h ?? -1) || String(a.id).localeCompare(String(b.id)));
}

// These keys identify overlapping event coverage, never fungible contracts or prices.
// Unknown wording stays separate rather than guessing from a shared company name.
export function relatedEventKey(event) {
  const title = String(event?.title || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const context = title + ' ' + String(event?.subtitle || '').toLowerCase();
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const month = context.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  const namedYear = context.match(/\b(20\d{2})\b/)?.[1];
  const close = event?.closeTime ? new Date(event.closeTime) : null;
  const year = namedYear || (month && close && Number.isFinite(+close) && months[close.getUTCMonth()] === month[1].slice(0,3) ? String(close.getUTCFullYear()) : null);
  const period = month && year ? year + '-' + month[1].slice(0,3) : null;
  if (period && /^(?:fed|federal reserve) (?:rate )?decision\b/.test(title)) return 'fed-decision:' + period;
  if (period && /^(?:(?:us|u s|united states) )?(?:core )?cpi(?: yoy)? (?:in )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(title)) {
    return 'us-cpi:' + (/\bcore\b/.test(title) ? 'core:' : 'headline:') + (/\byoy\b/.test(title) ? 'annual:' : 'monthly:') + period;
  }
  const company = title.match(/\b(anthropic|openai|spacex)\b/)?.[1];
  if (company && /\bipo\b/.test(title) && !/\b(valuation|cap|closing|price|shares|sector)\b/.test(title)) return 'ipo-timing:' + company;
  // Exact titles also need the same explicit period, including the day when given.
  const day = context.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:\b|,)/)?.[1];
  return title && period ? 'title:' + title + ':' + period + (day ? ':' + day : '') : null;
}
// Polymarket owns shared coverage; Kalshi supplements gaps in the loaded pages.
// Recompute after every refresh/page load so a later Polymarket match takes priority.
export function supplementStockEvents(events) {
  const covered = new Set(events.filter(e => e.provider === 'polymarket').map(relatedEventKey).filter(Boolean));
  return events.filter(event => event.provider !== 'kalshi' || !covered.has(relatedEventKey(event)));
}

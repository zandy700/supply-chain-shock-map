import { mapSymbolBatches } from './watchlist-data.js';
const unique = values => [...new Set(values)];
const oldest = values => values.filter(Boolean).sort()[0] || null;

export async function loadNewsBatches(api, symbols, { signal, scope = 'watchlist' } = {}) {
  const result = await mapSymbolBatches(symbols, async batch => {
    const page = await api('news/feed', { scope, symbols: batch.join(',') }, { signal });
    if (!Array.isArray(page?.items)) throw new Error('invalid_news_response');
    return page;
  }, { signal });
  if (!result.results.length) throw new Error('News could not be refreshed. Previous headlines are retained.');
  const articles = new Map();
  for (const page of result.results) for (const item of page.items) {
    const key = item.url || item.id;
    if (!key) continue;
    const prior = articles.get(key);
    articles.set(key, prior ? { ...prior, symbols: unique([...(prior.symbols || []), ...(item.symbols || [])]) } : item);
  }
  return { ...result.results[0], symbols: unique(symbols),
    items: [...articles.values()].sort((a,b) => String(b.date || '').localeCompare(String(a.date || ''))),
    providers: unique(result.results.flatMap(p => p.providers || [])),
    errors: [...result.results.flatMap(p => p.errors || []), ...result.failedSymbols.map(symbol => ({ symbol, code: 'request_failed' }))],
    as_of: oldest(result.results.map(p => p.as_of)),
    partial: result.failedSymbols.length > 0 || result.results.some(p => p.errors?.length),
    failedSymbols: result.failedSymbols
  };
}

export async function loadOptionScanBatches(api, symbols, params, { signal, limit = 150 } = {}) {
  const eligible = unique(symbols).filter(s => /^[A-Z]{1,5}(?:[.-][A-Z])?$/.test(s));
  const unsupported = unique(symbols).filter(s => !eligible.includes(s));
  const result = await mapSymbolBatches(eligible, async batch => {
    const page = await api('options/unusual', { ...params, symbols: batch.join(','), limit }, { signal });
    if (!Array.isArray(page?.contracts)) throw new Error('invalid_scan_response');
    return page;
  }, { signal });
  if (!result.results.length) throw new Error(eligible.length ? 'The options scan could not be refreshed. Try again shortly.' : 'This scan supports US stock and ETF tickers only.');
  const pages = result.results, providers = [...new Map(pages.flatMap(p => p.providers || []).map(p => [p.symbol, p])).values()];
  const key = params.sort === 'premium' ? 'premium' : params.sort === 'ratio' ? 'volOI' : 'vol';
  const contracts = [...new Map(pages.flatMap(p => p.contracts).map(c => [c.id || [c.symbol,c.expiry,c.strike,c.side].join(':'), c])).values()]
    .sort((a,b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity) || (params.sort === 'ratio' ? (b.vol ?? 0) - (a.vol ?? 0) : 0) || String(a.symbol).localeCompare(String(b.symbol))).slice(0, limit);
  const unavailable = unique([...unsupported, ...result.failedSymbols, ...pages.flatMap(p => p.unavailable || [])]);
  return { ...pages[0], symbols: unique(symbols), contracts,
    total: pages.reduce((n,p) => n + (p.total ?? p.contracts.length), 0), unavailable, providers,
    source: unique(pages.map(p => p.source).filter(Boolean)).join(' / '),
    provider: unique(pages.map(p=>p.provider)).length > 1 ? 'mixed-by-symbol' : pages[0].provider,
    feed: unique(pages.map(p=>p.feed)).length > 1 ? 'mixed-by-symbol' : pages[0].feed,
    indicative: pages.every(p=>p.indicative), fetchedAt: oldest(pages.map(p=>p.fetchedAt)),
    coverage: { partial: unavailable.length > 0 || pages.some(p=>p.coverage?.partial) },
    unavailableMetrics: providers.length && providers.every(p => p.unavailableMetrics?.includes('volume') && p.unavailableMetrics?.includes('openInterest')) ? ['volume','openInterest'] : [],
    notices: unique([...pages.flatMap(p=>p.notices || []), ...(result.failedSymbols.length ? ['Some requested symbols could not be scanned; available results are retained.'] : []), ...(unsupported.length ? ['Unsupported instruments are listed as unavailable; they remain on your watchlist.'] : [])])
  };
}

// Shared bounded client-side batching; server endpoints retain their existing limits.
export async function mapSymbolBatches(symbols, load, { batchSize = 12, concurrency = 2, signal } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 12 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error('Use batches of 1–12 symbols and at most two concurrent requests.');
  const values = [...new Set(symbols)], batches = [];
  for (let i = 0; i < values.length; i += batchSize) batches.push(values.slice(i, i + batchSize));
  const results = new Array(batches.length), failures = new Array(batches.length); let next = 0;
  const aborted = () => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
  aborted();
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
    while (next < batches.length) {
      aborted(); const index = next++, batch = batches[index];
      try { results[index] = await load(batch, { signal }); aborted(); }
      catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw new DOMException('Aborted', 'AbortError');
        failures[index] = { symbols: batch, code: 'request_failed' };
      }
    }
  }));
  aborted();
  const errors = failures.filter(Boolean);
  return { results: results.filter((_, i) => !failures[i]), failedSymbols: errors.flatMap(e => e.symbols), errors };
}

const unique = (rows, key) => [...new Map(rows.map(row => [key(row), row])).values()];
export function mergeBriefings(result, previous) {
  if (!result.results.length) throw new Error('Live data could not be refreshed. Existing data is retained.');
  const pages = result.results, first = pages[0];
  const all = key => pages.flatMap(page => page[key] || []);
  const failed = new Set([...result.failedSymbols, ...all('unresolved'), ...all('errors').map(error => error.ticker || error.input)]);
  const retained = key => (previous?.[key] || []).filter(row => failed.has(row.ticker) || row.affected?.some(symbol => failed.has(symbol)));
  const staleSymbols = [...new Set([...retained('quotes'), ...retained('news'), ...retained('impacts')].flatMap(row => row.ticker ? [row.ticker] : row.affected || []).filter(symbol => failed.has(symbol)))];
  return { ...first,
    as_of: [...pages.map(page => page.as_of), ...(staleSymbols.length ? [previous?.as_of] : [])].filter(Boolean).sort()[0] || null,
    tickers: [...new Set([...all('tickers'), ...staleSymbols])], companies: unique([...retained('companies'), ...all('companies')], row => row.ticker),
    unresolved: [...new Set([...all('unresolved'), ...result.failedSymbols])],
    errors: [...all('errors'), ...result.failedSymbols.map(input => ({ input, code: 'request_failed' }))],
    suggestions: Object.assign({}, ...pages.map(page => page.suggestions || {})),
    impacts: unique([...retained('impacts'), ...all('impacts')], row => row.id || row.url).sort((a,b) => b.date.localeCompare(a.date)),
    news: unique([...retained('news'), ...all('news')], row => row.id || row.url).sort((a,b) => b.date.localeCompare(a.date)),
    quotes: unique([...retained('quotes'), ...all('quotes')], row => row.ticker),
    staleSymbols,
    hasFreshData: all('quotes').length > 0 || all('news').length > 0,
    notice: [...new Set(pages.map(page => page.notice).filter(Boolean))].join(' '),
    partial: result.failedSymbols.length > 0 || pages.some(page => page.errors?.length || page.unresolved?.length)
  };
}
export function mergeCalendars(result, previous) {
  if (!result.results.length) throw new Error('Calendar data could not be refreshed. Existing events are retained.');
  const pages = result.results, events = new Map();
  const failed = new Set([...result.failedSymbols, ...pages.flatMap(page => [...(page.unavailable || []), ...(page.peerErrors || [])])]);
  const retained = (previous?.events || []).filter(event => failed.has(event.ticker) || event.connections?.some(link => failed.has(link.holding)));
  for (const page of [{events:retained}, ...pages]) for (const event of page.events || []) {
    const key = [event.date,event.ticker || '',event.title,event.source].join('|'), previous = events.get(key);
    if (!previous) events.set(key, { ...event });
    else {
      previous.scope = previous.scope === 'watchlist' || event.scope === 'watchlist' ? 'watchlist' : previous.scope;
      previous.connections = unique([...(previous.connections || []), ...(event.connections || [])], row => JSON.stringify(row));
    }
  }
  return { ...pages[0], events: [...events.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)),
    staleSymbols: [...new Set(retained.flatMap(event => [event.ticker, ...(event.connections || []).map(link => link.holding)]).filter(symbol => failed.has(symbol)))],
    unavailable: [...new Set([...pages.flatMap(p=>p.unavailable || []), ...result.failedSymbols])],
    unlisted: [...new Set(pages.flatMap(p=>p.unlisted || []))], peerErrors: [...new Set(pages.flatMap(p=>p.peerErrors || []))] };
}

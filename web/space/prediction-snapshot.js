// Public saved events only. No provider keys, private account data or Worker required.
export const SNAPSHOT_URL = 'https://raw.githubusercontent.com/zandy700/supply-chain-shock-map/main/web/prediction-data/latest.json';
const LOCAL_URL = '/prediction-data/latest.json';
const valid = data => data?.schemaVersion === 1 && Number.isFinite(Date.parse(data.generatedAt)) && data.providers && typeof data.providers === 'object';
export function snapshotPage(snapshot, params = {}, { now = Date.now(), remoteAvailable = true, recheckFailed = false } = {}) {
  if (!valid(snapshot)) throw new Error('Saved event data is invalid. Download a fresh pack.');
  const provider = params.provider || 'polymarket';
  if (!['polymarket', 'kalshi'].includes(provider)) throw new Error('Select one saved venue.');
  if ((params.status && params.status !== 'open') || (params.kind && params.kind !== 'standard')) throw new Error('The saved pack covers open standard events. Run the local Worker for closed catalogs or combos.');
  const saved = snapshot.providers[provider];
  if (!saved || !Array.isArray(saved.events) || !saved.source?.fetchedAt) throw new Error('No saved ' + provider + ' events are available. Retry sync or run the local Worker.');
  const query = String(params.q || '').trim().toLowerCase();
  const terms = query.split(/\s+/).filter(Boolean);
  const events = saved.events.filter(e => !query || terms.every(term => [e.title, e.subtitle, ...(e.tags || []), ...(e.markets || []).flatMap(m => [m.question, m.subtitle])].join(' ').toLowerCase().includes(term)));
  let offset = 0;
  if (params.cursor) {
    const match = /^saved:(polymarket|kalshi):(\d+)$/.exec(params.cursor);
    if (!match || match[1] !== provider || !Number.isSafeInteger(+match[2]) || +match[2] > 100000) throw new Error('This saved page changed. Use Discover to start again.');
    offset = +match[2];
  }
  const page = events.slice(offset, offset + 20), hasMore = offset + page.length < events.length;
  const stale = now - Date.parse(saved.source.fetchedAt) > 45 * 60000;
  const retained = snapshot.sync?.[provider]?.status === 'retained';
  return { events: page, fetchedAt: snapshot.generatedAt, sources: [{ ...saved.source, provider, status: 'ok', delivery: 'github-snapshot',
    snapshotAsOf: saved.source.fetchedAt, snapshotStale: stale, remoteAvailable, partial: !!saved.source.partial || retained || recheckFailed,
    hasMore, nextCursor: hasMore ? 'saved:' + provider + ':' + (offset + page.length) : null,
    returnedEvents: page.length, returnedMarkets: page.reduce((n,e) => n + (e.markets?.length || 0), 0),
    pageScope: query ? 'Search within saved events' : 'Saved stock-relevant events' }], notices: [
    'Saved GitHub event snapshot from ' + saved.source.fetchedAt + '. Scheduled sync: every 15 minutes; GitHub runs and delivery can be delayed. This is not live quote streaming.',
    'New events are rediscovered on each sync. Saved coverage is bounded and paginated; search covers only saved events. Polymarket takes priority for recognized overlaps in the combined feed.',
    ...(query ? ['Search is limited to the saved event pack, not the full Polymarket search service.'] : []),
    ...(saved.upstreamHasMore ? ['Additional events exist at the venue beyond this saved selection.'] : []),
    ...(stale ? ['This provider snapshot is over 45 minutes old. Check the GitHub sync run or run the local Worker for fresher data.'] : []),
    ...(retained ? ['The last sync could not fully refresh this venue. Its previous successful snapshot is retained.'] : []),
    ...(!remoteAvailable ? ['GitHub could not be reached. Showing the newest bundled or previously loaded snapshot.'] : []),
    ...(recheckFailed ? ['Snapshot recheck failed. Previous saved data is retained; retrying automatically.'] : [])
  ] };
}
export function createSnapshotReader({ fetcher = globalThis.fetch, now = () => Date.now() } = {}) {
  let cached = null, until = 0, pending = null;
  async function read(url) {
    const response = await fetcher(url, { cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Snapshot unavailable');
    const text = await response.text();
    if (text.length > 16 * 1024 * 1024) throw new Error('Snapshot too large');
    const data = JSON.parse(text); if (!valid(data)) throw new Error('Invalid snapshot');
    return data;
  }
  async function load() {
    const results = await Promise.allSettled([read(SNAPSHOT_URL + '?minute=' + Math.floor(now() / 60000)), read(LOCAL_URL)]);
    const available = results.filter(r => r.status === 'fulfilled').map(r => r.value).sort((a,b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt));
    if (!available.length) {
      if (!cached) throw new Error('No saved events are available. Connect to GitHub or download a fresh local pack.');
      cached = { ...cached, remoteAvailable: false, recheckFailed: true };
    } else cached = { snapshot: available[0], remoteAvailable: results[0].status === 'fulfilled', recheckFailed: false };
    until = now() + 60000; return cached;
  }
  return async function request(params, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!cached || now() >= until) {
      if (!pending) pending = load().finally(() => { pending = null; });
      await pending;
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return snapshotPage(cached.snapshot, params, { now: now(), remoteAvailable: cached.remoteAvailable, recheckFailed: cached.recheckFailed });
  };
}

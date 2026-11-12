// GitHub Actions and local CLI share the exact public Worker normalizers/discovery.
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { handle, resetPredictionMarketCacheForTests } from '../worker/space/prediction-markets.js';
import { rankStockEvents } from '../web/space/panels/prediction-relevance.js';
const diagnostics = body => (body.coverage || []).filter(c=>c.status === 'error').map(c=>({id:c.id,error:c.error}));
export async function collectSnapshot({ previous = null, pageLimit = 3, getPage, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = () => new Date().toISOString() } = {}) {
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 5) throw new Error('Discovery page limit must be 1–5.');
  const providers = {}, sync = {}, generatedAt = now();
  const request = getPage || (async (provider, cursor) => {
    const url = new URL('https://local.invalid/api/space/prediction-markets/stock-events');
    url.searchParams.set('provider', provider); if (cursor) url.searchParams.set('cursor', cursor);
    const response = await handle(new Request(url), { predictionSync: true }, {}, url, 'stock-events');
    const body = await response.json();
    if (!response.ok) { const error = new Error('Public venue unavailable'); error.reason = 'provider_unavailable'; error.issues = diagnostics(body); throw error; }
    return body;
  });
  async function requestWithCooldown(provider, cursor) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = await request(provider, cursor);
        if (!attempt && diagnostics(body).some(c=>c.error === 'rate_limited')) { await pause(31000); continue; }
        return body;
      } catch (error) {
        if (!attempt && error.issues?.some(c=>c.error === 'rate_limited')) { await pause(31000); continue; }
        throw error;
      }
    }
  }
  let successes = 0;
  for (const provider of ['polymarket', 'kalshi']) {
    const events = new Map(); let cursor = null, source = null, partial = false, pages = 0, issues = [];
    try {
      for (; pages < pageLimit; pages++) {
        const body = await requestWithCooldown(provider, cursor);
        source = body.sources?.find(s => s.provider === provider);
        if (source?.status !== 'ok' || !Array.isArray(body.events)) throw new Error('Invalid venue page');
        partial ||= !!source.partial; issues.push(...diagnostics(body));
        for (const event of body.events) if (event.provider === provider) events.set(event.id, event);
        cursor = source.hasMore ? source.nextCursor : null;
        if (!cursor) { pages++; break; }
      }
      if (partial && previous?.providers?.[provider]) { const error = new Error('Discovery incomplete'); error.reason = 'partial_discovery'; error.issues = issues; throw error; }
      providers[provider] = { events: rankStockEvents([...events.values()]), source: { provider, status: 'ok', partial, fetchedAt: source.fetchedAt || generatedAt },
        discoveryPages: pages, upstreamHasMore: !!cursor };
      sync[provider] = { status: partial ? 'partial' : 'ok', attemptedAt: generatedAt }; successes++;
    } catch (error) {
      const detail = { reason: error.reason === 'partial_discovery' ? 'partial_discovery' : 'provider_unavailable', issues: error.issues || issues };
      if (previous?.providers?.[provider]) {
        providers[provider] = previous.providers[provider]; sync[provider] = { status: 'retained', attemptedAt: generatedAt, ...detail };
      } else sync[provider] = { status: 'error', attemptedAt: generatedAt, ...detail };
    }
  }
  if (!Object.keys(providers).length) throw new Error('No event snapshot available; existing file left untouched.');
  return { schemaVersion: 1, generatedAt, refreshMinutes: 15, providers, sync, successfulProviders: successes };
}
export async function syncFile(file = resolve('web/prediction-data/latest.json'), options = {}) {
  let previous = null;
  try { previous = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  resetPredictionMarketCacheForTests();
  const snapshot = await collectSnapshot({ previous, ...options });
  await mkdir(dirname(file), { recursive: true });
  const encoded = JSON.stringify(snapshot) + '\n';
  if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error('Snapshot exceeds the pack budget; existing file left untouched.');
  await writeFile(file + '.tmp', encoded); await rename(file + '.tmp', file);
  return snapshot;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const data = await syncFile();
    console.log(JSON.stringify({ generatedAt: data.generatedAt, providers: Object.fromEntries(Object.entries(data.providers).map(([p,v]) => [p, { events: v.events.length, contracts: v.events.reduce((n,e) => n + e.markets.length, 0), sync: data.sync[p] }])) }));
    if (!data.successfulProviders) { console.error('All providers failed; retained last successful events.'); process.exitCode = 1; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

// Routes /api/space/<domain>/<rest> to worker/space/<domain>.js, each exporting
// `handle(request, env, ctx, url, rest)` -> Response. Domains are owned per docs/space-contract.md.
import { json, fail } from './upstream.js';
import * as chart from './chart.js';
import * as company from './company.js';
import * as markets from './markets.js';
import * as news from './news.js';
import * as earnings from './earnings.js';
import * as options from './options.js';
import * as scout from './scout.js';
import * as predictionMarkets from './prediction-markets.js';

const domains = { chart, company, markets, news, earnings, options, scout, 'prediction-markets': predictionMarkets };

export async function spaceRoute(request, env, ctx) {
  const url = new URL(request.url);
  const [domain, ...rest] = url.pathname.replace(/^\/api\/space\/?/, '').split('/');
  const mod = domains[domain];
  if (!mod?.handle) return json({ error: 'Unknown Space route.' }, 404);
  if (request.method !== 'GET' && !(mod.allowPost && request.method === 'POST')) return json({ error: 'Method not allowed.' }, 405);
  try { return await mod.handle(request, env, ctx, url, rest.join('/')); }
  catch (error) { return fail(error); }
}

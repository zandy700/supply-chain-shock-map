import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, normalizeKalshiEvent, normalizePolymarketEvent, resetPredictionMarketCacheForTests } from './prediction-markets.js';
import { fail } from './upstream.js';

const kalshiMarket = (extra = {}) => ({ ticker: 'KXTEST-26-YES', title: 'Will this happen?', status: 'active', yes_ask_dollars: '0.4200', yes_bid_dollars: '0.4000', no_ask_dollars: '0.6000', no_bid_dollars: '0.5800', last_price_dollars: '0.4100', volume_fp: '123.50', volume_24h_fp: '10.25', open_interest_fp: '77.50', close_time: '2026-12-31T20:00:00Z', updated_time: '2026-11-11T12:00:00Z', rules_primary: 'Resolves Yes if the stated condition happens.', ...extra });
const kalshiEvent = (extra = {}) => ({ event_ticker: 'KXTEST-26', series_ticker: 'KXTEST', title: 'Public event', sub_title: 'Fiscal year', category: 'Economics', markets: [kalshiMarket()], ...extra });
const polyEvent = (extra = {}) => ({ id: '100', slug: 'public-event', title: 'Polymarket public event', volume24hr: 100.25, updatedAt: '2026-11-11T12:00:00Z', tags: [{ label: 'Finance' }], markets: [{ id: '101', slug: 'yes-condition', question: 'Will the condition happen?', active: true, closed: false, outcomes: '["Yes","No"]', outcomePrices: '["0.4","0.6"]', bestBid: 0.39, bestAsk: 0.41, volumeNum: 200, volume24hr: 40, description: 'Rule text.' }], ...extra });
async function get(query = '') {
  const url = new URL('https://pulse.test/api/space/prediction-markets/catalog' + (query ? '?' + query : ''));
  try { return await handle(new Request(url), {}, {}, url, 'catalog'); } catch (e) { return fail(e); }
}
function stub(fn) {
  resetPredictionMarketCacheForTests();
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (href, options) => {
    const u = new URL(href); calls.push(u);
    assert.ok(['external-api.kalshi.com', 'gamma-api.polymarket.com'].includes(u.hostname));
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent']);
    return fn(u, options);
  };
  return { calls, restore() { globalThis.fetch = original; resetPredictionMarketCacheForTests(); } };
}

test('Kalshi fixed-point dollar prices and fractional contract counts stay distinct from USD turnover', () => {
  const event = normalizeKalshiEvent(kalshiEvent({ markets: [kalshiMarket(), kalshiMarket({ ticker: 'KXTEST-26-NO', status: 'finalized', volume_24h_fp: '1.25' })] }));
  assert.equal(event.markets.length, 2); assert.equal(event.markets[1].status, 'settled');
  assert.equal(event.volume24h, 11.5); assert.equal(event.volumeUnit, 'contracts');
  const m = event.markets[0]; assert.deepEqual(m.outcomes.map(o => [o.price, o.bid, o.ask]), [[0.42, 0.4, 0.42], [0.6, 0.58, 0.6]]);
  assert.equal(m.lastPrice, 0.41); assert.equal(m.volume, 123.5); assert.equal(m.openInterest, 77.5);
  assert.equal(event.url, 'https://kalshi.com/markets/kxtest');
  assert.equal(m.dataUrl, 'https://external-api.kalshi.com/trade-api/v2/markets/KXTEST-26-YES');
});

test('missing prices never become zero; untraded Kalshi placeholders are unquoted while valid zero trades remain zero', () => {
  const empty = normalizeKalshiEvent(kalshiEvent({ markets: [kalshiMarket({ yes_ask_dollars: '0.0000', no_ask_dollars: '0.0000', last_price_dollars: '0.0000', volume_fp: '0.00', volume_24h_fp: ' ' })] })).markets[0];
  assert.equal(empty.lastPrice, null); assert.equal(empty.outcomes[0].price, null); assert.equal(empty.outcomes[1].price, null); assert.equal(empty.volume24h, null);
  const traded = normalizeKalshiEvent(kalshiEvent({ markets: [kalshiMarket({ last_price_dollars: '0', volume_fp: '3' })] })).markets[0];
  assert.equal(traded.lastPrice, 0);
  const legacy = normalizeKalshiEvent(kalshiEvent({ markets: [{ ticker: 'LEGACY', status: 'active', yes_ask: 35, no_ask: 67, volume: 1 }] })).markets[0];
  assert.equal(legacy.outcomes[0].price, 0.35); assert.equal(legacy.outcomes[1].price, 0.67);
});

test('closed Kalshi markets never advertise stale asks; settled results are explicit settlement prices', () => {
  const event = normalizeKalshiEvent(kalshiEvent({ markets: [kalshiMarket({ status: 'closed' }), kalshiMarket({ ticker: 'SETTLED', status: 'finalized', result: 'no' })] }));
  assert.equal(event.markets[0].outcomes[0].price, null);
  assert.equal(event.markets[0].outcomes[0].ask, null);
  assert.equal(event.markets[0].outcomes[0].priceKind, 'unavailable');
  assert.deepEqual(event.markets[1].outcomes.map(o => [o.price,o.priceKind]), [[0,'settlement'],[1,'settlement']]);
});

test('Polymarket reordered outcome labels do not attach a first-token book quote to Yes, and identical slugs do not duplicate paths', () => {
  const event = normalizePolymarketEvent(polyEvent({ slug: 'same-event', markets: [{ id: '1', slug: 'same-event', outcomes: ['No','Yes'], outcomePrices: [0.2,0.8], bestBid: 0.19, bestAsk: 0.21 }] }));
  assert.deepEqual(event.markets[0].outcomes.map(o => o.bid), [null,null]);
  assert.equal(event.markets[0].url, 'https://polymarket.com/event/same-event');
});

test('Polymarket keeps every outcome and zero snapshot, parses JSON/array shapes, and rejects unsafe slug construction', () => {
  const event = normalizePolymarketEvent(polyEvent({ slug: '../evil', markets: [
    { id: '1', question: 'Winner?', outcomes: '["Alpha","Beta","Gamma"]', outcomePrices: '["0","0.3","0.7"]', active: true, volume: '10.5' },
    { id: '2', question: 'Binary?', outcomes: ['Yes','No'], outcomePrices: [null,'N/A'], active: false, closed: true, description: 'x'.repeat(40001) }
  ] }));
  assert.equal(event.marketCount, 2); assert.equal(event.partial, false); assert.equal(event.volumeUnit, 'USD');
  assert.deepEqual(event.markets[0].outcomes.map(o => o.price), [0,0.3,0.7]);
  assert.deepEqual(event.markets[1].outcomes.map(o => o.price), [null,null]);
  assert.equal(event.markets[1].status, 'closed'); assert.equal(event.markets[1].rulesTruncated, true);
  assert.equal(event.url, 'https://polymarket.com'); assert.equal(event.markets[0].url, 'https://polymarket.com');
  assert.equal(event.markets[0].outcomes[0].priceKind, 'snapshot');
});

test('all-provider page uses public event APIs, preserves all child lifecycle statuses and discloses independent pagination', async () => {
  const s = stub(u => u.hostname.includes('kalshi') ? Response.json({ events: [kalshiEvent()], cursor: 'next-kalshi' }) : Response.json([polyEvent()]));
  try {
    const res = await get('limit=1'); assert.equal(res.status, 200);
    const d = await res.json(); assert.equal(d.events.length, 2);
    assert.deepEqual(d.sources.map(v => v.provider), ['kalshi','polymarket']);
    assert.ok(d.sources.every(v => v.nextCursor && v.hasMore));
    assert.ok(d.notices.some(n => n.includes('not the entire catalog')));
    assert.equal(s.calls[0].searchParams.get('with_nested_markets'), 'true');
    assert.equal(s.calls[1].searchParams.get('closed'), 'false');
    assert.equal(s.calls[1].searchParams.get('active'), 'true');
    const cached = await (await get('limit=1')).json(); assert.equal(s.calls.length, 2);
    assert.equal(cached.sources[0].fetchedAt, d.sources[0].fetchedAt);
  } finally { s.restore(); }
});

test('provider-bound cursors continue exact pages and reject changed query/source context before any fetch', async () => {
  const s = stub(u => u.hostname.includes('kalshi') ? Response.json({ events: [kalshiEvent()], cursor: u.searchParams.has('cursor') ? '' : 'NEXT==Token' }) : Response.json([polyEvent()]));
  try {
    const first = await (await get('limit=1')).json();
    const k = first.sources[0].nextCursor, p = first.sources[1].nextCursor;
    const next = await (await get('provider=kalshi&limit=1&cursor=' + k)).json();
    assert.equal(s.calls.at(-1).searchParams.get('cursor'), 'NEXT==Token'); assert.equal(next.sources[0].hasMore, false);
    await get('provider=polymarket&limit=1&cursor=' + p); assert.equal(s.calls.at(-1).searchParams.get('offset'), '1');
    const n = s.calls.length;
    for (const query of [`provider=kalshi&limit=2&cursor=${k}`, `provider=polymarket&limit=1&cursor=${k}`, `provider=kalshi&limit=1&status=closed&cursor=${k}`, `provider=all&limit=1&cursor=${k}`, 'provider=kalshi&cursor=not-json']) assert.equal((await get(query)).status, 400);
    assert.equal(s.calls.length, n);
  } finally { s.restore(); }
});

test('Kalshi combos use native market/status filters and keep unique tickets from the same event on separate cards', async () => {
  const s = stub(u => {
    assert.equal(u.pathname, '/trade-api/v2/markets'); assert.equal(u.searchParams.get('status'), 'open'); assert.equal(u.searchParams.get('mve_filter'), 'only');
    return Response.json({ markets: [kalshiMarket({ event_ticker:'COMBO-EVENT', mve_selected_legs:[{ market_ticker:'LEG-A',event_ticker:'EVENT-A',side:'yes' }] }), kalshiMarket({ ticker:'SECOND-TICKET',event_ticker:'COMBO-EVENT' })], cursor: 'MORE' });
  });
  try {
    const d = await (await get('kind=combos')).json(); assert.equal(d.sources.length, 1); assert.equal(d.events.length, 2);
    assert.equal(d.events[0].markets.length, 1); assert.notEqual(d.events[0].id,d.events[1].id);
    assert.match(d.events[0].markets[0].rules,/YES LEG-A/); assert.equal(d.events[0].markets[0].legs[0].marketId,'LEG-A');
    assert.equal(d.sources[0].pageScope,'combo contracts');
    assert.equal((await get('kind=combos&provider=polymarket')).status, 400);
  } finally { s.restore(); }
});

test('one provider failing retains successful catalog; both failing returns an error, not a fabricated empty market list', async () => {
  let failBoth = false;
  const s = stub(u => failBoth || u.hostname.includes('kalshi') ? Response.json({ secret: 'untrusted provider body' }, { status: 503 }) : Response.json([polyEvent()]));
  try {
    let res = await get(); let d = await res.json(); assert.equal(res.status, 200); assert.equal(d.events.length, 1);
    assert.equal(d.sources[0].status, 'error'); assert.equal(d.sources[1].status, 'ok');
    resetPredictionMarketCacheForTests(); failBoth = true;
    res = await get(); d = await res.json(); assert.equal(res.status, 503); assert.equal(d.error, 'prediction_providers_unavailable');
    assert.ok(d.sources.every(s => s.status === 'error')); assert.ok(!JSON.stringify(d).includes('untrusted provider body'));
  } finally { s.restore(); }
});

test('closed event filters, malformed responses, rate-limit cooldown and invalid queries remain explicit', async () => {
  const s = stub(u => u.hostname.includes('kalshi') ? new Response('', { status: 429 }) : Response.json({ invalid: 'not an events array' }));
  try {
    for (const query of ['provider=evil','status=active','kind=other','limit=0','limit=31','limit=NaN','limit=2.5']) assert.equal((await get(query)).status, 400);
    assert.equal(s.calls.length, 0);
    let d = await (await get('status=closed')).json();
    assert.deepEqual(d.sources.map(s => s.error), ['rate_limited','invalid_provider_response']);
    assert.equal(s.calls[0].searchParams.get('status'), 'closed'); assert.equal(s.calls[1].searchParams.get('closed'), 'true');
    assert.equal(s.calls[1].searchParams.has('active'), false);
    await get('status=closed'); assert.equal(s.calls.filter(u => u.hostname.includes('kalshi')).length, 1);
  } finally { s.restore(); }
});

test('large nested events reduce page event count without losing children or breaking continuation offsets', async () => {
  let canceled = 0;
  const children = Array.from({ length: 450 }, (_, i) => ({ id: String(i + 1), question: 'Outcome ' + i, outcomes: ['Yes','No'], outcomePrices: ['0.1','0.9'], active: true }));
  const s = stub(u => Number(u.searchParams.get('limit')) > 1
    ? new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{}')); }, cancel() { canceled++; } }), { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } })
    : Response.json([polyEvent({ markets: children })]));
  try {
    const first = await (await get('provider=polymarket&limit=12')).json();
    assert.deepEqual(s.calls.map(u => u.searchParams.get('limit')), ['2','1']);
    assert.equal(canceled, 1); assert.equal(first.events[0].markets.length, 450);
    assert.equal(first.events[0].partial, false); assert.equal(first.sources[0].pageLimit, 1); assert.equal(first.sources[0].requestedLimit, 12);
    assert.ok(first.notices.some(n => n.includes('page size was reduced')));
    await get('provider=polymarket&limit=12&cursor=' + first.sources[0].nextCursor);
    assert.equal(s.calls.at(-1).searchParams.get('offset'), '1'); assert.equal(s.calls.at(-1).searchParams.get('limit'), '1');
  } finally { s.restore(); }
});

test('cache has a total payload budget instead of retaining every large public page', async () => {
  const description = 'x'.repeat(600000);
  const s = stub(u => Response.json([polyEvent({ id: String(Number(u.searchParams.get('offset')) + 100), description })]));
  try {
    let cursor = '';
    for (let i = 0; i < 4; i++) {
      const d = await (await get('provider=polymarket&limit=1' + (cursor ? '&cursor=' + cursor : ''))).json();
      cursor = d.sources[0].nextCursor;
    }
    assert.equal(s.calls.length, 4);
    await get('provider=polymarket&limit=1'); assert.equal(s.calls.length, 5);
  } finally { s.restore(); }
});

test('public-provider redirects are rejected without following an arbitrary Location', async () => {
  const s = stub(() => new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/private' } }));
  try {
    const res = await get('provider=kalshi'); const d = await res.json();
    assert.equal(res.status, 503); assert.equal(d.sources[0].error, 'provider_unavailable'); assert.equal(s.calls.length, 1);
  } finally { s.restore(); }
});

test('Polymarket event search queries the provider and preserves outcome prices and exact contract wording', async () => {
  const s = stub(u => {
    assert.equal(u.pathname, '/public-search');
    assert.equal(u.searchParams.get('q'), 'Jensen Huang');
    assert.equal(u.searchParams.get('events_status'), 'active');
    assert.equal(u.searchParams.get('limit_per_type'), '5');
    assert.equal(u.searchParams.get('search_profiles'), 'false');
    assert.equal(u.searchParams.get('search_tags'), 'false');
    return Response.json({ events: [polyEvent()], pagination: { hasMore: true, totalResults: 23 } });
  });
  try {
    const r = await get('provider=polymarket&q=Jensen%20Huang'); assert.equal(r.status, 200);
    const b = await r.json(); assert.equal(b.query, 'Jensen Huang');
    assert.equal(b.events[0].markets[0].question, 'Will the condition happen?');
    assert.deepEqual(b.events[0].markets[0].outcomes.map(o => o.price), [0.4, 0.6]);
    assert.equal(b.sources[0].totalResults, 23); assert.equal(b.sources[0].pageScope, 'Polymarket search results');
    assert.equal(b.sources[0].hasMore, true); assert.equal(b.events[0].volumeUnit, 'USD');
  } finally { s.restore(); }
});

test('search pagination is bound to query, status and requested limit, and catalog cursors are not search cursors', async () => {
  const s = stub(() => Response.json({ events: [polyEvent()], pagination: { hasMore: true } }));
  try {
    const b = await (await get('provider=polymarket&q=Jensen')).json();
    const cursor = encodeURIComponent(b.sources[0].nextCursor);
    assert.equal((await get('provider=polymarket&q=Jensen&cursor=' + cursor)).status, 200);
    assert.equal(s.calls.at(-1).searchParams.get('page'), '2');
    const count = s.calls.length;
    for (const query of ['q=Fed', 'q=Jensen&status=closed', 'q=Jensen&limit=2']) {
      assert.equal((await get('provider=polymarket&' + query + '&cursor=' + cursor)).status, 400);
    }
    assert.equal((await get('provider=polymarket&cursor=' + cursor)).status, 400);
    assert.equal(s.calls.length, count);
  } finally { s.restore(); }
});

test('search cursor supports Unicode terms without corrupting pagination', async () => {
  const s = stub(() => Response.json({ events: [], pagination: { hasMore: true } }));
  try {
    const query = 'provider=polymarket&q=' + encodeURIComponent('人工智能');
    const b = await (await get(query)).json();
    assert.equal((await get(query + '&cursor=' + encodeURIComponent(b.sources[0].nextCursor))).status, 200);
    assert.equal(s.calls.at(-1).searchParams.get('q'), '人工智能');
  } finally { s.restore(); }
});

test('a valid empty provider search is distinct from an unavailable provider', async () => {
  const s = stub(() => Response.json({ events: null, pagination: { hasMore: false, totalResults: 0 } }));
  try {
    const r = await get('provider=polymarket&q=unlikely-question'); const b = await r.json();
    assert.equal(r.status, 200); assert.deepEqual(b.events, []);
    assert.equal(b.sources[0].status, 'ok'); assert.equal(b.sources[0].nextCursor, null);
  } finally { s.restore(); }
});

test('invalid or unsupported search requests never reach a provider', async () => {
  const s = stub(() => { throw new Error('must not fetch'); });
  try {
    for (const query of ['provider=polymarket&q=', 'provider=polymarket&q=%00x', 'provider=polymarket&q=' + 'x'.repeat(201), 'provider=all&q=Jensen', 'provider=kalshi&q=Jensen']) {
      assert.equal((await get(query)).status, 400);
    }
    assert.equal(s.calls.length, 0);
  } finally { s.restore(); }
});

test('closed search uses provider status and preserves closed contract status', async () => {
  const s = stub(u => {
    assert.equal(u.searchParams.get('events_status'), 'closed');
    return Response.json({ events: [polyEvent({ markets: [{ id: '1', question: 'Past condition?', closed: true, outcomes: ['Yes', 'No'], outcomePrices: ['1', '0'] }] })], pagination: { hasMore: false } });
  });
  try {
    const b = await (await get('provider=polymarket&status=closed&q=past')).json();
    assert.equal(b.events[0].markets[0].status, 'closed');
    assert.deepEqual(b.events[0].markets[0].outcomes.map(o => o.price), [1, 0]);
  } finally { s.restore(); }
});

test('malformed search data and denied provider access cannot become successful empty results', async () => {
  for (const response of [() => Response.json({ events: [] }), () => new Response('provider detail', { status: 403 })]) {
    const s = stub(response);
    try {
      const r = await get('provider=polymarket&q=Jensen'); const b = await r.json();
      assert.equal(r.status, 503); assert.equal(b.sources[0].status, 'error');
      assert.equal(b.sources[0].nextCursor, null); assert.ok(!JSON.stringify(b).includes('provider detail'));
    } finally { s.restore(); }
  }
});

test('search cache isolates different query terms and reuses identical public requests', async () => {
  const s = stub(() => Response.json({ events: [], pagination: { hasMore: false } }));
  try {
    await get('provider=polymarket&q=Jensen'); await get('provider=polymarket&q=Jensen');
    await get('provider=polymarket&q=Fed'); assert.equal(s.calls.length, 2);
  } finally { s.restore(); }
});

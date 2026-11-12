import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceRoute } from './router.js';
import { resetSpaceUpstreamForTests } from './upstream.js';
import { parseRSS, prediction, resetNewsCacheForTests } from './news.js';
import { copyArticleLink } from '../../web/space/panels/news.js';

const KEY = 'fake-news-test-key';
const get = (path, env = {}) => spaceRoute(new Request('https://pulse.test/api/space/news/' + path), env, {});
function stub(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = new URL(url);
    calls.push(u);
    if (u.hostname === 'finnhub.io') {
      assert.equal(options.headers['X-Finnhub-Token'], KEY);
      assert.ok(!u.href.includes(KEY));
    }
    return handler(u);
  };
  return { calls, restore() { globalThis.fetch = original; } };
}
const reset = () => { resetSpaceUpstreamForTests(); resetNewsCacheForTests(); };
const now = Math.floor(Date.now() / 1000);
const rss = items => new Response(`<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map(i => `<item>
  <title>${i.title}</title><link>${i.link}</link><description><![CDATA[${i.desc || ''}]]></description>
  <pubDate>${i.date}</pubDate><dc:creator>${i.by || 'Barchart'}</dc:creator><category>Markets</category>
  <nasdaq:tickers>${i.tickers || ''}</nasdaq:tickers></item>`).join('')}</channel></rss>`, { headers: { 'Content-Type': 'application/rss+xml' } });

test('article sharing copies only a web URL and reports unavailable clipboard failures', async () => {
  const copied = [];
  await copyArticleLink('https://publisher.test/article?id=1#section', { writeText: async value => copied.push(value) });
  assert.deepEqual(copied, ['https://publisher.test/article?id=1#section']);
  await assert.rejects(copyArticleLink('javascript:alert(1)', { writeText: () => assert.fail('must not copy unsafe URL') }));
  await assert.rejects(copyArticleLink('https://publisher.test/article', {}), /copy_unavailable/);
  await assert.rejects(copyArticleLink('https://publisher.test/article', { writeText: async () => { throw new Error('permission denied'); } }), /permission denied/);
});

test('market feed uses Finnhub when keyed, classifies headlines and drops unsafe URLs', async () => {
  reset();
  const s = stub(u => {
    assert.equal(u.pathname, '/api/v1/news');
    assert.equal(u.searchParams.get('category'), 'general');
    return Response.json([
      { id: 1, headline: 'Chipmaker raises guidance after record quarter', url: 'https://example.com/a', datetime: now - 60, source: 'Wire', related: 'NVDA,AMD', image: 'https://img.example.com/a.png', summary: 'S', category: 'top news' },
      { id: 2, headline: 'Plant explosion halts output', url: 'https://example.com/b', datetime: now - 120, source: 'Wire', related: '', image: 'javascript:alert(1)' },
      { id: 3, headline: 'Unsafe link', url: 'javascript:alert(1)', datetime: now - 30 },
      { id: 4, headline: 'Plain market wrap', url: 'https://example.com/c', datetime: now - 300 }
    ]);
  });
  try {
    const res = await get('feed?scope=market&category=general', { FINNHUB_API_KEY: KEY });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.items.map(x => x.url), ['https://example.com/a', 'https://example.com/b', 'https://example.com/c']);
    assert.deepEqual(body.items[0].symbols, ['NVDA', 'AMD']);
    assert.equal(body.items[0].prediction.direction, 'positive');
    assert.equal(body.items[1].prediction.direction, 'negative');
    assert.equal(body.items[1].prediction.event_type, 'explosion');
    assert.equal(body.items[1].image, null);
    assert.equal(body.items[2].prediction, null);
    assert.deepEqual(body.providers, ['Finnhub']);
    assert.ok(!JSON.stringify(body).includes(KEY));
  } finally { s.restore(); }
});

test('without a key the market feed falls back to the Nasdaq RSS category feed', async () => {
  reset();
  const s = stub(u => {
    assert.equal(u.hostname, 'www.nasdaq.com');
    assert.equal(u.searchParams.get('category'), 'Cryptocurrencies');
    return rss([{ title: 'Bitcoin &amp; ether rally', link: 'https://www.nasdaq.com/articles/btc', desc: '<p>Crypto up</p>', date: new Date((now - 90) * 1000).toUTCString(), tickers: 'COIN,MSTR,COIN' }]);
  });
  try {
    const body = await (await get('feed?scope=market&category=crypto')).json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].title, 'Bitcoin & ether rally');
    assert.equal(body.items[0].summary, 'Crypto up');
    assert.deepEqual(body.items[0].symbols, ['COIN', 'MSTR']);
    assert.deepEqual(body.providers, ['Nasdaq RSS']);
  } finally { s.restore(); }
});

test('merger news needs Finnhub; keyless request reports provider_not_configured', async () => {
  reset();
  const s = stub(() => { throw new Error('should not fetch'); });
  try {
    const res = await get('feed?scope=market&category=merger');
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'provider_not_configured' });
  } finally { s.restore(); }
});

test('symbol and theme scopes merge per-symbol news, dedupe by URL and put the queried symbol first', async () => {
  reset();
  const s = stub(u => {
    const sym = u.searchParams.get('symbol');
    assert.ok(u.searchParams.get('from') && u.searchParams.get('to'));
    return Response.json([
      { id: sym + '1', headline: sym + ' raises guidance', url: 'https://example.com/shared', datetime: now - 100, related: 'X' },
      { id: sym + '2', headline: sym + ' update', url: 'https://example.com/' + sym, datetime: now - (sym === 'AMD' ? 10 : 50), related: '' }
    ]);
  });
  try {
    const body = await (await get('feed?scope=theme&symbols=NVDA,AMD', { FINNHUB_API_KEY: KEY })).json();
    assert.equal(s.calls.length, 2);
    assert.deepEqual(body.items.map(x => x.url), ['https://example.com/AMD', 'https://example.com/NVDA', 'https://example.com/shared']);
    assert.equal(body.items[0].symbols[0], 'AMD');
    assert.equal(body.items[2].prediction.direction, 'positive');
  } finally { s.restore(); }
});

test('Finnhub failure on a symbol falls back to Nasdaq RSS and records the error', async () => {
  reset();
  const s = stub(u => {
    if (u.hostname === 'finnhub.io') return new Response('nope', { status: 500 });
    return rss([{ title: 'NVDA headline', link: 'https://www.nasdaq.com/articles/n1', date: new Date((now - 30) * 1000).toUTCString(), tickers: 'AMD,NVDA' }]);
  });
  try {
    const body = await (await get('feed?scope=symbol&symbol=NVDA', { FINNHUB_API_KEY: KEY })).json();
    assert.deepEqual(body.items[0].symbols, ['NVDA', 'AMD']);
    assert.deepEqual(body.errors, [{ symbol: 'NVDA', provider: 'Finnhub', code: 'provider_unavailable' }]);
    assert.deepEqual(body.providers, ['Nasdaq RSS']);
  } finally { s.restore(); }
});

test('validation: bad scope, category and symbols are 400s', async () => {
  reset();
  assert.equal((await get('feed?scope=nope')).status, 400);
  assert.equal((await get('feed?scope=market&category=sports')).status, 400);
  assert.equal((await get('feed?scope=symbol&symbol=bad!')).status, 400);
  assert.equal((await get('feed?scope=symbol')).status, 400);
  assert.equal((await get('feed?scope=symbol&symbol=%5EGSPC')).status, 400);
  assert.equal((await get('other')).status, 404);
});

test('all providers failing returns an error, never invented items', async () => {
  reset();
  const s = stub(() => new Response('down', { status: 503 }));
  try {
    const res = await get('feed?scope=symbol&symbol=NVDA');
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: 'provider_unavailable' });
  } finally { s.restore(); }
});

test('parseRSS skips items without a safe link or date; prediction() mirrors classify()', () => {
  const xml = `<item><title>A</title><link>javascript:x</link><pubDate>${new Date().toUTCString()}</pubDate></item>
    <item><title>B</title><link>https://x.test/b</link><pubDate>not a date</pubDate></item>
    <item><title>C &#39;quoted&#39;</title><link>https://x.test/c</link><pubDate>${new Date().toUTCString()}</pubDate></item>`;
  const rows = parseRSS(xml, 'general');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "C 'quoted'");
  assert.equal(prediction('No strike averted'), null);
  assert.equal(prediction('Ransomware attack hits supplier').direction, 'negative');
});

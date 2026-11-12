import test from 'node:test';
import assert from 'node:assert/strict';
import { stockEvent, stockTopicsFor, rankStockEvents, supplementStockEvents, relatedEventKey } from '../../web/space/panels/prediction-relevance.js';
const event = (title, tags = [], questions = [title]) => ({ id: title, title, tags, markets: questions.map((question, i) => ({ id: String(i), question, outcomes: [{ label: 'Yes', price: 0 }] })), marketCount: questions.length });

test('keeps direct company, AI, macro, energy, trade and healthcare catalysts', () => {
  for (const title of ['Jensen Huang resignation or removal by December?', 'Nvidia market cap above $4T?', 'Fed interest rate cut in December?', 'CPI inflation above 3%?', 'OpenAI IPO in 2027?', 'US tariffs on China above 20%?', 'Brent crude above $100?', 'FDA approval for the new drug?', 'Russia Ukraine ceasefire by December?', 'Mortgage rates below 5%?']) {
    assert.ok(stockEvent(event(title)), title);
  }
});

test('hides basketball, other sports, personal life, entertainment, crypto micro-bets and weather', () => {
  for (const title of ['NBA basketball: Lakers vs Celtics', 'W75 Brisbane: Hoedt vs Huang', 'Jensen Huang divorce by December?', 'Elon Musk tweets the word Tesla?', 'Grammy winner this year?', 'Bitcoin up or down in the next 5 minutes?', 'New York temperature above 80 degrees?']) {
    assert.equal(stockEvent(event(title, ['Finance'])), null, title);
  }
  assert.equal(stockEvent(event('A vs B', ['Sports'])), null);
  assert.equal(stockEvent(event('Prime Minister of Israel after the election?', ['Geopolitics'])), null);
  assert.equal(stockEvent(event('Will something happen?')), null);
});

test('sports-related businesses remain when the actual question is a corporate financial event', () => {
  assert.ok(stockEvent(event('DraftKings earnings beat this quarter?', ['Sports'])));
  assert.ok(stockEvent(event('Nike stock price above $100?', ['Basketball', 'Sports'])));
  assert.equal(stockEvent(event('Nike player to score 20 points in basketball?', ['Sports'])), null);
});

test('mixed events do not let company context admit unrelated child contracts', () => {
  const e = event('Nvidia and Jensen Huang resignation', ['Finance'], ['Jensen Huang resignation by December?', 'Jensen Huang divorce by December?', 'NBA basketball winner?']);
  const result = stockEvent(e);
  assert.equal(result.markets.length, 1); assert.equal(result.marketCount, 1); assert.equal(result.excludedMarkets, 2);
  assert.equal(e.markets.length, 3, 'input stays unchanged');
  assert.equal(result.markets[0].outcomes[0].price, 0, 'real zero remains a real zero');
});

test('relevance topics are explicit and activity ranking never invents missing volume', () => {
  const topics = stockTopicsFor(event('Nvidia semiconductor earnings'), { question: 'Nvidia semiconductor earnings' });
  assert.ok(topics.includes('companies')); assert.ok(topics.includes('technology'));
  const rows = rankStockEvents([{ id: 'missing', volume24h: null }, { id: 'zero', volume24h: 0 }, { id: 'active', volume24h: 30 }]);
  assert.deepEqual(rows.map(r => r.id), ['active', 'zero', 'missing']);
});

test('Polymarket takes priority over overlapping Fed events without merging prices or volume', () => {
  const poly = { ...event('Fed Decision in December?'), provider: 'polymarket', closeTime: '2026-12-10T04:59:00Z', volume24h: 100, volumeUnit: 'USD' };
  const kalshi = { ...event('Fed decision in Dec 2026?'), provider: 'kalshi', closeTime: '2026-12-09T18:59:00Z', volume24h: 999, volumeUnit: 'contracts' };
  const original = JSON.stringify([poly, kalshi]);
  const grouped = supplementStockEvents([kalshi, poly]);
  assert.equal(grouped.length, 1); assert.equal(grouped[0].provider, 'polymarket');
  assert.equal(grouped[0].volume24h, 100); assert.equal(grouped[0].volumeUnit, 'USD');
  assert.strictEqual(grouped[0], poly); assert.equal(JSON.stringify([poly, kalshi]), original);
  assert.notEqual(relatedEventKey(poly), relatedEventKey({ ...kalshi, title: 'Fed decision in Jan 2027?' }));
  assert.notEqual(relatedEventKey(poly), relatedEventKey({ ...kalshi, title: 'Fed chair announced in Dec 2026?' }));
});

test('CPI overlap matching distinguishes periods, core, headline, monthly, annual and foreign releases', () => {
  const p = { ...event('Core CPI YoY - November 2026'), provider: 'polymarket' };
  const k = { ...event('Core CPI YoY in November'), subtitle: 'In Nov 2026', provider: 'kalshi' };
  assert.equal(relatedEventKey(p), relatedEventKey(k));
  for (const title of ['CPI YoY in November 2026', 'Core CPI in November 2026', 'Core CPI YoY in December 2026', 'China CPI YoY in November 2026']) {
    assert.notEqual(relatedEventKey(p), relatedEventKey({ ...k, title, subtitle: '' }), title);
  }
});

test('IPO timing overlap prefers Polymarket while valuation questions and different companies remain distinct', () => {
  const p = { ...event('Anthropic IPO by __?'), provider: 'polymarket' };
  const k = { ...event('When will Anthropic officially announce an IPO?'), provider: 'kalshi' };
  assert.equal(supplementStockEvents([p,k]).length, 1);
  for (const title of ['Anthropic IPO Closing Market Cap', 'When will OpenAI officially announce an IPO?', 'Anthropic super-voting shares at IPO']) {
    assert.equal(supplementStockEvents([p,{...k,title}]).length, 2, title);
  }
  assert.equal(relatedEventKey(event('Nvidia prediction')), null);
});

test('Kalshi supplements gaps and is re-screened when later Polymarket pages add matching events', () => {
  const housing = { ...event('Mortgage rates in December 2026?'), provider: 'kalshi' };
  const fed = { ...event('Fed decision in December 2026?'), provider: 'kalshi' };
  const poly = { ...event('Fed Decision in December?'), provider: 'polymarket', closeTime: '2026-12-10T04:59:00Z' };
  assert.deepEqual(supplementStockEvents([housing, fed]), [housing, fed]);
  assert.deepEqual(supplementStockEvents([housing, fed, poly]), [housing, poly]);
  assert.deepEqual(supplementStockEvents([poly, fed, housing]), [poly, housing]);
  // A different meeting adds coverage rather than being suppressed by a shared keyword.
  const january = { ...fed, title: 'Fed decision in Jan 2027?' };
  assert.deepEqual(supplementStockEvents([poly, january]), [poly, january]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { stockEvent, stockTopicsFor, rankStockEvents } from '../../web/space/panels/prediction-relevance.js';
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

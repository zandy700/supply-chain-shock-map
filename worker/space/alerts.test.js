import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlert, alertMatches } from '../../web/space/alerts.js';
test('alerts validate real positive thresholds and normalize symbols', () => {
  assert.deepEqual(validateAlert({ symbol: ' nvda ', condition: 'above', price: 150 }), { symbol: 'NVDA', condition: 'above', price: 150 });
  for (const price of [null, undefined, '', '150', NaN, Infinity, 0, -1]) assert.equal(validateAlert({ symbol: 'NVDA', condition: 'above', price }), null);
  assert.equal(validateAlert({ symbol: '<script>', condition: 'below', price: 1 }), null);
  assert.equal(validateAlert({ symbol: 'AAPL', condition: 'up', price: 1 }), null);
});
test('alerts trigger inclusively at the threshold and never on missing or invalid quotes', () => {
  const a = { condition: 'above', price: 150 }, b = { condition: 'below', price: 150 };
  assert.equal(alertMatches(a, 149.99), false); assert.equal(alertMatches(a, 150), true); assert.equal(alertMatches(a, 151), true);
  assert.equal(alertMatches(b, 149.99), true); assert.equal(alertMatches(b, 150), true); assert.equal(alertMatches(b, 151), false);
  for (const quote of [null, undefined, '', NaN, Infinity, 0, -1]) { assert.equal(alertMatches(a, quote), false); assert.equal(alertMatches(b, quote), false); }
});

test('notification feed validates source/category/date and rejects unsafe links', async () => {
  const { normalizeNotification } = await import('../../web/space/alerts.js');
  const input = { id: 'earnings:NVDA:2026-11-12', category: 'earnings', title: 'Published earnings date', source: 'Nasdaq', date: '2026-11-12T12:00:00Z', symbol: 'NVDA', url: 'javascript:alert(1)' };
  const n = normalizeNotification(input);
  assert.equal(n.source, 'Nasdaq'); assert.equal(n.symbol, 'NVDA'); assert.equal(n.url, null);
  assert.equal(normalizeNotification({ ...input, category: 'made-up' }), null);
  assert.equal(normalizeNotification({ ...input, source: '' }), null);
  assert.equal(normalizeNotification({ ...input, date: 'not-a-date' }), null);
  assert.equal(normalizeNotification({ ...input, url: 'https://user:password@example.com' }).url, null);
});
test('alert status filtering and date/symbol sorting preserve the source list', async () => {
  const { orderedAlerts } = await import('../../web/space/alerts.js');
  const rows = [{symbol:'ZZ',createdAt:'2026-11-10',triggeredAt:null},{symbol:'AA',createdAt:'2026-11-11',triggeredAt:'2026-11-12'}];
  assert.deepEqual(orderedAlerts(rows, 'active').map(r=>r.symbol), ['ZZ']);
  assert.deepEqual(orderedAlerts(rows, 'triggered').map(r=>r.symbol), ['AA']);
  assert.deepEqual(orderedAlerts(rows, 'all', 'symbol').map(r=>r.symbol), ['AA','ZZ']);
  assert.deepEqual(orderedAlerts(rows).map(r=>r.symbol), ['AA','ZZ']);
  assert.equal(rows[0].symbol, 'ZZ');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_COLUMNS, normalizeFlowColumns, moveFlowColumn, flowDTE, flowFillPosition, flowSide, sortedFlowRows } from '../../web/space/panels/flow-columns.js';

test('flow columns retain seventeen configurable fields, reject unknown state and preserve hidden order', () => {
  assert.equal(FLOW_COLUMNS.length, 17);
  const state = normalizeFlowColumns(['premium', 'premium', 'unknown'], ['symbol', 'time', 'unknown']);
  assert.equal(state.order.length, 17); assert.equal(state.order[0], 'premium');
  assert.deepEqual(state.hidden, ['symbol']);
  const moved = moveFlowColumn(state.order, 'premium', 1);
  assert.equal(moved[1], 'premium'); assert.equal(state.order[0], 'premium');
  assert.deepEqual(moveFlowColumn(state.order, 'premium', -1), state.order);
  assert.deepEqual(moveFlowColumn(state.order, 'unknown', 1), state.order);
});
test('DTE uses the execution date in New York across the UTC midnight boundary', () => {
  assert.equal(flowDTE({ time: '2026-11-12T01:00:00Z', expiry: '2026-11-13T00:00:00Z' }), 2);
  assert.equal(flowDTE({ time: '2026-11-12T15:00:00Z', expiry: '2026-11-13' }), 1);
  assert.equal(flowDTE({ time: '2026-11-12T15:00:00Z', expiry: '2026-02-30' }), null);
  assert.equal(flowDTE({ expiry: '2026-11-13' }), null);
});
test('fill position needs a valid two-sided spread; tags report execution side without inventing intent', () => {
  assert.equal(flowFillPosition({ price: 2.5, bid: 2, ask: 3 }), 50);
  assert.equal(flowFillPosition({ price: 0, bid: 0, ask: 1 }), 0);
  assert.equal(flowFillPosition({ price: 4, bid: 2, ask: 3 }), 200);
  for (const row of [{ price: null, bid: 2, ask: 3 }, { price: 2, bid: 2, ask: 2 }, { price: 2, bid: 3, ask: 2 }]) assert.equal(flowFillPosition(row), null);
  assert.equal(flowSide({ tags: ['ask_side', 'bullish'] }), 'Ask');
  assert.equal(flowSide({ tags: ['ask_side', 'bid_side'] }), 'Mixed');
  assert.equal(flowSide({ tags: ['bullish'] }), null);
});
test('loaded-page sorting keeps missing values last and leaves provider ranking untouched', () => {
  const rows = [{ id: 'missing', volume: null, expiry: null }, { id: 'low', volume: 0, time: '2026-11-11T15:00:00Z', expiry: '2026-11-13' }, { id: 'high', volume: 100, time: '2026-11-11T15:00:00Z', expiry: '2026-12-11' }];
  assert.deepEqual(sortedFlowRows(rows, 'volume').map(r => r.id), ['high', 'low', 'missing']);
  assert.deepEqual(sortedFlowRows(rows, 'dte').map(r => r.id), ['low', 'high', 'missing']);
  assert.deepEqual(sortedFlowRows(rows, 'premium'), rows);
  assert.equal(rows[0].id, 'missing');
});

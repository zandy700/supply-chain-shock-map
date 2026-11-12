export const FLOW_COLUMNS = [
  ['symbol', 'Ticker'], ['side', 'Side'], ['contract', 'Contract'], ['dte', 'DTE'],
  ['underlying', 'Stock'], ['bidAsk', 'Bid-Ask'], ['price', 'Spot'], ['fillPosition', 'Fill vs Spread'],
  ['size', 'Size'], ['premium', 'Premium'], ['volume', 'Volume'], ['openInterest', 'OI'],
  ['chainBidAsk', 'Chain Bid/Ask'], ['legs', 'Legs'], ['code', 'Code'], ['flags', 'Flags'], ['tags', 'Tags']
].map(([key, label]) => ({ key, label }));

export function normalizeFlowColumns(order = [], hidden = []) {
  const allowed = new Set(FLOW_COLUMNS.map(c => c.key));
  return {
    order: [...new Set([...(Array.isArray(order) ? order : []).filter(k => allowed.has(k)), ...allowed])],
    hidden: [...new Set((Array.isArray(hidden) ? hidden : []).filter(k => allowed.has(k)))]
  };
}
export function moveFlowColumn(order, key, direction) {
  const next = normalizeFlowColumns(order).order, index = next.indexOf(key), destination = index + direction;
  if (![-1, 1].includes(direction) || index < 0 || destination < 0 || destination >= next.length) return next;
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}
export function flowDTE(row) {
  const expiry = String(row.expiry || '').slice(0, 10), expiryTime = Date.parse(expiry + 'T00:00:00Z');
  const execution = Date.parse(row.time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(expiryTime) || new Date(expiryTime).toISOString().slice(0, 10) !== expiry || !Number.isFinite(execution)) return null;
  const tradeDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(execution));
  return Math.round((expiryTime - Date.parse(tradeDay + 'T00:00:00Z')) / 86400000);
}
export function flowFillPosition(row) {
  if (![row.price, row.bid, row.ask].every(Number.isFinite) || row.bid < 0 || row.price < 0 || row.ask <= row.bid) return null;
  return (row.price - row.bid) / (row.ask - row.bid) * 100;
}
export function flowSide(row) {
  const tags = Array.isArray(row.tags) ? row.tags : [], ask = tags.includes('ask_side'), bid = tags.includes('bid_side');
  return ask && bid ? 'Mixed' : ask ? 'Ask' : bid ? 'Bid' : tags.includes('mid_side') ? 'Mid' : null;
}
export function sortedFlowRows(rows, sort) {
  if (!['volume', 'dte'].includes(sort)) return [...rows];
  return [...rows].sort((a, b) => {
    const av = sort === 'dte' ? flowDTE(a) : a.volume, bv = sort === 'dte' ? flowDTE(b) : b.volume;
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return sort === 'dte' ? av - bv : bv - av;
  });
}

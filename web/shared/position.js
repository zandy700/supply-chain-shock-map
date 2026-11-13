// Supported normalized holdings use an average cost per share, with null for unknown.
// Accounts have already passed the manual/broker currency and instrument guards.
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const symbol = value => typeof value === 'string' ? value.trim().toUpperCase() : '';

export function combinePosition(accounts, ticker) {
  const target = symbol(ticker);
  let shares = 0, costedShares = 0, basis = 0, lots = 0, missing = 0;
  if (!target) return null;
  for (const account of Array.isArray(accounts) ? accounts : []) {
    for (const holding of account?.holdings || []) {
      if (symbol(holding?.ticker) !== target || !positive(holding.shares)) continue;
      lots++; shares += holding.shares;
      if (nonnegative(holding.cost)) { costedShares += holding.shares; basis += holding.cost * holding.shares; }
      else missing++;
    }
  }
  if (!lots) return null;
  return { ticker: target, shares, lots, avgCost: costedShares > 0 ? basis / costedShares : null,
    costBasis: costedShares > 0 ? basis : null, costedShares, partial: missing > 0 };
}
export function positionsByTicker(accounts) {
  const tickers = new Set();
  for (const account of Array.isArray(accounts) ? accounts : []) for (const holding of account?.holdings || []) {
    const ticker = symbol(holding?.ticker); if (ticker) tickers.add(ticker);
  }
  return new Map([...tickers].map(ticker => [ticker, combinePosition(accounts, ticker)]).filter(([,position]) => position));
}
// P&L uses only shares whose cost is known; a partial position never invents costs.
export function positionValue(position, price) {
  if (!position) return null;
  const quote = nonnegative(price) ? price : null;
  const marketValue = quote === null ? null : position.shares * quote;
  const pnl = quote === null || position.costBasis === null ? null : position.costedShares * quote - position.costBasis;
  return { marketValue, pnl, pnlPercent: pnl === null || !(position.costBasis > 0) ? null : 100 * pnl / position.costBasis };
}

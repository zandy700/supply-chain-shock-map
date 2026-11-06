const STORAGE_KEY = 'watchlist-pulse-portfolios-v1';
const SYMBOL = /^[A-Z]{1,5}(?:[.-][A-Z])?$/;

function amount(value, max, label) {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(label + ' must be a number between 0 and ' + max.toLocaleString('en-US') + '.');
  }
  return value;
}

function cleanHistory(entries) {
  if (!Array.isArray(entries) || entries.length > 5000) throw new Error('Use up to 5,000 dates per portfolio.');
  const dates = new Set();
  const history = entries.map(entry => {
    const date = entry?.date;
    const parsed = typeof date === 'string' ? Date.parse(date) : NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0,10) !== date) {
      throw new Error('Use a valid calendar date in YYYY-MM-DD format.');
    }
    if (dates.has(date)) throw new Error('Use one portfolio value per date.');
    dates.add(date);
    return {date, value:amount(entry.value, 1e15, 'Portfolio value')};
  });
  return history.sort((a,b) => a.date.localeCompare(b.date));
}

function normalize(accounts) {
  if (!Array.isArray(accounts) || accounts.length > 20) throw new Error('Use up to 20 portfolios on this device.');
  const ids = new Set();
  return accounts.map(account => {
    if (!account || typeof account.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(account.id) || ids.has(account.id)) {
      throw new Error('Each portfolio needs a unique ID.');
    }
    ids.add(account.id);
    const name = typeof account.name === 'string' ? account.name.trim() : '';
    if (!name || name.length > 80) throw new Error('Use a portfolio name of 1–80 characters.');
    const cash = amount(account.cash, 1e15, 'Cash');
    if (!Array.isArray(account.holdings) || account.holdings.length > 100) throw new Error('Use up to 100 holdings per portfolio.');
    const symbols = new Set();
    const holdings = account.holdings.map(row => {
      const ticker = typeof row?.ticker === 'string' ? row.ticker.trim().toUpperCase() : '';
      if (!SYMBOL.test(ticker)) throw new Error('Enter a valid US ticker for each holding.');
      if (symbols.has(ticker)) throw new Error('Use one holding per ticker within a portfolio.');
      symbols.add(ticker);
      const shares = amount(row.shares, 1e10, 'Shares');
      if (shares === 0) throw new Error('Shares must be greater than zero.');
      const cost = row.cost == null ? null : amount(row.cost, 1e9, 'Average cost per share');
      return {ticker, shares, cost};
    });
    return {id:account.id, name, cash, holdings, history:cleanHistory(account.history ?? [])};
  });
}

export function readPortfolios(storage = localStorage) {
  const saved = storage.getItem(STORAGE_KEY);
  return saved === null ? [] : normalize(JSON.parse(saved));
}

export function writePortfolios(accounts, storage = localStorage) {
  const clean = normalize(accounts);
  storage.setItem(STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

// Quantities are current positions. Day change estimates their price movement at
// constant quantities and cash; no transactions or cash flows are inferred.
export function summarize(accounts, prices = {}) {
  const positions = new Map();
  let cash = 0;
  for (const account of accounts) {
    cash += account.cash;
    for (const {ticker,shares,cost} of account.holdings) {
      const position = positions.get(ticker) || {ticker, shares:0, basis:0};
      position.shares += shares;
      if (cost == null || position.basis === null) position.basis = null;
      else position.basis += cost * shares;
      positions.set(ticker, position);
    }
  }
  let totalBasis = 0;
  const rows = Array.from(positions.values(), ({ticker,shares,basis}) => {
    const quote = prices[ticker];
    const price = Number.isFinite(quote?.price) && quote.price > 0 ? quote.price : null;
    const previous = Number.isFinite(quote?.previous) && quote.previous > 0 ? quote.previous : null;
    const value = price === null ? null : shares * price;
    const dayChange = price === null || previous === null ? null : shares * (price - previous);
    const gain = value === null || basis === null ? null : value - basis;
    totalBasis += basis ?? 0;
    return {ticker, shares, cost:basis === null ? null : basis / shares, price, value, dayChange, gain};
  });
  // Never turn missing prices or bases into a misleading partial total.
  function total(key, initial = 0) {
    if (rows.some(row => row[key] === null)) return null;
    return rows.reduce((sum,row) => sum + row[key], initial);
  }
  const value = total('value', cash);
  const dayChange = total('dayChange');
  const previousValue = dayChange === null ? null : value - dayChange;
  const gain = total('gain');
  return {
    value, cash, dayChange, dayPercent:previousValue > 0 ? 100 * dayChange / previousValue : null,
    gain, gainPercent:gain !== null && totalBasis > 0 ? 100 * gain / totalBasis : null, rows
  };
}

// Include a combined observation only when every selected account has an
// explicit total for the same date. No carry-forward prices or interpolated cash.
export function combinedHistory(accounts) {
  const sums = new Map();
  for (const account of accounts) {
    for (const {date,value} of account.history ?? []) {
      const point = sums.get(date) || {date, value:0, count:0};
      point.value += value;
      point.count++;
      sums.set(date, point);
    }
  }
  return [...sums.values()].filter(point => point.count === accounts.length)
    .sort((a,b) => a.date.localeCompare(b.date)).map(({date,value}) => ({date,value}));
}

// Pure option math for the Space options panels (no DOM). Unit-tested in worker/space/options.test.js.
// Black-Scholes-Merton for European options. Every output here is DERIVED from delayed quotes:
// listed US equity options are American-style, dividends are ignored (q = 0 unless passed),
// and the risk-free rate is a fixed assumption, not a live rate.
export const RISK_FREE_RATE = 0.04; // 4% annualized, continuous compounding (assumption)
export const YEAR_MS = 365 * 86400000;

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const pdf = x => Math.exp(-0.5 * x * x) / SQRT2PI;

// Standard normal CDF, Hart (1968) as given by G. West, "Better approximations to cumulative
// normal functions" (2005) — accurate to roughly double precision.
export function cdf(x) {
  const z = Math.abs(x);
  let c = 0;
  if (z <= 37) {
    const e = Math.exp(-z * z / 2);
    if (z < 7.07106781186547) {
      let n = 0.0352624965998911 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871;
      n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      let d = 0.0883883476483184 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674;
      d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      c = e * n / d;
    } else {
      let b = z + 0.65; b = z + 4 / b; b = z + 3 / b; b = z + 2 / b; b = z + 1 / b;
      c = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - c : c;
}

// Years from `now` until 4:00 PM New York time on expiry date (YYYY-MM-DD).
export function yearsToExpiry(expiry, now = Date.now()) {
  const close = etCloseMs(expiry);
  return close === null ? null : (close - now) / YEAR_MS;
}
export function etCloseMs(expiry) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiry || '');
  if (!m) return null;
  // 16:00 ET is 20:00 UTC during EDT and 21:00 UTC during EST; pick the one that formats as 16 in New York.
  for (const h of [20, 21]) {
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], h);
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }).format(t);
    if (+hour === 16) return t;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 21);
}

const valid = (S, K, T, sigma) => S > 0 && K > 0 && T > 0 && sigma > 0 && [S, K, T, sigma].every(Number.isFinite);

export function d1d2(S, K, T, sigma, r = RISK_FREE_RATE, q = 0) {
  const vt = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / vt;
  return [d1, d1 - vt];
}

export function bsPrice(kind, S, K, T, sigma, r = RISK_FREE_RATE, q = 0) {
  if (!valid(S, K, T, sigma)) return null;
  const [d1, d2] = d1d2(S, K, T, sigma, r, q);
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  return kind === 'call' ? S * dq * cdf(d1) - K * dr * cdf(d2) : K * dr * cdf(-d2) - S * dq * cdf(-d1);
}

// Greeks: delta per $1, gamma per $1, theta per calendar day, vega per 1 vol point (0.01).
export function greeks(kind, S, K, T, sigma, r = RISK_FREE_RATE, q = 0) {
  if (!valid(S, K, T, sigma)) return null;
  const [d1, d2] = d1d2(S, K, T, sigma, r, q);
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T), sq = Math.sqrt(T), n1 = pdf(d1);
  const call = kind === 'call';
  const delta = call ? dq * cdf(d1) : -dq * cdf(-d1);
  const gamma = (dq * n1) / (S * sigma * sq);
  const vega = (S * dq * n1 * sq) / 100;
  const decay = -(S * dq * n1 * sigma) / (2 * sq);
  const theta = (call
    ? decay - r * K * dr * cdf(d2) + q * S * dq * cdf(d1)
    : decay + r * K * dr * cdf(-d2) - q * S * dq * cdf(-d1)) / 365;
  return { delta, gamma, theta, vega };
}

// Implied volatility by bisection (robust for deep ITM/OTM). Returns null when the price is
// outside no-arbitrage bounds or inputs are invalid.
export function impliedVol(kind, price, S, K, T, r = RISK_FREE_RATE, q = 0) {
  if (!(price > 0) || !(S > 0) || !(K > 0) || !(T > 0)) return null;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T);
  const lower = kind === 'call' ? Math.max(0, S * dq - K * dr) : Math.max(0, K * dr - S * dq);
  const upper = kind === 'call' ? S * dq : K * dr;
  if (price <= lower + 1e-9 || price >= upper) return null;
  let lo = 1e-4, hi = 5;
  if (bsPrice(kind, S, K, T, hi, r, q) < price) return null;
  for (let i = 0; i < 100; i++) {
    const m = (lo + hi) / 2;
    if (bsPrice(kind, S, K, T, m, r, q) > price) hi = m; else lo = m;
    if (hi - lo < 1e-7) break;
  }
  return (lo + hi) / 2;
}

export const midPrice = q => (q && q.bid > 0 && q.ask > 0 && q.ask >= q.bid ? (q.bid + q.ask) / 2 : null);

// IV + greeks for one quote, from the bid/ask mid (falls back to last only if no two-sided market).
export function analyze(kind, quote, S, K, T, r = RISK_FREE_RATE) {
  const mid = midPrice(quote);
  const price = mid ?? (quote?.last > 0 ? quote.last : null);
  const iv = price === null ? null : impliedVol(kind, price, S, K, T, r);
  return { price, priceBasis: mid !== null ? 'mid' : price !== null ? 'last' : null, iv, ...(iv ? greeks(kind, S, K, T, iv, r) : { delta: null, gamma: null, theta: null, vega: null }) };
}

// Position economics at expiry for one contract (multiplier 100). Values in dollars per contract.
export function payoffStats(kind, position, K, premium) {
  if (!(K > 0) || !(premium > 0)) return null;
  const long = position === 'long', m = 100;
  const breakEven = kind === 'call' ? K + premium : K - premium;
  let maxGain, maxLoss;
  if (kind === 'call') { maxGain = long ? Infinity : premium * m; maxLoss = long ? premium * m : Infinity; }
  else { maxGain = long ? (K - premium) * m : premium * m; maxLoss = long ? premium * m : (K - premium) * m; }
  return { breakEven, maxGain, maxLoss };
}
export function payoffAt(kind, position, K, premium, ST) {
  const intrinsic = kind === 'call' ? Math.max(0, ST - K) : Math.max(0, K - ST);
  return (position === 'long' ? intrinsic - premium : premium - intrinsic) * 100;
}

// Risk-neutral probability the position is profitable at expiry (lognormal, IV as sigma).
export function profitChance(kind, position, S, breakEven, T, sigma, r = RISK_FREE_RATE) {
  if (!valid(S, breakEven, T, sigma)) return null;
  const [, d2] = d1d2(S, breakEven, T, sigma, r);
  const above = cdf(d2); // P(S_T > breakEven)
  const longWins = kind === 'call' ? above : 1 - above;
  return position === 'long' ? longWins : 1 - longWins;
}

// One-standard-deviation move to expiry implied by IV.
export const expectedMove = (S, sigma, T) => (S > 0 && sigma > 0 && T > 0 ? S * sigma * Math.sqrt(T) : null);

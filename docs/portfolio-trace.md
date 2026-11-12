# Yahoo Finance portfolio loading

Inspected November 5, 2026. These observations describe the shipped web client. Yahoo's signed-out route rendered a sign-in prompt. The supplied screenshots show the signed-in account selector, holdings summary and six-month Holdings Value chart. The later Firefox check observed request paths in a signed-in session. It did not retain account identifiers, credentials, positions or response bodies. [Portfolio page](https://finance.yahoo.com/portfolios)

## Holdings

The portfolio route calls the holdings loader with cache reuse enabled during page load. The loader can return a stored symbol or the entire holdings map. When it fetches, it calls a session-aware helper with the path `/v1/finance/portfolio/holdings` and can narrow the request by symbol. It reads `finance.result`, indexes entries by symbol and keeps each security's aggregate holdings, per-portfolio holdings, display name, ticker type, base currency and price session. A separate silent refresh path guards against an older response replacing a newer one. [Route bundle](https://finance.yahoo.com/assets/_app/immutable/nodes/90.DsWTHRPm.js) · [Holdings loader](https://finance.yahoo.com/assets/_app/immutable/chunks/loadHoldings.p72g-Tnf.js)

## Chart

The chart loader checks for a signed-in user. The portfolio series path is `/ws/portfolio-timeseries-api/v2/portfolio/performance/chart`. It optionally sends a portfolio ID and requests a range and interval or explicit start and end. Quote comparisons use a separate `quotePerformance/chart` variant with a symbol. The client pairs timestamps with the selected performance field, which defaults to `endMarketValue`. It merges comparison series by timestamp and drops superseded responses. For ordinary holdings-value ranges, it can align the final plotted value with the current total of the same portfolio. The custom-date branch skips that adjustment. [Chart loader](https://finance.yahoo.com/assets/_app/immutable/chunks/updatePortfolioChartStore.CLQX7wp9.js)

## Verification boundary

The paths above were read from public JavaScript loaded by the signed-out browser. A separate Firefox check on the signed-in Portfolios page clicked the visible one-month chart tab (`tab-1mo`). Resource Timing recorded a request matching the portfolio performance chart path after the click, along with a visualization request. The capture excluded query strings and response bodies and masked numeric path components. The initial resource list did not show the holdings path, so whether that page load reused cached or embedded holdings remains unverified. Server-side valuation and brokerage synchronization also remain unverified. An independent dashboard can use its own positions and valuation history. Current shares alone cannot recover past trades, deposits or withdrawals.

REA signed-out scenario evidence ID: `ev_23d4d5465e3017a1481be7a98fa8d6ae960970bfa2f9fffabf3d955008854e5b`. REA selected-file static analysis ID: `ev_9df81376995dddb24199f7cc87949b373f1859551d0b812c47b161456bc8426f`. The static analysis covered the holdings and chart loader bundles. The route caller was inspected separately from the public file named above.

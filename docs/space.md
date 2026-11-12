# Ultimater

Ultimater is the desktop research workspace at `/space.html` (Cloudflare also serves the clean `/space` URL). Run `npm run dev`, then open `http://127.0.0.1:8787/space.html`. Use a distinct `--persist-to` directory for each concurrent Wrangler server to avoid SQLite locks. See the [signed-in Yahoo Gold audit](rea-full-audit.md) for the latest changes, checks and data limits.

The [workspace contract](space-contract.md) records the shared interfaces. The existing briefing and its classified news scenarios remain available, and the workspace Predictions panel uses that same classification flow.

## Workspace

Onboarding offers Markets, Stock Analysis, and Track My Portfolio. Built-in views and 34 theme views provide starting layouts. Use Browse all themes to search by industry, company or ticker; Housing & Rates, Gambling & Betting and Prediction Markets have direct sidebar shortcuts. Clone a view or create one to add, move, resize, lock, and remove panels. Linked symbol groups keep company panels together; custom views, settings and drawings are stored in this browser. Narrow screens stack panels and expose navigation in a drawer.

Panels cover charts and multi-chart grids; quotes, financials, analyst ratings, profiles, peers and SEC segments; movers, sectors, themes, watchlists, screens and heatmaps; news and classified scenarios; earnings and economic calendars; delayed options chains and derived statistics; holdings, allocation, recorded account values; price alerts and AI recaps.

## Data and configuration

- Finnhub: set the Worker secret `FINNHUB_API_KEY` for news, quotes and additional company coverage. Local servers need their own configuration. Never store credentials in source.
- Nasdaq public endpoints and Coinbase Exchange supply additional delayed market data. Provider outages or missing fields appear as unavailable states. Some views use explicitly labeled ETF proxies.
- Portfolio panels reuse `portfolio-model.js`, the validated CSV/holdings editor, saved account values, and the existing SnapTrade connection. Broker activation and credentials are documented in `broker-setup.md`. Linked accounts with unsupported positions or currencies do not produce misleading partial totals.
- Portfolio history uses recorded account values only. Saving today's value does not reconstruct past trades, cash flows or returns.
- Ultimater AI requires the Worker secret `ANTHROPIC_API_KEY`; its model can be selected with `PULSE_AI_MODEL`. Without a key, the interface explains that AI is unavailable. Existing automated AI tests use stubs; they do not establish a working paid account or model access.
- Alerts are checked while this page is open. They are local browser alerts, not a hosted background notification service.

## Differences from the reference

This is an independent implementation inspired by the traced AlphaSpace workspace. It uses no Yahoo data endpoints or branding. Exact proprietary data coverage is unavailable: mutual fund lists explain missing feed coverage, options are delayed with derived values labeled, and heatmap tiles approximate weights rather than claiming an exact treemap. Workspace persistence is per browser, with optional encrypted manual cross-device sync as described below. There are no server-side user accounts or automatic layout merges.

## Checks

`npm test` covers the original Worker routes and Space's chart parsing, company controls, market normalization, news, earnings, options math/routes, AI validation/streaming, and missing-value formatting. `node --check` checks syntax. The harness `/space/dev.html?panels=chart,quote&symbol=NVDA` mounts selected modules for isolated testing. The complete shell must also be checked for interactions and responsive layout.

## Expanded workflows (November 11 continuation)

Portfolio Holdings now contains Holdings, News, Insights, Movers and Risk tabs. Insights and concentration measures are derived from the selected current positions; they do not claim historical volatility or forecast losses. Hide values applies across portfolio panels. AI holdings context loads the active selected manual or linked accounts when the user has enabled sharing holdings.

Company fundamentals now supports seven tabs, comparisons, units and date ordering; segment breakdowns have period/geography controls. Charts expose six style presets, custom colors, 52 studies, editable drawings, richer metric overlays and timed replay. Current-session extended-hours filtering is source-dependent. Total-return prices and historical dividend/split markers remain unavailable with the present feeds.

The Options Flow Screener uses the actual transaction endpoint described in the [official Unusual Whales API documentation](https://api.unusualwhales.com/docs). Set the Worker secret `UNUSUAL_WHALES_API_KEY` with an eligible subscription to activate it. No paid subscription or key was acquired during this build. The unconfigured state is explicit; the separate Nasdaq volume/open-interest scan remains a derived delayed scan. Contract Detail is now a persistent linked panel.

Notifications have feed/category controls, source labels, filtering and sorting. Optional watchlist news/earnings checks and browser notifications require opt-in. Checks run while the page is open and visible; this is not a server background notification service. The Market Video panel accepts independent user-selected media or publisher links. It does not contain Yahoo Finance TV content.

### Encrypted workspace sync

The workspace menu offers manual Save/Load sync across devices. It uses the new Cloudflare `WORKSPACE_SYNC` Durable Object binding and `workspace-sync-v1` migration in `wrangler.jsonc`; this binding must be deployed before hosted sync works. Local verification does not activate the hosted binding.

Generate a private random code, copy it, and save this device's workspace. On another device, enter the same code and explicitly choose to replace its local workspace before loading. The code is an AES-GCM key and stays in the browser; the relay receives a separately derived authentication capability and ciphertext. Layout/preferences export filters exclude holdings, portfolio account IDs, broker credentials, AI chats and price alerts. Treat the code as a secret: possession permits reading/replacing that encrypted copy. Codes are not retained after closing the dialog and cannot be recovered by the app. Save and delete operations use revisions to reject concurrent/stale writes. Deletion retains a revision tombstone, preventing a deleted/recreated copy from accepting an older device's stale revision.

Sync is user-triggered and capability-based. It does not introduce an account login or automatically merge layouts. Validated workspace file export/import also remains available without a server.

## Alpaca options integration

See [Alpaca indicative-feed setup](alpaca-options.md) for private local credential entry, source/freshness semantics and fallback behavior. The free indicative feed is separate from the transaction-flow provider.

## Automatic data updates

Visible charts check stock/ETF/index price history every 30 seconds and crypto every 15 seconds. Quote panels and the market tape check every 30 seconds; market and portfolio panels every 60 seconds; news and classified headlines every two minutes. Company research and earnings check every 5–15 minutes according to the data type. Options retain their separate 60-second refresh/session controls.

Price updates preserve chart zoom, pan, drawings, studies and comparison symbols; automatic chart updates pause during historical replay or an active drawing/drag. News readers keep their open article and reading position. Typed filters, portfolio selections and privacy preferences remain intact.

Automatic requests pause when a panel is offscreen, the browser tab is hidden or the device is offline. Returning to a visible panel, focusing the window or reconnecting checks for new data. Requests are serialized, time out after 45 seconds and retry with bounded backoff. Failed updates retain the last good data and show a warning; retained stale portfolio prices cannot become fresh saved snapshots.

“Checked” records an application refresh, separately from the source's trade/sample/bar timestamp. This is polling, not a streaming or real-time market-data entitlement. An unchanged candle can mean the provider has no new sample or the market is closed. Nasdaq intraday high/low remain sampled one-minute prices, not tick-level OHLC; faster polling does not remove provider delays.

Crypto's current candle uses Coinbase's [latest-trade snapshot](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker) between historical refreshes. It is explicitly partial and sampled: observed high/low and the first observed open are retained, but trades between checks can be missed and current-candle volume is unavailable. Closed history is preserved. Historical candles refresh at most every five minutes, following Coinbase's [guidance against frequent historical polling](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-candles).

## Prediction Markets

Open `/space?view=prediction-board` or choose **Prediction Markets** in Views. It browses public Kalshi and Polymarket catalogs without credentials, including nested outcome contracts, prices, resolution rules, source links, per-venue pagination and Kalshi combo tickets. The existing stock-exposure theme is now named **Prediction Market Stocks** and keeps its original identifier.

Visible loaded pages rotate through 30-second refresh checks. Search, category and sorting apply to loaded events; Load more continues each provider's catalog. Long events expose every supplied contract through expansion. Advanced filters collapse on phones so questions and prices remain visible. See [API and coverage notes](prediction-markets.md) for pricing units, snapshot freshness, adaptive page sizes and historical-archive limits. These are public markets, not a person's private positions or bets.

## Stock-theme expansion

The shared catalog now includes 34 research universes. Ten additions cover Prediction Markets, Homebuilders, Home Improvement & Building Products, Semiconductors, AI Data Centers, Power Grid & Electrification, Nuclear & Uranium, Robotics & Automation, Quantum Computing and Critical Minerals. Existing Housing & Rates and Gambling & Betting remain separate, discoverable views.

Every theme uses the same catalog for frontend routes, constituent tables, heatmaps, news, selectors and AI view identifiers. News requests the full constituent universe rather than only the linked ticker or the first twelve names. Stocks and ETFs are identified separately; theme memberships are editorial, not index membership or portfolio recommendations. Prediction-market notes distinguish operating businesses from ICE's indirect equity investment and do not present Kalshi or Polymarket as listed stocks. Expanded-theme constituent records carry primary-source exposure links and the November 11 check date.

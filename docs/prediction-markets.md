# Prediction Markets catalog

The Prediction Markets view browses public event catalogs from Kalshi and Polymarket. No API keys or connected betting accounts are needed. It does not fetch a person's bets, positions, orders or balances, and it does not submit trades.

## Public sources

- [Kalshi public market-data quick start](https://docs.kalshi.com/getting_started/quick_start_market_data): public data is available without authentication at `https://external-api.kalshi.com/trade-api/v2`.
- [Kalshi events](https://docs.kalshi.com/api-reference/events/get-events): ordinary event catalog with nested markets and cursor pagination. This endpoint excludes multivariate combo events.
- [Kalshi markets](https://docs.kalshi.com/api-reference/market/get-markets): combo-contract catalog using `mve_filter=only` and the native `status` filter. The separate [multivariate-event endpoint](https://docs.kalshi.com/api-reference/events/get-multivariate-events) lacks event-status filtering and was not used to approximate an open-combo list by filtering its first page.
- [Polymarket discovery](https://docs.polymarket.com/market-data/discover-markets): public, unauthenticated market and event discovery. The adapter uses `https://gamma-api.polymarket.com/events`, ordered by native 24-hour event volume, with offset pagination.

The sources were checked against both official documentation and actual public responses. The app reads provider snapshots; it does not claim a streaming feed or executable-price entitlement.

## Application API

`GET /api/space/prediction-markets/catalog`

| Parameter | Values | Default |
| --- | --- | --- |
| `provider` | `all`, `kalshi`, `polymarket` | `all` |
| `limit` | Integer from 1 to 30, maximum events per provider (combo tickets in combo mode) | `12` |
| `status` | `open`, `closed`, filtering event catalogs or combo contracts | `open` |
| `kind` | `standard`, `combos` | `standard` |
| `cursor` | Opaque token returned by the selected provider's prior page | Empty |

An all-provider request returns one page from each provider, not their entire catalogs. Each `sources` entry has its own `hasMore` and `nextCursor`. Continue a provider with `provider=kalshi` or `provider=polymarket` and that source's `nextCursor`. Tokens are bound to provider, status, kind and page limit. They cannot be reused after changing those filters. Pagination can be navigated to more pages without loading every provider market into browser memory at once.

Combo mode covers Kalshi only. In all-provider mode it requests only Kalshi and returns an explanatory notice; `provider=polymarket&kind=combos` is rejected. It uses the market endpoint's native combo and status filters. Each card is one combination ticket, with a unique ID based on its market ticker, preventing later pages from replacing earlier tickets from the same parent event. Its provider-supplied legs are included in the details. `sources[].pageScope` distinguishes `combo contracts` from ordinary `events`.

Ordinary event status is distinct from nested market status: an open event can contain closed or settled child markets. The adapter preserves all nested markets rather than hiding resolved outcomes. Older settled Kalshi markets beyond its historical cutoff are excluded from nested event responses by the provider, so this view is not a complete historical settlement archive.

The primary **Search Polymarket events** form queries Polymarket’s public search service, rather than filtering a downloaded catalog page. It switches to Polymarket standard events and preserves provider result pagination. Separate keyword/category filters inside **Filters** operate only on loaded events and their child questions; global Kalshi search is not claimed. Provider cursors remain available for further browsing. There is no arbitrary fixed “first 100 markets” coverage claim.

## Price and volume semantics

- Prices are normalized to the interval 0–1. Missing or invalid values remain `null`; zero is preserved when it is an actual supplied price.
- Open Kalshi outcomes show available **asks**, with bid/ask fields retained separately. Current dollar-string fields take precedence over legacy integer-cent fields. An all-zero unquoted book and an untraded zero last-price placeholder are unavailable, not a 0% forecast.
- Closed Kalshi markets do not advertise their stale ask fields. A known finalized result or explicit settlement value is labeled `settlement`; otherwise current outcome prices are unavailable and the separately supplied last trade remains separate.
- Polymarket outcome prices are Gamma snapshots, parsed from array or JSON-string fields. All outcome labels and child questions are retained. Bid/ask fields are assigned only for the documented conventional `Yes`, `No` ordering, avoiding guesses about reversed tokens.
- These prices are market observations, not guarantees or independent probability forecasts. Separate contracts and competing markets need not sum to a common implied probability.
- Kalshi volumes and open interest are **contracts**, including fractional contract counts. Polymarket event/market turnover is **USD**. The app does not add or directly rank these different units as one cross-venue dollar total. A Kalshi event sum is unavailable if any contributing child volume is missing.
- Provider `updatedAt` values may reflect metadata changes, rather than the timestamp of a price change. Provider fetch time and app request time are reported separately.

Provider links use fixed HTTPS venue hosts. Kalshi payloads do not provide the canonical website event slug, so ordinary website links are explicitly labeled **Open Kalshi series**. Combo cards link to Kalshi rather than guessing a website route from a collection ticker. Each contract's details also link to its official public API data. Polymarket links use the source's event and market slugs. Rules remain plain text. Rules longer than 40,000 characters carry `rulesTruncated: true` and the full source remains accessible through the provider link.

## Reliability and resource limits

Provider requests use fixed hosts, a 12-second deadline and manual redirect handling; redirects are rejected. Successful public pages are shared for 30 seconds, including their original fetch timestamp. The cache has a conservative total 8 MiB memory budget, 128-entry ceiling and four-request in-flight bound. Provider bodies are read incrementally and canceled above 4 MiB. Oversized pages retry with fewer **events**, never fewer nested markets. The learned event-page budget lasts 30 minutes; Polymarket begins with at most two events because a single event can contain hundreds of markets. `sources[].pageLimit` reports the actual upstream count while `requestedLimit` and opaque cursor validation retain the application's selected limit. If even one event exceeds the response budget, it fails explicitly with `provider_page_too_large`; the UI retains prior data and offers retry/source links.

One failed provider does not erase a successful provider's results. If every requested provider fails, the route returns 503 with per-provider error states rather than a misleading successful empty list. A provider 429 starts a short host-specific cooldown. Error responses never echo provider bodies. The frontend's shared refresh scheduler supplies visible-panel polling, pause/manual refresh, abort cleanup and stale-data status.

Focused adapter tests cover normalized units and missing values, multi-outcome events, closed-settlement price labels, pagination/query-bound cursors, provider partial failures, invalid inputs, rate-limit cooldown, and safe source links. Actual Worker smoke checks verified unauthenticated results from both providers; Node-only success was not treated as sufficient activation evidence.

## Polymarket event search and probabilities

Use **Prediction Markets** in Views or the **Polymarket events** shortcut. New panels default to Polymarket. Search event questions or use the Jensen Huang, Fed rates, and AI shortcuts. The stock-exposure theme remains separately named Prediction Market Stocks in the theme catalog.

`GET /api/space/prediction-markets/catalog?provider=polymarket&q=Jensen%20Huang` sends a bounded 1–200 character query to Polymarket’s [`/public-search` API](https://docs.polymarket.com/api-spec/gamma-openapi.yaml). Public event search disables profile/tag search, requests up to five events per provider page, retains all supplied nested outcomes, and binds continuation tokens to query, status, and requested limit. Search terms support Unicode. A provider error is distinguished from a valid empty search. Browse events clears the remote query; changing venue or catalog also clears it.

Polymarket outcome snapshots are displayed as **market-implied percentages**; missing prices remain unavailable. Closed contracts are labeled last implied chance. Kalshi ask prices remain in cents, and numeric export values retain the original normalized 0–1 prices. Exact contract questions, individual deadlines, rules, source links, and check times remain visible. Multi-deadline events do not advertise a single shared contract deadline. The Jensen Huang example retains Polymarket’s broader resignation-or-removal wording; it is not relabeled as a firing-only event.

An actual local Worker search returned HTTP 200 with five events, 17 nested contracts, and provider pagination for Jensen Huang. Figures are a checked snapshot, not a fixed forecast. The integration does not place trades, access wallets, or require private prediction-market credentials.

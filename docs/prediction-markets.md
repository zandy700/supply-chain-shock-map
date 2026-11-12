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

Use **Prediction Markets** in Views or the **Market events** shortcut. Discovery defaults to Polymarket plus Kalshi. Search event questions or use the Jensen Huang, Fed rates, and AI shortcuts. The stock-exposure theme remains separately named Prediction Market Stocks in the theme catalog.

`GET /api/space/prediction-markets/catalog?provider=polymarket&q=Jensen%20Huang` sends a bounded 1–200 character query to Polymarket’s [`/public-search` API](https://docs.polymarket.com/api-spec/gamma-openapi.yaml). Public event search disables profile/tag search, requests up to five events per provider page, retains all supplied nested outcomes, and binds continuation tokens to query, status, and requested limit. Search terms support Unicode. A provider error is distinguished from a valid empty search. Discover clears the remote query and restores both venues; changing venue or catalog also clears it.

Polymarket outcome snapshots are displayed as **market-implied percentages**; missing prices remain unavailable. Closed contracts are labeled last implied chance. Kalshi ask prices remain in cents, and numeric export values retain the original normalized 0–1 prices. Exact contract questions, individual deadlines, rules, source links, and check times remain visible. Multi-deadline events do not advertise a single shared contract deadline. The Jensen Huang example retains Polymarket’s broader resignation-or-removal wording; it is not relabeled as a firing-only event.

An actual local Worker search returned HTTP 200 with five events, 17 nested contracts, and provider pagination for Jensen Huang. Figures are a checked snapshot, not a fixed forecast. The integration does not place trades, access wallets, or require private prediction-market credentials.

## Stock-focused discovery and UI

Polymarket discovery covers stock-relevant events across 18 verified provider categories: Stocks, Business, Earnings, Finance, Economy, Fed, Inflation, CPI, GDP, Recession, Tariffs, IPO, Technology, AI, Trade, Energy, Healthcare, and Geopolitics. The public provider tag IDs and readable relevance rules live in `web/space/panels/prediction-relevance.js`; they were checked against Polymarket’s tag-by-slug API on November 12, 2026.

`GET /api/space/prediction-markets/stock-events` returns a de-duplicated page across those categories, ranked by available 24-hour USD activity. Each category initially requests up to four events; oversized responses reduce the event count without truncating nested contracts. Requests run in batches of three and reuse shared caches. Continuation tokens track per-category offsets, preserve failed categories for retry, and are bound to the selected open/closed status. Shared discovery results are cached for 30 seconds. No private provider key is used.

The new topic tabs filter loaded results into Companies, AI & chips, Economy & Fed, Policy & trade, Energy, Healthcare, and Geopolitics. The relevance screen excludes sports matches, entertainment, personal-life questions, short-term crypto-price bets, unrelated weather, and unmatched subjects. It preserves direct corporate questions such as Nike’s stock price or DraftKings earnings even when a provider attaches a sports tag. Mixed events are screened per child contract. Search and optional Kalshi browsing request `scope=stocks`; the UI applies the same screen defensively.

This is editorial screening, not a guarantee of complete coverage or a quantitative importance model. Positive links can be missed and ambiguous labels can be wrong. Category counts reflect loaded matches, not a claim that a category has no other events. Most active sorts by observed volume, not predicted stock-price impact. No claim is made to show every important market. A category failure is labeled partial coverage; a complete provider failure remains an error.

The interface retains Ultimater’s existing dark/light/Blue Steel tokens and Inter type. The changes simplify the search/filters, add keyboard-accessible topic tabs, align probability rows, collapse secondary source information, and show one contract per event initially with an explicit Show all control. Rules, deadlines, source links, pagination, CSV, pause/refresh, AI context, and expanded reading state remain available.

Verification: 276 JavaScript tests passed, including 32 prediction/relevance tests. Before adding the six explicit inflation/CPI/GDP/recession/tariff/IPO categories, an actual initial Worker response had 23 events and 316 contracts with all 12 original categories checked. Real browser pagination expanded the loaded set to 39 events and 467 contracts. These are snapshots, not fixed catalog sizes. Desktop replay `ev_ba9a93708b9719a1bb90b163064dc8dfd7b179f0162346fbb5be3c1dfd9809f0` and 390 px replay `ev_43a0ff76dfd0c9c31cb9f2692a4100343d78417b945580167a903c7b531ed09b` both exercised macro filters, arrow-key topic navigation, Jensen Huang search, removal of personal bets, an empty basketball search, discovery restoration, expansion/collapse, and pagination without page errors. Impeccable’s mechanical detector returned no findings; Worker dry-run passed.

After adding explicit Inflation, CPI, GDP, Recession, Tariffs and IPO discovery, an actual Worker response returned HTTP 200 with 42 events and 541 contracts across all 18 categories, with no category failures and further pages available. These counts describe the checked snapshot.


## Complementary Kalshi discovery and overlap handling

The board now loads both venues by default. Polymarket keeps the 18-category discovery above; Kalshi uses `GET /api/space/prediction-markets/stock-events?provider=kalshi`. The [public series catalog](https://docs.kalshi.com/api-reference/market/get-series-list) and actual unauthenticated responses were checked before selecting 14 series: Fed decisions, headline and core CPI (monthly and annual), GDP, unemployment, payrolls, jobless claims, mortgage rates, housing starts, and Anthropic/OpenAI/SpaceX IPO timing. An empty series remains empty; it is not filled with invented markets.

The adapter requests two events per series through the [public events endpoint](https://docs.kalshi.com/api-reference/events/get-events), retaining their full relevant nested contracts. The live feed removes settled children that Kalshi may return inside an open event and recomputes the displayed deadline and contract count from the retained live contracts. Each series has an independent continuation cursor; failed series retain their cursor for retry. Requests are sequential within Kalshi and cached for 30 seconds. The board also refreshes loaded pages sequentially to respect the shared upstream concurrency bound. A provider failure preserves the other venue's successful page.

The combined board uses **Polymarket first, Kalshi for gaps**. A Kalshi listing is hidden when its recognized event key is already covered by a loaded Polymarket listing. Matching includes the same Fed decision month/year, the same US CPI month/year and measure (core versus headline, annual versus monthly), named-company IPO timing, and conservative exact-title matches with an event period. It does not add a second venue section to shared events. New pages and refreshes re-evaluate the whole loaded set, so a newly loaded Polymarket match takes priority over an earlier Kalshi listing. Source details report how many overlaps were hidden.

This operates on loaded pages, with conservative matching rather than an exhaustive semantic duplicate detector. Unknown wording may remain separate. Different meetings, CPI measures and companies stay distinct. IPO timing is treated as shared event coverage even if announcement and completed-IPO contracts resolve differently; their prices are never merged. The **Kalshi** venue filter still exposes its full selected catalog with exact contracts, rules and deadlines. CSV and AI context follow the visible feed, so hidden overlaps do not reappear there.

Combined source order interleaves the venues' own rankings. Polymarket USD turnover and Kalshi contract counts are never added or compared as a single activity score. Remote search remains Polymarket-only and is labeled accordingly; Kalshi results can be filtered within loaded pages.

An earlier checked local response returned 20 Kalshi events and 223 active contracts across the selected series with no source failures. The supplemental policy then suppresses recognized overlaps from those results when Polymarket coverage is loaded. Counts change with provider data and pagination.

The options source disclosure was also shortened to **Source details**. Provider, indicative-feed limitations, timestamps, unavailable metrics and fallback information remain inside the expandable disclosure rather than repeating across its summary.

Verification of the supplemental policy: 284 JavaScript tests passed, including matching boundaries and a later-page Polymarket takeover. A live snapshot retained 42 Polymarket events and added 16 of 20 loaded Kalshi events, suppressing four recognized overlaps. Desktop and 390px browser checks confirmed that the shared Kalshi Fed listing was absent, unique mortgage events remained, and the coverage disclosure counted hidden overlaps. The Kalshi venue selection was also verified in the visible browser with all 20 selected Kalshi events accessible. Worker dry-run and design detector passed.


## Scheduled sync and local GitHub pack

The [prediction-events workflow](../.github/workflows/prediction-events.yml) re-discovers new events from the start every 15 minutes (three discovery pages per provider), commits the public snapshot, and publishes a local-pack artifact. This runs on GitHub without a hosted Ultimater Worker or an always-on personal computer. The shared data-write concurrency group avoids collisions with the existing research ledger workflow.

The standalone server uses only Node built-ins. Saved mode reads the newest bundled/GitHub snapshot, shares downloads across pages for one minute, preserves last-good data on outages and marks provider snapshots over 45 minutes old as stale. Search covers the saved selection; closed catalogs and combos require the Worker. Prices remain saved snapshots, never advertised as streaming quotes. Per-venue failure retains its prior successful selection and timestamp. All-provider failure makes the sync job fail while leaving the last published data available.

See [local event pack instructions](local-event-pack.md). GitHub can delay scheduled jobs or disable schedules after repository inactivity; the job status and provider saved times are the evidence of an actual update, rather than the mere existence of a workflow file.

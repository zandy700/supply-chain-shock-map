# Live-data examination — 2026-11-11

Scope: current local app at `http://127.0.0.1:8820/space`, public provider data, and a bounded passive observation of Yahoo AlphaSpace Markets. This report does **not** claim every UI control or Yahoo page was exercised. UI and feature examiners own that wider inventory. No account credentials, private holdings, trades, or paid AI requests were accessed.

## Changes and verification

1. **Alpaca runtime compatibility fixed.** workerd rejects `fetch` with `redirect: 'error'`. The adapter now uses `manual`; its existing non-2xx rejection rejects 3xx without following or forwarding credentials. A real workerd loopback fixture with synthetic credentials failed before (`alpaca_unavailable`) and succeeded after (one indicative contract, price 2.1). No external Alpaca request was made. This proves runtime compatibility, **not** the user's account authentication or market-data entitlement.
2. **Source and check times separated.** Company quote `asOf` preserves the regular-session provider timestamp, including its original precision; `checkedAt` reports the server check. Crypto movers use `asOf: null` because Coinbase bulk 24-hour stats do not contain a trade time, and report `checkedAt` separately. Tape/summary/index normalization preserves available instrument timestamps instead of dropping them.
3. **Unavailable most-active feed has an explicit fallback.** The current Nasdaq market-movers response produced no usable rows. The app now shows up to 25 high-share-volume names from a sample of the 200 largest US companies. The visible notice says **High-volume large-cap sample**; coverage and definition explicitly exclude a full-market dollar-volume ranking. Valid primary most-active rows remain authoritative.

Fresh focused validation: **39/39 tests passed** across Alpaca, markets, and company suites; `git diff --check` passed. Regression cases cover manual redirects and secret-safe errors, timestamp absence versus reported time, zero prices, fallback ordering/coverage, and the counterexample where the primary ranking works. Temporary public route evidence is under `/tmp/pulse-live-route-*.{log,json}`; fake runtime fixture results are `/tmp/pulse-alpaca-runtime-{before,after}.json`.

## Observed live behavior

The US market was closed during this check. No claim of stock movement during an open exchange session is made.

| Surface / panel family | Current observation | Freshness / coverage limit |
|---|---|---|
| Chart; multi-chart | NVDA intraday and BTC-USD 1-minute histories returned 200 | Equity bars are sampled Nasdaq minute prices. BTC current candle is partial; volume remains null. |
| Crypto current candle | Source time advanced from `02:04:39Z` to `02:06:37Z`, close from `73604.39` to `73647.69` | Confirms actual source time and price changed, not only the browser check. Samples may miss intermediate trades; historical candles refresh at most every five minutes. |
| Quote | NVDA 200; after correction source `Nov 11, 2026`, check `02:09:01Z` | Date-only provider time remains date-only; bid/ask and unsupported metrics remain missing. |
| Profile | 200, Nasdaq + SEC EDGAR | Employee/officer coverage unavailable; refresh cadence is not a new filing guarantee. |
| Fundamentals / chartable metrics | Company metrics and statements 200; four recent Nasdaq periods | Longer history and some ratios require Finnhub, currently not configured. Full chart metric history not separately exercised. |
| Analyst | 200, Nasdaq Zacks consensus | Strong-buy/strong-sell split and some targets/history need Finnhub. Per-analyst accuracy unavailable. |
| Peers | 200, 10 peers | Snapshot prices refresh every few hours; valuation gaps explicitly disclosed. |
| Revenue segments | 200, three SEC XBRL breakdowns | Latest filing, not live operating data. |
| Index movers / market summary / tape | Tape 9 instruments; summary 6 groups; 200 | Mixed delayed indexes, ETF proxies, daily Treasury/ECB values, Coinbase. Available per-instrument times preserved. |
| Stock movers | Primary most-active 502 before fix; 200 / 25 rows with labeled fallback after | Share-volume large-cap sample, not all-stock dollar-volume ranking. Trending and every variant were not independently tested in this pass. |
| Crypto movers | 200, 32 Coinbase-priced assets | 24-hour change; bulk source lacks exchange trade timestamp. Market-cap provider can be unavailable; approximate ordering disclosed. |
| Sectors | 200, 11 SPDR sector ETF proxies | Not direct sector-index quotes. |
| Heatmap | 200 | Largest-100-US-company proxy, not exact S&P 500 membership. |
| Themes / theme overview | 34 catalog entries; Housing & Rates 200 / 14 constituents | Constituent membership editorial. Gambling and prediction-market-stock themes confirmed in catalog; not every constituent fetched. |
| Screener / watchlist | Mega-caps 200 / 40 rows; mixed NVDA/BTC quotes 200 | Unsupported preset rejected 400. Watchlist editing is examined elsewhere. |
| News | Market feed 200 / 15 items; actual reader open/back and unread filter worked | Feed item publication times differ from check time. Sources vary by mode. |
| Headline predictions | Source inspection: keyword classification over news | Scenarios, not prediction-market odds or an AI forecast. Full card controls not exercised here. |
| Earnings calendar | 200 / 161 rows for Nov 11 | Nasdaq schedule data; a calendar row is not a validated recording/transcript. |
| Earnings detail | 200, Nasdaq Zacks consensus | Actual results and estimates only where supplied. |
| Economic calendar | 200 / three entries across November–December | App-maintained BLS CPI and FOMC dates only; broader economic releases absent. |
| Options chain / overview / contract detail | 200, 59 strike rows / 25 expiries; actual chain pause, manual refresh, resume worked | Nasdaq delayed. Source quote time unavailable. Underlying regular quote and extended-hours chart can legitimately differ. |
| Unusual options | 200 / five derived contracts | Volume versus prior open interest is a delayed derived scan, not executed transaction flow. |
| Options flow | 503 `flow_not_configured`; explicit subscription explanation visible | Needs Unusual Whales subscription/server key. |
| Alpaca | Status `configured: false`, provider Nasdaq, feed delayed | Private `npm run alpaca:setup` still required. Runtime fixture cannot establish account success. |
| Prediction Markets | Kalshi 200: 3 events / 16 markets; Polymarket 200: 2 events / 458 markets | Both report further pages. This is a page of a public catalog, not every bet loaded at once. Provider/catalog timestamps do not guarantee every quote just traded. |
| Portfolio summary, holdings, performance, allocation | Source/contract inspection only in this pass | No private holdings read; no connected brokerage or quote entitlement inferred. Missing position prices must remain unavailable, not zero. |
| AI recap / Ultimater AI | Local UI explicitly says not set up | No generation request sent; API key/provider activation remains separate. |
| Alerts | Source inspection: local rules, event feed checks | Notification permission and threshold crossing were not exercised. |
| Market video | Source inspection: user-selected video source | No automatic Yahoo TV/media entitlement or live stream inferred. |

## REA observations

REA performed declared local actions in disposable profiles and terminated its own launched browsers. Reference observation was passive. No raw account storage or credentials were captured.

| Evidence | Observed action / result | Limit |
|---|---|---|
| `ev_b2d64469449034b4a98c9b4eed7155c7a8e430c01fbfbe613457e9b183740f2e` | Passive Yahoo AlphaSpace Markets, 5 seconds: overnight session, delayed-price labeling, market/crypto lists, chart/metrics | Attach-window observation only; prior traffic unavailable. No reference refresh cadence or every-page coverage established. |
| `ev_bf9ef95627541345816c4d2afaa67bd411150a973a26a3d1d1775576aee2b6c2` | Local Options: skip onboarding, wait actual chain, pause → Resume pressed / paused text, manual refresh while paused → chain requests with 200, resume | Complete scenario, no page errors. Closed-session automatic polling not claimed. |
| `ev_fdb9beaadf8a122eec5bffc125944db80690a5107d958f9489566680ceedada7` | Local Markets: labeled fallback visible, pause/manual refresh/resume. News: navigate, wait headlines, open reader, back, toggle unread pressed | All 11 declared actions completed; no page errors; no exhaustive filtering/variant claim. |

Earlier exploratory captures `ev_e1621d0796d38589666511dfe8b2c7444fa685d2587c08e8977fe056cbb148c1`, `ev_0fa2efb02bb082b4b162b4cb113bc71135193ea7cffd6743affefe4b02c98541`, and `ev_6ad381e43a4a613b2097a23eb1bb5f6588d32f36ba7b9a436bfe9455ee7522f4` were incomplete (initial loading or an incorrectly scoped examiner locator). They are not passed interaction checks.

## Remaining boundaries

- Stock quote polling cannot remove upstream delays; an open-session observation is still needed to demonstrate stock candle progression.
- Most panels retain last successful data and mark errors/staleness. A successful HTTP check does not prove exchange data is current.
- Polling is visibility-aware. Source inspection shows equity chart/quote checks at 30 seconds, crypto chart 15 seconds, markets/portfolio/options 60 seconds (options regular US session), news 2 minutes, company research 5–15 minutes, earnings 5 minutes, and prediction catalogs 30 seconds. These are client check intervals, not provider latency guarantees.
- Reference Yahoo currently shows an overnight session while the local header says closed. Local data still covers delayed regular and some extended-hours values; overnight exchange coverage/parity is not established.
- Nasdaq option data lacks per-contract source timestamps; API setup remains an account/entitlement task. No claim that Alpaca is enabled is warranted yet.

## Signed-in Pro follow-up — 2026-11-12 UTC

The separately assigned reference tab was passively inspected with REA (`ev_89c7f2c17be2289563569711e13405e14319a2723542a2bdce2df6b052104180`). It exposes four inline stock-mover tabs, four crypto-mover tabs and three Market list settings controls. Account identity and unrelated saved-view values are omitted from this report.

The missing inline mover tabs are now implemented locally using the existing variant/fetch path and shell variant persistence. The title menu remains compatible. Tabs expose selection, roving focus and Left/Right/Home/End keyboard controls. A current local REA scenario clicked **all four stock tabs and all four crypto tabs**, observing the correct selected state after every click with no page errors (`ev_313ed6112b80522f52c3e8533bd30c0a9848809f13d6916c1794be82590fdfff`). This interaction check did not wait for every provider request to finish and does not establish every ranking's source availability.

The controls/markets/refresh regression suites passed **17/17** checks, including a single fetch per selection, no request on active/invalid selections, shared title-menu behavior, keyboard selection/focus and handler cleanup. This count overlaps prior suites; it should not be added to 39 as a unique total.

The initial Pro active attempt was blocked before navigation by CDP target resolution. That bridge issue was subsequently resolved. The successful reference scenarios below supersede that checkpoint; failed discovery/loading/locator attempts are not counted as clicked controls.

### Actual Pro reference coverage

| Surface | Actual completed interactions | Evidence |
|---|---|---|
| Movers | Four stock tabs and four crypto tabs; selected states observed | `ev_06d5a0d2de30426ff6c8b75cef79cad6f5d17824780f9f84c46ed76c35345021` |
| Cross-asset list settings | All three settings menus opened. Nine asset choices exercised across the index menu: Stocks, Crypto, ETFs, Mutual Funds, Options, Futures, Bonds, Currencies, Indices | `ev_c9670fd75cf653f48446e0c01d2299953122417bef2f439f54f3b473576a3dcf`, `ev_f6bc0d18be1fbee1bdf423779098f5cfed3553f2c2d478a0661abcebb8af5ba4` |
| Tab customizers | All five customizers opened: Stocks (6), Crypto (4), ETFs (7), Mutual Funds (5), Options (5). All 27 checkbox controls toggled and toggled back; 66 scenario steps completed | `ev_1c9f19cc930212ad0452af9e679544ba10f1ac450fafe31007e39f794b9b6b7c` |
| News source pickers | Both opened; Ticker, Top News and Market News selected on each | `ev_758c4d2cb9a823c8d8be7024625dc225e1798aca199d2a6cfd90e5bbc51c1b1e`, `ev_404ebd51d8e09cd34f09e8912a659aed06586d2ee459c2c59469b55bfb3b7588` |
| News topics | All five groups opened; all 26 subcategories selected, with corresponding source header changes; 83 scenario steps completed, no page errors | `ev_47b5159114eaebbba4b3dc80661b27425abc2ec01ab4cf61153d45f5b85df582` |
| Article | Opened an article, opened Share article / Copy Link dialog, returned to feed | `ev_a5324783738ff25c9b3c5ec53412cf4164ac92450b3553cfcbcf0b01a6365b21` |
| Ticker picker | Opened feed picker, searched AMD, selected exact equity result, observed added chip, then removed that test chip | `ev_3bb57f046540219baf4c61b8de090c50dbf65af9fb2244523e9548df5f6fdd27`, `ev_404ebd51d8e09cd34f09e8912a659aed06586d2ee459c2c59469b55bfb3b7588` |

Topic subcategories actually selected:

- Markets & Investing: Stock Market News; US Economic News; Earnings Reports; ETF Report; Sector Spotlight; Tariffs; Options Pit; Options Unlocked; Premium News.
- Tech & AI: Technology; Artificial intelligence; Latest Crypto & Bitcoin News; Auto industry.
- Personal Finance: Personal Finance News; Taxes; Housing market.
- Shows & Originals: Yahoo Finance Morning Brief; From the Yahoo Finance Newsroom; Opening Bell Coverage; Closing Bell Coverage; Good Buy or Goodbye.
- Personalities: Warren Buffett; Elon Musk; Jensen Huang; Jamie Dimon; Jeff Bezos.

Selecting a category proves its control and header changed; it does not establish that every response finished, every publisher article is readable, or that the local app has the same content rights. Portfolios/Watchlists entries that could expose private account data were not opened. The reference Copy Link clipboard action and external Open in new tab button were not exercised; the Share dialog itself was observed.

Fast reference checkbox changes can race preference persistence. Final settings were checked again and corrected. **A fresh subsequent navigation** confirmed the original three families and defaults: Index Movers / Indices, Stock Movers with Most Active selected plus Trending/Gainers/Losers, Crypto Movers with All selected plus Most Active/Gainers/Losers (`ev_d76e16c70d79f89bb8ce86f8512c4c44f8d00d833d4334e9b2916ba0f14ec50f`). The news test ticker was removed and both news feeds restored to NVDA / Top News. The original unrelated user tab was not operated.

### Local follow-up changes

News now uses the existing shared ticker autocomplete picker for its inline add control, preserving the fallback form for embedding contexts without that helper. The article reader now has Share article → Copy link with clipboard success/failure feedback, explicit close and Escape behavior. Only a public web article URL is copied; no external sharing service is invoked. A late clipboard result cannot update another article's reader.

Actual local REA: reader open, share dialog, copy action, close, back and shared ticker picker all completed without page errors (`ev_9c1362ac6d0b7bd3057aabb2011d5a0c711ca2877976da8ff1a8b5efcaf35694`). This fast scenario did not wait for clipboard success feedback; independent tests cover successful copy, unsafe protocol rejection, unavailable clipboard and permission failure.

Local news now includes all **26 topic choices in five groups** as text/tag filters over the selected sources' loaded headlines. The default remains All loaded headlines; the existing provider category selector and default source are preserved. Named series use matching words in the loaded headline/summary/tags, rather than assuming access from a publisher name. An empty topic explicitly says the connected sources may not cover it. The dedicated Yahoo editorial source/content universe remains a parity gap; the audit does not relabel a general RSS feed as an equivalent Yahoo feed.

Actual local REA selected **all 26 choices**, then reset All loaded headlines (`ev_a9f5eee454c099f91d203dd7566069b4d448ea08324f65eeb8d9f52a92916aa9`, 32 completed scenario steps, no page errors). The positive Jensen Huang case matched 3 of 15 current Nasdaq RSS headlines; Good Buy or Goodbye matched zero and displayed the explicit empty-coverage message. Network observation recorded only the two initial news-feed requests at step 0, with **no additional request caused by a topic selection**. Topic/news tests passed **12/12**, including empty/default behavior, text/tag matches, word boundaries and a counterexample where a Yahoo Finance source name does not grant premium/show coverage.

### Options Flow follow-up

The feature examiner supplied Pro evidence `ev_4c9c68205dcef3e735d3f7e910143235f178c45925808003c7dd628ec73306b8`. Local Flow now exposes **17 configurable columns plus fixed Time**: Ticker, Side, Contract, DTE, Stock, Bid-Ask, Spot, Fill vs Spread, Size, Premium, Volume, OI, Chain Bid/Ask, Legs, Code, Flags, Tags. Visibility, left/right reordering, reset and persistent state are implemented. Chain Bid/Ask and Legs remain unavailable because the adapter does not provide those fields; missing values are shown as dashes. DTE and fill position are explicitly derived. Reported execution-side tags do not imply investor intent.

The current [Unusual Whales endpoint documentation](https://api.unusualwhales.com/docs/api/option-trade/option-trades) allows up to 500 results, so the requested 200 setting is supported. Its server-side `order` accepts only premium and size. Volume and DTE are therefore labeled **loaded page** sorts and never forwarded as unsupported provider parameters. Volume presets All/100+/1000+ map to the existing minimum-volume filter. Trade source time and server check time are separate. Redirects are rejected without forwarding the authorization header.

Actual positive UI verification used the real current module in a clearly labeled, isolated **synthetic fixture** on localhost. All 17 column hide/restore pairs, reorder/reset, 200 setting, volume/DTE sorting, 1000+ filter request, pause/manual refresh/resume completed: **54 scenario steps**, no page errors (`ev_51c7ede0c0f938c2e1ae7788cf1abe83e25fee73e4a14dc38e0f0a07e2e71c7c`). The network showed `limit=200&sort=volume`, then `sort=dte`, then `minVolume=1000`. Valid zero prices/volumes remained zero; missing fields stayed dashes; DTE changed row order correctly. This fixture is not a live provider observation and is not present in the production app.

The actual local app still showed its real subscription gate, alongside all 17 column controls and the new options, without fabricated trades (`ev_d877e1faf2c670375ddac0eb27a910e59c8f8fe0ef97e51cee0c82606a146e0a`). Focused flow/column/news tests passed **19/19**, including a 200-row normalized synthetic provider response, null handling, New York execution-date boundaries, loaded-page sort scope and secret-safe redirect rejection. Source files passed syntax and diff checks. Authenticated provider activation remains unverified.

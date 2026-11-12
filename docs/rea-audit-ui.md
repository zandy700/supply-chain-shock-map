# Analysis, Earnings and Portfolio UI audit

Audit date: 2026-11-11. This is the UI examiner's finite coverage report, not a claim that every Yahoo feature or provider has been reproduced.

## Evidence and privacy

- Inspected the authenticated Yahoo AlphaSpace Gold reference with REA. The earlier unsigned-in reference observations are superseded by the Gold cases below.
- Local desktop checks used a real 1600 × 1100 viewport, including the AI dock open. Phone checks used a measured 390 × 844 viewport. Light and Blue Steel were selected through the display menu.
- Local fixture checks used isolated Chrome on port 9454 and explicitly synthetic HTTP providers on ports 8827/8828. They did not change production data or existing user portfolios.
- Reference account identities, holdings, values, credentials and screenshots were not written to this repository. Complete private REA evidence is retained locally in `/tmp/ui-rea-private-final.json`, with mode 600. The oversized earnings capture was recovered from the retained evidence export rather than repeated.
- REA scenario steps below are actual browser actions. Keyboard sorting is identified explicitly. Source inspection alone is not counted as an exercised control.

## Changes made

1. **Portfolio summary clipping:** long account names forced the account picker onto its own row, hiding the lower two summary values. The picker now flexes and truncates within its row. The portfolio body now includes padding within its height. At 390 px, action padding keeps all four actions on one row. Phone toolbar height fell from 92 to 62 px; all four summary values now end above the panel's bottom edge.
2. **Holdings:** added all 13 observed sortable fields: Symbol, Name, Shares, Price, Chg %, average cost, cost basis, market value, weight, day P&L, day P&L %, total P&L and total P&L %. The symbol stays visible while the table scrolls horizontally.
3. **Calculations:** cost basis combines the selected quantities and recorded costs; weights include selected USD cash; daily percentages use previous market value at current quantities; total returns use recorded cost basis. Missing values remain unknown. Zero basis does not produce an infinite return. Every numeric holdings cell is masked by Hide values.
4. **Movers:** added the observed five-column table, including name, price and sortable daily percentage. All five headers sort in both directions; missing values stay last.
5. **Insights:** added Performance, Asset allocation and Sector allocation views. Current supported holdings/cash drive the available calculations. Sector weights use only supplied classifications and explicitly show incomplete coverage.
6. **Risk:** added Beta, Volatility, Valuation and History views. Unsupported risk/fair-value measures show source gates. Concentration remains a separately labeled calculation. History uses recorded account values, without presenting them as cash-flow-adjusted investment returns.
7. **Fundamentals and earnings styling:** styled the new expandable YoY controls and focus state, and added the earnings share toolbar. The root agent implemented LTM/YoY behavior and earnings image sharing.

The portfolio additions make no new provider requests. They reuse the existing holdings, quote and recorded-history data and refresh behavior.

## Gold reference controls exercised

| Cases | Observed behavior | REA evidence |
| --- | --- | --- |
| `PRO-AN-*` | Expanded Fundamentals; all seven tabs; LTM; Revenue YoY expand/collapse; Annual | `ev_15c036e0e0e802ca14b3c1a27bb9f70c29b26118fb034323719e7d6b55d26b80` |
| `PRO-AN2-*` | All four units; both date orders; Annual/Quarterly; business/geographic segments; Verdict/Targets/Actions/Track record | `ev_152e23a0c0eb6ddd3e42507f98ef1b6a99271defc981299c131ada2de31c96ad` |
| `PRO-AT-*` | Waited for Track record to finish loading; inspected the actual accuracy table, not just the selected tab | `ev_dab2a5d423d0d2479c474312254123b1ec8e16b102cffe0440968094906ebcf9` |
| `PRO-ER-*` | Previous/next/today; all seven days; EPS/revenue estimate tabs; Annual/Quarterly; earnings-card menu | `ev_f7c33de5027a4b5e6cd3aaf245cd94ae84c11cf75ab711272ce8a11e28029347` |
| `PRO-ER2-*`, `PRO-ER3-*` | Five earnings sorts in both directions; call-details expansion; EPS ↔ Revenue card modes; Share earnings preview | `ev_6329dc0f075d2084dda85ad0def5d509c214a1443fe8c5e4c90fe3e68390bcc9`, `ev_1d87d576b852eb8cd2369910610c2f3c155b8d4f9a33c59324721ad3ab3df773` |
| `PRO-PF-*`, `PRO-PF6-*` | All five portfolio tabs; hide/show values; waited for News, Insights, Movers and Risk content; restored the original Movers tab | `ev_8c6d2b755adc49e832fdee9d69066559c98927399c21984c85decdd6161367f8`, `ev_bc7b5591e9b74e46ceaf194cd1861c03a6fee19e20d008d9936752a08648e913` |
| `PRO-PF4-*` | All 13 holdings sorts twice using Enter; expanded cash transactions | `ev_6c0f3b280a6d90c26a9198647b7927873d29261134f609510124351f6d527294` |
| `PRO-PF2-*`, `PRO-PF5-*` | Account-picker UI and New Portfolio dialog preview; no account switching, creation, deletion or transaction submission | `ev_f587f0c44966b9471a437a3d69ee6d7d17411d9d619a43022a308c339a56de12`, `ev_a4f5496edfa31788f8861cd147c2929eb59f5bc892b7447f40e161170961d80f` |

An early reference click on an off-screen Fundamentals tab was intercepted by its horizontal tablist. Expanding the panel allowed all seven tabs to be exercised. An earnings mode-menu selector initially matched a hidden duplicate; restricting it to visible items resolved the automation ambiguity. Neither cancelled steps nor the initial selector failure are counted as successful feature checks.

## Local browser checks

| Cases | Passed checks | REA evidence |
| --- | --- | --- |
| `ER-*` | All seven days; previous/next/today/this-week/next-week; six cap choices; five time choices; Watchlist on/off; all/key columns; search with no matches and clearing it | `ev_c32054614ed892bf5fecb46e4f8d7cfe2a921fdfa20a20229393a94a5b351fb6` |
| `ER-sort-*` and row cases | Six visible key-column sorts in both directions; row expansion/collapse; symbol selection | `ev_d184a02f56e1b307a8678cd6d8f8bd6f45c5077155e746efb5324c2af1302a93` |
| `ED-*`, `EC-*` | All five detail tabs; EPS 4/8/12 quarters; annual/quarterly revenue; all/quarterly/annual forecast horizons; EPS/revenue estimates; inflation/Fed/all and past on/off | `ev_994f4b8af8990815556098a0fae32ba3faa812de9ef09d872e391dd94c8ae061` |
| `ANF-*` | Annual synthetic revenue 160/100 expands to +60.00%/unknown. Eight quarters produce five LTM columns: 260/220/180/140/100. Only the matching prior fiscal date receives +160.00% YoY. Units MM/Auto work. | `ev_e99100096a95a4f2bbe18f10a6a3bcd2ffed4b2e0268d2dc1b363dc89d8288c2` |
| `PF-*` | All 13 holdings headers twice by keyboard; all five tabs; fixture-account switching; cash-only and linked-empty states; privacy. Actual DOM has 13 headers and all 22 numeric cells across two rows masked. | `ev_04cc889af1181af31eaa33ddbee9143fe0d021be8ae8407cff36f7c6146cef0f` |
| `PFP-*`, `PFE-*` | All eight history ranges; custom dates; editor open/add/remove; invalid history produces an alert; Cancel leaves exactly the two fixture accounts | `ev_5ad6219524ac8bd82b44c6344a5d3708d588c5c4b4026f5b40ba74b9a9c8ff50`, `ev_6dc83e984bef8acc78a96f7144e994963bb35f227478651b416b2de95bb2db76` |
| `PFX-*` | All three Insights views; all four Risk views; all eight Risk History ranges; all five Movers sorts twice; no page errors | `ev_f87516131efc74cba4097e5d8b431f5a77692c7ce60e6113f36109f8f0e4c892` |
| `PFS-*`, `PFPV-*` | No-sector gate and partial supplied-sector coverage; unclassified weight remains explicit; privacy masks new views and hides the history plot | `ev_31fb8b3c0bfef727faad36e12fbcefb6c83934eb55fc025840df3881d0d96503`, `ev_ca194f265c0c328a764b310f8bf1ec34c9c6af236bc990a653ff4a75c4de5101` |
| `ES-*`, `ESD-*` | Public earnings share preview, Download image and Copy link invoked. REA cancels observed downloads, so actual PNG completion was verified separately with browser mouse input and downloads enabled. | `ev_e081934ba77c02f0b90ad387985847fff75a26172102dd296a6187f16e063a50`, `ev_7f1692a233819077dcd59e3d3f8a1724d0e725fc456cff9018d57f8e4710037f` |

The separately downloaded synthetic EPS image is `/tmp/ui-share-downloads/MSFT-earnings.png`: a valid 1200 × 560 PNG, 63,594 bytes. The share link contains only the panel type and symbol. Copy was invoked; clipboard persistence was not independently read back.

## Visual review artifacts

These local screenshots use synthetic portfolios/data, not the user's reference account:

- `/tmp/ui-portfolio-desktop-before.png`, `/tmp/ui-portfolio-desktop-after.png` — original clipping and the corrected desktop controls.
- `/tmp/ui-portfolio-mobile-blue-final.png` — all four summary values fit; actual viewport/body width is 390 px.
- `/tmp/ui-risk-mobile-blue-content.png` — every Risk subview remains visible at 390 px; beta gate and concentration are separately labeled.
- `/tmp/ui-earnings-mobile-light.png` — calendar/filter organization and containment in Light mode.
- `/tmp/ui-earnings-share-mobile.png` — 360 px share dialog fits within the 390 px viewport, without horizontal overflow.

The mobile AI pane was also inspected open; it occupies the foreground, with a visible close control. Content screenshots above close it where needed to inspect the underlying page.

## Remaining source and coverage limits

- Yahoo Gold Track record supplies Yahoo accuracy scores and Benzinga targets, including Overall/Direction/Price scores and stale-target markers. Consensus history is not an equivalent accuracy dataset. Local source availability must remain explicit; no rankings were invented.
- Risk beta, return volatility, intrinsic fair value/classification and their historical benchmark comparisons remain gated by missing compatible return/valuation data. Recorded balances and concentration are available but are not substitutes.
- Names and sectors remain unavailable when the source omits them. Sector coverage and unclassified weights are explicit. No ticker-to-sector guesses or additional profile API calls were added.
- The final production annual-income API check returned HTTP 200 with five columns and 17 rows from Nasdaq. The synthetic browser cases above establish UI behavior, not general provider availability or real-time quote freshness.
- Reference cash-transaction display was inspected, but no cash transaction editor or writes were reproduced. The reference account picker also exposes watchlist creation; no Yahoo portfolio/watchlist was created or deleted in this audit.
- File-input UI was inspected, but a fresh CSV file-chooser import was not executed here. Existing import validation tests are separate. Broker connection, credentials, destructive account controls and transaction submission were not exercised.
- This pass tests the listed control families and representative rows/symbols. It does not claim every possible metric row, company, account, file or date combination was clicked.

## Verification

The examiner ran the focused portfolio/workflow suite: **12 tests passed**, covering aggregated basis, cash-inclusive weights, daily/total returns, null and zero denominators, source names, sorting, partial sector coverage and existing refresh/snapshot behavior. The root agent subsequently reported the integrated gate passing: **256 tests, 89 JavaScript files parsed, and a clean diff check**.

Gold reference access is finished. The root agent owns closing the temporary bridge/debugging access and handling any separately authorized cleanup of temporary audit views.

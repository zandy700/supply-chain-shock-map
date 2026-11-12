# Ultimater: Yahoo Gold audit and implementation

Reference: an authorized signed-in Chrome profile with Yahoo Finance Gold, inspected through REA on November 11–12, 2026. The unsigned-in subscription-gate observations from the earlier pass were superseded by this Gold pass. The original Yahoo tab was preserved; temporary browser inspection access was disabled and the compatibility bridge stopped after reference work finished.

## Page and control coverage

| Surface | Actual reference coverage and local result |
|---|---|
| Markets | Stock/crypto tabs, all nine asset settings and five tab customizers. Local inline tabs, settings and persistent title-menu selection work. Stocks/crypto/indices reuse their existing feeds; ETFs, Treasury yields and ECB rates are explicitly labeled samples. Mutual-fund, market-wide options and futures feeds show source gates. |
| Analysis | Seven fundamentals tabs, LTM, metric expansion, units, date order, comparisons and analyst tabs. Added rolling LTM and fiscal-date YoY rows. Chart review exercised all 48 Gold studies, styling sections and source controls; local adds Baseline/Percent, rendered appearance controls and study colors/sources. |
| News | Both source pickers, 26 topic choices, article reader/share and ticker search. Local topics filter only loaded headlines from connected sources; dedicated Yahoo editorial feeds are not claimed. Shared ticker search and copy-link UI work. |
| My Portfolio | Holdings, News, Insights, Movers, Risk, privacy, account selection, holdings sorts and cash display. Local has 13 sortable holdings columns, five-column Movers and the observed Insights/Risk subviews. Calculations use existing holdings/quotes/history; missing sectors, beta, volatility and proprietary valuation scores remain explicit. |
| Earnings Hub | Days, navigation, filters, sorts, details, EPS/revenue, estimates and share preview. Rebuilt responsive layout and added public earnings image preview, PNG download and configuration-only shared links. |
| Options | Actual chain menus, expiries, contract details, columns/order and Flow settings. Fixed ancestor-selector interception that swallowed clicks. Flow has 17 configurable columns plus Time, 200 results and appropriately scoped sorting. Live transaction Flow still needs its provider. |
| Themes | All 24 Gold theme routes and all 34 local routes visited. Sector views expose Companies, ETFs and an explicitly unavailable mutual-fund source panel. Ten additional local stock themes remain available. |
| Global shell | Create/template flows, disposable view creation/rename/icon-picker/catalog, Help, Scout expansion/collapse/hide/show/legal/history and search opening. Individual icon choices, every catalog insertion, account-changing actions and every possible search/parameter combination were not exhausted. |

Detailed finite ledgers, source boundaries and REA evidence identifiers are in [feature audit](rea-audit-features.md), [UI audit](rea-audit-ui.md) and [live-data audit](rea-audit-live-data.md). Successful replay steps are distinguished from loading/selector failures; source inspection alone is not counted as a click.

## Additional integration fixes

- Renamed visible branding, titles, onboarding, assistant and backend assistant messages to **Ultimater / Ultimater AI**. Existing storage keys and workspace formats remain compatible.
- Narrow panel headers preserve readable titles; secondary actions remain available in More. Grids stack according to available workspace width, including when a desktop AI dock leaves a narrow center column.
- Mover title menus follow the selected asset family and retain the selected tab after reload. Invalid/all-hidden selections cannot remove every accessible tab.
- Source timestamps are separated from check times. Daily chart period dates remain on their UTC trading date instead of displaying as the previous local day; actual intraday/sample times are labeled Eastern.
- Fixed Alpaca requests rejected by the Worker runtime's redirect mode. Redirect responses cannot forward private credentials.
- Repaired unavailable stock-mover data with an explicitly labeled high-volume large-cap sample, preserving valid primary-feed rows.
- Crypto source timestamps and prices advanced during live checks. Closed-session stock polling was not represented as proof of live stock trading updates.

## Verification

- **257 tests passed; zero failures.** All 89 JavaScript files parsed after the final chart and mobile-header fixes. `git diff --check` passed.
- Actual nine-asset local settings selection: `ev_2547a93f85a75198e1f645a835aefbf04a8a3066a9d6a9cc9db54a5f1d85bc7e`; real Treasury/ECB/ETF sample responses and labels: `ev_61fd7fa5e6d687d5b16f1131284ac6e96f94dc9b6e1e7d552051382dc5bee016`.
- Local image preview/download action: `ev_2df594c00dd4be87d750d52c83552af115ba677d9edb8f8314ead83b691a26e2`. REA cancels captured transfers; a separate allowed-download browser check produced a valid **1200×560 PNG** from clearly labeled synthetic earnings data. The app reports download initiation, not filesystem completion.
- LTM/YoY and portfolio positive/partial/empty cases used isolated labeled fixtures. Production annual and LTM Nasdaq income requests subsequently returned HTTP 200 with 5/1 columns and 17/16 rows respectively; prior intermittent provider failures are retained in the detailed audit history.
- Actual 1200 px workspace check after final stacking: document width 1200, all four Analysis panels 544 px wide, with readable Quote/Analyst titles. Phone and desktop checks and exported screenshots are linked in the reviewer reports.
- Final 320/390 px checks found no horizontal document overflow or clipped header buttons. At 320 px, REA toggled the AI dock twice and opened chart styling without page errors (`ev_401eb75e2b6064d0a4d5b2faf777c8587246ed7d9e4661ad69147e0376143a80`). The chart canvas and plot now share the same minimum height, preserving axes when styling is open.
- Native preview refreshed to `Markets · Ultimater` at `/space?view=markets`; the narrow preview has the AI dock collapsed.

## Remaining limits and cleanup

This is not a claim of complete Yahoo data or every possible account/row/parameter permutation. Yahoo accuracy scores, intrinsic fair values, dedicated editorial feeds, full-market feeds without adapters and live AI/transaction providers are not fabricated. Provider keys/subscriptions and additional data coverage are separate from implemented controls.

After the user delegated the cleanup decision, removed the two audit-created Yahoo views, **REA Audit Temp** and **New View**, through their respective view-action menus. Yahoo confirmed each deletion and offered Undo. Original saved views and financial accounts were untouched. All four temporary audit tabs were closed, leaving the user's original Yahoo tab open; Chrome debugging is off.

Changes remain local and uncommitted. Nothing was deployed or pushed. A progress summary was delivered to the existing Claude mailbox; receipt was not acknowledged.

## AI button follow-up

Replaced the top-right panel icon with a visible **Ask AI** button (**AI** at phone widths). Fixed assistant/shell state coordination so the header button and floating launcher reopen an assistant hidden with its close button. Preserved collapse/expand behavior and the explicit missing-key message. Actual desktop and 320 px REA scenarios passed without page errors: `ev_00d43531250ea8d8568ed0c18dc981581b797bb0f9bdc4e43359f7a3a9571add`, `ev_12e38bdce119d0d5fe09cd07fbe49a87c6597e7e6c4f468b6d65f0abb05f0a4f`. All 21 focused AI tests, changed JavaScript syntax checks and diff check passed.

Placement follow-up: per the user request, moved **Ask AI** from the header to a fixed bottom-right launcher on desktop and phones. It hides while the assistant is open and returns when closed. Suppressed the duplicate integrated Scout launcher and kept mobile Search clear of the button. Desktop and 320 px open/close scenarios passed without page errors: `ev_8be445ec8728bb645b797eea185f931f87d470b84d67af8b256ea6473c8dd51c`, `ev_db4c91504c3b94f21c46788037e07d5a1421f2ce56aea4fd8dc7ab994a9b2353`. Changed JavaScript syntax checks and diff check passed.

## Local Alpaca activation

After the user completed private credential setup, restarted the local Worker on port 8820 using the existing persistence directory. Configuration now reports Alpaca indicative, and an actual SPY options-chain request returned HTTP 200 from Alpaca without a Nasdaq fallback: 5,000 contract snapshots, 2,608 strike/expiry rows and 16 expirations. Coverage is explicitly partial because the existing five-page cap was reached. The latest returned quote timestamp was `2026-11-11T21:14:59.999591435Z`; this is observed source data, not proof of open-market streaming. Free indicative options data is active locally; stock charts retain their existing sources, and no hosted secrets or deployment were changed. Keys were not printed or committed.

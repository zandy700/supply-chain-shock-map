# Feature audit: charts, options, and themes

Audit date: 2026-11-11. Product: Ultimater, local preview at `http://127.0.0.1:8820/space`.

This is a finite interaction ledger, not a claim of pixel or data parity. Reference checks were repeated on the user-authorized Yahoo AlphaSpace Gold session. Private account names, emails, holdings, cookies, storage values, and credentials are excluded from this report. Existing My Views were not edited. The temporary chart studies were removed; the initial options expiry/contract/position were restored, and the audit tab returned to Analysis.

## Observed fixes shipped

- Options-chain clicks previously matched the shell's ancestor `#sp-grid[data-view=options]`. Columns, expiry navigation, and contract details were intercepted before their handlers ran. The layout selector now matches an actual button inside the chain.
- Chain columns now preserve visibility and order, offer Up/Down and Reset, and reject hiding the last visible column. Keyboard navigation skips disabled move buttons.
- Study cards separate category, indicator name, and parameters. Removing Volume by Price clears its explanatory message.
- SMA, EMA, WMA, DEMA, and TEMA support Close/Open/High/Low price bases. All 52 local studies have an individual color control. These affect the plotted series.
- Added Baseline charts with an editable positive price and reset, plus an independent Percent display mode. Log and Percent switch each other off.
- Rebuilt chart style controls into eight collapsible sections: Chart frame, Text watermark, Price scale, Time axis, Candles & bars, Line & mountain, Comparison series, Metrics.
- Added rendered background gradients, crosshair color, ticker/interval/company-description watermarks, separate price/time axis colors, gain/loss last-price badges and text colors, and metric opacity. Existing presets, ten comparison colors, line width, and line style remain.
- Chart style and study editors close each other. At narrow desktop widths they shrink and scroll rather than pushing the price plot and source footer outside the panel.

## Local interaction ledger

“UI” below means an actual browser interaction/capture. “Fixture” means a deterministic local browser response, not a live market-feed claim.

| Case | Controls exercised | Observed outcome / limit | Evidence |
|---|---|---|---|
| CH-01 | Customize open/close, six presets, dashed line, reset | All successful. First scenario subsequently stopped on an ambiguous type locator; later cases use the scoped select. | `ev_f30d0cc54ebeae9dd0fca3eb139366c2a5ae2f1504e9bd2d2faf1be6b8a61c17` |
| CH-02 | Line, Area, Candles, OHLC, Heikin Ashi; Log, Volume; pause/manual refresh/resume | Successful actions before the explicitly disabled extended-hours control was reached. Extended hours is unavailable on the 1Y daily source, not a working toggle in that state. | `ev_82eabecd5cddcf58cdb4b39d6097da788f56889b172a09ccbb2b10fbc2a06f51` |
| CH-03 | All 52 study checkboxes, each on then off | 104 successful toggle actions. No studies left selected. | `ev_99831699707046e366dd6d760f6a62270d6e9b64e194ff2f57f0b67bc95dd56e` |
| CH-04 | Baseline selection/value/reset, all six non-gated display toggles, search, SMA period, manage/remove, Volume by Price on/off | All 29 declared control actions successful; stale profile warning absent afterward. | `ev_9a5aa4408cee6257f541d98ec27c508bf4da4e0ae00dcde79f50701190d1fbc7` |
| CH-05 | Eight style sections, Gradient, three watermark parts, dashed line, width/opacity keyboard adjustment, SMA Open basis, Percent, Baseline | All 22 declared actions successful. | `ev_d15f85a2a394a1275ab05c02a56a1bda7bb60d205bd95bfc115f3a2c1e02ca3e` |
| CH-06 | All 12 drawing primitives with distinct pointer coordinates | Horizontal, Vertical, Trend line, Fibonacci, Channel, Pitchfork, Rectangle, Circle, Ellipse, Measure, Time range, Text each created a drawing. Select/edit/apply/delete/clear passed. | Controlled CDP browser run, `/tmp/feature-draw-results.json` |
| CH-07 | Replay slider, Play/Pause, speed, Next bar; invalid comparison; disposable chart set save/load/delete | Replay halved visible bars and advanced; invalid ticker rejected; disposable set removed. Zero runtime exceptions. | Same controlled browser run |
| CH-08 | Actual canvas behavior of newly added controls | 29 fixture assertions passed, including OHLC source changes, selected study stroke color, gradient pixels, watermark text, both price badge directions, axis/crosshair colors, metric alpha .25 and 0, Percent/Log exclusion, invalid baseline rejection, reset, and CSV row count. | `/tmp/feature-style-results.json` |
| OP-01 | Straddle/Calls/Puts, 5/10/20/all strike windows | Successful UI actions. Initial Columns attempt exposed the ancestor-selector defect. | `ev_6b8093b21642acf09acb9c40b9c6f290fb24fb37df4e2ba45f3c4fe72cf88dba` |
| OP-02 | Fixed Columns, IV visibility, Escape, expiry next/previous, contract open | All successful after the handler fix. Real Nasdaq fallback chain populated. | `ev_34fce60081b69406796a9b5ca56593d36391be24cd5a5ddd854920eb1bffde67` |
| OP-03 | Contract Long/Short/source details/close; overview expiry; detail type/expiry/strike; chain pause/manual refresh/resume; flow pause/refresh/resume/filter/apply | All declared actions successful. Local Flow remains a subscription/source gate, not a live transaction tape. | `ev_5dfc0962695436e7090927e7ce5387709c123f857cc05df2c0cae63777e15e68` |
| OP-04 | Chain move Bid down, hide Ask, reset, hide all but Bid, attempt to hide Bid, reset/Escape | All UI actions successful. Last column remained checked. With chain data loaded, headers became Ask/Bid after reorder, omitted Ask after hide, then returned to Bid/Ask after reset. | `ev_a2e9198eb762b419a95f2e4ec756a914eaf854e21779015070fe832a88253175` |
| TH-01 | Every one of 34 local theme sidebar routes | All mounted Chart, theme News, Theme Overview, Heatmap, Multi-chart regions. Sector routes also mounted the then-existing ETF overview. This does not assert every upstream quote/news item resolved. | `ev_9c72e35dadce736fda08763d9723be5a4557cf7c16d7afc894c62bc3899109b3` |

## Gold reference interaction ledger

| Case | Actual reference actions | Observed outcome / limit | Evidence |
|---|---|---|---|
| REF-CH-01 | Open/close Chart type, Interval, Display mode, Indicators, Fundamentals, Customize, More | All seven menus opened. Gold exposes five chart types, Linear/Logarithmic/Percent, and the 48-study catalog. | `ev_33d0f11e8e221f9f93e2cf15c096e12512ae9ad4e0606fe02914548651c84d58` |
| REF-CH-02 | Expand all eight Customize sections; activate SMA | Every section rendered actual controls; SMA appeared on the chart. | `ev_3afe16f1ae47a2bdb7cf454882a03cdf24f5d1eb91067249324573fadd67c0a8` |
| REF-CH-03 | Manage all, edit SMA, change period 20 to 25, remove test SMA | SMA editor exposed source Open/High/Low/Close and ten colors. Changing period re-rendered/closed the editor; a subsequent attempted source selection in the closed editor timed out and is not counted as a successful reference source change. Removal succeeded. | `ev_1b962faff806f11ca5ea1185859653533ed2acacd07ada68b83a5b55bb654b80`, `ev_c8a8c4d7c233e782010cd52c2d7722b4fdeb794040bddbe9b439b073212dc8b9`, `ev_0694181df0a66bdf7907638d4aa73e0b616099b17cc73aebf30b45ef1a1de183`, `ev_0a76436832d3e5b522776c1865b298a3bb8831c8806dda3f309c76a92a9a0a6b` |
| REF-CH-04 | Activate all 48 study choices, then remove them | All choices were exercised across batches. Gold caps simultaneous oscillators at three: after MACD/Stochastic/Slow Stochastic, Momentum and other oscillators were disabled with “Cap” while SMA/VWAP remained enabled. Later batches added and removed each oscillator individually. This is not a 20-total-study cap. | SMA in REF-CH-02; next 19 in `ev_fa262813327041ccbb848d8da424262301918ea597887cd03f839046415d5a9f`; next 3 in `ev_f0180a597585b99ea9d90d43e9660f19f571eeb7b9cb598fda5af3b5251616e4`; next 15 in `ev_083116a28ae48722bf7dd4f924529c2d29bc0a7f65b5edfba0f30253c35840bf`; final 10 in `ev_eca23e7e1757fe8ac3d94dc5383285ed89a3ffc155516d80bd7bf9383e31ba56` |
| REF-CH-05 | Remove final TRIX and restore chart | Original zero active studies confirmed by “Indicators: Ind”, without an active count. | `ev_bd850de266c770277f5726ade64255b77b041c858eeb646b77d94e16f89fafc4` |
| REF-OP-01 | Chain Columns; expiry next/previous; Flow Filters, Volume, Results, Sort, Columns; pause/refresh/resume | All successful. Flow has seven presets, results 25/50/100/200, time/premium/volume/size/DTE sorts, and 17 configurable columns plus fixed Time. | `ev_4c9c68205dcef3e735d3f7e910143235f178c45925808003c7dd628ec73306b8` |
| REF-OP-02 | Next expiry; $175 Call; Short/Long; $175 Put; Ask Flow then restore All | All successful; persistent Contract Detail updated. | `ev_f1dce17e356e8f321f39a1176bb6fa1b5d4a49decff56cd521df4737f1fb0060` |
| REF-OP-03 | Restore original Nov 11 expiry, $120 Call, Long; return Analysis | All successful, chart still zero studies. No My View edits. | `ev_f42aba64e6a79e51a11a37d7d3909e0ba9908f506d966fe089942ed2fdb5a77c` |
| REF-TH-01 | Every one of 24 Gold theme routes | All route buttons clicked with post-navigation captures. Several captures still contained source loading states; successful navigation is not full source resolution. | First five: `ev_793d12d2873dc19ec77df9be7e4ebf6caa09fa5491b1358efaa15f1e64b10d9c`; other 19: `ev_2730ccd9d0354866dbff096ae9209f590b0cac3152acb266f93069813ccdcb86` |

All retained REA scenarios report missing event coverage even when their action outcomes and requested accessibility captures succeeded. They are therefore incomplete Evidence and are not equality-eligible. Failed/cancelled actions in exploratory runs are not counted as tested.

## Theme coverage

The 24 reference themes all have local counterparts:

Space Race; Magnificent Seven; Crypto; AI & Tech; Financial Services; Consumer Cyclical; Cybersecurity; Aerospace & Defense; Autos & EVs; Travel; Housing & Rates; Pharma & Biotech; Clean Energy; Gambling (local: Gambling & Betting); Private Markets & Alternatives; Futures & Derivatives; Communication Services; Industrials; Healthcare; Energy; Consumer Defensive; Basic Materials; Utilities; Real Estate.

Local-only additional stock themes: Prediction Market Stocks, Homebuilders, Home Improvement & Building Products, Semiconductors, AI Data Centers, Power Grid & Electrification, Nuclear & Uranium, Robotics & Automation, Quantum Computing, Critical Minerals.

Reference sectors contain companies, ETF, and mutual-fund source panels. Local sector mutual-fund coverage is explicitly unavailable from the connected sources; the root agent added the corresponding unavailable panel/selector after this route pass. No mutual-fund prices were fabricated.

## Responsive and runtime verification

- 1600px, AI open at 381px: actual viewport 1600, document scroll width 1600, chart footer ends at the chart boundary.
- Final integration at 1200px, AI open at 381px: actual viewport/document width 1200, narrow workspace panels stack, and chart plot/canvas both remain 240px with the style editor open. Footer bottom 693px remains inside panel bottom 694px. This supersedes the earlier 130px plot check, which exposed cropped canvas axes. Overflowing study panes now permit native wheel scrolling; Ctrl/Meta+wheel retains zoom.
- Final phone checks: viewport/document widths match at both 390px and 320px; all top header actions fit inside the viewport. At 390px with AI closed, chart plot/canvas both remain 300px. REA clicks toggled AI open/closed and opened the style editor at 320px without page errors: `ev_401eb75e2b6064d0a4d5b2faf777c8587246ed7d9e4661ad69147e0376143a80`.
- Real-source screenshots: [desktop](screenshots/ultimater-chart-style-desktop.png), [1200px](screenshots/ultimater-chart-style-1200.png), [mobile](screenshots/ultimater-chart-mobile.png).
- `node --check` passed for chart.js and options.js.
- `node --test worker/space/chart.test.js worker/space/options.test.js worker/space/options-refresh.test.js`: 56 passed, 0 failed.
- The deterministic response browser was closed before real-source screenshots. The screenshot browser had no fixture fetch injection.

## Source and coverage limits

- Local total-return history and historical dividend/split markers remain explicitly unavailable. Daily history does not identify extended-hours bars; that control is disabled in the 1Y state.
- Metrics requiring unavailable fundamental/consensus/history sources remain disabled with reasons. Available Nasdaq statement series remain selectable; no private provider key was entered during this audit.
- Alpaca activation still depends on private setup. A visible chain here was supplied by the labeled Nasdaq fallback. Missing contract quote timestamps remain unavailable rather than inferred from the fetch time.
- Transaction Flow needs the configured Unusual Whales subscription/key. The Flow expansion and its fixture verification belong to the live-data examiner's follow-up report; no claim of live Flow activation is made here.
- This pass does not exhaust every numeric parameter boundary, every combination of the 52 local studies, every indicator-specific source/color permutation, every timeframe/interval data response, or every share/download/account action on every route. Native drawing geometry, key chart/study/style controls, options interactions, and every theme route have the finite coverage listed above. Paid/account/subscription/trading actions were not executed.

## Independent review of root-owned changes

- MKT-REVIEW-01: Reproduced a real asset-switch defect: Stock Movers switched to Crypto still offered stock variants in the title menu; clicking Gainers changed the header while the toolbar stayed on crypto-all without fetching. The root agent changed the runtime variant options/validation. Retest passed: the Crypto menu contained All/Most Active/Gainers/Losers, title selection updated both header and toolbar to crypto-gainers, and exactly one real crypto-gainers request was issued. ETF/sample title menus were disabled as intended.
- MKT-REVIEW-02: A reload of the persisted cross-asset state initially kept crypto-gainers selected but omitted Gainers from the title label. The root agent added mount-time variant synchronization. Retested after the existing settings save debounce completed: a fresh reload retained both “Crypto Movers — Gainers. Change view” and the selected crypto-gainers toolbar tab. Passed.
- EARN-REVIEW-01: Read-only review of earnings shareImage and the shell PNG path found no additional material defect. Public symbol/title/source values are escaped, the snapshot uses self-contained SVG rather than external image resources, PNG conversion checks decode/canvas/blob failures, and the Blob download helper preserves binary content. The separate UI reviewer verified the exported PNG file; this independent review did not repeat that download.

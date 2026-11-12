# AlphaSpace feature gap audit — November 11, 2026 (Pacific)

Historical baseline. See [expanded feature status](space-feature-status.md) for the subsequent implementation and remaining source/service boundaries.

The previous claim that Pulse Space's remaining features were completed was too broad. The tests cover the implemented subset, not parity with AlphaSpace. This audit is a new reference inspection, not an extrapolation from those tests.

## Evidence and coverage

REA connected to the existing signed-in reference browser. Fresh captures covered Markets, Analysis, News, My Portfolio, Earnings Hub and Options; chart style, toolbar, fundamental and indicator menus; create-view choices; options-flow filters; and selected portfolio tabs. Only navigation, menu and tab actions were performed. No Scout prompt was submitted. No reference portfolio, view or alert was created/deleted.

The sanitized evidence index is [alphaspace-rea-audit.json](alphaspace-rea-audit.json). It contains REA Evidence IDs and control inventories without credentials, account identities, positions, balances or article content. Some view captures were still loading. A Risk-tab click timed out: its existence was observed but its contents remain unverified. Control presence does not establish every control's semantics.

The code comparison also used the earlier saved chart screenshots and shell inventory. Those historical observations are distinguished from fresh REA observations below.

## Confirmed substantial gaps

| Area | Reference feature | Pulse Space status | Evidence |
|---|---|---|---|
| Portfolio | Holdings / News / Insights / Movers / Risk workflow | Separate summary, holdings, saved-value history and allocation panels only. No equivalent portfolio-wide news, insights, movers or risk workspace. | Fresh core views and selected portfolio tabs |
| Portfolio | Hide values | No equivalent privacy mask across portfolio panels. | Fresh core views |
| Portfolio | Sort holdings by price, day and total P&L | Fixed holdings columns without sortable controls. | Historical portfolio inventory + current source |
| Options | Options Flow Screener and persistent Contract Detail panel | Unusual-options scan uses delayed volume/open interest. It is not a transaction flow feed; contract detail is a popup, not a dockable linked panel. | Fresh Options view + current source |
| Options | Ask/bid flows, large-premium ask/bid trades, ETF ask flows, large multi-leg trades | Missing trade-level filtering and supporting feed. | Fresh flow filter menu |
| Options | Pause live updates, newer/older pages, volume/result-count/sort controls | No equivalent flow workflow. | Fresh Options view |
| Fundamentals | Operating Metrics, Valuation Multiples, integrated Segments tabs | Four statement/metrics tabs; standalone segment panel is not equivalent. | Fresh Analysis view + current source |
| Fundamentals | Add comparison; Auto/K/MM/B units; newest/oldest date ordering | No equivalent comparison or user-controlled units/order. | Fresh Analysis view + current source |
| Analyst ratings | Track record | Verdict, Targets and Actions exist; Track record is missing. | Fresh Analysis view |
| News | Live/video panel | News and prediction panels do not replace the reference's TV panel. Video availability/licensing needs an independent source. | Fresh News view |
| Chart style | Default, High contrast, Mono, Ocean, Accessible, Terminal presets; detailed frame/watermark/axes/candle/line/comparison/metric settings | Missing Customize Style workflow. | Fresh chart-style dialog |
| Chart price | Extended hours and total-return mode | Missing user-selectable modes and validated supporting data/adjustments. | Fresh toolbar menu |
| Chart overlays | OHLCV/hover legend, dividend/split events, watermark and independent horizontal/vertical crosshair toggles | Existing chart/volume/crosshair drawing is a subset, without equivalent controls. | Fresh toolbar menu |
| Chart fundamentals | Annual/Quarterly, Bars/Line/Area; income/cash flow, valuation, growth, margin metrics | One basic quarterly metric line; many reference metrics missing. | Fresh fundamentals dialog + current chart/backend source |
| Chart indicators | Broad categorized catalog, searchable configuration and Manage all | Current studies are a smaller catalog; having an Indicators control is insufficient. | Fresh indicators dialog |
| Drawing tools | Vertical line, channel, pitchfork, rectangle, circle, ellipse, measure, time range, text; selection/edit/delete and candle snapping | Horizontal/trend/Fibonacci plus clear-all is a subset. | Fresh passive controls + earlier drawing-tools screenshot + current source |
| Replay | Playback controls/speed/date workflow | Slider and next-bar only. Exact fresh replay semantics still need inspection. | Historical screenshot/source comparison |
| View management | Icons, sidebar layout-lock, section/custom-view ordering | Missing or simplified. Theme-item up/down ordering does not cover section/custom-view ordering. | Fresh passive controls + historical shell inventory + source |
| Panel actions | Share, XLSX export, header Add comparison/Add ticker, attach-to-AI toggle | CSV, link groups and immediate AI prompt exist; workflows differ. | Fresh controls + historical shell inventory + source |
| Search | Command mode and staged view/ticker action menus | One-step symbol/direct-command search. | Fresh search palette, command mode and second-step view actions + source |
| Onboarding | Goal-specific and scratch-view tours | One generic tour. | Historical shell inventory + source |
| Appearance | Blue Steel and reference theme cycling | Current system/dark/light only. | Historical shell inventory + source; fresh theme menu pending |
| AI context | Include linked holdings in portfolio research/recaps | Current holdings context reads manual portfolios only, omitting linked broker accounts. | Current source integration review; reference AI execution not tested |
| AI research | Financial statements, options and portfolio lookup breadth | Current server tools cover quotes/history/company news/earnings dates and workspace actions only. | Source inventory; reference tool internals unknown |
| Notifications | Feed filters, sorting, browser permission and multiple event categories | Device-local price thresholds only. | Historical shell inventory + current source |
| Persistence | Cross-session/device account-backed workspace state | Browser-local persistence only. This is an architectural gap, not a configuration toggle. | Documented current architecture; reference backend semantics not freshly retested |

## What should happen next

1. Re-inspect the remaining deep interactions: portfolio risk/insights content after settled loading, chart replay, drawing edit lifecycle, ticker search submenus, full add-panel catalog, theme/settings, earnings estimate details and Scout attachment behavior. Record unknowns rather than filling them with assumptions.
2. Implement portfolio navigation/privacy/movers and the missing fundamentals workflows first; the user's original priority was portfolio tracking and stock analysis.
3. Implement the chart controls and drawings against a checklist with a behavior check for each item. Include a boundary test with many oscillator panes: current height allocation may exhaust the price plot (source inference, not reproduced).
4. Add the remaining workspace actions/search/tours.
5. Resolve data and architecture dependencies explicitly: actual options transactions, analyst track records, adjusted returns/corporate events, video rights and cross-device synchronization cannot be satisfied by adding a button or relabeling a delayed feed.

No product functionality was changed during this audit. Pulse Space should be described as a working partial implementation until the inventory is reconciled against behavior, data coverage and explicit exceptions.

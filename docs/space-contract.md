# Pulse Space — build contract

Pulse Space is Watchlist Pulse's desktop research workspace, modeled on the layout and feature set of Yahoo Finance AlphaSpace (traced 2026-11-11 with REA from a signed-in trial). It is our own product: **no Yahoo name, logo, or branding**, and **no Yahoo data endpoints** (query1.finance.yahoo.com etc.). Page: `web/space.html` (vanilla ES modules, no build step). Existing app pages are untouched.

## Trace evidence (local, not committed)
`/private/tmp/claude-501/-Users-andy/562efa19-b80b-4fe6-9bd0-9493ee592e57/scratchpad/alphaspace/<view>/`
- `screen.png` (full res) / `screen-small.png` (1600px) — screenshot of each view
- `ax.txt` — accessibility tree (role: name) — the authoritative list of visible controls and labels
- `requests.txt` — API requests the view made (shape only)
Views: `markets analysis news my-portfolio earnings options mag-7 crypto-major sector-technology`.
Deeper menu/dialog inventories appear over time in `.../scratchpad/alphaspace/inventory/*.md`. Check them before you finish.
The account owner's name and email appear in screenshots — never copy them anywhere.

## Layout (from the trace)
Top bar: logo · ET clock + date · market session badge (PRE-MKT / OPEN / AFTER-HRS / CLOSED) · `+ Create view` · alerts bell · display settings · help · fullscreen.
Ticker strip: region selector (US MARKETS ▾ …) + scrolling index/commodity/crypto quotes.
Left sidebar: VIEWS (Markets, Analysis, News, My Portfolio, Earnings Hub, Options) · THEMES (24, View more/Show less) · MY VIEWS (+) · collapse toggle · footer (legal links, account card).
Center: view title · linked-symbol chips (`● NVDA ×`, `+`) · `Clone View` · grid of panels.
Panel chrome: symbol label + `+` link-group chip · title · optional variant ▾ · download · lock · Ask-AI sparkle · expand. Floating `Search ⌘K` pill at bottom center.
Right dock: AI assistant ("Ask Scout" in Yahoo; ours is **Pulse AI**) — greeting, suggested prompts, input, "AI can make mistakes" note, menu, dock/undock, expand.

## Ownership (only edit files you own; never run git, never deploy)
| Builder | Frontend | Worker (`/api/space/<domain>/…`) |
|---|---|---|
| shell | `web/space/shell.js`, `shell.css`, `views.js` (new), `tour.js` (new) | — |
| chart | `web/space/panels/chart.js`, `chart.css` | `worker/space/chart.js` (+ `.test.js`) |
| company | `web/space/panels/company.js`, `company.css` | `worker/space/company.js` |
| markets | `web/space/panels/markets.js`, `markets.css` | `worker/space/markets.js` |
| news-earnings | `web/space/panels/news.js`, `news.css`, `panels/earnings.js`, `earnings.css` | `worker/space/news.js`, `worker/space/earnings.js` |
| options-portfolio | `web/space/panels/options.js`, `options.css`, `panels/portfolio.js`, `portfolio.css`, `web/space/alerts.js`, `alerts.css` | `worker/space/options.js` |
| ai | `web/space/scout.js`, `scout.css` | `worker/space/scout.js` |
Shared, read-only for builders (ask the lead for changes): `core.js`, `tokens.css`, `panels.css`, `panels/index.js`, `main.js`, `dev.html`, `worker/space/router.js`, `worker/space/upstream.js`, `worker/index.js`.

## Panel API (`web/space/core.js`)
```js
import { registerPanel, api, links, bus, fmt, esc, toCSV, state, store } from '../core.js';
registerPanel('quote', {
  title: 'Quote', category: 'Company',      // category groups the "Add panel" catalog
  defaultSize: { w: 3, h: 8 },              // 12-column grid; h in 40px rows
  symbolLinked: true,                       // follows its link group's symbol
  variants: [{ id: 'most-active', label: 'Most Active' }], // optional, shown as title ▾ menu
  mount(el, ctx) {
    // render into el; return the instance:
    return { onSymbol(sym) {}, onVariant(id) {}, csv() { return toCSV(rows) }, scoutContext() { return 'NVDA quote: …' }, destroy() {} };
  }
});
```
`ctx`: `symbol` (getter, current linked symbol), `state` (getter; persisted per panel instance), `setState(patch)`, `setTitle(text)`, `setSubtitle(text)`, `openSymbol(sym)` (sets this panel's link group symbol — use when a row is clicked), `variant`, `api`, `links`, `bus`, `fmt`, `esc`, `toCSV`, `ui` (= `state` helpers), `locked`.
Shell calls `onSymbol` when the group symbol changes, `onVariant` when the ▾ menu changes, `csv()` for Download (hide the button when absent/null), `scoutContext()` for the sparkle (sends `bus.emit('ai:ask', {prompt, context, panelType})`), `destroy()` on removal. Panels must handle `el` resizing (use ResizeObserver if drawing canvas/SVG).

### Panel types (owner → type ids). Shell's view layouts reference exactly these ids.
- chart: `chart` (full chart: chart type, interval, Lin/Log, indicators, metrics overlay, chart sets, range, OHLCV legend, crosshair, compare, bar replay, drawing tools, fullscreen), `multi-chart` (2/4/6 synced mini charts).
- company: `quote` (exchange, delayed note, name, last, change, at-close + after-hours, key stats table), `fundamentals` (Key Metrics, Income Statement, Balance Sheet, Cash Flow; Annual/Quarterly; currency note), `analyst` (Verdict, Targets, Actions — consensus target, rating distribution bar), `profile`, `peers`, `segments` (segment/geography revenue breakdown).
- markets: `index-movers`, `stock-movers` (Most Active / Trending / Gainers / Losers), `crypto-movers` (All / Most Active / Gainers …), `sector-performance`, `heatmap`, `watchlist`, `market-summary` (indexes, rates, commodities, FX, crypto), `theme-overview` (state `{theme}`), `screener`.
- news-earnings: `news` (market/ticker/theme news, filters, article reader), `predictions` (existing classified-headline predictions from `/api/briefing`), `earnings-calendar`, `earnings-detail` (EPS/revenue history, estimate vs actual, next date, call time), `economic-calendar` (CPI, Fed… reuse `worker/calendar.js` data).
- options-portfolio: `options-chain`, `options-overview` (expirations, put/call ratio, max pain, implied volatility derived via Black-Scholes and labeled as derived), `unusual-options` (volume/open-interest scan, labeled as derived), `portfolio-summary`, `portfolio-holdings`, `portfolio-performance`, `portfolio-allocation`, `alerts` (list/manage price alerts).
- ai: `ai-recap` (AI daily recap of the view/holdings); plus the right dock (not a panel).

### Event bus names
`symbol` {group,symbol} · `ai:ask` {prompt, context, panelType} · `ai:open` · `alerts:open` · `alerts:create` {symbol, price?} · `alerts:triggered` {alert} · `view:create` {name, panels:[{type,state,x,y,w,h}]} · `view:open` {id} · `panel:add` {type, state} · `search:open` · `search:select` {symbol} · `shell:ready` · `workspace:goal` {goal: 'markets'|'analysis'|'portfolio'} (also `store.get('goal')`).

### Goal-based layouts
First-run question "What's your main goal right now?" → Monitor Markets / Stock Analysis / Track My Portfolio builds a different starting workspace (landing view, layout, sidebar order, AI prompts). The user's priorities are **Track My Portfolio** and **Stock Analysis** — those layouts must be the most complete. Goal can be changed later without deleting My Views.

### Theme ids (shell lists them; markets serves constituents via `markets/theme?id=`)
space-race, mag-7, crypto-major, sector-technology (AI & Tech), sector-financial-services, consumer-cyclical, cybersecurity, aerospace-defense, autos-evs, travel, housing-rates, pharma-biotech, clean-energy, gambling, private-markets, futures-derivatives, sector-communication-services, sector-industrials, sector-healthcare, sector-energy, sector-consumer-defensive, sector-basic-materials, sector-utilities, sector-real-estate.

## Worker API
`worker/space/<domain>.js` exports `handle(request, env, ctx, url, rest)` → Response (and `export const allowPost = true` if it needs POST). Use helpers from `upstream.js`: `json`, `UpstreamError`, `symbolParam`, `getJSON`, `finnhub(path, params, env, ttl)`, `nasdaq(path, params, ttl)`, `num`. Never put keys in URLs/responses. Return `{error:'…'}` with a 4xx/5xx on failure; never invent data.
Data sources: Finnhub (`FINNHUB_API_KEY`, free tier: quote, search, profile2, company-news, news?category=, stock/metric, stock/financials-reported, stock/recommendation, stock/peers, calendar/earnings, stock/earnings) · Nasdaq public API (`nasdaq()`: `quote/{sym}/info`, `quote/{sym}/chart`, `quote/{sym}/historical`, `quote/{sym}/option-chain`, `marketmovers`, `calendar/earnings`, `screener/stocks`, index quotes with `assetclass=index`) · Coinbase Exchange public API for crypto (`api.exchange.coinbase.com/products/<P>/ticker|candles|stats`). Probe responses with curl before relying on fields. Finnhub is **not** available locally (no key in `.dev.vars`): unit-test Finnhub code with a stubbed `globalThis.fetch`; Nasdaq/Coinbase can be hit live.
Tests: `worker/space/<domain>.test.js` using `node:test`, stubbing `fetch`. `npm test` runs them.

## UI rules
Dark theme default, light theme via `html[data-space-theme=light]` — use only `--s-*` tokens. Base components in `shell.css` (shell builder writes these first): `.s-btn`, `.s-btn-ghost`, `.s-icon-btn`, `.s-tabs` > `.s-tab[aria-selected=true]`, `.s-seg` (segmented control), `.s-select`, `.s-input`, `.s-table` (sticky header, right-aligned `.s-num` cells), `.s-chip`, `.s-badge`, `.s-menu`, `.s-dialog`, `.s-state`. Prefix your own classes `.p-<module>-`. Every panel: loading / error-with-retry / empty states via `state.*`; label delayed data and sources; keyboard accessible; no external JS libraries (draw charts with canvas/SVG yourself).

## Verify
`cd ~/9178/supply-chain-shock-map && npx wrangler dev --ip 127.0.0.1 --port <your port>` then open `http://127.0.0.1:<port>/space/dev.html?panels=<types>&symbol=NVDA` (panel harness) or `/space.html` (full shell). Ports: shell 8801, chart 8802, company 8803, markets 8804, news-earnings 8805, options-portfolio 8806, ai 8807. Headless screenshot: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --window-size=1600,1000 --screenshot=<scratchpad>/x.png <url>` (add `--virtual-time-budget=8000` for async data). Do **not** touch the Chrome on port 9333 (the user's signed-in trace browser). Run `npm test` and `node --check` on your files before finishing.

### Base components available (shell.css, landed)
`.s-btn` (+ `.s-btn-primary` / `.s-btn-ghost` / `.s-btn-sm` / `.s-btn-danger`), `.s-icon-btn` (+ `-sm`, `aria-pressed`), `.s-tabs > .s-tab[aria-selected]`, `.s-seg > button[aria-pressed|aria-selected|.is-active]`, `.s-select`, `.s-input`, `.s-table` (sticky thead, `.s-num` right-aligned, `tr[data-symbol]` pointer, `th[aria-sort]`), `.s-chip` (`.s-chip-dot`, `.s-chip-x`), `.s-badge` (`-up` / `-down` / `-warn` / `-accent`), `.s-menu` (role=menuitem items, `.s-menu-label`, `hr`), `.s-dialog` (`<dialog>` with header / `.s-dialog-body` / footer), `.s-state(-error)`, `.s-kbd`, `.s-sr`.

# Ultimater

**Supply-chain research, watchlists, and a dedicated stock analyzer.**

Ultimater builds on the original Supply Chain Shock Map project. The research dashboard keeps its Briefing, Watchlist, Portfolio, Calendar, and demonstration Ledger. The Python research engine, source evidence, historical data, and append-only research ledger remain separate from that demonstration UI.

**Analyzer** is the additional workspace informed by the AlphaSpace interface audit. It brings charts, company financials, earnings, news, options, and thematic research into linked panels. Both workspaces share navigation: use **Views** for the Analyzer and **Research** to return to the original dashboard.

Built by **Xingjian Zhang** with vanilla JavaScript, a Cloudflare Worker, and a Python research engine.

**[Open Ultimater](https://supply-chain-shock-map.xingjianzhang700.workers.dev/#/home)** · **[Download the complete local app](https://github.com/zandy700/supply-chain-shock-map/releases/latest/download/ultimater-local-app.zip)** · [API setup](https://supply-chain-shock-map.xingjianzhang700.workers.dev/setup)

The overview opens the **news tracker**, **portfolio**, and **stock Analyzer** from one place.

![Ultimater chart workspace with candlesticks, company research panels, and chart appearance controls](docs/screenshots/ultimater-chart-style-1200.png)

## What you can do

| Workspace | Features |
| --- | --- |
| **Research dashboard** | Original watchlist, headline impact scenarios, company context, portfolio, calendar, and demonstration ledger. The research engine and its append-only ledger remain available through the Python tools below. |
| **Markets & themes** | Movers, watchlists, heatmaps, screens, and 34 stock themes, including housing, gambling, semiconductors, nuclear energy, and prediction-market exposure. |
| **Stock analysis** | Candlesticks and other chart styles, 52 studies, drawing tools, comparisons, replay, company profiles, financial statements, rolling LTM, YoY rows, and analyst consensus. |
| **Earnings** | Calendar navigation, company details, reported results and estimates, and shareable earnings images. |
| **News** | Ticker and theme feeds, 26 topic filters over loaded headlines, article reading, and share links. |
| **Options** | Chains, contract details, configurable columns, and derived IV/Greeks and other statistics. Optional Alpaca indicative data and a separate subscription-based transaction-flow adapter. |
| **Prediction markets** | Stock-relevant Polymarket events plus complementary Kalshi macro, housing, employment, and IPO markets. Polymarket takes priority for recognized overlapping events; Kalshi adds coverage gaps. Topic filters, activity ranking, percentage odds, rules, and pagination. Sports and unrelated questions are screened out. Browsing only; no order submission. |
| **Portfolio** | Manual and CSV holdings, sortable tables, allocation, movers, recorded account history, privacy masking, and an optional read-only broker connection. |
| **AI assistant** | A bottom-right **Ask AI** button, panel context, research questions, workspace actions, and daily recaps. Requires your own Anthropic API key. |

Custom views support movable, resizable panels and linked ticker groups. Layouts and preferences persist in your browser. Workspace export/import and optional encrypted layout sync are available. Phone layouts stack panels and use a navigation drawer.

The dashboard and Analyzer share one device-local watchlist of up to **40 symbols**. Changes sync between panels and tabs; sample mode keeps its own list. Feeds with smaller request limits use bounded batches, and incomplete refreshes are labeled. Previously retrieved dashboard/calendar data stays visible during an outage when the watchlist is unchanged.

Analyzer watchlists and charts can show the share-weighted average purchase cost across supported manual and linked USD portfolios. Unknown costs are excluded and partial cost coverage is marked. Privacy mode masks position values and excludes holdings from new portfolio exports and AI context. Manual edits update immediately; linked holdings refresh every five minutes while the workspace is visible and online. Watchlists and holdings are never added to the public prediction-event snapshots.

## Run locally

Requires **Node.js 22+** and npm. Download the [local app ZIP](https://github.com/zandy700/supply-chain-shock-map/releases/latest/download/ultimater-local-app.zip), unzip it, open Terminal in the extracted folder, and run:

```sh
npm start
```

The first launch installs locked dependencies, starts the local data server, and prints the local address (normally **[127.0.0.1:8820](http://127.0.0.1:8820/#/home)**). Open **Setup & download** in the app to add your own API keys. The download includes the news tracker, manual/CSV portfolio, Analyzer and API setup. Internet is required for installation and live feeds; keys are optional for manual portfolios and public data.

You can also run the full repository:

```sh
git clone https://github.com/zandy700/supply-chain-shock-map.git
cd supply-chain-shock-map
npm start
```

Open the **[overview](http://127.0.0.1:8820/#/home)**, **[news tracker](http://127.0.0.1:8820/#/briefing)**, **[portfolio](http://127.0.0.1:8820/#/portfolio)**, or **[Analyzer](http://127.0.0.1:8820/space?view=analysis)**. See the [full local app guide](docs/local-app.md) for ports, privacy and troubleshooting. Python 3.11+ is needed only for the separate research engine; it is not required to start the local app.

The workspace can start without provider keys. Public endpoints supply available data; features that need credentials show their setup or unavailable state. The complete local launcher runs the Worker on your computer; no Cloudflare deployment is needed. A plain static file server does not provide the full workspace APIs. The smaller prediction-event pack below works separately without any Worker runtime.

### Prediction events without app hosting

[Download the latest **ultimater-local-pack** artifact](https://github.com/zandy700/supply-chain-shock-map/actions/workflows/prediction-events.yml) from a successful Actions run. Unzip it and run `npm start` (Node.js 22+, no dependencies or API keys). It serves the event board on your own computer and checks public GitHub snapshots automatically. GitHub Actions re-discovers new events every 15 minutes even while your computer is off; scheduled runs can be delayed. Bundled data stays readable when GitHub is unavailable, and old data is labeled stale.

From a checkout, use `npm run events:sync`, `npm run pack:build`, and `npm run pack:start`. This saved-event pack covers open Polymarket/Kalshi discovery, rules, filters and saved-event search; the local Worker remains available for faster data and other workspace APIs. See the [local pack guide](docs/local-event-pack.md) for timing, coverage and download instructions.

<details>
<summary>Run the research dashboard in sample-only mode without the Worker</summary>

```sh
python3 -m http.server 8000 --directory web
```

Open `http://localhost:8000/?seed=demo#/briefing`. This mode uses the isolated `web/seed/` demonstration data. It does not activate the workspace's server APIs or read the research ledger.

</details>

## Connect optional providers

In the local app, open **[Setup & download](http://127.0.0.1:8820/setup)**. It explains where to obtain each provider key, saves it privately to the ignored **`.dev.vars`** file, and restarts the local data server. It can check Finnhub, Alpaca and flow data access after setup. API keys are never saved to browser storage or included in the downloadable ZIP. Each download or clone needs its own credentials.

The hosted setup page is read-only: visitors cannot add keys to the public server. People hosting their own copy configure private server secrets. The existing CLI helpers and manual `.dev.vars` editing remain available for development; restart `npm run dev` after editing that file.

| Provider | Configuration | Enables |
| --- | --- | --- |
| **Alpaca** | `npm run alpaca:setup` | Privately prompts for `ALPACA_API_KEY` and `ALPACA_API_SECRET`; enables indicative options snapshots. |
| **Finnhub** | `FINNHUB_API_KEY` | Additional news, quote, financial, and analyst coverage, subject to your plan. |
| **Anthropic** | `ANTHROPIC_API_KEY`; optional `PULSE_AI_MODEL` | Ultimater AI and AI recaps. API usage may incur charges. |
| **Unusual Whales** | `UNUSUAL_WHALES_API_KEY` | Transaction Flow, with an eligible provider subscription. |
| **SnapTrade** | `npm run broker:setup` | Read-only brokerage connection, subject to provider app approval and configuration. Manual/CSV portfolios work independently. |

Setup status reports credential presence. A successful data check confirms that one provider request worked; it does not guarantee every symbol, subscription feature or future request is available. AI access is verified when you send a message; the setup page does not issue a paid AI request.

For example, optional local settings can be added to `.dev.vars`:

```dotenv
FINNHUB_API_KEY="your_finnhub_key"
ANTHROPIC_API_KEY="your_anthropic_key"
```

The Alpaca helper preserves other settings and hides both credential prompts. Check `http://127.0.0.1:8820/api/space/options/status` after restarting. A configured status means keys are present; verify the chain's actual `provider`, `feed`, notices, and coverage to confirm successful access.

See [Alpaca setup](docs/alpaca-options.md), [broker setup](docs/broker-setup.md), and [prediction-market API coverage](docs/prediction-markets.md).

## Understand the data

- **Refreshes are polling, not a streaming entitlement.** Visible stock charts check every 30 seconds and crypto charts every 15 seconds. Hidden/offscreen panels pause updates. Provider delays still apply; a new check does not guarantee a new candle.
- **Sources stay visible.** Nasdaq stock/options data may be delayed. Crypto uses Coinbase snapshots. ETF samples, Treasury yields, currency rates, sampled candles, and derived statistics are labeled. Missing values stay unavailable.
- **Alpaca's configured feed is indicative.** Quotes are modified rather than executable OPRA quotations; trades are delayed. Large chains can be partial because requests stop after five pages. This integration supplies options data; it does not switch every stock chart to Alpaca.
- **Catalog coverage is paginated.** Polymarket event search queries the provider and supports result pagination; secondary prediction-market filters and news filters operate on loaded results. The prediction-market page is a public catalog, not anyone's private bets or positions.
- **Portfolio history must be recorded.** Current holdings cannot reconstruct past deposits, withdrawals, trades, or investment returns. Local price alerts run while the page is open.
- **Some data requires additional sources.** Proprietary fair values, analyst accuracy scores, some asset classes, and premium transaction feeds are not supplied merely by rendering their controls.

Ultimater is an independent implementation informed by a reference-interface audit. It is not affiliated with Yahoo, and it does not use Yahoo account cookies or private portfolio endpoints. Code licensing does not grant rights to redistribute provider data. Review provider terms before offering a public multi-user service.

**For research and education; not financial advice.** AI responses, provider data, derived statistics, and historical research can be incomplete or wrong.

## Project structure

```text
web/space/       Workspace shell, charts, panels, themes, and AI interface
worker/space/    Market-data adapters, workspace APIs, AI, and tests
web/            Earlier Briefing UI, portfolio helpers, and static assets
worker/         Worker entry point, broker connection, and shared APIs
scsm/           Python supply-chain research and ledger tooling
data/           Research inputs, provenance, and cached results
ledger/         Append-only predictions and separate outcome scores
docs/           Setup guides, methodology, screenshots, and audit reports
```

The frontend uses native ES modules; there is no frontend compilation step. Cloudflare serves static assets and runs the API handlers. Durable Objects support broker sessions and encrypted workspace sync. Existing `watchlist-pulse` storage and package names remain for compatibility.

## Development and checks

```sh
npm test
npm run app:build
npx wrangler deploy --dry-run --outdir /tmp/ultimater-build
```

JavaScript tests cover adapters, validation, source/fallback behavior, calculations, refresh scheduling, portfolios, AI tool boundaries, and workspace import/export. Provider responses are stubbed where appropriate; passing tests does not establish a paid subscription or production activation.

For the separate research engine:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
ruff check .
pytest -q
python -m scsm ledger verify
```

Read the [research methodology and historical findings](docs/research-engine.md) before interpreting its results. The historical replay does not validate a tradable forecasting edge.

## Deployment

`wrangler.jsonc` contains the Worker, static assets, and Durable Object migrations. To deploy your own instance, choose your Worker name, authenticate with Cloudflare, and configure the required provider secrets with `npx wrangler secret put SECRET_NAME` before running `npx wrangler deploy`. Broker callbacks require separate hosted setup.

Local `.dev.vars` credentials are not automatically uploaded as hosted secrets. A GitHub push alone does not activate providers or deploy this app.

## Documentation and credits

- [Original dashboard and research preservation check](docs/original-workspace.md)
- [Analyzer features, refresh behavior, and limitations](docs/space.md)
- [Reference audit: changes, evidence, and remaining gaps](docs/rea-full-audit.md)
- [Supply-chain research methodology and full attribution](docs/research-engine.md)
- [Graph provenance](docs/graph-provenance.md)
- [Third-party notices](NOTICE) and [license texts](THIRD_PARTY_LICENSES/)

Original project code is licensed under the [MIT License](LICENSE), copyright © 2026 Xingjian Zhang. Adapted and vendored research components retain their upstream attribution and licenses; see the full credits above.

# Watchlist Pulse

The mobile-first UI shell runs with **seeded sample data only**. Follow companies, read a daily briefing of indirect impacts, explore catalysts and company relationships, and review a demonstration prediction ledger. Nothing in the UI is live news, a verified relationship claim, or a real forecast.

Built by **Xingjian Zhang**, VP of his school's stock club. The Python research engine, data, append-only ledger, vendored sources, and CI remain separate from the UI. Their attribution and historical findings are retained below.

## Live portfolio

For the Worker-powered portfolio, CSV imports, and read-only brokerage connections, see [local and hosted broker setup](docs/broker-setup.md).

## Run the sample UI

```bash
python -m http.server 8000 --directory web
```

Open <http://localhost:8000>. First-time users start with an empty watchlist. Enter comma-separated tickers or company names; edit them anytime in Watchlist. The watchlist is stored only in this browser under `watchlist-pulse`. Use <http://localhost:8000/?seed=demo> to load AAPL, META, NVDA and TSLA for development.

The app uses vanilla JavaScript and hash routes: `#/briefing`, `#/catalysts`, `#/watchlist`, `#/company/NVDA`, and `#/ledger`. Serve over HTTP for JSON loading. Inter loads from Google Fonts; a sans-serif fallback works if it is unavailable. Mobile uses fixed bottom tabs; desktop uses top navigation.

Sample content lives in `web/seed/{briefing,catalysts,companies,ledger}.json`. Cards and catalysts filter to the saved watchlist. Unsupported names can be saved and show a clear lack of sample coverage. Confidence labels are illustrative, not calibrated probabilities. The demonstration ledger never reads or writes the research ledger.

Not financial advice. Predictions are logged before outcomes; scores come later.

## Phase 2 scope

The classifier now covers earnings beats, product launches, guidance raises, major contract wins, rate-cut relief and supplier expansions. Disruption keywords take precedence in mixed headlines. Signed scenarios preserve the issuer sign along upstream/downstream paths, decay with each hop, and invert it only on explicit terminal competitor links. Severity, timing and transmission remain heuristics; rate cuts or earnings beats need not benefit every related company. Live GDELT matches remain unreviewed and excluded from backtests.

The four `web/seed` files carry November 2026 **Sample data**: six November 4 impact cards (three positive, three negative), two positive and two negative fictional earnings/CPI/Fed calendar scenarios, company sample dates, and matching demonstration-ledger entries. Calendar dates are fictional examples, not actual scheduled releases. The Linear UI shell is unchanged. No research-ledger entries were rewritten or appended. No new SEC parsing or graph growth was needed. Nothing was pushed or deployed.

## Phase 1 screenshots

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Onboarding | [Screenshot](docs/screenshots/scsm-pulse-phase1-onboarding-desktop.png) | [Screenshot](docs/screenshots/scsm-pulse-phase1-onboarding-mobile.png) |
| Briefing | [Screenshot](docs/screenshots/scsm-pulse-phase1-briefing-desktop.png) | [Screenshot](docs/screenshots/scsm-pulse-phase1-briefing-mobile.png) |
| Catalysts | [Screenshot](docs/screenshots/scsm-pulse-phase1-catalysts-desktop.png) | [Screenshot](docs/screenshots/scsm-pulse-phase1-catalysts-mobile.png) |
| Company | [Screenshot](docs/screenshots/scsm-pulse-phase1-company-desktop.png) | [Screenshot](docs/screenshots/scsm-pulse-phase1-company-mobile.png) |
| Ledger | [Screenshot](docs/screenshots/scsm-pulse-phase1-ledger-desktop.png) | [Screenshot](docs/screenshots/scsm-pulse-phase1-ledger-mobile.png) |

## Research engine (retained)

The following documents the underlying Supply Chain Shock Map research, not the Phase 1 sample UI. The research updates below are local Phase 2 work; the UI continues to use isolated sample data.

Python 3.11+; install with `pip install -e '.[dev]'`. Commands include `python -m scsm ingest --offline`, `python -m scsm propagate`, `python -m scsm backtest`, `python -m scsm ledger verify`, and `python -m scsm score`. Run from the checkout so cached data and vendored sources resolve. `python -m scsm export` still generates legacy research exports into `web/data/`; that directory is ignored and unused by the new UI. Python CI remains unchanged.

New research work includes company matching, disruption classification, bounded shock propagation, event-study evaluation, the append-only prediction ledger and separate outcome scoring. Existing SEC ingestion/extraction, graph construction, GDELT client and market-model methodology are reused as credited below. No new SEC filing parser or relationship extractor is implemented here. See [graph provenance](docs/graph-provenance.md) for acquisition and rebuild instructions. Historical replays are not prospective forecasts.

## Graph coverage and assumptions

Only a real subset is shipped: **12 nodes and 10 reviewed edges from 14 primary 2021 SEC filings**. SEC-derived relationships, evidence sentences, filing URLs, dates and source hashes are preserved in `data/graph.json` and `data/sec/`. The provenance report explains the inclusion review and rejected keyword candidates. Filings are historical snapshots, not a complete or current map of the S&P 500. The graph intentionally excludes ambiguous matches and unverified relationships.

A disruption at a supplier travels downstream to its customers (lost supply); a disruption at a customer travels upstream to its suppliers (lost demand). A path never changes direction, so a shock cannot zig-zag into an unrelated sibling supplier. Base issuer shock is signed severity × 5 percentage points; each hop multiplies the prior magnitude by edge weight × 0.5, up to three hops. Missing measured exposures use an explicitly labeled heuristic weight. Extraction confidence is not a financial exposure measurement. The strongest simple path per ticker is retained, rather than summing overlapping paths. Cycles cannot amplify shocks. Filings dated after an event are excluded from its scenario. Competitor substitution is supported only for explicitly labeled competitor inputs; no competitor or supplier links are invented from shared sectors.

Severity, decay and magnitude are modeling choices, not estimated returns. Expected abnormal return percentages are signed and use the same scenario scale at each study horizon; no horizon calibration is claimed. Entity matching uses the cached real S&P 500 constituent list and aliases. Short and ambiguous names are handled conservatively; headline matching and keyword classification still make mistakes. News publication dates can differ from the underlying disruption date.

## Results and findings

Executed with `python -m scsm backtest` on the existing Yahoo adjusted-price caches: **88 verified historical scenarios: 25 positive and 63 negative**, from March 2021 through **November 2, 2026**. Phase 2b adds **5 non-Apple positive events from 5 distinct issuers**: AMD (1), AVGO (1), MU (1), ABT (1), NVDA (1). AAPL retains 20 (19 launches and one earnings-growth disclosure); no prior event was removed or relabeled.

The additions cover **three required non-Apple categories**: major contract wins (AMD/OpenAI, October 6, 2025; AVGO/Apple, May 23, 2023), supplier expansion (MU Boise fab groundbreaking, September 12, 2022), and a guidance raise (ABT higher full-year guidance midpoints, April 17, 2024). NVDA's March 18, 2024 Blackwell announcement adds a non-Apple product launch. Every addition has a fetched primary `source_url`, short verbatim `source_quote`, disclosure-date quote, retrieval timestamp and SHA256-checked compressed HTML snapshot under `data/events/sources/`. Micron's blocked investor-release URL was dropped in favor of its fetchable corporate press kit; AMD uses its current newsroom URL. Broadcom's contract is disclosed by customer Apple, so it diversifies issuer exposure but is still Apple-related. Positive means an assumed favorable catalyst, not a realized-return label. Abbott narrowed its guidance ranges with higher midpoints; no consensus earnings beat is claimed. Micron's groundbreaking is not completed capacity, and AMD's agreement has future delivery and warrant terms.

Prices remain the caches produced by the existing `python scripts/fetch_data.py --refresh` pipeline in Phase 2, through November 4, 2026. All five added issuers already had prices; all five have complete +1/+5/+20 study windows with 240 estimation observations. No price download, substitute series, or ticker drop was needed in Phase 2b. There are **210, 205 and 200** ticker predictions at +1/+5/+20, with the same **15** immature-window exclusions. The November 2 event has only a completed +1 window. The 12-node, 10-edge SEC graph, UI and hashed ledger are unchanged.

MAE is in percentage points of CAR. CIs use 10,000 event-cluster percentile bootstrap resamples (seed 2026). “Model − zero” is model MAE minus always-predict-zero MAE; negative favors the model. The positive/negative groups split **predicted sign**, across all relation types. Exact binomial p-values remain in `data/results.json`; they assume independent predictions and can overstate evidence when predictions share events.

| Horizon | Group | n (events) | Hit rate [95% CI] | Model MAE | Zero MAE | Model − zero [95% CI] |
|---|---|---:|---|---:|---:|---|
| +1 | overall | 210 (88) | 57.6% [49.3%, 65.7%] | 2.06 | 1.49 | +0.56 [+0.35, +0.78] |
| +1 | direct | 92 (88) | 64.1% [53.9%, 73.6%] | 3.07 | 1.93 | +1.14 [+0.68, +1.57] |
| +1 | downstream | 7 (7) | 28.6% [0.0%, 57.1%] | 2.13 | 1.81 | +0.32 [-0.25, +0.82] |
| +1 | upstream | 111 (38) | 54.1% [42.4%, 64.7%] | 1.22 | 1.11 | +0.10 [-0.04, +0.25] |
| +1 | positive | 101 (25) | 52.5% [38.9%, 65.7%] | 1.68 | 1.22 | +0.46 [+0.25, +0.69] |
| +1 | negative | 109 (63) | 62.4% [52.4%, 72.0%] | 2.41 | 1.75 | +0.65 [+0.28, +1.02] |
| +5 | overall | 205 (87) | 57.6% [49.0%, 65.9%] | 3.02 | 2.78 | +0.24 [-0.05, +0.54] |
| +5 | direct | 91 (87) | 58.2% [47.8%, 68.4%] | 3.75 | 3.22 | +0.53 [-0.09, +1.14] |
| +5 | downstream | 7 (7) | 28.6% [0.0%, 57.1%] | 3.45 | 3.05 | +0.39 [-0.11, +0.89] |
| +5 | upstream | 107 (37) | 58.9% [47.1%, 70.9%] | 2.37 | 2.39 | -0.01 [-0.17, +0.14] |
| +5 | positive | 96 (24) | 60.4% [47.5%, 73.4%] | 2.77 | 2.65 | +0.13 [-0.13, +0.38] |
| +5 | negative | 109 (63) | 55.0% [44.0%, 66.3%] | 3.24 | 2.89 | +0.35 [-0.16, +0.85] |
| +20 | overall | 200 (86) | 59.5% [52.2%, 66.8%] | 5.45 | 5.61 | -0.16 [-0.46, +0.14] |
| +20 | direct | 90 (86) | 62.2% [51.7%, 72.2%] | 5.81 | 6.10 | -0.28 [-0.90, +0.35] |
| +20 | downstream | 7 (7) | 28.6% [0.0%, 57.1%] | 7.32 | 6.75 | +0.56 [+0.10, +0.89] |
| +20 | upstream | 103 (36) | 59.2% [49.0%, 69.9%] | 5.01 | 5.11 | -0.10 [-0.25, +0.04] |
| +20 | positive | 91 (23) | 54.9% [44.3%, 64.9%] | 5.16 | 5.14 | +0.03 [-0.24, +0.30] |
| +20 | negative | 109 (63) | 63.3% [53.4%, 73.3%] | 5.70 | 6.01 | -0.31 [-0.79, +0.18] |

- **Upstream remains consistent with a coin flip** at every horizon: all hit-rate CIs include 50%. Downstream remains just **2 correct signs in 7 cases** at every horizon; its +20 magnitude error is worse than zero with a CI excluding zero. Supply-chain propagation is not validated. The additions create only two new downstream observations per horizon and no new upstream observations.
- Positive signs are also consistent with a coin flip at every horizon (52.5%, 60.4%, 54.9% at +1/+5/+20). **Apple is still 20/25 positive events (80%)**. The five non-Apple events are single examples per issuer, not independent category validation; contract wins remain concentrated in technology. NVDA, MU and ABT have no edges in the sparse shipped graph and contribute direct observations only. Earnings beats against analyst consensus and rate-cut relief still lack non-Apple examples here.
- Direct signs are 64.1% correct at +1, but magnitude error is worse than zero. No overall horizon beats the zero baseline on MAE with a CI excluding zero. Positive scenarios do not repair the uncalibrated 5% severity scale.
- This is a hand-selected convenience sample with overlapping windows and historical replay, not prospective forecasting. Current constituent survivorship, day-level timing, exclusion of day 0, retrospectively adjusted prices, stale 2021 relationships and assumed exposures limit interpretation. Many reported comparisons have no multiple-testing correction. Events were selected by disclosed catalyst type rather than realized price direction, but still have severe selection bias; issuer diversity does not establish a tradable edge.

Live GDELT acquisition was attempted and the request status is cached in `data/events/gdelt-*.json`; when rate-limited it contributes **no invented events**. The initial ledger is timestamped at this build and contains real historical-event replay scenarios. There are no matured prospective scores yet. Prospective performance is unavailable, not 0%.


The historical cohort is deliberately small and curated. It cannot establish a tradable edge. See `data/results.json` for individual event/ticker/horizon observations, model fit, exclusions and uncertainty intervals. Numerical claims must be read alongside sample size and the following limits.

The event study adapts EventStudy's OLS market model: fit stock return = alpha + beta × SPY return on trading days -250..-11. CAR is the sum of residuals on +1 through +1/+5/+20, excluding day 0. Day 0 is the last shared trading session on or before the disclosure date, so a weekend or holiday disclosure is first measured on the next session. Adjusted daily close data are used; publication time and after-hours effects are not modeled. Full horizons must exist, and insufficient estimation histories are excluded. Event overlap, selection bias, current constituent survivorship, stale graph coverage and uncalibrated severities limit interpretation. Bootstrap intervals describe resampling uncertainty within this cohort, not a guarantee of future performance.

The zero-return baseline is deployable as a no-effect forecast. The same-sector average uses contemporaneous realized peer CARs and is labeled an **ex-post control**, not an available-at-prediction forecast. Missing peer observations must be reported rather than treated as zero. Historical replay accuracy and prospective ledger accuracy are distinct throughout the interface.

## Ledger and daily operation

`ledger/predictions.jsonl` is append-only. Each entry has UTC issuance time, original event, predictions/paths, previous hash and SHA256 hash. The hash input is RFC 8785 canonical UTF-8 JSON of the full entry excluding `hash`; genesis is 64 zeroes. `python -m scsm ledger verify` checks the chain, and the browser independently recomputes it using Web Crypto. Retain a trusted head hash (or independently archived Git commit) to detect a complete rewrite: a hash chain alone does not prove independent timestamps or prevent rewriting the entire history.

`ledger/scores.jsonl` is separate and deduplicated by prediction hash/ticker/horizon. Historical replays never enter prospective scoring. For prospective entries, scoring anchors conservatively to a session after issuance and only appends a horizon once its complete window has closed; it never modifies predictions. Empty scores mean no matured prospective observations, not zero accuracy.

[Daily automation](.github/workflows/ledger.yml) runs ingestion, append, scoring and export, then commits the changed caches/ledger/assets. GitHub Actions must be enabled and its token permitted to write repository contents. A fresh ingest can return no new observations because of rate limits or unmatched news; consult its cached status. Changes are serialized with workflow concurrency and local ledger file locks.

[CI](.github/workflows/ci.yml) runs Ruff, offline pytest, chain verification and a byte-level rebuild check of committed `web/data`. To validate locally:

```bash
ruff check .
pytest -q
python -m scsm ledger verify
python -m scsm export
git diff --exit-code -- web/data
```

## Static Cloudflare Worker assets

`wrangler.jsonc` configures the `web/` asset directory and `worker/index.js` serves the asset binding. No server-side API or scheduled handler is needed; cron belongs to GitHub Actions. The live demo is deployed from this configuration to supply-chain-shock-map.xingjianzhang700.workers.dev.

## Credits and licenses

All five supplied source LICENSE files were read and verified as MIT. Exact texts are retained in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES/) and upstream notices are retained alongside vendored code. [NOTICE](NOTICE) records provenance and modifications; [graph provenance](docs/graph-provenance.md) records source commits and extraction evidence.

| Repository | License | Copyright holder | Exactly what was taken |
|---|---|---|---|
| [sushaan-k/alphasig](https://github.com/sushaan-k/alphasig) | MIT | 2026 Sushaan Kandukoori | Vendored source including EDGAR ingestion, supply-chain engine, models and NetworkX graph; EDGAR download/parsing and graph construction used; LLM extraction engine retained but not run without credentials |
| [aaryapatel09/sigint](https://github.com/aaryapatel09/sigint) | MIT | 2026 Sushaan Kandukoori | Predecessor attribution and license only; no separate duplicate implementation |
| [supat-roong/stock-relation](https://github.com/supat-roong/stock-relation) | MIT | 2026 Supat Roongpraiwan | SEC supply-chain ingestion deterministic fallback and D3 frontend source/patterns adapted for local static data, event animation and responsive views |
| [alex9smith/gdelt-doc-api](https://github.com/alex9smith/gdelt-doc-api) | MIT | 2020 Alex Whitehead-Smith | GDELT DOC 2.0 client/filter implementation, vendored for actual queries |
| [zrxbeijing/EventStudy](https://github.com/zrxbeijing/EventStudy) | MIT | 2020 Rongxin | Market-model alpha/beta estimation and abnormal-return methodology adapted; reference implementation preserved |

D3 and any additional redistributed libraries have their own notices alongside their assets and in the third-party license directory. SEC filings, news metadata and market data are source material with their own terms; the code's MIT license does not relicense third-party data. `Seungukeeee/bottleneck_indicators` has no license: ideas/citation only; **zero code copied**.

Original project code: MIT, Copyright (c) 2026 Xingjian Zhang. **Not financial advice.**

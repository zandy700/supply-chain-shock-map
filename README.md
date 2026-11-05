# Supply Chain Shock Map

A research observatory connecting documented supply relationships, disruption news, and measured abnormal stock returns. Built by **Xingjian Zhang**, VP of his school's stock club.

A factory disruption can matter beyond the company in the headline. This project makes the proposed route visible, keeps its evidence attached, and checks the idea against actual market returns. Its predictions are **uncalibrated research scenarios**, not investment recommendations.

## What's new and what's reused

New work: company matching and disruption classification, bounded shock propagation, cached event-study evaluation, an append-only prediction ledger, separate outcome scoring, static exports, and the integrated interface. Existing SEC ingestion/extraction, graph construction, D3 visualization patterns, GDELT client and market-model methodology are reused as credited below. No new SEC filing parser or relationship extractor is implemented here.

```mermaid
flowchart LR
  SEC[Real SEC 10-K filings] --> BASE[Alphasig EDGAR + stock-relation fallback]
  BASE --> GRAPH[Evidence-backed cached graph]
  GDELT[GDELT DOC via gdelt-doc-api] --> EVENTS[Matched and classified events]
  CURATED[Documented historical events] --> EVENTS
  EVENTS --> PROP[Weighted, decaying propagation]
  GRAPH --> PROP
  PROP --> LEDGER[SHA256 chained predictions]
  PRICES[Adjusted yfinance prices + SPY] --> STUDY[EventStudy adapted market model]
  PROP --> STUDY
  STUDY --> RESULTS[Historical results + bootstrap intervals]
  LEDGER --> SCORE[Separate matured scores]
  PRICES --> SCORE
  GRAPH --> EXPORT[scsm export]
  EVENTS --> EXPORT
  RESULTS --> EXPORT
  LEDGER --> EXPORT
  SCORE --> EXPORT
  EXPORT --> WEB[Static D3 observatory]
```

## Setup and offline demo

Python 3.11 or newer; tested with the versions recorded in the validation notes. Run from the repository checkout so the CLI can locate `data/`, `vendor/`, and `ledger/` (this is a source-checkout application).

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
python -m scsm ingest --offline
python -m scsm propagate
python -m scsm backtest
python -m scsm ledger verify
python -m scsm score
python -m scsm export
python -m http.server 8000 --directory web
```

Open <http://localhost:8000>. Serve over HTTP because browsers restrict JSON fetching from `file://`. Every visualization asset is local and every asset URL relative; the demo needs no API key and no live data request. Graph, event feed, ledger, accuracy and methodology are separate views (`web/index.html`, `web/assets/*.js`, `web/assets/styles.css`; D3 and fonts are vendored in `web/vendor/`, so the page makes no external requests).

| Shock graph (desktop) | Shock graph (390px mobile) |
|---|---|
| ![RTX engine-inspection event rippling to Boeing over an SEC-documented supplier edge](docs/screenshots/graph-desktop.png) | ![Same view on a 390px phone with touch pan and zoom](docs/screenshots/graph-mobile.png) |

![Accuracy dashboard: MAE versus zero and sector baselines, hit rates and predicted-vs-realized scatter](docs/screenshots/accuracy-desktop.png)

![Ledger viewer recomputing the SHA-256 hash chain in the browser](docs/screenshots/ledger-desktop.png)

Picking an event animates the shock hop by hop: color is predicted direction, node size is the magnitude of the expected abnormal return, and tapping a company or edge shows its SEC evidence sentence and filing. The ledger view recomputes every hash with Web Crypto and compares the head with the Python verifier's exported head; "Simulate tampering" edits an in-memory copy to show the chain breaking. The accuracy charts read `results.json` directly, so they always show the latest backtest numbers. Animations respect `prefers-reduced-motion`.

`python -m scsm --help` documents all commands. `propagate --event ID` selects an event; `ledger append --event ID` appends it once. Default `ledger append` appends all cached events with predictions. **Historical events appended now are labeled historical replays and excluded from prospective scores.** Do not interpret them as past forecasts.

For live ingestion run `python -m scsm ingest`. For missing price retrieval use `python -m scsm backtest --online` or `python -m scsm score --online`. Network failures and incomplete future windows never become fabricated observations. Keep event and price caches in version control for reproducibility. Source acquisition details and SEC graph rebuild instructions are in [graph provenance](docs/graph-provenance.md); `scripts/fetch_data.py` documents historical event and price acquisition.

## Graph coverage and assumptions

Only a real subset is shipped: **12 nodes and 10 reviewed edges from 14 primary 2021 SEC filings**. SEC-derived relationships, evidence sentences, filing URLs, dates and source hashes are preserved in `data/graph.json` and `data/sec/`. The provenance report explains the inclusion review and rejected keyword candidates. Filings are historical snapshots, not a complete or current map of the S&P 500. The graph intentionally excludes ambiguous matches and unverified relationships.

Supplier → customer is the direction of a disruption. Base issuer shock is signed severity × 5 percentage points; each hop multiplies the prior magnitude by edge weight × 0.5, up to three hops. Missing measured exposures use an explicitly labeled heuristic weight. Extraction confidence is not a financial exposure measurement. The strongest simple path per ticker is retained, rather than summing overlapping paths. Cycles cannot amplify shocks. Filings dated after an event are excluded from its scenario. Competitor substitution is supported only for explicitly labeled competitor inputs; no competitor or supplier links are invented from shared sectors.

Severity, decay and magnitude are modeling choices, not estimated returns. Expected abnormal return percentages are signed and use the same scenario scale at each study horizon; no horizon calibration is claimed. Entity matching uses the cached real S&P 500 constituent list and aliases. Short and ambiguous names are handled conservatively; headline matching and keyword classification still make mistakes. News publication dates can differ from the underlying disruption date.

## Results and findings

Executed on the checked-in adjusted-price caches: **8 real historical events, 10 ticker predictions per horizon (9 direct issuer, 1 downstream)**. No observations were excluded in this run. All values below are calculated by `python -m scsm backtest`, not invented. MAE units are percentage points of CAR. Brackets show the event-cluster bootstrap 95% interval for hit rate; full intervals for correlation, MAE and both baselines are in `data/results.json`.

| Trading horizon | n | Directional hit rate [95% CI] | Pearson | Spearman | Model MAE | Zero MAE | Sector control MAE |
|---|---:|---|---:|---:|---:|---:|---:|
| +1 | 10 | 80% [56%, 100%] | 0.857 | 0.555 | 3.215 | 3.183 | 3.145 |
| +5 | 10 | 40% [9%, 78%] | 0.871 | 0.884 | 4.752 | 4.508 | 4.750 |
| +20 | 10 | 70% [36%, 100%] | 0.640 | 0.507 | 4.777 | 5.410 | 6.048 |

The model's +1 and +5 MAE are **worse than predicting zero**, and the +5 directional hit rate is only 40%. The +20 MAE is lower than zero on this sample, with broad uncertainty. High correlations in such a small selected cohort do not establish forecasting skill. One downstream observation cannot validate supply-chain propagation. The RTX engine-inspection example also exposes a product mismatch: an issuer-level RTX→Boeing edge does not mean an A320neo-specific issue affects Boeing's aircraft. This is a concrete model limitation, retained rather than hidden.

Live GDELT acquisition was attempted and the request status is cached in `data/events/gdelt-*.json`; when rate-limited it contributes **no invented events**. The initial ledger is timestamped at this build and contains real historical-event replay scenarios. There are no matured prospective scores yet. Prospective performance is unavailable, not 0%.


The historical cohort is deliberately small and curated. It cannot establish a tradable edge. See `data/results.json` for individual event/ticker/horizon observations, model fit, exclusions and uncertainty intervals. Numerical claims must be read alongside sample size and the following limits.

The event study adapts EventStudy's OLS market model: fit stock return = alpha + beta × SPY return on trading days -250..-11. CAR is the sum of residuals on +1 through +1/+5/+20, excluding day 0. A weekend event anchors to the next available shared trading date. Adjusted daily close data are used; publication time and after-hours effects are not modeled. Full horizons must exist, and insufficient estimation histories are excluded. Event overlap, selection bias, current constituent survivorship, stale graph coverage and uncalibrated severities limit interpretation. Bootstrap intervals describe resampling uncertainty within this cohort, not a guarantee of future performance.

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

`wrangler.jsonc` configures the `web/` asset directory and `worker/index.js` serves the asset binding. No server-side API or scheduled handler is needed; cron belongs to GitHub Actions. The checked-in configuration is ready for the owner's deployment workflow. No deployment is performed by this project build.

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

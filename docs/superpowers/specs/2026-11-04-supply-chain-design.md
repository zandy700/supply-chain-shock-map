# Supply Chain Shock Map design

The supplied build spec is the implementation contract. Owner: Xingjian Zhang, VP of his school's stock club. This is a static research observatory with an offline reproducible Python pipeline, not a trading service.

## Approach and constraints

Reuse licensed base implementations rather than invent SEC extraction. Alphasig extraction requires a paid LLM, so use stock-relation's existing deterministic fallback, preserve SEC evidence, and use alphasig graph code where feasible. An empty or incomplete real graph is preferable to fabricated edges. Preserve each license and upstream revision. No deployment, pushing, or repo creation.

Use static HTML/CSS/local D3 adapted from stock-relation rather than a server application, per the requested hosting constraints. GDELT retrieval uses gdelt-doc-api. EventStudy's alpha/beta market-model approach is adapted to adjusted yfinance prices and trading-day windows.

## Data and behavior

Companies have real constituent-list provenance and aliases. Events have stable IDs, event dates, source URLs, matched tickers, type, sign, and severity. Distinguish historical curated events from live GDELT observations. Title-based rules are noisy and severity is an assumption.

The graph stores supplier -> customer edges with evidence and filing availability dates. Propagation follows that direction, with per-hop decay and documented heuristic weights; inferred competitors are explicitly scenarios, never invented supplier edges. Magnitude is signed percentage points of expected abnormal return, uncalibrated. Bound traversal and avoid cycles.

Backtest market-model residuals against SPY: estimation -250..-11 trading days, CAR +1/+5/+20, transparent exclusions and bootstrap uncertainty. No numerical performance claims before running actual data. Record graph lookahead, event selection, and overlap limitations. Baselines include zero and a separately labeled sector comparison.

Prediction records contain UTC issuance time, event, paths, and previous SHA256 hash; canonical sorted compact UTF-8 JSON excluding hash is the hash input. Scores append to a separate file and never rewrite predictions. Old events entered now are replays, not historical forecasts. Scoring uses issuance-aware maturity and requires complete price windows.

Export six static JSON files: graph, events, predictions, scores, results, meta. UI provides graph ripple, event feed, ledger verification, accuracy, methodology and credits. Honest empty states, keyboard navigation, reduced motion and 390px touch zoom are required.

## Validation and acceptance

Offline pytest covers matching ambiguity, direction/decay/cycles, alpha/beta and CAR alignment, hash tampering and separate scoring. Ruff, deterministic export checks, CLI smoke tests, browser desktop/mobile checks and actual backtest outputs precede DONE. Daily GitHub Action ingests, predicts, scores, exports and commits with least necessary write permission. CI validates ruff, tests and reproducible web exports. The Worker only serves static assets.

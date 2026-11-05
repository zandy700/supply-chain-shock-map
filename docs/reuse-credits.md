# Reuse inventory for README

All five original LICENSE files were opened and verified as MIT. Copies are in `THIRD_PARTY_LICENSES/`. Source commit pins are in `vendor/upstream-revisions.json`.

| Repo | License | Copyright holder | Exactly what was taken |
| --- | --- | --- | --- |
| [alphasig](https://github.com/sushaan-k/alphasig) | MIT | 2026 Sushaan Kandukoori | Vendored Python package source, including EDGAR ingestion, original supply-chain engine, data models and graph code. Runtime uses EDGAR filing discovery/download plus `SupplyChainGraph`. Original LLM engine retained for provenance and is not called. Lightweight package import shim avoids unused LLM dependencies. |
| [sigint](https://github.com/aaryapatel09/sigint) | MIT | 2026 Sushaan Kandukoori | Predecessor attribution and license text only; no separate implementation copied. |
| [stock-relation](https://github.com/supat-roong/stock-relation) | MIT | 2026 Supat Roongpraiwan | SEC ingestion source/SQLite helper and D3 frontend. Runtime invokes its existing deterministic keyword edge extraction and HTML parser; optional classifier import moved into an opt-in branch. Force graph/zoom/drag frontend adapted for static data. |
| [gdelt-doc-api](https://github.com/alex9smith/gdelt-doc-api) | MIT | 2020 Alex Whitehead-Smith | GDELT DOC 2.0 Python client for fetching article metadata. |
| [EventStudy](https://github.com/zrxbeijing/EventStudy) | MIT | 2020 Rongxin | Market-model OLS return/abnormal-return calculation approach adapted for SPY, trading-session alignment and local cached prices; original reference retained. |

The final GDELT/EventStudy vendor paths and adaptation details should be checked against implementation before publishing this table. `bottleneck_indicators` has no license: conceptual citation only; zero code copied.

## Graph subset finding

The actual offline graph build produced **12 nodes and 10 reviewed directed edges** from **14 primary SEC 2021 10-K filings**. The upstream deterministic extractor produced **14 candidates**; four were excluded because their evidence described a competitor, collaboration, aircraft grounding or shipment timing without an explicit directed supplier/customer disclosure. Two requested tickers were unavailable in the SEC current ticker map (see `data/sec/fetch-failures.json`).

The accepted graph includes **HWM → RTX → BA**, a real two-hop path, and semiconductor/connector suppliers to **AAPL**, **AMZN** and **MSFT**. This is a historical sample, not complete/current S&P 500 coverage. Uniform 0.5 weights are modeling assumptions; upstream 0.8 keyword confidence is not calibrated probability. No competitor supplier edges have been invented.

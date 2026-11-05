# SEC graph provenance

The cached graph is a small evidence-reviewed sample, not a complete S&P 500 supply network.

`scripts/build_graph.py` uses **alphasig's `EdgarClient`** for SEC ticker resolution, filing metadata discovery and primary HTML download. It freezes a disclosed sampling frame to primary **2021 10-K** filings, so retained edges can be dated before the historical event examples. It delegates HTML-to-text parsing and all edge discovery to **stock-relation's `SupplyChainIngester`**, using its existing deterministic keyword fallback (no LLM, no downloaded classifier). It delegates graph construction and deduplication to **alphasig's `SupplyChainGraph`**. Project code only adapts transport/caching, chooses the sampling frame, filters reviewed candidates and serializes the website schema.

The upstream fallback labels keyword mentions as relationships and can produce false positives. `data/sec/candidates.json` retains every candidate verbatim. `data/sec/reviewed-evidence.json` records review decisions against the exact SHA-256 of each upstream evidence sentence. Review can remove candidates but cannot create or rewrite an edge. The graph retains SEC URLs, accession numbers, filing dates and evidence sentences. `data/sec/filings.json` retains raw-file hashes. `data/sec/raw/*.html.gz` holds losslessly compressed original primary HTML; `.txt` files are upstream parser output.

Edge direction in the exported graph is **supplier → customer**. Upstream stock-relation database rows have the opposite storage perspective (source = customer and target = supplier); the adapter reverses their fields explicitly. A `0.5` edge weight is an uncalibrated propagation assumption, not a reported concentration. The fallback's constant `0.8` confidence is not an empirical probability. No competitor edges are invented. Do not infer measured economic exposure from either value.

Historical propagation must exclude edges with filing dates later than the event date. Relationships recorded in 2021 can change; this cached historical subset is not a claim of comprehensive current coverage.

## Rebuild

Install the project's dependencies, then run `python scripts/build_graph.py` to reproduce extraction and graph serialization offline. Raw HTML is gzip-compressed losslessly to keep the audit cache compact. To refresh primary SEC downloads, set `SEC_USER_AGENT` to a real name/contact email and use `python scripts/build_graph.py --fetch`. Check the evidence candidates and update the review registry after a refresh. Do not accept keyword candidates blindly.

## Upstream adaptations

- `vendor/alphasig/src/alphasig/__init__.py` is a lightweight import shim so graph and EDGAR imports do not require optional LLM/pipeline dependencies. Original initializer is preserved as `__init__.upstream.txt`. EDGAR, model, graph and supply-chain-engine implementation files are copied verbatim.
- `vendor/stock-relation/ingestion/supply_chain.py` moves the optional transformers import into an opt-in constructor branch (`use_classifier=True`). Default `False` selects the existing deterministic fallback. The extraction, HTML parsing, SQL writes and ranking code are unchanged.
- Discovery uses alphasig's primary filing metadata instead of EFTS matches, which can return exhibits. The adapter passes those records into upstream stock-relation extraction.

Pinned upstream revisions are in `vendor/upstream-revisions.json`. Original licenses are retained in each vendor directory and `THIRD_PARTY_LICENSES/`.

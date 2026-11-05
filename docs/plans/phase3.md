# Phase 3 approved implementation plan

Build on 212964c. Same Worker serves assets and bounded live APIs; Finnhub credentials remain server-side. Preserve the existing UI and sample route. No SEC parsing, push or deployment.

1. Add classifier parity fixtures and API boundary tests; observe failures. Port Python rules exactly.
2. Add 12-entry validation/resolution, brief upstream caching, bounded rate-limit retry, news and quotes with explicit partial failures.
3. Wire Live briefing/catalysts/company pages and async editor; keep separate Sample mode and demonstration ledger.
4. Run Worker integration tests, Python checks and ledger verification. Capture real local Finnhub screenshots at both required sizes and inspect them.
5. Document operations and limitations, append handoff, commit locally and write external status/report.

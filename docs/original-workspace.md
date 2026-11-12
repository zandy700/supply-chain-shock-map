# Original workspace preservation

Analyzer is an additional section of Ultimater. The original dashboard remains at `/#/briefing`; Analyzer is at `/space?view=analysis`. Dashboard navigation includes Analyzer, and Analyzer's sidebar includes Research dashboard.

## Repository comparison

Compared the implementation with commit `2b8bc86`, immediately before the analyzer workspace was committed:

- All 9 original `scsm/` files are unchanged.
- All 182 original `data/` files are unchanged.
- Both original `ledger/` files are unchanged.
- All 49 original `vendor/` files are unchanged.
- No original tracked files were deleted.
- Existing `watchlist-pulse` storage keys, watchlist handling, and original routes remain in use. The original app had branding updates, and its broker quote path has a read timeout and shorter quote cache; it was not replaced by the analyzer.

The demonstration ledger in the original browser UI remains distinct from the append-only Python research ledger. Opening an old route is not proof that its optional provider is configured: live Briefing news still needs Finnhub, and read-only broker connections still need their own setup.

## Browser checks

Disposable browser profiles created a one-symbol NVDA test watchlist, opened Briefing, Calendar, Portfolio and Ledger, entered Analyzer, returned to the original dashboard, and verified the saved watchlist was retained. Desktop and 320 px phone checks completed without page errors:

- Desktop: `ev_6b4f4e81d2123423f8817f9b3b95628b39e57e8040f099cf862c97e6e3d4c324`.
- Phone: `ev_5282795da64f88403414dde1869e6709217b9522a28e9c930fb3874dec948895`.

The phone check explicitly dismissed the first-visit Getting Started dialog before using the navigation drawer. Earlier selector validation failures and a first-visit dialog blocking a replay were corrected in the verification scenario; they are not counted as successful checks. No personal browser watchlists or portfolio holdings were changed. All 257 JavaScript tests passed after the navigation changes.

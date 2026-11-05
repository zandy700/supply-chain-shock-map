"""Reproduce Yahoo price caches and refresh GDELT; curated events have explicit sources.

Run from the repository root: python scripts/fetch_data.py [--refresh]
Constituent snapshot source is recorded in data/companies.json.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    from scsm.backtest import PEERS, fetch_prices
    from scsm.news import ingest, load_events

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    events = load_events()
    tickers = {ticker for event in events for ticker in event["tickers"]}
    tickers.update(ticker for peers in PEERS.values() for ticker in peers)
    graph_path = ROOT / "data/graph.json"
    if graph_path.exists():
        import json

        graph = json.loads(graph_path.read_text())
        tickers.update(node.get("ticker", node["id"]) for node in graph["nodes"])
    for ticker in sorted(tickers | {"SPY"}):
        path = ROOT / "data/prices" / f"{ticker}.csv"
        if path.exists() and not args.refresh:
            continue
        try:
            prices = fetch_prices(ticker)
            print(f"{ticker}: cached {len(prices)} real adjusted daily closes", flush=True)
        except Exception as exc:
            print(f"{ticker}: unavailable: {exc}", flush=True)
    print(f"{len(ingest())} total cached events", flush=True)


if __name__ == "__main__":
    main()

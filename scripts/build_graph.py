"""Reproduce SEC edges using upstream ingestion and graph construction, never an LLM.

Online: SEC_USER_AGENT='Your name email@example.com' python scripts/build_graph.py --fetch
Offline: python scripts/build_graph.py
Only the transport/cache and schema serialization are project code. Filing discovery
is alphasig.EdgarClient; text parsing and edge extraction are stock-relation.
"""

from __future__ import annotations

import argparse
import asyncio
import gzip
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "vendor/alphasig/src"), str(ROOT / "vendor/stock-relation")]

from alphasig.edgar import EdgarClient  # noqa: E402
from alphasig.graph import SupplyChainGraph  # noqa: E402
from alphasig.models import SupplyChainEdge  # noqa: E402
from api import db  # noqa: E402
from ingestion.supply_chain import SupplyChainIngester  # noqa: E402

CACHE = ROOT / "data/sec"
# A disclosed sampling frame, not an edge list: every edge must be extracted.
FILERS = [
    "SWKS",
    "QRVO",
    "AVGO",
    "QCOM",
    "MU",
    "AMD",
    "RTX",
    "TXT",
    "SPR",
    "HWM",
    "TDG",
    "GE",
    "HON",
    "APH",
    "ON",
    "ALB",
]
CUSTOMERS = {
    "AAPL": "Apple",
    "MSFT": "Microsoft",
    "AMZN": "Amazon",
    "NVDA": "NVIDIA",
    "TSLA": "Tesla",
    "BA": "Boeing",
    "LMT": "Lockheed Martin",
    "F": "Ford Motor",
    "GM": "General Motors",
    "RTX": "Raytheon Technologies",
    "GE": "General Electric",
}


class CompressedEdgarClient(EdgarClient):
    """Preserve original primary SEC HTML in gzip; HTTP behavior remains upstream."""

    async def _get_cached(self, url: str) -> str:
        path = self._cache_key(url)
        zipped = path.with_suffix(".html.gz") if path else None
        if zipped and zipped.exists():
            return gzip.decompress(zipped.read_bytes()).decode()
        text = await super()._get_cached(url)
        if zipped:
            zipped.write_bytes(gzip.compress(text.encode(), mtime=0))
            path.unlink(missing_ok=True)
        return text


async def discover(user_agent: str) -> list[dict]:
    """Use upstream EDGAR ingestion to discover and download primary 2021 filings."""
    records = []
    failures = []
    async with CompressedEdgarClient(user_agent, cache_dir=CACHE / "raw") as client:
        for ticker in FILERS:
            try:
                filings = await client.get_filings(ticker, ["10-K"], lookback_years=8)
                # Freeze inputs before the historical study; record the actual public date.
                choices = [f for f in filings if f.filed_date.year == 2021]
                if not choices:
                    failures.append({"ticker": ticker, "reason": "no 2021 10-K found"})
                    continue
                filing = await client.fetch_filing_html(choices[-1])
                record = filing.model_dump(mode="json", exclude={"raw_html"})
                record["raw_sha256"] = hashlib.sha256(filing.raw_html.encode()).hexdigest()
                records.append(record)
                print(ticker, filing.filed_date, len(filing.raw_html))
            except Exception as exc:
                failures.append({"ticker": ticker, "reason": str(exc)})
                print(ticker, type(exc).__name__, str(exc))
    (CACHE / "filings.json").write_text(json.dumps(records, indent=2) + "\n")
    (CACHE / "fetch-failures.json").write_text(json.dumps(failures, indent=2) + "\n")
    return records


class CachedIngester(SupplyChainIngester):
    """Only override discovery and I/O; upstream ingest() makes the edges."""

    def __init__(self, records: list[dict], fetch: bool, user_agent: str):
        super().__init__(use_classifier=False)
        self.records = records
        self.fetch = fetch
        self.user_agent = user_agent

    def _edgar_combined_search(self, combined_queries: list[str]) -> list[dict]:
        # Primary filings already selected by alphasig, avoiding EFTS exhibits.
        return [
            {
                "entity_name": f["company_name"],
                "ticker": f["ticker"],
                "cik": f["cik"],
                "adsh": f["accession_number"],
                "filename": f["url"].rsplit("/", 1)[-1],
                "form": f["filing_type"],
                "file_date": f["filed_date"],
            }
            for f in self.records
        ]

    def _fetch_filing_text(self, hit: dict) -> str:
        path = CACHE / f"{hit['ticker']}-{hit['adsh']}.txt"
        if path.exists():
            return path.read_text()
        if not self.fetch:
            raise FileNotFoundError(f"{path}: run --fetch once")
        # Use the original stock-relation HTML parser. No project SEC parser.
        # Serve alphasig's already cached raw HTML through the parser's HTTP call.
        from unittest.mock import patch

        import httpx
        import ingestion.supply_chain as upstream

        f = next(f for f in self.records if f["accession_number"] == hit["adsh"])
        digest = hashlib.sha256(f["url"].encode()).hexdigest()[:16]
        raw = gzip.decompress((CACHE / "raw" / f"{digest}.html.gz").read_bytes()).decode()
        response = httpx.Response(200, text=raw)
        with patch.object(upstream.httpx, "get", return_value=response):
            text = super()._fetch_filing_text(hit)
        path.write_text(text)
        return text


def build(fetch: bool = False) -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    user_agent = os.environ.get("SEC_USER_AGENT", "")
    if fetch and ("@" not in user_agent or not user_agent.strip()):
        raise ValueError("Set SEC_USER_AGENT to your real name and contact email for SEC access")
    records = (
        asyncio.run(discover(user_agent))
        if fetch
        else json.loads((CACHE / "filings.json").read_text())
    )
    with tempfile.TemporaryDirectory(prefix="scsm-edges-") as tmp:
        db._DB_PATH = Path(tmp) / "edges.sqlite"
        db.init_db()
        ingester = CachedIngester(records, fetch, user_agent)
        # Tickers are included by upstream aliasing; short tickers <=2 letters are excluded there.
        profiles = [
            {"ticker": t, "shortName": name, "longName": name} for t, name in CUSTOMERS.items()
        ]
        ingester.ingest([t for t in CUSTOMERS if t not in {"RTX", "GE"}], profiles)
        ingester.ingest(["RTX", "GE"], profiles)
        conn = db.get_db()
        rows = [
            dict(r)
            for r in conn.execute("SELECT * FROM supply_chain ORDER BY source, target_ticker")
        ]
        conn.close()
    record_by_ticker = {r["ticker"]: r for r in records}
    candidates = []
    for row in rows:
        f = record_by_ticker[row["target_ticker"]]
        candidates.append(
            {
                "source": row["target_ticker"],
                "target": row["source"],
                "evidence": row["evidence"],
                "source_url": f["url"],
                "filed_date": f["filed_date"],
                "accession_number": f["accession_number"],
                "evidence_sha256": hashlib.sha256(row["evidence"].encode()).hexdigest(),
                "extraction_confidence": row["confidence"],
            }
        )
    (CACHE / "candidates.json").write_text(json.dumps(candidates, indent=2) + "\n")
    # Manual evidence review may only remove candidates. The hash must match exact
    # upstream output; it cannot add or edit an edge or a sentence.
    review_path = CACHE / "reviewed-evidence.json"
    reviews = json.loads(review_path.read_text()) if review_path.exists() else {}
    approved = [c for c in candidates if c["evidence_sha256"] in reviews.get("accepted", {})]
    models = [
        SupplyChainEdge(
            source=c["source"],
            target=c["target"],
            relation="supplies_to",
            context=c["evidence"],
            confidence=c["extraction_confidence"],
            exposure=None,
            filing_type="10-K",
            filed_date=c["filed_date"],
        )
        for c in approved
    ]
    graph = SupplyChainGraph(models)
    graph_dict = graph.to_dict()
    names = {r["ticker"]: r["company_name"] for r in records} | CUSTOMERS
    company_path = ROOT / "data/companies.json"
    companies = (
        json.loads(company_path.read_text()).get("companies", []) if company_path.exists() else []
    )
    sectors = {c["ticker"]: c.get("sector", "Unknown") for c in companies}
    result = {
        "nodes": [
            {"id": t, "ticker": t, "name": names[t], "sector": sectors.get(t, "Unknown")}
            for t in sorted(graph.nodes)
        ],
        "edges": [
            {
                **c,
                "weight": 0.5,
                "weight_is_assumption": True,
                "weight_basis": "uncalibrated uniform modeling assumption; not SEC exposure",
                "relation": "supplies_to",
            }
            for c in approved
        ],
        "metadata": {
            "source": "SEC EDGAR primary 2021 10-K filings",
            "discovery": "alphasig.EdgarClient.get_filings/fetch_filing_html",
            "extractor": "stock-relation.SupplyChainIngester.ingest deterministic keyword fallback",
            "graph_builder": "alphasig.SupplyChainGraph",
            "candidate_edges": len(candidates),
            "reviewed_edges": len(approved),
            "graph_edge_count": len(graph_dict["edges"]),
            "filings_fetched": len(records),
            "filers_requested": FILERS,
            "limitations": [
                "Small disclosed supplier sample, not full S&P 500 coverage.",
                "Keyword extraction is noisy; published candidates are manually evidence-reviewed.",
                (
                    "Manual review removes false candidates only; every retained edge "
                    "and evidence sentence is upstream output."
                ),
                (
                    "Confidence 0.8 is the upstream keyword fallback constant, "
                    "not a measured probability."
                ),
                "Uniform weight 0.5 is a modeling assumption, not measured economic exposure.",
                "Only dated edges public before an event may be used for historical propagation.",
                "2021 relationships may have changed; refresh and review before live use.",
            ],
        },
    }
    (ROOT / "data/graph.json").write_text(json.dumps(result, indent=2) + "\n")
    print(
        f"Graph: {len(result['nodes'])} nodes, {len(approved)} reviewed edges "
        f"({len(candidates)} candidates)"
    )
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true")
    args = parser.parse_args()
    build(args.fetch)

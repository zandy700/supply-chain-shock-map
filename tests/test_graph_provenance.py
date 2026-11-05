"""Protect the real SEC evidence chain against synthetic or unreviewed edges."""

import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_all_graph_edges_are_reviewed_upstream_candidates():
    graph = json.loads((ROOT / "data/graph.json").read_text())
    candidates = json.loads((ROOT / "data/sec/candidates.json").read_text())
    review = json.loads((ROOT / "data/sec/reviewed-evidence.json").read_text())
    assert graph["edges"], "Ship the real SEC subset, not an empty decorative graph"
    for edge in graph["edges"]:
        digest = hashlib.sha256(edge["evidence"].encode()).hexdigest()
        assert digest == edge["evidence_sha256"]
        assert digest in review["accepted"]
        assert digest not in review["rejected"]
        assert any(
            c["source"] == edge["source"]
            and c["target"] == edge["target"]
            and c["evidence_sha256"] == digest
            for c in candidates
        )
        text = ROOT / "data/sec" / f"{edge['source']}-{edge['accession_number']}.txt"
        # Upstream extraction normalizes newlines in each evidence sentence.
        normalized = text.read_text().replace("\n", " ")
        assert edge["evidence"] in normalized
        assert edge["source_url"].startswith("https://www.sec.gov/Archives/edgar/data/")
        assert edge["filed_date"] < "2022-01-01"
        assert edge["relation"] == "supplies_to"
        assert edge["weight_basis"].startswith("uncalibrated")


def test_raw_sec_filings_match_recorded_download_hashes():
    records = json.loads((ROOT / "data/sec/filings.json").read_text())
    assert records
    for record in records:
        cache_key = hashlib.sha256(record["url"].encode()).hexdigest()[:16]
        raw_path = ROOT / "data/sec/raw" / f"{cache_key}.html.gz"
        raw = gzip.decompress(raw_path.read_bytes())
        assert hashlib.sha256(raw).hexdigest() == record["raw_sha256"]
        assert record["filing_type"] == "10-K"

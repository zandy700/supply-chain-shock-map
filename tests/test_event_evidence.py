def test_positive_cohort_has_fetched_evidence_and_mature_prices():
    import gzip
    import hashlib
    import json
    from pathlib import Path

    from bs4 import BeautifulSoup

    from scsm.backtest import event_study

    root = Path(__file__).resolve().parents[1]
    events = json.loads((root / "data/events/historical.json").read_text())["events"]
    positives = [e for e in events if e["sign"] == 1]
    assert len(positives) >= 20
    non_apple = [e for e in positives if "AAPL" not in e["tickers"]]
    assert len({t for e in non_apple for t in e["tickers"]}) >= 5
    required = {
        "earnings_beat",
        "guidance_raise",
        "major_win",
        "supplier_expansion",
        "rate_cut_relief",
    }
    assert len({e["event_type"] for e in non_apple} & required) >= 3
    assert sum(e["sign"] == -1 for e in events) >= 20
    assert max(e["date"] for e in positives) >= "2026-11-01"
    for e in positives:
        assert e["source_url"].startswith("https://")
        raw = gzip.decompress((root / e["source_snapshot"]).read_bytes())
        assert hashlib.sha256(raw).hexdigest() == e["source_sha256"]
        text = " ".join(BeautifulSoup(raw, "html.parser").get_text(" ", strip=True).split())
        assert " ".join(e["source_quote"].split()) in text
        assert e["source_date_quote"] in text
        # Every positive has at least a completed +1 study, even if +5/+20 are immature.
        assert event_study(e["tickers"][0], e["date"], 1)["estimation_n"] == 240

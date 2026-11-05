"""Deterministic, auditable news matching; GDELT transport is vendored gdelt-doc-api."""

from __future__ import annotations

import hashlib
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
sys.path.insert(0, str(ROOT / "vendor"))

# Severity is an explicit model assumption, not an empirical measurement.
RULES = [
    (
        "factory_fire",
        r"\b(?:factory|plant|warehouse)\b.{0,45}\bfire\b|\bfire\b.{0,45}\b(?:factory|plant|warehouse)\b",
        0.8,
    ),
    ("explosion", r"\bexplosion\b", 0.9),
    (
        "cyberattack",
        r"\b(?:cyberattack|cyber.attack|ransomware|data breach|cybersecurity (?:incident|issue))\b",
        0.7,
    ),
    ("export_ban", r"\bexport (?:ban|restrictions?|controls?|license|licensing)\b", 0.8),
    ("sanctions", r"\bsanctions?\b", 0.8),
    ("recall", r"\brecalls?|recalled\b", 0.6),
    ("strike", r"\b(?:strikes?|work stoppage)\b", 0.6),
    ("lawsuit", r"\b(?:lawsuits?|litigation|sued)\b", 0.4),
]


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def load_companies():
    return json.loads((DATA / "companies.json").read_text())["companies"]


def match_companies(text, companies=None):
    """Name/alias matches on word boundaries. Never match bare ticker words."""
    found = []
    for company in companies if companies is not None else load_companies():
        aliases = company.get("aliases", [company["name"]])
        if any(
            len(alias) >= 3 and re.search(r"(?<!\w)" + re.escape(alias) + r"(?!\w)", text, re.I)
            for alias in aliases
        ):
            found.append(company["ticker"])
    return sorted(set(found))


def classify(text):
    # A headline-only heuristic cannot establish causality; skip simple negations.
    clean = re.sub(
        r"\b(?:not a|not an|no|averted|avoided)\s+(?:cyberattack|strike|recall|explosion)\b",
        "",
        text,
        flags=re.I,
    )
    clean = re.sub(r"\b(?:strike|recall|explosion)\s+(?:averted|avoided)\b", "", clean, flags=re.I)
    for event_type, pattern, severity in RULES:
        if re.search(pattern, clean, re.I):
            return {
                "event_type": event_type,
                "sign": -1,
                "severity": severity,
                "classification_method": "headline keyword heuristic v1",
            }
    return {
        "event_type": "unclassified",
        "sign": 0,
        "severity": 0.0,
        "classification_method": "headline keyword heuristic v1",
    }


def load_events():
    events = {}
    for path in sorted((DATA / "events").glob("*.json")):
        payload = json.loads(path.read_text())
        rows = payload if isinstance(payload, list) else payload.get("events", [])
        for row in rows:
            events[row["id"]] = row
    return sorted(events.values(), key=lambda x: (x["date"], x["id"]), reverse=True)


def ingest(offline=False):
    """Fetch recent real article metadata; preserve retrieval failures as metadata.

    GDELT seendate is first observation time, not a verified incident date. The
    returned title matches are candidates requiring human confirmation.
    """
    if offline:
        return load_events()
    from gdeltdoc import Filters, GdeltDoc

    filters = Filters(
        keyword=[
            "fire",
            "explosion",
            "strike",
            "lawsuit",
            "recall",
            "export ban",
            "sanctions",
            "cyberattack",
        ],
        timespan="1w",
        num_records=250,
        country="US",
    )
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    payload = {
        "retrieved_at": utc_now(),
        "source": "GDELT DOC 2.0 via gdelt-doc-api",
        "query": filters.query_string,
        "events": [],
        "status": "ok",
    }
    success = False
    for attempt in range(2):
        try:
            rows = GdeltDoc().article_search(filters)
            payload["raw_articles"] = rows.to_dict(orient="records")
            for _, row in rows.iterrows():
                title = str(row.get("title", ""))
                tickers = match_companies(title)
                kind = classify(title)
                if not tickers or not kind["sign"]:
                    continue
                url = str(row["url"])
                seen = str(row.get("seendate", ""))
                observed = datetime.strptime(seen[:8], "%Y%m%d").date().isoformat()
                payload["events"].append(
                    {
                        "id": hashlib.sha256(url.encode()).hexdigest()[:20],
                        "date": observed,
                        "title": title,
                        "url": url,
                        "tickers": tickers,
                        **kind,
                        "source": "GDELT DOC 2.0",
                        "retrieved_at": payload["retrieved_at"],
                        "date_basis": "GDELT seendate; incident timing unverified",
                        "review_status": "unreviewed",
                    }
                )
            success = True
            break
        except Exception as exc:
            payload["status"] = "unavailable"
            response = getattr(exc, "response", None)
            detail = response.text[:500] if response is not None else str(exc)
            payload["error"] = f"{type(exc).__name__}: {detail}"[:700]
            if attempt == 0:
                time.sleep(6)
    # A successful retry clears the previous attempt's error/status.
    if success:
        payload["status"] = "ok"
        payload.pop("error", None)
    (DATA / "events").mkdir(parents=True, exist_ok=True)
    (DATA / "events" / f"gdelt-{stamp}.json").write_text(json.dumps(payload, indent=2) + "\n")
    return load_events()

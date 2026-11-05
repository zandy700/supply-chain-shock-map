"""Append-only, SHA256 chained prediction records using canonical JSON (RFC 8785)."""

import fcntl
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import jcs

from scsm.paths import ROOT

PREDICTIONS = ROOT / "ledger" / "predictions.jsonl"
GENESIS = "0" * 64


def canonical(value):
    """RFC 8785 canonical JSON; identical numbers in Python and the browser."""
    return jcs.canonicalize(value).decode("utf-8")


def digest(record):
    return hashlib.sha256(
        canonical({k: v for k, v in record.items() if k != "hash"}).encode("utf-8")
    ).hexdigest()


def read_records(path=PREDICTIONS):
    path = Path(path)
    if not path.exists():
        return []
    content = path.read_text(encoding="utf-8")
    if content and not content.endswith("\n"):
        raise ValueError("unterminated ledger record")
    lines = content.splitlines()
    if any(not line.strip() for line in lines):
        raise ValueError("blank ledger line")
    records = [json.loads(line) for line in lines]
    if not all(isinstance(record, dict) for record in records):
        raise ValueError("ledger record must be an object")
    return records


def verify(path=PREDICTIONS):
    previous = GENESIS
    count = 0
    try:
        for count, record in enumerate(read_records(path), 1):
            if record.get("prev_hash") != previous or record.get("hash") != digest(record):
                return {"valid": False, "count": count - 1, "error": f"invalid record {count}"}
            for key in ("timestamp_utc", "event", "predictions"):
                if key not in record:
                    raise ValueError(f"missing {key} at record {count}")
            timestamp = datetime.fromisoformat(record["timestamp_utc"].replace("Z", "+00:00"))
            if timestamp.tzinfo is None or timestamp.utcoffset().total_seconds() != 0:
                raise ValueError("ledger issuance timestamps must be UTC")
            previous = record["hash"]
        return {"valid": True, "count": count, "head": previous}
    except (ValueError, TypeError, KeyError, OverflowError) as exc:
        return {"valid": False, "count": count, "error": str(exc)}


def append_prediction(event, predictions, *, path=PREDICTIONS, now=None):
    """Deduplicate event IDs while holding a process lock; reject corrupt chains.

    Predictions issued after their event date are historical replays. They never
    contribute to prospective accuracy. The hash proves integrity relative to a
    trusted head, not independent timestamping or protection against full rewrite.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset().total_seconds() != 0:
        raise ValueError("issuance time must be timezone-aware UTC")
    with path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        status = verify(path)
        if not status["valid"]:
            raise ValueError(f"invalid prediction chain: {status['error']}")
        records = read_records(path)
        if any(r["event"]["id"] == event["id"] for r in records):
            return None
        date = event.get("date", "")[:10]
        if not date:
            raise ValueError("event must have a real date")
        datetime.strptime(date, "%Y-%m-%d")
        record = {
            "timestamp_utc": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "event": event,
            "predictions": predictions,
            "prev_hash": status["head"],
            "mode": "historical_replay" if date < now.date().isoformat() else "prospective",
            "model_version": "0.1.0",
        }
        record["hash"] = digest(record)
        handle.write(canonical(record) + "\n")
        handle.flush()
        import os

        os.fsync(handle.fileno())
        return record

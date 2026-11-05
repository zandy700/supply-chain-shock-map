"""Score matured prospective predictions without changing the prediction ledger."""

import fcntl
import json
from datetime import datetime, timezone
from pathlib import Path

from scsm.ledger import PREDICTIONS, canonical, read_records, verify
from scsm.paths import ROOT

SCORES = ROOT / "ledger" / "scores.jsonl"


def score_anchor(issued, offline):
    """Last observed SPY session on/before issuance UTC date.

    CAR starts on the next session; even pre-open issuance conservatively excludes
    its calendar date, avoiding returns observed before issuance. A weekend uses
    Friday as day 0 so Monday is +1, rather than silently skipping Monday.
    """
    from scsm.backtest import load_prices

    market = load_prices("SPY", offline=offline)
    eligible = market.index[market.index.strftime("%Y-%m-%d") <= issued.date().isoformat()]
    if not len(eligible):
        raise ValueError("no market session on or before issuance")
    return eligible[-1].date().isoformat()


def score_ledger(*, predictions_path=PREDICTIONS, scores_path=SCORES, offline=True, now=None):
    from scsm.backtest import event_study

    status = verify(predictions_path)
    if not status["valid"]:
        raise ValueError(f"invalid prediction chain: {status['error']}")
    now = now or datetime.now(timezone.utc)
    scores_path = Path(scores_path)
    scores_path.parent.mkdir(parents=True, exist_ok=True)
    summary = {"added": 0, "pending": 0, "replays_skipped": 0, "unavailable": []}
    with scores_path.open("a+", encoding="utf-8") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        existing = {
            (r["prediction_hash"], r["ticker"], r["horizon"]) for r in read_records(scores_path)
        }
        for record in read_records(predictions_path):
            if record.get("mode") != "prospective":
                summary["replays_skipped"] += 1
                continue
            issued = datetime.fromisoformat(record["timestamp_utc"].replace("Z", "+00:00"))
            try:
                score_date = score_anchor(issued, offline)
            except (ValueError, FileNotFoundError, RuntimeError) as exc:
                summary["pending"] += len(record["predictions"]) * 3
                summary["unavailable"].append(
                    {"prediction_hash": record["hash"], "reason": str(exc)}
                )
                continue
            for prediction in record["predictions"]:
                for horizon in (1, 5, 20):
                    key = (record["hash"], prediction["ticker"], horizon)
                    if key in existing:
                        continue
                    if now.date().isoformat() <= score_date:
                        summary["pending"] += 1
                        continue
                    try:
                        outcome = event_study(
                            prediction["ticker"], score_date, horizon, offline=offline
                        )
                        end_date = outcome.get("end_date", outcome.get("window_end"))
                        if not end_date:
                            raise ValueError("event study did not provide realized window end")
                        if end_date[:10] >= now.date().isoformat():
                            summary["pending"] += 1
                            continue
                        score = {
                            "timestamp_utc": now.isoformat(timespec="seconds").replace(
                                "+00:00", "Z"
                            ),
                            "prediction_hash": record["hash"],
                            "ticker": prediction["ticker"],
                            "horizon": horizon,
                            "predicted_pct": prediction["magnitude"],
                            "actual_car_pct": outcome["car_pct"],
                            "anchor_date": score_date,
                            "window_end": end_date,
                            "hit": prediction["magnitude"] * outcome["car_pct"] > 0,
                        }
                        handle.write(canonical(score) + "\n")
                        existing.add(key)
                        summary["added"] += 1
                    except (ValueError, FileNotFoundError, KeyError, RuntimeError) as exc:
                        summary["pending"] += 1
                        summary["unavailable"].append(
                            {"ticker": prediction["ticker"], "horizon": horizon, "reason": str(exc)}
                        )
        handle.flush()
    # JSON-compatible result, also useful to the daily action's logs.
    return json.loads(json.dumps(summary))

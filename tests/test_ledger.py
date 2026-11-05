import json

import pytest

from scsm.ledger import append_prediction, canonical, read_records, verify

EVENT = {"id": "real-event", "date": "2024-09-13", "tickers": ["BA"], "title": "strike"}
PREDICTIONS = [{"ticker": "BA", "magnitude": -2, "path": ["BA"], "hops": 0}]


def test_hash_chain_append_only_and_duplicates(tmp_path):
    path = tmp_path / "predictions.jsonl"
    first = append_prediction(EVENT, PREDICTIONS, path=path)
    prefix = path.read_bytes()
    assert append_prediction(EVENT, PREDICTIONS, path=path) is None
    second = append_prediction({**EVENT, "id": "next"}, PREDICTIONS, path=path)
    assert path.read_bytes().startswith(prefix)
    assert second["prev_hash"] == first["hash"]
    assert verify(path)["valid"]
    assert verify(path)["count"] == 2
    assert first["event"]["date"] < first["timestamp_utc"][:10]
    assert first["mode"] == "historical_replay"


def test_tampered_and_truncated_record_are_rejected(tmp_path):
    path = tmp_path / "predictions.jsonl"
    append_prediction(EVENT, PREDICTIONS, path=path)
    record = read_records(path)[0]
    record["predictions"][0]["magnitude"] = 90
    path.write_text(json.dumps(record) + "\n")
    assert not verify(path)["valid"]
    with pytest.raises(ValueError, match="invalid"):
        append_prediction({**EVENT, "id": "new"}, PREDICTIONS, path=path)
    path.write_text('{"timestamp_utc":')
    assert not verify(path)["valid"]


def test_canonical_matches_browser_utf8():
    assert canonical({"z": 1, "a": {"é": [1, "hi"]}}) == '{"a":{"é":[1,"hi"]},"z":1}'


def test_missing_is_valid_empty_ledger(tmp_path):
    assert verify(tmp_path / "missing")["valid"]


def test_score_never_modifies_predictions_or_scores_replays(tmp_path):
    from scsm.score import score_ledger

    path = tmp_path / "predictions.jsonl"
    append_prediction(EVENT, PREDICTIONS, path=path)
    original = path.read_bytes()
    scores = tmp_path / "scores.jsonl"
    result = score_ledger(predictions_path=path, scores_path=scores)
    assert result["added"] == 0
    assert result["replays_skipped"] == 1
    assert path.read_bytes() == original


def test_scores_matured_once_and_preserves_prediction_bytes(tmp_path, monkeypatch):
    from datetime import datetime, timezone

    import scsm.backtest
    from scsm.score import score_ledger

    path = tmp_path / "predictions.jsonl"
    scores = tmp_path / "scores.jsonl"
    issued = datetime(2024, 9, 13, 18, tzinfo=timezone.utc)
    append_prediction(EVENT, PREDICTIONS, path=path, now=issued)
    original = path.read_bytes()
    calls = []

    def study(ticker, anchor, horizon, offline):
        calls.append((ticker, anchor, horizon, offline))
        return {"car_pct": -1.5, "window_end": "2024-10-20"}

    monkeypatch.setattr(scsm.backtest, "event_study", study)
    now = datetime(2024, 11, 1, tzinfo=timezone.utc)
    result = score_ledger(predictions_path=path, scores_path=scores, now=now)
    assert result["added"] == 3
    assert {call[1] for call in calls} == {"2024-09-13"}
    assert len(read_records(scores)) == 3
    assert all(score["hit"] for score in read_records(scores))
    assert score_ledger(predictions_path=path, scores_path=scores, now=now)["added"] == 0
    assert path.read_bytes() == original


def test_incomplete_or_current_session_outcomes_stay_pending(tmp_path, monkeypatch):
    from datetime import datetime, timezone

    import scsm.backtest
    from scsm.score import score_ledger

    path = tmp_path / "predictions.jsonl"
    scores = tmp_path / "scores.jsonl"
    issued = datetime(2024, 9, 13, 18, tzinfo=timezone.utc)
    append_prediction(EVENT, PREDICTIONS, path=path, now=issued)
    monkeypatch.setattr(
        scsm.backtest,
        "event_study",
        lambda *args, **kwargs: {"car_pct": 1, "window_end": "2024-09-16"},
    )
    result = score_ledger(
        predictions_path=path,
        scores_path=scores,
        now=datetime(2024, 9, 16, 23, tzinfo=timezone.utc),
    )
    assert result["added"] == 0
    assert result["pending"] == 3
    assert read_records(scores) == []


def test_canonical_numbers_are_javascript_compatible():
    assert canonical({"negative_integer": -2.0, "small": 0.000001}) == (
        '{"negative_integer":-2,"small":0.000001}'
    )


def test_unterminated_ledger_rejects_append_without_mutation(tmp_path):
    path = tmp_path / "predictions.jsonl"
    append_prediction(EVENT, PREDICTIONS, path=path)
    path.write_bytes(path.read_bytes().rstrip(b"\n"))
    original = path.read_bytes()
    assert not verify(path)["valid"]
    with pytest.raises(ValueError, match="invalid"):
        append_prediction({**EVENT, "id": "new"}, PREDICTIONS, path=path)
    assert path.read_bytes() == original


def test_malformed_event_date_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        append_prediction(
            {**EVENT, "date": "tomorrow"}, PREDICTIONS, path=tmp_path / "predictions.jsonl"
        )


def test_score_anchor_uses_previous_session_on_weekend(monkeypatch):
    from datetime import datetime, timezone

    import pandas as pd

    import scsm.backtest
    from scsm.score import score_anchor

    prices = pd.Series(
        [100, 101, 102], index=pd.to_datetime(["2024-09-12", "2024-09-13", "2024-09-16"])
    )
    monkeypatch.setattr(scsm.backtest, "load_prices", lambda *args, **kwargs: prices)
    assert score_anchor(datetime(2024, 9, 13, 22, tzinfo=timezone.utc), True) == "2024-09-13"
    assert score_anchor(datetime(2024, 9, 15, 22, tzinfo=timezone.utc), True) == "2024-09-13"

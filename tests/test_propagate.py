import pytest

from scsm.propagate import propagate


def graph(edges):
    return {"nodes": [], "edges": edges}


def event(ticker="S"):
    return {"tickers": [ticker], "severity": 0.8, "sign": -1, "event_type": "fire"}


def test_supplier_disruption_hurts_customer_and_decays():
    edges = [
        {"source": "S", "target": "C", "weight": 0.5},
        {"source": "C", "target": "D", "weight": 1},
    ]
    found = {p["ticker"]: p for p in propagate(event(), graph(edges))}
    assert found["S"]["magnitude"] == -4.0
    assert found["C"]["magnitude"] == pytest.approx(-1)
    assert found["D"]["magnitude"] == pytest.approx(-0.5)
    assert found["D"]["path"] == ["S", "C", "D"]
    assert found["D"]["direction"] == "negative"


def test_does_not_propagate_upstream_and_cycles_terminate():
    edges = [
        {"source": "S", "target": "C", "weight": 1},
        {"source": "C", "target": "S", "weight": 1},
    ]
    assert len(propagate(event(), graph(edges))) == 2
    assert len(propagate(event("C"), graph(edges[:1]))) == 1


def test_competitor_is_explicit_scenario_not_supply_edge():
    predictions = propagate(
        event(), graph([{"source": "S", "target": "R", "weight": 0.3, "relation": "competitor"}])
    )
    rival = next(p for p in predictions if p["ticker"] == "R")
    assert rival["magnitude"] > 0
    assert rival["scenario"] == "competitor substitution (heuristic)"


def test_missing_weights_use_labeled_default_and_input_validation():
    predicted = propagate(event(), graph([{"source": "S", "target": "C"}]))
    assert predicted[1]["weight_assumption"]
    with pytest.raises(ValueError):
        propagate({**event(), "severity": float("nan")}, graph([]))
    with pytest.raises(ValueError):
        propagate(event(), graph([{"source": "S", "target": "C", "weight": 5}]))


def test_historical_event_does_not_use_unknown_or_future_filing():
    edges = [
        {"source": "S", "target": "UNKNOWN", "weight": 0.5},
        {"source": "S", "target": "FUTURE", "weight": 0.5, "filed_date": "2026-01-01"},
        {"source": "S", "target": "KNOWN", "weight": 0.5, "filed_date": "2020-01-01"},
    ]
    predictions = propagate({**event(), "date": "2024-01-01"}, graph(edges))
    assert {p["ticker"] for p in predictions} == {"S", "KNOWN"}

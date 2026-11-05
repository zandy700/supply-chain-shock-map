import pytest

from scsm.backtest import evaluate_by_group
from scsm.news import classify
from scsm.propagate import propagate


@pytest.mark.parametrize(
    ("headline", "kind"),
    [
        ("Apple earnings beat expectations", "earnings_beat"),
        ("Apple launches new product", "product_launch"),
        ("Apple raises guidance", "guidance_raise"),
        ("Boeing wins major contract", "major_win"),
        ("Federal Reserve rate cut relief", "rate_cut_relief"),
        ("Supplier capacity expansion", "supplier_expansion"),
    ],
)
def test_positive_taxonomy(headline, kind):
    assert classify(headline)["event_type"] == kind
    assert classify(headline)["sign"] == 1


@pytest.mark.parametrize("sign", [-1, 1])
def test_signed_paths_and_competition(sign):
    graph = {
        "edges": [
            {"source": "S", "target": "C", "weight": 0.5},
            {"source": "C", "target": "D", "weight": 1},
            {"source": "C", "target": "R", "weight": 0.5, "relation": "competitor"},
            {"source": "R", "target": "X", "weight": 1},
        ]
    }
    rows = {
        p["ticker"]: p for p in propagate({"tickers": ["C"], "sign": sign, "severity": 0.8}, graph)
    }
    assert rows["C"]["magnitude"] == sign * 4
    assert rows["S"]["magnitude"] == sign
    assert rows["D"]["magnitude"] == sign * 2
    assert rows["R"]["magnitude"] == -sign
    assert "X" not in rows


def test_sign_evaluation_keeps_positive_and_negative_separate():
    rows = [
        dict(event_id="a", predicted=2, actual=1, hops=0),
        dict(event_id="b", predicted=-2, actual=1, hops=0),
    ]
    result = evaluate_by_group(rows, n_boot=100)
    assert result["positive"]["hit_rate"] == 1
    assert result["negative"]["hit_rate"] == 0


def test_negative_keyword_takes_precedence_over_launch():
    assert classify("Apple launches new product recall")["sign"] == -1


@pytest.mark.parametrize(
    "headline",
    [
        "Apple says no rate cut expected",
        "Apple rules out rate cuts this year",
        "Apple delays product launch",
        "Apple supplier capacity expansion cancelled",
    ],
)
def test_negated_or_cancelled_positive_catalysts_are_not_positive(headline):
    assert classify(headline)["sign"] == 0

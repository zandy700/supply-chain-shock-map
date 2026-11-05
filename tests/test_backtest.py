import numpy as np
import pandas as pd
import pytest

from scsm.backtest import market_model, study_prices, summarize


def test_market_model_recovers_known_alpha_beta():
    market = np.array([-0.02, 0.01, 0.015, -0.005, 0.03])
    alpha, beta = market_model(0.001 + 1.5 * market, market)
    assert alpha == pytest.approx(0.001)
    assert beta == pytest.approx(1.5)


def test_event_window_excludes_event_day_and_does_not_leak_estimation():
    dates = pd.bdate_range("2020-01-01", periods=320)
    market = np.sin(np.arange(320)) * 0.005
    stock = 0.001 + 1.2 * market
    stock[281:286] += 0.01
    spy = pd.Series(100 * np.cumprod(1 + market), index=dates)
    equity = pd.Series(100 * np.cumprod(1 + stock), index=dates)
    result = study_prices(equity, spy, dates[280].date().isoformat(), 5)
    assert result["car_pct"] == pytest.approx(5.0, abs=1e-8)
    assert result["estimation_n"] == 240
    assert result["window_start"] == dates[281].date().isoformat()


def test_incomplete_horizon_is_not_scored():
    dates = pd.bdate_range("2020-01-01", periods=260)
    prices = pd.Series(np.exp(np.arange(260) * 0.001), index=dates)
    with pytest.raises(ValueError, match="horizon|estimation"):
        study_prices(prices, prices, dates[-2].date().isoformat(), 20)


def test_metrics_are_defined_and_constant_correlations_are_null():
    result = summarize(
        [
            {"predicted": -1.0, "actual": -2.0, "event_id": "a"},
            {"predicted": -1.0, "actual": 2.0, "event_id": "b"},
        ],
        bootstrap_n=50,
    )
    assert result["directional_hit_rate"] == 0.5
    assert result["mae"] == 2.0
    assert result["pearson"] is None
    assert result["bootstrap_ci"]["directional_hit_rate"] is not None


def test_online_prices_refresh_existing_cache_once(tmp_path, monkeypatch):
    import scsm.backtest as module

    directory = tmp_path / "prices"
    directory.mkdir()
    pd.DataFrame({"date": ["2020-01-01"], "adjusted_close": [100.0]}).to_csv(
        directory / "TEST.csv", index=False
    )
    monkeypatch.setattr(module, "DATA", tmp_path)
    calls = []
    monkeypatch.setattr(module, "fetch_prices", lambda ticker: calls.append(ticker))
    module.load_prices("TEST", offline=False)
    module.load_prices("TEST", offline=False)
    assert calls == ["TEST"]


def test_shipped_real_prices_produce_full_estimation_window():
    from scsm.backtest import event_study

    result = event_study("BA", "2024-09-13", 5, offline=True)
    assert result["estimation_n"] == 240
    assert result["event_trading_date"] == "2024-09-13"
    assert result["window_start"] == "2024-09-16"
    assert result["window_end"] == "2024-09-20"
    assert np.isfinite(result["car_pct"])


def _rows(spec):
    return [
        {"event_id": e, "predicted": p, "actual": a, "relation": rel, "hops": int(rel != "origin")}
        for e, p, a, rel in spec
    ]


def test_evaluate_hit_rate_mae_difference_and_binomial_p():
    from scsm.backtest import evaluate

    # 9 of 10 signs right; every model error is 1 pp smaller than |actual|.
    spec = [(f"e{i}", -1.0, -2.0, "origin") for i in range(9)] + [("e9", -1.0, 1.0, "origin")]
    result = evaluate(_rows(spec), n_boot=2000)
    assert result["n"] == 10 and result["events"] == 10 and result["hits"] == 9
    assert result["hit_rate"] == pytest.approx(0.9)
    assert result["binomial_p_two_sided"] == pytest.approx(22 / 1024)
    assert result["mae_model"] == pytest.approx(1.1)
    assert result["mae_zero"] == pytest.approx(1.9)
    assert result["mae_diff"] == pytest.approx(-0.8)
    low, high = result["hit_rate_ci95"]
    assert low <= 0.9 <= high <= 1.0
    low, high = result["mae_diff_ci95"]
    assert low <= -0.8 <= high


def test_evaluate_is_deterministic_and_clusters_by_event():
    from scsm.backtest import evaluate

    # One event with many identical predictions is a single resampling unit.
    rows = _rows([("a", -1.0, -3.0, "origin")] * 5 + [("b", -1.0, 2.0, "origin")])
    first, second = evaluate(rows, n_boot=500), evaluate(rows, n_boot=500)
    assert first == second
    assert first["events"] == 2
    # Bootstrap samples are {a,a}, {a,b}, {b,b}: rates 1, 5/6 and 0.
    assert first["hit_rate_ci95"] == [0.0, 1.0]


def test_evaluate_by_group_splits_direct_downstream_upstream():
    from scsm.backtest import evaluate_by_group

    rows = _rows(
        [
            ("a", -3.0, -1.0, "origin"),
            ("a", -0.75, 0.5, "downstream"),
            ("b", -3.0, -2.0, "origin"),
            ("b", -0.75, -0.2, "upstream"),
        ]
    )
    groups = evaluate_by_group(rows, n_boot=100)
    assert groups["overall"]["n"] == 4
    assert groups["direct"]["n"] == 2 and groups["direct"]["hit_rate"] == 1.0
    assert groups["downstream"]["n"] == 1 and groups["downstream"]["hits"] == 0
    assert groups["upstream"]["n"] == 1 and groups["upstream"]["hits"] == 1
    assert groups["propagated"]["n"] == 2
    assert evaluate_by_group([], n_boot=10)["upstream"]["hit_rate"] is None


def test_weekend_event_anchors_to_prior_session_so_monday_is_first_return():
    dates = pd.bdate_range("2020-01-01", periods=320)
    market = np.sin(np.arange(320)) * 0.005
    stock = 0.001 + 1.2 * market
    friday = next(i for i in range(270, 290) if dates[i].weekday() == 4)
    stock[friday + 1] += 0.03  # Monday reaction to a Sunday disclosure
    spy = pd.Series(100 * np.cumprod(1 + market), index=dates)
    equity = pd.Series(100 * np.cumprod(1 + stock), index=dates)
    sunday = (dates[friday] + pd.Timedelta(days=2)).date().isoformat()
    result = study_prices(equity, spy, sunday, 1)
    assert result["window_start"] == dates[friday + 1].date().isoformat()
    assert result["car_pct"] == pytest.approx(3.0, abs=1e-8)

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

"""EventStudy's OLS market-model approach, adapted to cached adjusted yfinance prices.

Reference implementation: vendor/EventStudy/return_calculator.py (MIT, Rongxin).
Uses exact trading-day windows, rather than upstream calendar approximations.
"""

from __future__ import annotations

import json
import warnings
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import binomtest, spearmanr

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
_REFRESHED = set()

PEERS = {
    "Information Technology": ["AAPL", "AMD", "MSFT"],
    "Industrials": ["CAT", "HON", "GE"],
    "Consumer Staples": ["KO", "PEP", "PG"],
    "Health Care": ["JNJ", "MRK", "PFE"],
    "Consumer Discretionary": ["AMZN", "HD", "MCD"],
    "Communication Services": ["GOOG", "META", "DIS"],
    "Energy": ["XOM", "CVX", "COP"],
    "Financials": ["JPM", "BAC", "WFC"],
}


def market_model(stock_returns, market_returns):
    """OLS r_stock = alpha + beta*r_SPY; units are fractional daily returns."""
    stock, market = np.asarray(stock_returns, float), np.asarray(market_returns, float)
    finite = np.isfinite(stock) & np.isfinite(market)
    stock, market = stock[finite], market[finite]
    if len(stock) < 3 or np.std(market) < 1e-12:
        raise ValueError("insufficient or singular estimation observations")
    alpha, beta = np.linalg.lstsq(
        np.column_stack([np.ones(len(market)), market]), stock, rcond=None
    )[0]
    return float(alpha), float(beta)


def load_prices(ticker, offline=True):
    path = DATA / "prices" / f"{ticker}.csv"
    if not path.exists() and offline:
        raise ValueError(f"no cached prices for {ticker}")
    refresh_key = (str(DATA), ticker, date.today().isoformat())
    if not offline and refresh_key not in _REFRESHED:
        _REFRESHED.add(refresh_key)
        try:
            # Refresh once per ticker/process, including an existing cache. Yahoo may
            # revise adjusted history, so a coherent full download is intentional.
            fetch_prices(ticker)
        except Exception as exc:
            if not path.exists():
                raise ValueError(f"prices unavailable for {ticker}: {exc}") from exc
            warnings.warn(
                f"Keeping cached {ticker} prices after refresh failure: {exc}",
                RuntimeWarning,
                stacklevel=2,
            )
    frame = pd.read_csv(path, parse_dates=["date"])
    prices = frame.set_index("date")["adjusted_close"].sort_index()
    return prices.loc[~prices.index.duplicated()]


def fetch_prices(ticker, start="2020-01-01", end=None):
    import yfinance as yf

    end = end or (date.today() + timedelta(days=1)).isoformat()
    frame = yf.download(
        ticker.replace(".", "-"),
        start=start,
        end=end,
        auto_adjust=True,
        progress=False,
        threads=False,
        timeout=25,
    )
    if frame.empty:
        raise ValueError(f"yfinance returned no prices for {ticker}")
    close = frame["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close = close.dropna()
    close.index = pd.DatetimeIndex(close.index).tz_localize(None)
    directory = DATA / "prices"
    directory.mkdir(parents=True, exist_ok=True)
    pd.DataFrame({"date": close.index.strftime("%Y-%m-%d"), "adjusted_close": close.values}).to_csv(
        directory / f"{ticker}.csv", index=False
    )
    metadata = {
        "ticker": ticker,
        "source": "Yahoo Finance via yfinance",
        "auto_adjust": True,
        "retrieved_at": datetime.now(timezone.utc).isoformat(),
        "requested_start": start,
        "requested_end_exclusive": end,
        "n": len(close),
        "warning": "Retrospectively adjusted prices; vendor revisions possible.",
    }
    (directory / f"{ticker}.meta.json").write_text(json.dumps(metadata, indent=2) + "\n")
    return close


def study_prices(stock, market, event_date, horizon):
    if horizon not in (1, 5, 20):
        raise ValueError("horizon must be 1, 5, or 20 trading days")
    joined = (
        pd.concat([stock.rename("stock"), market.rename("market")], axis=1).dropna().sort_index()
    )
    returns = joined.pct_change(fill_method=None)
    target = pd.Timestamp(event_date)
    # Day 0 is the last session on/before the disclosure date (as in score_anchor), so a
    # weekend or holiday disclosure is first priced at +1 rather than silently skipped.
    positions = np.flatnonzero(joined.index <= target)
    if not len(positions) or joined.index[-1] < target:
        raise ValueError("event date beyond price cache")
    day0 = int(positions[-1])
    if day0 < 251:
        raise ValueError("insufficient estimation history: require full -250..-11 window")
    if day0 + horizon >= len(returns):
        raise ValueError("incomplete matured horizon")
    estimation = returns.iloc[day0 - 250 : day0 - 10].dropna()
    if len(estimation) != 240:
        raise ValueError("incomplete estimation window")
    alpha, beta = market_model(estimation["stock"], estimation["market"])
    window = returns.iloc[day0 + 1 : day0 + horizon + 1]
    if len(window) != horizon or window.isna().any().any():
        raise ValueError("incomplete horizon returns")
    abnormal = window["stock"] - alpha - beta * window["market"]
    return {
        "car_pct": float(abnormal.sum() * 100),
        "alpha": alpha,
        "beta": beta,
        "estimation_n": len(estimation),
        "event_trading_date": joined.index[day0].date().isoformat(),
        "estimation_start": estimation.index[0].date().isoformat(),
        "estimation_end": estimation.index[-1].date().isoformat(),
        "window_start": window.index[0].date().isoformat(),
        "window_end": window.index[-1].date().isoformat(),
        "end_date": window.index[-1].date().isoformat(),
        "horizon": horizon,
    }


def event_study(ticker, event_date, horizon, offline=True):
    return study_prices(
        load_prices(ticker, offline), load_prices("SPY", offline), event_date, horizon
    )


def _metrics(rows):
    if not rows:
        return {
            "n": 0,
            "directional_hit_rate": None,
            "pearson": None,
            "spearman": None,
            "mae": None,
        }
    predicted = np.array([r["predicted"] for r in rows], float)
    actual = np.array([r["actual"] for r in rows], float)
    corr, rank = None, None
    if len(rows) >= 3 and np.std(predicted) > 1e-12 and np.std(actual) > 1e-12:
        corr = float(np.corrcoef(predicted, actual)[0, 1])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            rank = float(spearmanr(predicted, actual).statistic)
    return {
        "n": len(rows),
        "directional_hit_rate": float(np.mean(np.sign(predicted) == np.sign(actual))),
        "pearson": corr,
        "spearman": rank,
        "mae": float(np.mean(np.abs(predicted - actual))),
    }


def summarize(rows, bootstrap_n=1000):
    result = _metrics(rows)
    result["bootstrap_ci"] = {
        key: None for key in ["directional_hit_rate", "pearson", "spearman", "mae"]
    }
    if not rows:
        return result
    # Event-cluster resampling preserves dependence between predictions from one shock.
    groups = {}
    for row in rows:
        groups.setdefault(row["event_id"], []).append(row)
    identifiers = list(groups)
    rng = np.random.default_rng(2026)
    bootstrap = []
    for _ in range(bootstrap_n):
        sampled = rng.choice(identifiers, size=len(identifiers), replace=True)
        bootstrap.append(_metrics([row for event in sampled for row in groups[event]]))
    for key in result["bootstrap_ci"]:
        values = [
            sample[key]
            for sample in bootstrap
            if sample[key] is not None and np.isfinite(sample[key])
        ]
        if values:
            result["bootstrap_ci"][key] = [float(x) for x in np.quantile(values, [0.025, 0.975])]
    result["bootstrap_method"] = "1000 event-cluster percentile resamples; fixed seed 2026"
    result["event_count"] = len(groups)
    return result


GROUPS = {
    "overall": ("origin", "downstream", "upstream"),
    "direct": ("origin",),
    "propagated": ("downstream", "upstream"),
    "downstream": ("downstream",),
    "upstream": ("upstream",),
}
BOOTSTRAP_N = 10_000
BOOTSTRAP_SEED = 2026


def relation_of(row):
    """Older samples without a relation are direct (0 hops) or downstream."""
    return row.get("relation") or ("origin" if row.get("hops", 0) == 0 else "downstream")


def evaluate(rows, n_boot=BOOTSTRAP_N, seed=BOOTSTRAP_SEED):
    """Hit rate and MAE versus a predict-zero baseline, with event-cluster bootstrap CIs.

    Units: predicted and actual are percentage points of CAR. mae_diff is
    model MAE minus zero-forecast MAE, so negative means the model beat zero.
    The binomial p-value treats predictions as independent, which overstates
    evidence when one event produces several correlated predictions.
    """
    empty = {
        "n": 0,
        "events": 0,
        "hits": 0,
        "hit_rate": None,
        "hit_rate_ci95": None,
        "binomial_p_two_sided": None,
        "mae_model": None,
        "mae_zero": None,
        "mae_diff": None,
        "mae_diff_ci95": None,
    }
    if not rows:
        return empty
    predicted = np.array([r["predicted"] for r in rows], float)
    actual = np.array([r["actual"] for r in rows], float)
    hit = (np.sign(predicted) == np.sign(actual)) & (predicted != 0)
    err_model = np.abs(predicted - actual)
    err_zero = np.abs(actual)
    events = sorted({r["event_id"] for r in rows})
    index = {e: i for i, e in enumerate(events)}
    cluster = np.array([index[r["event_id"]] for r in rows])
    # Per-event sums make each resample a cheap indexed sum.
    per_n = np.bincount(cluster, minlength=len(events)).astype(float)
    per_hits = np.bincount(cluster, weights=hit.astype(float), minlength=len(events))
    per_diff = np.bincount(cluster, weights=err_model - err_zero, minlength=len(events))
    draws = np.random.default_rng(seed).integers(0, len(events), (n_boot, len(events)))
    boot_n = per_n[draws].sum(axis=1)
    boot_rate = per_hits[draws].sum(axis=1) / boot_n
    boot_diff = per_diff[draws].sum(axis=1) / boot_n
    n, hits = len(rows), int(hit.sum())
    return {
        "n": n,
        "events": len(events),
        "hits": hits,
        "hit_rate": hits / n,
        "hit_rate_ci95": [float(x) for x in np.quantile(boot_rate, [0.025, 0.975])],
        "binomial_p_two_sided": float(binomtest(hits, n, 0.5).pvalue),
        "mae_model": float(err_model.mean()),
        "mae_zero": float(err_zero.mean()),
        "mae_diff": float(err_model.mean() - err_zero.mean()),
        "mae_diff_ci95": [float(x) for x in np.quantile(boot_diff, [0.025, 0.975])],
    }


def evaluate_by_group(rows, **kwargs):
    groups = {
        name: evaluate([r for r in rows if relation_of(r) in relations], **kwargs)
        for name, relations in GROUPS.items()
    }
    for name, sign in (("positive", 1), ("negative", -1)):
        groups[name] = evaluate([r for r in rows if np.sign(r["predicted"]) == sign], **kwargs)
    return groups


def run_backtest(offline=True):
    from scsm.news import load_companies, load_events
    from scsm.propagate import propagate

    graph_path = DATA / "graph.json"
    graph = (
        json.loads(graph_path.read_text()) if graph_path.exists() else {"nodes": [], "edges": []}
    )
    sectors = {c["ticker"]: c["sector"] for c in load_companies()}
    samples, exclusions = [], []
    # Historical curated events only. GDELT candidates await review and maturation.
    events = [event for event in load_events() if event.get("source") == "curated_primary_source"]
    for event in events:
        historical_graph = {
            **graph,
            "edges": [
                edge
                for edge in graph.get("edges", [])
                if edge.get("filed_date") and edge["filed_date"] <= event["date"]
            ],
        }
        predictions = propagate(event, historical_graph)
        for prediction in predictions:
            ticker = prediction["ticker"]
            for horizon in (1, 5, 20):
                try:
                    study = event_study(ticker, event["date"], horizon, offline)
                    peers = []
                    for peer in PEERS.get(sectors.get(ticker), []):
                        if peer != ticker:
                            try:
                                peers.append(
                                    event_study(peer, event["date"], horizon, offline)["car_pct"]
                                )
                            except ValueError:
                                pass
                    samples.append(
                        {
                            "event_id": event["id"],
                            "event_date": event["date"],
                            "ticker": ticker,
                            "predicted": prediction["magnitude"],
                            "actual": study["car_pct"],
                            "horizon": horizon,
                            "path": prediction["path"],
                            "hops": prediction.get("hops", len(prediction["path"]) - 1),
                            "relation": prediction.get("relation", "origin"),
                            "sector_baseline": float(np.mean(peers)) if peers else None,
                            "sector_peer_n": len(peers),
                            **study,
                        }
                    )
                except (ValueError, OSError) as exc:
                    exclusions.append(
                        {
                            "event_id": event["id"],
                            "ticker": ticker,
                            "horizon": horizon,
                            "reason": str(exc),
                        }
                    )
    horizons, evaluation = {}, {}
    for horizon in (1, 5, 20):
        rows = [row for row in samples if row["horizon"] == horizon]
        metrics = summarize(rows)
        zero = [{**row, "predicted": 0.0} for row in rows]
        sector = [
            {**row, "predicted": row["sector_baseline"]}
            for row in rows
            if row["sector_baseline"] is not None
        ]
        metrics["baselines"] = {"zero": summarize(zero), "same_sector": summarize(sector)}
        metrics["propagated_n"] = sum(row["hops"] > 0 for row in rows)
        metrics["direct_n"] = sum(row["hops"] == 0 for row in rows)
        horizons[str(horizon)] = metrics
        evaluation[str(horizon)] = evaluate_by_group(rows)
    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "horizons": horizons,
        "evaluation": evaluation,
        "samples": samples,
        "exclusions": exclusions,
        "historical_events_n": len(events),
        "methodology": {
            "market": "SPY",
            "estimation_window": [-250, -11],
            "estimation_n": 240,
            "car_window": (
                "+1 through +h trading days after day 0, the last session on/before "
                "the disclosure date; day 0 itself excluded"
            ),
            "predictions": (
                "Uncalibrated heuristic percentage-point magnitudes; "
                "same magnitude at every horizon."
            ),
            "sector_baseline": (
                "Ex-post mean market-model CAR of fixed cached same-sector "
                "peers, excluding target. Control comparison, not a forecast."
            ),
            "sector_peer_panel": PEERS,
            "evaluation": (
                f"Per horizon and relation group: direction hit rate, MAE vs predict-zero MAE. "
                f"95% CIs from {BOOTSTRAP_N} event-cluster percentile bootstrap resamples "
                f"(seed {BOOTSTRAP_SEED}); two-sided exact binomial test of hit rate vs 50%, "
                "which assumes independent predictions."
            ),
        },
        "limitations": [
            "Small, hand-selected historical demonstration; selection and survivorship bias.",
            "Graph edges restricted to filed_date <= event date; graph remains a sparse subset.",
            "Date-only alignment ignores publication time and excludes event-day reaction.",
            "Adjusted Yahoo prices can be revised; historical replay is not a prospective record.",
            "Magnitudes, weights and severities are assumptions, not calibrated expected returns.",
            "Sector baseline uses realized peer returns and is not a tradable predictor.",
            "Bootstrap intervals are unstable with few events; no investment-performance claim.",
            "Issuer graph ignores product specificity: RTX A320neo issue also reaches Boeing.",
        ],
    }
    (DATA / "results.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    return result

"""Bounded shock scenarios over evidence-backed supplier -> customer edges.

5 percentage points at severity 1 is an explicit uncalibrated assumption.
Weights reflect model assumptions unless a filing reports exposure; confidence
is not an exposure estimate. Never use these scenarios as calibrated forecasts.
"""

import math
from collections import defaultdict, deque

from scsm.paths import DATA, read_json

BASE_SHOCK_PCT = 5.0
DECAY = 0.5
DEFAULT_WEIGHT = 0.5
MAX_HOPS = 3


def propagate(event, graph=None, *, decay=DECAY, max_hops=MAX_HOPS):
    """Return strongest simple path per ticker; no repeated/cyclic amplification.

    Competitor links must be explicitly supplied and labeled. The shipped SEC
    graph does not manufacture competitors by sector membership.
    """
    graph = graph if graph is not None else read_json(DATA / "graph.json", {"edges": []})
    severity = float(event.get("severity", 0.5))
    sign = float(event.get("sign", -1))
    if not math.isfinite(severity) or not 0 <= severity <= 1:
        raise ValueError("severity must be a finite fraction between 0 and 1")
    if sign not in (-1, 0, 1) or not 0 <= decay <= 1 or not 0 <= max_hops <= 10:
        raise ValueError("invalid sign, decay, or maximum hops")
    adjacency = defaultdict(list)
    event_date = event.get("date")
    for edge in graph.get("edges", []):
        # Do not use future filings in historical scenarios.
        if event_date and (not edge.get("filed_date") or edge["filed_date"] > event_date[:10]):
            continue
        weight = float(edge.get("weight", DEFAULT_WEIGHT))
        if not math.isfinite(weight) or not 0 <= weight <= 1:
            raise ValueError("edge weights must be finite fractions between 0 and 1")
        adjacency[edge["source"]].append((edge, weight))
    queue = deque(
        (ticker, sign * severity * BASE_SHOCK_PCT, [ticker], False, None)
        for ticker in sorted(set(event.get("tickers", [])))
    )
    best = {}
    while queue:
        ticker, magnitude, path, assumed, scenario = queue.popleft()
        candidate = {
            "ticker": ticker,
            "direction": "positive"
            if magnitude > 0
            else "negative"
            if magnitude < 0
            else "neutral",
            "magnitude": round(magnitude, 6),
            "path": path,
            "hops": len(path) - 1,
            "weight_assumption": assumed,
            "model": "uncalibrated 5% × severity × edge weights × 0.5 per hop",
        }
        if scenario:
            candidate["scenario"] = scenario
        if ticker not in best or abs(magnitude) > abs(best[ticker]["magnitude"]):
            best[ticker] = candidate
        if len(path) - 1 >= max_hops:
            continue
        for edge, weight in adjacency[ticker]:
            target = edge["target"]
            if target in path:
                continue
            competitor = edge.get("relation") == "competitor"
            # A substitution benefit is a terminal scenario, not a supply path.
            if scenario:
                continue
            next_magnitude = magnitude * decay * weight * (-1 if competitor else 1)
            queue.append(
                (
                    target,
                    next_magnitude,
                    path + [target],
                    assumed or "weight" not in edge or edge.get("weight_is_assumption", False),
                    "competitor substitution (heuristic)" if competitor else None,
                )
            )
    return sorted(best.values(), key=lambda p: (p["hops"], p["ticker"]))

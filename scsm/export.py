"""Deterministic static artifacts; never fetch data during export."""

from pathlib import Path

from scsm import __version__
from scsm.ledger import PREDICTIONS, read_records, verify
from scsm.paths import DATA, ROOT, read_json, write_json
from scsm.propagate import propagate
from scsm.score import SCORES


def export_data(output=None):
    from scsm.news import load_events

    output = Path(output) if output else ROOT / "web" / "data"
    status = verify()
    if not status["valid"]:
        raise ValueError(f"cannot export invalid prediction chain: {status['error']}")
    graph = read_json(
        DATA / "graph.json", {"nodes": [], "edges": [], "metadata": {"status": "unavailable"}}
    )
    events = [{**event, "predictions": propagate(event, graph)} for event in load_events()]
    predictions = read_records(PREDICTIONS)
    scores = read_records(SCORES)
    results = read_json(DATA / "results.json", {"horizons": {}, "samples": []})
    # No wall-clock field: identical inputs must yield byte-identical static data.
    meta = {
        "version": __version__,
        "ledger": status,
        "counts": {
            "nodes": len(graph["nodes"]),
            "edges": len(graph["edges"]),
            "events": len(events),
            "predictions": len(predictions),
            "scores": len(scores),
        },
        "coverage": graph.get("metadata", {}),
        "limitations": [
            "Uncalibrated heuristic return magnitudes; not financial advice.",
            "Curated historical backtests are not prospective performance.",
            "Hash integrity requires a trusted saved head; timestamps are self-reported.",
            "Current S&P 500 membership introduces survivorship bias.",
        ],
    }
    artifacts = {
        "graph": graph,
        "events": events,
        "predictions": predictions,
        "scores": scores,
        "results": results,
        "meta": meta,
    }
    for name, value in artifacts.items():
        write_json(output / f"{name}.json", value)
    return meta

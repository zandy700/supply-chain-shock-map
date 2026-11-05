"""Command line entry point. Offline caches are the default outside ingestion."""

import argparse
import json
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m scsm")
    commands = parser.add_subparsers(dest="command", required=True)
    ingest = commands.add_parser("ingest", help="Fetch GDELT events, or inspect offline cache")
    ingest.add_argument("--offline", action="store_true")
    prop = commands.add_parser("propagate", help="Propagate a cached event")
    prop.add_argument("--event", help="Cached event ID (defaults to first)")
    backtest = commands.add_parser("backtest", help="Run the historical event study")
    backtest.add_argument("--online", action="store_true", help="Fetch missing adjusted prices")
    ledger = commands.add_parser("ledger", help="Append predictions or verify the hash chain")
    ledger.add_argument("action", choices=["append", "verify"])
    ledger.add_argument("--event", help="Only append this event ID")
    score = commands.add_parser("score", help="Append outcomes for matured prospective predictions")
    score.add_argument("--online", action="store_true")
    export = commands.add_parser("export", help="Build static web/data from cached artifacts")
    export.add_argument("--output", help="Alternative output directory")
    args = parser.parse_args(argv)
    try:
        result = run(args)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
        if args.command == "ledger" and args.action == "verify" and not result["valid"]:
            return 1
        return 0
    except (ValueError, FileNotFoundError, RuntimeError) as exc:
        print(f"scsm: {exc}", file=sys.stderr)
        return 1


def run(args):
    if args.command == "ingest":
        from scsm.news import ingest

        return ingest(offline=args.offline)
    if args.command == "backtest":
        from scsm.backtest import run_backtest

        return run_backtest(offline=not args.online)
    if args.command == "export":
        from scsm.export import export_data

        return export_data(args.output)
    if args.command == "score":
        from scsm.score import score_ledger

        return score_ledger(offline=not args.online)
    if args.command == "ledger" and args.action == "verify":
        from scsm.ledger import verify

        return verify()
    from scsm.news import load_events
    from scsm.propagate import propagate

    events = load_events()
    if args.event:
        events = [event for event in events if event["id"] == args.event]
        if not events:
            raise ValueError(f"cached event not found: {args.event}")
    if args.command == "propagate":
        if not events:
            raise ValueError("no cached events; run ingest first")
        return {"event": events[0], "predictions": propagate(events[0])}
    from scsm.ledger import append_prediction

    appended = []
    for event in events:
        predictions = propagate(event)
        if predictions:
            record = append_prediction(event, predictions)
            if record:
                appended.append(record)
    return {"added": len(appended), "entries": appended}


if __name__ == "__main__":
    raise SystemExit(main())

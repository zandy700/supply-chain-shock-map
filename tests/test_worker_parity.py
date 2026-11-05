"""Ensure the Worker port cannot silently drift from the Python taxonomy."""

import json
from pathlib import Path

from scsm.news import POSITIVE_RULES, RULES


def test_worker_rules_match_python():
    rules = json.loads(Path('worker/rules.json').read_text())
    assert rules['RULES'] == [list(rule) for rule in RULES]
    assert rules['POSITIVE_RULES'] == [list(rule) for rule in POSITIVE_RULES]


def test_browser_graph_is_existing_graph():
    assert json.loads(Path('web/seed/graph.json').read_text()) == json.loads(
        Path('data/graph.json').read_text()
    )

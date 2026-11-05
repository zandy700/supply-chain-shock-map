"""Repository paths and deterministic JSON IO."""

import json
import os
from pathlib import Path

ROOT = Path(os.environ.get("SCSM_ROOT", Path(__file__).resolve().parents[1]))
DATA = ROOT / "data"


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else default


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n")

"""SQLite database layer for ownership and supply chain edges."""

import sqlite3
from pathlib import Path

# Store DB alongside the project root
_DB_PATH = Path(__file__).parent.parent / "data" / "relations.db"


def get_db() -> sqlite3.Connection:
    """Open (or reuse) a SQLite connection with row_factory for dict-like access."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create tables if they don't exist yet. Called at API startup."""
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ownership (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT    NOT NULL,
            target        TEXT    NOT NULL,
            target_ticker TEXT,
            direction     TEXT    DEFAULT 'invests_in',
            note          TEXT,
            source_filing TEXT,
            value_usd     INTEGER,
            shares        INTEGER,
            rank          INTEGER,
            UNIQUE(source, target)
        );

        CREATE TABLE IF NOT EXISTS supply_chain (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            source        TEXT    NOT NULL,
            target        TEXT    NOT NULL,
            target_ticker TEXT,
            direction     TEXT    DEFAULT 'supplier',
            note          TEXT,
            evidence      TEXT,
            sentiment     TEXT,
            confidence    REAL,
            rank          INTEGER,
            UNIQUE(source, target)
        );

        CREATE INDEX IF NOT EXISTS idx_ownership_source  ON ownership(source);
        CREATE INDEX IF NOT EXISTS idx_ownership_rank    ON ownership(source, rank);
        CREATE INDEX IF NOT EXISTS idx_sc_source         ON supply_chain(source);
        CREATE INDEX IF NOT EXISTS idx_sc_target_ticker  ON supply_chain(target_ticker);
        CREATE INDEX IF NOT EXISTS idx_sc_rank           ON supply_chain(source, rank);
    """)
    conn.commit()
    conn.close()
    print("[db] SQLite tables ready.")

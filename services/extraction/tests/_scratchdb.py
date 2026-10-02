"""Throwaway Postgres databases and synthetic bundles for the loader tests.

The DB tests need a local Postgres the current user can CREATE DATABASE on, and
`psql` on PATH. They are skipped unless AINEXT_TEST_PG names the server:

    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run python -m unittest discover -s tests -v

Each test class creates ONE uniquely named database (ainext_test_<pid>_<n>),
applies db/schema.sql and every migration the way scripts/local-dev.sh does, and
drops exactly that database afterwards. Nothing else on the server is touched.
"""

from __future__ import annotations

import contextlib
import io
import itertools
import json
import os
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
REPO = EX.parents[1]
if str(EX) not in sys.path:
    sys.path.insert(0, str(EX))

SERVER = os.environ.get("AINEXT_TEST_PG")
_counter = itertools.count()


def skip_without_db():
    return unittest.skipUnless(SERVER and shutil.which("psql"),
                               "set AINEXT_TEST_PG (and have psql) to run the database tests")


class ScratchDB:
    def __init__(self, label: str = "t") -> None:
        self.name = f"ainext_test_{label}_{os.getpid()}_{next(_counter)}"
        self.dsn = f"{SERVER} dbname={self.name}"

    def _psql(self, db: str, *args: str) -> None:
        conn = f"{SERVER} dbname={db}"
        subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", conn, *args],
                       check=True, capture_output=True, text=True)

    def create(self) -> "ScratchDB":
        self._psql("postgres", "-c", f'CREATE DATABASE "{self.name}"')
        self._psql(self.name, "-f", str(REPO / "db" / "schema.sql"))
        for m in sorted((REPO / "db" / "migrations").glob("*.sql")):
            self._psql(self.name, "-f", str(m))
        return self

    def drop(self) -> None:
        # Only this exact database, which this object created.
        assert self.name.startswith("ainext_test_")
        self._psql("postgres", "-c", f'DROP DATABASE IF EXISTS "{self.name}" WITH (FORCE)')

    def connect(self):
        import psycopg
        return psycopg.connect(self.dsn, autocommit=True)

    def q(self, sql: str, params: tuple = ()) -> list[tuple]:
        with self.connect() as c:
            cur = c.execute(sql, params or None)
            return cur.fetchall() if cur.description else []

    def one(self, sql: str, params: tuple = ()):
        rows = self.q(sql, params)
        return rows[0][0] if rows else None


def run_loader(dsn: str, *argv: str) -> str:
    """load_seed.main in-process against `dsn`; returns stdout. SystemExit propagates."""
    import load_seed
    old = os.environ.get("AINEXT_DB_DSN")
    os.environ["AINEXT_DB_DSN"] = dsn
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            load_seed.main(list(argv))
    finally:
        if old is None:
            os.environ.pop("AINEXT_DB_DSN", None)
        else:
            os.environ["AINEXT_DB_DSN"] = old
    return out.getvalue()


def mini_course(prefix: str = "zz", course: str | None = None) -> dict:
    """A tiny valid SeedBundle: 1 module, 3 objectives in 2 lessons, 4 questions, 1 visual."""
    course = course or f"course:{prefix}-test-en"
    lo = lambda l, n: f"lo:{prefix}1-{l}-{n}"   # noqa: E731
    return {
        "source_document": {"title": f"Test book {prefix}", "publisher": "tests", "language": "en",
                            "grade": "10", "subject": "mathematics",
                            "file_path": f"docs/Source/{prefix}-test.pdf"},
        "extraction_run": {"extractor": "tests", "extractor_version": "1", "schema_version": "1"},
        "syllabus_version": "test",
        "nodes": [
            {"id": course, "kind": "course", "label": f"Test course {prefix}"},
            {"id": f"module:{prefix}-m1", "kind": "module", "label": "Module 1", "order_in_parent": 1},
            {"id": lo(1, 1), "kind": "learning_objective", "label": "Add", "source_page": 1},
            {"id": lo(1, 2), "kind": "learning_objective", "label": "Subtract", "source_page": 2},
            {"id": lo(2, 1), "kind": "learning_objective", "label": "Multiply", "source_page": 3},
        ],
        "edges": [
            {"src": f"module:{prefix}-m1", "dst": course, "type": "part_of"},
            {"src": f"module:{prefix}-m1", "dst": lo(1, 1), "type": "teaches"},
            {"src": f"module:{prefix}-m1", "dst": lo(1, 2), "type": "teaches"},
            {"src": f"module:{prefix}-m1", "dst": lo(2, 1), "type": "teaches"},
            {"src": lo(1, 1), "dst": lo(1, 2), "type": "prerequisite_of"},
        ],
        "questions": [
            {"id": f"q:{prefix}1-1-1:001", "lo": lo(1, 1), "tier": "basic", "type": "mcq",
             "stem": "2 + 3 = ?", "choices": [{"key": "A", "text": "5"}, {"key": "B", "text": "6"},
                                               {"key": "C", "text": "23"}],
             "answer": "A", "solution": ["2 + 3 = 5"], "source_page": 1, "source_note": "t",
             "verified": True},
            {"id": f"q:{prefix}1-1-1:002", "lo": lo(1, 1), "tier": "standard", "type": "numeric",
             "stem": "4 + 4 = ?", "answer": "8", "solution": ["4 + 4 = 8"], "source_page": 1,
             "source_note": "t", "verified": True},
            {"id": f"q:{prefix}1-1-2:001", "lo": lo(1, 2), "tier": "basic", "type": "numeric",
             "stem": "5 - 3 = ?", "answer": "2", "solution": ["5 - 3 = 2"], "source_page": 2,
             "source_note": "t", "verified": False},
            {"id": f"q:{prefix}1-2-1:001", "lo": lo(2, 1), "tier": "basic", "type": "numeric",
             "stem": "2 x 3 = ?", "answer": "6", "solution": ["2 x 3 = 6"], "source_page": 3,
             "source_note": "t", "verified": True},
        ],
        "visuals": [
            {"id": f"v:{prefix}1-1:001", "lo": lo(1, 1), "kind": "number_line",
             "spec": {"min": 0, "max": 10}, "caption": "a line", "source_page": 1},
        ],
    }


def write_bundle(tmp: Path, name: str, bundle: dict) -> Path:
    p = tmp / f"{name}.json"
    p.write_text(json.dumps(bundle, ensure_ascii=False, indent=1))
    return p

"""The maths misconception catalogue has one source, and moving to it lost nothing (B19, decision 22).

@covers FR-4409

    uv run --with pytest python -m pytest -q tests/test_misconception_catalogue.py
    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run --with pytest python -m pytest -q tests/test_misconception_catalogue.py

`seed/generated/misconceptions.json` is live Prep-3 content: the deploy loads it on every run
(ci-cd.yml, "Misconception catalogue (every deploy — idempotent)"). So these tests compare it with
the catalogue v0.9.2 released (tests/fixtures/misconceptions/catalogue-v0.9.2.json) and with the
generator decision 22 retired, rather than with itself:

  * no live id is lost or renamed, and every one is served exactly as before;
  * the six `t2u3-1-2` entries only the generator held are in, with refutations and their maps;
  * no alias and no kind the generator held was lost, and no alias moved or names a live id;
  * every distractor stamp resolves: each map names a real option (never the key), and every
    misconception a generated or widget question names exists on its own objective;
  * the generator and the duplicate file are gone as sources.

The database class replays the deploy on a private scratch Postgres (skipped without
AINEXT_TEST_PG): the v0.9.2 catalogue and the generated bank loaded the way first boot loads them,
students' attempts citing misconceptions, then the new catalogue through load_misconceptions.py
exactly as ci-cd.yml calls it — twice.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from _scratchdb import EX, REPO, ScratchDB, run_loader, skip_without_db

import assemble_misconceptions as am
import book_config

CATALOGUE = EX / "seed" / "generated" / "misconceptions.json"
BASELINE = EX / "tests" / "fixtures" / "misconceptions" / "catalogue-v0.9.2.json"
GENERATED = [EX / "seed" / "generated" / f for f in ("generated-questions.json", "widget-questions.json")]

NEW_T2U312 = {
    "mc:t2u3-1-2:assumed-mutually-exclusive": [("q:t2u3-1-2:003", "$0$"), ("q:t2u3-1-2:006", "$0$")],
    "mc:t2u3-1-2:exclusive-confused-with-exhaustive": [("q:t2u3-1-2:002", "$A \\cup B = S$")],
    "mc:t2u3-1-2:gave-single-event-probability": [("q:t2u3-1-2:005", "$\\frac{1}{2}$")],
    "mc:t2u3-1-2:intersection-as-a-only": [("q:t2u3-1-2:001", "the occurrence of A only")],
    "mc:t2u3-1-2:intersection-read-as-union": [("q:t2u3-1-2:001", "the occurrence of at least one of the two events")],
    "mc:t2u3-1-2:union-counted-by-adding": [("q:t2u3-1-2:006", "$\\frac{7}{12}$")],
}
# Live ids that predate the mc:<objective>:<slug> rule. A live id is never renamed, so they stay;
# this set may only ever shrink.
LEGACY_IDS = frozenset({"mc:divides-reversed"})


# Deliberate corrections to text the retired generator held: (field, as corrected, as generated).
# 2026-09-25: the signal wrote the intersection as the letter "n".
GENERATOR_CORRECTIONS = {
    "mc:t2u3-1-2:gave-single-event-probability": [("signal", "P(A ∩ B)", "P(A n B)")],
}


def digest(m: dict) -> str:
    core = {k: m.get(k) for k in ("lo_id", "label", "description", "signal", "refutation")}
    return hashlib.sha256(json.dumps(core, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def load() -> dict:
    return json.loads(CATALOGUE.read_text())


def baseline() -> dict:
    return json.loads(BASELINE.read_text())


def prerequisites() -> dict[str, set[str]]:
    return am.prerequisites(book_config.load_book("prep3-math-en").bundle_paths())


def book_questions() -> dict[str, dict]:
    """Every question the maths course and its generated bank carry, by id."""
    qs: dict[str, dict] = {}
    for p in book_config.load_book("prep3-math-en").bundle_paths():
        for q in json.loads(p.read_text()).get("questions") or []:
            qs[q["id"]] = {"lo_id": q["lo"], "choices": q.get("choices") or [], "key": q.get("answer")}
    for p in GENERATED:
        for q in json.loads(p.read_text())["questions"]:
            qs[q["id"]] = {"lo_id": q["lo_id"], "choices": q.get("choices"), "key": q.get("correct_answer")}
    return qs


class SingleSourceTest(unittest.TestCase):
    """What the file must hold (no database needed)."""

    @classmethod
    def setUpClass(cls):
        cls.cat = load()
        cls.by_id = {m["id"]: m for m in cls.cat["misconceptions"]}
        cls.base = baseline()
        cls.base_by_id = {m["id"]: m for m in cls.base["entries"]}
        cls.gen_by_id = {m["id"]: m for m in cls.base["retired_generator"]["entries"]}

    def test_book_config_names_this_file(self):
        gen = book_config.load_book("prep3-math-en").generated
        self.assertEqual(REPO / gen.misconceptions, CATALOGUE)

    def test_no_live_id_lost_or_renamed(self):
        missing = set(self.base_by_id) - set(self.by_id)
        self.assertEqual(missing, set(), "live ids from v0.9.2 are gone (FR-4409: never rename a live id)")

    def test_every_live_entry_served_unchanged(self):
        for mid, b in self.base_by_id.items():
            m = self.by_id[mid]
            with self.subTest(mid):
                self.assertEqual(m["lo_id"], b["lo_id"])
                self.assertEqual(digest(m), b["digest"], "label, description, signal or refutation changed")
                self.assertEqual(m["maps"], b["maps"], "a live distractor stamp changed")

    def test_the_six_t2u3_1_2_entries_are_in(self):
        added = set(self.by_id) - set(self.base_by_id)
        self.assertEqual(added, set(NEW_T2U312))
        for mid, maps in NEW_T2U312.items():
            m = self.by_id[mid]
            with self.subTest(mid):
                self.assertEqual(m["lo_id"], "lo:t2u3-1-2")
                self.assertTrue(am.id_is_well_formed(mid, m["lo_id"]))
                self.assertEqual(m["kind"], "book_distractor")
                self.assertGreaterEqual(len(m["refutation"]), 3)
                self.assertTrue(all(s["text_md"].strip() for s in m["refutation"]))
                self.assertEqual([(x["question_id"], x["choice_text"]) for x in m["maps"]], maps)
                # exactly what the retired generator held, word for word, apart from the
                # documented corrections below (undone here before comparing)
                held = json.loads(json.dumps(m))
                for field, fixed, original in GENERATOR_CORRECTIONS.get(mid, []):
                    held[field] = held[field].replace(fixed, original)
                self.assertEqual(digest(held), self.gen_by_id[mid]["digest"])
        self.assertEqual(sum(len(v) for v in NEW_T2U312.values()), 7)

    def test_no_alias_or_kind_lost_at_retirement(self):
        """`kind` and `aliases` the export dropped are kept; nothing the generator held is lost."""
        for mid, b in self.base_by_id.items():
            with self.subTest(mid):
                self.assertTrue(set(b["aliases"]) <= set(self.by_id[mid]["aliases"]), "a released alias was lost")
        for mid, g in self.gen_by_id.items():
            with self.subTest(mid):
                self.assertTrue(set(g["aliases"]) <= set(self.by_id[mid]["aliases"]), "a generator alias was lost")
                self.assertEqual(self.by_id[mid]["kind"], g["kind"])
        owner: dict[str, str] = {}
        for m in self.cat["misconceptions"]:
            for a in m["aliases"]:
                self.assertNotIn(a, self.by_id, f"alias {a} is a live id: folding it would delete an entry")
                self.assertNotIn(a, owner, f"alias {a} on both {owner.get(a)} and {m['id']}")
                owner[a] = m["id"]

    def test_ids_are_well_formed_or_grandfathered(self):
        odd = {m["id"] for m in self.cat["misconceptions"] if not am.id_is_well_formed(m["id"], m["lo_id"])}
        self.assertTrue(odd <= LEGACY_IDS, f"new ids must be mc:<objective>:<slug>: {sorted(odd - LEGACY_IDS)}")
        self.assertTrue(LEGACY_IDS <= set(self.base_by_id), "a grandfathered id must be a released one")

    def test_catalogue_rules(self):
        problems = am.validate_catalogue(self.cat, new_ids=set(), book=book_config.load_book("prep3-math-en"))
        self.assertEqual(problems, [])
        self.assertEqual(self.cat["course_id"], "course:prep3-math-en")
        # The attribution the loader writes to generated_by is unchanged, so a deploy rewrites no
        # live row's provenance.
        self.assertEqual(self.cat["generator"], self.base["generator"])

    def test_every_distractor_stamp_resolves(self):
        qs = book_questions()
        for m in self.cat["misconceptions"]:
            for mp in m["maps"]:
                with self.subTest(m["id"], q=mp["question_id"]):
                    q = qs.get(mp["question_id"])
                    self.assertIsNotNone(q, "the map names no question")
                    hit = [c for c in q["choices"] if c.get("text") == mp["choice_text"]]
                    self.assertEqual(len(hit), 1, "the map matches no option, or more than one")
                    self.assertNotEqual(hit[0].get("key"), q["key"], "a map stamps the CORRECT answer")
        pre = prerequisites()
        for p in GENERATED:
            for q in json.loads(p.read_text())["questions"]:
                ch = q.get("choices")
                widget = isinstance(ch, dict)
                tags = [d.get("misconception_id") for d in ch.get("diagnostics") or []] if widget else \
                       [c.get("misconception_id") for c in ch or []]
                for mid in filter(None, tags):
                    with self.subTest(q["id"], mid=mid):
                        self.assertIn(mid, self.by_id, "names a misconception the catalogue lacks (FR-1112)")
                        self.assertTrue(len(self.by_id[mid]["refutation"]) >= 2, "nothing to serve (FR-1112)")
                        owner = self.by_id[mid]["lo_id"]
                        if widget:   # its own objective or a transitive prerequisite (FR-1215)
                            self.assertIn(owner, {q["lo_id"]} | pre.get(q["lo_id"], set()))
                        else:        # its own objective (FR-1106)
                            self.assertEqual(owner, q["lo_id"])

    def test_the_second_sources_are_gone(self):
        self.assertFalse((EX / "seed" / "misconceptions-math.json").exists())
        src = (EX / "build_misconceptions.py").read_text()
        self.assertNotRegex(src, r"(?m)^mc\(", "the retired generator still holds entries")
        r = subprocess.run([sys.executable, str(EX / "build_misconceptions.py"), "--out", os.devnull],
                           capture_output=True, text=True, cwd=EX)
        self.assertEqual(r.returncode, 2)
        self.assertIn("RETIRED", r.stderr)

    def test_the_retired_refutation_line_refuses(self):
        r = subprocess.run([sys.executable, str(EX / "assemble_refutations.py"), os.devnull],
                           capture_output=True, text=True, cwd=EX)
        self.assertEqual(r.returncode, 2)
        self.assertIn("RETIRED", r.stderr)


def snapshot(db: ScratchDB) -> dict:
    return {
        "misconceptions": {r[0]: r for r in db.q(
            "SELECT id, lo_id, label, description, signal, generated_by, created_at FROM misconceptions")},
        "explanations": {r[0]: r for r in db.q(
            "SELECT id, lo_id, misconception_id, entry_type, content::text, generated_by, reviewed, "
            "reviewed_by, reviewed_at, created_at FROM explanation_library")},
        "choices": {r[0]: r[1] for r in db.q("SELECT id, choices FROM questions WHERE choices IS NOT NULL")},
        "questions": db.q("SELECT id, status, reviewed_by, stem, correct_answer FROM questions ORDER BY id"),
        "attempts": db.q("SELECT id, student_id, question_id, given_answer, is_correct, misconception_id, "
                         "attempted_at FROM attempts ORDER BY id"),
    }


def load_catalogue(dsn: str, path: Path) -> subprocess.CompletedProcess:
    """load_misconceptions.py as ci-cd.yml's every-deploy step runs it."""
    env = {**os.environ, "AINEXT_ENVIRONMENT": "mvp1", "AINEXT_DB_DSN": dsn}
    r = subprocess.run([sys.executable, "load_misconceptions.py", str(path)],
                       capture_output=True, text=True, cwd=EX, env=env)
    if r.returncode != 0:
        raise AssertionError(f"load_misconceptions.py failed ({r.returncode}):\n{r.stdout}\n{r.stderr}")
    return r


def restore_generated(dsn: str) -> None:
    """The first-boot step: the generated and widget banks, --restore --sample 0."""
    env = {**os.environ, "AINEXT_ENVIRONMENT": "mvp1", "AINEXT_DB_DSN": dsn}
    for p in GENERATED:
        r = subprocess.run([sys.executable, "load_generated_questions.py", str(p), "--restore", "--sample", "0"],
                           capture_output=True, text=True, cwd=EX, env=env)
        if r.returncode != 0:
            raise AssertionError(f"{p.name} failed:\n{r.stdout}\n{r.stderr}")


def v092_catalogue() -> dict:
    """The released catalogue, rebuilt from today's file and proven equal to v0.9.2 by digest."""
    cur, base = load(), baseline()
    by_id = {m["id"]: m for m in cur["misconceptions"]}
    entries = []
    for b in base["entries"]:
        m = dict(by_id[b["id"]], kind=b["kind"], aliases=list(b["aliases"]), maps=b["maps"])
        assert digest(m) == b["digest"], b["id"]
        entries.append(m)
    return {"generator": base["generator"], "misconceptions": entries}


@skip_without_db()
class DeployReplayTest(unittest.TestCase):
    """The catalogue change, replayed through the deploy path on a private scratch database."""

    @classmethod
    def setUpClass(cls):
        cls.db = ScratchDB("mcat").create()
        cls.tmp = Path(tempfile.mkdtemp(prefix="mcat_"))
        old = cls.tmp / "misconceptions-v0.9.2.json"
        old.write_text(json.dumps(v092_catalogue(), indent=2, ensure_ascii=False))
        # First boot, as ci-cd.yml runs it: the maths course, the catalogue, the generated bank.
        run_loader(cls.db.dsn, "--all", "--course", "course:prep3-math-en")
        load_catalogue(cls.db.dsn, old)
        restore_generated(cls.db.dsn)
        # The next deploy's every-deploy step, still on v0.9.2: stamps what first boot could not.
        cls.old_second = load_catalogue(cls.db.dsn, old)
        # Students with history that cites misconceptions: a book distractor, a generated one, a
        # widget diagnosis, and the two loaded-only entries no question names any more.
        cls.db.q("INSERT INTO students (display_name, grade) VALUES ('Scratch Student', 'prep-3')")
        cls.sid = cls.db.one("SELECT id FROM students")
        cited = [
            "mc:u1-1-1:multiplied-not-added",            # a book distractor
            "mc:t2u1-2-1:roots-read-from-coefficients",  # a generated distractor (89d7a3a)
            "mc:geo1-1-1:radius-not-from-centre",        # a widget diagnosis
            "mc:geo1-2-1:point-position-reversed",       # its kind and alias come back from the generator
            "mc:divides-reversed",                       # the two loaded-only entries no question
            "mc:geo1-1-2:chord-endpoints-off-circle",    # names any more
        ]
        for mid in cited:
            lo = cls.db.one("SELECT lo_id FROM misconceptions WHERE id = %s", (mid,))
            qid = cls.db.one("SELECT id FROM questions WHERE lo_id = %s ORDER BY id LIMIT 1", (lo,))
            cls.db.q("INSERT INTO attempts (student_id, question_id, given_answer, is_correct, misconception_id) "
                     "VALUES (%s, %s, 'x', false, %s)", (cls.sid, qid, mid))
        cls.before = snapshot(cls.db)
        cls.first = load_catalogue(cls.db.dsn, CATALOGUE)
        cls.after = snapshot(cls.db)
        cls.second = load_catalogue(cls.db.dsn, CATALOGUE)
        cls.again = snapshot(cls.db)

    @classmethod
    def tearDownClass(cls):
        cls.db.drop()

    def test_the_rehearsal_matched_everything_on_v092(self):
        self.assertNotIn("matched nothing", self.old_second.stderr)
        self.assertEqual(len(self.before["misconceptions"]), 97)

    def test_nothing_lost(self):
        b, a = self.before, self.after
        for mid, row in b["misconceptions"].items():
            self.assertEqual(a["misconceptions"].get(mid), row, f"{mid} changed or vanished")
        for eid, row in b["explanations"].items():
            self.assertEqual(a["explanations"].get(eid), row, f"{eid} changed or vanished")
        self.assertEqual(a["attempts"], b["attempts"], "a student's attempt changed")
        self.assertEqual(a["questions"], b["questions"], "a question's status, stem or key changed")
        self.assertEqual(self.db.one(
            "SELECT count(*) FROM attempts t LEFT JOIN misconceptions m ON m.id = t.misconception_id "
            "WHERE t.misconception_id IS NOT NULL AND m.id IS NULL"), 0)
        self.assertEqual(self.db.one("SELECT count(*) FROM attempts WHERE misconception_id IS NOT NULL"), 6)

    def test_the_six_are_live_with_refutations(self):
        added = set(self.after["misconceptions"]) - set(self.before["misconceptions"])
        self.assertEqual(added, set(NEW_T2U312))
        for mid in NEW_T2U312:
            row = self.after["explanations"].get(f"expl:{mid}")
            self.assertIsNotNone(row, f"{mid} has no refutation")
            self.assertEqual(row[3], "refutation")
            self.assertFalse(row[6], "a generated refutation must load reviewed=false")
            self.assertGreaterEqual(len(json.loads(row[4])), 3)
        self.assertEqual(len(self.after["misconceptions"]), 103)

    def test_only_the_seven_mappings_changed_any_question(self):
        b, a = self.before["choices"], self.after["choices"]
        changed = sorted(q for q in a if a[q] != b.get(q))
        self.assertEqual(changed, ["q:t2u3-1-2:001", "q:t2u3-1-2:002", "q:t2u3-1-2:003",
                                   "q:t2u3-1-2:005", "q:t2u3-1-2:006"])
        stamped = []
        for q in changed:
            for old, new in zip(b[q], a[q]):
                self.assertEqual({k: v for k, v in new.items() if k != "misconception_id"}, old)
                if new != old:
                    stamped.append((q, new["text"], new["misconception_id"]))
        want = sorted((q, t, mid) for mid, maps in NEW_T2U312.items() for q, t in maps)
        self.assertEqual(sorted(stamped), want)
        # The loader re-stamps every map on every run: exactly seven more options than v0.9.2's.
        count = lambda r: int(re.search(r"stamped (\d+) book distractor", r.stdout).group(1))  # noqa: E731
        self.assertEqual(count(self.first), count(self.old_second) + 7)

    def test_no_alias_folded_and_nothing_unmatched(self):
        # The aliases restored from the generator name ids no database built from the repo holds,
        # so the fold is a no-op here, as on production (which first-booted from the same files).
        self.assertIn("generator aliases found in the database: 0", self.first.stdout)
        self.assertNotIn("matched nothing", self.first.stderr)

    def test_a_rerun_is_a_no_op(self):
        self.assertEqual(self.again, self.after)
        self.assertEqual(self.second.stdout, self.first.stdout)

    def test_a_new_entry_diagnoses_and_serves(self):
        """A student choosing the 0 on q:t2u3-1-2:003 now gets the refutation of that error (FR-1113)."""
        choice = next(c for c in self.after["choices"]["q:t2u3-1-2:003"] if c["text"] == "$0$")
        self.assertEqual(choice["misconception_id"], "mc:t2u3-1-2:assumed-mutually-exclusive")
        steps = self.db.one("SELECT content FROM explanation_library WHERE misconception_id = %s "
                            "AND entry_type = 'refutation'", (choice["misconception_id"],))
        self.assertTrue(re.search(r"\\frac\{1\}\{10\}", steps[2]["text_md"]))


if __name__ == "__main__":
    unittest.main()

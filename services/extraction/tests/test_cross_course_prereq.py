"""load_seed.py refuses a prerequisite edge that joins two courses (2026-09-26 isolation audit).

    uv run python -m unittest tests.test_cross_course_prereq -v
    AINEXT_TEST_PG="host=127.0.0.1 port=5432" uv run python -m unittest tests.test_cross_course_prereq -v

A prerequisite is one book's teaching order; an edge from one course's objective
into another's is a path a graph reader could walk from a course a student may
see into one she may not. The app gates each reader by the student's scope
itself — this is the loader's defence in depth, and it fails closed: the edge is
refused unless `ALLOWED_CROSS_COURSE_PREREQUISITES` names it.

The pure tests always run; the database test is skipped without AINEXT_TEST_PG.
"""

# @covers FR-4006

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from _scratchdb import ScratchDB, mini_course, run_loader, skip_without_db, write_bundle

import load_seed

ZZ = "course:zz-test-en"
ZY = "course:zy-test-en"


def triples(bundle: dict) -> set[tuple[str, str, str]]:
    return {(e["src"], e["dst"], e["type"]) for e in bundle["edges"]}


class CourseOfObjectivesTest(unittest.TestCase):
    def test_walks_teaches_then_part_of_through_any_depth(self):
        edges = [
            ("module:x-c01", "course:x", "part_of"),
            ("module:x-s01", "module:x-c01", "part_of"),
            ("module:x-s01", "lo:x1-1-1", "teaches"),
            ("course:x", "program:p", "part_of"),
        ]
        self.assertEqual(load_seed.course_of_objectives(edges), {"lo:x1-1-1": "course:x"})

    def test_known_courses_fill_what_the_batch_cannot_resolve(self):
        edges = [("module:zy-m1", ZY, "part_of"), ("module:zy-m1", "lo:zy1-1-1", "teaches")]
        got = load_seed.course_of_objectives(edges, {"lo:zz1-1-1": ZZ})
        self.assertEqual(got, {"lo:zz1-1-1": ZZ, "lo:zy1-1-1": ZY})


class CrossCoursePrerequisiteTest(unittest.TestCase):
    def test_a_course_of_its_own_passes(self):
        self.assertEqual(load_seed.cross_course_prerequisites(triples(mini_course("zz"))), [])

    def test_an_edge_between_two_courses_is_reported(self):
        edges = triples(mini_course("zz")) | triples(mini_course("zy"))
        edges.add(("lo:zz1-1-1", "lo:zy1-2-1", "prerequisite_of"))
        bad = load_seed.cross_course_prerequisites(edges)
        self.assertEqual(bad, [f"lo:zz1-1-1 ({ZZ}) -> lo:zy1-2-1 ({ZY})"])
        with self.assertRaises(SystemExit) as cm:
            load_seed.refuse_cross_course_prerequisites(edges)
        self.assertIn("ALLOWED_CROSS_COURSE_PREREQUISITES", str(cm.exception))

    def test_an_end_known_only_from_the_database_still_counts(self):
        # a scoped load of zy whose edge points back into zz, already loaded
        edges = triples(mini_course("zy")) | {("lo:zz1-1-1", "lo:zy1-1-1", "prerequisite_of")}
        self.assertEqual(load_seed.cross_course_prerequisites(edges), [], "unresolvable: not provable")
        self.assertEqual(len(load_seed.cross_course_prerequisites(edges, {"lo:zz1-1-1": ZZ})), 1)

    def test_only_an_explicit_allowance_lets_one_through(self):
        edges = triples(mini_course("zz")) | triples(mini_course("zy"))
        edges.add(("lo:zz1-1-1", "lo:zy1-2-1", "prerequisite_of"))
        allowed = frozenset({("lo:zz1-1-1", "lo:zy1-2-1")})
        self.assertEqual(load_seed.cross_course_prerequisites(edges, allowed=allowed), [])
        self.assertEqual(load_seed.ALLOWED_CROSS_COURSE_PREREQUISITES, frozenset(),
                         "no cross-course prerequisite is allowed today")

    def test_every_shipped_bundle_passes(self):
        # the whole configured catalogue, the way `--all` would load it
        paths = [p for p in load_seed.all_bundle_paths()]
        edges = set()
        for b in load_seed.validate_all(paths):
            edges |= {(e.src, e.dst, e.type) for e in b.edges}
        self.assertTrue(any(t == "prerequisite_of" for _, _, t in edges))
        self.assertEqual(load_seed.cross_course_prerequisites(edges), [])

    def test_validate_only_refuses_without_a_database(self):
        tmp = Path(tempfile.mkdtemp(prefix="xcourse_"))
        zz = mini_course("zz")
        zy = copy.deepcopy(mini_course("zy"))
        zy["edges"].append({"src": "lo:zz1-1-1", "dst": "lo:zy1-1-1", "type": "prerequisite_of"})
        zy["external_node_refs"] = ["lo:zz1-1-1"]
        paths = [str(write_bundle(tmp, "zz", zz)), str(write_bundle(tmp, "zy", zy))]
        with self.assertRaises(SystemExit) as cm:
            run_loader("dbname=unused_by_validate_only", *paths, "--validate-only")
        self.assertIn("two different courses", str(cm.exception))


@skip_without_db()
class ScopedLoadRefusesTest(unittest.TestCase):
    """A scoped load whose prerequisite reaches into a course already in the database."""

    def setUp(self):
        self.db = ScratchDB("xcourse").create()
        self.tmp = Path(tempfile.mkdtemp(prefix="xcourse_db_"))
        run_loader(self.db.dsn, str(write_bundle(self.tmp, "zz", mini_course("zz"))), "--course", ZZ)

    def tearDown(self):
        self.db.drop()

    def test_the_load_refuses_and_writes_nothing(self):
        zy = copy.deepcopy(mini_course("zy"))
        zy["edges"].append({"src": "lo:zz1-1-1", "dst": "lo:zy1-1-1", "type": "prerequisite_of"})
        zy["external_node_refs"] = ["lo:zz1-1-1"]
        before = self.db.one("SELECT count(*) FROM graph_edges")
        with self.assertRaises(SystemExit) as cm:
            run_loader(self.db.dsn, str(write_bundle(self.tmp, "zy", zy)), "--course", ZY)
        self.assertIn(f"lo:zz1-1-1 ({ZZ}) -> lo:zy1-1-1 ({ZY})", str(cm.exception))
        self.assertEqual(self.db.one("SELECT count(*) FROM graph_edges"), before)
        self.assertIsNone(self.db.one("SELECT id FROM graph_nodes WHERE id = %s", (ZY,)))

    def test_the_same_course_without_the_edge_loads(self):
        run_loader(self.db.dsn, str(write_bundle(self.tmp, "zy", mini_course("zy"))), "--course", ZY)
        self.assertEqual(self.db.one("SELECT id FROM graph_nodes WHERE id = %s", (ZY,)), ZY)


if __name__ == "__main__":
    unittest.main()

"""TASKS A STUDENT WORKS ON A FIGURE (figure_tasks.py): derived from the drawing, written by compile. Run on lesson
pp3u10-3's own drawings, the lesson the tasks were first written for by hand — the derivation must find exactly what
that hand-made list had, and never give an exercise's figure a task that answers it."""
import json
import unittest
from pathlib import Path

import figure_tasks as FT

HERE = Path(__file__).resolve().parent.parent
VIS = {v["figure"]: v for v in json.loads((HERE / "teaching/prep3-parallel/visuals/pp3u10-3.json").read_text())["visuals"]}
spec = lambda n: VIS[f"pp3u10-3:figure-{n}"]["spec"]
names = lambda ts: [t["name"] for t in ts]


class FigureTasks(unittest.TestCase):
    def test_the_theorem_figure_gets_spot_then_drag_on_the_angle_with_most_equal_angles(self):
        ts = FT.tasks_for("geo_scene", spec(2), exercise=False)
        self.assertEqual(names(ts), ["spot", "drag"])
        self.assertEqual(ts[0]["angle"], ["A", "C", "B"])
        self.assertEqual(ts[1]["point"], "C")
        self.assertEqual(sorted(c[1] for c in ts[1]["compare"]), ["D", "E"])

    def test_two_angles_marked_equal_on_one_base_get_the_converse(self):
        ts = FT.tasks_for("geo_scene", spec(16), exercise=False)
        self.assertEqual(names(ts), ["converse"])
        self.assertEqual((ts[0]["point"], ts[0]["key"]), ("D", 0))

    def test_marks_say_what_they_mark(self):
        self.assertEqual(FT.tasks_for("geo_scene", spec(4), True)[0]["ask"], "equal")
        self.assertEqual(FT.tasks_for("geo_scene", spec(11), True)[0]["ask"], "parallel")
        self.assertEqual(FT.tasks_for("geo_scene", spec(20), True)[0]["ask"], "both")
        self.assertIn("arcs", FT.tasks_for("geo_scene", spec(10), True)[0]["prompt"])

    def test_an_exercise_figure_never_gets_a_task_that_answers_it(self):
        # the theorem figure, if it were shown with an exercise, gets nothing but marks (it has none)
        self.assertEqual(FT.tasks_for("geo_scene", spec(2), exercise=True), [])
        self.assertEqual(FT.tasks_for("geo_scene", spec(16), exercise=True), [])

    def test_nothing_for_a_figure_with_nothing_to_work(self):
        self.assertEqual(FT.tasks_for("geo_scene", spec(3), exercise=True), [])     # drill 1 figure 1: no marks
        self.assertEqual(FT.tasks_for("coordinate_plot", {"points": []}, exercise=False), [])
        self.assertEqual(FT.tasks_for("geo_scene", {"panels": [{"elements": []}]}, exercise=False), [])

    def test_compile_writes_tasks_into_a_copy_and_drops_any_a_producer_wrote(self):
        import compile_book_records as CBR
        raw = {**spec(4), "tasks": [{"name": "bogus"}]}
        out = CBR.with_tasks("geo_scene", raw, exercise=True)
        self.assertEqual(names(out["tasks"]), ["marks"])
        self.assertEqual(raw["tasks"], [{"name": "bogus"}], "the teaching layer's drawing is never changed")
        self.assertNotIn("tasks", CBR.with_tasks("geo_scene", spec(3), exercise=True))


if __name__ == "__main__":
    unittest.main()

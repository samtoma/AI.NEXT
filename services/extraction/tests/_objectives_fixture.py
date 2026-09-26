"""A small Grade-10-shaped book for the S1 and lesson-conveyor tests (WP-P2, WP-P3).

TEST FIXTURE. Chapter 8's shape after G0 — 8.2 whole, 8.3 split into two parts, the summary 8.5
and an end-of-chapter set — written in source_adapter.py's real block format (⟦m:<md5>⟧ maths,
nested problem/solution dicts, printed answers from the appendix, teacher-only notes). Section
numbers, codes and page numbers follow the manifest; every sentence, item, answer and solution is
invented for the tests and is NOT the book's text. Marker strings (ZZ…) let the tests prove what
never reaches a prompt.

`build(tmp)` writes the book config, blocks, manifest, the S0b accepted map and the figure crops
into `tmp`, and returns their paths. `run_workflow(script, args, responses)` runs a
runbook/*.workflow.js through tests/workflow_stub.mjs (no model is called).
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

EX = Path(__file__).resolve().parents[1]
STUB = EX / "tests" / "workflow_stub.mjs"
NODE = shutil.which("node")

TEACHER_TEXT = "ZZTEACHER Remind learners that CAPS introduces this formula before the gradient."
SOLUTION_MARK = "ZZSOLUTION"
PRINTED_MARK = "ZZPRINTED"


def md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


class Maths:
    """LaTeX -> ⟦m:md5⟧ references, and the S0b accepted map they need."""

    def __init__(self) -> None:
        self.accepted: dict[str, str] = {}

    def __call__(self, latex: str) -> str:
        h = md5(latex)
        self.accepted[h] = latex
        return f"⟦m:{h}⟧"

    def content(self, text: str, *latex_block: str, figures=()) -> dict:
        """An adapter content dict: prose, then display maths, in order."""
        parts, maths, kinds = [text], [], []
        for m in __import__("re").findall(r"⟦m:([0-9a-f]{32})⟧", text):
            maths.append(m)
            kinds.append("inline")
        for lt in latex_block:
            parts.append(self(lt))
            maths.append(md5(lt))
            kinds.append("block")
        return {"text": " ".join(parts), "maths": maths, "math_kinds": kinds,
                "figures": [{"src": f, "context": "exercise_problem"} for f in figures]}


def blocks(M: Maths) -> list[dict]:
    n = iter(range(1, 999))
    bid = lambda: f"b{next(n):05d}"  # noqa: E731
    B: list[dict] = []

    def add(type_, section, page, **kw):
        b = {"id": bid(), "type": type_, "file": f"08-fixture-{section}.html", "chapter": 8,
             "subsection_code": kw.pop("subsec", None), "section": section, "printed_page": page}
        b.update(kw)
        B.append(b)
        return b

    # ---- 8.2 Distance between two points (one lesson)
    add("heading", "8.2", 288, level=2, code="EMA69", title="Distance between two points",
        text="8.2 Distance between two points")
    add("para", "8.2", 288, text=f"The distance between two points {M('A(x_1; y_1)')} and "
        f"{M('B(x_2; y_2)')} is found with the distance formula.")
    add("definition", "8.2", 288, term="Distance formula",
        text=f"Distance formula The distance between two points is {M('d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}')}.")
    add("teacher_only", "8.2", None, text=TEACHER_TEXT)
    add("figure", "8.2", 289, caption="Figure 8.3: two points and the distance between them",
        text="⟦fig:tikzpicture/fig-body.png⟧ Figure 8.3", figures=[{"src": "tikzpicture/fig-body.png", "context": "body"}])
    add("worked_example", "8.2", 289, n=1, title="Using the distance formula",
        question={"text": f"Find the distance between {M('P(1; 2)')} and {M('Q(4; 6)')}.", "figures": []},
        steps=[{"title": "Write down the formula", "text": M("d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}"), "figures": []},
               {"title": "Substitute and simplify", "text": M("d = \\sqrt{3^2 + 4^2} = 5"), "figures": []},
               {"title": "Write the final answer", "text": f"The distance is {M('5')} units.", "figures": []}],
        loose_solution=None)
    add("exercise_header", "8.2", 292, exercise="8-2", q=None, level=1,
        text="Find the distance between the points. Leave your answer in surd form where necessary.")
    add("exercise_item", "8.2", 292, exercise="8-2", q=1, sub=None, item_key="ex8-2-1",
        problem=M.content(f"{M('(1; 1)')} and {M('(4; 5)')}"),
        solution=M.content(f"{SOLUTION_MARK} Use the distance formula.", "d = \\sqrt{3^2 + 4^2} = 5"),
        printed_answer={"text": f"5 {PRINTED_MARK}1", "pdf_page": 520, "scope": "item"}, shortcode="FX21",
        end_of_chapter=False)
    add("exercise_item", "8.2", 292, exercise="8-2", q=2, sub="a", item_key="ex8-2-2a",
        problem=M.content(f"the two points in the diagram ⟦fig:tikzpicture/fig-item.png⟧",
                          figures=["tikzpicture/fig-item.png"]),
        solution=M.content(f"{SOLUTION_MARK} Read off the points.", "d = \\sqrt{29}"),
        printed_answer={"text": "√ 29", "pdf_page": 520, "scope": "item"}, shortcode="FX22",
        end_of_chapter=False)
    add("exercise_item", "8.2", 293, exercise="8-2", q=2, sub="b", item_key="ex8-2-2b",
        problem=M.content(f"{M('(0; 0)')} and {M('(2,5; 6)')}"),
        solution=M.content(f"{SOLUTION_MARK} Substitute.", "d = 6{,}5"),
        printed_answer={"text": "6,5", "pdf_page": 520, "scope": "item"}, shortcode="FX23",
        end_of_chapter=False)
    add("exercise_item", "8.2", 293, exercise="8-2", q=3, sub=None, item_key="ex8-2-3",
        problem=M.content(f"Show that the triangle with vertices {M('(0; 0)')}, {M('(3; 0)')} and {M('(0; 3)')} is isosceles."),
        solution=M.content(f"{SOLUTION_MARK} Two sides have length 3, so the triangle is isosceles."),
        printed_answer=None, shortcode="FX24", end_of_chapter=False)

    # ---- 8.3 Gradient of a line, split at G0: part 1 from the section start, part 2 at EMA6C
    add("heading", "8.3", 293, level=2, code="EMA6B", title="Gradient of a line", text="8.3 Gradient of a line")
    add("para", "8.3", 293, text=f"The gradient of a line is the ratio of the vertical change to the horizontal change: {M('m = \\frac{y_2 - y_1}{x_2 - x_1}')}.")
    add("worked_example", "8.3", 294, n=3, title="Gradient between two points",
        question={"text": f"Find the gradient of the line through {M('(1; 2)')} and {M('(3; 8)')}.", "figures": []},
        steps=[{"title": "Substitute", "text": M("m = \\frac{8 - 2}{3 - 1}"), "figures": []},
               {"title": "Write the final answer", "text": M("m = 3"), "figures": []}], loose_solution=None)
    add("exercise_item", "8.3", 296, exercise="8-3", q=1, sub=None, item_key="ex8-3-1",
        problem=M.content(f"Find the gradient of the line through {M('(0; 1)')} and {M('(2; 7)')}."),
        solution=M.content(f"{SOLUTION_MARK} Use the gradient formula.", "m = \\frac{7 - 1}{2 - 0} = 3"),
        printed_answer={"text": "3", "pdf_page": 520, "scope": "item"}, shortcode="FX31", end_of_chapter=False)
    add("exercise_item", "8.3", 296, exercise="8-3", q=2, sub=None, item_key="ex8-3-2",
        problem=M.content(f"Is the gradient of the line through {M('(0; 5)')} and {M('(5; 0)')} positive or negative?"),
        solution=M.content(f"{SOLUTION_MARK} The line falls, so the gradient is negative."),
        printed_answer={"text": "negative", "pdf_page": 520, "scope": "item"}, shortcode="FX32", end_of_chapter=False)
    add("heading", "8.3", 298, level=3, code="EMA6C", title="Straight lines", text="Straight lines", subsec="EMA6C")
    add("para", "8.3", 298, subsec="EMA6C", text=f"The equation of a straight line is {M('y = mx + c')}, where {M('m')} is the gradient.")
    add("teacher_only", "8.3", None, text="ZZTEACHER2 Point out that this is also taught in Grade 9.", subsec="EMA6C")
    add("worked_example", "8.3", 299, n=5, title="Finding the equation of a straight line", subsec="EMA6C",
        question={"text": f"Find the equation of the line with gradient {M('2')} through {M('(0; 1)')}.", "figures": []},
        steps=[{"title": "Write the final answer", "text": M("y = 2x + 1"), "figures": []}], loose_solution=None)
    add("exercise_item", "8.3", 302, exercise="8-4", q=1, sub=None, item_key="ex8-4-1", subsec="EMA6C",
        problem=M.content(f"Find the equation of the line through {M('(0; 2)')} with gradient {M('3')}."),
        solution=M.content(f"{SOLUTION_MARK} Substitute into the form.", "y = 3x + 2"),
        printed_answer={"text": "y = 3x + 2", "pdf_page": 520, "scope": "item"}, shortcode="FX41", end_of_chapter=False)
    add("exercise_item", "8.3", 302, exercise="8-4", q=2, sub=None, item_key="ex8-4-2",
        problem=M.content(f"Write down the gradient of {M('y = -4x + 1')}."),
        solution=M.content(f"{SOLUTION_MARK} Read off m.", "m = -4"),
        printed_answer={"text": "−4", "pdf_page": 520, "scope": "item"}, shortcode="FX42", end_of_chapter=False)

    # ---- 8.5 Chapter summary and the end-of-chapter set
    add("heading", "8.5", 314, level=2, code="EMA6J", title="Chapter summary", text="8.5 Chapter summary")
    add("summary_item", "8.5", 314, text=f"The distance between two points is {M('d = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}')}.")
    add("summary_item", "8.5", 314, text=f"The gradient of a line is {M('m = \\frac{y_2 - y_1}{x_2 - x_1}')}.")
    add("exercise_item", "8.5", 315, exercise="8-6", q=1, sub=None, item_key="ex8-6-1",
        problem=M.content(f"Find the distance between {M('(2; 3)')} and {M('(5; 7)')}."),
        solution=M.content(f"{SOLUTION_MARK} Use the formula.", "d = 5"),
        printed_answer={"text": "5", "pdf_page": 521, "scope": "item"}, shortcode="FX61", end_of_chapter=True)
    add("exercise_item", "8.5", 315, exercise="8-6", q=2, sub=None, item_key="ex8-6-2",
        problem=M.content(f"Find the gradient of the line through {M('(1; 1)')} and {M('(3; 5)')}."),
        solution=M.content(f"{SOLUTION_MARK} Use the gradient formula.", "m = 2"),
        printed_answer={"text": "2", "pdf_page": 521, "scope": "item"}, shortcode="FX62", end_of_chapter=True)
    add("exercise_item", "8.5", 316, exercise="8-6", q=3, sub=None, item_key="ex8-6-3",
        problem=M.content(f"Find the equation of the line through {M('(0; -1)')} with gradient {M('5')}."),
        solution=M.content(f"{SOLUTION_MARK} Substitute.", "y = 5x - 1"),
        printed_answer={"text": "y = 5x − 1", "pdf_page": 521, "scope": "item"}, shortcode="FX63", end_of_chapter=True)
    return B


def manifest() -> dict:
    """The post-G0 manifest shape build_manifest.py writes (book_provenance, part_starts_at)."""
    def lesson(id_, title, section, stitle, code, part, order, pages, wes, sets, subs=(), starts=None, part_title=None):
        return {"id": id_, "section": section, "title": stitle, "part_title": part_title, "code": code,
                "printed_pages": pages, "order_in_module": order,
                "subheadings": [{"code": c, "title": c} for c in subs],
                "worked_examples": [{"n": n} for n in wes],
                "exercises": [{"label": s, "end_of_chapter": False} for s in sets],
                "epub": {"part_starts_at": starts},
                "book_provenance": {"sections": [{"number": section, "title": stitle, "code": code}],
                                    "part": part, "chapter_intro": False, "group_key": section}}
    return {"manifest": "fixture", "status": "G0 passed (fixture)", "book": {"title": "Fixture"},
            "modules": [{
                "id": "module:g10m-c08", "chapter": 8, "title": "Analytical geometry", "order_in_parent": 8,
                "introduction": None,
                "chapter_summary": {"section": "8.5", "title": "Chapter summary"},
                "end_of_chapter_exercise": {"label": "8-6", "end_of_chapter": True},
                "lessons": [
                    lesson("g10m8s2-1", None, "8.2", "Distance between two points", "EMA69", None, 1,
                           [288, 293], [1], ["8-2"]),
                    lesson("g10m8s3-1", None, "8.3", "Gradient of a line", "EMA6B", {"n": 1, "of": 2}, 2,
                           [293, 298], [3], ["8-3"], part_title="Gradient between two points"),
                    lesson("g10m8s3-2", None, "8.3", "Gradient of a line", "EMA6B", {"n": 2, "of": 2}, 3,
                           [298, 308], [5], ["8-4"], subs=["EMA6C"], starts="__EMA6C__",
                           part_title="Straight lines"),
                ]}]}


def book_config(manifest_path: Path) -> dict:
    return {"config_version": 1, "book": "g10-math", "title": "Mathematics — Grade 10 (FIXTURE)",
            "course_id": "course:us-g10-math-en", "curriculum": "us-american-en", "subject": "math",
            "grade": "10", "language": "en", "direction": "ltr", "id_prefixes": ["g10m"],
            "load_order": 40, "sources": {"pdf": None, "epub": None, "teacher_pdf": None},
            "objectives_mode": "derived", "notation": {"decimal": "point", "pair_separator": "comma"},
            "sacred_content": False, "bundles": [], "manifest": None}


PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
                    "0000000d4944415478da63f8ffff3f0005fe02fea7d6a4a20000000049454e44ae426082")


def build(tmp: Path) -> dict:
    tmp.mkdir(parents=True, exist_ok=True)
    M = Maths()
    bs = blocks(M)
    man = manifest()
    # the part's start block: the EMA6C heading's id
    start = next(b["id"] for b in bs if b.get("code") == "EMA6C")
    man["modules"][0]["lessons"][2]["epub"]["part_starts_at"] = start
    work = tmp / "work" / "g10-math"
    (work / "figures").mkdir(parents=True, exist_ok=True)
    for src in ("tikzpicture/fig-body.png", "tikzpicture/fig-item.png"):
        (work / "figures" / src.replace("/", "__")).write_bytes(PNG)
    (work / "blocks.jsonl").write_text("".join(json.dumps(b, ensure_ascii=False) + "\n" for b in bs))
    (tmp / "manifest.json").write_text(json.dumps(man, ensure_ascii=False, indent=1))
    (tmp / "accepted.json").write_text(json.dumps({"accepted": {h: {"latex": l, "accepted_by": "hash"}
                                                               for h, l in M.accepted.items()}}))
    books = tmp / "books"
    books.mkdir(exist_ok=True)
    (books / "g10-math.json").write_text(json.dumps(book_config(tmp / "manifest.json"), indent=1))
    return {"root": tmp, "blocks": work / "blocks.jsonl", "manifest": tmp / "manifest.json",
            "maths": tmp / "accepted.json", "book": books / "g10-math.json", "work": work,
            "objectives": tmp / "objectives", "runs": tmp / "runs", "accepted": M.accepted}


def run_workflow(script: Path, args: dict, responses: dict, tmp: Path) -> dict:
    """Run a workflow script through the stub runtime. Returns the stub's JSON report."""
    fx = tmp / f"stub-{script.stem}.json"
    fx.write_text(json.dumps({"args": args, "responses": responses}, ensure_ascii=False))
    p = subprocess.run([NODE, str(STUB), str(script), str(fx)], capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise AssertionError(f"stub runtime crashed: {p.stderr[-2000:]}")
    return json.loads(p.stdout)

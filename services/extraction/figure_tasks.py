"""TASKS A STUDENT WORKS ON A FIGURE — derived from the drawing itself, with no model call (compile step).

    uv run figure_tasks.py report <book> [<lesson> …]     # every figure's tasks, for a person to look over

Tamer, 2026-10-21: "wire the interactive figure tasks into the pipeline". They began as a hand-written table for lesson
pp3u10-3 (app/src/lib/figure-interactions.ts); every rule that table followed is here, applied to every geo_scene the
drawing step (S4) wrote. compile_book_records.py calls `tasks_for` on each figure it shows and writes the result into
the figure's spec as `tasks` (VIZ_SPEC v4: written by compile, never by S4). The app grades each task from the same
spec (lib/figure-interactions.ts), so a task is only written where that grading has something to grade.

THE FOUR TASKS, and when a figure gets one:
  marks     "Which chords does the figure mark as equal? Tap them." — any figure whose drawing carries equal-length
            ticks or parallel arrows on two or more lines or arcs. Reading the givens never answers an exercise, so an
            exercise's figure gets this one too.
  spot      "Which other angles equal ∠ACB? Tap their vertices." — a circle with an angle at a point C on it, both
            arms drawn to points A and B on it, and at least one other drawn angle at a point of the circle standing
            on the same chord AB, on the same side: the lesson's theorem, read off the drawing.
  drag      "Drag C around the circle and watch ∠ACB." — the same figure: after spot, the student moves C.
  converse  "Drag D anywhere above AB and compare ∠ADB with ∠ACB." — two angles the drawing marks equal (equal-angle
            arcs) at two points of a circle, standing on the same segment AB, on the same side.
spot, drag and converse are NEVER written for a figure shown with an exercise: telling which angles are equal is what
an exercise on inscribed angles asks (pp3u10-3 drill 1 asks m(∠C) in exactly such a figure). They go on a lesson's own
figures and its worked examples' only. Tasks are ordered as the student meets them: marks, spot, drag, converse.

ARROW DIAGRAMS (arrow_map; Tamer 2026-10-21, "start the arrow diagrams for unit 1" — the prototype's draw / verdict /
range of proto/interactive-diagrams, moved into the data). Never on an exercise's figure, for any of the three:
  draw      "Draw the relation {(−1, 2), (1, 6), (2, 8)} as an arrow diagram." — the student taps an element of X, then where
            it goes; graded against the figure's own arrows, which are then drawn in. A complete product is asked as
            "Draw X × Y". The pairs are in the prompt, so it is never a guess (at most 9 arrows, 7 elements a side).
  function  "Is this relation a function from X to Y?" — only in a lesson whose objectives teach functions
            (`context["functions"]`), graded by every element of X sending exactly one arrow.
  range     "Tap every element of Y an arrow reaches." — only in a lesson whose objectives teach the range
            (`context["range"]`), and only on a function.

Pure, apart from `report`.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

SEGMENT_TYPES = {"segment", "chord", "radius", "diameter", "tangent"}
DRAG_OPTIONS = ["It stays the same", "It gets bigger as {p} moves", "It gets smaller as {p} moves"]
CONVERSE_OPTIONS = ["Only when {p} is on the circle through {x}, {y} and {v}", "Whenever {p} is above {x}{y}", "Always"]


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _pt(v):
    return (float(v[0]), float(v[1])) if isinstance(v, list) and len(v) >= 2 and _num(v[0]) and _num(v[1]) else None


def _els(spec: dict) -> list[dict]:
    return [e for e in spec.get("elements") or [] if isinstance(e, dict) and isinstance(e.get("type"), str) and e["type"]]


def _points(spec: dict) -> dict[str, tuple[float, float]]:
    return {e["label"]: (float(e["x"]), float(e["y"])) for e in _els(spec)
            if e["type"] == "point" and isinstance(e.get("label"), str) and e["label"] and _num(e.get("x")) and _num(e.get("y"))}


def _circle(spec: dict):
    c = next((e for e in _els(spec) if e["type"] == "circle"), None)
    if not c:
        return None
    return ((float(c.get("cx", 0)) if _num(c.get("cx")) else 0.0, float(c.get("cy", 0)) if _num(c.get("cy")) else 0.0),
            float(c["r"]) if _num(c.get("r")) else 3.0)


def _span(spec: dict) -> float:
    ps = list(_points(spec).values())
    if len(ps) < 2:
        return 1.0
    return max(max(p[0] for p in ps) - min(p[0] for p in ps), max(p[1] for p in ps) - min(p[1] for p in ps), 1e-6)


def _label_at(points: dict, p, eps: float) -> str:
    return next((l for l, q in points.items() if math.dist(p, q) <= eps), "")


def _segments(spec: dict) -> list[dict]:
    """Every drawn line, named by its end points' labels: {index, kind, name, ends, ticks, parallel}."""
    points, eps, out = _points(spec), _span(spec) * 0.02, []
    for i, e in enumerate(_els(spec)):
        if e["type"] in SEGMENT_TYPES:
            f, t = _pt(e.get("from")), _pt(e.get("to"))
            if f and t:
                a, b = _label_at(points, f, eps), _label_at(points, t, eps)
                out.append({"index": i, "kind": e["type"], "name": a + b, "ends": (a, b),
                            "ticks": int(e.get("ticks") or 0) if _num(e.get("ticks")) else 0,
                            "parallel": int(e.get("parallel") or 0) if _num(e.get("parallel")) else 0})
        elif e["type"] == "arc":
            out.append({"index": i, "kind": "arc", "name": "", "ends": ("", ""),
                        "ticks": int(e.get("ticks") or 0) if _num(e.get("ticks")) else 0, "parallel": 0})
    return out


def _drawn(spec: dict, a: str, b: str) -> bool:
    return any(set(s["ends"]) == {a, b} for s in _segments(spec) if s["kind"] != "arc")


def _side(x, y, p) -> int:
    v = (y[0] - x[0]) * (p[1] - x[1]) - (y[1] - x[1]) * (p[0] - x[0])
    return (v > 0) - (v < 0)


def _on_circle(circle, p) -> bool:
    (cx, cy), r = circle
    return abs(math.dist(p, (cx, cy)) - r) <= r * 0.06


# ---------------------------------------------------------------------------------------------------- the tasks

def marks_task(spec: dict) -> dict | None:
    segs = [s for s in _segments(spec) if s["ticks"] or s["parallel"]]
    if len(segs) < 2:
        return None
    equal, par = any(s["ticks"] for s in segs), any(s["parallel"] for s in segs)
    kinds = {s["kind"] for s in segs}
    noun = ("arcs" if kinds == {"arc"} else "chords" if kinds <= {"chord"} else "sides or segments")
    if equal and par:
        return {"name": "marks", "mode": "marks", "ask": "both", "prompt": "Tap every line the marks tell you something about."}
    if par:
        return {"name": "marks", "mode": "marks", "ask": "parallel", "prompt": f"Which {noun} are marked parallel? Tap all of them."}
    return {"name": "marks", "mode": "marks", "ask": "equal", "prompt": f"Which {noun} does the figure mark as equal? Tap all of them."}


def _equal_angles(spec: dict):
    """The angle at a point of the circle with the most other drawn angles equal to it (same chord, same side), as
    (X, V, Y, [the equal vertices]), or None."""
    circle, pts = _circle(spec), _points(spec)
    if not circle:
        return None
    on = sorted(l for l, p in pts.items() if _on_circle(circle, p))
    best = None
    for v in on:
        for i, x in enumerate(on):
            for y in on[i + 1:]:
                if v in (x, y) or not (_drawn(spec, v, x) and _drawn(spec, v, y)):
                    continue
                sv = _side(pts[x], pts[y], pts[v])
                eq = [p for p in on if p not in (x, y, v) and _drawn(spec, p, x) and _drawn(spec, p, y)
                      and _side(pts[x], pts[y], pts[p]) == sv]
                if eq and (best is None or len(eq) > len(best[3])):
                    best = (x, v, y, eq)
    return best


def spot_and_drag(spec: dict) -> list[dict]:
    found = _equal_angles(spec)
    if not found:
        return []
    x, v, y, eq = found
    return [
        {"name": "spot", "mode": "equal_angle", "angle": [x, v, y], "prompt": f"Which other angles equal ∠{x}{v}{y}? Tap their vertices."},
        {"name": "drag", "mode": "drag", "point": v, "along": "circle", "angle": [x, v, y],
         "compare": [[x, p, y] for p in eq], "prompt": f"Drag {v} around the circle and watch ∠{x}{v}{y}.",
         "question": f"While {v} stays on the same arc, what happens to ∠{x}{v}{y}?",
         "options": [o.format(p=v) for o in DRAG_OPTIONS]},
    ]


def _arms(spec: dict, e: dict, pts: dict) -> set[str]:
    """The labelled points an angle element's two arms run to (within 6° of either arm)."""
    at = _pt(e.get("at"))
    if not at:
        return set()
    out = set()
    for d in (e.get("fromDeg"), e.get("toDeg")):
        if not _num(d):
            continue
        for l, p in pts.items():
            if math.dist(p, at) < 1e-9:
                continue
            a = math.degrees(math.atan2(p[1] - at[1], p[0] - at[0]))
            if abs((a - d + 540) % 360 - 180) < 6:
                out.add(l)
    return out


def converse_task(spec: dict) -> dict | None:
    circle, pts = _circle(spec), _points(spec)
    if not circle:
        return None
    angs = [e for e in _els(spec) if e["type"] == "angle" and _num(e.get("arcs")) and e["arcs"] >= 1 and _pt(e.get("at"))]
    for i, a in enumerate(angs):
        for b in angs[i + 1:]:
            if a["arcs"] != b["arcs"]:
                continue
            va = _label_at(pts, _pt(a["at"]), _span(spec) * 0.02)
            vb = _label_at(pts, _pt(b["at"]), _span(spec) * 0.02)
            base = _arms(spec, a, pts) & _arms(spec, b, pts)
            if not va or not vb or va == vb or len(base) != 2:
                continue
            x, y = sorted(base)
            if not all(_on_circle(circle, pts[l]) for l in (x, y, va, vb)) or _side(pts[x], pts[y], pts[va]) != _side(pts[x], pts[y], pts[vb]):
                continue
            v, p = sorted((va, vb))   # the student drags the later letter
            return {"name": "converse", "mode": "drag", "point": p, "along": "free", "angle": [x, p, y], "compare": [[x, v, y]],
                    "prompt": f"Drag {p} anywhere above {x}{y} and compare ∠{x}{p}{y} with ∠{x}{v}{y}.",
                    "question": f"When are ∠{x}{p}{y} and ∠{x}{v}{y} equal?",
                    "options": [o.format(p=p, x=x, y=y, v=v) for o in CONVERSE_OPTIONS],
                    # the converse of the inscribed-angle theorem, which the book states: on one base, on one side,
                    # equal angles <=> the four points lie on a circle
                    "key": 0}
    return None


def _label(v) -> str:
    return str(v) if isinstance(v, str) else (f"{v:g}" if _num(v) else "?")


def _arrow_map(spec: dict):
    """(X, Y, [(i, j)]) as the app reads it (lib/figure-interactions.ts readArrowMap): a pair names an element by value,
    else by index; a pair that names nothing is dropped."""
    X = [_label(v) for v in spec.get("X") or []]
    Y = [_label(v) for v in spec.get("Y") or []]

    def at(xs, v):
        if _label(v) in xs:
            return xs.index(_label(v))
        return v if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < len(xs) else None
    pairs = []
    for p in spec.get("pairs") or []:
        if isinstance(p, list) and len(p) >= 2 and at(X, p[0]) is not None and at(Y, p[1]) is not None:
            if (at(X, p[0]), at(Y, p[1])) not in pairs:
                pairs.append((at(X, p[0]), at(Y, p[1])))
    return X, Y, pairs


def _minus(t: str) -> str:
    return t.replace("-", "−") if t.lstrip("-").replace(".", "", 1).isdigit() else t


def arrow_tasks(spec: dict, context: dict) -> list[dict]:
    X, Y, pairs = _arrow_map(spec)
    if not X or not Y or not pairs:
        return []
    out = []
    same = X == Y
    if len(pairs) <= 9 and len(X) <= 7 and len(Y) <= 7:
        if len(pairs) == len(X) * len(Y):
            name = "X × X" if same else "X × Y"
            prompt = f"Draw {name} as an arrow diagram: an arrow from every element of X to every element of {'X' if same else 'Y'}."
        else:
            listed = ", ".join(f"({_minus(X[i])}, {_minus(Y[j])})" for i, j in pairs)
            prompt = f"Draw the relation {{{listed}}} as an arrow diagram: one arrow for each pair."
        out.append({"name": "draw", "mode": "arrows", "prompt": prompt})
    is_function = all(sum(1 for i, _ in pairs if i == k) == 1 for k in range(len(X)))
    if context.get("functions"):
        out.append({"name": "function", "mode": "verdict",
                    "prompt": f"Is this relation a function {'on X' if same else 'from X to Y'}?"})
    if context.get("range") and is_function:
        out.append({"name": "range", "mode": "range",
                    "prompt": ("Tap every element an arrow points to: together they are the range." if same
                               else "Tap every element of Y that an arrow reaches: together they are the range.")})
    return out


def tasks_for(kind: str, spec: dict, exercise: bool, context: dict | None = None) -> list[dict]:
    """A figure's tasks, in the order the student meets them. An exercise's figure gets `marks` only (a geo_scene) or
    nothing (an arrow diagram). `context`: what the figure's lesson teaches ({"functions", "range"})."""
    if kind == "arrow_map" and isinstance(spec, dict):
        return [] if exercise else arrow_tasks(spec, context or {})
    if kind != "geo_scene" or not isinstance(spec, dict) or spec.get("panels"):
        return []
    out = [t for t in [marks_task(spec)] if t]
    if not exercise:
        out += spot_and_drag(spec)
        if c := converse_task(spec):
            out.append(c)
    return out


# ---------------------------------------------------------------------------------------------------- report

def report(book: str, lessons: list[str]) -> dict:
    out, n = {}, 0
    for f in sorted((HERE / "compiled" / book).glob("*.json")):
        b = json.loads(f.read_text())
        for v in b.get("visuals") or [] if isinstance(b, dict) else []:
            slug = v["id"].split(":")[1]
            if lessons and slug not in lessons:
                continue
            ts = (v.get("spec") or {}).get("tasks") or []
            if ts:
                n += len(ts)
                out.setdefault(slug, []).append({"figure": v["id"], "question": v.get("question"),
                                                 "tasks": [f"{t['name']}: {t['prompt']}" for t in ts]})
    return {"book": book, "tasks": n, "figures": sum(len(x) for x in out.values()), "by_lesson": out}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("report")
    r.add_argument("book")
    r.add_argument("lessons", nargs="*")
    a = ap.parse_args(argv)
    print(json.dumps(report(a.book, a.lessons), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

/**
 * ENGAGE WITH THE FIGURE (`lib/figure-interactions.ts`): every task is read
 * from the figure's own spec, where the pipeline wrote it at compile
 * (services/extraction/figure_tasks.py), and every key is graded from the same
 * spec. Checked against the real drawings of lesson pp3u10-3 as compiled (the
 * snapshot the /dev/figure-marks harness carries), so a task the pipeline
 * writes that the app cannot grade fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  angleAt,
  circleDragKey,
  equalAngleCandidates,
  figureTasksBlock,
  gradeEqualAngle,
  gradeMarks,
  interactionsFor,
  markables,
  splitTaskId,
  taskIdsOf,
  tasksOf,
  pointsOf,
  withPointMoved,
  type FigureInteraction,
} from "./figure-interactions.ts";
import { parseMessage } from "./chat-parse.ts";
import { PP3U10_3_FIGURES } from "../app/(console)/dev/figure-marks/pp3u10-3-figures.ts";

const spec = (id: string) => {
  const f = PP3U10_3_FIGURES.find((x) => x.id === id);
  assert.ok(f, `${id} is in the harness snapshot`);
  return f.spec;
};
const taskOf = <M extends FigureInteraction["mode"]>(id: string, name: string) =>
  tasksOf(spec(id)).find((t) => t.name === name) as Extract<FigureInteraction, { mode: M }>;

test("the pipeline wrote the tasks the hand-made list had: spot and drag on figure 2, the converse on 16", () => {
  assert.deepEqual(tasksOf(spec("v:pp3u10-3:figure-2")).map((t) => t.name), ["spot", "drag"]);
  assert.deepEqual(tasksOf(spec("v:pp3u10-3:figure-16")).map((t) => t.name), ["converse"]);
  for (const n of [4, 6, 10, 11, 13, 14, 15, 20, 23])
    assert.deepEqual(tasksOf(spec(`v:pp3u10-3:figure-${n}`)).map((t) => t.mode), ["marks"], `figure ${n}`);
});

test("a malformed task is left out, never drawn", () => {
  assert.deepEqual(tasksOf({ tasks: [{ mode: "marks", ask: "sideways", prompt: "x" }, { mode: "drag" }, 7] }), []);
  assert.deepEqual(tasksOf({}), []);
  assert.deepEqual(tasksOf(null), []);
});

test("every task the pipeline wrote can be graded from the figure's own spec", () => {
  for (const f of PP3U10_3_FIGURES) {
    for (const t of tasksOf(f.spec)) {
      if (t.mode === "marks") assert.ok(gradeMarks(f.spec, t.ask, []).expected.length >= 2, `${f.id}: marks to read`);
      if (t.mode === "equal_angle") assert.ok(equalAngleCandidates(f.spec, t.angle).some((c) => c.equal), `${f.id}: an equal angle`);
      if (t.mode === "drag" && t.along === "circle") assert.equal(circleDragKey(f.spec, t), 0, `${f.id}: the angle stays`);
      if (t.mode === "drag" && t.along === "free") assert.equal(t.key, 0, `${f.id}: the converse's key`);
    }
  }
});

test("read the marks: the key is exactly the marked lines, named by their end points", () => {
  const want: Record<string, string[]> = {
    "v:pp3u10-3:figure-4": ["AD = AB"],
    "v:pp3u10-3:figure-10": ["arc FD = arc CA"],
    "v:pp3u10-3:figure-11": ["BA ∥ DC"],
    "v:pp3u10-3:figure-20": ["EC = EB", "DA ∥ CB"],
    "v:pp3u10-3:figure-23": ["DA ∥ CB", "CD ∥ BA"],
  };
  for (const [id, facts] of Object.entries(want)) {
    const st = taskOf<"marks">(id, "marks");
    const s = spec(id);
    const g = gradeMarks(s, st.ask, []);
    assert.deepEqual(g.facts, facts, id);
    assert.equal(gradeMarks(s, st.ask, g.expected).correct, true, `${id}: the marked lines are right`);
  }
});

test("read the marks: a wrong line or a missing one is not right, and says which", () => {
  const s = spec("v:pp3u10-3:figure-4");
  const byName = new Map(markables(s).map((m) => [m.name, m.index]));
  const g = gradeMarks(s, "equal", [byName.get("AB")!, byName.get("CB")!]);
  assert.equal(g.correct, false);
  assert.deepEqual(g.missed, [byName.get("AD")]);
  assert.deepEqual(g.extra, [byName.get("CB")]);
  assert.equal(gradeMarks(s, "equal", []).correct, false, "tapping nothing is never right");
});

test("tap the equal angle: on figure 2, ∠ADB and ∠AEB stand on arc AB with ∠ACB", () => {
  const cands = equalAngleCandidates(spec("v:pp3u10-3:figure-2"), ["A", "C", "B"]);
  assert.deepEqual(cands.filter((c) => c.equal).map((c) => c.vertex).sort(), ["D", "E"]);
  assert.equal(gradeEqualAngle(cands, ["D", "E"]).correct, true);
  assert.deepEqual(gradeEqualAngle(cands, ["D"]).missed, ["E"]);
});

test("drag along the circle: the computed key is 'stays the same', and it does", () => {
  const s = spec("v:pp3u10-3:figure-2");
  const st = taskOf<"drag">("v:pp3u10-3:figure-2", "drag");
  assert.equal(circleDragKey(s, st), 0);
  const p = pointsOf(s);
  const before = angleAt(p.get("A")!, p.get("C")!, p.get("B")!);
  // C moved to D's neighbour on the same arc: the measured angle is unchanged
  const D = p.get("D")!;
  const moved = pointsOf(withPointMoved(s, "C", [D[0] - 0.4, Math.sqrt(25 - (D[0] - 0.4) ** 2)], [st.angle]));
  const after = angleAt(moved.get("A")!, moved.get("C")!, moved.get("B")!);
  assert.ok(Math.abs(before - after) < 0.5, `${before} vs ${after}`);
});

test("moving a point carries its segments with it, and the live angle is labelled with its measure", () => {
  const s = spec("v:pp3u10-3:figure-2");
  const out = withPointMoved(s, "C", [0, 5], [["A", "C", "B"]]);
  const els = out.elements as Record<string, unknown>[];
  const C = pointsOf(s).get("C")!;
  const stillAtOldC = els.some(
    (e) => Array.isArray(e.from) && Math.hypot((e.from as number[])[0] - C[0], (e.from as number[])[1] - C[1]) < 1e-9
  );
  assert.equal(stillAtOldC, false, "no segment is left at C's old place");
  const live = els.find((e) => e.type === "angle");
  assert.match(String(live?.label), /^\d+°$/);
});

test("the tutor is told about tasks only when the lesson has some, once per figure", () => {
  const f = (id: string, s?: Record<string, unknown>) => ({ id, spec: s ?? null });
  assert.equal(figureTasksBlock([f("v:pp3u10-1:figure-1"), f("v:pp3u10-3:figure-5", {})]), "", "no task: nothing new in the prompt");
  const block = figureTasksBlock([
    f("v:pp3u10-3:figure-2", spec("v:pp3u10-3:figure-2")),
    f("v:pp3u10-3:figure-4", spec("v:pp3u10-3:figure-4")),
    f("v:pp3u10-3:figure-4-2", spec("v:pp3u10-3:figure-4")),
    f("v:pp3u10-3:figure-5", {}),
  ]);
  assert.match(block, /\{\{widget:figure_task:<task id>\}\}/);
  assert.match(block, /asks NO question of its own/);
  assert.equal((block.match(/^- v:pp3u10-3:figure-4#marks:/gm) ?? []).length, 1, "a copy on a second question is one task");
  // ONE TASK, ONE CARD: figure 2's two jobs are two tasks, each with its own id, given in order
  assert.match(block, /^- v:pp3u10-3:figure-2#spot: asks "Which other angles equal ∠ACB\?.*task 1 of 2/m);
  assert.match(block, /^- v:pp3u10-3:figure-2#drag: Drag C .*task 2 of 2/m);
  assert.doesNotMatch(block, /figure-5/);
});

test("figure_task parses like viz_ref: a bare id, its own widget name", () => {
  const blocks = parseMessage("Try this one.\n{{widget:figure_task:v:pp3u10-3:figure-2#drag}}", false);
  const w = blocks.find((b) => b.t === "widget");
  assert.deepEqual(w, { t: "widget", name: "figure_task", props: { id: "v:pp3u10-3:figure-2#drag" } });
});

test("a task id names one task; without a name it is the figure's first", () => {
  const s = spec("v:pp3u10-3:figure-2");
  const spot = interactionsFor("v:pp3u10-3:figure-2", s);
  assert.equal(spot?.length, 1);
  assert.equal(spot?.[0].mode, "equal_angle");
  assert.equal(interactionsFor("v:pp3u10-3:figure-2#drag", s)?.[0].mode, "drag");
  assert.equal(interactionsFor("v:pp3u10-3:figure-2#nope", s), null);
  assert.equal(interactionsFor("v:pp3u10-3:figure-5", {}), null, "a figure with no tasks is a plain picture");
  assert.deepEqual(taskIdsOf("v:pp3u10-3:figure-2", s), ["v:pp3u10-3:figure-2#spot", "v:pp3u10-3:figure-2#drag"]);
  assert.deepEqual(taskIdsOf("v:pp3u10-3:figure-4", spec("v:pp3u10-3:figure-4")), ["v:pp3u10-3:figure-4#marks"]);
  assert.deepEqual(splitTaskId("v:pp3u10-3:figure-2#drag"), { figureId: "v:pp3u10-3:figure-2", task: "drag" });
});

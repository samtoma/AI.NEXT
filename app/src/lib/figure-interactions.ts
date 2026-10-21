/**
 * ENGAGE WITH THE FIGURE — a stored geo_scene that asks the student to do
 * something with it, not only watch it.
 *
 * Four tasks, each graded from the figure's OWN spec (VIZ_SPEC v4):
 *
 *   marks        "Which chords does the figure mark as equal / parallel?"
 *                The key is the spec's mark fields — `ticks` and `parallel`
 *                on segments and arcs — so reading the givens off a figure is
 *                graded by exactly what is drawn.
 *   spot         (mode equal_angle) "Tap every angle equal to ∠ACB." The key
 *                comes from the coordinates: a drawn angle at P on the circle
 *                standing on the same chord, on the same side of it, is equal.
 *   drag         Drag a point along the circle and watch the angle: on a fixed
 *                arc it does not change. The closing question is graded by
 *                sampling the geometry.
 *   converse     (mode drag, along free) two angles on one base are equal only
 *                when the point is on the circle — the book's stated theorem.
 *
 * WHERE THE TASKS COME FROM (Tamer, 2026-10-21: "wire the interactive figure
 * tasks into the pipeline"). They began as a hand-written table for lesson
 * pp3u10-3. The pipeline now derives them from the drawing
 * (services/extraction/figure_tasks.py, at compile) and writes them into the
 * figure's spec as `tasks`, so every lesson's figures carry their own. A
 * figure shown with an exercise carries `marks` only — telling which angles
 * are equal is what such an exercise asks.
 *
 * ONE TASK, ONE CARD: the tutor pushes each with
 * `{{widget:figure_task:<visual id>#<name>}}`, one per message, in order — a
 * figure that once asked two things on one card hid its second job.
 *
 * GROUNDED, NOT SOLVED: no model is asked anything. ENGAGEMENT ONLY: no
 * attempt row, no mastery move; the outcome reaches the tutor as one note.
 *
 * Pure and dependency-free, so `node --test` loads it with no bundler.
 */

export type Pt = [number, number];

/** `name` addresses one of a figure's several tasks: `<figure id>#<name>`. */
export type FigureInteraction = { name?: string } & (
  | { mode: "marks"; ask: "equal" | "parallel" | "both"; prompt: string }
  | {
      mode: "drag";
      /** the point the student drags, by its label */
      point: string;
      /** circle: kept on the first circle; free: anywhere in the frame */
      along: "circle" | "free";
      /** the angle shown live, vertex in the middle: ["A","C","B"] */
      angle: [string, string, string];
      /** fixed angles shown beside it, to compare */
      compare?: [string, string, string][];
      prompt: string;
      question: string;
      options: string[];
      /** circle drag: computed. free drag: the book's stated theorem. */
      key?: number;
    }
  | { mode: "equal_angle"; angle: [string, string, string]; prompt: string }
);

const isTriple = (v: unknown): v is [string, string, string] =>
  Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "string" && x !== "");

/** One stored task, checked: anything malformed is left out, never drawn. */
function asTask(raw: unknown): FigureInteraction | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const name = typeof t.name === "string" ? t.name : undefined;
  if (typeof t.prompt !== "string" || !t.prompt) return null;
  if (t.mode === "marks" && (t.ask === "equal" || t.ask === "parallel" || t.ask === "both"))
    return { name, mode: "marks", ask: t.ask, prompt: t.prompt };
  if (t.mode === "equal_angle" && isTriple(t.angle)) return { name, mode: "equal_angle", angle: t.angle, prompt: t.prompt };
  if (
    t.mode === "drag" && typeof t.point === "string" && (t.along === "circle" || t.along === "free") && isTriple(t.angle) &&
    typeof t.question === "string" && Array.isArray(t.options) && t.options.every((o) => typeof o === "string") && t.options.length >= 2
  ) {
    const compare = Array.isArray(t.compare) ? t.compare.filter(isTriple) : undefined;
    const key = typeof t.key === "number" && Number.isInteger(t.key) && t.key >= 0 && t.key < t.options.length ? t.key : undefined;
    return { name, mode: "drag", point: t.point, along: t.along, angle: t.angle, compare, prompt: t.prompt,
             question: t.question, options: t.options as string[], key };
  }
  return null;
}

/** A figure's tasks, as the pipeline wrote them into its spec (`spec.tasks`). */
export function tasksOf(spec: Record<string, unknown> | null | undefined): FigureInteraction[] {
  const raw = spec && Array.isArray(spec.tasks) ? spec.tasks : [];
  return raw.map(asTask).filter((t): t is FigureInteraction => t !== null);
}

/** `<figure id>[#<task name>]` → the stored figure's id, and the task's name if one was given. */
export function splitTaskId(id: string): { figureId: string; task: string | null } {
  const i = id.indexOf("#");
  return i < 0 ? { figureId: id, task: null } : { figureId: id.slice(0, i), task: id.slice(i + 1) };
}

/**
 * The task a `figure_task` id names, from the figure's spec: `<id>#<name>`,
 * or the figure's first task without a name. A one-step list; null when the
 * figure has no such task (the card then shows the plain figure).
 */
export function interactionsFor(id: string, spec: Record<string, unknown> | null | undefined): readonly FigureInteraction[] | null {
  const all = tasksOf(spec);
  if (all.length === 0) return null;
  const { task } = splitTaskId(id);
  const one = task === null ? all[0] : all.find((t) => t.name === task);
  return one ? [one] : null;
}

/** Every task of a figure, by the id the tutor pushes it with. */
export function taskIdsOf(figureId: string, spec: Record<string, unknown> | null | undefined): string[] {
  return tasksOf(spec).map((t) => (t.name ? `${figureId}#${t.name}` : figureId));
}

/* ---------------- what the tutor is told ---------------- */

/** One line per step, in the words the student sees. */
function stepSummary(st: FigureInteraction): string {
  if (st.mode === "marks") return `asks "${st.prompt}" (the student taps lines)`;
  if (st.mode === "equal_angle") return `asks "${st.prompt}" (the student taps vertices)`;
  return `${st.prompt} Then asks "${st.question}"`;
}

/** A copy of a figure on a second question (`…:figure-3-2`) is the same figure. */
const baseOf = (id: string) => id.replace(/^(v:[^:]+:figure-\d+)-\d+$/, "$1");

/**
 * The FIGURE TASKS block of a lesson's data, for the figures in its library
 * that carry tasks — "" when none do, so a lesson without tasks is told
 * nothing new (its prompt is byte-for-byte what it was).
 *
 * THE TASK IS THE QUESTION. The figure asks the student itself, so the tutor
 * pushing it must not ask a question of its own in the same message — two
 * voices asking two questions about one picture is what this replaced
 * (Tamer, 2026-10-20). A figure pushed with viz_ref stays a plain picture.
 */
export function figureTasksBlock(figures: readonly { id: string; spec?: Record<string, unknown> | null }[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of figures) {
    const base = baseOf(f.id);
    const steps = tasksOf(f.spec);
    if (steps.length === 0 || seen.has(base)) continue;
    seen.add(base);
    const ids = taskIdsOf(base, f.spec);
    steps.forEach((st, i) =>
      lines.push(`- ${ids[i]}: ${stepSummary(st)}${steps.length > 1 ? ` (task ${i + 1} of ${steps.length} on this figure — give them in this order, one per message)` : ""}`)
    );
  }
  if (lines.length === 0) return "";
  return `FIGURE TASKS — stored figures the student WORKS WITH (taps, drags) instead of only watching. Push one with {{widget:figure_task:<task id>}} (the id as listed below) in place of {{widget:viz_ref:<id>}}.
THE TASK IS YOUR QUESTION: the figure asks the student itself (below), so a message that pushes a task asks NO question of its own — no {{ask}}, no question before or after it. Put the task LAST in the message, one task per message. When the student finishes, a "[figure … — engagement, not an attempt]" note reaches you: react to what they did, then teach on. It is not graded evidence — never treat it as a mastery attempt.
Prefer a task over a plain figure when the beat is about what that figure shows; a figure pushed with viz_ref asks nothing.
${lines.join("\n")}`;
}

/* ---------------- reading the spec ---------------- */

type El = Record<string, unknown> & { type: string };

const SEGMENT_TYPES = new Set(["segment", "chord", "radius", "diameter", "tangent"]);

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pt = (v: unknown): Pt | null =>
  Array.isArray(v) && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null;

export function elementsOf(spec: Record<string, unknown>): El[] {
  const els = Array.isArray(spec.elements) ? spec.elements : [];
  // the same filter the renderer applies (GeoScene parseEls), so indices agree
  return els.filter((e): e is El => !!e && typeof e === "object" && typeof (e as El).type === "string" && (e as El).type !== "");
}

/** label → position, from the spec's point elements */
export function pointsOf(spec: Record<string, unknown>): Map<string, Pt> {
  const out = new Map<string, Pt>();
  for (const e of elementsOf(spec)) {
    if (e.type === "point" && typeof e.label === "string" && e.label && isNum(e.x) && isNum(e.y)) out.set(e.label, [e.x, e.y]);
  }
  return out;
}

export function circleOf(spec: Record<string, unknown>): { c: Pt; r: number } | null {
  const e = elementsOf(spec).find((x) => x.type === "circle");
  if (!e) return null;
  return { c: [isNum(e.cx) ? e.cx : 0, isNum(e.cy) ? e.cy : 0], r: isNum(e.r) ? e.r : 3 };
}

const near = (a: Pt, b: Pt, eps: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;

/** the label of the point at p, or "" */
function labelAt(points: Map<string, Pt>, p: Pt, eps: number): string {
  for (const [l, q] of points) if (near(p, q, eps)) return l;
  return "";
}

function scale(spec: Record<string, unknown>): number {
  const ps = [...pointsOf(spec).values()];
  if (ps.length < 2) return 1;
  const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-6);
}

export interface Markable {
  /** index into spec.elements */
  index: number;
  kind: "segment" | "arc";
  /** "AB", or "arc FD" — the name the feedback uses */
  name: string;
  ticks: number;
  parallel: number;
}

/** Every segment and arc of the figure, named by its end points' labels. */
export function markables(spec: Record<string, unknown>): Markable[] {
  const points = pointsOf(spec);
  const eps = scale(spec) * 0.02;
  const circle = circleOf(spec);
  const out: Markable[] = [];
  elementsOf(spec).forEach((e, index) => {
    const ticks = isNum(e.ticks) ? Math.round(e.ticks) : 0;
    const parallel = isNum(e.parallel) ? Math.round(e.parallel) : 0;
    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt(e.from), t = pt(e.to);
      if (!f || !t) return;
      const name = labelAt(points, f, eps) + labelAt(points, t, eps);
      out.push({ index, kind: "segment", name: name || "this line", ticks, parallel });
    } else if (e.type === "arc" && circle) {
      const c: Pt = [isNum(e.cx) ? e.cx : circle.c[0], isNum(e.cy) ? e.cy : circle.c[1]];
      const r = isNum(e.r) ? e.r : circle.r;
      const end = (deg: number): Pt => [c[0] + r * Math.cos((deg * Math.PI) / 180), c[1] + r * Math.sin((deg * Math.PI) / 180)];
      const a = labelAt(points, end(isNum(e.startDeg) ? e.startDeg : 0), eps * 2);
      const b = labelAt(points, end(isNum(e.endDeg) ? e.endDeg : 90), eps * 2);
      out.push({ index, kind: "arc", name: a && b ? `arc ${a}${b}` : "this arc", ticks, parallel: 0 });
    }
  });
  return out;
}

export interface MarksGrade {
  correct: boolean;
  /** element indices the marks say something about */
  expected: number[];
  missed: number[];
  extra: number[];
  /** what the marks say, in words: ["AD = AB", "DA ∥ CB"] */
  facts: string[];
}

/** Grade a "read the marks" selection against the spec's own marks. */
export function gradeMarks(
  spec: Record<string, unknown>,
  ask: "equal" | "parallel" | "both",
  selected: readonly number[]
): MarksGrade {
  const ms = markables(spec);
  const wants = (m: Markable) =>
    (ask !== "parallel" && m.ticks > 0) || (ask !== "equal" && m.parallel > 0);
  const expected = ms.filter(wants).map((m) => m.index);
  const sel = new Set(selected);
  const missed = expected.filter((i) => !sel.has(i));
  const extra = [...sel].filter((i) => !expected.includes(i));
  const facts: string[] = [];
  const group = (key: (m: Markable) => number, sign: string) => {
    const by = new Map<number, string[]>();
    for (const m of ms) if (key(m) > 0) by.set(key(m), [...(by.get(key(m)) ?? []), m.name]);
    for (const names of by.values()) if (names.length > 1) facts.push(names.join(sign));
  };
  if (ask !== "parallel") group((m) => m.ticks, " = ");
  if (ask !== "equal") group((m) => m.parallel, " ∥ ");
  return { correct: expected.length > 0 && missed.length === 0 && extra.length === 0, expected, missed, extra, facts };
}

/* ---------------- angles ---------------- */

/** ∠AVB in degrees, 0–180 */
export function angleAt(a: Pt, v: Pt, b: Pt): number {
  const u = [a[0] - v[0], a[1] - v[1]], w = [b[0] - v[0], b[1] - v[1]];
  const d = Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]);
  if (d === 0) return 0;
  const c = Math.max(-1, Math.min(1, (u[0] * w[0] + u[1] * w[1]) / d));
  return (Math.acos(c) * 180) / Math.PI;
}

/** which side of line XY the point p is on: +1 / −1 (0 on it) */
const side = (x: Pt, y: Pt, p: Pt) =>
  Math.sign((y[0] - x[0]) * (p[1] - x[1]) - (y[1] - x[1]) * (p[0] - x[0]));

const onCircle = (circle: { c: Pt; r: number }, p: Pt) =>
  Math.abs(Math.hypot(p[0] - circle.c[0], p[1] - circle.c[1]) - circle.r) <= circle.r * 0.06;

function drawn(spec: Record<string, unknown>, a: string, b: string): boolean {
  return markables(spec).some((m) => m.kind === "segment" && (m.name === a + b || m.name === b + a));
}

export interface AngleCandidate {
  vertex: string;
  /** "∠DCB" */
  name: string;
  equal: boolean;
}

/**
 * The drawn angles that stand on the same chord as `angle` ([X, V, Y]): at a
 * labelled point P on the circle with PX and PY both drawn. Equal exactly
 * when P is on the same side of XY as V (the lesson's theorem); on the other
 * side it is the supplement. Read from the coordinates, not from any label.
 */
export function equalAngleCandidates(
  spec: Record<string, unknown>,
  [x, v, y]: [string, string, string]
): AngleCandidate[] {
  const points = pointsOf(spec);
  const circle = circleOf(spec);
  const X = points.get(x), V = points.get(v), Y = points.get(y);
  if (!circle || !X || !V || !Y) return [];
  const sv = side(X, Y, V);
  const out: AngleCandidate[] = [];
  for (const [p, P] of points) {
    if (p === x || p === y || p === v || !onCircle(circle, P)) continue;
    if (!drawn(spec, p, x) || !drawn(spec, p, y)) continue;
    out.push({ vertex: p, name: `∠${x}${p}${y}`, equal: side(X, Y, P) === sv });
  }
  return out;
}

export interface EqualAngleGrade {
  correct: boolean;
  expected: string[];
  missed: string[];
  extra: string[];
}

export function gradeEqualAngle(cands: AngleCandidate[], tapped: readonly string[]): EqualAngleGrade {
  const expected = cands.filter((c) => c.equal).map((c) => c.vertex);
  const t = new Set(tapped);
  const missed = expected.filter((v) => !t.has(v));
  const extra = [...t].filter((v) => !expected.includes(v));
  return { correct: missed.length === 0 && extra.length === 0, expected, missed, extra };
}

/* ---------------- dragging ---------------- */

/** p projected onto the circle */
export function onto(circle: { c: Pt; r: number }, p: Pt): Pt {
  const dx = p[0] - circle.c[0], dy = p[1] - circle.c[1];
  const d = Math.hypot(dx, dy) || 1;
  return [circle.c[0] + (dx / d) * circle.r, circle.c[1] + (dy / d) * circle.r];
}

/**
 * The circle-drag question's key, computed: sample the arc the dragged point
 * starts on (the side of XY it is on) and see whether ∠XPY moves. Index of
 * the "stays the same" option (0) when the spread is under half a degree.
 */
export function circleDragKey(spec: Record<string, unknown>, it: Extract<FigureInteraction, { mode: "drag" }>): number | null {
  const points = pointsOf(spec);
  const circle = circleOf(spec);
  const [x, v, y] = it.angle;
  const X = points.get(x), V = points.get(v), Y = points.get(y);
  if (!circle || !X || !V || !Y) return null;
  const sv = side(X, Y, V);
  const seen: number[] = [];
  for (let k = 0; k < 360; k += 3) {
    const P: Pt = [circle.c[0] + circle.r * Math.cos((k * Math.PI) / 180), circle.c[1] + circle.r * Math.sin((k * Math.PI) / 180)];
    if (side(X, Y, P) !== sv || near(P, X, circle.r * 0.1) || near(P, Y, circle.r * 0.1)) continue;
    seen.push(angleAt(X, P, Y));
  }
  if (seen.length < 3) return null;
  return Math.max(...seen) - Math.min(...seen) < 0.5 ? 0 : 1;
}

/**
 * The spec with point `label` moved to `to`: every element that sat on the
 * point moves with it (segment ends, an angle's vertex), and the live angles
 * are redrawn at their vertices with their measured values as labels.
 */
export function withPointMoved(
  spec: Record<string, unknown>,
  label: string,
  to: Pt,
  live: [string, string, string][]
): Record<string, unknown> {
  const points = pointsOf(spec);
  const from = points.get(label);
  if (!from) return spec;
  const eps = scale(spec) * 0.02;
  const move = (p: unknown) => {
    const q = pt(p);
    return q && near(q, from, eps) ? to : p;
  };
  const moved = elementsOf(spec).map((e) => {
    if (e.type === "point" && e.label === label) return { ...e, x: to[0], y: to[1] };
    if (SEGMENT_TYPES.has(e.type)) return { ...e, from: move(e.from), to: move(e.to) };
    if (e.type === "polygon" && Array.isArray(e.points)) return { ...e, points: e.points.map(move) };
    if (e.type === "angle") return { ...e, at: move(e.at) };
    return e;
  });
  const now = new Map(points);
  now.set(label, to);
  const lastStep = Math.max(1, ...moved.map((e) => (isNum(e.step) ? e.step : 1)));
  const angles = live.flatMap(([x, v, y]) => {
    const X = now.get(x), V = now.get(v), Y = now.get(y);
    if (!X || !V || !Y) return [];
    const deg = (p: Pt) => (Math.atan2(p[1] - V[1], p[0] - V[0]) * 180) / Math.PI;
    let a0 = deg(X), a1 = deg(Y);
    // sweep the interior: anticlockwise from a0 to a1 under 180°
    if (((a1 - a0 + 360) % 360) > 180) [a0, a1] = [a1, a0];
    if (a1 < a0) a1 += 360;
    return [{ type: "angle", at: V, fromDeg: a0, toDeg: a1, label: `${Math.round(angleAt(X, V, Y))}°`, step: lastStep }];
  });
  // a live angle replaces whatever angle mark the figure had at that vertex
  const liveAt = live.map(([, v]) => now.get(v)).filter((p): p is Pt => !!p);
  const kept = moved.filter((e) => !(e.type === "angle" && liveAt.some((p) => { const q = pt(e.at); return q && near(q, p, eps); })));
  return { ...spec, elements: [...kept, ...angles] };
}

/* ---------------- the note for the tutor ---------------- */

export function interactionNote(figureId: string, what: string, correct: boolean, studentName?: string): string {
  const who = studentName || "The student";
  return `[figure ${figureId} — engagement, not an attempt] ${who} ${what} — ${correct ? "correct" : "not right yet"}.`;
}

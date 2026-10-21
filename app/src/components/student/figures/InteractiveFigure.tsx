"use client";

/**
 * A stored figure the student works with (prototype, proto/interactive-figures;
 * the rules and the grading live in lib/figure-interactions). The figure's
 * steps play in order, each in the widgets' own frame (WidgetShell):
 *
 *   marks        tap the sides or arcs the marks speak about, then Check
 *   equal_angle  tap the vertices of the angles equal to the one named
 *   drag         drag the point; the angles update live; then one question
 *
 * Every tap target also has a real button in a row under the figure, so the
 * step works without a pointer and "which line is this" never depends on
 * reading the picture.
 *
 * Engagement only: one note per finished step reaches the tutor, no attempt.
 */

import { useMemo, useState } from "react";
import { BUTTON_SECONDARY, BUTTON_TERTIARY, cx } from "@/components/sticker";
import { GeoSceneInteractive } from "@/components/viz/GeoScene";
import { WidgetShell, WIDGET_ACTIONS, type Verdict } from "@/components/student/widgets/WidgetShell";
import {
  circleDragKey,
  circleOf,
  equalAngleCandidates,
  gradeEqualAngle,
  gradeMarks,
  interactionNote,
  markables,
  onto,
  pointsOf,
  withPointMoved,
  angleAt,
  type FigureInteraction,
  type Pt,
} from "@/lib/figure-interactions";

export interface StoredFigure {
  id: string;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  sourcePage: number | null;
}

/** A toggle, as the widgets draw one (VennBuilder): picked = secondary, else tertiary. */
const CHIP = (on: boolean) => (on ? BUTTON_SECONDARY : BUTTON_TERTIARY);

export function InteractiveFigure({
  figure,
  steps,
  taskId,
  onNote,
  studentName,
}: {
  figure: StoredFigure;
  steps: readonly FigureInteraction[];
  /** the id the tutor pushed (`<figure>#<task>`), so its note names the task */
  taskId?: string;
  onNote?: (note: string) => void;
  studentName?: string;
}) {
  const [at, setAt] = useState(0);
  const step = steps[Math.min(at, steps.length - 1)];
  const next = at < steps.length - 1 ? () => setAt(at + 1) : undefined;
  const report = (what: string, ok: boolean) =>
    onNote?.(interactionNote(taskId ?? figure.id, what, ok, studentName?.trim() || undefined));
  const page = figure.sourcePage != null ? ` · book p.${figure.sourcePage}` : "";
  const of = steps.length > 1 ? ` · step ${at + 1} of ${steps.length}` : "";
  // The card is returned BARE: inside a lesson bubble the chat flattens whatever
  // sits directly in its interactive slot (globals.css, `.lesson-bubble
  // [data-chat-interactive] > *`). A wrapper would take that Honey fill itself
  // and leave the card's own frame showing inside it.
  const props = { figure, page, of, report, onNext: next };
  if (step.mode === "marks") return <MarksStep key={at} step={step} {...props} />;
  if (step.mode === "equal_angle") return <EqualAngleStep key={at} step={step} {...props} />;
  return <DragStep key={at} step={step} {...props} />;
}

type StepProps<M extends FigureInteraction["mode"]> = {
  figure: StoredFigure;
  step: Extract<FigureInteraction, { mode: M }>;
  page: string;
  /** " · step 1 of 2" when the figure has several steps */
  of: string;
  report: (what: string, ok: boolean) => void;
  onNext?: () => void;
};

function NextButton({ onNext, label = "Next" }: { onNext?: () => void; label?: string }) {
  if (!onNext) return null;
  return (
    <button type="button" onClick={onNext} className={cx(BUTTON_SECONDARY, "mt-2.5 ms-2")}>
      {label} →
    </button>
  );
}

/* ---------------- read the marks ---------------- */

function MarksStep({ figure, step, page, of, report, onNext }: StepProps<"marks">) {
  const items = useMemo(() => markables(figure.spec), [figure.spec]);
  const [sel, setSel] = useState<number[]>([]);
  const [graded, setGraded] = useState<ReturnType<typeof gradeMarks> | null>(null);
  const [tries, setTries] = useState(0);
  // the first miss gets a hint and a retry; the answer shows after the second
  const reveal = !!graded && (graded.correct || tries >= 2);
  const toggle = (i: number) => {
    if (graded) return;
    setSel((s) => (s.includes(i) ? s.filter((x) => x !== i) : [...s, i]));
  };
  const nameOf = (i: number) => items.find((m) => m.index === i)?.name ?? "?";
  const check = () => {
    const g = gradeMarks(figure.spec, step.ask, sel);
    const n = tries + 1;
    setGraded(g);
    setTries(n);
    // one note per step, when it is settled — a retry is not worth a tutor turn
    if (g.correct || n >= 2)
      report(`read the marks on try ${n}: tapped ${sel.map(nameOf).join(", ") || "nothing"} (the marks say ${g.facts.join("; ")})`, g.correct);
  };
  const tone: Record<string, "ok" | "miss" | "extra"> = {};
  if (graded) {
    for (const i of graded.expected) if (sel.includes(i) || reveal) tone[String(i)] = sel.includes(i) ? "ok" : "miss";
    for (const i of graded.extra) tone[String(i)] = "extra";
  }
  const verdict: Verdict = graded ? (graded.correct ? "correct" : "wrong") : null;
  const hint =
    step.ask === "parallel" ? "Look for the small arrows on the lines." : step.ask === "equal" ? "Look for the small dashes across the lines." : "Look for the small dashes and arrows on the lines.";
  return (
    <WidgetShell
      kind={`read the figure${page}`}
      hint={`tap the lines${of}`}
      prompt={step.prompt}
      verdict={verdict}
      feedback={graded ? (reveal ? `The marks say ${graded.facts.join(", and ")}.` : hint) : undefined}
      onReset={graded && !reveal ? () => { setGraded(null); setSel((s) => s.filter((i) => !graded.extra.includes(i))); } : undefined}
    >
      <GeoSceneInteractive
        spec={figure.spec}
        interact={{ tappable: items.map((m) => m.index), selected: sel, tone, onTap: toggle }}
      />
      <div className={WIDGET_ACTIONS}>
        {items.map((m) => (
          <button key={m.index} type="button" aria-pressed={sel.includes(m.index)}
            onClick={() => toggle(m.index)} className={CHIP(sel.includes(m.index))}>
            {m.name}
          </button>
        ))}
      </div>
      {!graded && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" disabled={sel.length === 0} onClick={check} className={BUTTON_SECONDARY}>
            Check
          </button>
        </div>
      )}
      {reveal && <NextButton onNext={onNext} />}
    </WidgetShell>
  );
}

/* ---------------- tap the equal angle ---------------- */

function EqualAngleStep({ figure, step, page, of, report, onNext }: StepProps<"equal_angle">) {
  const cands = useMemo(() => equalAngleCandidates(figure.spec, step.angle), [figure.spec, step.angle]);
  const [sel, setSel] = useState<string[]>([]);
  const [graded, setGraded] = useState<ReturnType<typeof gradeEqualAngle> | null>(null);
  const [tries, setTries] = useState(0);
  const reveal = !!graded && (graded.correct || tries >= 2);
  const toggle = (v: string) => {
    if (graded) return;
    setSel((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  };
  const [x, v, y] = step.angle;
  const named = (p: string) => `∠${x}${p}${y}`;
  // after the check, the equal angles are drawn with the book's equal-angle arcs
  const shown = useMemo(() => {
    if (!graded || !reveal) return figure.spec;
    const pts = pointsOf(figure.spec);
    const marks = [v, ...graded.expected].flatMap((p) => {
      const X = pts.get(x), V = pts.get(p), Y = pts.get(y);
      if (!X || !V || !Y) return [];
      const deg = (q: Pt) => (Math.atan2(q[1] - V[1], q[0] - V[0]) * 180) / Math.PI;
      let a0 = deg(X), a1 = deg(Y);
      if (((a1 - a0 + 360) % 360) > 180) [a0, a1] = [a1, a0];
      if (a1 < a0) a1 += 360;
      return [{ type: "angle", at: V, fromDeg: a0, toDeg: a1, arcs: 1, step: 99 }];
    });
    const els = Array.isArray(figure.spec.elements) ? figure.spec.elements : [];
    return { ...figure.spec, elements: [...els, ...marks] };
  }, [graded, reveal, figure.spec, x, v, y]);
  const check = () => {
    const g = gradeEqualAngle(cands, sel);
    const n = tries + 1;
    setGraded(g);
    setTries(n);
    if (g.correct || n >= 2) report(`on try ${n} tapped ${sel.map(named).join(", ") || "no angle"} as equal to ${named(v)}`, g.correct);
  };
  const tone: Record<string, "ok" | "miss" | "extra"> = {};
  if (graded) {
    for (const p of graded.expected) if (sel.includes(p) || reveal) tone[p] = sel.includes(p) ? "ok" : "miss";
    for (const p of graded.extra) tone[p] = "extra";
  }
  const verdict: Verdict = graded ? (graded.correct ? "correct" : "wrong") : null;
  const equalNames = graded ? graded.expected.map(named) : [];
  return (
    <WidgetShell
      kind={`read the figure${page}`}
      hint={`tap the vertices${of}`}
      prompt={step.prompt}
      verdict={verdict}
      feedback={
        graded
          ? reveal
            ? `${[named(v), ...equalNames].join(" = ")}: they all stand on the same arc ${x}${y}.`
            : `Look at which arc each angle stands on.`
          : undefined
      }
      onReset={graded && !reveal ? () => { setGraded(null); setSel((s) => s.filter((p) => !graded.extra.includes(p))); } : undefined}
    >
      <GeoSceneInteractive
        spec={shown}
        interact={{
          fitSpec: figure.spec,
          tappablePoints: cands.map((c) => c.vertex),
          selectedPoints: sel,
          tone,
          onTapPoint: toggle,
        }}
      />
      <div className={WIDGET_ACTIONS}>
        {cands.map((c) => (
          <button key={c.vertex} type="button" aria-pressed={sel.includes(c.vertex)}
            onClick={() => toggle(c.vertex)} className={CHIP(sel.includes(c.vertex))}>
            {c.name}
          </button>
        ))}
      </div>
      {!graded && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>
            Check
          </button>
        </div>
      )}
      {reveal && <NextButton onNext={onNext} label={graded?.correct ? "Next" : "See it move"} />}
    </WidgetShell>
  );
}

/* ---------------- drag to discover ---------------- */

function DragStep({ figure, step, page, of, report, onNext }: StepProps<"drag">) {
  const circle = useMemo(() => circleOf(figure.spec), [figure.spec]);
  const start = useMemo(() => pointsOf(figure.spec).get(step.point) ?? null, [figure.spec, step.point]);
  const [pos, setPos] = useState<Pt | null>(start);
  const [travel, setTravel] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const live = useMemo(() => [step.angle, ...(step.compare ?? [])], [step]);
  const key = step.along === "circle" ? circleDragKey(figure.spec, step) : (step.key ?? null);

  const spec = useMemo(
    () => (pos ? withPointMoved(figure.spec, step.point, pos, live) : figure.spec),
    [figure.spec, step.point, pos, live]
  );
  const pts = pointsOf(spec);
  const readout = live
    .map(([x, v, y]) => {
      const X = pts.get(x), V = pts.get(v), Y = pts.get(y);
      return X && V && Y ? `∠${x}${v}${y} = ${Math.round(angleAt(X, V, Y))}°` : null;
    })
    .filter(Boolean)
    .join("   ");

  const onDrag = (p: Pt) => {
    let q: Pt = step.along === "circle" && circle ? onto(circle, p) : p;
    // never onto the chord's own ends, where the angle is undefined
    const [x, , y] = step.angle;
    const ends = [pointsOf(figure.spec).get(x), pointsOf(figure.spec).get(y)].filter((e): e is Pt => !!e);
    const r = circle?.r ?? 3;
    if (ends.some((e) => Math.hypot(e[0] - q[0], e[1] - q[1]) < r * 0.12)) return;
    if (step.along === "free" && circle) {
      // keep a free point inside the frame the figure was fitted to
      const d = Math.hypot(q[0] - circle.c[0], q[1] - circle.c[1]);
      // the frame is fitted to the figure with ~16% padding: past 1.2 r the point leaves the picture
      const R = circle.r * 1.2;
      if (d > R) q = [circle.c[0] + ((q[0] - circle.c[0]) / d) * R, circle.c[1] + ((q[1] - circle.c[1]) / d) * R];
    }
    if (pos) setTravel((t) => t + Math.hypot(q[0] - pos[0], q[1] - pos[1]));
    setPos(q);
  };

  // which way to show the point moving: along the circle, staying on its own arc (the side of the chord it starts on)
  const hintArc = useMemo(() => {
    if (step.along !== "circle" || !circle || !start) return undefined;
    const a = (Math.atan2(start[1] - circle.c[1], start[0] - circle.c[0]) * 180) / Math.PI;
    const pts = pointsOf(figure.spec);
    const X = pts.get(step.angle[0]), Y = pts.get(step.angle[2]);
    const side = (q: Pt) => (X && Y ? Math.sign((Y[0] - X[0]) * (q[1] - X[1]) - (Y[1] - X[1]) * (q[0] - X[0])) : 1);
    const at = (deg: number): Pt => [circle.c[0] + circle.r * Math.cos((deg * Math.PI) / 180), circle.c[1] + circle.r * Math.sin((deg * Math.PI) / 180)];
    // head for the middle of the point's own arc: the point of the circle farthest from the chord, on its side
    let mid = a;
    for (let k = 0, far = -1; k < 360; k += 2) {
      const q = at(k);
      const d = X && Y ? Math.abs((Y[0] - X[0]) * (q[1] - X[1]) - (Y[1] - X[1]) * (q[0] - X[0])) : 0;
      if (side(q) === side(start) && d > far) { far = d; mid = k; }
    }
    const diff = ((mid - a + 540) % 360) - 180;
    const dir = diff >= 0 ? 1 : -1;
    // drawn just outside the circle, so it is not lost on the circle's own line
    return { c: circle.c, r: circle.r * 1.12, fromDeg: a + dir * 8, toDeg: a + dir * 38 };
  }, [step.along, step.angle, circle, start, figure.spec]);
  const enough = travel > (circle?.r ?? 3) * 0.8;
  const answered = picked !== null;
  const ok = answered && key !== null && picked === key;
  const verdict: Verdict = answered ? (ok ? "correct" : "wrong") : null;
  const choose = (i: number) => {
    if (answered) return;
    setPicked(i);
    report(`dragged ${step.point}, then answered "${step.options[i]}" to "${step.question}"`, key !== null && i === key);
  };
  return (
    <WidgetShell
      kind={`explore the figure${page}`}
      hint={`drag ${step.point}${of}`}
      prompt={step.prompt}
      verdict={verdict}
      feedback={answered && key !== null ? step.options[key] + "." : undefined}
      onReset={answered && !ok ? () => setPicked(null) : undefined}
      footer={readout}
    >
      <GeoSceneInteractive
        spec={spec}
        interact={{ fitSpec: figure.spec, drag: { label: step.point, onDrag, hint: travel === 0 ? { arc: hintArc } : undefined } }}
      />
      {/* the same move without a pointer: a step along the circle, or a nudge */}
      <div className={WIDGET_ACTIONS}>
        {(step.along === "circle"
          ? ([["◀ move", -8], ["move ▶", 8]] as const)
          : ([["↑", 0], ["↓", 1], ["←", 2], ["→", 3]] as const)
        ).map(([label, k]) => (
          <button key={label} type="button" className={BUTTON_TERTIARY} aria-label={`move ${step.point} ${label}`}
            onClick={() => {
              if (!pos) return;
              if (step.along === "circle" && circle) {
                const a = Math.atan2(pos[1] - circle.c[1], pos[0] - circle.c[0]) + (k * Math.PI) / 180;
                onDrag([circle.c[0] + circle.r * Math.cos(a), circle.c[1] + circle.r * Math.sin(a)]);
              } else {
                const d = (circle?.r ?? 3) * 0.1;
                const [dx, dy] = [[0, d], [0, -d], [-d, 0], [d, 0]][k];
                onDrag([pos[0] + dx, pos[1] + dy]);
              }
            }}>
            {label}
          </button>
        ))}
      </div>
      {enough ? (
        <div className="mt-2.5">
          <p className="text-center text-[13px] font-semibold text-ink">{step.question}</p>
          <div className={WIDGET_ACTIONS}>
            {step.options.map((o, i) => (
              <button key={o} type="button" aria-pressed={picked === i} onClick={() => choose(i)}
                className={CHIP(picked === i)}>
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-center font-mono text-[10.5px] text-[color:var(--play-text-muted)]">
          drag {step.point} to move it
        </p>
      )}
      {ok && <NextButton onNext={onNext} />}
    </WidgetShell>
  );
}

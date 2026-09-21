"use client";

/**
 * Dispatch for the MATHEMATICS drawing widgets: parsed payload → component.
 *
 * The social-studies and Arabic widgets each grew a branch inside
 * LessonSession's renderWidget, and at two maths widgets that was fine. At
 * eleven it would be hundreds of lines of payload checking in the middle of a
 * session component — so this file is to the maths widgets what
 * render-viz-widget is to the figure directives.
 *
 * All the judgement lives next door in lib/widget-payloads.ts, which has no
 * React in it and is tested directly. What is left here is a switch: by the
 * time a payload reaches it, every field is the right type and every target is
 * known to be reachable on the instrument. A payload that failed validation
 * arrives as null and renders nothing at all, which is the correct failure —
 * the lesson keeps its text and loses a beat, rather than showing a student a
 * widget that will mark their right answer wrong.
 */

import type { ReactNode } from "react";
import { parseMathWidget } from "@/lib/widget-payloads";
import type { WidgetOutcome } from "@/lib/widget-predicates";
import { PairPlotter } from "./PairPlotter";
import { ProductBuilder } from "./ProductBuilder";
import { LineDrawer } from "./LineDrawer";
import { CircleBuilder } from "./CircleBuilder";
import { AngleSetter } from "./AngleSetter";
import { TriangleRatio } from "./TriangleRatio";
import { BarBuilder } from "./BarBuilder";
import { NumberLineMarker } from "./NumberLineMarker";
import { RatioBalance } from "./RatioBalance";
import { SampleSpace } from "./SampleSpace";
import { CurveSketcher } from "./CurveSketcher";

export { MATH_WIDGETS } from "@/lib/widget-payloads";

export function renderMathWidget(
  name: string,
  props: Record<string, unknown>,
  // Widgets report a STRUCTURED outcome now, not prose (ADR-0009): a predicate
  // the server maps to a misconception, plus the words for the tutor stream.
  onOutcome: (outcome: WidgetOutcome) => void,
  opts: {
    hostShowsPrompt?: boolean;
    /**
     * The signed-in student's display name, narrated into the [live event]
     * line every widget builds for the tutor stream (FR-2602). The retired
     * "Omar" demo persona (ADR-0010, plan A10) is gone, so a caller with no
     * real student (dev fixtures, admin replay) gets a name-free "the
     * student" rather than that literal — never a fresh guess per widget.
     */
    studentName?: string;
    /**
     * The lower-case third-person pronoun for the ONE widget (pair_plotter)
     * that narrates a pronoun, already resolved from `lib/address.ts`
     * (FR-2605). Falls back to singular "they" — never the masculine.
     */
    pronoun?: string;
  } = {}
): ReactNode | null {
  const parsed = parseMathWidget(name, props);
  if (!parsed) return null;
  // Blanked AFTER validation, never before: validation is what supplies the
  // generic default, so suppressing any earlier cannot work.
  const w = opts.hostShowsPrompt ? { ...parsed, prompt: "" } : parsed;
  const studentName = opts.studentName;
  const pronoun = opts.pronoun;

  switch (w.name) {
    case "pair_plotter":
      return (
        <PairPlotter
          prompt={w.prompt} target={w.target}
          studentName={studentName} pronoun={pronoun} onResult={onOutcome}
        />
      );

    case "product_builder":
      return (
        <ProductBuilder
          prompt={w.prompt} X={w.X} Y={w.Y} studentName={studentName} onResult={onOutcome}
        />
      );

    case "line_drawer":
      return w.mode === "points" ? (
        <LineDrawer
          prompt={w.prompt} mode="points" through={w.through}
          studentName={studentName} onResult={onOutcome}
        />
      ) : (
        <LineDrawer
          prompt={w.prompt} mode="equation" m={w.m} b={w.b}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "circle_builder":
      return (
        <CircleBuilder
          prompt={w.prompt} element={w.element} studentName={studentName} onResult={onOutcome}
        />
      );

    case "angle_setter":
      return (
        <AngleSetter
          prompt={w.prompt} ask={w.ask} target={w.target}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "triangle_ratio":
      return (
        <TriangleRatio
          prompt={w.prompt} ask={w.ask} target={w.target}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "bar_builder":
      return (
        <BarBuilder
          prompt={w.prompt} ask={w.ask} target={w.target} n={w.n}
          labels={w.labels} studentName={studentName} onResult={onOutcome}
        />
      );

    case "number_line_marker":
      return w.mode === "points" ? (
        <NumberLineMarker
          prompt={w.prompt} mode="points" range={w.range}
          targets={w.targets} studentName={studentName} onResult={onOutcome}
        />
      ) : (
        <NumberLineMarker
          prompt={w.prompt} mode="interval" range={w.range}
          from={w.from} to={w.to} openFrom={w.openFrom} openTo={w.openTo}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "ratio_balance":
      return (
        <RatioBalance
          prompt={w.prompt} mode={w.mode} a={w.a} b={w.b} c={w.c}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "sample_space":
      return (
        <SampleSpace
          prompt={w.prompt} rows={w.rows} cols={w.cols} rule={w.rule}
          studentName={studentName} onResult={onOutcome}
        />
      );

    case "curve_sketcher":
      return (
        <CurveSketcher
          prompt={w.prompt} fn={w.fn} coefs={w.coefs}
          studentName={studentName} onResult={onOutcome}
        />
      );
  }
}

/**
 * The same dispatch as a COMPONENT.
 *
 * `renderMathWidget` is a function that returns an element, which is fine
 * inside another renderer's switch but not fine called straight from a
 * component body — React (and the lint rule that guards it) treats a function
 * creating elements during render as a component created during render, and
 * such a thing loses its state on every parent re-render. A widget losing its
 * state mid-drag is exactly the bug this would cause.
 *
 * So surfaces that render ONE widget from a payload use this instead.
 */
export function MathWidget({
  name,
  payload,
  onOutcome,
  fallback = null,
  hostShowsPrompt = false,
  readOnly = false,
  studentName,
  pronoun,
}: {
  name: string;
  payload: Record<string, unknown>;
  onOutcome: (outcome: WidgetOutcome) => void;
  fallback?: ReactNode;
  /** See `renderMathWidget`'s `opts.studentName` — same FR-2602 seam. */
  studentName?: string;
  /** See `renderMathWidget`'s `opts.pronoun` — same FR-2605 seam. */
  pronoun?: string;
  /**
   * **Additive, and for the console's replay only** (ADR-0015 §3, FR-2305).
   *
   * A replay shows the construction the student was given, with the student's
   * own widget, and must not be answerable: an operator dragging a handle in a
   * transcript would produce an outcome indistinguishable from the child's.
   *
   * It is enforced by a wrapper rather than by a prop threaded through eleven
   * widgets. Every one of them owns its own pointer handling — drag, keyboard,
   * click — and a `disabled` prop on each is eleven chances to miss one, with
   * the miss only discoverable by an operator accidentally answering a
   * question. `pointer-events: none` on the wrapper means no event reaches any
   * of them, `inert` takes the subtree out of the keyboard order and the
   * accessibility tree, and the outcome callback is swallowed as a third line
   * of defence. Nothing about the student's path changes: the default is false
   * and the wrapper does not exist unless it is asked for.
   */
  readOnly?: boolean;
  /**
   * The surface around the widget has ALREADY shown the question, so the
   * widget must not repeat it.
   *
   * This cannot be expressed by passing an empty prompt: validation treats a
   * blank string as "absent" and substitutes the kind's generic default, so
   * `prompt: ""` yields "Construct a radius" — a shortened duplicate of the
   * stem rather than the raw one. Silence has to be asked for explicitly,
   * because "" already means something else in that layer.
   */
  hostShowsPrompt?: boolean;
}) {
  const node = renderMathWidget(
    name,
    payload,
    // Swallowed rather than forwarded: a widget that somehow reported an
    // outcome from a replay must not reach a handler that could record one.
    readOnly ? NO_OUTCOME : onOutcome,
    { hostShowsPrompt, studentName, pronoun }
  );
  const body = node ?? fallback;
  if (!readOnly) return <>{body}</>;
  return (
    <div
      inert
      aria-label="a read-only reconstruction of an interactive widget"
      className="pointer-events-none select-none"
    >
      {body}
    </div>
  );
}

/** The read-only sink. Named so a stack trace says why nothing happened. */
function NO_OUTCOME(): void {}

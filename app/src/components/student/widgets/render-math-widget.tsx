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
  opts: { hostShowsPrompt?: boolean } = {}
): ReactNode | null {
  const parsed = parseMathWidget(name, props);
  if (!parsed) return null;
  // Blanked AFTER validation, never before: validation is what supplies the
  // generic default, so suppressing any earlier cannot work.
  const w = opts.hostShowsPrompt ? { ...parsed, prompt: "" } : parsed;

  switch (w.name) {
    case "pair_plotter":
      return <PairPlotter prompt={w.prompt} target={w.target} onResult={onOutcome} />;

    case "product_builder":
      return <ProductBuilder prompt={w.prompt} X={w.X} Y={w.Y} onResult={onOutcome} />;

    case "line_drawer":
      return w.mode === "points" ? (
        <LineDrawer prompt={w.prompt} mode="points" through={w.through} onResult={onOutcome} />
      ) : (
        <LineDrawer prompt={w.prompt} mode="equation" m={w.m} b={w.b} onResult={onOutcome} />
      );

    case "circle_builder":
      return <CircleBuilder prompt={w.prompt} element={w.element} onResult={onOutcome} />;

    case "angle_setter":
      return <AngleSetter prompt={w.prompt} ask={w.ask} target={w.target} onResult={onOutcome} />;

    case "triangle_ratio":
      return <TriangleRatio prompt={w.prompt} ask={w.ask} target={w.target} onResult={onOutcome} />;

    case "bar_builder":
      return (
        <BarBuilder
          prompt={w.prompt} ask={w.ask} target={w.target} n={w.n}
          labels={w.labels} onResult={onOutcome}
        />
      );

    case "number_line_marker":
      return w.mode === "points" ? (
        <NumberLineMarker
          prompt={w.prompt} mode="points" range={w.range}
          targets={w.targets} onResult={onOutcome}
        />
      ) : (
        <NumberLineMarker
          prompt={w.prompt} mode="interval" range={w.range}
          from={w.from} to={w.to} openFrom={w.openFrom} openTo={w.openTo}
          onResult={onOutcome}
        />
      );

    case "ratio_balance":
      return (
        <RatioBalance
          prompt={w.prompt} mode={w.mode} a={w.a} b={w.b} c={w.c} onResult={onOutcome}
        />
      );

    case "sample_space":
      return (
        <SampleSpace
          prompt={w.prompt} rows={w.rows} cols={w.cols} rule={w.rule} onResult={onOutcome}
        />
      );

    case "curve_sketcher":
      return <CurveSketcher prompt={w.prompt} fn={w.fn} coefs={w.coefs} onResult={onOutcome} />;
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
}: {
  name: string;
  payload: Record<string, unknown>;
  onOutcome: (outcome: WidgetOutcome) => void;
  fallback?: ReactNode;
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
  const node = renderMathWidget(name, payload, onOutcome, { hostShowsPrompt });
  return <>{node ?? fallback}</>;
}

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
  emitNote: (note: string) => void
): ReactNode | null {
  const w = parseMathWidget(name, props);
  if (!w) return null;

  switch (w.name) {
    case "pair_plotter":
      return <PairPlotter prompt={w.prompt} target={w.target} onResult={emitNote} />;

    case "product_builder":
      return <ProductBuilder prompt={w.prompt} X={w.X} Y={w.Y} onResult={emitNote} />;

    case "line_drawer":
      return w.mode === "points" ? (
        <LineDrawer prompt={w.prompt} mode="points" through={w.through} onResult={emitNote} />
      ) : (
        <LineDrawer prompt={w.prompt} mode="equation" m={w.m} b={w.b} onResult={emitNote} />
      );

    case "circle_builder":
      return <CircleBuilder prompt={w.prompt} element={w.element} onResult={emitNote} />;

    case "angle_setter":
      return <AngleSetter prompt={w.prompt} ask={w.ask} target={w.target} onResult={emitNote} />;

    case "triangle_ratio":
      return <TriangleRatio prompt={w.prompt} ask={w.ask} target={w.target} onResult={emitNote} />;

    case "bar_builder":
      return (
        <BarBuilder
          prompt={w.prompt} ask={w.ask} target={w.target} n={w.n}
          labels={w.labels} onResult={emitNote}
        />
      );

    case "number_line_marker":
      return w.mode === "points" ? (
        <NumberLineMarker
          prompt={w.prompt} mode="points" range={w.range}
          targets={w.targets} onResult={emitNote}
        />
      ) : (
        <NumberLineMarker
          prompt={w.prompt} mode="interval" range={w.range}
          from={w.from} to={w.to} openFrom={w.openFrom} openTo={w.openTo}
          onResult={emitNote}
        />
      );

    case "ratio_balance":
      return (
        <RatioBalance
          prompt={w.prompt} mode={w.mode} a={w.a} b={w.b} c={w.c} onResult={emitNote}
        />
      );

    case "sample_space":
      return (
        <SampleSpace
          prompt={w.prompt} rows={w.rows} cols={w.cols} rule={w.rule} onResult={emitNote}
        />
      );

    case "curve_sketcher":
      return <CurveSketcher prompt={w.prompt} fn={w.fn} coefs={w.coefs} onResult={emitNote} />;
  }
}

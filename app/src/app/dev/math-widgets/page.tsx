"use client";

/**
 * DEV HARNESS — every mathematics widget, on one page, with the exact payload
 * that produced it printed beside it.
 *
 * Two jobs. It is how a widget gets REVIEWED: the human gate that governs
 * generated content (constitution III, ADR-0008) needs a surface where the
 * reviewer can try a widget rather than read its source, and "drag it and see
 * whether the mathematics holds" is not a code review. And it is how the
 * dispatcher gets exercised without spending an AI turn — each card runs the
 * real validate-then-render path, so a payload that would silently vanish
 * mid-lesson visibly fails here instead.
 *
 * The notes the widgets emit are shown as they arrive. Those strings are what
 * the tutor actually sees when a student finishes a widget, which makes this
 * also the only place to check that a wrong answer reports a DIAGNOSIS rather
 * than a score.
 *
 * Not linked from anywhere; static route, no data access.
 */

import { useState } from "react";
import { renderMathWidget } from "@/components/student/widgets/render-math-widget";
import { mathWidgetsFor } from "@/lib/widget-docs";

interface Case {
  unit: string;
  module: string;
  name: string;
  props: Record<string, unknown>;
  teaches: string;
}

const CASES: Case[] = [
  {
    unit: "u1", module: "Unit 1 — Relations and Functions",
    name: "product_builder",
    props: { X: [1, 2], Y: [3, 4, 5], prompt: "Tap all the pairs of X × Y" },
    teaches: "the Cartesian product as something you assemble, not a formula",
  },
  {
    unit: "u1", module: "Unit 1 — Relations and Functions",
    name: "curve_sketcher",
    props: { prompt: "Sketch y = x² − 4", fn: "quadratic", coefs: [1, 0, -4] },
    teaches: "freehand sketching — a stroke that doubles back is rejected for failing the vertical line test",
  },
  {
    unit: "u2", module: "Unit 2 — Ratio, Proportion, Variation",
    name: "ratio_balance",
    props: { prompt: "3 : 4 = 9 : ?", mode: "direct", a: 3, b: 4, c: 9 },
    teaches: "direct variation — the two QUOTIENTS must match",
  },
  {
    unit: "u2", module: "Unit 2 — Ratio, Proportion, Variation",
    name: "ratio_balance",
    props: { prompt: "6 workers take 10 days. 4 workers take how many?", mode: "inverse", a: 6, b: 10, c: 4 },
    teaches: "inverse variation — same gesture, but now the PRODUCTS must match",
  },
  {
    unit: "u3", module: "Unit 3 — Statistics",
    name: "bar_builder",
    props: { prompt: "Build five values with a mean of 6", ask: "mean", target: 6, n: 5 },
    teaches: "the book's question backwards: many sets have a mean of 6",
  },
  {
    unit: "u3", module: "Unit 3 — Statistics",
    name: "bar_builder",
    props: { prompt: "Now build five values with a median of 6", ask: "median", target: 6, n: 5 },
    teaches: "the median does not care about the total, and the mean does",
  },
  {
    unit: "u4", module: "Unit 4 — Trigonometry",
    name: "triangle_ratio",
    props: { prompt: "Drag the triangle until sin θ = 3/5", ask: "sin", target: 0.6 },
    teaches: "similarity — 3-4-5 and 6-8-10 give the same ratio and both are accepted",
  },
  {
    unit: "u5", module: "Unit 5 — Coordinate Geometry",
    name: "line_drawer",
    props: { prompt: "Draw the line y = 2x − 1", mode: "equation", m: 2, b: -1 },
    teaches: "graded on the LINE, so any two points on it are correct",
  },
  {
    unit: "u5", module: "Unit 5 — Coordinate Geometry",
    name: "pair_plotter",
    props: { prompt: "Plot the point (3, 2)", target: [3, 2] },
    teaches: "the original tap widget, now on the shared interaction layer",
  },
  {
    unit: "geo1", module: "Unit 4 — The Circle",
    name: "circle_builder",
    props: { prompt: "Draw a chord of circle M", element: "chord" },
    teaches: "sixty-six correct answers, all accepted — the property is graded, not a position",
  },
  {
    unit: "geo1", module: "Unit 4 — The Circle",
    name: "circle_builder",
    props: { prompt: "Now draw a tangent to circle M", element: "tangent" },
    teaches: "distance from the centre must equal the radius; a secant is named as a secant",
  },
  {
    unit: "geo2", module: "Term 2 · Unit 5 — Angles and Arcs",
    name: "angle_setter",
    props: { prompt: "Make the inscribed angle at C equal 35°", ask: "inscribed", target: 35 },
    teaches: "the inscribed-angle theorem: drag C and watch the angle refuse to change",
  },
  {
    unit: "t2u1", module: "Term 2 · Unit 1 — Equations",
    name: "number_line_marker",
    props: { prompt: "Show x > 2", mode: "interval", range: [-6, 6], from: 2, to: 6, openFrom: true, openTo: true },
    teaches: "the hollow circle is a control, because > and ≥ differ by nothing else",
  },
  {
    unit: "t2u2", module: "Term 2 · Unit 2 — Fractional Functions",
    name: "number_line_marker",
    props: { prompt: "Mark the values x cannot take in 1/((x+2)(x−3))", mode: "points", range: [-6, 6], targets: [-2, 3] },
    teaches: "excluded values as a SET, graded as one",
  },
  {
    unit: "t2u3", module: "Term 2 · Unit 3 — Probability",
    name: "sample_space",
    props: { prompt: "Tap every outcome where the two dice total 7", rows: 6, cols: 6, rule: { kind: "sum", op: "eq", value: 7 } },
    teaches: "n(E)/n(S) assembling under your finger; the app derives the event, not the model",
  },
];

/** Payloads that MUST refuse to render — the guard, made visible. */
const REJECTS: { name: string; props: Record<string, unknown>; why: string }[] = [
  { name: "pair_plotter", props: { target: ["3", "2"] }, why: "coordinates arrived as strings" },
  { name: "angle_setter", props: { ask: "central", target: 37 }, why: "37° is off the 5° snap — unreachable" },
  { name: "ratio_balance", props: { mode: "direct", a: 3, b: 4, c: 10 }, why: "fourth term would be 40/3" },
  { name: "triangle_ratio", props: { ask: "sin", target: 1 }, why: "a leg cannot equal the hypotenuse" },
  { name: "curve_sketcher", props: { fn: "quadratic", coefs: [0, 2, 1] }, why: "a = 0 is a line, not a parabola" },
];

export default function MathWidgetsFixture() {
  const [notes, setNotes] = useState<{ at: string; note: string }[]>([]);

  return (
    <main className="min-h-screen bg-paper px-4 py-8 text-ink" data-ds="nour">
      <div className="mx-auto max-w-[1180px]">
        <header className="mb-7 border-b border-line pb-5">
          <h1 className="font-display text-[26px] font-bold">Mathematics widgets</h1>
          <p className="mt-1.5 max-w-[68ch] text-[14px] leading-relaxed text-ink-soft">
            Every interactive widget the tutor can emit, with the payload that produced it.
            Each card runs the real validate-then-render path, so what you see here is what a
            student sees. Try them: the note each one sends back to the tutor appears in the
            panel at the bottom, and a wrong answer should come back with a diagnosis rather
            than a score.
          </p>
          <p className="mt-2 font-mono text-[11px] text-ink-faint">
            {CASES.length} cases · {new Set(CASES.map((c) => c.name)).size} distinct widgets ·{" "}
            {new Set(CASES.map((c) => c.unit)).size} of 10 units
          </p>
        </header>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {CASES.map((c, i) => (
            <section
              key={i}
              // Addressable so a browser test can drive a specific card; the
              // widgets are only real if a pointer can actually grade them.
              data-widget={c.name}
              data-case={i}
              className="rounded-xl border border-line bg-card-warm p-3.5"
            >
              <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-deep">
                  {c.name}
                </span>
                <span className="font-mono text-[10px] text-ink-faint">{c.module}</span>
              </div>
              <p className="mb-2 text-[12.5px] italic leading-snug text-ink-soft">{c.teaches}</p>

              {renderMathWidget(c.name, c.props, (note) =>
                setNotes((n) => [{ at: c.name, note }, ...n].slice(0, 24))
              ) ?? (
                <p className="rounded-md border border-gold/50 bg-gold-wash px-3 py-2 text-[12.5px] text-gold">
                  This payload did not validate — nothing rendered.
                </p>
              )}

              <pre className="mt-2 overflow-x-auto rounded-md bg-paper-deep px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink-faint">
                {`{{widget:${c.name}:${JSON.stringify(c.props)}}}`}
              </pre>
            </section>
          ))}
        </div>

        <section className="mt-9 rounded-xl border border-line bg-card p-4">
          <h2 className="font-display text-[17px] font-semibold">The guard, on purpose</h2>
          <p className="mt-1 max-w-[70ch] text-[13px] leading-relaxed text-ink-soft">
            Each payload below is well-formed JSON that a model could plausibly emit and that
            asks for something a student could never answer. Every one must render nothing —
            a widget with an unreachable target marks a correct answer wrong, which is worse
            than a missing widget.
          </p>
          <ul className="mt-3 grid gap-2">
            {REJECTS.map((r, i) => {
              const rendered = renderMathWidget(r.name, r.props, () => {});
              return (
                <li
                  key={i}
                  className={`rounded-md border px-3 py-2 text-[12.5px] ${
                    rendered
                      ? "border-gold bg-gold-wash text-gold"
                      : "border-line bg-card-warm text-ink-soft"
                  }`}
                >
                  <span className="font-mono text-[11px] text-ink">{r.name}</span>{" "}
                  <span className="font-mono text-[10.5px] text-ink-faint">
                    {JSON.stringify(r.props)}
                  </span>
                  <br />
                  {rendered ? "✗ RENDERED — the guard is not holding" : `✓ refused — ${r.why}`}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="mt-6 rounded-xl border border-line bg-card p-4">
          <h2 className="font-display text-[17px] font-semibold">
            What the tutor receives
          </h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            Finish a widget above and its note lands here — these strings are the tutor&apos;s
            whole view of what the student just did.
          </p>
          {notes.length === 0 ? (
            <p className="mt-3 font-mono text-[11.5px] text-ink-faint">
              nothing yet — answer a widget above
            </p>
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {notes.map((n, i) => (
                <li key={i} className="rounded-md bg-paper-deep px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink">
                  <span className="text-ink-faint">[{n.at}]</span> {n.note}
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-8 border-t border-line pt-4 font-mono text-[10.5px] leading-relaxed text-ink-faint">
          Per-unit documentation given to the tutor:{" "}
          {["u1", "u2", "u3", "u4", "u5", "geo1", "geo2", "t2u1", "t2u2", "t2u3"]
            .map((u) => `${u} → ${mathWidgetsFor(`${u}-1`).join(", ")}`)
            .join("  ·  ")}
        </footer>
      </div>
    </main>
  );
}

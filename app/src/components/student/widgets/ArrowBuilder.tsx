"use client";

/**
 * {{widget:arrow_builder:{"prompt":"a R b means b = 2a + 4. Draw R as an arrow diagram.","X":[-1,1,2],"Y":[2,4,6,8],"pairs":[[-1,2],[1,6],[2,8]]}}}
 *
 * The student DRAWS a relation as an arrow diagram (Tamer 2026-10-21; a new
 * kind, Samuel's to accept — decision 11): tap an element of X, then where it
 * goes in Y. The arrows are graded as a set against the relation's `pairs`
 * (arrow-builder-grade.ts), and the result shows on the student's own drawing:
 * right arrows kept, wrong ones grey and dashed, missed ones drawn in.
 *
 * The stem gives the relation — by its rule or as its pairs; the board never
 * shows the answer. X and Y are numbers or short words (the book's relations
 * pair students with books as often as numbers with numbers); a relation ON a
 * set is X = Y, and only then can an arrow be drawn the wrong way round.
 */

import { useMemo, useRef, useState } from "react";
import { BUTTON_SECONDARY, BUTTON_TERTIARY } from "@/components/sticker";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { WidgetShell, WIDGET_ACTIONS, type Verdict } from "./WidgetShell";
import { ArrowBoard, type IArrow } from "./ArrowBoard";
import { gradeArrows, type Arrow } from "./arrow-builder-grade";

export function ArrowBuilder({
  prompt,
  X,
  Y,
  pairs,
  studentName,
  onResult,
}: {
  prompt: string;
  X: (number | string)[];
  Y: (number | string)[];
  pairs: [number | string, number | string][];
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const xs = useMemo(() => X.map(String), [X]);
  const ys = useMemo(() => Y.map(String), [Y]);
  const want = useMemo(() => pairs.map(([a, b]) => [String(a), String(b)] as Arrow), [pairs]);
  const onSet = xs.join("\u0000") === ys.join("\u0000");
  const [drawn, setDrawn] = useState<IArrow[]>([]);
  const [graded, setGraded] = useState<{ extra: IArrow[]; missed: IArrow[]; ok: boolean; predicate: string } | null>(null);
  const fired = useRef(false);

  const named = (a: IArrow): Arrow => [xs[a[0]], ys[a[1]]];
  const indexed = (a: Arrow): IArrow => [xs.indexOf(a[0]), ys.indexOf(a[1])];
  const text = (a: Arrow) => `${a[0]}→${a[1]}`;

  const toggle = (a: IArrow) =>
    setDrawn((d) => (d.some((b) => b[0] === a[0] && b[1] === a[1]) ? d.filter((b) => b[0] !== a[0] || b[1] !== a[1]) : [...d, a]));

  const check = () => {
    if (fired.current || drawn.length === 0) return;
    fired.current = true;
    const g = gradeArrows(drawn.map(named), want);
    setGraded({ ok: g.ok, predicate: g.predicate, extra: g.extra.map(indexed), missed: g.missed.map(indexed) });
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: drawn.map((a) => text(named(a))).join(" "),
      detail: g.ok
        ? `✓ ${who} drew the arrow diagram correctly: ${want.map(text).join(", ")}`
        : `✗ ${who} drew ${drawn.map((a) => text(named(a))).join(", ")} for ${want.map(text).join(", ")} on the arrow builder — ${
            g.predicate === "arrows-reversed" ? "arrows drawn the wrong way round (from the second element to the first)"
            : g.predicate === "extra-arrows" ? `${g.extra.map(text).join(", ")} ${g.extra.length === 1 ? "is" : "are"} not in the relation`
            : `missed ${g.missed.map(text).join(", ")}`}`,
    });
  };

  const verdict: Verdict = graded ? (graded.ok ? "correct" : graded.extra.length < drawn.length ? "partial" : "wrong") : null;
  const feedback = !graded
    ? undefined
    : graded.ok
      ? `All ${want.length} arrows, none extra.`
      : `${drawn.length - graded.extra.length} of ${want.length} right.${
          graded.missed.length ? ` Drawing in the ones missed: ${graded.missed.map((a) => text(named(a))).join(", ")}.` : ""
        }${graded.predicate === "arrows-reversed" ? " An arrow runs from the first element of a pair to the second." : ""}`;

  return (
    <WidgetShell kind="arrow builder" hint="tap X, then Y" prompt={prompt} verdict={verdict} feedback={feedback}>
      <ArrowBoard X={xs} Y={ys} drawn={drawn} onToggle={graded ? undefined : toggle}
        graded={graded} reveal={!!graded} yName={onSet ? "X" : "Y"} />
      {graded ? (
        <p className="mt-1 text-center font-mono text-[10.5px] font-medium text-[color:var(--play-text-muted)]">
          solid = right · dashed grey = not in the relation · drawing in = the ones missed
        </p>
      ) : (
        <div className={WIDGET_ACTIONS}>
          <button type="button" disabled={drawn.length === 0} onClick={check} className={BUTTON_SECONDARY}>
            Check my arrows
          </button>
          {drawn.length > 0 && (
            <button type="button" onClick={() => setDrawn([])} className={BUTTON_TERTIARY}>
              Clear
            </button>
          )}
        </div>
      )}
    </WidgetShell>
  );
}


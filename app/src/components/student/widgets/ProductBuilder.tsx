"use client";

import { useMemo, useState } from "react";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { BADGE, BUTTON_SECONDARY, VERDICT_INK, cx } from "@/components/sticker";
import {
  OPTION_INK,
  WIDGET_FRAME,
  WIDGET_HEAD,
  WIDGET_HINT,
  WIDGET_KIND,
  WIDGET_OPTION,
  WIDGET_PROMPT,
  WIDGET_RESULT,
} from "./WidgetShell";

/**
 * {{widget:product_builder:{"X":[1,2],"Y":[3,4,5],"prompt":"Tap all pairs of X×Y"}}}
 *
 * The student taps candidate ordered pairs to build X×Y. Candidates = the
 * n(X)×n(Y) correct pairs + up to 3 decoys (reversed pairs and friends).
 * Live counter shows n(X)×n(Y); Check grades against exact set equality and
 * reports the outcome back into the chat stream once.
 */

type Pair = [number, number];
const key = (p: Pair) => `(${p[0]},${p[1]})`;

/** Deterministic pseudo-shuffle so candidates don't reorder across renders. */
function stableShuffle(pairs: Pair[]): Pair[] {
  const h = (p: Pair) =>
    (((p[0] * 137 + p[1] * 61 + 89) % 23) + 23) % 23;
  return [...pairs].sort((a, b) => h(a) - h(b) || a[0] - b[0] || a[1] - b[1]);
}

export function ProductBuilder({
  X,
  Y,
  prompt,
  studentName,
  onResult,
}: {
  X: number[];
  Y: number[];
  prompt: string;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const { candidates, correctSet, setX, setY } = useMemo(() => {
    const xs = [...new Set(X)].slice(0, 4);
    const ys = [...new Set(Y)].slice(0, 4);
    const correct: Pair[] = xs.flatMap((x) => ys.map((y) => [x, y] as Pair));
    const cSet = new Set(correct.map(key));
    // decoys: reversed pairs first (the classic X×Y ≠ Y×X trap), then X×X pairs
    const decoys: Pair[] = [];
    const push = (p: Pair) => {
      if (
        decoys.length < 3 &&
        !cSet.has(key(p)) &&
        !decoys.some((d) => key(d) === key(p))
      )
        decoys.push(p);
    };
    for (const y of ys) for (const x of xs) push([y, x]);
    for (const a of xs) for (const b of xs) push([a, b]);
    for (const a of ys) for (const b of ys) push([a, b]);
    return {
      candidates: stableShuffle([...correct, ...decoys]),
      correctSet: cSet,
      setX: xs,
      setY: ys,
    };
  }, [X, Y]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState(false);
  const n = correctSet.size;

  const toggle = (k: string) => {
    if (checked) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const check = () => {
    if (checked || selected.size === 0) return;
    setChecked(true);
    const wrongPicks = [...selected].filter((k) => !correctSet.has(k));
    const missed = [...correctSet].filter((k) => !selected.has(k));
    const ok = wrongPicks.length === 0 && missed.length === 0;
    const setStr = `{${setX.join(",")}}×{${setY.join(",")}}`;
    onResult({
      correct: ok,
      // Picking pairs that are not in X×Y almost always means (y, x) — the
      // decoys this widget adds are the reversed pairs, so a wrong pick is
      // evidence of order confusion rather than of random tapping.
      predicate: ok
        ? OK
        : wrongPicks.length
        ? "reversed-pairs"
        : "missing-pairs",
      given: `${n - missed.length} of ${n} pairs`,
      detail: ok
        ? `✓ ${who} built X×Y correctly: all ${n} pairs of ${setStr} (n(X)×n(Y)=${setX.length}×${setY.length}=${n})`
        : `✗ ${who}'s X×Y for ${setStr} had mistakes — ${
            wrongPicks.length
              ? `picked ${wrongPicks.join(", ")} which ${wrongPicks.length > 1 ? "are" : "is"} not in X×Y (reversed order?)`
              : ""
          }${wrongPicks.length && missed.length ? "; " : ""}${
            missed.length ? `missed ${missed.join(", ")}` : ""
          }`,
    });
  };

  const chipState = (k: string): "idle" | "on" | "hit" | "wrong" | "missed" => {
    const isSel = selected.has(k);
    const isCorrect = correctSet.has(k);
    if (!checked) return isSel ? "on" : "idle";
    if (isSel && isCorrect) return "hit";
    if (isSel && !isCorrect) return "wrong";
    if (!isSel && isCorrect) return "missed";
    return "idle";
  };

  // The chips are answer options at chip scale. After Check every chip is
  // disabled, so each graded state carries `data-verdict` and keeps its ink.
  // Nothing animates per chip: the result strip below is the one thing that
  // moves when the grade lands.
  const chipCls: Record<string, string> = {
    idle: OPTION_INK.idle,
    on: OPTION_INK.selected,
    hit: OPTION_INK.correct,
    // grey, and struck through — the non-colour "not this one", never red
    wrong: cx(OPTION_INK.wrong, "line-through"),
    // a pair that belonged in X×Y and was not picked: the correct ink, dashed
    missed: cx(VERDICT_INK.correct, "border-dashed"),
  };

  const allGood =
    checked &&
    [...selected].every((k) => correctSet.has(k)) &&
    selected.size === n;

  return (
    <div className={WIDGET_FRAME}>
      <div className={WIDGET_HEAD}>
        <span className={WIDGET_KIND}>✳ interactive · product builder</span>
        <span className={WIDGET_HINT}>
          X = {`{${setX.join(", ")}}`} · Y = {`{${setY.join(", ")}}`}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className={WIDGET_PROMPT}>{prompt}</p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className={cx(BADGE, "bg-card-warm text-ink")}>
            n(X)×n(Y) = {setX.length}×{setY.length} ={" "}
            <strong className="font-extrabold">{n}</strong>
          </span>
          <span className={cx(BADGE, "bg-card text-ink")}>
            selected {selected.size} / {n}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {candidates.map((p) => {
            const k = key(p);
            const st = chipState(k);
            return (
              <button
                key={k}
                onClick={() => toggle(k)}
                disabled={checked}
                data-verdict={checked && st !== "idle" ? st : undefined}
                className={cx(
                  WIDGET_OPTION,
                  "px-3 font-mono text-[12px]",
                  chipCls[st]
                )}
              >
                {k}
                {st === "missed" && <span className="ms-1 text-[9px]">missed</span>}
              </button>
            );
          })}
        </div>

        {!checked ? (
          <button
            onClick={check}
            disabled={selected.size === 0}
            className={cx(BUTTON_SECONDARY, "mt-3")}
          >
            Check my pairs
          </button>
        ) : (
          <div className={cx("mt-3 px-3 py-2", WIDGET_RESULT[allGood ? "correct" : "wrong"])}>
            <span className="font-display text-[13.5px] font-bold">
              {allGood
                ? `برافو! X×Y complete — all ${n} pairs ✓`
                : "Check the marks — first from X, second from Y. Order matters!"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

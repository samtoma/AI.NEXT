"use client";

import { useMemo, useState } from "react";

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
  onResult,
}: {
  X: number[];
  Y: number[];
  prompt: string;
  onResult: (note: string) => void;
}) {
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
    onResult(
      ok
        ? `✓ Omar built X×Y correctly: all ${n} pairs of ${setStr} (n(X)×n(Y)=${setX.length}×${setY.length}=${n})`
        : `✗ Omar's X×Y for ${setStr} had mistakes — ${
            wrongPicks.length
              ? `picked ${wrongPicks.join(", ")} which ${wrongPicks.length > 1 ? "are" : "is"} not in X×Y (reversed order?)`
              : ""
          }${wrongPicks.length && missed.length ? "; " : ""}${
            missed.length ? `missed ${missed.join(", ")}` : ""
          }`
    );
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

  const chipCls: Record<string, string> = {
    idle: "border-line bg-card text-ink-soft hover:border-ink/40 hover:-translate-y-px",
    on: "border-ink bg-ink text-paper shadow-[0_4px_10px_-4px_rgba(32,41,58,0.5)]",
    hit: "border-accent bg-accent text-paper",
    wrong: "border-rust bg-rust-wash text-rust line-through",
    missed: "border-dashed border-accent/70 bg-accent-wash text-accent-deep",
  };

  const allGood =
    checked &&
    [...selected].every((k) => correctSet.has(k)) &&
    selected.size === n;

  return (
    <div className="anim-pop my-2 overflow-hidden rounded-lg border border-accent/40 bg-card shadow-[0_10px_24px_-16px_rgba(13,74,66,0.5)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-accent-wash px-3.5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-accent-deep">
          ✳ interactive · product builder
        </span>
        <span className="font-mono text-[9px] text-ink-faint">
          X = {`{${setX.join(", ")}}`} · Y = {`{${setY.join(", ")}}`}
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13px] font-medium leading-relaxed text-ink">
          {prompt}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="chip border-gold/50 bg-gold-wash text-ink">
            n(X)×n(Y) = {setX.length}×{setY.length} ={" "}
            <strong className="font-semibold">{n}</strong>
          </span>
          <span className="chip">
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
                className={`rounded-full border px-2.5 py-1 font-mono text-[12px] font-medium transition-all duration-150 ${chipCls[st]}`}
              >
                {k}
                {st === "missed" && <span className="ml-1 text-[9px]">missed</span>}
              </button>
            );
          })}
        </div>

        {!checked ? (
          <button
            onClick={check}
            disabled={selected.size === 0}
            className="mt-3 rounded-full bg-accent-deep px-4 py-1.5 text-[11.5px] font-semibold text-paper transition-all duration-150 enabled:hover:-translate-y-px disabled:opacity-35"
          >
            Check my pairs
          </button>
        ) : (
          <div
            className={`anim-pop mt-3 rounded-md border px-3 py-2 ${
              allGood
                ? "border-accent/45 bg-accent-wash"
                : "border-rust/40 bg-rust-wash/60"
            }`}
          >
            <span
              className={`font-display text-[13.5px] font-medium ${
                allGood ? "text-accent-deep" : "text-rust"
              }`}
            >
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

"use client";

/**
 * {{widget:sample_space:{"prompt":"Tap every outcome where the two dice total 7","rows":6,"cols":6,"rule":{"kind":"sum","op":"eq","value":7}}}
 *
 * The whole sample space as a grid, with the student tapping out the event.
 *
 * Probability in this book is n(E)/n(S), and students lose it at n(E) — they
 * count "the ways to make 7" as one thing rather than six, because a list of
 * outcomes is invisible and a grid is not. Here S is on the screen in full, E
 * is what your finger covers, and the fraction assembles itself as you tap.
 *
 * THE RULE IS EVALUATED HERE, NOT SENT AS AN ANSWER KEY. The tutor names the
 * event ("sum equals 7") and this widget works out which cells satisfy it.
 * Passing a list of correct cells instead would put the model's arithmetic
 * between the student and the mark scheme, and a generated answer key that is
 * wrong about one cell is exactly the failure the review gate exists to catch.
 * A named rule cannot be wrong about its own extension.
 *
 * Dragging paints across cells, because selecting a diagonal of six one tap at
 * a time on a touchscreen is a dexterity test rather than a probability one.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, useDragSurface, type Pt } from "./drag";

const W = 300;
const PAD = 26;

export type RuleKind = "sum" | "diff" | "product" | "same" | "first" | "second";
export type RuleOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export interface SpaceRule {
  kind: RuleKind;
  op?: RuleOp;
  value?: number;
}

const OP_TEXT: Record<RuleOp, string> = {
  eq: "=", ne: "≠", lt: "<", le: "≤", gt: ">", ge: "≥",
};

const KIND_TEXT: Record<RuleKind, string> = {
  sum: "the total",
  diff: "the difference",
  product: "the product",
  same: "the two values",
  first: "the first die",
  second: "the second die",
};

function holds(rule: SpaceRule, a: number, b: number): boolean {
  if (rule.kind === "same") return a === b;
  const lhs =
    rule.kind === "sum" ? a + b
    : rule.kind === "diff" ? Math.abs(a - b)
    : rule.kind === "product" ? a * b
    : rule.kind === "first" ? a
    : b;
  const v = rule.value ?? 0;
  switch (rule.op ?? "eq") {
    case "eq": return lhs === v;
    case "ne": return lhs !== v;
    case "lt": return lhs < v;
    case "le": return lhs <= v;
    case "gt": return lhs > v;
    case "ge": return lhs >= v;
  }
}

const ruleText = (r: SpaceRule) =>
  r.kind === "same"
    ? "the two values are equal"
    : `${KIND_TEXT[r.kind]} ${OP_TEXT[r.op ?? "eq"]} ${r.value ?? 0}`;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

export function SampleSpace({
  prompt,
  rows = 6,
  cols = 6,
  rule,
  onResult,
}: {
  prompt: string;
  rows?: number;
  cols?: number;
  rule: SpaceRule;
  onResult: (note: string) => void;
}) {
  const R = clamp(Math.round(rows), 2, 8);
  const C = clamp(Math.round(cols), 2, 8);
  const svgRef = useRef<SVGSVGElement>(null);
  const cell = (W - PAD - 10) / C;
  const H = PAD + R * cell + 10;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);
  /** Whether this drag is painting on or off, decided by the first cell. */
  const painting = useRef<boolean | null>(null);

  const truth = useMemo(() => {
    const s = new Set<string>();
    for (let a = 1; a <= C; a++)
      for (let b = 1; b <= R; b++) if (holds(rule, a, b)) s.add(`${a},${b}`);
    return s;
  }, [rule, R, C]);

  const { surface } = useDragSurface({
    svgRef,
    toValue: (q) => q,
    snap: (q: Pt) => {
      const a = Math.floor((q.x - PAD) / cell) + 1;
      const b = Math.floor((q.y - PAD) / cell) + 1;
      if (a < 1 || a > C || b < 1 || b > R) return null;
      return { x: a, y: b };
    },
    onMove: (q) => {
      if (verdict) return;
      const key = `${q.x},${q.y}`;
      setPicked((cur) => {
        if (painting.current === null) painting.current = !cur.has(key);
        const on = painting.current;
        if (cur.has(key) === on) return cur;
        const next = new Set(cur);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    onCommit: () => {
      painting.current = null;
    },
  });

  const total = R * C;
  const frac = useMemo(() => {
    const n = picked.size;
    if (n === 0) return "0";
    const g = gcd(n, total) || 1;
    return `${n}/${total}${g > 1 ? ` = ${n / g}/${total / g}` : ""}`;
  }, [picked, total]);

  const check = useCallback(() => {
    if (fired.current) return;
    const missing = [...truth].filter((k) => !picked.has(k));
    const extra = [...picked].filter((k) => !truth.has(k));
    const ok = missing.length === 0 && extra.length === 0;
    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");

    const g = gcd(truth.size, total) || 1;
    const answer = `${truth.size}/${total}${g > 1 ? ` = ${truth.size / g}/${total / g}` : ""}`;
    const bits: string[] = [];
    if (missing.length) bits.push(`${missing.length} outcome${missing.length > 1 ? "s" : ""} missed`);
    if (extra.length) bits.push(`${extra.length} outcome${extra.length > 1 ? "s" : ""} that do not satisfy it`);
    const why = bits.length ? ` — ${bits.join(" and ")}` : "";

    setNote(
      ok
        ? `n(E) = ${truth.size}, n(S) = ${total}, so P = ${answer}.`
        : `You chose ${picked.size} of the ${total} outcomes${why}. The event has ${truth.size}, so P = ${answer}.`
    );
    onResult(
      ok
        ? `✓ Omar selected all ${truth.size} outcomes where ${ruleText(rule)} out of ${total}, giving P = ${answer}`
        : `✗ Omar selected ${picked.size} outcomes for "${ruleText(rule)}"${why}; n(E) is ${truth.size}, P = ${answer}`
    );
  }, [truth, picked, total, rule, onResult]);

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";

  return (
    <WidgetShell
      kind="sample space"
      hint="tap or drag across"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="inline-flex flex-wrap justify-center gap-x-3">
          <span className="text-ink-faint">event: {ruleText(rule)}</span>
          <span className="text-ink">
            n(E)/n(S) = {frac}
          </span>
        </span>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-pointer"
        }`}
        {...(verdict ? {} : surface)}
      >
        {Array.from({ length: C }, (_, i) => i + 1).map((a) => (
          <text key={`ch${a}`} x={PAD + (a - 0.5) * cell} y={PAD - 8} fontSize="9"
                textAnchor="middle" fill="var(--ink-faint)"
                style={{ fontFamily: "var(--stack-mono)" }}>
            {a}
          </text>
        ))}
        {Array.from({ length: R }, (_, i) => i + 1).map((b) => (
          <text key={`rh${b}`} x={PAD - 7} y={PAD + (b - 0.5) * cell + 3.5} fontSize="9"
                textAnchor="end" fill="var(--ink-faint)"
                style={{ fontFamily: "var(--stack-mono)" }}>
            {b}
          </text>
        ))}

        {Array.from({ length: C }, (_, i) => i + 1).flatMap((a) =>
          Array.from({ length: R }, (_, j) => j + 1).map((b) => {
            const key = `${a},${b}`;
            const on = picked.has(key);
            const isTrue = truth.has(key);
            // After the check the grid becomes the mark scheme: a missed cell
            // is outlined, a wrong pick is crossed. Both are stated in words
            // in the feedback line, so neither depends on the colour.
            const missed = !!verdict && isTrue && !on;
            const wrong = !!verdict && !isTrue && on;
            return (
              <g key={key}>
                <rect
                  x={PAD + (a - 1) * cell + 1.2}
                  y={PAD + (b - 1) * cell + 1.2}
                  width={cell - 2.4}
                  height={cell - 2.4}
                  rx="3.5"
                  fill={on ? ink : "var(--card)"}
                  fillOpacity={on ? (wrong ? 0.3 : 0.7) : 1}
                  stroke={missed ? "var(--accent)" : "var(--line)"}
                  strokeWidth={missed ? 2 : 1}
                  strokeDasharray={missed ? "3 2" : undefined}
                />
                <text
                  x={PAD + (a - 0.5) * cell}
                  y={PAD + (b - 0.5) * cell + 3.5}
                  fontSize="8.5" textAnchor="middle"
                  fill={on && !wrong ? "var(--paper)" : "var(--ink-faint)"}
                  style={{ fontFamily: "var(--stack-mono)" }}
                >
                  {rule.kind === "sum" ? a + b
                   : rule.kind === "product" ? a * b
                   : rule.kind === "diff" ? Math.abs(a - b)
                   : `${a}${b}`}
                </text>
                {wrong && (
                  <path
                    d={`M ${PAD + (a - 1) * cell + 5} ${PAD + (b - 1) * cell + 5} l ${cell - 10} ${cell - 10} M ${PAD + a * cell - 5} ${PAD + (b - 1) * cell + 5} l ${-(cell - 10)} ${cell - 10}`}
                    stroke="var(--ink-soft)" strokeWidth="1.4"
                  />
                )}
              </g>
            );
          })
        )}
      </svg>

      {!verdict && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          {picked.size > 0 && (
            <button
              type="button"
              onClick={() => setPicked(new Set())}
              className="min-h-[36px] rounded-md border border-line px-3 font-mono text-[10.5px] text-ink-soft transition-colors hover:border-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={check}
            className="min-h-[36px] rounded-md border border-accent/45 bg-accent-wash px-3.5 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
          >
            That&apos;s the event
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

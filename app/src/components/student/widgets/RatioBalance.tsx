"use client";

/**
 * {{widget:ratio_balance:{"prompt":"3 : 4 = 9 : ?","mode":"direct","a":3,"b":4,"c":9}}}
 * {{widget:ratio_balance:{"prompt":"6 workers take 10 days; 4 workers take ?","mode":"inverse","a":6,"b":10,"c":4}}}
 *
 * A beam balance for the fourth term. Drag the right-hand pan until the beam
 * is level.
 *
 * DIRECT AND INVERSE ARE THE SAME GESTURE HERE, AND THAT IS THE ARGUMENT. The
 * two are taught a page apart and confused for the rest of the year, because
 * "cross-multiply" is a procedure that works for one and silently wrecks the
 * other. On this beam the difference is a single visible fact: in direct
 * variation the two QUOTIENTS must match, in inverse the two PRODUCTS must —
 * and the readout under the beam names which quantity it is watching. A
 * student who drags the inverse case to the direct answer sees the beam stay
 * tilted, which is the correction arriving before the mark does.
 *
 * The tilt is logarithmic, so being out by a factor of two looks the same
 * whether the numbers are small or large, and no drag ever pins the beam flat
 * against its stop while the answer is still wrong.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";

const W = 300;
const H = 220;
const MAXV = 24;
const PIVOT = { x: W / 2, y: 74 };
const ARM = 92;
const MAX_TILT = 17; // degrees

/** One pan of the balance: the hanger, the dish and the quantity it carries. */
function Pan({
  at, top, bottom, live, ink,
}: {
  at: { x: number; y: number };
  top: string;
  bottom: string;
  live?: boolean;
  ink: string;
}) {
  return (
    <g>
      <line x1={at.x} y1={at.y} x2={at.x} y2={at.y + 26} stroke="var(--ink-faint)" strokeWidth="1.2" />
      <path
        d={`M ${at.x - 32} ${at.y + 26} q 32 22 64 0 z`}
        fill={ink} fillOpacity={live ? 0.22 : 0.1}
        stroke={ink} strokeWidth="1.6"
      />
      <text x={at.x} y={at.y + 44} fontSize="13" textAnchor="middle" fontWeight="600"
            fill="var(--ink)" style={{ fontFamily: "var(--stack-mono)" }}>
        {top}
      </text>
      <text x={at.x} y={at.y + 57} fontSize="8.5" textAnchor="middle" fill="var(--ink-faint)"
            style={{ fontFamily: "var(--stack-mono)" }}>
        {bottom}
      </text>
    </g>
  );
}

export function RatioBalance({
  prompt,
  mode,
  a,
  b,
  c,
  onResult,
}: {
  prompt: string;
  mode: "direct" | "inverse";
  a: number;
  b: number;
  c: number;
  onResult: (note: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [d, setD] = useState(() => (mode === "direct" ? 2 : 3));
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const answer = useMemo(
    () => (mode === "direct" ? (b * c) / a : (a * b) / c),
    [mode, a, b, c]
  );

  const g = useMemo(() => {
    const left = mode === "direct" ? a / b : a * b;
    const right = mode === "direct" ? c / d : c * d;
    const tilt = clamp(
      (Math.log(right) - Math.log(left)) * 26,
      -MAX_TILT,
      MAX_TILT
    );
    return {
      left: tidy(left, 4),
      right: tidy(right, 4),
      level: Math.abs(left - right) < 1e-9,
      tilt,
    };
  }, [mode, a, b, c, d]);

  const { surface } = useDragSurface({
    svgRef,
    toValue: (q) => q,
    // Only the right-hand half of the surface drives the pan, so a drag that
    // starts on the fixed side does not silently move the answer.
    snap: (q: Pt) => {
      if (q.x < W / 2) return null;
      return { x: 0, y: clamp(Math.round(((H - 24 - q.y) / (H - 70)) * MAXV), 1, MAXV) };
    },
    onMove: (q) => {
      if (verdict) return;
      setD(q.y);
    },
  });

  const check = useCallback(() => {
    if (fired.current) return;
    const ok = Math.abs(d - answer) < 1e-9;
    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");

    const other = mode === "direct" ? (a * b) / c : (b * c) / a;
    let why = "";
    if (!ok) {
      if (Math.abs(d - other) < 1e-9) {
        why =
          mode === "direct"
            ? " — that is the answer to the INVERSE relationship; here the two quotients must match, not the two products"
            : " — that is the answer to the DIRECT relationship; here the two products must match, not the two quotients";
      } else {
        why =
          mode === "direct"
            ? ` — ${a} : ${b} means ${a} ÷ ${b} = ${tidy(a / b, 4)}, and ${c} ÷ ${d} = ${tidy(c / d, 4)}`
            : ` — inverse means the product stays the same: ${a} × ${b} = ${a * b}, but ${c} × ${d} = ${c * d}`;
      }
    }

    setNote(
      ok
        ? mode === "direct"
          ? `${a} : ${b} = ${c} : ${tidy(answer, 4)} — both quotients are ${tidy(a / b, 4)}.`
          : `${a} × ${b} = ${c} × ${tidy(answer, 4)} = ${a * b} — the product is constant.`
        : `You set it to ${d}; the answer is ${tidy(answer, 4)}${why}`
    );
    onResult(
      ok
        ? `✓ Omar balanced the ${mode} relationship: ${a},${b},${c} → ${tidy(answer, 4)} on the ratio balance`
        : `✗ Omar set the fourth term to ${d} instead of ${tidy(answer, 4)} in the ${mode} relationship ${a},${b},${c}${why}`
    );
  }, [d, answer, mode, a, b, c, onResult]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) => setD((v) => clamp(v + (dx || dy), 1, MAXV)),
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const rad = (g.tilt * Math.PI) / 180;
  const endL = { x: PIVOT.x - ARM * Math.cos(rad), y: PIVOT.y - ARM * Math.sin(rad) };
  const endR = { x: PIVOT.x + ARM * Math.cos(rad), y: PIVOT.y + ARM * Math.sin(rad) };

  return (
    <WidgetShell
      kind={`ratio balance · ${mode}`}
      hint="drag the right pan"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="inline-flex flex-wrap justify-center gap-x-3">
          <span className="text-ink">
            {mode === "direct"
              ? `${a}÷${b} = ${g.left}`
              : `${a}×${b} = ${g.left}`}
          </span>
          <span className="text-ink">
            {mode === "direct" ? `${c}÷${d} = ${g.right}` : `${c}×${d} = ${g.right}`}
          </span>
          <span className={g.level ? "text-accent-deep" : "text-ink-faint"}>
            {g.level ? "level" : "not level"}
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
          verdict ? "cursor-default" : "cursor-ns-resize"
        }`}
        {...(verdict ? {} : surface)}
      >
        {/* stand */}
        <path d={`M ${PIVOT.x} ${PIVOT.y} L ${PIVOT.x - 20} ${H - 14} L ${PIVOT.x + 20} ${H - 14} Z`}
              fill="var(--line-soft)" stroke="var(--line)" strokeWidth="1" />
        <line x1={PIVOT.x - 46} y1={H - 14} x2={PIVOT.x + 46} y2={H - 14}
              stroke="var(--ink-soft)" strokeWidth="2" strokeLinecap="round" />
        {/* the level reference — what "balanced" looks like, always visible */}
        <line x1={PIVOT.x - ARM - 8} y1={PIVOT.y} x2={PIVOT.x + ARM + 8} y2={PIVOT.y}
              stroke="var(--line)" strokeWidth="1" strokeDasharray="4 4" />

        <g style={{ transition: "none" }}>
          <line x1={endL.x} y1={endL.y} x2={endR.x} y2={endR.y}
                stroke={ink} strokeWidth="3.5" strokeLinecap="round" />
          <Pan
            at={endL}
            top={mode === "direct" ? `${a} : ${b}` : `${a} × ${b}`}
            bottom="given"
            ink={ink}
          />
          <Pan
            at={endR}
            top={mode === "direct" ? `${c} : ${d}` : `${c} × ${d}`}
            bottom="drag me"
            live
            ink={ink}
          />
        </g>
        <circle cx={PIVOT.x} cy={PIVOT.y} r="5" fill="var(--ink-soft)" />
      </svg>

      {!verdict && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
          <label className="font-mono text-[10.5px] text-ink-soft">
            fourth term
            <input
              type="number"
              min={1}
              max={MAXV}
              value={d}
              onKeyDown={nudge}
              onChange={(e) => setD(clamp(Math.round(Number(e.target.value) || 1), 1, MAXV))}
              className="ml-2 h-9 w-14 rounded-md border border-line bg-card text-center font-mono text-[12px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
            />
          </label>
          <button
            type="button"
            onClick={check}
            className="min-h-[36px] rounded-md border border-accent/45 bg-accent-wash px-3.5 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
          >
            Check
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

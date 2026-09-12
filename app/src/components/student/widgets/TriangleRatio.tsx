"use client";

/**
 * {{widget:triangle_ratio:{"prompt":"Drag the triangle until sin θ = 3/5","ask":"sin","target":0.6}}}
 * ask ∈ sin | cos | tan
 *
 * A right triangle whose two legs the student DRAGS, with the three ratios
 * recomputed on every move.
 *
 * It is graded on the RATIO, never on the lengths — which is not a shortcut
 * but the entire content of the lesson. A 3–4 triangle and a 6–8 triangle both
 * give tan θ = 0.75, so both are accepted and the widget says so out loud when
 * the student lands on a scaled-up version. Similarity is the reason trig
 * ratios exist, and this is the one place in the book where a student can
 * watch a triangle double in size while a number refuses to move.
 *
 * Legs snap to whole units, so the Pythagorean triples the syllabus leans on
 * (3-4-5, 6-8-10, 5-12-13) are exactly reachable and sin/cos come out as the
 * clean fractions the answer key expects, rather than 0.5999999.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { Handle, WidgetShell, type Verdict } from "./WidgetShell";
import { clamp, tidy, useDragSurface, useKeyNudge, type Pt } from "./drag";
import { ratioText } from "./format";

const MAX = 12;
const W = 300;
const H = 260;
const PAD = 30;
const UNIT = (W - PAD * 2) / MAX;
const sx = (x: number) => PAD + x * UNIT;
const sy = (y: number) => H - PAD - y * UNIT;


const LABEL: Record<"sin" | "cos" | "tan", string> = {
  sin: "sin θ = opposite / hypotenuse",
  cos: "cos θ = adjacent / hypotenuse",
  tan: "tan θ = opposite / adjacent",
};

export function TriangleRatio({
  prompt,
  ask,
  target,
  onResult,
}: {
  prompt: string;
  ask: "sin" | "cos" | "tan";
  target: number;
  onResult: (note: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Not a triple, so nothing starts solved.
  const [legs, setLegs] = useState({ adj: 5, opp: 2 });
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const g = useMemo(() => {
    const { adj, opp } = legs;
    const hyp = Math.hypot(adj, opp);
    const exactHyp = Number.isInteger(tidy(hyp, 9));
    return {
      adj,
      opp,
      hyp: tidy(hyp, 4),
      exactHyp,
      sin: tidy(opp / hyp, 6),
      cos: tidy(adj / hyp, 6),
      tan: tidy(opp / adj, 6),
      theta: tidy((Math.atan2(opp, adj) * 180) / Math.PI, 1),
    };
  }, [legs]);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: (q.x - PAD) / UNIT, y: (H - PAD - q.y) / UNIT }),
    snap: (v: Pt) => ({
      x: clamp(Math.round(v.x), 1, MAX),
      y: clamp(Math.round(v.y), 1, MAX),
    }),
    onMove: (v) => {
      if (verdict) return;
      setLegs({ adj: v.x, opp: v.y });
    },
  });

  const reading = g[ask];

  const check = useCallback(() => {
    if (fired.current) return;
    const ok = Math.abs(reading - target) < 5e-4;
    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");

    const shown =
      ask === "tan"
        ? ratioText(g.opp, g.adj)
        : g.exactHyp
        ? ratioText(ask === "sin" ? g.opp : g.adj, Math.round(g.hyp))
        : tidy(reading, 3).toString();

    let why = "";
    if (!ok) {
      // The classic three, named rather than merely marked wrong.
      if (Math.abs(g.sin - target) < 5e-4 && ask !== "sin")
        why = ` — ${shown} is your ${ask}; the value you have built is the SINE (opposite over hypotenuse)`;
      else if (Math.abs(g.cos - target) < 5e-4 && ask !== "cos")
        why = ` — the value you have built is the COSINE (adjacent over hypotenuse), not the ${ask}`;
      else if (Math.abs(g.tan - target) < 5e-4 && ask !== "tan")
        why = ` — the value you have built is the TANGENT (opposite over adjacent), not the ${ask}`;
      else if (Math.abs(1 / reading - target) < 5e-4)
        why = " — the ratio is the right pair of sides the wrong way up";
    }

    const scaled = g.adj % 3 === 0 && g.opp % 3 === 0 ? " (a scaled-up triple — same ratio)" : "";
    setNote(
      ok
        ? `${LABEL[ask]} = ${shown} with legs ${g.opp} and ${g.adj}${scaled}. Any similar triangle gives the same ratio.`
        : `Your triangle gives ${ask} θ = ${shown}; the target is ${tidy(target, 3)}${why}`
    );
    onResult(
      ok
        ? `✓ Omar built a right triangle with ${ask} θ = ${shown} (opp ${g.opp}, adj ${g.adj}, hyp ${g.hyp}, θ ≈ ${g.theta}°) on the triangle ratio widget`
        : `✗ Omar built opp ${g.opp}, adj ${g.adj} giving ${ask} θ = ${shown}, not ${tidy(target, 3)}${why}`
    );
  }, [ask, reading, target, g, onResult]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx, dy) =>
      setLegs((c) => ({
        adj: clamp(c.adj + dx, 1, MAX),
        opp: clamp(c.opp + dy, 1, MAX),
      })),
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const A = { x: sx(0), y: sy(0) };          // right angle, origin corner
  const B = { x: sx(g.adj), y: sy(0) };      // along the adjacent leg
  const C = { x: sx(0), y: sy(g.opp) };      // up the opposite leg
  // θ is at B, between the adjacent leg and the hypotenuse.
  const arcR = Math.min(22, g.adj * UNIT * 0.42);

  return (
    <WidgetShell
      kind="triangle ratio"
      hint="drag the corner"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="inline-flex flex-wrap justify-center gap-x-3 gap-y-1">
          <span className={ask === "sin" ? "text-ink" : "text-ink-faint"}>
            sin {g.exactHyp ? ratioText(g.opp, Math.round(g.hyp)) : tidy(g.sin, 3)}
          </span>
          <span className={ask === "cos" ? "text-ink" : "text-ink-faint"}>
            cos {g.exactHyp ? ratioText(g.adj, Math.round(g.hyp)) : tidy(g.cos, 3)}
          </span>
          <span className={ask === "tan" ? "text-ink" : "text-ink-faint"}>
            tan {ratioText(g.opp, g.adj)}
          </span>
          <span className="text-accent-deep">θ ≈ {g.theta}°</span>
        </span>
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] rounded-md border border-line-soft bg-card-warm ${
          verdict ? "cursor-default" : "cursor-crosshair"
        }`}
        {...(verdict ? {} : surface)}
      >
        {/* unit grid — the lengths are meant to be COUNTED, not estimated */}
        {Array.from({ length: MAX + 1 }, (_, i) => (
          <g key={i}>
            <line x1={sx(i)} y1={sy(0)} x2={sx(i)} y2={sy(MAX)} stroke="var(--line-soft)" strokeWidth="0.7" />
            <line x1={sx(0)} y1={sy(i)} x2={sx(MAX)} y2={sy(i)} stroke="var(--line-soft)" strokeWidth="0.7" />
          </g>
        ))}

        <path
          d={`M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`}
          fill={ink} fillOpacity="0.12" stroke={ink} strokeWidth="2.2" strokeLinejoin="round"
        />

        {/* the right angle, squared off rather than arced */}
        <path
          d={`M ${A.x + 9} ${A.y} L ${A.x + 9} ${A.y - 9} L ${A.x} ${A.y - 9}`}
          fill="none" stroke="var(--ink-faint)" strokeWidth="1.3"
        />
        {/* θ at B */}
        <path
          d={`M ${B.x - arcR} ${B.y} A ${arcR} ${arcR} 0 0 0 ${
            B.x - arcR * Math.cos(Math.atan2(g.opp, g.adj))
          } ${B.y - arcR * Math.sin(Math.atan2(g.opp, g.adj))}`}
          fill="none" stroke="var(--accent-deep)" strokeWidth="1.6"
        />
        <text x={B.x - arcR - 10} y={B.y - 6} fontSize="11" fill="var(--accent-deep)" fontStyle="italic">θ</text>

        {/* side labels, each naming its ROLE — the vocabulary is the lesson */}
        <text x={(A.x + B.x) / 2} y={A.y + 15} fontSize="9" textAnchor="middle"
              fill="var(--ink-soft)" style={{ fontFamily: "var(--stack-mono)" }}>
          adj {g.adj}
        </text>
        <text x={A.x - 8} y={(A.y + C.y) / 2} fontSize="9" textAnchor="end"
              fill="var(--ink-soft)" style={{ fontFamily: "var(--stack-mono)" }}>
          opp {g.opp}
        </text>
        <text x={(B.x + C.x) / 2 + 8} y={(B.y + C.y) / 2 - 6} fontSize="9"
              fill="var(--ink-soft)" style={{ fontFamily: "var(--stack-mono)" }}>
          hyp {g.exactHyp ? Math.round(g.hyp) : g.hyp}
        </text>

        <Handle
          cx={B.x} cy={B.y} color={ink}
          label="Adjacent leg" live={`${g.adj} units`}
          dragging={dragging} locked={!!verdict} onKeyDown={nudge}
        />
        <Handle
          cx={C.x} cy={C.y} color={ink}
          label="Opposite leg" live={`${g.opp} units`}
          dragging={dragging} locked={!!verdict} onKeyDown={nudge}
        />
      </svg>

      {!verdict && (
        <button
          type="button"
          onClick={check}
          className="mx-auto mt-2.5 block min-h-[40px] rounded-md border border-accent/45 bg-accent-wash px-4 font-display text-[13px] font-medium text-accent-deep transition-colors hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/45"
        >
          Check my triangle
        </button>
      )}
    </WidgetShell>
  );
}

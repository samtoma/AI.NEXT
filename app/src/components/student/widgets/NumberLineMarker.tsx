"use client";

/**
 * {{widget:number_line_marker:{"prompt":"Mark the values x cannot take","mode":"points","range":[-6,6],"targets":[-2,3]}}}
 * {{widget:number_line_marker:{"prompt":"Show x > 2","mode":"interval","range":[-6,6],"from":2,"to":6,"openFrom":true,"openTo":true}}}
 *
 * The number line as something to mark up rather than look at.
 *
 * Two jobs the book keeps asking for and the product could not show. Points
 * mode is the excluded values of an algebraic fraction — the answer is a SET,
 * so it is graded as one and a student who finds one of the two zeros gets
 * told exactly that rather than a flat "wrong" — and one who marks −2 and 3
 * for 1/((x − 2)(x + 3)) is told the signs are flipped, which is a different
 * mistake with a different refutation (number-line-grade.ts). Interval mode is inequality
 * solutions, where the open/closed endpoint carries as much meaning as the
 * number: > and ≥ differ by nothing except the hollow circle, so the circle is
 * a control the student sets, not decoration.
 *
 * An endpoint running off the visible line is drawn as an arrow and read as
 * unbounded, because "x > 2" has no right-hand end and pretending it stops at
 * 6 would be teaching the wrong thing.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { BUTTON_SECONDARY, BUTTON_TERTIARY } from "@/components/sticker";
import { Handle, WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { clamp, useDragSurface, useKeyNudge, type Pt } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { gradePoints } from "./number-line-grade";

const W = 300;
const H = 96;
const PAD = 22;
const AXIS = 52;

export function NumberLineMarker({
  prompt,
  mode,
  range,
  targets,
  from,
  to,
  openFrom,
  openTo,
  studentName,
  onResult,
}: {
  prompt: string;
  mode: "points" | "interval";
  range: [number, number];
  targets?: number[];
  from?: number;
  to?: number;
  openFrom?: boolean;
  openTo?: boolean;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const [lo, hi] = range;
  const svgRef = useRef<SVGSVGElement>(null);
  const sx = useCallback(
    (v: number) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2),
    [lo, hi]
  );
  const ix = useCallback(
    (px: number) => lo + ((px - PAD) / (W - PAD * 2)) * (hi - lo),
    [lo, hi]
  );

  const [marks, setMarks] = useState<number[]>([]);
  const [span, setSpan] = useState<{ a: number; b: number }>({ a: lo + 1, b: lo + 2 });
  const [open, setOpen] = useState<{ a: boolean; b: boolean }>({ a: false, b: false });
  const [active, setActive] = useState<"a" | "b">("a");
  const held = useRef<"a" | "b" | null>(null);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let v = Math.ceil(lo); v <= hi; v++) out.push(v);
    return out;
  }, [lo, hi]);

  const { dragging, surface } = useDragSurface({
    svgRef,
    toValue: (q) => ({ x: ix(q.x), y: q.y }),
    snap: (v: Pt) => ({ x: clamp(Math.round(v.x), lo, hi), y: 0 }),
    onMove: (v) => {
      if (verdict) return;
      if (mode === "points") return; // points are placed on release, not swept
      let k = held.current;
      if (k === null) {
        k = Math.abs(v.x - span.a) <= Math.abs(v.x - span.b) ? "a" : "b";
        held.current = k;
        setActive(k);
      }
      const at = k;
      setSpan((cur) => {
        const next = { ...cur, [at]: v.x };
        return next.a <= next.b ? next : { a: next.b, b: next.a };
      });
    },
    onCommit: (v) => {
      held.current = null;
      if (verdict || mode !== "points") return;
      // Tap to add, tap again to remove — the only sane way to build a set.
      setMarks((cur) =>
        cur.includes(v.x) ? cur.filter((m) => m !== v.x) : [...cur, v.x].sort((p, q) => p - q)
      );
    },
  });

  const check = useCallback(() => {
    if (fired.current) return;
    let ok = false;
    let why = "";
    let pred = "off-target";

    if (mode === "points") {
      // The diagnosis (sign-flipped, missed-values, extra-values) and its
      // order live in number-line-grade.ts, where they are tested.
      const g = gradePoints(targets ?? [], marks);
      ok = g.ok;
      if (!ok) {
        pred = g.predicate;
        if (pred === "sign-flipped") {
          why = ` — right numbers, wrong signs: ${g.extra
            .map((v) => `${v} should be ${-v}`)
            .join(" and ")}. Substitute a value back in to check its sign`;
        } else {
          const bits: string[] = [];
          if (g.missing.length) bits.push(`missed ${g.missing.join(" and ")}`);
          if (g.extra.length) bits.push(`marked ${g.extra.join(" and ")}, which ${g.extra.length > 1 ? "are" : "is"} allowed`);
          why = bits.length ? ` — ${bits.join("; ")}` : "";
        }
      }
    } else {
      ok =
        span.a === from &&
        span.b === to &&
        open.a === !!openFrom &&
        open.b === !!openTo;
      if (!ok) {
        if (span.a === from && span.b === to) {
          pred = "endpoint-inclusion-wrong";
          why =
            " — the endpoints are right but the circles are not: a hollow circle excludes the value (< or >), a filled one includes it (≤ or ≥)";
        } else {
          pred = "interval-wrong";
          why = ` — the interval should run from ${from} to ${to}`;
        }
      }
    }

    fired.current = true;
    setVerdict(ok ? "correct" : "wrong");
    const drew =
      mode === "points"
        ? marks.length
          ? `{${marks.join(", ")}}`
          : "nothing"
        : `${open.a ? "(" : "["}${span.a}, ${span.b}${open.b ? ")" : "]"}`;
    const want =
      mode === "points"
        ? `{${(targets ?? []).join(", ")}}`
        : `${openFrom ? "(" : "["}${from}, ${to}${openTo ? ")" : "]"}`;
    setNote(ok ? `${drew} is right.` : `You marked ${drew}; the answer is ${want}${why}`);
    onResult({
      correct: ok,
      predicate: ok ? OK : pred,
      given: drew,
      detail: ok
        ? `✓ ${who} marked ${drew} correctly on the number line`
        : `✗ ${who} marked ${drew} on the number line instead of ${want}${why}`,
    });
  }, [mode, marks, targets, span, open, from, to, openFrom, openTo, onResult, who]);

  const nudge = useKeyNudge({
    step: 1,
    disabled: !!verdict,
    onNudge: (dx) => {
      if (verdict || mode !== "interval") return;
      setSpan((cur) => {
        const next = { ...cur, [active]: clamp(cur[active] + dx, lo, hi) };
        return next.a <= next.b ? next : { a: next.b, b: next.a };
      });
    },
    onCommit: check,
  });

  const ink = verdict === "correct" ? "var(--accent)" : "var(--gold)";
  const unboundedLeft = mode === "interval" && span.a <= lo;
  const unboundedRight = mode === "interval" && span.b >= hi;

  return (
    <WidgetShell
      kind={`number line · ${mode === "points" ? "values" : "interval"}`}
      hint={mode === "points" ? "tap to mark" : "drag the ends"}
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        verdict ? null : mode === "points" ? (
          <span className="text-ink">
            marked: {marks.length ? `{${marks.join(", ")}}` : "—"}
          </span>
        ) : (
          <span className="text-ink">
            {open.a ? "(" : "["}
            {unboundedLeft ? "−∞" : span.a}, {unboundedRight ? "∞" : span.b}
            {open.b ? ")" : "]"}
          </span>
        )
      }
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="application"
        aria-label={prompt}
        className={`mx-auto block w-full max-w-[320px] ${WIDGET_WELL} ${
          verdict ? "cursor-default" : "cursor-pointer"
        }`}
        {...(verdict ? {} : surface)}
      >
        {/* the shaded interval */}
        {mode === "interval" && (
          <line
            x1={sx(span.a)} y1={AXIS} x2={sx(span.b)} y2={AXIS}
            stroke={ink} strokeWidth="6" strokeLinecap="butt" opacity="0.4"
          />
        )}

        <line x1={PAD - 10} y1={AXIS} x2={W - PAD + 10} y2={AXIS}
              stroke="var(--ink-soft)" strokeWidth="1.4" />
        <path d={`M ${W - PAD + 10} ${AXIS} l -5 -2.8 v 5.6 z`} fill="var(--ink-soft)" />
        <path d={`M ${PAD - 10} ${AXIS} l 5 -2.8 v 5.6 z`} fill="var(--ink-soft)" />

        {ticks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} y1={AXIS - 4} x2={sx(t)} y2={AXIS + 4}
                  stroke="var(--ink-faint)" strokeWidth="1" />
            <text x={sx(t)} y={AXIS + 16} fontSize="8" textAnchor="middle"
                  fill="var(--ink-faint)" style={{ fontFamily: "var(--stack-mono)" }}>
              {t}
            </text>
          </g>
        ))}

        {mode === "points" && (
          <>
            {/* the answer, once it is in */}
            {verdict === "wrong" &&
              (targets ?? []).map((t) => (
                <circle key={`t${t}`} cx={sx(t)} cy={AXIS} r="8" fill="none"
                        stroke="var(--accent)" strokeWidth="1.6" strokeDasharray="3 2" />
              ))}
            {marks.map((m) => (
              <g key={m} className="anim-pop">
                <line x1={sx(m)} y1={AXIS - 13} x2={sx(m)} y2={AXIS + 13}
                      stroke={ink} strokeWidth="2" />
                <circle cx={sx(m)} cy={AXIS} r="4.5" fill={ink} />
              </g>
            ))}
          </>
        )}

        {mode === "interval" &&
          (["a", "b"] as const).map((k) => {
            const v = span[k];
            const hollow = open[k];
            return (
              <g key={k}>
                <circle
                  cx={sx(v)} cy={AXIS} r="6"
                  fill={hollow ? "var(--card)" : ink}
                  stroke={ink} strokeWidth="2"
                />
                <Handle
                  cx={sx(v)} cy={AXIS} r={3}
                  color="transparent"
                  label={k === "a" ? "Left endpoint" : "Right endpoint"}
                  live={`${v}, ${hollow ? "excluded" : "included"}`}
                  dragging={dragging && active === k}
                  locked={!!verdict}
                  onKeyDown={(e) => {
                    setActive(k);
                    nudge(e);
                  }}
                />
              </g>
            );
          })}
      </svg>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          {mode === "interval" &&
            (["a", "b"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setOpen((c) => ({ ...c, [k]: !c[k] }))}
                aria-pressed={open[k]}
                className={BUTTON_TERTIARY}
              >
                {k === "a" ? "left" : "right"}: {open[k] ? "○ excluded" : "● included"}
              </button>
            ))}
          {mode === "points" && marks.length > 0 && (
            <button
              type="button"
              onClick={() => setMarks([])}
              className={BUTTON_TERTIARY}
            >
              clear
            </button>
          )}
          <button
            type="button"
            onClick={check}
            className={BUTTON_SECONDARY}
          >
            Check
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

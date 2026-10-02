"use client";

/**
 * {{widget:venn_builder:{"prompt":"Shade A only","sets":2,"labels":["Football","Chess"],"mode":"shade","target":"aOnly"}}}
 * {{widget:venn_builder:{"prompt":"12 study French, 9 study German, 4 study both, out of 20. Fill in every region.","sets":2,"labels":["French","German"],"mode":"counts","total":20,"regions":{"a":8,"b":5,"ab":4,"n":3},"clues":{"a":12,"b":9}}}
 *
 * Two sets, three if simple (FR-1201 coverage for set theory). Two different
 * jobs, one diagram: SHADE mode names a region in words — A∪B, A∩B, A′, "A
 * only", "neither" — and the student taps the zone(s) that make it true;
 * COUNTS mode hands over a word problem's clue numbers and the student fills
 * in how many belong in every exclusive zone, including the one nobody
 * mentions — neither.
 *
 * REGIONS ARE REAL GEOMETRY, NOT A LEGEND. Tapping the diagram hit-tests the
 * actual circles (`regionAt`), and a shaded region is drawn as the actual
 * intersection/difference of those same circles via nested SVG masks
 * (`RegionFill` — an "inc" mask per set restricts to inside that circle, an
 * "exc" mask restricts to outside it, and nesting them intersects the
 * restrictions the same way nested clip-paths would). A parallel row of real
 * buttons names every region in words and toggles the same state, so the
 * widget is fully operable without a pointer (FR-1204) and "which region is
 * this" never depends on reading a picture.
 *
 * Grading is pure and lives in `venn-builder-grade.ts` (FR-1208): this
 * component only turns taps into region keys and region keys into pixels.
 */

import { useState } from "react";
import { BUTTON_SECONDARY, BUTTON_TERTIARY, cx } from "@/components/sticker";
import { WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { svgPoint } from "./drag";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import {
  gradeVennCounts,
  gradeVennShade,
  regionsFor,
  regionsForTarget,
  sumCounts,
  type RegionKey,
  type VennClues,
  type VennCounts,
  type VennSets,
  type VennTarget,
} from "./venn-builder-grade";

const W = 300;
const H = 220;

/** Canonical circle layouts — fixed, not derived from the data (this draws
 *  set RELATIONSHIPS, not a proportional/Euler diagram). */
const CIRCLES_2 = { a: { cx: 118, cy: 112, r: 68 }, b: { cx: 182, cy: 112, r: 68 } };
const CIRCLES_3 = {
  a: { cx: 118, cy: 90, r: 62 },
  b: { cx: 182, cy: 90, r: 62 },
  c: { cx: 150, cy: 138, r: 62 },
};

type Circle = { cx: number; cy: number; r: number };

function circlesFor(sets: VennSets): Record<"a" | "b" | "c", Circle> {
  return sets === 2
    ? { ...CIRCLES_2, c: { cx: 0, cy: 0, r: 0 } }
    : CIRCLES_3;
}

/** Which exclusive zone a plane-space point falls in. */
function regionAt(sets: VennSets, pt: { x: number; y: number }): RegionKey {
  const c = circlesFor(sets);
  const inCircle = (o: Circle) => Math.hypot(pt.x - o.cx, pt.y - o.cy) <= o.r;
  const inA = inCircle(c.a);
  const inB = inCircle(c.b);
  if (sets === 2) {
    if (inA && inB) return "ab";
    if (inA) return "a";
    if (inB) return "b";
    return "n";
  }
  const inC = inCircle(c.c);
  if (inA && inB && inC) return "abc";
  if (inA && inB) return "ab";
  if (inA && inC) return "ac";
  if (inB && inC) return "bc";
  if (inA) return "a";
  if (inB) return "b";
  if (inC) return "c";
  return "n";
}

function regionLabel(region: RegionKey, labels: readonly string[]): string {
  const [A, B, C] = labels;
  switch (region) {
    case "a": return `${A} only`;
    case "b": return `${B} only`;
    case "c": return `${C} only`;
    case "ab": return C === undefined ? "both" : `${A} and ${B}`;
    case "ac": return `${A} and ${C}`;
    case "bc": return `${B} and ${C}`;
    case "abc": return "all three";
    case "n": return C === undefined ? "neither" : "none of them";
  }
}

const TARGET_TEXT: Record<VennTarget, (labels: readonly string[]) => string> = {
  union: (l) => `${l[0]} ∪ ${l[1]}${l[2] ? ` ∪ ${l[2]}` : ""} — anyone in at least one`,
  intersection: (l) => `${l[0]} ∩ ${l[1]}${l[2] ? ` ∩ ${l[2]}` : ""} — in every one`,
  aOnly: (l) => `${l[0]} only`,
  bOnly: (l) => `${l[1]} only`,
  cOnly: (l) => `${l[2]} only`,
  complementA: (l) => `${l[0]}′ — everyone NOT in ${l[0]}`,
  complementB: (l) => `${l[1]}′ — everyone NOT in ${l[1]}`,
  complementC: (l) => `${l[2]}′ — everyone NOT in ${l[2]}`,
  neither: () => "neither — outside every set",
};

function RegionMasks({ sets }: { sets: VennSets }) {
  const c = circlesFor(sets);
  const letters = (sets === 2 ? (["a", "b"] as const) : (["a", "b", "c"] as const));
  return (
    <defs>
      {letters.map((l) => {
        const o = c[l];
        return (
          <g key={l}>
            <mask id={`venn-inc-${l}`}>
              <rect x={0} y={0} width={W} height={H} fill="black" />
              <circle cx={o.cx} cy={o.cy} r={o.r} fill="white" />
            </mask>
            <mask id={`venn-exc-${l}`}>
              <rect x={0} y={0} width={W} height={H} fill="white" />
              <circle cx={o.cx} cy={o.cy} r={o.r} fill="black" />
            </mask>
          </g>
        );
      })}
    </defs>
  );
}

/** The actual region — an intersection/difference of the real circles, via
 *  nested masks. `pattern` draws the hatch fill (a wrong or a missed pick)
 *  instead of the flat one, so neither reads by colour alone. */
function RegionFill({
  region,
  sets,
  fill,
  opacity,
}: {
  region: RegionKey;
  sets: VennSets;
  fill: string;
  opacity: number;
}) {
  const letters = (sets === 2 ? (["a", "b"] as const) : (["a", "b", "c"] as const));
  const ins = region === "n" ? [] : letters.filter((l) => region.includes(l));
  const outs = letters.filter((l) => !ins.includes(l));
  const masks = [...ins.map((l) => `venn-inc-${l}`), ...outs.map((l) => `venn-exc-${l}`)];
  let node = <rect x={0} y={0} width={W} height={H} fill={fill} opacity={opacity} />;
  for (const m of masks) node = <g mask={`url(#${m})`}>{node}</g>;
  return node;
}

function Diagram({
  sets,
  labels,
  children,
  onTap,
  tappable,
}: {
  sets: VennSets;
  labels: readonly string[];
  children?: React.ReactNode;
  onTap?: (e: React.PointerEvent<SVGSVGElement>) => void;
  tappable: boolean;
}) {
  const c = circlesFor(sets);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="application"
      aria-label="Venn diagram"
      onPointerDown={onTap}
      className={cx(
        "mx-auto block w-full max-w-[320px]",
        WIDGET_WELL,
        tappable ? "cursor-pointer" : "cursor-default"
      )}
    >
      <RegionMasks sets={sets} />
      {children}
      <circle cx={c.a.cx} cy={c.a.cy} r={c.a.r} fill="none" stroke="var(--ink-soft)" strokeWidth="1.6" />
      <circle cx={c.b.cx} cy={c.b.cy} r={c.b.r} fill="none" stroke="var(--ink-soft)" strokeWidth="1.6" />
      {sets === 3 && (
        <circle cx={c.c.cx} cy={c.c.cy} r={c.c.r} fill="none" stroke="var(--ink-soft)" strokeWidth="1.6" />
      )}
      <text x={c.a.cx - (sets === 2 ? 42 : 46)} y={c.a.cy - (sets === 2 ? 46 : 38)} fontSize="10.5" fontWeight="700" fill="var(--ink)">
        {labels[0]}
      </text>
      <text x={c.b.cx + (sets === 2 ? 12 : 10)} y={c.b.cy - (sets === 2 ? 46 : 38)} fontSize="10.5" fontWeight="700" fill="var(--ink)">
        {labels[1]}
      </text>
      {sets === 3 && (
        <text x={c.c.cx - 12} y={c.c.cy + 66} fontSize="10.5" fontWeight="700" fill="var(--ink)">
          {labels[2]}
        </text>
      )}
      <rect x={2} y={2} width={W - 4} height={H - 4} fill="none" stroke="var(--line-soft)" strokeWidth="1" rx="6" />
    </svg>
  );
}

interface BaseProps {
  prompt: string;
  sets: VennSets;
  labels: readonly string[];
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}

export type VennBuilderProps =
  | (BaseProps & { mode: "shade"; target: VennTarget })
  | (BaseProps & { mode: "counts"; total?: number; regions: VennCounts; clues?: VennClues });

export function VennBuilder(props: VennBuilderProps) {
  return props.mode === "shade" ? <VennShade {...props} /> : <VennCounts_ {...props} />;
}

function VennShade({
  prompt,
  sets,
  labels,
  target,
  studentName,
  onResult,
}: Extract<VennBuilderProps, { mode: "shade" }>) {
  const who = studentName?.trim() || "the student";
  const keys = regionsFor(sets);
  const [shaded, setShaded] = useState<Set<RegionKey>>(new Set());
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fired, setFired] = useState(false);

  const toggle = (region: RegionKey) => {
    if (verdict) return;
    setShaded((cur) => {
      const next = new Set(cur);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  const check = () => {
    if (fired || shaded.size === 0) return;
    setFired(true);
    const g = gradeVennShade(target, sets, [...shaded]);
    setVerdict(g.ok ? "correct" : "wrong");
    const wantText = TARGET_TEXT[target](labels);
    const gotText = [...shaded].map((r) => regionLabel(r, labels)).join(", ") || "nothing";
    setNote(g.ok ? `That is ${wantText}.` : `You shaded ${gotText}; the target is ${wantText}.`);
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: gotText,
      detail: g.ok
        ? `✓ ${who} shaded ${wantText} correctly on the Venn diagram`
        : `✗ ${who} shaded ${gotText} for "${wantText}" — missed ${g.missing.length}, extra ${g.extra.length}`,
    });
  };

  const want = regionsForTarget(target, sets);
  const showReveal = verdict === "wrong";

  return (
    <WidgetShell
      kind={`venn diagram · ${sets} sets · shade`}
      hint="tap the region"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
    >
      <Diagram sets={sets} labels={labels} tappable={!verdict} onTap={(e) => {
        if (verdict) return;
        const pt = svgPoint(e.currentTarget, e);
        if (pt) toggle(regionAt(sets, pt));
      }}>
        {[...shaded].map((r) => (
          <RegionFill
            key={`s-${r}`}
            region={r}
            sets={sets}
            fill={verdict === "wrong" && !want.has(r) ? "var(--play-inactive-border)" : "var(--accent)"}
            opacity={0.55}
          />
        ))}
        {/* the answer, once it is in: every region that SHOULD have been
            shaded and was not, dashed rather than solid (missed, never a
            colour-only signal). */}
        {showReveal &&
          [...want]
            .filter((r) => !shaded.has(r))
            .map((r) => <RegionFill key={`m-${r}`} region={r} sets={sets} fill="var(--accent)" opacity={0.22} />)}
      </Diagram>

      {/* keyboard/AT path (FR-1204): every region as a real, labelled button,
          same state as the diagram, and equally usable by touch. */}
      <div className={WIDGET_ACTIONS} role="group" aria-label="regions">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            disabled={!!verdict}
            aria-pressed={shaded.has(k)}
            className={shaded.has(k) ? BUTTON_SECONDARY : BUTTON_TERTIARY}
          >
            {regionLabel(k, labels)}
          </button>
        ))}
      </div>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} disabled={shaded.size === 0} className={BUTTON_SECONDARY}>
            Check
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

function VennCounts_({
  prompt,
  sets,
  labels,
  total,
  regions,
  clues,
  studentName,
  onResult,
}: Extract<VennBuilderProps, { mode: "counts" }>) {
  const who = studentName?.trim() || "the student";
  const keys = regionsFor(sets);
  const [counts, setCounts] = useState<VennCounts>(() =>
    Object.fromEntries(keys.map((k) => [k, 0])) as VennCounts
  );
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fired, setFired] = useState(false);

  const runningTotal = sumCounts(sets, counts);

  const check = () => {
    if (fired) return;
    setFired(true);
    const g = gradeVennCounts(sets, regions, counts, clues);
    setVerdict(g.ok ? "correct" : "wrong");
    setNote(
      g.ok
        ? `Every region checks out — total ${runningTotal}.`
        : `Your total is ${runningTotal}${total !== undefined ? ` (should be ${total})` : ""}; ${g.wrong.length} region${g.wrong.length > 1 ? "s" : ""} ${g.wrong.length > 1 ? "don't" : "doesn't"} match.`
    );
    const given = keys.map((k) => `${regionLabel(k, labels)}=${counts[k] ?? 0}`).join(", ");
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given,
      detail: g.ok
        ? `✓ ${who} filled every region correctly (total ${runningTotal})`
        : `✗ ${who}'s regions (${given}) don't match — wrong: ${g.wrong.map((k) => regionLabel(k, labels)).join(", ")}`,
    });
  };

  return (
    <WidgetShell
      kind={`venn diagram · ${sets} sets · counts`}
      hint="fill every region"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      footer={
        <span className="text-ink">
          total so far: {runningTotal}
          {total !== undefined && <span className="text-ink-faint"> / {total}</span>}
        </span>
      }
    >
      <Diagram sets={sets} labels={labels} tappable={false} />

      <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {keys.map((k) => (
          <label key={k} className="flex flex-col items-center gap-1">
            <span className="text-center text-[10.5px] font-medium text-ink-faint">
              {regionLabel(k, labels)}
            </span>
            <input
              type="number"
              min={0}
              max={999}
              value={counts[k] ?? 0}
              disabled={!!verdict}
              aria-label={`${regionLabel(k, labels)} count`}
              onChange={(e) => {
                const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                setCounts((cur) => ({ ...cur, [k]: v }));
              }}
              className="h-[var(--noor-touch-min)] w-16 rounded-[var(--play-radius-sm)] border-[length:var(--play-stroke-sm)] border-ink bg-card text-center font-mono text-[13px] font-medium text-ink"
            />
          </label>
        ))}
      </div>

      {!verdict && (
        <div className={WIDGET_ACTIONS}>
          <button type="button" onClick={check} className={BUTTON_SECONDARY}>
            Check
          </button>
        </div>
      )}
    </WidgetShell>
  );
}

"use client";

/**
 * rule_tree — taxonomy AND decision tree (VIZ_SPEC v3 §1.4).
 *
 * Covers the book's one printed tree diagram (أنواع المنادى المعرب, printed 12)
 * and every rule it states as a condition→outcome list (أدوات النداء p.11,
 * الهمزة المتطرفة p.23). `edgeLabel` on a node is what turns the taxonomy into
 * a decision tree: it labels the branch, not the box.
 *
 * spec: {root:{label}, nodes:[{id, label, example?, edgeLabel?, parent?, step?}],
 *        note?, animate:"sequence"|"none"}
 *
 * RTL layout: child ١ sits on the RIGHT, matching the printed page.
 */

import {
  VizError,
  arr,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { arDigits } from "./arabic";

interface Node {
  id: string;
  label: string;
  example: string;
  edgeLabel: string;
  parent: string;
  step: number;
}

const MAX_CHILDREN = 5; // mobile ceiling (§1.4)

export function RuleTree({ spec, animOn }: VizProps) {
  const root = obj(spec.root);
  const rootLabel = str(root.label ?? spec.title);
  if (!rootLabel) throw new VizError("rule_tree: no root label");

  const nodes: Node[] = arr(spec.nodes)
    .map((raw, i) => {
      const n = obj(raw);
      return {
        id: str(n.id, `n${i}`),
        label: str(n.label),
        example: str(n.example),
        edgeLabel: str(n.edgeLabel),
        parent: str(n.parent),
        step: Math.max(1, num(n.step, i + 1)),
      };
    })
    .filter((n) => n.label);
  if (nodes.length === 0) throw new VizError("rule_tree: no nodes");

  const top = nodes.filter((n) => !n.parent).slice(0, MAX_CHILDREN);
  const childrenOf = (id: string) =>
    nodes.filter((n) => n.parent === id).slice(0, MAX_CHILDREN);
  if (top.length === 0) throw new VizError("rule_tree: every node has a parent");

  const steps = [...new Set(nodes.map((n) => n.step))].sort((a, b) => a - b);
  // step 1 = the root alone, then one step per node group
  const stepTimes = [0.15, ...steps.map((_, i) => 0.7 + i * 0.6)];
  const delayOf = (s: number) => {
    const i = steps.indexOf(s);
    return i < 0 ? stepTimes[0] : stepTimes[i + 1];
  };

  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.15) + 1, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);
  const note = str(spec.note);

  const barWidth = top.length > 1 ? ((top.length - 1) / top.length) * 100 : 0;

  return (
    <div dir="rtl" lang="ar" key={tl.key} className="flex flex-col items-center py-1.5">
      {/* root */}
      <div
        className="ar-block ar-plain max-w-[92%] rounded-md border border-accent-deep/60 bg-accent-wash px-2.5 py-1.5 text-center text-[13px] font-semibold text-accent-deep"
        style={a.pop(stepTimes[0])}
      >
        <bdi>{arDigits(rootLabel)}</bdi>
      </div>

      {top.length > 0 && (
        <>
          {/* orthogonal connector: vertical stub → horizontal bar */}
          <div
            className="h-3 w-px bg-accent-deep/40"
            style={a.grow(stepTimes[0] + 0.15, "y", 0.35)}
          />
          {barWidth > 0 && (
            <div
              className="h-px bg-accent-deep/40"
              style={{
                width: `${barWidth}%`,
                ...a.grow(stepTimes[0] + 0.25, "x", 0.45),
                transformOrigin: "100% 50%", // RTL: the bar draws rightwards→left
              }}
            />
          )}
          {/* children — first child on the RIGHT (dir=rtl does this for us) */}
          <div className="flex w-full items-start justify-center gap-1.5">
            {top.map((n) => (
              <Branch
                key={n.id}
                node={n}
                kids={childrenOf(n.id)}
                a={a}
                delayOf={delayOf}
              />
            ))}
          </div>
        </>
      )}

      {note && (
        <p
          className="ar-block ar-plain mt-2 rounded-md border border-line-soft bg-card-warm px-2.5 py-1.5 text-center text-[11.5px] text-ink-soft"
          style={a.fade(delayOf(steps[steps.length - 1]) + 0.3)}
        >
          <bdi>{arDigits(note)}</bdi>
        </p>
      )}
    </div>
  );
}

function Branch({
  node,
  kids,
  a,
  delayOf,
}: {
  node: Node;
  kids: Node[];
  a: ReturnType<typeof makeAnim>;
  delayOf: (s: number) => number;
}) {
  const d = delayOf(node.step);
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <div className="h-3 w-px bg-accent-deep/40" style={a.grow(d - 0.1, "y", 0.3)} />
      {node.edgeLabel && (
        <span
          className="ar-label ar-block mb-0.5 rounded-full border border-gold/45 bg-gold-wash px-1.5 py-px font-mono text-[9px] font-semibold text-gold"
          style={a.pop(d - 0.05)}
        >
          <bdi>{node.edgeLabel}</bdi>
        </span>
      )}
      <div
        className="ar-block ar-plain w-full rounded-md border border-accent-deep/45 bg-accent-wash px-1.5 py-1 text-center text-[11.5px] font-semibold text-accent-deep"
        style={a.pop(d)}
      >
        <bdi>{arDigits(node.label)}</bdi>
      </div>
      {node.example && (
        <span
          className="ar-block ar-plain mt-1 text-center text-[11px] text-ink-soft"
          style={a.fade(d + 0.2)}
        >
          <bdi>{node.example}</bdi>
        </span>
      )}
      {kids.length > 0 && (
        <div className="mt-1 flex w-full flex-col items-center gap-1">
          {kids.map((k) => (
            <div key={k.id} className="flex w-full flex-col items-center">
              <div
                className="h-2 w-px bg-accent-deep/30"
                style={a.grow(delayOf(k.step) - 0.1, "y", 0.25)}
              />
              <div
                className="ar-block ar-plain w-full rounded border border-line bg-card px-1.5 py-1 text-center text-[10.5px] text-ink"
                style={a.pop(delayOf(k.step))}
              >
                <bdi>{arDigits(k.label)}</bdi>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

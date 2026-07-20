"use client";

/**
 * flow_chain — animated سبب → حدث → نتيجة boxes joined by arrows, revealing
 * in step order (VIZ_SPEC v2). RTL flow: the chain reads right-to-left.
 *
 * spec: {nodes:[{id?, label, role:"سبب"|"حدث"|"نتيجة", step?}],
 *        links?:[[a,b],…],   // node ids or indices; a linear path reorders
 *        animate:"sequence"|"none"}
 */

import {
  ACCENT,
  GOLD,
  INK_SOFT,
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
  role: string;
  step: number;
}

const ROLE_STYLE: Record<string, { box: string; tag: string }> = {
  "سبب": { box: "border-gold/55 bg-gold-wash", tag: "text-gold" },
  "حدث": { box: "border-line bg-card", tag: "text-ink-soft" },
  "نتيجة": { box: "border-accent/50 bg-accent-wash", tag: "text-accent-deep" },
};

/** If `links` describes one linear path over the nodes, order nodes by it. */
function orderByLinks(nodes: Node[], links: unknown): Node[] {
  const pairs = arr(links)
    .map((l) => arr(l).map((v) => str(v, String(num(v, NaN)))))
    .filter((l) => l.length >= 2);
  if (pairs.length === 0) return nodes;
  const byKey = new Map<string, Node>();
  nodes.forEach((n, i) => {
    byKey.set(n.id, n);
    byKey.set(String(i), n);
  });
  const next = new Map<string, string>();
  const hasIncoming = new Set<string>();
  for (const [from, to] of pairs) {
    if (!byKey.has(from) || !byKey.has(to) || next.has(from)) return nodes;
    next.set(from, to);
    hasIncoming.add(byKey.get(to)!.id);
  }
  const start = nodes.find((n) => !hasIncoming.has(n.id));
  if (!start) return nodes;
  const ordered: Node[] = [];
  const seen = new Set<string>();
  let cur: Node | undefined = start;
  while (cur && !seen.has(cur.id)) {
    ordered.push(cur);
    seen.add(cur.id);
    const nk: string | undefined =
      next.get(cur.id) ?? next.get(String(nodes.indexOf(cur)));
    cur = nk !== undefined ? byKey.get(nk) : undefined;
  }
  return ordered.length === nodes.length ? ordered : nodes;
}

export function FlowChain({ spec, animOn }: VizProps) {
  const parsed: Node[] = arr(spec.nodes)
    .map((raw, i) => {
      const n = obj(raw);
      return {
        id: str(n.id, String(i)),
        label: str(n.label),
        role: str(n.role),
        step: num(n.step, i + 1),
      };
    })
    .filter((n) => n.label !== "");
  if (parsed.length === 0) throw new VizError("flow_chain: no nodes");

  const nodes = orderByLinks(
    [...parsed].sort((a, b) => a.step - b.step),
    spec.links
  );

  const steps = [...new Set(nodes.map((n) => n.step))].sort((a, b) => a - b);
  const stepAt = new Map(steps.map((s, i) => [s, 0.4 + i * 0.75]));
  const stepTimes = steps.map((s) => stepAt.get(s) ?? 0.4);
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.4) + 1.2, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  return (
    <div dir="rtl" key={tl.key} className="flex flex-wrap items-center gap-y-2 py-1.5">
      {nodes.map((n, i) => {
        const d = stepAt.get(n.step) ?? 0.4;
        const roleStyle = ROLE_STYLE[n.role] ?? { box: "border-line bg-card", tag: "text-ink-faint" };
        return (
          <div key={n.id} className="flex items-center">
            {i > 0 && (
              // connector: points along reading order (leftwards in RTL)
              <svg
                viewBox="0 0 22 12"
                className="mx-0.5 h-[12px] w-[22px] shrink-0 rtl:-scale-x-100"
                aria-hidden
                style={a.fade(d - 0.25, 0.4)}
              >
                <line
                  x1="1"
                  y1="6"
                  x2="16"
                  y2="6"
                  stroke={INK_SOFT}
                  strokeWidth="1.6"
                  pathLength={100}
                  style={a.draw(d - 0.25, 0.35)}
                />
                <path d="M21,6 l-7,-3.4 l2,3.4 l-2,3.4 Z" fill={INK_SOFT} style={a.fade(d - 0.05, 0.25)} />
              </svg>
            )}
            <div
              className={`max-w-[180px] rounded-md border px-2.5 py-1.5 shadow-[0_2px_6px_-3px_rgba(32,41,58,0.3)] ${roleStyle.box}`}
              style={a.pop(d)}
            >
              {n.role && (
                <span
                  className={`block font-mono text-[8.5px] font-bold tracking-wide ${roleStyle.tag}`}
                  style={{ color: n.role === "سبب" ? GOLD : n.role === "نتيجة" ? ACCENT : undefined }}
                >
                  {n.role}
                </span>
              )}
              <span className="block text-[11.5px] font-medium leading-snug text-ink">
                <bdi>{arDigits(n.label)}</bdi>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

"use client";

/**
 * venn_diagram — 1–3 sets as ovals inside a universe rectangle (VIZ_SPEC v4).
 * spec: {universe?:"S", sets:[{label, inside?}], overlaps:[[a,b]]?,
 *        items:[{text, in:[…]}]?, shade:[{in:[…], out?:[…]}]?,
 *        notes:[{text, in:[…], out?:[…]}]?, animate:"sequence"|"none"}
 *
 * RELATIONSHIPS, NOT AREAS. The layout comes from which sets overlap, which
 * sit apart and which sit inside another — never from the counts — the way
 * the book draws them. An item goes in the region inside exactly the sets in
 * its `in`; it is placed by sampling the real ovals, so "which region is this
 * number in" is the geometry's answer, not a lookup table. A shaded region is
 * the actual intersection/difference of the same ovals, by nested masks (as
 * the venn_builder widget does it).
 */

import { useId } from "react";
import {
  ACCENT,
  INK,
  INK_SOFT,
  MONO,
  VizError,
  arr,
  makeAnim,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

interface Oval {
  label: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  parent: string | null;
}

interface Region {
  ins: string[];
  outs: string[];
}

const W = 300;
const H = 200;
const U = { x: 8, y: 8, w: W - 16, h: H - 16 };
const GRID = 5;

const labels = (v: unknown): string[] => arr(v).map((x) => str(x)).filter(Boolean);
const key = (ls: string[]) => [...ls].sort().join("|");

export function VennDiagram({ spec, animOn }: VizProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  /* ---- the sets and their relationships ---- */
  const raw = arr(spec.sets).map((s) => obj(s));
  const names = raw.map((s) => str(s.label)).filter(Boolean);
  if (names.length === 0) throw new VizError("venn_diagram: no sets");
  if (names.length > 3) throw new VizError("venn_diagram: at most three sets");
  if (new Set(names).size !== names.length) throw new VizError("venn_diagram: two sets share a label");
  const parentOf = new Map<string, string | null>(
    raw.map((s) => {
      const p = str(s.inside);
      return [str(s.label), names.includes(p) && p !== str(s.label) ? p : null];
    })
  );
  const overlapping = new Set(
    arr(spec.overlaps)
      .map((pair) => labels(pair))
      .filter((pair) => pair.length === 2 && pair.every((l) => names.includes(l)))
      .map((pair) => key(pair))
  );
  const overlaps = (a: string, b: string) => overlapping.has(key([a, b]));

  /* ---- layout: top-level sets first, then each subset inside its parent ---- */
  const top = names.filter((n) => !parentOf.get(n));
  const ovals = new Map<string, Oval>();
  const place = (label: string, cx: number, cy: number, rx: number, ry: number) =>
    ovals.set(label, { label, cx, cy, rx, ry, parent: parentOf.get(label) ?? null });
  const midY = U.y + U.h / 2 + 4;
  if (top.length === 1) {
    place(top[0], W / 2, midY, 82, 64);
  } else if (top.length === 2) {
    const [a, b] = top;
    if (overlaps(a, b)) {
      place(a, W / 2 - 38, midY, 72, 60);
      place(b, W / 2 + 38, midY, 72, 60);
    } else {
      place(a, W / 2 - 68, midY, 58, 52);
      place(b, W / 2 + 68, midY, 58, 52);
    }
  } else if (top.length === 3) {
    const [a, b, c] = top;
    const edges = [overlaps(a, b), overlaps(b, c), overlaps(a, c)].filter(Boolean).length;
    if (edges === 3) {
      place(a, W / 2 - 32, midY - 24, 56, 46);
      place(b, W / 2 + 32, midY - 24, 56, 46);
      place(c, W / 2, midY + 26, 56, 46);
    } else {
      // a row; the set that overlaps most goes in the middle, so every overlapping pair is adjacent
      const degree = (n: string) => top.filter((m) => m !== n && overlaps(n, m)).length;
      const mid = [...top].sort((x, y) => degree(y) - degree(x))[0];
      const [l, r] = top.filter((n) => n !== mid);
      const rx = 46, ry = 50;
      const step = (p: string, q: string) => (overlaps(p, q) ? rx * 1.3 : rx * 2 + 10);
      const left = step(l, mid), right = step(mid, r);
      const x0 = W / 2 - (left + right) / 2;
      place(l, x0, midY, rx, ry);
      place(mid, x0 + left, midY, rx, ry);
      place(r, x0 + left + right, midY, rx, ry);
    }
  }
  for (const n of names) {
    const p = parentOf.get(n);
    if (!p) continue;
    const host = ovals.get(p);
    if (!host) throw new VizError("venn_diagram: a set sits inside a set that is itself inside another");
    // a subset sits on the side of its parent away from the other sets
    const others = [...ovals.values()].filter((o) => o.label !== p && !o.parent);
    const ax = others.length ? others.reduce((s, o) => s + o.cx, 0) / others.length : host.cx + 1;
    const dir = Math.sign(host.cx - ax) || -1;
    const siblings = names.filter((m) => parentOf.get(m) === p);
    const k = siblings.indexOf(n);
    const dy = siblings.length > 1 ? (k - (siblings.length - 1) / 2) * host.ry * 0.85 : host.ry * 0.12;
    place(n, host.cx + dir * host.rx * 0.38, host.cy + dy, host.rx * 0.42, host.ry * (siblings.length > 1 ? 0.36 : 0.46));
  }
  const all = names.map((n) => ovals.get(n)!);

  /* ---- regions, by sampling the real ovals ---- */
  const val = (o: Oval, x: number, y: number) => ((x - o.cx) / o.rx) ** 2 + ((y - o.cy) / o.ry) ** 2;
  const sig = (x: number, y: number) => key(all.filter((o) => val(o, x, y) <= 1).map((o) => o.label));
  const clearance = (x: number, y: number) => {
    let c = Math.min(x - U.x, U.x + U.w - x, y - U.y, U.y + U.h - y);
    for (const o of all) c = Math.min(c, Math.abs(1 - Math.sqrt(val(o, x, y))) * Math.min(o.rx, o.ry));
    return c;
  };
  const samples: { x: number; y: number; sig: string; c: number }[] = [];
  for (let x = U.x + GRID; x < U.x + U.w; x += GRID)
    for (let y = U.y + GRID; y < U.y + U.h; y += GRID)
      samples.push({ x, y, sig: sig(x, y), c: clearance(x, y) });
  const inRegion = (r: Region) => (s: { x: number; y: number }) =>
    r.ins.every((l) => val(ovals.get(l)!, s.x, s.y) <= 1) &&
    r.outs.every((l) => val(ovals.get(l)!, s.x, s.y) > 1);
  const regionOf = (v: Record<string, unknown>): Region => {
    const ins = labels(v.in).filter((l) => names.includes(l));
    const outs = labels(v.out).filter((l) => names.includes(l) && !ins.includes(l));
    return { ins, outs };
  };

  /* ---- set labels: on each oval's rim, away from the other sets ---- */
  const taken: { x: number; y: number }[] = [];
  const setLabels = all.map((o) => {
    if (o.parent) {
      const at = { x: o.cx, y: o.cy - o.ry + 10 };
      taken.push(at);
      return { o, ...at };
    }
    const others = all.filter((m) => m !== o && !m.parent);
    let vx = -1, vy = 0;
    if (others.length) {
      vx = o.cx - others.reduce((s, m) => s + m.cx, 0) / others.length;
      vy = o.cy - others.reduce((s, m) => s + m.cy, 0) / others.length;
    }
    const n0 = Math.hypot(vx, vy) || 1;
    let dx = vx / n0, dy = vy / n0 - 0.9; // away from the others, tilted up
    const n1 = Math.hypot(dx, dy) || 1;
    dx /= n1; dy /= n1;
    const t = Math.atan2(dy / o.ry, dx / o.rx);
    const x = Math.min(U.x + U.w - 8, Math.max(U.x + 8, o.cx + o.rx * Math.cos(t) + dx * 8));
    const y = Math.min(U.y + U.h - 4, Math.max(U.y + 12, o.cy + o.ry * Math.sin(t) + dy * 8 + 3));
    taken.push({ x, y });
    return { o, x, y };
  });

  /* ---- items, spread over their region ---- */
  const items = arr(spec.items).map((v) => obj(v)).map((v) => ({ text: str(v.text), r: regionOf(v) })).filter((v) => v.text);
  const notes = arr(spec.notes).map((v) => obj(v)).map((v) => ({ text: str(v.text), r: regionOf(v) })).filter((v) => v.text);
  const groups = new Map<string, number[]>();
  items.forEach((it, i) => {
    const k = key(it.r.ins);
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  const itemAt: { x: number; y: number }[] = new Array(items.length);
  for (const [k, idx] of groups) {
    const cands = samples.filter((s) => s.sig === k && s.c >= 6);
    if (cands.length === 0)
      throw new VizError(`venn_diagram: no region is inside exactly {${k.replace(/\|/g, ", ") || "none"}}`);
    const chosen: { x: number; y: number }[] = [];
    for (const i of idx) {
      let best = cands[0], score = -Infinity;
      for (const s of cands) {
        const d = Math.min(...[...chosen, ...taken].map((q) => Math.hypot(q.x - s.x, q.y - s.y)), 99);
        const sc = Math.min(s.c, d * 0.55);
        if (sc > score) { score = sc; best = s; }
      }
      chosen.push(best);
      itemAt[i] = best;
    }
    taken.push(...chosen);
  }
  const noteAt = notes.map((n) => {
    const cands = samples.filter(inRegion(n.r)).filter((s) => s.c >= 5);
    if (cands.length === 0) return null;
    let best = cands[0], score = -Infinity;
    for (const s of cands) {
      const d = Math.min(...taken.map((q) => Math.hypot(q.x - s.x, q.y - s.y)), 99);
      const sc = Math.min(s.c, d * 0.5);
      if (sc > score) { score = sc; best = s; }
    }
    taken.push(best);
    return best;
  });

  const shades = arr(spec.shade).map((v) => regionOf(obj(v)));
  const universe = typeof spec.universe === "string" ? spec.universe : null;

  /* ---- timeline: universe, sets, shading, items, notes ---- */
  const on = animOn && spec.animate !== "none";
  const tSet = (i: number) => 0.3 + i * 0.45;
  const tShade = tSet(all.length) + 0.1;
  const tItem = (i: number) => tShade + 0.4 + i * 0.18;
  const tNote = tItem(items.length) + 0.2;
  const tl = useVizTimeline(tNote + 0.6, on);
  const a = makeAnim(on, tl.ctrl);

  const id = (kind: "inc" | "exc", l: string) => `venn-${uid}-${kind}-${all.findIndex((o) => o.label === l)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Venn diagram" className="block w-full">
      <defs>
        {all.map((o) => (
          <g key={o.label}>
            <mask id={id("inc", o.label)} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <rect x="0" y="0" width={W} height={H} fill="black" />
              <ellipse cx={o.cx} cy={o.cy} rx={o.rx} ry={o.ry} fill="white" />
            </mask>
            <mask id={id("exc", o.label)} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
              <rect x="0" y="0" width={W} height={H} fill="white" />
              <ellipse cx={o.cx} cy={o.cy} rx={o.rx} ry={o.ry} fill="black" />
            </mask>
          </g>
        ))}
      </defs>
      <g key={tl.key}>
        {universe !== null && (
          <g>
            <rect x={U.x} y={U.y} width={U.w} height={U.h} rx="3" fill="none" stroke={INK_SOFT} strokeWidth="1.3"
              pathLength={100} style={a.draw(0.05, 0.6)} />
            {universe && (
              <text x={U.x + 6} y={U.y + 12} fontSize="9" fontWeight="700" fill={INK}
                style={{ fontFamily: MONO, ...a.fade(0.3) }}>
                {universe}
              </text>
            )}
          </g>
        )}
        {shades.map((r, k) => {
          let node = (
            <rect x={U.x} y={U.y} width={U.w} height={U.h} fill={ACCENT} fillOpacity={0.22} />
          );
          for (const l of r.ins) node = <g mask={`url(#${id("inc", l)})`}>{node}</g>;
          for (const l of r.outs) node = <g mask={`url(#${id("exc", l)})`}>{node}</g>;
          return <g key={`sh${k}`} style={a.fade(tShade, 0.6)}>{node}</g>;
        })}
        {all.map((o, i) => (
          <ellipse key={o.label} cx={o.cx} cy={o.cy} rx={o.rx} ry={o.ry} fill="none" stroke={INK}
            strokeWidth="1.6" pathLength={100} style={a.draw(tSet(i), 0.7)} />
        ))}
        {setLabels.map(({ o, x, y }, i) => (
          <text key={`l${o.label}`} x={x} y={y} fontSize="10" fontWeight="700" textAnchor="middle" fill={INK}
            style={{ fontFamily: MONO, ...a.fade(tSet(i) + 0.4) }}>
            {o.label}
          </text>
        ))}
        {items.map((it, i) => (
          <text key={`i${i}`} x={itemAt[i].x} y={itemAt[i].y + 3} fontSize="9" textAnchor="middle" fill={INK}
            style={{ fontFamily: MONO, ...a.pop(tItem(i)) }}>
            {it.text}
          </text>
        ))}
        {notes.map((n, i) =>
          noteAt[i] ? (
            <text key={`n${i}`} x={noteAt[i]!.x} y={noteAt[i]!.y + 3} fontSize="8" fontStyle="italic"
              textAnchor="middle" fill={INK_SOFT} style={{ fontFamily: MONO, ...a.fade(tNote) }}>
              {n.text}
            </text>
          ) : null
        )}
      </g>
    </svg>
  );
}

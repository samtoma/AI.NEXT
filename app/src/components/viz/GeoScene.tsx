"use client";

/**
 * geo_scene — generic geometry scene, elements appearing in step order.
 * spec: {elements:[{type:"circle"|"point"|"segment"|"chord"|"radius"|
 *        "diameter"|"tangent"|"arc"|"angle"|"label", ...fields, step:int}],
 *        animate:"sequence"}
 * The viewBox auto-fits the geometry (math orientation: y grows upward).
 */

import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK,
  INK_SOFT,
  MONO,
  VizError,
  arr,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

type El = Record<string, unknown> & { type: string; step: number };

const SEGMENT_TYPES = new Set(["segment", "chord", "radius", "diameter", "tangent"]);

export function GeoScene({ spec, animOn }: VizProps) {
  const els: El[] = arr(spec.elements)
    .map((raw, i) => {
      const e = obj(raw);
      return { ...e, type: str(e.type), step: num(e.step, i + 1) };
    })
    .filter((e) => e.type !== "");
  if (els.length === 0) throw new VizError("geo_scene: no elements");

  const firstCircle = els.find((e) => e.type === "circle");
  const circleOf = (e: El) => ({
    cx: num(e.cx, firstCircle ? num(firstCircle.cx, 0) : 0),
    cy: num(e.cy, firstCircle ? num(firstCircle.cy, 0) : 0),
    r: num(e.r, firstCircle ? num(firstCircle.r, 3) : 3),
  });
  const pt2 = (v: unknown): [number, number] | null => {
    if (!Array.isArray(v) || v.length < 2) return null;
    const x = num(v[0], NaN);
    const y = num(v[1], NaN);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  };

  /* bounding box over all geometry (world units, y up) */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const feed = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const e of els) {
    if (e.type === "circle" || e.type === "arc") {
      const { cx, cy, r } = circleOf(e);
      feed(cx - r, cy - r);
      feed(cx + r, cy + r);
    } else if (SEGMENT_TYPES.has(e.type)) {
      const f = pt2(e.from);
      const t = pt2(e.to);
      if (f) feed(...f);
      if (t) feed(...t);
    } else if (e.type === "point" || e.type === "label") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (Number.isFinite(x) && Number.isFinite(y)) feed(x, y);
    } else if (e.type === "angle") {
      const at = pt2(e.at);
      if (at) feed(...at);
    }
  }
  if (!Number.isFinite(minX)) throw new VizError("geo_scene: no drawable geometry");
  if (maxX - minX < 1e-6) { minX -= 3; maxX += 3; }
  if (maxY - minY < 1e-6) { minY -= 3; maxY += 3; }
  const padW = (maxX - minX) * 0.16 + 0.5;
  const padH = (maxY - minY) * 0.16 + 0.5;
  minX -= padW; maxX += padW; minY -= padH; maxY += padH;

  const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => [
    cx + r * Math.cos((deg * Math.PI) / 180),
    cy + r * Math.sin((deg * Math.PI) / 180),
  ];

  const W = 300;
  let H = Math.max(160, Math.min(260, (W * (maxY - minY)) / (maxX - minX)));
  let s = Math.min(W / (maxX - minX), H / (maxY - minY));

  /* labels render at fixed px sizes, so their world-unit extents depend on
     the scale: extend the bbox for text overhang, refit, repeat once so the
     new scale is accounted for. ~7px/char at the 8–8.5px mono sizes below. */
  const CHAR_W = 7;
  for (let pass = 0; pass < 2; pass++) {
    for (const e of els) {
      const label = str(e.label ?? e.text);
      if (!label) continue;
      const w = label.length * CHAR_W;
      if (e.type === "point") {
        // start-anchored at sx(x)+6, baseline sy(y)-5 → extends right + up
        const x = num(e.x, NaN);
        const y = num(e.y, NaN);
        if (Number.isFinite(x)) maxX = Math.max(maxX, x + (6 + w) / s);
        if (Number.isFinite(y)) maxY = Math.max(maxY, y + 14 / s);
        continue;
      }
      // remaining label kinds are middle-anchored: half width each side
      let ax: number | null = null;
      if (e.type === "circle") {
        const { cx, cy, r } = circleOf(e);
        ax = cx;
        maxY = Math.max(maxY, cy + r + 15 / s); // label sits above the top
      } else if (e.type === "arc") {
        const { cx, cy, r } = circleOf(e);
        const a0 = num(e.startDeg, 0);
        const sweep =
          (((num(e.endDeg, 90) - a0) % 360) + 360) % 360 || 360;
        ax = polar(cx, cy, r * 1.18, a0 + sweep / 2)[0];
      } else if (SEGMENT_TYPES.has(e.type)) {
        const f = pt2(e.from);
        const t = pt2(e.to);
        if (f && t) ax = (f[0] + t[0]) / 2;
      } else if (e.type === "angle") {
        const at = pt2(e.at);
        if (at)
          ax = polar(
            at[0],
            at[1],
            38 / s,
            (num(e.fromDeg, 0) + num(e.toDeg, 45)) / 2
          )[0];
      } else if (e.type === "label") {
        const x = num(e.x, NaN);
        if (Number.isFinite(x)) ax = x;
      }
      if (ax != null) {
        minX = Math.min(minX, ax - w / 2 / s);
        maxX = Math.max(maxX, ax + w / 2 / s);
      }
    }
    H = Math.max(160, Math.min(260, (W * (maxY - minY)) / (maxX - minX)));
    s = Math.min(W / (maxX - minX), H / (maxY - minY));
  }

  const ox = (W - s * (maxX - minX)) / 2;
  const oy = (H - s * (maxY - minY)) / 2;
  const sx = (x: number) => ox + (x - minX) * s;
  const sy = (y: number) => H - oy - (y - minY) * s; // flip: math y-up

  /* step timing — REAL steps: exposed to the board via stepTimes */
  const steps = [...new Set(els.map((e) => e.step))].sort((x, y) => x - y);
  const stepAt = new Map(steps.map((st, i) => [st, 0.4 + i * 0.65]));
  const stepTimes = steps.map((st) => stepAt.get(st) ?? 0.4);
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline(
    (stepTimes[stepTimes.length - 1] ?? 0.4) + 1.2,
    on,
    stepTimes
  );
  const a = makeAnim(on, tl.ctrl);

  const render = (e: El, i: number) => {
    const d = stepAt.get(e.step) ?? 0.4;
    const key = `e${i}`;
    const label = str(e.label ?? e.text);

    if (e.type === "circle") {
      const { cx, cy, r } = circleOf(e);
      return (
        <g key={key}>
          <circle
            cx={sx(cx)} cy={sy(cy)} r={r * s}
            fill="none" stroke={INK} strokeWidth="1.6"
            pathLength={100} style={a.draw(d, 0.9)}
          />
          {label && (
            <text x={sx(cx)} y={sy(cy + r) - 6} fontSize="8" textAnchor="middle" fill={INK_SOFT}
              style={{ fontFamily: MONO, ...a.fade(d + 0.6) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt2(e.from);
      const t = pt2(e.to);
      if (!f || !t) return null;
      const special = e.type === "tangent" ? GOLD : e.type === "chord" ? ACCENT : INK;
      const mx = (sx(f[0]) + sx(t[0])) / 2;
      const my = (sy(f[1]) + sy(t[1])) / 2;
      // perpendicular offset for the label
      const dx = sx(t[0]) - sx(f[0]);
      const dy = sy(t[1]) - sy(f[1]);
      const len = Math.hypot(dx, dy) || 1;
      const nx = (-dy / len) * 9;
      const ny = (dx / len) * 9;
      return (
        <g key={key}>
          <line
            x1={sx(f[0])} y1={sy(f[1])} x2={sx(t[0])} y2={sy(t[1])}
            stroke={special} strokeWidth={e.type === "diameter" || e.type === "radius" ? 1.8 : 1.6}
            strokeLinecap="round" pathLength={100} style={a.draw(d, 0.6)}
          />
          {label && (
            <text x={mx + nx} y={my + ny + 3} fontSize="8" fontWeight="600" textAnchor="middle"
              fill={special === INK ? INK_SOFT : special}
              style={{ fontFamily: MONO, ...a.fade(d + 0.45) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "point") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return (
        <g key={key}>
          <g style={a.pop(d)}>
            <circle cx={sx(x)} cy={sy(y)} r="4.5" fill={ACCENT} opacity="0.2" />
            <circle cx={sx(x)} cy={sy(y)} r="2.3" fill={ACCENT_DEEP} />
          </g>
          {label && (
            <text x={sx(x) + 6} y={sy(y) - 5} fontSize="8.5" fontWeight="700" fill={INK}
              style={{ fontFamily: MONO, ...a.fade(d + 0.2) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "arc") {
      const { cx, cy, r } = circleOf(e);
      const a0 = num(e.startDeg, 0);
      const a1 = num(e.endDeg, 90);
      const sweep = ((a1 - a0) % 360 + 360) % 360 || 360;
      const [px0, py0] = polar(cx, cy, r, a0);
      const [px1, py1] = polar(cx, cy, r, a0 + sweep);
      const large = sweep > 180 ? 1 : 0;
      const [lx, ly] = polar(cx, cy, r * 1.18, a0 + sweep / 2);
      return (
        <g key={key}>
          <path
            d={`M ${sx(px0).toFixed(1)} ${sy(py0).toFixed(1)} A ${r * s} ${r * s} 0 ${large} 0 ${sx(px1).toFixed(1)} ${sy(py1).toFixed(1)}`}
            fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round"
            pathLength={100} style={a.draw(d, 0.7)}
          />
          {label && (
            <text x={sx(lx)} y={sy(ly) + 3} fontSize="8" fontWeight="600" textAnchor="middle" fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(d + 0.5) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "angle") {
      const at = pt2(e.at);
      if (!at) return null;
      const a0 = num(e.fromDeg, 0);
      const a1 = num(e.toDeg, 45);
      const rPx = 22;
      const [wx0, wy0] = polar(at[0], at[1], rPx / s, a0);
      const [wx1, wy1] = polar(at[0], at[1], rPx / s, a1);
      const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
      const [lx, ly] = polar(at[0], at[1], (rPx + 16) / s, (a0 + a1) / 2);
      return (
        <g key={key}>
          <path
            d={`M ${sx(wx0).toFixed(1)} ${sy(wy0).toFixed(1)} A ${rPx} ${rPx} 0 ${large} 0 ${sx(wx1).toFixed(1)} ${sy(wy1).toFixed(1)}`}
            fill="none" stroke={GOLD} strokeWidth="1.6"
            pathLength={100} style={a.draw(d, 0.5)}
          />
          {label && (
            <text x={sx(lx)} y={sy(ly) + 3} fontSize="8.5" fontWeight="700" textAnchor="middle" fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(d + 0.35) }}>
              {label}
            </text>
          )}
        </g>
      );
    }

    if (e.type === "label") {
      const x = num(e.x, NaN);
      const y = num(e.y, NaN);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !label) return null;
      return (
        <text key={key} x={sx(x)} y={sy(y)} fontSize="8.5" fontWeight="600" textAnchor="middle"
          fill={INK} style={{ fontFamily: MONO, ...a.fade(d) }}>
          {label}
        </text>
      );
    }

    return null; // unknown element type — skip, never crash
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="geometry scene" className="block w-full">
      <g key={tl.key}>{els.map(render)}</g>
    </svg>
  );
}

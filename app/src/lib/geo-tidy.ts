/**
 * TIDY A DRAWN GEOMETRY SCENE before it is drawn (geo_scene, VIZ_SPEC v4).
 *
 * The drawing step writes coordinates by reading the book's picture, and two
 * slips recur that leave a figure looking wrong though every number is "close":
 *
 *   a crossed polygon  the corners listed out of order (A, B, C, D for a shape
 *                      whose order round is A, B, D, C): the outline crosses
 *                      itself and two real sides are never drawn (pp3u10-3
 *                      figure 16). A figure's polygon is never meant to cross,
 *                      so a crossing one is re-ordered round its centre.
 *   a stray crossing   a point the book puts where two lines cross (the
 *                      diagonals' E) written a little off the crossing, so it
 *                      and its angle mark float beside it (figures 18, 19). A
 *                      labelled point that ends no line, near a crossing of
 *                      two drawn lines, is moved onto it — with any angle mark
 *                      at it.
 *
 * Nothing else moves. Pure and dependency-free, so `node --test` loads it.
 */

type P2 = [number, number];
export type GeoEl = Record<string, unknown> & { type: string };

const SEGMENT_TYPES = new Set(["segment", "chord", "radius", "diameter", "tangent"]);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const pt = (v: unknown): P2 | null => (Array.isArray(v) && isNum(v[0]) && isNum(v[1]) ? [v[0], v[1]] : null);
const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** where segments ab and cd cross, strictly inside both, or null */
function crossing(a: P2, b: P2, c: P2, d: P2): P2 | null {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
}

function selfCrossing(ps: P2[]): boolean {
  const n = ps.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing edge
      if (crossing(ps[i], ps[(i + 1) % n], ps[j], ps[(j + 1) % n])) return true;
    }
  return false;
}

export function tidyGeoElements<E extends GeoEl>(els: E[]): E[] {
  // 1. a crossed polygon goes round its centre instead
  let out = els.map((e) => {
    if (e.type !== "polygon" || !Array.isArray(e.points)) return e;
    const ps = e.points.map(pt);
    if (ps.length < 4 || ps.some((p) => !p) || !selfCrossing(ps as P2[])) return e;
    const c: P2 = [
      (ps as P2[]).reduce((s, p) => s + p[0], 0) / ps.length,
      (ps as P2[]).reduce((s, p) => s + p[1], 0) / ps.length,
    ];
    const round = [...(ps as P2[])].sort(
      (p, q) => Math.atan2(p[1] - c[1], p[0] - c[0]) - Math.atan2(q[1] - c[1], q[0] - c[0])
    );
    return { ...e, points: round };
  });

  // 2. a labelled point near a crossing of two drawn lines goes onto it
  const all = out.flatMap((e) => {
    const xs: P2[] = [];
    for (const k of ["from", "to", "at"]) { const p = pt(e[k]); if (p) xs.push(p); }
    if (isNum(e.x) && isNum(e.y)) xs.push([e.x, e.y]);
    if (Array.isArray(e.points)) for (const p of e.points) { const q = pt(p); if (q) xs.push(q); }
    return xs;
  });
  if (all.length < 2) return out;
  const span = Math.max(
    Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])),
    1e-6
  );
  const edges: [P2, P2][] = [];
  for (const e of out) {
    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt(e.from), t = pt(e.to);
      if (f && t) edges.push([f, t]);
    } else if (e.type === "polygon" && Array.isArray(e.points)) {
      const ps = e.points.map(pt).filter((p): p is P2 => !!p);
      ps.forEach((p, i) => edges.push([p, ps[(i + 1) % ps.length]]));
    }
  }
  const crossings: P2[] = [];
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const x = crossing(edges[i][0], edges[i][1], edges[j][0], edges[j][1]);
      if (x) crossings.push(x);
    }
  if (crossings.length === 0) return out;
  const endEps = span * 0.01;
  const snapR = span * 0.1; // figure 19 wrote E 0.42 off the crossing in a 5.4-wide figure
  const moves: [P2, P2][] = [];
  out = out.map((e) => {
    if (e.type !== "point" || !isNum(e.x) || !isNum(e.y) || !e.label) return e;
    const p: P2 = [e.x, e.y];
    if (edges.some(([f, t]) => dist(f, p) < endEps || dist(t, p) < endEps)) return e; // it ends a line: leave it
    let best: P2 | null = null;
    for (const x of crossings) if (dist(x, p) < snapR && (!best || dist(x, p) < dist(best, p))) best = x;
    if (!best || dist(best, p) < 1e-9) return e;
    moves.push([p, best]);
    return { ...e, x: best[0], y: best[1] };
  });
  if (moves.length === 0) return out;
  return out.map((e) => {
    const at = e.type === "angle" ? pt(e.at) : null;
    const m = at && moves.find(([from]) => dist(from, at) < endEps * 2);
    return m ? { ...e, at: m[1] } : e;
  });
}

/**
 * AN ANGLE MARK SITS ON ITS ARMS. A producer writes an angle's fromDeg/toDeg
 * by eye, a few degrees off the lines it actually drew, so the arc stopped
 * short of one arm or crossed it. Each end snaps to the nearest line drawn
 * through the vertex (within 25°), and the mark is always the angle under
 * 180°, whichever order the two directions came in. Returns [from, to] with
 * to − from in [0, 180].
 */
export function angleSpan(els: GeoEl[], e: GeoEl): [number, number] {
  let a0 = isNum(e.fromDeg) ? e.fromDeg : 0;
  let a1 = isNum(e.toDeg) ? e.toDeg : 45;
  const at = pt(e.at);
  if (at) {
    const arms = armsAt(els, at);
    const wrap = (d: number) => ((d % 360) + 540) % 360 - 180;
    const snap = (d: number, not?: number) => {
      let best = d, gap = 25;
      for (const r of arms) {
        const g = Math.abs(wrap(r - d));
        if (g < gap && (not === undefined || Math.abs(wrap(r - not)) > 1)) { gap = g; best = r; }
      }
      return best;
    };
    a0 = snap(a0);
    a1 = snap(a1, a0);
  }
  const sweep = ((a1 - a0) % 360 + 360) % 360;
  return sweep > 180 ? [a1, a1 + 360 - sweep] : [a0, a0 + sweep];
}

/** the directions (degrees) of every drawn line leaving the point v */
export function armsAt(els: GeoEl[], v: P2): number[] {
  const all: P2[] = [];
  for (const e of els) for (const k of ["from", "to", "at"]) { const p = pt(e[k]); if (p) all.push(p); }
  const span = all.length
    ? Math.max(Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])), 1e-6)
    : 1;
  const eps = span * 0.025;
  const dir = (to: P2) => (Math.atan2(to[1] - v[1], to[0] - v[0]) * 180) / Math.PI;
  const out: number[] = [];
  const edge = (f: P2, t: P2) => {
    const len = dist(f, t);
    if (len < eps) return;
    if (dist(f, v) < eps) return void out.push(dir(t));
    if (dist(t, v) < eps) return void out.push(dir(f));
    // the vertex inside a line (diagonals crossing, a point on a side): both ways
    const k = ((v[0] - f[0]) * (t[0] - f[0]) + (v[1] - f[1]) * (t[1] - f[1])) / (len * len);
    const off = Math.abs((t[0] - f[0]) * (f[1] - v[1]) - (f[0] - v[0]) * (t[1] - f[1])) / len;
    if (k > 0 && k < 1 && off < eps) out.push(dir(t), dir(f));
  };
  for (const e of els) {
    if (SEGMENT_TYPES.has(e.type)) {
      const f = pt(e.from), t = pt(e.to);
      if (f && t) edge(f, t);
    } else if (e.type === "polygon" && Array.isArray(e.points)) {
      const ps = e.points.map(pt).filter((p): p is P2 => !!p);
      ps.forEach((p, i) => edge(p, ps[(i + 1) % ps.length]));
    }
  }
  return out;
}

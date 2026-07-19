"use client";

/**
 * function_graph — animated curve draw; vertex/intercept reveals.
 * spec: {fn:"linear"|"quadratic", coefs:[a,b]|[a,b,c], domain:[min,max],
 *        markers:[{x,label}]?, reveals:["vertex","axis","roots"]?, animate:"draw"}
 */

import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  MONO,
  RUST,
  VizError,
  arr,
  fmtNum,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { PlaneFrame, makePlane } from "./plane";

export function FunctionGraph({ spec, animOn }: VizProps) {
  const coefs = arr(spec.coefs).map((c) => num(c));
  const fn =
    spec.fn === "quadratic" || (spec.fn == null && coefs.length === 3)
      ? "quadratic"
      : "linear";
  if (fn === "quadratic" && coefs.length < 3)
    throw new VizError("function_graph: quadratic needs coefs [a,b,c]");
  if (fn === "linear" && coefs.length < 2)
    throw new VizError("function_graph: linear needs coefs [a,b]");
  const f =
    fn === "quadratic"
      ? (x: number) => coefs[0] * x * x + coefs[1] * x + coefs[2]
      : (x: number) => coefs[0] * x + coefs[1];

  const [d0, d1] = ((): [number, number] => {
    const r = arr(spec.domain).map((v) => num(v, NaN));
    return r.length >= 2 && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1]
      ? [r[0], r[1]]
      : [-5, 5];
  })();

  const reveals = new Set(arr(spec.reveals).map((r) => str(r)));
  const markers = arr(spec.markers)
    .map((m) => obj(m))
    .filter((m) => Number.isFinite(num(m.x, NaN)))
    .map((m) => ({ x: num(m.x), label: str(m.label) }));

  // sample the curve, derive the y-range with padding
  const N = 64;
  const xs = Array.from({ length: N + 1 }, (_, i) => d0 + ((d1 - d0) * i) / N);
  const ys = xs.map(f);
  let yMin = Math.min(...ys, 0);
  let yMax = Math.max(...ys, 0);
  const yPad = Math.max((yMax - yMin) * 0.12, 0.5);
  yMin -= yPad;
  yMax += yPad;

  const p = makePlane([d0 - 0.4, d1 + 0.4], [yMin, yMax], 300, 240);
  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"} ${p.sx(x).toFixed(1)} ${p.sy(ys[i]).toFixed(1)}`)
    .join(" ");

  // reveals (quadratic anatomy)
  const a2 = coefs[0];
  const vx = fn === "quadratic" && a2 !== 0 ? -coefs[1] / (2 * a2) : null;
  const vy = vx != null ? f(vx) : null;
  const roots: number[] = [];
  if (fn === "quadratic" && a2 !== 0) {
    const disc = coefs[1] * coefs[1] - 4 * a2 * coefs[2];
    if (disc >= 0) {
      roots.push((-coefs[1] - Math.sqrt(disc)) / (2 * a2));
      if (disc > 0) roots.push((-coefs[1] + Math.sqrt(disc)) / (2 * a2));
    }
  } else if (fn === "linear" && coefs[0] !== 0) {
    roots.push(-coefs[1] / coefs[0]);
  }
  const inDomain = (x: number) => x >= d0 - 1e-9 && x <= d1 + 1e-9;

  const on = animOn && spec.animate !== "none";
  const T_DRAW = 1.6;
  let t = 0.35 + T_DRAW + 0.25;
  const seq: { key: string; at: number }[] = [];
  const schedule = (key: string) => {
    seq.push({ key, at: t });
    t += 0.55;
  };
  if (reveals.has("axis") && vx != null) schedule("axis");
  if (reveals.has("vertex") && vx != null) schedule("vertex");
  if (reveals.has("roots") && roots.length) schedule("roots");
  for (let i = 0; i < markers.length; i++) schedule(`marker${i}`);
  const at = (key: string) => seq.find((s) => s.key === key)?.at ?? t;
  const tl = useVizTimeline(t, on);
  const a = makeAnim(on, tl.ctrl);

  const eq =
    fn === "quadratic"
      ? `f(x) = ${fmtTerm(coefs[0], "x²", true)}${fmtTerm(coefs[1], "x")}${fmtTerm(coefs[2], "")}`
      : coefs[0] === 0
        ? `f(x) = ${fmtNum(coefs[1])}`
        : `f(x) = ${fmtTerm(coefs[0], "x", true)}${fmtTerm(coefs[1], "")}`;

  return (
    <svg viewBox={`0 0 ${p.W} ${p.H}`} role="img" aria-label={eq} className="block w-full">
      <PlaneFrame p={p} />
      <text
        x={p.W - 10}
        y={16}
        fontSize="8.5"
        fontWeight="600"
        fill={ACCENT_DEEP}
        textAnchor="end"
        style={{ fontFamily: MONO }}
      >
        {eq}
      </text>

      <g key={tl.key}>
        {/* the curve draws itself */}
        <path
          d={path}
          fill="none"
          stroke={ACCENT}
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength={100}
          style={a.draw(0.35, T_DRAW)}
        />

        {/* axis of symmetry */}
        {reveals.has("axis") && vx != null && inDomain(vx) && (
          <g>
            <line
              x1={p.sx(vx)}
              y1={p.sy(p.y0)}
              x2={p.sx(vx)}
              y2={p.sy(p.y1)}
              stroke={GOLD}
              strokeWidth="1.2"
              strokeDasharray="4 3"
              pathLength={100}
              style={{ ...a.draw(at("axis"), 0.5), strokeDasharray: on ? undefined : "4 3" }}
            />
            <text
              x={p.sx(vx) + 4}
              y={p.sy(p.y1) + 10}
              fontSize="7"
              fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(at("axis") + 0.3) }}
            >
              x = {fmtNum(vx)}
            </text>
          </g>
        )}

        {/* vertex */}
        {reveals.has("vertex") && vx != null && vy != null && (
          <g>
            <g style={a.pop(at("vertex"))}>
              <circle cx={p.sx(vx)} cy={p.sy(vy)} r="6" fill={GOLD} opacity="0.22" />
              <circle cx={p.sx(vx)} cy={p.sy(vy)} r="3" fill={GOLD} />
            </g>
            <text
              x={p.sx(vx) + 7}
              y={p.sy(vy) + (a2 > 0 ? 11 : -7)}
              fontSize="7.5"
              fontWeight="600"
              fill={GOLD}
              style={{ fontFamily: MONO, ...a.fade(at("vertex") + 0.2) }}
            >
              vertex ({fmtNum(vx)}, {fmtNum(vy)})
            </text>
          </g>
        )}

        {/* roots */}
        {reveals.has("roots") &&
          roots.filter(inDomain).map((r, i) => (
            <g key={`r${i}`}>
              <g style={a.pop(at("roots") + i * 0.25)}>
                <circle cx={p.sx(r)} cy={p.sy(0)} r="5" fill={RUST} opacity="0.22" />
                <circle cx={p.sx(r)} cy={p.sy(0)} r="2.6" fill={RUST} />
              </g>
              <text
                x={p.sx(r)}
                y={p.sy(0) - 8}
                fontSize="7"
                fontWeight="600"
                fill={RUST}
                textAnchor="middle"
                style={{ fontFamily: MONO, ...a.fade(at("roots") + i * 0.25 + 0.2) }}
              >
                {fmtNum(r)}
              </text>
            </g>
          ))}

        {/* markers: stand at x, read the height */}
        {markers.map((m, i) => {
          const my = f(m.x);
          const d = at(`marker${i}`);
          return (
            <g key={`m${i}`}>
              <line
                x1={p.sx(m.x)} y1={p.sy(0)} x2={p.sx(m.x)} y2={p.sy(my)}
                stroke={ACCENT_DEEP} strokeWidth="1" strokeDasharray="3 2.5" opacity="0.6"
                pathLength={100}
                style={a.draw(d, 0.4)}
              />
              <g style={a.pop(d + 0.3)}>
                <circle cx={p.sx(m.x)} cy={p.sy(my)} r="5.5" fill={ACCENT_DEEP} opacity="0.2" />
                <circle cx={p.sx(m.x)} cy={p.sy(my)} r="2.8" fill={ACCENT_DEEP} />
              </g>
              <text
                x={p.sx(m.x) + 7}
                y={p.sy(my) - 6}
                fontSize="7.5"
                fontWeight="600"
                fill={ACCENT_DEEP}
                style={{ fontFamily: MONO, ...a.fade(d + 0.45) }}
              >
                {m.label || `f(${fmtNum(m.x)}) = ${fmtNum(my)}`}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** "+2x", "−3", "x²" … signed pretty-printed polynomial term. */
function fmtTerm(c: number, sym: string, lead = false): string {
  if (c === 0) return sym && lead ? `0${sym}` : "";
  const sign = c < 0 ? "−" : lead ? "" : "+";
  const mag = Math.abs(c);
  const coef = sym && mag === 1 ? "" : fmtNum(mag);
  return `${sign}${coef}${sym}`;
}

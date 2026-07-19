"use client";

/**
 * trig_triangle — right triangle, one acute angle marked; the two sides of
 * the chosen ratio pulse-highlight while the ratio formula assembles.
 * spec: {angleDeg:30|45|60|"θ", emphasize:"sin"|"cos"|"tan",
 *        sides:{opp?,adj?,hyp?}, animate:"ratio-highlight"}
 * Side values may be numbers or surd strings ("√3", "2√2") — kept verbatim
 * for display, parsed numerically for geometry; missing sides come from
 * Pythagoras.
 */

import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK,
  INK_FAINT,
  INK_SOFT,
  MONO,
  VizError,
  makeAnim,
  obj,
  rootNum,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";

export function TrigTriangle({ spec, animOn }: VizProps) {
  const sides = obj(spec.sides);
  const raw = {
    opp: sides.opp,
    adj: sides.adj,
    hyp: sides.hyp,
  };
  let opp = raw.opp != null ? rootNum(raw.opp) : null;
  let adj = raw.adj != null ? rootNum(raw.adj) : null;
  let hyp = raw.hyp != null ? rootNum(raw.hyp) : null;
  // fill the missing side via Pythagoras
  if (opp == null && adj != null && hyp != null && hyp > adj)
    opp = Math.sqrt(hyp * hyp - adj * adj);
  if (adj == null && opp != null && hyp != null && hyp > opp)
    adj = Math.sqrt(hyp * hyp - opp * opp);
  if (hyp == null && opp != null && adj != null)
    hyp = Math.sqrt(opp * opp + adj * adj);
  if (opp == null || adj == null || hyp == null || opp <= 0 || adj <= 0) {
    // graceful default: the classic 3-4-5
    opp = 3;
    adj = 4;
    hyp = 5;
  }

  const emphasize =
    spec.emphasize === "cos" || spec.emphasize === "tan" ? spec.emphasize : "sin";
  const angleLabel = (() => {
    const v = spec.angleDeg;
    if (typeof v === "number" && Number.isFinite(v)) return `${v}°`;
    const s = str(v, "θ");
    return s === "" ? "θ" : s;
  })();

  const label = (side: "opp" | "adj" | "hyp"): string => {
    const r = raw[side];
    if (typeof r === "string" && r.trim() !== "") return r.trim();
    if (typeof r === "number") return fmtSide(r);
    return fmtSide(side === "opp" ? opp! : side === "adj" ? adj! : hyp!);
  };

  /* layout: right angle at C (bottom-left), θ at B (bottom-right) */
  const W = 300;
  const H = 220;
  const PAD = 34;
  const scale = Math.min((W - 2 * PAD) / adj, (H - 2 * PAD - 20) / opp);
  const C = { x: (W - adj * scale) / 2, y: H - PAD };
  const B = { x: C.x + adj * scale, y: C.y };
  const A = { x: C.x, y: C.y - opp * scale };

  const parts: Record<"sin" | "cos" | "tan", ["opp" | "adj", "hyp" | "adj"]> = {
    sin: ["opp", "hyp"],
    cos: ["adj", "hyp"],
    tan: ["opp", "adj"],
  };
  const [numer, denom] = parts[emphasize];
  const emphasized = new Set([numer, denom]);

  const on = animOn && spec.animate !== "none";
  const T_LABELS = 2.3;
  const T_RATIO = T_LABELS + 0.9;
  const tl = useVizTimeline(T_RATIO + 1.6, on);
  const a = makeAnim(on, tl.ctrl);

  const sideStroke = (side: "opp" | "adj" | "hyp") =>
    emphasized.has(side) ? ACCENT : INK;
  const sideStyle = (side: "opp" | "adj" | "hyp", drawAt: number) => {
    const base = a.draw(drawAt, 0.55);
    // append the emphasis pulse only when the draw actually animates
    // (final/hidden states from the timeline ctrl pass through untouched)
    if (emphasized.has(side) && typeof base.animation === "string") {
      return {
        ...base,
        animation: `${base.animation}, viz-pulse 1.6s ease-in-out ${T_RATIO + 0.2}s 2`,
      };
    }
    return base;
  };

  // angle arc at B (interior, from BA direction to BC direction)
  const arcR = Math.min(30, adj * scale * 0.4);
  const angAtB = Math.atan2(opp * scale, adj * scale); // interior angle magnitude
  const arcStart = {
    x: B.x - arcR,
    y: B.y,
  };
  const arcEnd = {
    x: B.x - arcR * Math.cos(angAtB),
    y: B.y - arcR * Math.sin(angAtB),
  };

  const sq = 11; // right-angle marker size
  if (!Number.isFinite(scale) || scale <= 0)
    throw new VizError("trig_triangle: degenerate sides");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="right triangle" className="block w-full">
      <g key={tl.key}>
        {/* sides draw in: adj → opp → hyp */}
        <line x1={C.x} y1={C.y} x2={B.x} y2={B.y}
          stroke={sideStroke("adj")} strokeWidth={emphasized.has("adj") ? 2.6 : 1.8}
          strokeLinecap="round" pathLength={100} style={sideStyle("adj", 0.3)} />
        <line x1={C.x} y1={C.y} x2={A.x} y2={A.y}
          stroke={sideStroke("opp")} strokeWidth={emphasized.has("opp") ? 2.6 : 1.8}
          strokeLinecap="round" pathLength={100} style={sideStyle("opp", 0.75)} />
        <line x1={B.x} y1={B.y} x2={A.x} y2={A.y}
          stroke={sideStroke("hyp")} strokeWidth={emphasized.has("hyp") ? 2.6 : 1.8}
          strokeLinecap="round" pathLength={100} style={sideStyle("hyp", 1.2)} />

        {/* right-angle marker at C */}
        <path
          d={`M ${C.x + sq} ${C.y} L ${C.x + sq} ${C.y - sq} L ${C.x} ${C.y - sq}`}
          fill="none" stroke={INK_SOFT} strokeWidth="1.2"
          style={a.fade(1.7, 0.3)}
        />

        {/* acute angle arc + label at B */}
        <path
          d={`M ${arcStart.x} ${arcStart.y} A ${arcR} ${arcR} 0 0 1 ${arcEnd.x.toFixed(1)} ${arcEnd.y.toFixed(1)}`}
          fill="none" stroke={GOLD} strokeWidth="1.6" pathLength={100}
          style={a.draw(1.9, 0.4)}
        />
        <text
          x={B.x - arcR - 13}
          y={B.y - arcR * 0.32}
          fontSize="10.5" fontWeight="700" fill={GOLD}
          style={{ fontFamily: MONO, ...a.pop(2.1) }}
        >
          {angleLabel}
        </text>

        {/* side value labels + role captions */}
        <SideLabel x={(C.x + B.x) / 2} y={C.y + 14} v={label("adj")} role="adjacent"
          hot={emphasized.has("adj")} at={T_LABELS} a={a} />
        <SideLabel x={C.x - 13} y={(C.y + A.y) / 2} v={label("opp")} role="opposite"
          hot={emphasized.has("opp")} at={T_LABELS + 0.15} a={a} vertical />
        <SideLabel x={(A.x + B.x) / 2 + 13} y={(A.y + B.y) / 2 - 8} v={label("hyp")} role="hypotenuse"
          hot={emphasized.has("hyp")} at={T_LABELS + 0.3} a={a} />

        {/* the ratio, assembled */}
        <g style={a.pop(T_RATIO)}>
          <text x={W / 2} y={26} fontSize="12" fontWeight="700" textAnchor="middle" fill={ACCENT_DEEP}
            style={{ fontFamily: MONO }}>
            {emphasize} {angleLabel} = {label(numer)}/{label(denom)}
          </text>
          <text x={W / 2} y={38} fontSize="7.5" textAnchor="middle" fill={INK_FAINT}
            style={{ fontFamily: MONO, letterSpacing: "0.1em" }}>
            {numer === "opp" ? "opposite" : "adjacent"} ÷ {denom === "hyp" ? "hypotenuse" : "adjacent"}
          </text>
        </g>
      </g>

      {/* vertex names (static) */}
      <text x={A.x - 5} y={A.y - 6} fontSize="8.5" fontWeight="600" fill={INK} style={{ fontFamily: MONO }}>A</text>
      <text x={B.x + 5} y={B.y + 4} fontSize="8.5" fontWeight="600" fill={INK} style={{ fontFamily: MONO }}>B</text>
      <text x={C.x - 11} y={C.y + 4} fontSize="8.5" fontWeight="600" fill={INK} style={{ fontFamily: MONO }}>C</text>
    </svg>
  );
}

function SideLabel({
  x, y, v, role, hot, at, a, vertical,
}: {
  x: number;
  y: number;
  v: string;
  role: string;
  hot: boolean;
  at: number;
  a: ReturnType<typeof makeAnim>;
  vertical?: boolean;
}) {
  return (
    <g style={a.fade(at, 0.4)}>
      <text
        x={x} y={y} fontSize="9.5" fontWeight="700" textAnchor="middle"
        fill={hot ? ACCENT_DEEP : INK}
        style={{ fontFamily: MONO }}
        transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}
      >
        {v}
      </text>
      <text
        x={vertical ? x - 9 : x} y={vertical ? y : y + 9} fontSize="6" textAnchor="middle"
        fill={hot ? ACCENT : INK_FAINT}
        style={{ fontFamily: MONO, letterSpacing: "0.08em" }}
        transform={vertical ? `rotate(-90 ${x - 9} ${y})` : undefined}
      >
        {role}
      </text>
    </g>
  );
}

function fmtSide(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

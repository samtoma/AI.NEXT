"use client";

/**
 * map_scene — the signature social-studies primitive: a named base map with
 * marks appearing in step order (VIZ_SPEC v2).
 *
 * spec: {base:"egypt", marks:[
 *          {kind:"point"|"region"|"route"|"badge"|"label",
 *           place:"القاهرة",            // gazetteer name (point/region/badge)
 *           through:["طولون","الإسكندرية"], // route waypoints, in order
 *           label?, color?, step?}],
 *        animate:"sequence"|"none"}
 *
 * Content refers to PLACE NAMES resolved via the base's gazetteer — never
 * raw coordinates. Unresolvable names degrade to a skipped mark (the base
 * map still renders); an unknown base is a spec error.
 */

import {
  ACCENT,
  ACCENT_DEEP,
  GOLD,
  INK,
  RUST,
  VizError,
  arr,
  colorOf,
  makeAnim,
  num,
  obj,
  str,
  useVizTimeline,
  type VizProps,
} from "./core";
import { arDigits } from "./arabic";
import { BASE_MAPS, resolvePlace, useBaseMap, type BaseMap } from "./maps";

interface Mark {
  kind: string;
  step: number;
  label: string;
  color: string;
  placeName: string;
  through: string[];
}

/** halo so Arabic labels stay readable over coastlines */
const HALO: React.CSSProperties = {
  paintOrder: "stroke",
  stroke: "var(--card-warm, #faf6e9)",
  strokeWidth: 3,
  strokeLinejoin: "round",
};

export function MapScene({ spec, animOn }: VizProps) {
  const base = str(spec.base);
  const known = (BASE_MAPS as readonly string[]).includes(base);
  const { map, status } = useBaseMap(known ? base : "egypt");

  const marks: Mark[] = arr(spec.marks ?? spec.layers)
    .map((raw, i) => {
      const m = obj(raw);
      const kind = str(m.kind ?? m.type, "point");
      return {
        kind: kind === "marker" ? "point" : kind,
        step: num(m.step, i + 1),
        label: str(m.label),
        color: str(m.color ?? m.tint),
        placeName: str(m.place ?? m.at),
        through: arr(m.through ?? m.points ?? m.via ?? m.route).map((p) => str(p)),
      };
    })
    .filter((m) => m.kind !== "");

  const steps = [...new Set(marks.map((m) => m.step))].sort((a, b) => a - b);
  const stepAt = new Map(steps.map((s, i) => [s, 0.5 + i * 0.8]));
  const stepTimes = steps.map((s) => stepAt.get(s) ?? 0.5);
  const on = animOn && spec.animate !== "none";
  const tl = useVizTimeline((stepTimes[stepTimes.length - 1] ?? 0.5) + 1.4, on, stepTimes);
  const a = makeAnim(on, tl.ctrl);

  if (!known) throw new VizError(`map_scene: unknown base "${base || "?"}"`);
  if (status === "error") throw new VizError(`map_scene: assets for "${base}" failed to load`);
  if (!map) {
    return (
      <div
        className="flex h-40 items-center justify-center rounded bg-card-warm font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint"
        dir="rtl"
      >
        الخريطة بتتحمّل…
      </div>
    );
  }

  const [, , W, H] = map.viewBox;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`خريطة ${base}`}
      className="block w-full"
      style={{ fontFamily: "var(--font-spline), system-ui, sans-serif" }}
    >
      {/* base art (static ink layer, drawn once per asset) */}
      <g dangerouslySetInnerHTML={{ __html: map.inner }} />
      {/* marks (the animated data layer) */}
      <g key={tl.key}>{marks.map((m, i) => renderMark(map, m, i, stepAt, a))}</g>
    </svg>
  );
}

type Anim = ReturnType<typeof makeAnim>;

function renderMark(
  map: BaseMap,
  m: Mark,
  i: number,
  stepAt: Map<number, number>,
  a: Anim
) {
  const d = stepAt.get(m.step) ?? 0.5;
  const key = `m${i}`;

  if (m.kind === "route") {
    const pts = m.through
      .map((n) => resolvePlace(map, n))
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .map((r) => r.place.at);
    if (pts.length < 2) return null;
    const color = colorOf(m.color, RUST);
    // gentle quadratic smoothing through midpoints
    let path = `M${pts[0][0]},${pts[0][1]}`;
    for (let j = 1; j < pts.length - 1; j++) {
      const mx = (pts[j][0] + pts[j + 1][0]) / 2;
      const my = (pts[j][1] + pts[j + 1][1]) / 2;
      path += ` Q${pts[j][0]},${pts[j][1]} ${mx},${my}`;
    }
    path += ` L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
    const [x1, y1] = pts[pts.length - 2];
    const [x2, y2] = pts[pts.length - 1];
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    return (
      <g key={key}>
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={100}
          style={a.draw(d, 1.1)}
        />
        {pts.slice(0, -1).map(([x, y], j) => (
          <circle key={j} cx={x} cy={y} r="2.4" fill={color} style={a.pop(d + 0.2 + j * 0.15)} />
        ))}
        <path
          d={`M${x2},${y2} l-8,-3.4 l2.5,3.4 l-2.5,3.4 Z`}
          fill={color}
          transform={`rotate(${ang.toFixed(1)} ${x2} ${y2})`}
          style={a.pop(d + 1.0)}
        />
        {m.label && (
          <text
            x={(x1 + x2) / 2}
            y={(y1 + y2) / 2 - 8}
            fontSize="9.5"
            fontWeight="600"
            textAnchor="middle"
            fill={color}
            style={{ ...HALO, ...a.fade(d + 1.1) }}
          >
            {arDigits(m.label)}
          </text>
        )}
      </g>
    );
  }

  const hit = resolvePlace(map, m.placeName);
  if (!hit) return null;
  const [x, y] = hit.place.at;
  const label = m.label || hit.name;

  if (m.kind === "region") {
    const color = colorOf(m.color, ACCENT);
    const ref = hit.place.ref;
    const dPath = ref ? map.paths[ref] : undefined;
    return (
      <g key={key}>
        {/* NB: opacity must live in fill-opacity — viz-fade/viz-pop animate
            the opacity property to 1 and would override an opacity attr */}
        {dPath ? (
          <>
            <path d={dPath} fill={color} fillOpacity="0.16" style={a.fade(d, 0.7)} />
            <path
              d={dPath}
              fill="none"
              stroke={color}
              strokeWidth="1.5"
              strokeLinejoin="round"
              pathLength={100}
              style={a.draw(d, 1.0)}
            />
          </>
        ) : (
          <ellipse
            cx={x}
            cy={y}
            rx={hit.place.r}
            ry={hit.place.r * 0.72}
            fill={color}
            fillOpacity="0.16"
            stroke={color}
            strokeWidth="1.3"
            strokeDasharray="4 3"
            style={a.fade(d, 0.7)}
          />
        )}
        <text
          x={x}
          y={y + 3}
          fontSize="10"
          fontWeight="700"
          textAnchor="middle"
          fill={INK}
          style={{ ...HALO, ...a.fade(d + 0.5) }}
        >
          {arDigits(label)}
        </text>
      </g>
    );
  }

  if (m.kind === "badge") {
    const color = colorOf(m.color, GOLD);
    const w = Math.max(30, label.length * 5.4 + 14);
    return (
      <g key={key} style={a.pop(d + 0.15)}>
        <g transform={`rotate(-6 ${x} ${y})`}>
          <rect
            x={x - w / 2}
            y={y - 9}
            width={w}
            height={18}
            rx="3.5"
            fill="var(--card, #fdfbf3)"
            stroke={color}
            strokeWidth="1.5"
            opacity="0.92"
          />
          <text
            x={x}
            y={y + 3.2}
            fontSize="8.5"
            fontWeight="700"
            textAnchor="middle"
            fill={color}
          >
            {arDigits(label)}
          </text>
        </g>
      </g>
    );
  }

  if (m.kind === "label") {
    return (
      <text
        key={key}
        x={x}
        y={y + 3}
        fontSize="9.5"
        fontWeight="600"
        textAnchor="middle"
        fill={INK}
        style={{ ...HALO, ...a.fade(d) }}
      >
        {arDigits(label)}
      </text>
    );
  }

  // default: point marker
  const color = colorOf(m.color, ACCENT_DEEP);
  return (
    <g key={key}>
      <g style={a.pop(d)}>
        <circle cx={x} cy={y} r="6" fill={colorOf(m.color, ACCENT)} opacity="0.22" />
        <circle cx={x} cy={y} r="2.8" fill={color} />
      </g>
      <text
        x={x}
        y={y - 8}
        fontSize="10"
        fontWeight="700"
        textAnchor="middle"
        fill={INK}
        style={{ ...HALO, ...a.fade(d + 0.25) }}
      >
        {arDigits(label)}
      </text>
    </g>
  );
}

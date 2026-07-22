#!/usr/bin/env node
/**
 * Base-map asset generator — AI.Next Social Studies Wave 0.
 *
 * Authors each base map as lat/lon point chains (coasts smoothed with
 * Catmull-Rom, political borders straight), projects them per-map
 * (plate carrée with a std-parallel x-compression), and emits:
 *   app/public/maps/<base>.svg   — Ledger ink-on-paper base art
 *   app/public/maps/<base>.json  — gazetteer (place name -> px anchor)
 *
 * This script is the SOURCE of the assets; keep it runnable. Coordinates
 * are approximate by design — hand-drawn-atlas style, not GIS.
 */
// Lives next to its outputs: run `node app/public/maps/generate.cjs` to
// regenerate every <base>.svg + <base>.json in this directory. The name lists
// it prints to gazetteer-names.md are the source of the lists in
// services/extraction/VIZ_SPEC.md — keep them in sync.
const fs = require("fs");
const path = require("path");

const OUT = __dirname;
const NAMES_OUT = path.join(__dirname, "gazetteer-names.md");

/* ---------------- projection ---------------- */

function makeProj(b) {
  // b = {W,E,S,N,s} ; s = px per degree latitude
  const kx = Math.cos((((b.S + b.N) / 2) * Math.PI) / 180);
  const X = (lon) => +((lon - b.W) * b.s * kx).toFixed(1);
  const Y = (lat) => +((b.N - lat) * b.s).toFixed(1);
  const width = +((b.E - b.W) * b.s * kx).toFixed(0);
  const height = +((b.N - b.S) * b.s).toFixed(0);
  return { X, Y, width, height, P: (ll) => [X(ll[0]), Y(ll[1])] };
}

/* ---------------- path builders ---------------- */

/** Catmull-Rom -> cubic bezier through projected points. */
function smoothSeg(pts, closed) {
  const n = pts.length;
  if (n < 3) return pts.map((p, i) => (i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`)).join(" ");
  const at = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0]},${p2[1]}`;
  }
  return d;
}

function mk(proj) {
  const pp = (pts) => pts.map(proj.P);
  return {
    /** smooth closed coast */
    coast: (pts) => smoothSeg(pp(pts), true) + " Z",
    /** smooth open line (rivers) */
    river: (pts) => smoothSeg(pp(pts), false),
    /** straight closed polygon (regions, frame-cut land) */
    poly: (pts) =>
      pp(pts).map((p, i) => (i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`)).join(" ") + " Z",
    /** straight open polyline (borders) */
    line: (pts) =>
      pp(pts).map((p, i) => (i ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`)).join(" "),
    /**
     * mixed chain: segments [{pts, smooth}] joined into one path.
     * closed=true appends Z (segments must connect end-to-start).
     */
    chain: (segs, closed) => {
      let d = "";
      segs.forEach((sg, i) => {
        const P = pp(sg.pts);
        const seg = sg.smooth ? smoothSeg(P, false) : P.map((p, j) => (j ? `L${p[0]},${p[1]}` : `M${p[0]},${p[1]}`)).join(" ");
        d += (i === 0 ? seg : " " + seg.replace(/^M/, "L")) ;
      });
      return d + (closed ? " Z" : "");
    },
  };
}

/* ---------------- styles (Ledger) ---------------- */

const S = {
  sea: 'style="fill:rgba(22,102,92,0.055)"',
  land: 'style="fill:var(--card,#fdfbf3);stroke:var(--ink,#20293a);stroke-width:1.3;stroke-linejoin:round"',
  landThin: 'style="fill:var(--card,#fdfbf3);stroke:var(--ink,#20293a);stroke-width:1;stroke-linejoin:round"',
  neighbor: 'style="fill:var(--paper-deep,#eae3cf);stroke:var(--ink-faint,#8a91a1);stroke-width:0.8;stroke-linejoin:round"',
  border: 'style="fill:none;stroke:var(--ink-soft,#4d5669);stroke-width:0.7;stroke-dasharray:3 2.4;opacity:0.75"',
  river: 'style="fill:none;stroke:var(--accent,#16665c);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round"',
  riverThin: 'style="fill:none;stroke:var(--accent,#16665c);stroke-width:0.9;stroke-linecap:round;stroke-linejoin:round"',
  water: 'style="fill:rgba(22,102,92,0.13);stroke:var(--accent,#16665c);stroke-width:0.7"',
  green: 'style="fill:rgba(22,102,92,0.16);stroke:none"',
  grat: 'style="fill:none;stroke:var(--gold,#a97e22);stroke-width:0.7;stroke-dasharray:5 4;opacity:0.55"',
  relief: 'style="fill:none;stroke:var(--ink-soft,#4d5669);stroke-width:0.9;stroke-linecap:round;opacity:0.6"',
  hidden: 'style="fill:none;stroke:none;pointer-events:none"',
};

const seaLabel = (x, y, txt, size = 9) =>
  `<text x="${x}" y="${y}" text-anchor="middle" style="fill:var(--ink-faint,#8a91a1);font-size:${size}px;opacity:0.9">${txt}</text>`;

/** relief carets (∧ ∧ ∧) along a projected polyline */
function carets(proj, pts, count) {
  const P = pts.map(proj.P);
  let total = 0;
  const segs = [];
  for (let i = 1; i < P.length; i++) {
    const L = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    segs.push(L);
    total += L;
  }
  let out = "";
  for (let k = 0; k < count; k++) {
    let t = (total * (k + 0.5)) / count;
    let i = 0;
    while (i < segs.length && t > segs[i]) t -= segs[i++];
    if (i >= segs.length) i = segs.length - 1;
    const f = segs[i] ? t / segs[i] : 0;
    const x = P[i][0] + (P[i + 1][0] - P[i][0]) * f;
    const y = P[i][1] + (P[i + 1][1] - P[i][1]) * f;
    out += `<path d="M${(x - 3).toFixed(1)},${(y + 1.8).toFixed(1)} L${x.toFixed(1)},${(y - 2.2).toFixed(1)} L${(x + 3).toFixed(1)},${(y + 1.8).toFixed(1)}" ${S.relief}/>`;
  }
  return out;
}

/* ---------------- emit ---------------- */

const nameLists = [];

function emit(id, bounds, build) {
  const proj = makeProj(bounds);
  const g = mk(proj);
  const places = {};
  const pl = (name, kind, ll, r, extra = {}) => {
    places[name] = {
      kind,
      at: proj.P(ll),
      r,
      ...(extra.ref ? { ref: extra.ref } : {}),
      ...(extra.aliases ? { aliases: extra.aliases } : {}),
    };
  };
  const parts = build({ proj, g, pl, S });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${proj.width} ${proj.height}" style="font-family:var(--font-spline-mono),ui-monospace,monospace">
<rect x="0" y="0" width="${proj.width}" height="${proj.height}" ${S.sea}/>
${parts.join("\n")}
</svg>
`;
  fs.writeFileSync(path.join(OUT, `${id}.svg`), svg);
  fs.writeFileSync(
    path.join(OUT, `${id}.json`),
    JSON.stringify({ base: id, viewBox: [0, 0, proj.width, proj.height], places }, null, 1)
  );
  nameLists.push(
    `### \`${id}\`\n` +
      ["point", "region", "line", "sea"]
        .map((k) => {
          const ns = Object.keys(places).filter((n) => places[n].kind === k);
          return ns.length ? `- **${k}**: ${ns.join("، ")}` : null;
        })
        .filter(Boolean)
        .join("\n")
  );
  console.log(`${id}: ${proj.width}x${proj.height}, ${Object.keys(places).length} places`);
}

/* ================= EGYPT ================= */

const EG = {
  medCoast: [[25.15,31.58],[26.6,31.35],[27.9,31.10],[28.8,30.95],[29.55,30.95],[29.92,31.20],[30.40,31.45],[31.05,31.58],[31.85,31.50],[32.30,31.28]],
  sinaiN: [[32.30,31.28],[32.95,31.08],[33.80,31.12],[34.22,31.30]],
  negev: [[34.22,31.30],[34.55,30.40],[34.90,29.50]],
  aqabaW: [[34.90,29.50],[34.72,28.95],[34.50,28.30],[34.28,27.80]],
  suezGulfE: [[34.28,27.80],[34.00,28.05],[33.55,28.55],[33.10,29.05],[32.65,29.60],[32.58,29.95]],
  redW: [[32.58,29.95],[32.62,29.35],[32.85,28.75],[33.20,28.25],[33.78,27.30],[34.05,26.70],[34.30,26.10],[34.95,25.35],[35.55,24.60],[35.80,23.95],[35.62,23.20],[35.95,22.80],[36.60,22.25],[36.90,21.95]],
  southBorder: [[36.90,21.95],[33.50,21.95],[31.40,21.95],[28.00,21.95],[25.00,21.95]],
  westBorder: [[25.00,21.95],[25.00,25.50],[25.00,29.00],[24.85,30.40],[25.15,31.58]],
  nile: [[32.90,24.05],[32.87,24.50],[32.72,25.20],[32.64,25.70],[32.75,26.15],[32.20,26.35],[31.75,26.50],[31.25,27.20],[30.80,28.10],[31.10,29.05],[31.22,29.55],[31.23,30.05]],
  rosetta: [[31.23,30.08],[30.95,30.55],[30.55,31.05],[30.40,31.42]],
  damietta: [[31.23,30.08],[31.45,30.60],[31.70,31.10],[31.83,31.48]],
  nasser: [[32.90,23.95],[32.60,23.55],[32.95,23.15],[32.55,22.75],[32.85,22.30],[33.15,22.65],[33.05,23.20],[33.15,23.75]],
  canal: [[32.30,31.25],[32.30,30.75],[32.42,30.25],[32.55,29.98]],
};

emit("egypt", { W: 24.3, E: 37.5, S: 21.3, N: 32.3, s: 30 }, ({ proj, g, pl }) => {
  const outline = g.chain(
    [
      { pts: EG.medCoast, smooth: true },
      { pts: EG.sinaiN, smooth: true },
      { pts: EG.negev, smooth: false },
      { pts: EG.aqabaW, smooth: true },
      { pts: EG.suezGulfE, smooth: true },
      { pts: EG.redW, smooth: true },
      { pts: EG.southBorder, smooth: false },
      { pts: EG.westBorder, smooth: false },
    ],
    true
  );
  // green cultivation: valley band (±0.17°) + delta + fayoum
  const west = EG.nile.map(([lo, la]) => [lo - 0.17, la]);
  const east = [...EG.nile].reverse().map(([lo, la]) => [lo + 0.17, la]);
  const valley = g.poly([...west, ...east]);
  const delta = g.coast([[31.23,30.02],[30.55,30.55],[30.30,31.05],[30.42,31.44],[31.05,31.56],[31.85,31.47],[32.22,31.22],[31.75,30.65]]);
  const fayoum = g.coast([[30.45,29.45],[30.85,29.5],[31.0,29.25],[30.7,29.05],[30.4,29.2]]);

  // invisible gazetteer regions
  const rSinai = g.poly([[32.35,31.22],[33.8,31.12],[34.22,31.3],[34.9,29.5],[34.28,27.8],[33.1,29.05],[32.58,29.95],[32.32,30.7]]);
  const rDelta = g.poly([[31.2,30.05],[30.35,30.9],[30.3,31.45],[31.05,31.58],[31.85,31.5],[32.25,31.25],[31.9,30.7]]);
  const rWest = g.poly([[25.0,21.98],[25.0,29.0],[24.87,30.4],[25.15,31.55],[28.8,30.92],[29.85,31.05],[30.35,30.75],[30.9,29.8],[30.55,28.15],[31.0,27.1],[31.55,26.35],[32.45,25.6],[32.68,24.5],[32.6,22.0]]);
  const rEast = g.poly([[33.15,22.0],[33.1,24.5],[32.95,25.4],[32.95,26.25],[31.95,26.6],[31.42,27.25],[31.0,28.15],[31.4,29.15],[31.55,29.85],[32.1,30.0],[32.55,29.9],[32.85,28.75],[33.78,27.3],[34.3,26.1],[34.95,25.35],[35.8,23.95],[35.62,23.2],[36.6,22.25],[36.88,21.98]]);
  const rValley = g.poly([[32.35,24.1],[32.2,25.4],[31.1,27.15],[30.5,28.1],[30.8,29.2],[31.65,29.2],[31.4,28.15],[31.75,27.3],[32.3,26.6],[33.05,26.3],[33.3,25.3],[33.4,24.1],[33.35,22.05],[32.55,22.05],[32.62,23.4]]);

  // places — cities
  const cities = {
    "القاهرة": [[31.24,30.05],["cairo"]], "الجيزة": [[31.13,30.01],["giza"]],
    "الإسكندرية": [[29.92,31.20],["alexandria"]], "بورسعيد": [[32.30,31.27],["port said"]],
    "السويس": [[32.55,29.97],["suez"]], "الإسماعيلية": [[32.27,30.60],["ismailia"]],
    "دمياط": [[31.82,31.42],["damietta"]], "رشيد": [[30.40,31.40],["rosetta"]],
    "طنطا": [[31.00,30.79],["tanta"]], "المنصورة": [[31.38,31.04],["mansoura"]],
    "الفيوم": [[30.84,29.31],["fayoum"]], "بني سويف": [[31.10,29.07],["beni suef"]],
    "المنيا": [[30.75,28.10],["minya"]], "أسيوط": [[31.18,27.18],["asyut"]],
    "سوهاج": [[31.70,26.56],["sohag"]], "قنا": [[32.72,26.16],["qena"]],
    "الأقصر": [[32.64,25.69],["luxor"]], "أسوان": [[32.90,24.09],["aswan"]],
    "الغردقة": [[33.80,27.26],["hurghada"]], "مرسى مطروح": [[27.24,31.22],["marsa matruh"]],
    "العريش": [[33.80,31.13],["arish"]], "شرم الشيخ": [[34.33,27.86],["sharm el sheikh"]],
    "السلوم": [[25.15,31.56],["sallum"]], "طابا": [[34.90,29.49],["taba"]],
    "واحة سيوة": [[25.55,29.20],["siwa"]], "السد العالي": [[32.88,23.97],["high dam"]],
    "حلايب": [[36.55,22.25],["halayeb"]],
  };
  for (const [n, [ll, al]] of Object.entries(cities)) pl(n, "point", ll, 13, { aliases: al });

  // history battle/incident sites (soc4-2 Urabi revolution, soc4-3 national struggle)
  pl("التل الكبير", "point", [31.76,30.55], 13, { aliases: ["tel el-kebir", "tell el kebir"] });
  pl("كفر الدوار", "point", [30.13,31.13], 13, { aliases: ["kafr el-dawwar"] });
  pl("دنشواي", "point", [30.79,30.64], 13, { aliases: ["denshawai", "dinshway"] });

  pl("سيناء", "region", [33.7,29.7], 42, { ref: "r-sinai", aliases: ["sinai", "شبه جزيرة سيناء"] });
  pl("الدلتا", "region", [31.1,30.9], 26, { ref: "r-delta", aliases: ["delta", "دلتا النيل"] });
  pl("الصحراء الغربية", "region", [27.5,26.5], 60, { ref: "r-west", aliases: ["western desert"] });
  pl("الصحراء الشرقية", "region", [33.6,25.0], 40, { ref: "r-east", aliases: ["eastern desert"] });
  pl("الصعيد", "region", [32.0,25.8], 34, { ref: "r-valley", aliases: ["upper egypt", "وادي النيل"] });
  pl("نهر النيل", "line", [31.5,27.6], 18, { ref: "nile", aliases: ["النيل", "nile"] });
  pl("قناة السويس", "line", [32.36,30.6], 14, { ref: "suez-canal", aliases: ["suez canal"] });
  pl("فرع رشيد", "line", [30.7,30.8], 10, { ref: "rosetta-branch" });
  pl("فرع دمياط", "line", [31.6,30.85], 10, { ref: "damietta-branch" });
  pl("بحيرة ناصر", "region", [32.9,23.1], 16, { ref: "lake-nasser", aliases: ["lake nasser"] });
  pl("البحر المتوسط", "sea", [28.8,31.95], 24, { aliases: ["mediterranean"] });
  pl("البحر الأحمر", "sea", [36.0,25.6], 24, { aliases: ["red sea"] });
  pl("خليج السويس", "sea", [33.35,28.75], 12, { aliases: ["gulf of suez"] });
  pl("خليج العقبة", "sea", [34.75,28.55], 10, { aliases: ["gulf of aqaba"] });

  return [
    `<path id="land" d="${outline}" ${S.land}/>`,
    `<path d="${valley}" ${S.green}/>`,
    `<path d="${delta}" ${S.green}/>`,
    `<path d="${fayoum}" ${S.green}/>`,
    `<path id="lake-nasser" d="${g.coast(EG.nasser)}" ${S.water}/>`,
    `<path id="nile" d="${g.river(EG.nile)}" ${S.river}/>`,
    `<path id="rosetta-branch" d="${g.river(EG.rosetta)}" ${S.riverThin}/>`,
    `<path id="damietta-branch" d="${g.river(EG.damietta)}" ${S.riverThin}/>`,
    `<path id="suez-canal" d="${g.line(EG.canal)}" style="fill:none;stroke:var(--accent,#16665c);stroke-width:1.1;stroke-dasharray:4 2"/>`,
    seaLabel(proj.X(28.6), proj.Y(32.05), "البحر المتوسط"),
    seaLabel(proj.X(36.35), proj.Y(25.8), "البحر الأحمر", 8),
    `<path id="r-sinai" d="${rSinai}" ${S.hidden}/>`,
    `<path id="r-delta" d="${rDelta}" ${S.hidden}/>`,
    `<path id="r-west" d="${rWest}" ${S.hidden}/>`,
    `<path id="r-east" d="${rEast}" ${S.hidden}/>`,
    `<path id="r-valley" d="${rValley}" ${S.hidden}/>`,
  ];
});

/* ================= NILE VALLEY ================= */

emit("nile_valley", { W: 28.55, E: 35.6, S: 21.6, N: 32.05, s: 40 }, ({ proj, g, pl }) => {
  const land = g.chain(
    [
      { pts: [[28.55,31.02],[29.55,30.95],[29.92,31.20],[30.40,31.45],[31.05,31.58],[31.85,31.50],[32.30,31.28],[32.95,31.08],[33.80,31.12],[34.22,31.30],[35.0,31.35],[35.6,31.4]], smooth: true },
      { pts: [[35.6,31.4],[35.6,21.6],[28.55,21.6],[28.55,31.02]], smooth: false },
    ],
    true
  );
  const suezGulf = g.coast([[32.58,29.98],[33.0,29.2],[33.55,28.6],[34.0,28.1],[34.24,27.85],[33.9,27.85],[33.35,28.25],[32.9,28.8],[32.55,29.45]]);
  const aqabaGulf = g.coast([[34.95,29.45],[34.72,28.9],[34.5,28.3],[34.3,27.85],[34.55,27.7],[34.8,28.25],[35.05,29.05],[35.1,29.45]]);
  const redSea = g.coast([[34.24,27.8],[34.05,26.7],[34.3,26.1],[34.95,25.35],[35.6,24.85],[35.6,27.3],[34.8,27.55]]);
  const west = EG.nile.map(([lo, la]) => [lo - 0.24, la]);
  const east = [...EG.nile].reverse().map(([lo, la]) => [lo + 0.24, la]);
  const valley = g.poly([...west, ...east]);
  const delta = g.coast([[31.23,30.02],[30.55,30.55],[30.30,31.05],[30.42,31.44],[31.05,31.56],[31.85,31.47],[32.22,31.22],[31.75,30.65]]);
  const fayoum = g.coast([[30.45,29.45],[30.85,29.5],[31.0,29.25],[30.7,29.05],[30.4,29.2]]);
  const rValley = g.poly([...EG.nile.map(([lo,la])=>[lo-0.45,la]), ...[...EG.nile].reverse().map(([lo,la])=>[lo+0.45,la])]);
  const rDelta = g.poly([[31.2,30.05],[30.35,30.9],[30.3,31.45],[31.05,31.58],[31.85,31.5],[32.25,31.25],[31.9,30.7]]);

  const cities = {
    "القاهرة": [[31.24,30.05],["cairo"]], "الجيزة": [[31.13,30.01],["giza"]],
    "الإسكندرية": [[29.92,31.20],["alexandria"]], "بورسعيد": [[32.30,31.27],["port said"]],
    "السويس": [[32.55,29.97],["suez"]], "الإسماعيلية": [[32.27,30.60],["ismailia"]],
    "دمياط": [[31.82,31.42],["damietta"]], "رشيد": [[30.40,31.40],["rosetta"]],
    "طنطا": [[31.00,30.79],["tanta"]], "المنصورة": [[31.38,31.04],["mansoura"]],
    "الفيوم": [[30.84,29.31],["fayoum"]], "بني سويف": [[31.10,29.07],["beni suef"]],
    "المنيا": [[30.75,28.10],["minya"]], "أسيوط": [[31.18,27.18],["asyut"]],
    "سوهاج": [[31.70,26.56],["sohag"]], "قنا": [[32.72,26.16],["qena"]],
    "الأقصر": [[32.64,25.69],["luxor"]], "أسوان": [[32.90,24.09],["aswan"]],
    "السد العالي": [[32.88,23.97],["high dam"]],
  };
  for (const [n, [ll, al]] of Object.entries(cities)) pl(n, "point", ll, 14, { aliases: al });

  pl("الدلتا", "region", [31.1,30.9], 34, { ref: "r-delta", aliases: ["delta", "دلتا النيل"] });
  pl("الوادي", "region", [31.9,26.3], 40, { ref: "r-valley", aliases: ["وادي النيل", "nile valley", "الصعيد"] });
  pl("نهر النيل", "line", [31.5,27.6], 22, { ref: "nile", aliases: ["النيل", "nile"] });
  pl("فرع رشيد", "line", [30.7,30.8], 12, { ref: "rosetta-branch" });
  pl("فرع دمياط", "line", [31.6,30.85], 12, { ref: "damietta-branch" });
  pl("قناة السويس", "line", [32.36,30.6], 14, { ref: "suez-canal", aliases: ["suez canal"] });
  pl("بحيرة ناصر", "region", [32.9,23.1], 20, { ref: "lake-nasser", aliases: ["lake nasser"] });
  pl("منخفض الفيوم", "region", [30.7,29.3], 14, { ref: "fayoum-oasis", aliases: ["الفيوم منخفض"] });
  pl("البحر المتوسط", "sea", [30.6,31.85], 26, { aliases: ["mediterranean"] });
  pl("البحر الأحمر", "sea", [35.1,26.4], 18, { aliases: ["red sea"] });
  pl("خليج السويس", "sea", [33.3,28.8], 14, { aliases: ["gulf of suez"] });
  pl("خليج العقبة", "sea", [34.72,28.5], 12, { aliases: ["gulf of aqaba"] });

  return [
    `<path id="land" d="${land}" ${S.land}/>`,
    `<path d="${suezGulf}" ${S.water}/>`,
    `<path d="${aqabaGulf}" ${S.water}/>`,
    `<path d="${redSea}" ${S.water}/>`,
    `<path id="r-valley" d="${rValley}" ${S.hidden}/>`,
    `<path d="${valley}" ${S.green}/>`,
    `<path id="r-delta" d="${rDelta}" ${S.hidden}/>`,
    `<path d="${delta}" ${S.green}/>`,
    `<path id="fayoum-oasis" d="${fayoum}" ${S.green}/>`,
    `<path id="lake-nasser" d="${g.coast(EG.nasser)}" ${S.water}/>`,
    `<path id="nile" d="${g.river(EG.nile)}" style="fill:none;stroke:var(--accent,#16665c);stroke-width:1.6;stroke-linecap:round"/>`,
    `<path id="rosetta-branch" d="${g.river(EG.rosetta)}" ${S.river}/>`,
    `<path id="damietta-branch" d="${g.river(EG.damietta)}" ${S.river}/>`,
    `<path id="suez-canal" d="${g.line(EG.canal)}" style="fill:none;stroke:var(--accent,#16665c);stroke-width:1.2;stroke-dasharray:4 2"/>`,
    `<path d="${g.line([[34.22,31.30],[34.55,30.40],[34.90,29.50]])}" ${S.border}/>`,
    seaLabel(proj.X(30.5), proj.Y(31.9), "البحر المتوسط"),
    seaLabel(proj.X(35.05), proj.Y(26.0), "البحر الأحمر", 8),
  ];
});

/* ================= ARAB WORLD ================= */

emit("arab_world", { W: -18, E: 62, S: 0.5, N: 38.8, s: 6.6 }, ({ proj, g, pl }) => {
  const main = g.chain(
    [
      // Maghreb + Med south coast, Tangier -> Port Said -> Levant -> Iskenderun
      { pts: [[-5.85,35.78],[-2.9,35.3],[0.5,36.6],[3.05,36.75],[7.75,36.9],[10.2,37.2],[11.05,37.05],[10.6,35.8],[10.75,34.7],[10.1,33.9],[11.1,33.5],[13.2,32.9],[15.3,32.4],[16.6,31.2],[19.1,30.4],[20.05,32.1],[22.2,32.85],[23.95,32.1],[25.15,31.58],[27.9,31.1],[29.55,30.95],[29.92,31.2],[30.4,31.45],[31.05,31.58],[31.85,31.5],[32.3,31.28],[32.95,31.08],[33.8,31.12],[34.3,31.35],[34.95,32.5],[35.0,33.1],[35.48,33.9],[35.62,34.65],[35.85,35.55],[35.9,36.2],[36.1,36.6]], smooth: true },
      // Turkey border (cut)
      { pts: [[36.1,36.6],[37.5,36.7],[39.0,36.85],[41.0,37.1],[42.5,37.35],[44.8,37.15]], smooth: false },
      // Iran border down to the Shatt
      { pts: [[44.8,37.15],[45.5,35.8],[45.4,34.6],[46.1,33.5],[47.5,32.4],[48.0,30.9],[48.55,30.0]], smooth: false },
      // Gulf coast: Kuwait -> Qatar -> UAE -> Musandam
      { pts: [[48.55,30.0],[48.4,29.6],[48.15,28.9],[48.6,28.2],[49.3,27.5],[50.15,26.6],[50.7,25.4],[51.15,26.0],[51.6,25.0],[52.6,24.2],[54.0,24.15],[54.7,24.8],[55.9,25.9],[56.15,26.1]], smooth: true },
      // Oman -> Yemen south coast -> Bab el-Mandeb
      { pts: [[56.15,26.1],[56.5,24.6],[57.3,23.9],[58.55,23.6],[59.5,22.8],[59.8,22.3],[58.9,20.9],[57.7,19.0],[56.5,18.1],[55.4,17.0],[53.8,16.9],[52.2,15.65],[50.2,15.0],[49.0,14.2],[47.4,13.6],[45.05,12.75],[43.7,12.65],[43.25,12.7]], smooth: true },
      // Red Sea east coast up to Aqaba
      { pts: [[43.25,12.7],[43.1,13.2],[42.9,14.4],[42.7,15.4],[42.2,16.7],[41.6,18.0],[40.8,19.5],[39.6,20.8],[39.1,21.6],[38.9,22.8],[38.4,23.7],[37.4,24.7],[36.8,25.8],[35.8,27.2],[35.1,28.3],[34.95,29.4]], smooth: true },
      // Gulf of Aqaba + Sinai + Gulf of Suez
      { pts: [[34.95,29.4],[34.72,28.9],[34.5,28.3],[34.28,27.8],[34.0,28.05],[33.5,28.6],[33.1,29.05],[32.65,29.6],[32.58,29.95]], smooth: true },
      // Red Sea west coast down + Horn
      { pts: [[32.58,29.95],[32.62,29.35],[32.85,28.75],[33.2,28.25],[33.78,27.3],[34.3,26.1],[34.95,25.35],[35.6,24.5],[35.85,23.6],[36.4,22.6],[37.0,21.3],[37.25,19.6],[38.4,18.0],[39.4,15.9],[40.1,15.2],[41.15,14.65],[42.4,13.3],[43.15,11.75],[43.4,11.4],[44.3,10.4],[45.8,10.85],[47.4,11.15],[48.9,11.3],[50.3,11.7],[51.25,11.85],[51.1,10.55],[50.1,8.8],[49.0,7.2],[47.9,5.6],[46.4,3.6],[44.9,1.9],[44.0,1.1],[43.6,0.6]], smooth: true },
      // bottom frame cut west
      { pts: [[43.6,0.6],[9.3,0.6]], smooth: false },
      // Atlantic coast up: Gulf of Guinea -> Tangier
      { pts: [[9.3,0.6],[9.5,3.5],[8.7,4.5],[6.8,4.2],[4.3,6.2],[3.4,6.4],[1.5,6.2],[-0.5,5.3],[-3.1,5.1],[-5.5,4.9],[-7.5,4.4],[-9.5,5.0],[-11.5,6.9],[-13.2,8.5],[-14.7,10.7],[-15.6,11.7],[-16.7,12.5],[-17.4,14.7],[-16.5,15.9],[-16.05,17.05],[-16.5,19.3],[-17.05,20.9],[-16.9,21.9],[-15.9,23.7],[-14.8,25.2],[-13.1,27.7],[-11.5,28.4],[-10.3,29.3],[-9.65,30.4],[-9.85,31.4],[-9.25,32.55],[-7.6,33.6],[-6.3,34.9],[-5.85,35.78]], smooth: true },
    ],
    true
  );
  // faded neighbors
  const turkey = g.coast([[26.5,38.8],[27.0,38.0],[27.3,36.9],[28.2,36.5],[29.5,36.2],[30.5,36.3],[32.0,36.1],[33.7,36.15],[34.6,36.7],[35.5,36.55],[36.1,36.6],[37.5,36.7],[39.0,36.85],[41.0,37.1],[42.5,37.35],[44.8,37.15],[45.2,38.8]]);
  const iran = g.poly([[44.8,37.15],[45.5,35.8],[45.4,34.6],[46.1,33.5],[47.5,32.4],[48.0,30.9],[48.55,30.0],[49.2,30.1],[50.1,30.2],[51.5,28.8],[53.5,27.9],[55.6,27.0],[56.8,27.15],[58.5,25.8],[61.9,25.2],[62,38.8],[45.2,38.8],[44.8,37.15]]);
  const cyprus = g.coast([[32.3,35.35],[33.6,35.6],[34.55,35.65],[33.9,35.0],[32.6,34.75]]);
  const bahrain = `M${proj.X(50.45)},${proj.Y(26.25)} a3.2,4.2 0 1 0 0.1,0.1 Z`;

  const borders = [
    [[-1.8,34.8],[-1.5,32.8],[-4.5,30.6],[-8.7,28.7],[-8.67,27.7]],
    [[-8.67,27.7],[-13.1,27.7]],
    [[-17.0,21.0],[-13.1,21.3],[-12.0,21.3],[-12.0,23.4],[-8.67,23.4],[-8.67,27.7]],
    [[-16.4,16.2],[-12.0,15.5],[-5.4,15.5],[-6.1,20.2],[-4.8,25.0],[-8.67,27.7]],
    [[-5.4,15.5],[1.7,20.7],[3.2,19.2],[5.8,19.4],[9.9,26.5]],
    [[8.6,36.9],[8.3,34.7],[9.1,32.3]],
    [[11.5,33.2],[10.3,31.7],[9.85,30.3]],
    [[9.85,30.3],[9.9,26.5],[11.5,24.3]],
    [[25.15,31.58],[25.0,29.0],[25.0,21.95]],
    [[25.0,21.95],[24.0,20.0],[15.0,23.0],[14.2,22.6],[11.5,24.3]],
    [[25.0,21.95],[36.85,21.95]],
    [[25.0,21.95],[23.6,15.8],[22.5,12.6],[25.9,10.2],[33.9,9.5],[36.4,14.2],[38.5,17.9]],
    [[43.35,11.2],[44.9,8.7],[46.5,8.0],[47.9,4.5],[41.0,3.9],[41.0,0.6]],
    [[42.35,37.1],[41.2,34.8],[38.8,33.4]],
    [[35.8,32.7],[38.8,33.4]],
    [[35.62,34.65],[36.4,34.5],[35.9,33.4],[35.1,33.09]],
    [[35.6,33.25],[35.57,32.4],[35.55,31.5],[35.0,29.5]],
    [[34.95,29.36],[36.1,29.2],[37.5,30.0],[38.0,31.5],[39.2,32.1]],
    [[38.8,33.4],[39.2,32.1],[40.4,31.9],[42.1,31.1],[44.7,29.2],[46.55,29.1],[47.15,30.03]],
    [[47.7,28.55],[48.4,28.55]],
    [[43.2,17.5],[45.4,17.3],[47.0,17.0],[52.0,19.0]],
    [[52.0,19.0],[52.75,17.3]],
    [[52.0,19.0],[55.2,22.7],[56.0,24.9]],
  ].map((b) => `<path d="${g.line(b)}" ${S.border}/>`);

  const countries = {
    "مصر": [[29.5,26.5],26,["egypt"]], "السودان": [[30.0,15.5],32,["sudan"]],
    "ليبيا": [[17.5,27.0],32,["libya"]], "تونس": [[9.3,34.5],13,["tunisia"]],
    "الجزائر": [[2.5,27.5],38,["algeria"]], "المغرب": [[-6.5,32.0],18,["morocco"]],
    "موريتانيا": [[-10.5,20.0],24,["mauritania"]], "السعودية": [[44.5,24.0],38,["saudi arabia","المملكة العربية السعودية"]],
    "اليمن": [[46.5,15.5],18,["yemen"]], "عُمان": [[56.3,21.5],16,["oman","عمان"]],
    "الإمارات": [[54.3,23.9],10,["uae","الإمارات العربية المتحدة"]], "قطر": [[51.2,25.2],7,["qatar"]],
    "البحرين": [[50.5,26.1],6,["bahrain"]], "الكويت": [[47.6,29.4],8,["kuwait"]],
    "العراق": [[43.5,33.0],20,["iraq"]], "سوريا": [[38.5,35.2],16,["syria"]],
    "الأردن": [[36.8,31.2],11,["jordan"]], "لبنان": [[35.9,34.15],7,["lebanon"]],
    "فلسطين": [[35.0,31.9],8,["palestine"]], "الصومال": [[46.0,6.5],22,["somalia"]],
    "جيبوتي": [[42.8,11.6],6,["djibouti"]],
  };
  for (const [n, [ll, r, al]] of Object.entries(countries)) pl(n, "region", ll, r, { aliases: al });

  const capitals = {
    "القاهرة": [[31.24,30.05],["cairo"]], "الرياض": [[46.7,24.7],["riyadh"]],
    "بغداد": [[44.4,33.3],["baghdad"]], "دمشق": [[36.3,33.5],["damascus"]],
    "عمّان": [[35.9,31.95],["amman"]], "بيروت": [[35.5,33.9],["beirut"]],
    "القدس": [[35.2,31.78],["jerusalem"]], "الخرطوم": [[32.5,15.6],["khartoum"]],
    "طرابلس": [[13.2,32.9],["tripoli"]], "الرباط": [[-6.8,34.0],["rabat"]],
    "نواكشوط": [[-15.97,18.1],["nouakchott"]], "صنعاء": [[44.2,15.35],["sanaa"]],
    "مسقط": [[58.55,23.6],["muscat"]], "أبوظبي": [[54.4,24.45],["abu dhabi"]],
    "الدوحة": [[51.53,25.29],["doha"]], "المنامة": [[50.58,26.23],["manama"]],
    "مدينة الكويت": [[47.98,29.38],["kuwait city"]], "مقديشو": [[45.3,2.04],["mogadishu"]],
    "الجزائر العاصمة": [[3.05,36.75],["algiers"]], "تونس العاصمة": [[10.2,36.8],["tunis"]],
  };
  for (const [n, [ll, al]] of Object.entries(capitals)) pl(n, "point", ll, 8, { aliases: al });

  // Muhammad Ali — Hejaz / Arabia campaign against the Wahhabis (soc3-4)
  pl("الحجاز", "region", [39.5,23.5], 14, { aliases: ["hejaz", "الحجاز"] });
  pl("الدرعية", "point", [46.57,24.73], 8, { aliases: ["diriyah", "دِرعية"] });
  pl("مكة المكرمة", "point", [39.83,21.42], 8, { aliases: ["mecca", "makkah", "مكة"] });
  pl("المدينة المنورة", "point", [39.61,24.47], 8, { aliases: ["medina", "madinah", "المدينة"] });

  pl("البحر المتوسط", "sea", [18.0,35.3], 30, { aliases: ["mediterranean"] });
  pl("البحر الأحمر", "sea", [37.8,20.8], 18, { aliases: ["red sea"] });
  pl("الخليج العربي", "sea", [50.6,27.9], 12, { aliases: ["arabian gulf", "الخليج"] });
  pl("بحر العرب", "sea", [58.0,15.5], 20, { aliases: ["arabian sea"] });
  pl("خليج عدن", "sea", [47.5,12.3], 12, { aliases: ["gulf of aden"] });
  pl("المحيط الأطلنطي", "sea", [-15.5,28.0], 20, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("قناة السويس", "line", [32.36,30.6], 8, { aliases: ["suez canal"] });
  pl("مضيق باب المندب", "sea", [43.3,12.2], 7, { aliases: ["bab el mandeb"] });
  pl("مضيق هرمز", "sea", [56.6,26.7], 7, { aliases: ["hormuz"] });
  pl("مضيق جبل طارق", "sea", [-5.6,35.95], 7, { aliases: ["gibraltar"] });

  return [
    `<path d="${turkey}" ${S.neighbor}/>`,
    `<path d="${iran}" ${S.neighbor}/>`,
    `<path id="land" d="${main}" ${S.land}/>`,
    `<path d="${cyprus}" ${S.neighbor}/>`,
    `<path id="bahrain-i" d="${bahrain}" ${S.landThin}/>`,
    ...borders,
    `<path id="nile-lower" d="${g.river(EG.nile)}" ${S.riverThin}/>`,
    `<path d="${g.river([[32.5,15.6],[32.3,18.0],[31.0,21.0],[32.9,24.05]])}" ${S.riverThin}/>`,
    `<path d="${g.river([[38.5,36.6],[40.5,35.3],[43.0,34.4],[45.5,32.2],[47.5,31.0],[48.55,30.0]])}" ${S.riverThin}/>`,
    seaLabel(proj.X(17.0), proj.Y(36.0), "البحر المتوسط", 8.5),
    seaLabel(proj.X(57.8), proj.Y(14.2), "بحر العرب", 8.5),
    seaLabel(proj.X(-14.8), proj.Y(29.5), "المحيط الأطلنطي", 8),
  ];
});

/* ================= AFRICA ================= */

const AF = {
  coast: [[-5.85,35.78],[-2.9,35.3],[0.5,36.6],[3.05,36.75],[7.75,36.9],[10.2,37.2],[11.05,37.05],[10.75,34.7],[10.1,33.9],[13.2,32.9],[16.6,31.2],[20.05,32.1],[23.95,32.1],[25.15,31.58],[29.92,31.2],[31.05,31.58],[32.3,31.28],[32.58,29.95],[33.78,27.3],[34.95,25.35],[35.85,23.6],[37.0,21.3],[37.25,19.6],[39.4,15.9],[41.15,14.65],[43.15,11.75],[44.3,10.4],[47.4,11.15],[51.25,11.85],[51.1,10.55],[49.0,7.2],[44.9,1.9],[40.9,-2.1],[39.7,-4.1],[39.3,-6.8],[40.4,-10.5],[40.8,-15.0],[36.9,-17.9],[34.9,-19.8],[35.4,-23.5],[32.6,-25.9],[31.0,-29.9],[27.9,-33.0],[22.0,-34.2],[18.4,-34.3],[17.1,-32.7],[14.5,-26.6],[11.8,-18.0],[13.2,-8.8],[9.5,-2.0],[9.3,0.4],[8.7,4.5],[6.5,4.3],[3.4,6.4],[-0.2,5.5],[-4.0,5.3],[-7.5,4.4],[-13.2,8.5],[-17.4,14.7],[-16.05,17.05],[-17.05,20.9],[-13.1,27.7],[-9.65,30.4],[-9.25,32.55],[-7.6,33.6],[-5.85,35.78]],
  madagascar: [[49.3,-12.1],[50.2,-15.5],[47.1,-24.9],[43.9,-21.5],[44.4,-16.2]],
  whiteNile: [[31.23,30.05],[31.1,29.05],[30.8,28.1],[31.25,27.2],[32.64,25.7],[32.9,24.05],[31.0,21.0],[32.3,18.0],[32.5,15.6],[31.6,9.5],[32.5,4.5],[33.0,0.5]],
  blueNile: [[32.5,15.6],[34.2,13.8],[35.5,12.5],[37.3,11.6]],
  congo: [[12.3,-6.0],[16.0,-3.0],[20.0,0.5],[23.5,2.0],[25.2,-0.5]],
  niger: [[-10.7,9.3],[-8.0,12.5],[-5.0,14.0],[-3.0,16.7],[0.5,16.5],[3.5,14.0],[5.5,9.5],[6.5,4.5]],
  zambezi: [[23.0,-15.5],[28.0,-16.0],[32.0,-16.5],[36.2,-18.5]],
  victoria: [[31.7,-0.4],[33.8,-0.4],[34.8,-2.0],[33.3,-2.9],[31.9,-2.4]],
  chad: [[13.2,13.8],[14.8,13.6],[14.4,12.6],[13.3,12.9]],
};

emit("africa", { W: -20, E: 56, S: -36, N: 38.5, s: 5.6 }, ({ proj, g, pl }) => {
  const rSahara = g.poly([[-13,27],[-5,31],[8,32],[20,30],[30,29],[33,25],[33,17],[15,15],[-6,17],[-13,21]]);
  const rCongo = g.poly([[14,3],[24,4],[28,0],[26,-5],[17,-7],[13,-3]]);
  const atlasLine = [[-7.5,31.2],[-4.5,32.3],[-1.5,33.6],[2.0,35.0],[6.5,35.8]];
  const ethioLine = [[36.5,7.5],[38.5,9.5],[39.5,12.0]];
  const drakLine = [[27.5,-31.5],[29.3,-29.8],[30.2,-28.2]];

  pl("جبال أطلس", "region", [-3.0,32.8], 22, { aliases: ["atlas mountains", "أطلس"] });
  pl("هضبة الحبشة", "region", [38.5,9.5], 18, { aliases: ["ethiopian highlands", "الهضبة الحبشية"] });
  pl("هضبة البحيرات", "region", [32.5,-1.5], 18, { aliases: ["lake plateau", "هضبة البحيرات الاستوائية"] });
  pl("الصحراء الكبرى", "region", [10.0,23.0], 55, { ref: "r-sahara", aliases: ["sahara"] });
  pl("حوض الكونغو", "region", [21.5,-1.0], 26, { ref: "r-congo", aliases: ["congo basin"] });
  pl("جبال دراكنزبرج", "region", [29.0,-30.0], 12, { aliases: ["drakensberg"] });
  pl("مدغشقر", "region", [46.8,-19.5], 16, { ref: "madagascar", aliases: ["madagascar"] });
  pl("مصر", "region", [29.5,26.5], 18, { aliases: ["egypt"] });
  pl("رأس الرجاء الصالح", "point", [18.45,-34.4], 10, { aliases: ["cape of good hope"] });
  pl("القاهرة", "point", [31.24,30.05], 8, { aliases: ["cairo"] });
  pl("قناة السويس", "point", [32.4,30.6], 7, { aliases: ["suez canal"] });
  pl("نهر النيل", "line", [31.8,20.0], 16, { ref: "nile", aliases: ["النيل", "nile"] });
  pl("نهر الكونغو", "line", [19.0,-1.5], 12, { ref: "congo-river", aliases: ["congo river"] });
  pl("نهر النيجر", "line", [-1.5,15.8], 12, { ref: "niger-river", aliases: ["niger river"] });
  pl("نهر الزمبيزي", "line", [30.0,-16.3], 10, { ref: "zambezi", aliases: ["zambezi"] });
  pl("بحيرة فيكتوريا", "region", [33.2,-1.6], 9, { ref: "lake-victoria", aliases: ["lake victoria"] });
  pl("بحيرة تشاد", "region", [14.0,13.2], 7, { ref: "lake-chad", aliases: ["lake chad"] });
  pl("خط الاستواء", "line", [10.0,0.0], 10, { ref: "equator", aliases: ["equator"] });
  pl("مدار السرطان", "line", [10.0,23.44], 10, { ref: "cancer", aliases: ["tropic of cancer"] });
  pl("مدار الجدي", "line", [24.0,-23.44], 10, { ref: "capricorn", aliases: ["tropic of capricorn"] });
  pl("البحر المتوسط", "sea", [14.0,36.3], 22, { aliases: ["mediterranean"] });
  pl("البحر الأحمر", "sea", [37.5,21.5], 14, { aliases: ["red sea"] });
  pl("المحيط الأطلنطي", "sea", [-12.0,0.0], 26, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("المحيط الهندي", "sea", [48.0,-13.0], 26, { aliases: ["indian ocean"] });
  pl("خليج غينيا", "sea", [2.0,1.5], 12, { aliases: ["gulf of guinea"] });

  const eq = proj.Y(0), cancer = proj.Y(23.44), capr = proj.Y(-23.44);
  return [
    `<path id="land" d="${g.coast(AF.coast)}" ${S.land}/>`,
    `<path id="madagascar" d="${g.coast(AF.madagascar)}" ${S.landThin}/>`,
    `<path id="r-sahara" d="${rSahara}" ${S.hidden}/>`,
    `<path id="r-congo" d="${rCongo}" ${S.hidden}/>`,
    `<line x1="0" y1="${eq}" x2="${proj.width}" y2="${eq}" ${S.grat}/>`,
    `<line id="equator" x1="0" y1="${eq}" x2="${proj.width}" y2="${eq}" style="fill:none;stroke:none"/>`,
    `<line id="cancer" x1="0" y1="${cancer}" x2="${proj.width}" y2="${cancer}" ${S.grat}/>`,
    `<line id="capricorn" x1="0" y1="${capr}" x2="${proj.width}" y2="${capr}" ${S.grat}/>`,
    `<path id="nile" d="${g.river(AF.whiteNile)}" ${S.river}/>`,
    `<path d="${g.river(AF.blueNile)}" ${S.riverThin}/>`,
    `<path id="congo-river" d="${g.river(AF.congo)}" ${S.riverThin}/>`,
    `<path id="niger-river" d="${g.river(AF.niger)}" ${S.riverThin}/>`,
    `<path id="zambezi" d="${g.river(AF.zambezi)}" ${S.riverThin}/>`,
    `<path id="lake-victoria" d="${g.coast(AF.victoria)}" ${S.water}/>`,
    `<path id="lake-chad" d="${g.coast(AF.chad)}" ${S.water}/>`,
    carets(proj, atlasLine, 5),
    carets(proj, ethioLine, 3),
    carets(proj, drakLine, 3),
    `<text x="${proj.X(37.2)}" y="${eq - 4}" style="fill:var(--gold,#a97e22);font-size:7.5px;opacity:0.85">خط الاستواء</text>`,
    seaLabel(proj.X(13.5), proj.Y(37.6), "البحر المتوسط", 8.5),
    seaLabel(proj.X(-12), proj.Y(2.5), "المحيط الأطلنطي", 9),
    seaLabel(proj.X(48.5), proj.Y(-15.5), "المحيط الهندي", 9),
  ];
});

/* ================= ASIA ================= */

emit("asia", { W: 24, E: 150, S: -11, N: 78, s: 3.4 }, ({ proj, g, pl }) => {
  const main = g.chain(
    [
      // west frame edge up through Europe cut
      { pts: [[24,29.0],[24,47.0]], smooth: false },
      { pts: [[24,47.0],[24,71.0]], smooth: false },
      // Arctic coast
      { pts: [[24,71.0],[35,68.5],[44,67.5],[54,68.5],[68,69.0],[73,71.8],[80,73.2],[95,75.8],[104,77.3],[113,76.2],[130,72.3],[140,72.0],[150,70.5]], smooth: true },
      { pts: [[150,70.5],[150,59.8]], smooth: false },
      // Okhotsk -> Japan Sea -> Korea -> China coast
      { pts: [[150,59.8],[143,53.5],[140.4,48.5],[133,42.5],[130.7,42.3],[129.7,40.0],[129.2,36.5],[129.0,35.2],[126.6,34.4],[126.1,35.8],[125.4,37.7],[124.8,39.7],[122.0,40.6],[121.2,38.9],[117.8,38.5],[119.2,37.1],[120.9,37.5],[122.2,36.9],[119.8,35.0],[121.9,31.7],[120.0,27.5],[118.0,24.5],[116.5,23.3],[113.5,22.1],[110.5,21.4],[108.0,20.9],[105.6,18.8],[108.8,15.4],[109.0,11.4],[106.8,10.3],[105.0,9.5],[102.5,12.2],[100.9,13.5],[100.0,13.4],[99.2,10.5],[100.4,7.2],[103.6,1.5],[100.3,5.8],[98.5,10.0],[97.5,16.8],[94.2,18.0],[91.8,22.5],[89.0,21.7],[87.0,21.1],[82.3,16.5],[80.1,13.5],[79.8,10.3],[77.5,8.1],[73.5,15.6],[72.8,19.0],[72.5,22.3],[69.0,22.2],[66.7,25.2],[61.7,25.1],[57.3,26.7],[52.6,27.9],[50.3,29.9],[48.55,30.0]], smooth: true },
      // Arabian peninsula
      { pts: [[48.55,30.0],[48.15,28.9],[49.3,27.5],[50.15,26.6],[50.75,25.0],[51.1,25.3],[51.5,24.65],[54.0,24.15],[55.9,25.75],[56.1,26.1],[56.6,24.7],[58.55,23.6],[59.8,22.3],[57.7,19.0],[55.4,17.0],[52.2,15.65],[49.0,14.2],[45.05,12.75],[43.25,12.7],[42.7,15.4],[41.6,18.0],[39.1,21.6],[37.4,24.7],[35.8,27.2],[34.95,29.4],[34.28,27.8],[33.1,29.05],[32.58,29.95]], smooth: true },
      // Suez -> Med Levant coast -> Anatolia south + west -> Black Sea -> Caucasus cut
      { pts: [[32.58,29.95],[32.3,31.28],[33.8,31.12],[34.3,31.35],[35.0,33.1],[35.85,35.55],[36.1,36.6],[35.5,36.55],[33.7,36.15],[30.5,36.3],[28.2,36.5],[27.0,37.5],[26.4,39.2],[26.9,40.4],[29.1,41.05],[31.5,41.5],[35.0,42.0],[39.5,41.1],[41.6,41.4]], smooth: true },
      // Black Sea east coast up + frame cut back to start
      { pts: [[41.6,41.4],[39.8,44.6],[36.8,46.0],[33.0,45.6],[30.7,46.2],[28.8,44.8],[27.9,42.1],[28.9,41.2],[26.5,40.6],[25.0,40.5],[24,40.8]], smooth: true },
      { pts: [[24,40.8],[24,29.0]], smooth: false },
    ],
    true
  );
  const caspian = g.coast([[49.0,46.8],[52.7,45.3],[53.9,42.0],[54.0,40.0],[53.9,38.9],[51.2,36.6],[49.0,37.3],[48.9,40.0],[47.3,42.2],[46.7,44.5]]);
  const aral = g.coast([[58.5,45.5],[60.5,45.8],[61.2,44.5],[59.5,43.6],[58.2,44.3]]);
  const baikal = g.coast([[103.7,51.5],[106.0,52.2],[108.5,53.5],[109.9,55.5],[108.6,55.3],[105.5,52.7]]);
  const srilanka = g.coast([[79.8,9.8],[81.0,8.9],[81.9,7.2],[80.6,5.9],[79.9,6.5],[79.7,8.0]]);
  const japan = [
    g.coast([[140.8,45.3],[145.3,44.2],[143.5,42.0],[140.5,42.6],[139.8,43.7]]),
    g.coast([[140.5,41.5],[141.5,40.5],[140.8,37.0],[139.8,34.9],[138.9,34.6],[137.0,34.7],[135.5,33.5],[133.0,34.3],[131.0,33.9],[130.6,33.0],[131.5,31.4],[130.6,31.0],[129.8,32.6],[131.8,34.5],[135.0,35.6],[137.2,37.0],[139.5,38.2],[139.9,40.5]]),
  ];
  const taiwan = g.coast([[121.0,25.3],[122.0,24.9],[120.9,22.6],[120.1,23.3],[120.3,24.7]]);
  const sumatra = g.coast([[95.3,5.6],[97.5,4.5],[100.5,1.5],[103.0,-1.0],[105.9,-3.5],[105.8,-5.9],[104.5,-5.5],[101.5,-2.5],[98.5,1.5],[95.2,4.6]]);
  const java = g.coast([[105.2,-6.1],[108.5,-6.7],[112.0,-6.9],[114.5,-7.7],[114.3,-8.6],[110.5,-8.2],[106.5,-7.4],[105.1,-6.8]]);
  const borneo = g.coast([[109.0,1.5],[110.5,1.0],[113.0,3.5],[117.0,4.3],[119.0,1.0],[116.2,-1.8],[114.5,-3.6],[110.2,-2.9],[108.9,-0.5]]);
  const sulawesi = g.coast([[119.8,0.5],[121.5,1.0],[124.8,1.5],[123.5,0.5],[121.5,-1.5],[122.5,-4.0],[120.5,-5.5],[119.5,-3.5],[120.0,-1.0]]);
  const png = g.coast([[131.2,-0.9],[134.5,-1.5],[138.0,-2.0],[142.0,-3.0],[147.0,-5.5],[150.0,-7.5],[147.5,-8.5],[143.5,-8.0],[139.0,-7.5],[135.0,-4.5],[132.5,-3.0],[130.9,-1.8]]);
  const philippines = [
    g.coast([[120.0,18.5],[122.2,17.0],[121.7,14.0],[120.5,14.5],[119.9,16.3]]),
    g.coast([[125.5,9.8],[126.5,7.5],[125.5,5.8],[123.5,6.9],[122.2,7.8],[124.0,8.8]]),
  ];
  const himalaya = [[71.5,35.5],[76.0,33.5],[80.0,30.5],[84.0,28.7],[88.0,27.8],[92.0,27.5],[96.0,28.5]];
  const rivers = [
    g.river([[38.5,36.5],[41.0,35.2],[44.0,33.5],[46.5,31.8],[48.55,30.0]]),
    g.river([[78.0,30.5],[80.5,26.5],[84.0,25.5],[88.0,24.5],[90.0,22.8]]),
    g.river([[97.0,33.5],[100.0,30.5],[104.5,28.8],[108.5,30.0],[112.0,30.2],[117.0,31.5],[121.5,31.6]]),
    g.river([[110.0,40.0],[114.5,38.0],[117.0,37.0],[119.0,37.3]]),
  ];

  pl("جبال الهيمالايا", "region", [84.0,28.5], 20, { aliases: ["himalaya", "الهملايا", "جبال الهملايا"] });
  pl("هضبة التبت", "region", [87.5,33.0], 17, { aliases: ["tibet", "التبت"] });
  pl("سهول سيبيريا", "region", [80.0,62.0], 48, { aliases: ["siberia", "سيبيريا"] });
  pl("شبه الجزيرة العربية", "region", [45.5,23.0], 26, { aliases: ["arabian peninsula", "الجزيرة العربية"] });
  pl("شبه القارة الهندية", "region", [77.5,21.5], 22, { aliases: ["indian subcontinent"] });
  pl("الهند", "region", [78.5,22.5], 20, { aliases: ["india"] });
  pl("الصين", "region", [104.0,34.0], 34, { aliases: ["china"] });
  pl("اليابان", "region", [137.5,36.5], 14, { aliases: ["japan"] });
  pl("إندونيسيا", "region", [110.0,-3.0], 30, { aliases: ["indonesia"] });
  pl("الفلبين", "region", [122.5,13.0], 14, { aliases: ["philippines"] });
  pl("تركيا", "region", [32.5,39.0], 16, { aliases: ["turkey"] });
  pl("إيران", "region", [54.0,32.5], 20, { aliases: ["iran"] });
  pl("باكستان", "region", [69.5,29.5], 14, { aliases: ["pakistan"] });
  pl("بنجلاديش", "region", [90.0,23.8], 8, { aliases: ["bangladesh", "بنغلاديش"] });
  pl("ميانمار", "region", [96.5,21.0], 12, { aliases: ["myanmar", "بورما"] });
  pl("تايلاند", "region", [101.0,15.5], 10, { aliases: ["thailand"] });
  pl("فيتنام", "region", [106.5,16.5], 10, { aliases: ["vietnam"] });
  pl("ماليزيا", "region", [102.0,4.5], 9, { aliases: ["malaysia"] });
  pl("كوريا", "region", [127.5,36.5], 9, { aliases: ["korea", "شبه الجزيرة الكورية"] });
  pl("منغوليا", "region", [103.0,46.5], 20, { aliases: ["mongolia"] });
  pl("كازاخستان", "region", [67.0,48.5], 24, { aliases: ["kazakhstan"] });
  pl("العراق", "region", [43.5,33.0], 11, { aliases: ["iraq"] });
  pl("السعودية", "region", [44.5,24.0], 22, { aliases: ["saudi arabia"] });
  pl("سريلانكا", "region", [80.8,7.8], 7, { ref: "srilanka", aliases: ["sri lanka"] });
  pl("بحر قزوين", "region", [51.0,41.5], 12, { ref: "caspian", aliases: ["caspian sea"] });
  pl("بحيرة بايكال", "region", [106.8,53.5], 8, { ref: "baikal", aliases: ["baikal"] });
  pl("نهر الجانج", "line", [84.0,25.5], 10, { ref: "ganges", aliases: ["ganges", "الغانج"] });
  pl("نهر اليانجتسي", "line", [108.0,29.8], 10, { ref: "yangtze", aliases: ["yangtze"] });
  pl("نهرا دجلة والفرات", "line", [43.5,34.2], 10, { ref: "tigris", aliases: ["دجلة", "الفرات", "tigris", "euphrates"] });
  pl("المحيط الهندي", "sea", [78.0,-6.0], 30, { aliases: ["indian ocean"] });
  pl("المحيط الهادي", "sea", [146.0,20.0], 24, { aliases: ["pacific", "المحيط الهادئ"] });
  pl("المحيط المتجمد الشمالي", "sea", [90.0,76.8], 24, { aliases: ["arctic ocean"] });
  pl("بحر العرب", "sea", [64.0,14.0], 16, { aliases: ["arabian sea"] });
  pl("خليج البنغال", "sea", [87.5,14.0], 16, { aliases: ["bay of bengal"] });
  pl("بحر الصين الجنوبي", "sea", [114.0,14.0], 16, { aliases: ["south china sea"] });
  pl("الخليج العربي", "sea", [50.8,27.5], 8, { aliases: ["arabian gulf"] });
  pl("البحر المتوسط", "sea", [28.5,33.8], 12, { aliases: ["mediterranean"] });

  return [
    `<path id="land" d="${main}" ${S.land}/>`,
    `<path id="caspian" d="${caspian}" ${S.water}/>`,
    `<path d="${aral}" ${S.water}/>`,
    `<path id="baikal" d="${baikal}" ${S.water}/>`,
    `<path id="srilanka" d="${srilanka}" ${S.landThin}/>`,
    ...japan.map((d, i) => `<path ${i === 0 ? "" : 'id="japan-main" '}d="${d}" ${S.landThin}/>`),
    `<path d="${taiwan}" ${S.landThin}/>`,
    `<path d="${sumatra}" ${S.landThin}/>`,
    `<path d="${java}" ${S.landThin}/>`,
    `<path d="${borneo}" ${S.landThin}/>`,
    `<path d="${sulawesi}" ${S.landThin}/>`,
    `<path d="${png}" ${S.landThin}/>`,
    ...philippines.map((d) => `<path d="${d}" ${S.landThin}/>`),
    `<path id="tigris" d="${rivers[0]}" ${S.riverThin}/>`,
    `<path id="ganges" d="${rivers[1]}" ${S.riverThin}/>`,
    `<path id="yangtze" d="${rivers[2]}" ${S.riverThin}/>`,
    `<path d="${rivers[3]}" ${S.riverThin}/>`,
    carets(proj, himalaya, 7),
    seaLabel(proj.X(76), proj.Y(-8.2), "المحيط الهندي", 9),
    seaLabel(proj.X(143.5), proj.Y(16.5), "المحيط الهادي", 8),
    seaLabel(proj.X(88), proj.Y(75.5), "المحيط المتجمد الشمالي", 8),
  ];
});

/* ================= WORLD ================= */

emit("world", { W: -170, E: 190, S: -64, N: 80, s: 1.4 }, ({ proj, g, pl }) => {
  const americas = g.coast([
    [-168,65.5],[-156,71.0],[-140,69.5],[-125,69.5],[-110,68.0],[-95,68.5],[-85,66.0],[-82,62.0],[-94,58.7],[-85,55.0],[-82,52.9],[-79,54.6],[-77,58.0],[-70,60.0],[-64,58.5],[-60,55.0],[-66,50.0],[-65,47.0],[-70,43.5],[-74,40.5],[-76,35.0],[-81,31.0],[-80,25.5],[-83,29.5],[-89,29.2],[-94,29.5],[-97,26.0],[-97,21.5],[-94,18.5],[-90,21.2],[-87,21.5],[-88,16.0],[-83.5,10.5],[-79.5,9.0],[-77,7.5],[-75,10.5],[-71,12.2],[-64,10.7],[-60,8.5],[-52,5.0],[-44,-2.8],[-35,-5.5],[-38.5,-13.0],[-40,-20.0],[-48,-25.5],[-53,-34.0],[-58,-34.5],[-62,-39.0],[-65,-45.0],[-68.5,-50.0],[-68,-53.5],[-71,-53.0],[-73,-50.0],[-73.7,-45.0],[-73,-40.0],[-71.5,-32.0],[-70.5,-25.0],[-70.5,-18.3],[-75.5,-14.5],[-79,-8.0],[-81,-6.0],[-80,-3.0],[-77.5,1.0],[-79,7.0],[-83,9.0],[-85,11.5],[-88,13.0],[-92,15.0],[-95,16.2],[-105,20.0],[-106,23.5],[-109,23.0],[-113,29.0],[-117,32.5],[-122,34.5],[-124,40.0],[-124,46.0],[-125,49.0],[-128,51.0],[-132,55.0],[-136,58.0],[-140,60.0],[-146,61.0],[-151,59.5],[-158,58.0],[-165,60.0],[-162,63.0],
  ]);
  const greenland = g.coast([[-45,60.0],[-52,64.0],[-54,68.0],[-52,72.0],[-44,76.5],[-38,77.5],[-30,76.0],[-25,73.0],[-20,70.0],[-24,66.0],[-33,62.0],[-40,59.8]]);
  const eurafrasia = g.coast([
    // Norway up + Arctic Russia
    [5.5,58.5],[5.0,62.0],[12.0,65.0],[18.0,69.5],[25.0,71.0],[35.0,68.5],[44.0,67.5],[54.0,68.5],[68.0,69.0],[80.0,73.2],[95.0,75.8],[104.0,77.3],[113.0,76.2],[130.0,72.3],[150.0,70.5],[160.0,69.8],[170.0,67.0],[178.0,65.5],[187.0,66.0],[189.5,65.0],
    // Pacific coast down
    [186.0,60.0],[178.0,62.5],[170.0,60.0],[162.0,59.5],[155.0,59.0],[143.0,53.5],[140.4,48.5],[133.0,42.5],[130.7,42.3],[129.0,35.2],[126.0,35.0],[125.4,37.7],[121.5,39.0],[122.0,40.6],[117.8,38.5],[119.2,37.1],[122.2,36.9],[121.9,31.7],[120.0,27.5],[116.5,23.3],[110.5,21.4],[108.0,20.9],[105.6,18.8],[108.8,15.4],[109.0,11.4],[105.0,9.5],[102.5,12.2],[100.0,13.4],[99.2,10.5],[100.4,7.2],[103.6,1.5],[100.3,5.8],[98.5,10.0],[97.5,16.8],[94.2,18.0],[91.8,22.5],[87.0,21.1],[82.3,16.5],[80.1,13.5],[77.5,8.1],[72.8,19.0],[69.0,22.2],[66.7,25.2],[61.7,25.1],[57.3,26.7],[52.6,27.9],[50.3,29.9],[48.55,30.0],[48.15,28.9],[50.15,26.6],[51.1,25.3],[54.0,24.15],[56.1,26.1],[58.55,23.6],[59.8,22.3],[57.7,19.0],[55.4,17.0],[52.2,15.65],[45.05,12.75],[43.25,12.7],[42.7,15.4],[41.6,18.0],[39.1,21.6],[37.4,24.7],[35.8,27.2],[34.95,29.4],[34.28,27.8],[33.1,29.05],[32.58,29.95],
    // Africa
    [32.3,31.28],[31.05,31.58],[29.92,31.2],[25.15,31.58],[23.95,32.1],[20.05,32.1],[16.6,31.2],[13.2,32.9],[10.75,34.7],[10.2,37.2],[7.75,36.9],[3.05,36.75],[-2.9,35.3],[-5.85,35.78],
    // Gibraltar "touch" then Iberia + Atlantic Europe
    [-5.4,36.1],[-9.0,37.0],[-9.5,38.7],[-9.0,43.5],[-2.0,43.6],[-1.0,45.5],[-4.8,48.4],[-1.8,49.6],[0.0,49.7],[3.0,51.0],[5.0,53.0],[8.0,54.0],[8.2,56.5],[10.0,57.5],[11.0,55.5],[13.0,55.0],[18.0,56.5],[21.0,59.0],[24.0,59.5],[25.5,61.0],[25.0,65.8],[21.5,67.0],[19.0,68.5],[17.0,65.0],[13.0,61.0],[8.0,58.0]
  ].concat([
    // NOTE: Africa west side patched below via a separate closed path union hack:
  ]));
  // Africa needs its own west coast; draw Africa as a second closed landmass
  // overlapping Eurasia at Suez/Gibraltar (overlap is invisible: same fill).
  const africa = g.coast(AF.coast);
  const australia = g.coast([[113,-22],[114,-26],[115.5,-33.5],[118,-35],[124,-33],[129,-31.8],[133,-32],[135.5,-34.8],[138,-35.5],[140,-38],[147,-38.8],[150,-37],[153,-32],[153,-27],[150,-22],[146,-19],[143,-14],[142,-10.7],[140,-17.5],[136,-15.5],[135,-12],[131,-12.2],[129,-15],[126,-14],[122,-18],[116,-20.5]]);
  const uk = g.coast([[-5.2,50.0],[0.5,50.8],[1.8,52.5],[-0.5,54.5],[-2.5,56.0],[-4.0,57.8],[-5.5,58.3],[-5.0,55.5],[-3.2,54.0],[-4.5,52.5],[-5.3,51.5]]);
  const japan = g.coast([[140.5,41.5],[141.5,40.5],[140.8,37.0],[139.8,34.9],[135.5,33.5],[131.0,33.9],[130.6,31.0],[132.0,33.5],[136.0,35.5],[139.5,38.2],[139.9,40.5]]);
  const madagascar = g.coast(AF.madagascar);
  const sumatra = g.coast([[95.3,5.6],[100.5,1.5],[105.9,-3.5],[105.8,-5.9],[101.5,-2.5],[95.2,4.6]]);
  const borneo = g.coast([[109.0,1.5],[113.0,3.5],[117.0,4.3],[119.0,1.0],[114.5,-3.6],[110.2,-2.9]]);
  const png = g.coast([[131.2,-0.9],[138.0,-2.0],[147.0,-5.5],[150.0,-7.5],[143.5,-8.0],[135.0,-4.5]]);
  const nz = [
    g.coast([[172.7,-34.5],[178.3,-37.5],[176.0,-41.0],[174.5,-41.3],[173.0,-39.3],[174.5,-38.0]]),
    g.coast([[172.5,-40.6],[174.2,-41.5],[172.8,-43.6],[169.0,-46.6],[166.5,-45.8],[170.5,-42.8]]),
  ];
  const antarctica = g.coast([[-168,-61.5],[-140,-63.0],[-100,-62.0],[-60,-61.0],[-20,-63.0],[20,-62.0],[60,-61.5],[100,-63.0],[140,-62.0],[175,-61.5],[188,-62.5],[188,-64.0],[-168,-64.0]]);
  const caspian = g.coast([[49.0,46.8],[53.9,42.0],[53.9,38.9],[51.2,36.6],[49.0,37.3],[47.3,42.2]]);
  const blacksea = g.coast([[28.5,43.5],[33.5,44.5],[38.5,44.5],[41.3,42.0],[38.0,41.0],[31.5,41.4],[28.9,41.3],[27.8,42.5]]);
  const med = g.coast([[-4.8,36.4],[3.0,38.5],[10.0,38.8],[12.0,40.5],[15.5,39.0],[18.5,36.0],[24.0,35.6],[30.0,34.0],[35.3,34.2],[33.0,32.3],[27.0,32.4],[19.0,31.9],[13.5,33.5],[10.5,35.5],[5.0,36.4],[-2.0,35.8]]);

  pl("أفريقيا", "region", [17.0,5.0], 48, { aliases: ["africa", "إفريقيا"] });
  pl("آسيا", "region", [90.0,45.0], 62, { aliases: ["asia", "اسيا"] });
  pl("أوروبا", "region", [15.0,50.0], 22, { aliases: ["europe", "أوربا"] });
  pl("أمريكا الشمالية", "region", [-100.0,45.0], 48, { aliases: ["north america"] });
  pl("أمريكا الجنوبية", "region", [-60.0,-15.0], 38, { aliases: ["south america"] });
  pl("أستراليا", "region", [134.0,-25.0], 26, { aliases: ["australia", "أوقيانوسيا"] });
  pl("القارة القطبية الجنوبية", "region", [10.0,-62.6], 40, { ref: "antarctica", aliases: ["antarctica", "أنتاركتيكا"] });
  pl("جرينلاند", "region", [-40.0,70.0], 16, { ref: "greenland", aliases: ["greenland"] });
  pl("مصر", "point", [30.5,27.0], 8, { aliases: ["egypt"] });
  // population distribution zones (soc2-2) — thematic anchors, no drawn poly
  // (matches the ref-less continent-region convention above)
  pl("شرق آسيا", "region", [116.0,33.0], 18, { aliases: ["east asia"] });
  pl("جنوب آسيا", "region", [80.0,23.0], 16, { aliases: ["south asia"] });
  pl("غرب أوروبا", "region", [7.0,49.0], 12, { aliases: ["western europe"] });
  pl("شمال شرق أمريكا الشمالية", "region", [-77.0,41.0], 12, { aliases: ["northeast north america"] });
  pl("وادي النيل", "region", [31.0,26.0], 8, { aliases: ["nile valley"] });
  pl("الصحراء الكبرى", "region", [15.0,23.0], 20, { aliases: ["sahara"] });
  pl("حوض الأمازون", "region", [-63.0,-4.0], 16, { aliases: ["amazon basin"] });
  pl("حوض الكونغو", "region", [21.0,-1.0], 12, { aliases: ["congo basin"] });
  pl("المناطق القطبية الشمالية", "region", [95.0,74.0], 20, { aliases: ["arctic regions", "polar regions"] });
  pl("المحيط الهادي", "sea", [-140.0,0.0], 50, { aliases: ["pacific", "المحيط الهادئ"] });
  pl("المحيط الأطلنطي", "sea", [-35.0,25.0], 36, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("المحيط الهندي", "sea", [80.0,-20.0], 36, { aliases: ["indian ocean"] });
  pl("المحيط المتجمد الشمالي", "sea", [60.0,78.5], 30, { aliases: ["arctic ocean"] });
  pl("البحر المتوسط", "sea", [15.0,35.5], 12, { aliases: ["mediterranean"] });
  pl("خط الاستواء", "line", [-120.0,0.0], 8, { ref: "equator", aliases: ["equator"] });
  pl("مدار السرطان", "line", [-120.0,23.44], 8, { ref: "cancer", aliases: ["tropic of cancer"] });
  pl("مدار الجدي", "line", [-120.0,-23.44], 8, { ref: "capricorn", aliases: ["tropic of capricorn"] });
  pl("خط جرينتش", "line", [0.0,15.0], 8, { ref: "greenwich", aliases: ["greenwich", "خط الطول الرئيسي"] });

  const eq = proj.Y(0), cancer = proj.Y(23.44), capr = proj.Y(-23.44), gw = proj.X(0);
  return [
    `<path id="antarctica" d="${antarctica}" ${S.neighbor}/>`,
    `<path id="americas" d="${americas}" ${S.landThin}/>`,
    `<path id="greenland" d="${greenland}" ${S.landThin}/>`,
    `<path id="eurasia" d="${eurafrasia}" ${S.landThin}/>`,
    `<path id="africa-l" d="${africa}" style="fill:var(--card,#fdfbf3);stroke:var(--ink,#20293a);stroke-width:1"/>`,
    `<path d="${med}" ${S.water}/>`,
    `<path d="${blacksea}" ${S.water}/>`,
    `<path d="${caspian}" ${S.water}/>`,
    `<path id="australia-l" d="${australia}" ${S.landThin}/>`,
    `<path d="${uk}" ${S.landThin}/>`,
    `<path d="${japan}" ${S.landThin}/>`,
    `<path d="${madagascar}" ${S.landThin}/>`,
    `<path d="${sumatra}" ${S.landThin}/>`,
    `<path d="${borneo}" ${S.landThin}/>`,
    `<path d="${png}" ${S.landThin}/>`,
    ...nz.map((d) => `<path d="${d}" ${S.landThin}/>`),
    `<line id="equator" x1="0" y1="${eq}" x2="${proj.width}" y2="${eq}" ${S.grat}/>`,
    `<line id="cancer" x1="0" y1="${cancer}" x2="${proj.width}" y2="${cancer}" style="fill:none;stroke:var(--gold,#a97e22);stroke-width:0.5;stroke-dasharray:4 4;opacity:0.4"/>`,
    `<line id="capricorn" x1="0" y1="${capr}" x2="${proj.width}" y2="${capr}" style="fill:none;stroke:var(--gold,#a97e22);stroke-width:0.5;stroke-dasharray:4 4;opacity:0.4"/>`,
    `<line id="greenwich" x1="${gw}" y1="0" x2="${gw}" y2="${proj.height}" style="fill:none;stroke:var(--gold,#a97e22);stroke-width:0.5;stroke-dasharray:4 4;opacity:0.35"/>`,
    `<text x="${proj.X(-150)}" y="${eq - 3}" style="fill:var(--gold,#a97e22);font-size:6.5px;opacity:0.8">خط الاستواء</text>`,
    seaLabel(proj.X(-140), proj.Y(-8), "المحيط الهادي", 8),
    seaLabel(proj.X(-35), proj.Y(20), "المحيط الأطلنطي", 8),
    seaLabel(proj.X(82), proj.Y(-24), "المحيط الهندي", 8),
  ];
});

/* ================= MEDITERRANEAN EAST ================= */

emit("mediterranean_east", { W: 2.5, E: 42, S: 26.8, N: 46.8, s: 10 }, ({ proj, g, pl }) => {
  const south = g.chain(
    [
      // North Africa coast from frame -> Levant -> Anatolia -> Black Sea coast
      { pts: [[2.5,36.6],[3.05,36.75],[7.75,36.9],[10.2,37.2],[11.05,37.05],[10.75,34.7],[10.1,33.9],[13.2,32.9],[16.6,31.2],[20.05,32.1],[23.95,32.1],[25.15,31.58],[27.9,31.1],[29.92,31.2],[30.4,31.45],[31.05,31.58],[31.85,31.5],[32.3,31.28],[33.8,31.12],[34.3,31.35],[34.95,32.5],[35.07,32.93],[35.48,33.9],[35.62,34.65],[35.85,35.55],[35.9,36.2],[36.1,36.6],[35.5,36.55],[34.6,36.7],[33.7,36.15],[32.0,36.1],[30.5,36.3],[29.5,36.2],[28.2,36.5],[27.3,36.7],[26.9,38.4],[26.4,39.3],[26.9,40.3],[29.2,41.05],[32.0,41.6],[35.0,42.0],[38.5,41.0],[41.6,41.3]], smooth: true },
      { pts: [[41.6,41.3],[42,41.4],[42,26.8],[2.5,26.8],[2.5,36.6]], smooth: false },
    ],
    true
  );
  const europe = g.chain(
    [
      { pts: [[2.5,43.2],[5.4,43.25],[5.93,43.12],[6.6,43.2],[7.6,43.7],[8.9,44.4],[10.1,43.9],[11.2,42.4],[12.2,41.7],[13.9,41.0],[15.6,40.0],[15.65,38.0],[16.3,38.3],[17.2,39.4],[18.4,40.3],[16.0,41.9],[14.5,42.4],[13.6,45.6],[15.2,44.3],[16.9,43.0],[19.0,42.0],[19.5,41.8],[20.7,39.0],[21.8,36.8],[23.0,36.4],[23.7,37.9],[24.2,38.9],[23.3,40.2],[24.5,40.9],[26.3,40.95],[28.0,41.2],[28.4,41.6],[28.1,43.4],[28.8,44.8],[30.7,46.2],[29.8,46.8]], smooth: true },
      { pts: [[29.8,46.8],[2.5,46.8],[2.5,43.2]], smooth: false },
    ],
    true
  );
  const sicily = g.coast([[12.4,37.8],[15.3,37.1],[15.65,38.25],[13.7,38.1]]);
  const sardinia = g.coast([[8.2,38.9],[9.6,39.2],[9.5,41.2],[8.2,40.9]]);
  const corsica = g.coast([[8.6,41.4],[9.5,42.0],[9.35,43.0],[8.6,42.6]]);
  const crete = g.coast([[23.5,35.2],[26.3,35.2],[25.7,34.9],[24.0,34.8]]);
  const cyprus = g.coast([[32.3,35.15],[33.9,35.4],[34.55,35.65],[33.5,34.7],[32.4,34.75]]);
  const malta = `M${proj.X(14.3)},${proj.Y(35.95)} a2.6,1.9 0 1 0 0.1,0.05 Z`;
  const delta = g.coast([[31.23,30.02],[30.55,30.55],[30.30,31.05],[30.42,31.44],[31.05,31.56],[31.85,31.47],[32.22,31.22],[31.75,30.65]]);
  const nileLower = g.river([[31.1,26.8],[31.25,27.2],[30.8,28.1],[31.1,29.05],[31.23,30.05]]);

  pl("طولون", "point", [5.93,43.12], 10, { aliases: ["toulon"] });
  pl("مالطا", "point", [14.35,35.9], 8, { ref: "malta-i", aliases: ["malta", "جزيرة مالطا"] });
  pl("الإسكندرية", "point", [29.92,31.2], 10, { aliases: ["alexandria"] });
  pl("أبو قير", "point", [30.07,31.33], 8, { aliases: ["abu qir", "أبي قير"] });
  pl("رشيد", "point", [30.4,31.42], 8, { aliases: ["rosetta"] });
  pl("دمياط", "point", [31.82,31.44], 8, { aliases: ["damietta"] });
  pl("إمبابة", "point", [31.13,30.08], 8, { aliases: ["embaba", "امبابة"] });
  pl("القاهرة", "point", [31.28,30.02], 9, { aliases: ["cairo"] });
  pl("الصالحية", "point", [32.05,30.8], 7, { aliases: ["salhiya"] });
  pl("العريش", "point", [33.8,31.13], 8, { aliases: ["arish"] });
  pl("غزة", "point", [34.3,31.4], 7, { aliases: ["gaza"] });
  pl("يافا", "point", [34.75,32.05], 7, { aliases: ["jaffa"] });
  pl("عكا", "point", [35.07,32.93], 8, { aliases: ["acre", "akka"] });
  pl("دمشق", "point", [36.3,33.5], 8, { aliases: ["damascus"] });
  pl("القسطنطينية", "point", [29.0,41.1], 9, { aliases: ["istanbul", "إسطنبول", "الأستانة"] });
  // Ottoman conquest of Egypt (soc3-1): route القسطنطينية → حلب/مرج دابق → الشام → الريدانية
  pl("حلب", "point", [37.16,36.20], 8, { aliases: ["aleppo"] });
  pl("مرج دابق", "point", [37.40,36.57], 8, { aliases: ["marj dabiq"] });
  pl("الريدانية", "point", [31.35,30.12], 8, { aliases: ["ridaniya", "raydaniyya"] });
  // Muhammad Ali campaigns — Greek & Syrian theaters (soc3-4)
  pl("قونية", "point", [32.50,37.87], 8, { aliases: ["konya"] });
  pl("نصيبين", "point", [37.79,37.00], 8, { aliases: ["nezib", "nizip"] });
  pl("نافارين", "point", [21.70,36.92], 8, { aliases: ["navarino"] });
  pl("فرنسا", "region", [4.2,45.3], 16, { aliases: ["france"] });
  pl("إيطاليا", "region", [12.8,43.2], 14, { aliases: ["italy", "ايطاليا"] });
  pl("اليونان", "region", [22.0,39.3], 10, { aliases: ["greece", "بلاد اليونان"] });
  pl("مصر", "region", [30.0,29.3], 18, { aliases: ["egypt"] });
  pl("الشام", "region", [36.6,34.6], 14, { aliases: ["بلاد الشام", "levant", "سوريا"] });
  pl("الدولة العثمانية", "region", [33.0,39.3], 22, { aliases: ["ottoman empire", "الأناضول", "تركيا"] });
  pl("المورة", "region", [22.2,37.2], 10, { aliases: ["morea", "peloponnese", "بلاد المورة"] });
  pl("صقلية", "region", [14.2,37.6], 8, { ref: "sicily", aliases: ["sicily"] });
  pl("كريت", "region", [24.9,35.05], 8, { ref: "crete", aliases: ["crete"] });
  pl("قبرص", "region", [33.3,35.2], 8, { ref: "cyprus", aliases: ["cyprus"] });
  pl("البحر المتوسط", "sea", [19.5,34.3], 30, { aliases: ["mediterranean", "البحر الأبيض المتوسط"] });
  pl("بحر إيجه", "sea", [25.2,38.3], 8, { aliases: ["aegean"] });
  pl("البحر الأسود", "sea", [35.5,43.8], 16, { aliases: ["black sea"] });
  pl("البحر الأدرياتيكي", "sea", [16.2,44.0], 8, { aliases: ["adriatic"] });
  pl("فرع رشيد", "line", [30.7,30.8], 8, { ref: "rosetta-branch" });
  pl("فرع دمياط", "line", [31.6,30.85], 8, { ref: "damietta-branch" });

  return [
    `<path id="south-land" d="${south}" ${S.land}/>`,
    `<path id="europe-land" d="${europe}" ${S.land}/>`,
    `<path id="sicily" d="${sicily}" ${S.landThin}/>`,
    `<path d="${sardinia}" ${S.landThin}/>`,
    `<path d="${corsica}" ${S.landThin}/>`,
    `<path id="crete" d="${crete}" ${S.landThin}/>`,
    `<path id="cyprus" d="${cyprus}" ${S.landThin}/>`,
    `<path id="malta-i" d="${malta}" ${S.landThin}/>`,
    `<path d="${delta}" ${S.green}/>`,
    `<path id="nile-lower" d="${nileLower}" ${S.river}/>`,
    `<path id="rosetta-branch" d="${g.river(EG.rosetta)}" ${S.riverThin}/>`,
    `<path id="damietta-branch" d="${g.river(EG.damietta)}" ${S.riverThin}/>`,
    seaLabel(proj.X(19.5), proj.Y(34.6), "البحر المتوسط", 9),
    seaLabel(proj.X(35.5), proj.Y(44.2), "البحر الأسود", 8),
  ];
});

/* ================= EUROPE ================= */

emit("europe", { W: -11, E: 52, S: 34, N: 71.5, s: 12.5 }, ({ proj, g, pl }) => {
  const mainland = g.chain(
    [
      // Atlantic + North Sea + Baltic-south + Finland + Arctic (west & north coast)
      { pts: [
        [-5.7,36.1],[-9.0,37.0],[-9.4,38.7],[-8.9,41.1],[-9.1,43.0],[-4.5,43.6],[-1.6,43.4],
        [-1.2,45.6],[-2.0,47.3],[-4.7,48.3],[-1.6,49.7],[1.6,50.95],[3.4,51.6],[4.8,52.9],
        [7.0,53.6],[8.4,55.4],[8.6,57.6],[10.6,57.3],[12.5,54.6],[14.2,54.0],[18.7,54.6],
        [20.5,55.3],[21.0,56.8],[24.0,57.5],[24.5,59.5],[28.2,59.4],[30.2,60.0],[25.0,60.2],
        [21.8,60.5],[21.5,63.3],[24.5,65.8],[28.0,68.5],[33.0,69.6],[40.5,68.5],[44.0,68.0],
        [48.0,68.2],[52.0,68.5]
      ], smooth: true },
      // east frame cut
      { pts: [[52.0,68.5],[52.0,46.5]], smooth: false },
      // south coast: Volga/Caucasus -> Black Sea north -> Balkans -> Italy -> Iberia Med
      { pts: [
        [52.0,46.5],[49.0,47.0],[47.5,45.0],[46.0,43.2],[41.5,43.2],[39.5,43.4],[38.5,46.0],
        [35.5,46.5],[33.5,46.3],[30.7,46.5],[29.7,45.3],[28.5,43.5],[28.0,41.9],[26.5,40.9],
        [24.0,40.6],[23.5,38.0],[23.1,37.0],[21.8,37.0],[20.9,39.0],[19.3,42.0],[18.5,42.9],
        [15.2,44.2],[13.6,45.7],[12.5,44.5],[15.5,41.9],[18.4,40.1],[16.2,38.9],[15.7,38.0],
        [15.9,40.0],[14.0,40.8],[11.2,42.4],[10.0,44.0],[7.6,43.7],[5.2,43.3],[3.0,42.4],
        [1.0,41.1],[-0.3,39.4],[-1.5,37.5],[-4.5,36.7],[-5.7,36.1]
      ], smooth: true },
    ],
    true
  );
  // faded neighbour: Anatolia + Caucasus-south + NW Iran (bounds Black & Caspian seas)
  const anatolia = g.poly([
    [28.0,41.0],[31.0,41.2],[35.0,42.0],[38.0,41.3],[41.5,41.4],[45.0,41.4],[48.0,39.2],
    [50.5,38.2],[52.0,37.8],[52.0,34.0],[42.0,34.0],[38.0,35.3],[36.1,36.6],[33.7,36.15],
    [30.5,36.3],[27.9,36.7],[26.9,38.4],[26.6,39.6],[27.0,40.6]
  ]);
  const blacksea = g.coast([
    [28.2,41.3],[31.0,41.2],[35.0,41.5],[38.5,41.2],[41.5,41.5],[40.0,43.5],[36.0,45.2],
    [33.0,46.0],[31.0,46.3],[29.5,45.0],[28.2,42.0]
  ]);
  const caspian = g.coast([
    [47.5,44.5],[49.0,46.5],[51.5,46.0],[52.0,44.0],[52.0,38.5],[50.5,37.5],[49.0,38.5],
    [47.8,40.5],[47.3,42.5]
  ]);
  const scandinavia = g.coast([
    [7.0,58.0],[5.2,59.0],[5.0,60.8],[7.0,63.0],[10.5,64.0],[12.5,66.0],[14.5,67.6],
    [17.0,68.6],[20.0,69.8],[25.5,71.0],[28.5,70.6],[26.0,69.0],[24.5,65.8],[21.5,63.3],
    [18.5,61.0],[17.5,60.7],[18.8,58.5],[16.5,56.3],[14.5,56.1],[12.6,56.2],[11.8,58.0],[9.5,58.9]
  ]);
  const britain = g.coast([
    [-5.2,50.0],[-3.5,50.3],[0.5,50.8],[1.7,52.6],[-0.2,53.6],[-3.0,54.5],[-3.2,56.0],
    [-2.0,57.5],[-3.5,58.6],[-5.2,58.4],[-5.8,56.5],[-4.9,54.6],[-4.2,53.3],[-4.8,52.9],
    [-4.2,52.2],[-5.3,51.7],[-3.5,51.3]
  ]);
  const ireland = g.coast([
    [-10.2,51.6],[-6.5,52.2],[-6.0,53.4],[-6.3,54.4],[-8.0,55.3],[-10.0,54.3],[-9.8,53.2],[-9.9,52.2]
  ]);
  const sicily = g.coast([[12.4,37.8],[15.3,37.1],[15.65,38.25],[13.7,38.1]]);
  const sardinia = g.coast([[8.3,38.9],[9.6,39.2],[9.5,41.2],[8.2,40.9]]);
  const corsica = g.coast([[8.6,41.4],[9.5,42.0],[9.35,43.0],[8.6,42.6]]);
  const crete = g.coast([[23.5,35.25],[26.2,35.3],[25.6,34.85],[24.0,34.85]]);

  const rPlain = g.poly([[3,52],[15,54],[30,56],[45,55],[50,50],[38,49],[22,50],[10,50.5]]);
  const rMeseta = g.poly([[-8,40],[-2,41],[-1,39],[-6,38.5]]);
  const rMassif = g.poly([[1.5,45.8],[4.0,45.5],[4.2,44.2],[2.0,44.3]]);

  const volga = g.river([[36.5,57.0],[40.0,57.5],[44.5,56.5],[47.5,53.5],[46.0,50.5],[47.5,48.0],[49.0,46.6]]);
  const rhine = g.river([[8.6,46.9],[7.6,48.0],[7.2,49.5],[6.4,51.0],[6.0,51.9],[4.3,52.0]]);
  const danube = g.river([[8.3,48.0],[11.0,48.7],[14.0,48.3],[16.9,48.1],[19.0,47.8],[20.5,46.0],[22.5,44.7],[25.0,44.0],[27.5,44.2],[28.8,45.2],[29.7,45.3]]);

  const alpsLine = [[6.0,45.2],[8.0,45.9],[10.5,46.5],[13.0,47.0],[15.0,47.2]];
  const pyreneesLine = [[-1.4,43.0],[0.5,42.7],[2.5,42.4]];
  const dinaricLine = [[14.5,45.5],[16.5,44.2],[18.5,43.2],[19.5,42.2]];

  pl("جبال الألب", "region", [10.5,46.4], 16, { aliases: ["alps", "الألب"] });
  pl("جبال البرانس", "region", [0.3,42.7], 10, { aliases: ["pyrenees"] });
  pl("جبال الألب الدينارية", "region", [17.5,44.0], 10, { aliases: ["dinaric alps"] });
  pl("هضبة المزيتا", "region", [-4.0,40.2], 14, { ref: "r-meseta", aliases: ["meseta"] });
  pl("هضبة فرنسا الوسطى", "region", [2.8,45.0], 10, { ref: "r-massif", aliases: ["massif central"] });
  pl("السهل الأوروبي العظيم", "region", [24.0,53.0], 40, { ref: "r-plain", aliases: ["great european plain"] });
  pl("نهر الفولجا", "line", [46.5,52.0], 14, { ref: "volga", aliases: ["volga", "الفولغا"] });
  pl("نهر الراين", "line", [7.0,50.0], 10, { ref: "rhine", aliases: ["rhine"] });
  pl("نهر الدانوب", "line", [20.0,45.5], 14, { ref: "danube", aliases: ["danube", "الدانوب"] });
  pl("المحيط الأطلنطي", "sea", [-9.5,47.0], 20, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("البحر المتوسط", "sea", [16.0,36.0], 20, { aliases: ["mediterranean"] });
  pl("بحر الشمال", "sea", [2.5,56.0], 12, { aliases: ["north sea"] });
  pl("البحر الأسود", "sea", [34.5,43.5], 14, { aliases: ["black sea"] });
  pl("بحر البلطيق", "sea", [19.5,58.0], 12, { aliases: ["baltic sea"] });
  pl("بحر قزوين", "sea", [50.0,43.0], 10, { aliases: ["caspian sea", "بحر قزوين"] });

  return [
    `<path d="${anatolia}" ${S.neighbor}/>`,
    `<path d="${blacksea}" ${S.water}/>`,
    `<path d="${caspian}" ${S.water}/>`,
    `<path id="land" d="${mainland}" ${S.land}/>`,
    `<path id="scandinavia" d="${scandinavia}" ${S.land}/>`,
    `<path d="${britain}" ${S.landThin}/>`,
    `<path d="${ireland}" ${S.landThin}/>`,
    `<path d="${sicily}" ${S.landThin}/>`,
    `<path d="${sardinia}" ${S.landThin}/>`,
    `<path d="${corsica}" ${S.landThin}/>`,
    `<path d="${crete}" ${S.landThin}/>`,
    `<path id="r-plain" d="${rPlain}" ${S.hidden}/>`,
    `<path id="r-meseta" d="${rMeseta}" ${S.hidden}/>`,
    `<path id="r-massif" d="${rMassif}" ${S.hidden}/>`,
    `<path id="volga" d="${volga}" ${S.river}/>`,
    `<path id="rhine" d="${rhine}" ${S.riverThin}/>`,
    `<path id="danube" d="${danube}" ${S.river}/>`,
    carets(proj, alpsLine, 6),
    carets(proj, pyreneesLine, 3),
    carets(proj, dinaricLine, 4),
    seaLabel(proj.X(-9.5), proj.Y(47.8), "المحيط الأطلنطي", 8),
    seaLabel(proj.X(16.5), proj.Y(35.7), "البحر المتوسط", 8.5),
    seaLabel(proj.X(2.5), proj.Y(56.3), "بحر الشمال", 8),
    seaLabel(proj.X(34.5), proj.Y(43.6), "البحر الأسود", 8),
    seaLabel(proj.X(19.5), proj.Y(58.3), "بحر البلطيق", 8),
  ];
});

/* ================= NORTH AMERICA ================= */

emit("north_america", { W: -168, E: -52, S: 7, N: 74, s: 5.4 }, ({ proj, g, pl }) => {
  const land = g.coast([
    [-168,66.0],[-166,68.5],[-156,71.0],[-145,70.0],[-130,70.2],[-124,70.0],[-115,68.8],
    [-105,68.5],[-96,68.2],[-92,63.5],[-94,60.0],[-92,57.0],[-88,56.5],[-85,55.2],[-82,55.3],
    [-80,53.0],[-79.5,55.0],[-78,58.0],[-77,62.0],[-72,61.0],[-70,63.0],[-64,60.5],[-62,56.0],
    [-60,53.5],[-56,52.5],[-55,50.5],[-58,50.0],[-60,47.5],[-64,49.5],[-66,49.0],[-64,45.5],
    [-66,44.5],[-70,43.0],[-74,40.5],[-76,37.5],[-76,35.0],[-81,31.0],[-80,25.2],[-83,29.0],
    [-84,30.0],[-89,29.0],[-94,29.5],[-97,25.9],[-97,22.5],[-95,18.7],[-91,18.6],[-90,21.2],
    [-87,21.5],[-88,17.8],[-84,15.8],[-83.5,11.0],[-81,8.9],[-78,8.5],[-79,9.5],[-83,8.5],
    [-87,13.2],[-92,15.2],[-96,16.0],[-101,17.5],[-105,20.0],[-106,23.2],[-109.5,23.0],
    [-112,26.5],[-114,31.0],[-117,32.5],[-121,34.4],[-122,37.0],[-124,40.5],[-124,46.0],
    [-123,48.3],[-126,49.8],[-129,51.5],[-133,54.5],[-136,57.5],[-140,59.5],[-146,60.2],
    [-150,59.2],[-152,59.8],[-155,58.5],[-158,56.0],[-162,55.0],[-160,58.5],[-164,60.5],
    [-162,63.0],[-165,64.5],[-168,65.5]
  ]);
  const cuba = g.coast([[-84.9,22.0],[-81,23.2],[-77,21.5],[-74,20.3],[-77,19.9],[-82,21.9]]);
  const superior = g.coast([[-92,46.8],[-88,48.6],[-84.5,48.5],[-84.6,46.6],[-89,46.4]]);
  const michHuron = g.coast([[-88,41.7],[-86.7,45.9],[-84.2,45.9],[-82.0,44.8],[-82.6,43.0],[-83.5,41.8]]);
  const erieOnt = g.coast([[-83,41.5],[-79,42.6],[-76.6,43.2],[-77.2,44.2],[-79.6,43.4],[-82.5,41.4]]);

  const rMexPlateau = g.poly([[-106,20],[-99,20],[-99,25],[-106,26]]);
  const rLabrador = g.poly([[-74,52],[-64,53],[-62,58],[-70,58]]);
  const rPlains = g.poly([[-104,30],[-96,29],[-95,49],[-108,49],[-110,40]]);

  const mississippi = g.river([[-95,47.2],[-91.5,43.5],[-90.5,38.7],[-89.5,35.0],[-91.0,32.0],[-89.5,29.3]]);
  const stlawrence = g.river([[-79.5,43.6],[-76,44.2],[-73.5,45.5],[-70,47.5],[-66,48.8],[-63,49.2]]);
  const nelson = g.river([[-98.5,52.5],[-96,54.0],[-93,56.0],[-92.5,57.0]]);

  const rockiesLine = [[-148,62],[-138,60],[-128,54],[-120,50],[-115,45],[-111,41],[-107,37],[-105,34]];
  const appalachLine = [[-71,45.5],[-75,42],[-79,39],[-82,36],[-84,34.5]];

  pl("جبال روكي", "region", [-113,44], 26, { aliases: ["rocky mountains", "rockies", "الروكي"] });
  pl("جبال الأبلاش", "region", [-80,38], 16, { aliases: ["appalachian", "الأبلاش"] });
  pl("هضبة المكسيك", "region", [-103,23.5], 16, { ref: "r-mexplateau", aliases: ["mexican plateau"] });
  pl("هضبة لبرادور", "region", [-68,54], 16, { ref: "r-labrador", aliases: ["labrador plateau"] });
  pl("البحيرات العظمى", "region", [-84,45.5], 14, { ref: "great-lakes", aliases: ["great lakes"] });
  pl("السهول الوسطى", "region", [-100,42], 30, { ref: "r-plains", aliases: ["great plains", "central plains"] });
  pl("نهر المسيسيبي", "line", [-90.5,36], 14, { ref: "mississippi", aliases: ["mississippi"] });
  pl("نهر سانت لورانس", "line", [-72,46.5], 12, { ref: "stlawrence", aliases: ["st lawrence"] });
  pl("نهر نلسن", "line", [-94,55], 10, { ref: "nelson", aliases: ["nelson river"] });
  pl("المحيط الأطلنطي", "sea", [-56,40], 20, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("المحيط الهادي", "sea", [-150,32], 24, { aliases: ["pacific", "المحيط الهادئ"] });
  pl("المحيط المتجمد الشمالي", "sea", [-120,72.5], 20, { aliases: ["arctic ocean"] });
  pl("خليج المكسيك", "sea", [-90,25.5], 14, { aliases: ["gulf of mexico"] });
  pl("خليج هدسن", "sea", [-86,59.5], 14, { aliases: ["hudson bay"] });
  pl("البحر الكاريبي", "sea", [-75,13.5], 14, { aliases: ["caribbean"] });

  return [
    `<path id="land" d="${land}" ${S.land}/>`,
    `<path d="${cuba}" ${S.landThin}/>`,
    `<path id="great-lakes" d="${superior}" ${S.water}/>`,
    `<path d="${michHuron}" ${S.water}/>`,
    `<path d="${erieOnt}" ${S.water}/>`,
    `<path id="r-mexplateau" d="${rMexPlateau}" ${S.hidden}/>`,
    `<path id="r-labrador" d="${rLabrador}" ${S.hidden}/>`,
    `<path id="r-plains" d="${rPlains}" ${S.hidden}/>`,
    `<path id="mississippi" d="${mississippi}" ${S.river}/>`,
    `<path id="stlawrence" d="${stlawrence}" ${S.river}/>`,
    `<path id="nelson" d="${nelson}" ${S.riverThin}/>`,
    carets(proj, rockiesLine, 8),
    carets(proj, appalachLine, 5),
    seaLabel(proj.X(-56), proj.Y(40.5), "المحيط الأطلنطي", 8),
    seaLabel(proj.X(-150), proj.Y(32), "المحيط الهادي", 8),
    seaLabel(proj.X(-118), proj.Y(73), "المحيط المتجمد الشمالي", 7.5),
    seaLabel(proj.X(-90), proj.Y(25.5), "خليج المكسيك", 7.5),
    seaLabel(proj.X(-86), proj.Y(59.5), "خليج هدسن", 7.5),
    seaLabel(proj.X(-75), proj.Y(13.7), "البحر الكاريبي", 7.5),
  ];
});

/* ================= SOUTH AMERICA ================= */

emit("south_america", { W: -82, E: -34, S: -56, N: 13, s: 8 }, ({ proj, g, pl }) => {
  const land = g.coast([
    [-77.5,8.0],[-75.5,10.8],[-71.5,12.4],[-64,10.7],[-60,8.5],[-52,5.0],[-50,0.5],[-44,-2.8],
    [-38.5,-4.5],[-35.2,-6.5],[-37.5,-11.0],[-39,-13.5],[-40.5,-18.0],[-42,-22.5],[-48,-25.5],
    [-53,-33.5],[-57.5,-38.5],[-62,-40.5],[-65.5,-45.0],[-68.5,-50.0],[-68,-52.5],[-65.5,-55.0],
    [-70,-53.0],[-73,-50.0],[-73.7,-45.0],[-73,-40.0],[-72,-35.0],[-71.5,-30.0],[-70.5,-23.0],
    [-70.5,-18.3],[-75.5,-14.5],[-79,-8.0],[-81,-6.0],[-80.8,-3.0],[-80,-1.0],[-78.5,1.5],
    [-77.5,4.0],[-77,7.5]
  ]);
  const rBrazil = g.poly([[-55,-12],[-42,-12],[-40,-22],[-52,-24]]);
  const rGuiana = g.poly([[-68,2],[-58,3],[-58,7],[-66,7]]);
  const rPatagonia = g.poly([[-72,-42],[-66,-42],[-66,-50],[-71,-51]]);
  const rAmazon = g.poly([[-73,-5],[-55,-6],[-50,-1],[-58,3],[-70,2]]);

  const amazon = g.river([[-74,-5.5],[-70,-4.2],[-64,-3.3],[-58,-3.0],[-52,-1.5],[-50,-0.3]]);
  const parana = g.river([[-49,-17],[-52,-22],[-55,-27],[-58,-32],[-58.5,-34.3]]);
  const orinoco = g.river([[-67,3.5],[-66,6.5],[-63,8.0],[-61,9.0]]);

  const andesLine = [[-73,4],[-76,-1],[-78,-6],[-73,-14],[-70,-20],[-70,-27],[-71,-34],[-72,-41],[-72,-48]];

  pl("جبال الإنديز", "region", [-70,-24], 26, { aliases: ["andes", "الأنديز"] });
  pl("هضبة البرازيل", "region", [-47,-17], 22, { ref: "r-brazil", aliases: ["brazilian highlands"] });
  pl("هضبة جيانا", "region", [-62,4], 14, { ref: "r-guiana", aliases: ["guiana highlands"] });
  pl("هضبة باتاجونيا", "region", [-68,-45], 16, { ref: "r-patagonia", aliases: ["patagonia"] });
  pl("سهل الأمازون", "region", [-62,-3], 30, { ref: "r-amazon", aliases: ["amazon basin"] });
  pl("نهر الأمازون", "line", [-62,-2.5], 16, { ref: "amazon", aliases: ["amazon", "الأمازون"] });
  pl("نهر بارانا", "line", [-56,-27], 12, { ref: "parana", aliases: ["parana"] });
  pl("نهر أورينوكو", "line", [-64,6.5], 10, { ref: "orinoco", aliases: ["orinoco"] });
  pl("المحيط الأطلنطي", "sea", [-40,-33], 22, { aliases: ["atlantic", "المحيط الأطلسي"] });
  pl("المحيط الهادي", "sea", [-80,-28], 20, { aliases: ["pacific", "المحيط الهادئ"] });
  pl("البحر الكاريبي", "sea", [-70,12.0], 12, { aliases: ["caribbean"] });
  pl("خط الاستواء", "line", [-72,0], 10, { ref: "equator", aliases: ["equator"] });

  const eq = proj.Y(0);
  return [
    `<path id="land" d="${land}" ${S.land}/>`,
    `<path id="r-brazil" d="${rBrazil}" ${S.hidden}/>`,
    `<path id="r-guiana" d="${rGuiana}" ${S.hidden}/>`,
    `<path id="r-patagonia" d="${rPatagonia}" ${S.hidden}/>`,
    `<path id="r-amazon" d="${rAmazon}" ${S.hidden}/>`,
    `<line id="equator" x1="0" y1="${eq}" x2="${proj.width}" y2="${eq}" ${S.grat}/>`,
    `<path id="amazon" d="${amazon}" ${S.river}/>`,
    `<path id="parana" d="${parana}" ${S.river}/>`,
    `<path id="orinoco" d="${orinoco}" ${S.riverThin}/>`,
    carets(proj, andesLine, 9),
    `<text x="${proj.X(-79.5)}" y="${eq - 3}" style="fill:var(--gold,#a97e22);font-size:7px;opacity:0.85">خط الاستواء</text>`,
    seaLabel(proj.X(-40), proj.Y(-33), "المحيط الأطلنطي", 8),
    seaLabel(proj.X(-80), proj.Y(-28), "المحيط الهادي", 8),
    seaLabel(proj.X(-70), proj.Y(12.3), "البحر الكاريبي", 7.5),
  ];
});

/* ================= AUSTRALIA ================= */

emit("australia", { W: 112, E: 154, S: -44, N: -9, s: 12.5 }, ({ proj, g, pl }) => {
  const land = g.coast([
    [113.5,-22],[114,-26],[115,-30],[115.6,-33],[117.5,-35],[120,-34],[124,-33.5],[129,-31.6],
    [131.5,-31.5],[134,-32.5],[135.6,-34.8],[137.8,-35.5],[139.5,-37],[141,-38.4],[144,-38.4],
    [146.5,-38.8],[148,-37.8],[150,-37.5],[151.5,-33],[153,-31],[153.5,-28],[153,-25],[151,-24],
    [149,-21],[146,-19],[145.5,-17],[143,-14],[142.5,-11],[141.8,-12.5],[140.8,-17.3],[139,-17.4],
    [137,-16],[136.5,-14],[135.5,-12],[133,-11.5],[130.5,-12.5],[129,-15],[126,-14],[123,-16],
    [122,-18],[119,-20],[116,-20.5],[114,-21.5]
  ]);
  const tasmania = g.coast([[145,-40.7],[148,-40.8],[148.3,-43.2],[146.5,-43.6],[145,-42.2]]);
  const reefLine = [[145.8,-16],[147.5,-18],[149.2,-20],[151,-22],[152,-23.5]];

  const rWestPlateau = g.poly([[115,-20],[128,-20],[128,-31],[116,-31]]);
  const rDesert = g.poly([[125,-20],[138,-20],[138,-30],[126,-31]]);

  const murray = g.river([[148,-36.3],[145,-35.4],[143,-34.4],[141,-34.2],[139.6,-35.3]]);
  const darling = g.river([[148.8,-28.5],[147,-30],[145,-32],[143.2,-34.0]]);

  const dividingLine = [[146,-19],[148,-24],[149.5,-29],[149,-34],[147.5,-37]];

  pl("جبال الحاجز الكبير", "region", [149,-30], 22, { aliases: ["great dividing range"] });
  pl("الهضبة الغربية", "region", [122,-25], 26, { ref: "r-westplateau", aliases: ["western plateau"] });
  pl("الصحراء الأسترالية", "region", [131,-25], 28, { ref: "r-desert", aliases: ["australian desert"] });
  pl("الحاجز المرجاني العظيم", "region", [149,-18], 16, { ref: "reef", aliases: ["great barrier reef"] });
  pl("نهر موري", "line", [143,-34.6], 14, { ref: "murray", aliases: ["murray"] });
  pl("نهر دارلنج", "line", [146,-31], 12, { ref: "darling", aliases: ["darling"] });
  pl("المحيط الهادي", "sea", [152,-14], 16, { aliases: ["pacific", "المحيط الهادئ"] });
  pl("المحيط الهندي", "sea", [114,-30], 18, { aliases: ["indian ocean"] });
  pl("الخليج الأسترالي الكبير", "sea", [130,-37], 14, { aliases: ["great australian bight"] });
  pl("بحر تسمان", "sea", [152,-39], 12, { aliases: ["tasman sea"] });

  return [
    `<path id="land" d="${land}" ${S.land}/>`,
    `<path d="${tasmania}" ${S.landThin}/>`,
    `<path id="r-westplateau" d="${rWestPlateau}" ${S.hidden}/>`,
    `<path id="r-desert" d="${rDesert}" ${S.hidden}/>`,
    `<path id="reef" d="${g.river(reefLine)}" ${S.grat}/>`,
    `<path id="murray" d="${murray}" ${S.river}/>`,
    `<path id="darling" d="${darling}" ${S.riverThin}/>`,
    carets(proj, dividingLine, 6),
    seaLabel(proj.X(151), proj.Y(-13.5), "المحيط الهادي", 8),
    seaLabel(proj.X(114.5), proj.Y(-30), "المحيط الهندي", 8),
    seaLabel(proj.X(130), proj.Y(-37.2), "الخليج الأسترالي الكبير", 7.5),
    seaLabel(proj.X(152), proj.Y(-39), "بحر تسمان", 7.5),
  ];
});

fs.writeFileSync(NAMES_OUT, nameLists.join("\n\n") + "\n");
console.log("names ->", NAMES_OUT);

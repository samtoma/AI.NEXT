/**
 * The Your Progress Map — model, layout and navigation rules (FR-3224).
 *
 * Pure: no DOM, no React, no database. `SkillMap.tsx` draws what this returns
 * and asks it where to go; everything here is a function of its arguments, so
 * the layout, the zoom levels and "what does tapping empty space do" are
 * testable without a browser.
 *
 * Three levels: chapter (a module) → lesson (a slug) → objective. Each chapter
 * is a cluster: its objectives on an outer ring, in lesson order from the top,
 * its lessons on an inner ring at the mean angle of their own objectives, and a
 * flat honey disc behind. Chapters are laid out in two rows — Term 1 above,
 * Term 2 below — in book order (Tamer, 2026-10-01: predictable beats clever,
 * and with 16 cross-chapter links for maths it stays readable). A subject with
 * no Term 2 wraps its chapters into rows of five instead.
 *
 * BOOK SECTIONS (feature 003, FR-4315). A book section the Grade 10 book splits
 * into parts is several lessons — and lessons already sit on their chapter's
 * ring in lesson order, so the parts of one section are a CONTIGUOUS ARC of the
 * outer ring. That arc is the group: `buildSkillMap` finds it from the section
 * groups it is given (`SpineData.sectionGroups`) and returns it as a
 * `MapSection` — the span of the arc, its label ("1.7 Factorisation") and the
 * parts on it — for the canvas to draw as a tray behind those objectives and
 * to name at the lesson level. With no section groups — every National subject
 * — `sections` is empty and nothing else in the model differs by a bit from
 * what it was (`skill-map-sections.test.mts` holds it to main's v0.11.0 output).
 *
 * WORLD units are the layout's own; the canvas converts with
 * `screen = world × scale + t`. Strokes, shadows, radii floors and label sizes
 * are applied in SCREEN pixels by the canvas, never scaled (handoff §4).
 */
import { slugOfLo } from "./lesson-slug";
import { termOfModule, withoutTerm } from "./module-term";
import { masteryStage } from "./mastery";
import { sectionLabel } from "./section-label";

/* ------------------------------------------------------------- types --- */

export type Stage = 0 | 1 | 2 | 3 | 4;

/** Which snapshot the map shows: today, or where the student started. */
export type AsOf = "today" | "baseline";

export interface MapObjectiveInput {
  id: string;
  label: string;
  moduleId: string | null;
  moduleLabel: string | null;
  /**
   * The course this objective is taught in. A chapter's term comes from its
   * COURSE's own term rules (`lib/module-term.ts`); a course with no terms —
   * the Grade 10 American book — puts every chapter in the one row sequence.
   * Optional: absent, the chapter has no course and no term.
   */
  courseId?: string | null;
  syllabusRef: string | null;
  baseline: number;
  current: number;
}

export interface MapObjective {
  id: string;
  label: string;
  lessonSlug: string;
  chapterId: string;
  stageNow: Stage;
  stageStart: Stage;
  x: number;
  y: number;
  /** angle on the ring, radians (0 = east, clockwise on screen) */
  angle: number;
}

export interface MapLesson {
  slug: string;
  title: string;
  /** "Lesson 1-1" — the textbook reference, when the data has one */
  ref: string | null;
  chapterId: string;
  /** position among its chapter's lessons, 0-based (label above/below) */
  index: number;
  objectives: string[];
  x: number;
  y: number;
}

export interface MapChapter {
  id: string;
  /** "Relations and Functions" */
  title: string;
  /** "Unit 1", when the label carries one */
  unitRef: string | null;
  term: 1 | 2;
  lessons: string[];
  objectives: string[];
  cx: number;
  cy: number;
  /** outer (objective) ring radius */
  ro: number;
  /** honey disc radius */
  discR: number;
}

/** a → b: a is a prerequisite of b */
export interface MapLink {
  a: string;
  b: string;
  across: boolean;
  /**
   * Added by the product, not stated by the book: part n-1 → part n of a split
   * section (FR-4317). Present (true) only on those; absent on every book link,
   * so a map with no split section has links exactly as it always did.
   */
  derived?: true;
}

/**
 * One split book section, as the map is given it (`SpineData.sectionGroups`,
 * built by `getSpineData` from the book-section store): its printed number and
 * title, and each part — a lesson — with its objectives.
 */
export interface MapSectionInput {
  /** `lib/book-sections.ts` `SectionGroup.key` */
  key: string;
  /** the printed section number ("1.7") */
  number: string | null;
  /** the printed section title ("Factorisation") */
  title: string | null;
  parts: readonly { slug: string; n: number; of: number; loIds: readonly string[] }[];
}

/**
 * A split section's group on the map: one run of its parts' objectives on one
 * chapter's outer ring. A section whose parts are contiguous — which the
 * catalogue guarantees (FR-4312) — is exactly one run; a run is broken only by
 * an objective of another lesson standing between its parts, or by a chapter
 * boundary, and each break is its own group, never a tray over objectives
 * that are not the section's.
 */
export interface MapSection {
  /** unique on the map: `<section key>#<run>` */
  id: string;
  /** the section's own key — shared by the runs of one section */
  key: string;
  /** "1.7 Factorisation" */
  label: string;
  chapterId: string;
  /** its parts on this run, in ring order (slugs) */
  lessons: string[];
  /** its objectives on this run, in ring order */
  objectives: string[];
  /** ring angle of the first and of the last objective, radians (as `MapObjective.angle`) */
  a0: number;
  a1: number;
  /** the angle between neighbouring objectives on this chapter's ring */
  step: number;
  /** the middle of the arc, where the label goes */
  mid: number;
}

/** What a lesson that is a part of a split section says about it. */
export interface MapSectionMember {
  sectionId: string;
  label: string;
  part: { n: number; of: number } | null;
}

export interface SkillMapModel {
  chapters: MapChapter[];
  chapterById: Map<string, MapChapter>;
  lessonBySlug: Map<string, MapLesson>;
  objectiveById: Map<string, MapObjective>;
  links: MapLink[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** the split sections' groups on the map — empty when no subject objective is in one (FR-4315) */
  sections: MapSection[];
  sectionById: Map<string, MapSection>;
  /** lesson slug → the section it is a part of */
  sectionOfLesson: Map<string, MapSectionMember>;
}

export type Selection =
  | { kind: "chapter"; id: string }
  | { kind: "lesson"; slug: string }
  | { kind: "objective"; id: string }
  | null;

export interface View {
  scale: number;
  tx: number;
  ty: number;
}

/* --------------------------------------------------------- constants --- */

/** outer ring: this much circumference per objective (world) */
export const OBJ_SPACING = 38;
/** smallest outer ring, so a two-objective chapter is still a cluster */
export const MIN_RING = 200;
/** honey disc reaches this far past the outer ring */
export const DISC_PAD = 90;
/** lessons sit on an inner ring at this fraction of the outer one */
export const LESSON_RING = 0.55;
/** space between discs in a row, and between rows (world) */
export const COL_GAP = 300;
export const ROW_GAP = 820;
/** a row holds at most this many chapters */
export const ROW_MAX = 5;
/** zoom bands (handoff §6) */
export const LESSON_LEVEL_FACTOR = 1.3;
export const OBJECTIVE_LEVEL_SCALE = 0.62;
/** world radii; the canvas floors them in screen px */
export const LESSON_R = 44;
export const OBJECTIVE_R = 20;
/** screen px kept free above the top clusters for chapter titles */
export const TOP_RESERVE = 72;

/* ------------------------------------------------------------- build --- */

const UNFILED = "module:unfiled";

/** "Term 2 · Unit 4 — The Circle" → { unitRef: "Unit 4", title: "The Circle" } */
export function chapterTitleParts(label: string | null): {
  unitRef: string | null;
  title: string;
} {
  const plain = withoutTerm(label ?? "Other topics");
  const i = plain.indexOf(" — ");
  return i < 0
    ? { unitRef: null, title: plain }
    : { unitRef: plain.slice(0, i), title: plain.slice(i + 3) };
}

const stageOf = (score: number): Stage => masteryStage(score, score > 0);

/**
 * Build the model. `los` must already be in catalogue order (FR-3215) and
 * narrowed to one subject; `edges` may include objectives outside `los` —
 * those links are dropped.
 */
export function buildSkillMap(
  los: readonly MapObjectiveInput[],
  edges: readonly { src: string; dst: string; origin?: "part-order" }[],
  lessonTitles: Readonly<Record<string, string>>,
  sectionInputs: readonly MapSectionInput[] = [],
): SkillMapModel {
  // --- group, in catalogue order
  const chapterOrder: string[] = [];
  const chapterLabel = new Map<string, string | null>();
  const chapterCourse = new Map<string, string | null>();
  const lessonsOf = new Map<string, string[]>();
  const objsOfLesson = new Map<string, MapObjectiveInput[]>();
  const chapterOfLesson = new Map<string, string>();
  for (const lo of los) {
    const ch = lo.moduleId ?? UNFILED;
    if (!lessonsOf.has(ch)) {
      chapterOrder.push(ch);
      lessonsOf.set(ch, []);
      chapterLabel.set(ch, lo.moduleLabel);
      chapterCourse.set(ch, lo.courseId ?? null);
    }
    const slug = slugOfLo(lo.id);
    // A lesson belongs to the first chapter it is met in.
    const owner = chapterOfLesson.get(slug) ?? ch;
    if (!chapterOfLesson.has(slug)) {
      chapterOfLesson.set(slug, owner);
      lessonsOf.get(owner)!.push(slug);
    }
    const list = objsOfLesson.get(slug) ?? [];
    list.push(lo);
    objsOfLesson.set(slug, list);
  }

  // --- chapters, sized
  const chapters: MapChapter[] = chapterOrder.map((id) => {
    const lessons = lessonsOf.get(id)!;
    const objectives = lessons.flatMap((s) =>
      objsOfLesson.get(s)!.map((o) => o.id),
    );
    const ro = Math.max(OBJ_SPACING * objectives.length, MIN_RING);
    const { unitRef, title } = chapterTitleParts(chapterLabel.get(id) ?? null);
    return {
      id,
      title,
      unitRef,
      // Term 2 only where the course's own rules say so; a course with no
      // terms (or an unfiled chapter) sits in the first row sequence.
      term: id === UNFILED || termOfModule(id, chapterCourse.get(id)) !== 2 ? 1 : 2,
      lessons,
      objectives,
      cx: 0,
      cy: 0,
      ro,
      discR: ro + DISC_PAD,
    };
  });

  // --- rows: Term 1 then Term 2, each wrapped at ROW_MAX
  const rows: MapChapter[][] = [];
  for (const term of [1, 2] as const) {
    const inTerm = chapters.filter((c) => c.term === term);
    for (let i = 0; i < inTerm.length; i += ROW_MAX)
      rows.push(inTerm.slice(i, i + ROW_MAX));
  }
  const rowWidth = (row: MapChapter[]) =>
    row.reduce((w, c) => w + 2 * c.discR, 0) +
    COL_GAP * Math.max(0, row.length - 1);
  const widest = Math.max(0, ...rows.map(rowWidth));
  let rowTop = 0;
  for (const row of rows) {
    const tallest = Math.max(...row.map((c) => c.discR));
    let x = (widest - rowWidth(row)) / 2;
    for (const c of row) {
      c.cx = x + c.discR;
      c.cy = rowTop + tallest;
      x += 2 * c.discR + COL_GAP;
    }
    rowTop += 2 * tallest + ROW_GAP;
  }

  // --- objectives on the outer ring, lessons on the inner one
  const objectiveById = new Map<string, MapObjective>();
  const lessonBySlug = new Map<string, MapLesson>();
  for (const c of chapters) {
    const n = c.objectives.length;
    let k = 0;
    c.lessons.forEach((slug, index) => {
      const angles: number[] = [];
      const objs = objsOfLesson.get(slug)!;
      for (const o of objs) {
        const angle = -Math.PI / 2 + (2 * Math.PI * k) / Math.max(n, 1);
        k += 1;
        angles.push(angle);
        objectiveById.set(o.id, {
          id: o.id,
          label: o.label,
          lessonSlug: slug,
          chapterId: c.id,
          stageNow: stageOf(o.current),
          stageStart: stageOf(o.baseline),
          x: c.cx + c.ro * Math.cos(angle),
          y: c.cy + c.ro * Math.sin(angle),
          angle,
        });
      }
      // Contiguous and monotonic from the top, so the plain mean is the
      // middle of the lesson's arc.
      const mean = angles.reduce((s, a) => s + a, 0) / angles.length;
      const r = c.lessons.length === 1 ? 0 : LESSON_RING * c.ro;
      lessonBySlug.set(slug, {
        slug,
        title: lessonTitles[slug] ?? objs[0]!.label,
        ref: objs[0]!.syllabusRef,
        chapterId: c.id,
        index,
        objectives: objs.map((o) => o.id),
        x: c.cx + r * Math.cos(mean),
        y: c.cy + r * Math.sin(mean),
      });
    });
  }

  // --- links
  const links: MapLink[] = [];
  for (const e of edges) {
    const a = objectiveById.get(e.src);
    const b = objectiveById.get(e.dst);
    if (!a || !b) continue;
    links.push({
      a: a.id,
      b: b.id,
      across: a.chapterId !== b.chapterId,
      ...(e.origin === "part-order" ? { derived: true as const } : {}),
    });
  }

  // --- book sections (FR-4315): contiguous arcs of a chapter's ring
  const { sections, sectionOfLesson } = placeSections(
    chapters,
    objectiveById,
    lessonBySlug,
    sectionInputs,
  );

  const bounds = chapters.length
    ? {
        minX: Math.min(...chapters.map((c) => c.cx - c.discR)),
        minY: Math.min(...chapters.map((c) => c.cy - c.discR)),
        maxX: Math.max(...chapters.map((c) => c.cx + c.discR)),
        maxY: Math.max(...chapters.map((c) => c.cy + c.discR)),
      }
    : { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  return {
    chapters,
    chapterById: new Map(chapters.map((c) => [c.id, c])),
    lessonBySlug,
    objectiveById,
    links,
    bounds,
    sections,
    sectionById: new Map(sections.map((x) => [x.id, x])),
    sectionOfLesson,
  };
}

/**
 * Find each split section's group: walk every chapter's ring in order, and
 * collect the maximal runs of consecutive objectives that belong to the
 * section's parts. Walking the ring (rather than sorting the section's
 * objectives) keeps the catalogue order the rest of the map is built in, and
 * makes "contiguous" the definition of a group: an objective that is not the
 * section's, standing between two of its parts, ends the run.
 */
function placeSections(
  chapters: readonly MapChapter[],
  objectiveById: ReadonlyMap<string, MapObjective>,
  lessonBySlug: ReadonlyMap<string, MapLesson>,
  inputs: readonly MapSectionInput[],
): { sections: MapSection[]; sectionOfLesson: Map<string, MapSectionMember> } {
  const sections: MapSection[] = [];
  const sectionOfLesson = new Map<string, MapSectionMember>();
  for (const g of inputs) {
    const label = sectionLabel(g) || g.key;
    const inGroup = new Set(g.parts.flatMap((p) => p.loIds));
    const partOf = new Map(g.parts.map((p) => [p.slug, { n: p.n, of: p.of }]));
    let runs = 0;
    for (const c of chapters) {
      const n = c.objectives.length;
      const step = (2 * Math.PI) / Math.max(n, 1);
      let run: string[] = [];
      const close = () => {
        if (run.length === 0) return;
        const first = objectiveById.get(run[0]!)!;
        const last = objectiveById.get(run[run.length - 1]!)!;
        const lessons = [...new Set(run.map((id) => objectiveById.get(id)!.lessonSlug))];
        const id = `${g.key}#${runs++}`;
        sections.push({
          id,
          key: g.key,
          label,
          chapterId: c.id,
          lessons,
          objectives: run,
          a0: first.angle,
          a1: last.angle,
          step,
          mid: (first.angle + last.angle) / 2,
        });
        for (const slug of lessons)
          if (lessonBySlug.has(slug))
            sectionOfLesson.set(slug, { sectionId: id, label, part: partOf.get(slug) ?? null });
        run = [];
      };
      for (const objectiveId of c.objectives) {
        if (inGroup.has(objectiveId)) run.push(objectiveId);
        else close();
      }
      close();
    }
  }
  return { sections, sectionOfLesson };
}

/**
 * What a framed lesson or objective says about its book section, for its
 * accessible name and its tooltip: "1.7 Factorisation, part 2 of 3" for a part,
 * "1.7 Factorisation" for a lesson of the section with no part number; null for
 * a lesson in no split section — every National lesson.
 */
export function sectionNameOf(model: SkillMapModel, lessonSlug: string): string | null {
  const m = model.sectionOfLesson.get(lessonSlug);
  if (!m) return null;
  return m.part ? `${m.label}, part ${m.part.n} of ${m.part.of}` : m.label;
}

/**
 * The SVG path of a section's tray: the part of the ring between angles `a0`
 * and `a1` (radians, clockwise on screen from east, like `MapObjective.angle`),
 * `r0` to `r1` from the centre. A span covering the whole ring is an annulus
 * (draw it with `fill-rule: evenodd`); a tray reaching the centre (`r0` ≈ 0)
 * closes through it. Screen pixels in, a path out.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
): string {
  const f = (v: number) => Number(v.toFixed(2));
  const p = (a: number, r: number) => `${f(cx + r * Math.cos(a))},${f(cy + r * Math.sin(a))}`;
  const span = a1 - a0;
  if (span >= 2 * Math.PI - 1e-6) {
    const ring = (r: number, sweep: 0 | 1) =>
      `M${f(cx + r)},${f(cy)} A${f(r)},${f(r)} 0 1 ${sweep} ${f(cx - r)},${f(cy)} A${f(r)},${f(r)} 0 1 ${sweep} ${f(cx + r)},${f(cy)} Z`;
    return r0 <= 0.5 ? ring(r1, 1) : `${ring(r1, 1)} ${ring(r0, 0)}`;
  }
  const large = span > Math.PI ? 1 : 0;
  const outer = `M${p(a0, r1)} A${f(r1)},${f(r1)} 0 ${large} 1 ${p(a1, r1)}`;
  return r0 <= 0.5
    ? `${outer} L${f(cx)},${f(cy)} Z`
    : `${outer} L${p(a1, r0)} A${f(r0)},${f(r0)} 0 ${large} 0 ${p(a0, r0)} Z`;
}

/* ------------------------------------------------------------- stages --- */

/** Lesson stage = round(mean of its objectives' stages). Chapters are never averaged. */
export function lessonStage(
  model: SkillMapModel,
  slug: string,
  asOf: "today" | "baseline",
): Stage {
  const l = model.lessonBySlug.get(slug);
  if (!l || l.objectives.length === 0) return 0;
  const sum = l.objectives.reduce((s, id) => {
    const o = model.objectiveById.get(id)!;
    return s + (asOf === "today" ? o.stageNow : o.stageStart);
  }, 0);
  return Math.round(sum / l.objectives.length) as Stage;
}

export function objectiveStage(
  o: MapObjective,
  asOf: "today" | "baseline",
): Stage {
  return asOf === "today" ? o.stageNow : o.stageStart;
}

/** "{n} of {m} lessons started" — started = any objective above "not started". */
export function lessonsStarted(
  model: SkillMapModel,
  chapterId: string,
  asOf: "today" | "baseline",
): { started: number; total: number } {
  const c = model.chapterById.get(chapterId);
  if (!c) return { started: 0, total: 0 };
  const started = c.lessons.filter((slug) =>
    model.lessonBySlug
      .get(slug)!
      .objectives.some(
        (id) => objectiveStage(model.objectiveById.get(id)!, asOf) > 0,
      ),
  ).length;
  return { started, total: c.lessons.length };
}

export function objectivesStarted(
  model: SkillMapModel,
  asOf: "today" | "baseline",
) {
  let started = 0;
  for (const o of model.objectiveById.values())
    if (objectiveStage(o, asOf) > 0) started += 1;
  return { started, total: model.objectiveById.size };
}

/* -------------------------------------------------------------- views --- */

/** The view that fits every cluster, with TOP_RESERVE kept for titles. */
export function fitView(
  model: SkillMapModel,
  w: number,
  h: number,
  pad = 24,
): View {
  const { minX, minY, maxX, maxY } = model.bounds;
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const scale = Math.max(
    0.01,
    Math.min((w - 2 * pad) / bw, (h - TOP_RESERVE - pad) / bh),
  );
  return {
    scale,
    tx: pad + (w - 2 * pad - bw * scale) / 2 - minX * scale,
    ty: TOP_RESERVE + (h - TOP_RESERVE - pad - bh * scale) / 2 - minY * scale,
  };
}

/** 0 chapters · 1 lessons · 2 objectives (handoff §6). */
export function zoomLevel(scale: number, fitScale: number): 0 | 1 | 2 {
  if (scale < fitScale * LESSON_LEVEL_FACTOR) return 0;
  if (scale < OBJECTIVE_LEVEL_SCALE) return 1;
  return 2;
}

/** Centre world point (x, y) in a w×h viewport at `scale`. */
export function centreOn(
  x: number,
  y: number,
  scale: number,
  w: number,
  h: number,
): View {
  return { scale, tx: w / 2 - x * scale, ty: h / 2 - y * scale };
}

/** Tap a chapter: its nearest lessons at least 150 screen px apart. */
export function chapterView(
  model: SkillMapModel,
  id: string,
  w: number,
  h: number,
  fitScale: number,
): View | null {
  const c = model.chapterById.get(id);
  if (!c) return null;
  const pts = c.lessons.map((s) => model.lessonBySlug.get(s)!);
  let nearest = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++)
      nearest = Math.min(
        nearest,
        Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.y - pts[j]!.y),
      );
  const want =
    Number.isFinite(nearest) && nearest > 0 ? 150 / nearest : fitScale * 2;
  const scale = Math.max(fitScale * 1.6, want);
  return centreOn(c.cx, c.cy, scale, w, h);
}

/** Tap a lesson: fit its objectives (and room for their boxes), never below 0.7. */
export function lessonView(
  model: SkillMapModel,
  slug: string,
  w: number,
  h: number,
  boxRoom = 170,
): View | null {
  const l = model.lessonBySlug.get(slug);
  if (!l) return null;
  const pts = [l, ...l.objectives.map((id) => model.objectiveById.get(id)!)];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const fit = Math.min(
    (w - 2 * boxRoom) / Math.max(1, maxX - minX),
    (h - 2 * boxRoom) / Math.max(1, maxY - minY),
  );
  const scale = Math.max(0.7, Math.min(fit, 1.4));
  return centreOn((minX + maxX) / 2, (minY + maxY) / 2, scale, w, h);
}

/** The view a selection asks for; null = fit everything. */
export function viewFor(
  model: SkillMapModel,
  sel: Selection,
  w: number,
  h: number,
): View {
  const fit = fitView(model, w, h);
  if (!sel) return fit;
  if (sel.kind === "chapter")
    return chapterView(model, sel.id, w, h, fit.scale) ?? fit;
  if (sel.kind === "lesson") return lessonView(model, sel.slug, w, h) ?? fit;
  const o = model.objectiveById.get(sel.id);
  return (o && lessonView(model, o.lessonSlug, w, h)) ?? fit;
}

/* ---------------------------------------------------------- selection --- */

/** Tap empty space or Esc: objective → lesson → chapter → nothing. */
export function parentSelection(
  model: SkillMapModel,
  sel: Selection,
): Selection {
  if (!sel) return null;
  if (sel.kind === "objective") {
    const o = model.objectiveById.get(sel.id);
    return o ? { kind: "lesson", slug: o.lessonSlug } : null;
  }
  if (sel.kind === "lesson") {
    const l = model.lessonBySlug.get(sel.slug);
    return l ? { kind: "chapter", id: l.chapterId } : null;
  }
  return null;
}

/** The chapter and lesson a selection sits in — for the breadcrumb. */
export function selectionPath(
  model: SkillMapModel,
  sel: Selection,
): { chapter: MapChapter | null; lesson: MapLesson | null } {
  if (!sel) return { chapter: null, lesson: null };
  if (sel.kind === "chapter")
    return { chapter: model.chapterById.get(sel.id) ?? null, lesson: null };
  const slug =
    sel.kind === "lesson"
      ? sel.slug
      : model.objectiveById.get(sel.id)?.lessonSlug;
  const lesson = slug ? (model.lessonBySlug.get(slug) ?? null) : null;
  return {
    chapter: lesson ? (model.chapterById.get(lesson.chapterId) ?? null) : null,
    lesson,
  };
}

export interface Focus {
  /** objectives that are part of the selection itself */
  own: Set<string>;
  /** objectives linked to `own` (either direction), outside it */
  linked: Set<string>;
  /** lessons to keep lit: the selection's and those of linked objectives */
  lessons: Set<string>;
  chapters: Set<string>;
}

/**
 * What a selection lights up: the selected item, its objectives, and
 * everything linked to them. Null when nothing is selected (nothing fades).
 */
export function focusOf(model: SkillMapModel, sel: Selection): Focus | null {
  if (!sel) return null;
  let own: string[] = [];
  if (sel.kind === "chapter")
    own = model.chapterById.get(sel.id)?.objectives ?? [];
  else if (sel.kind === "lesson")
    own = model.lessonBySlug.get(sel.slug)?.objectives ?? [];
  else if (model.objectiveById.has(sel.id)) own = [sel.id];
  const ownSet = new Set(own);
  const linked = new Set<string>();
  for (const l of model.links) {
    if (ownSet.has(l.a) && !ownSet.has(l.b)) linked.add(l.b);
    if (ownSet.has(l.b) && !ownSet.has(l.a)) linked.add(l.a);
  }
  const lessons = new Set<string>();
  const chapters = new Set<string>();
  for (const id of [...ownSet, ...linked]) {
    const o = model.objectiveById.get(id)!;
    lessons.add(o.lessonSlug);
    chapters.add(o.chapterId);
  }
  if (sel.kind === "lesson") lessons.add(sel.slug);
  if (sel.kind === "chapter") {
    chapters.add(sel.id);
    for (const s of model.chapterById.get(sel.id)?.lessons ?? [])
      lessons.add(s);
  }
  return { own: ownSet, linked, lessons, chapters };
}

/**
 * Which link lines to draw, and how (handoff §5):
 *  · across chapters — always; strong when an end is in the selection, faint
 *    when something unrelated is selected;
 *  · within a chapter — only when an end is in the selection.
 */
export function linkStyle(
  link: MapLink,
  focus: Focus | null,
  sel: Selection = null,
): "hidden" | "faint" | "normal" | "strong" {
  const touches = focus
    ? focus.own.has(link.a) || focus.own.has(link.b)
    : false;
  // The product's part-order links (FR-4317) join EVERY objective of part n-1
  // to every objective of part n: a chapter selection would light them all and
  // bury the book's own links under a lattice. They are drawn when a lesson or
  // an objective is selected — the question they answer ("what does this part
  // build on, and what builds on it?") is asked of one part, not of a chapter.
  if (link.derived && !link.across && sel?.kind === "chapter") return "hidden";
  if (link.across) {
    if (!focus) return "normal";
    return touches ? "strong" : "faint";
  }
  return touches ? "strong" : "hidden";
}

/** `→ {Lesson}` (same chapter) or `→ {Chapter} › {Lesson}` (other chapter). */
export function linkDestinationLabel(
  model: SkillMapModel,
  objectiveId: string,
): string | null {
  const o = model.objectiveById.get(objectiveId);
  if (!o) return null;
  // Only a link that LEAVES the lesson is worth naming — "→ the lesson you
  // are looking at" says nothing. Of those, the cross-chapter one says most.
  const leaving = model.links.filter(
    (l) =>
      l.a === objectiveId &&
      model.objectiveById.get(l.b)?.lessonSlug !== o.lessonSlug,
  );
  const out = leaving.find((l) => l.across) ?? leaving[0];
  const target = out && model.objectiveById.get(out.b);
  if (!target) return null;
  const lesson = model.lessonBySlug.get(target.lessonSlug)!;
  if (target.chapterId === o.chapterId) return lesson.title;
  return `${model.chapterById.get(target.chapterId)!.title} › ${lesson.title}`;
}

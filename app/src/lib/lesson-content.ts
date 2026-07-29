import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Rich lesson content — the "textbook narrative" layer the extraction
 * pipeline now emits ALONGSIDE the spine's atomic questions + figures.
 *
 * The spine (Postgres, see lib/lesson.ts) owns LOs, live questions and stored
 * visuals. This layer owns everything a student READS: the tamheed hook, the
 * per-sub-topic exposition, the «مفاهيم أتعلمها» glossary, the «معلومات
 * إثرائية» side-boxes, the «تنبيه شائع» misconceptions, and pipeline-authored
 * interactive practice beats.
 *
 * Data contract (owned by the extraction service): one JSON file per lesson at
 *   services/extraction/seed/content/<lessonId>.json
 * The `spec` shapes on interactives are pipeline-authored and may vary
 * slightly, so the loader (and the render adapters) normalize DEFENSIVELY —
 * a malformed file or entry degrades to empty, never throws. Most lessons have
 * no file yet; the loader returns null for those.
 */

export type InteractiveKind =
  | "locate_on_map"
  | "term_match"
  | "timeline_builder"
  | "chain_builder"
  // Arabic vertical (ADR-0006)
  | "extract_spans"
  | "hamza_seat"
  | "style_purpose"
  | "irab_builder";

const INTERACTIVE_KINDS: readonly InteractiveKind[] = [
  "locate_on_map",
  "term_match",
  "timeline_builder",
  "chain_builder",
  "extract_spans",
  "hamza_seat",
  "style_purpose",
  "irab_builder",
];

export interface LessonSubtopic {
  key: string;
  title: string;
  /** rich teaching passage — 3–6 sentences of Arabic prose */
  exposition: string;
}

export interface LessonKeyTerm {
  term_ar: string;
  definition_ar: string;
}

export interface LessonEnrichment {
  title: string;
  body_ar: string;
}

export interface LessonMisconception {
  wrong: string;
  correction: string;
}

export interface LessonInteractive {
  /** the LO this beat exercises, if the pipeline tagged one */
  lo?: string;
  kind: InteractiveKind;
  prompt_ar?: string;
  /** pipeline-authored, shape varies by kind — normalized at render time */
  spec: Record<string, unknown>;
}

/** One آية / بيت / فقرة of a sealed passage (Arabic vertical, ADR-0006). */
export interface LessonPassageUnit {
  n: number;
  /** printed آية number, Arabic-Indic ("٦٣") — absent for prose paragraphs */
  printed_n?: string;
  text_ar: string;
}

/**
 * A SEALED text passage for display (ADR-0006): the text was verified and
 * checksummed by the pipeline — the app renders it verbatim and the tutor
 * refers to it by آية number; nothing at runtime ever re-types it.
 */
export interface LessonPassage {
  id: string;
  kind: string; // quran | hadith | poetry | prose | dictation
  title_ar: string;
  attribution_ar?: string;
  citation_ref?: string;
  sacred: boolean;
  /** authority cross-check result: "agree" | "flagged" (sacred only) */
  verification_verdict?: string;
  units: LessonPassageUnit[];
}

/** A printed objective we deliberately do not score (خط/تعبير/تلاوة) —
 *  ADR-0006 §4: disclosed in visible copy, never silently hidden. */
export interface LessonOutOfScope {
  text: string;
  skill?: string;
  reason: string;
}

export interface LessonContent {
  lessonId: string;
  title: string;
  tamheed?: string;
  subtopics: LessonSubtopic[];
  key_terms: LessonKeyTerm[];
  enrichment: LessonEnrichment[];
  misconceptions: LessonMisconception[];
  interactives: LessonInteractive[];
  /** Arabic vertical (ADR-0006); empty for math/social bundles */
  passages: LessonPassage[];
  out_of_scope: LessonOutOfScope[];
  /** the printed «القضايا المتضمنة» box */
  qadaya: string[];
}

/* ------------------------------------------------------------------ */
/* Defensive normalization                                             */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function normSubtopics(raw: unknown): LessonSubtopic[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((s, i) => ({
      key: str(s.key) || `st-${i}`,
      title: str(s.title),
      exposition: str(s.exposition),
    }))
    .filter((s) => s.exposition || s.title);
}

function normKeyTerms(raw: unknown): LessonKeyTerm[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((t) => ({ term_ar: str(t.term_ar), definition_ar: str(t.definition_ar) }))
    .filter((t) => t.term_ar && t.definition_ar);
}

function normEnrichment(raw: unknown): LessonEnrichment[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((e) => ({ title: str(e.title), body_ar: str(e.body_ar) }))
    .filter((e) => e.body_ar);
}

function normMisconceptions(raw: unknown): LessonMisconception[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((m) => ({ wrong: str(m.wrong), correction: str(m.correction) }))
    .filter((m) => m.wrong && m.correction);
}

function normInteractives(raw: unknown): LessonInteractive[] {
  if (!Array.isArray(raw)) return [];
  const out: LessonInteractive[] = [];
  for (const item of raw) {
    if (!isObj(item)) continue;
    const kind = str(item.kind) as InteractiveKind;
    if (!INTERACTIVE_KINDS.includes(kind)) continue;
    if (!isObj(item.spec)) continue;
    const lo = str(item.lo);
    const prompt_ar = str(item.prompt_ar);
    out.push({
      kind,
      spec: item.spec,
      ...(lo ? { lo } : {}),
      ...(prompt_ar ? { prompt_ar } : {}),
    });
  }
  return out;
}

function normPassages(raw: unknown): LessonPassage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((p) => ({
      id: str(p.id),
      kind: str(p.kind) || "prose",
      title_ar: str(p.title_ar),
      ...(str(p.attribution_ar) ? { attribution_ar: str(p.attribution_ar) } : {}),
      ...(str(p.citation_ref) ? { citation_ref: str(p.citation_ref) } : {}),
      sacred: p.sacred === true,
      ...(str(p.verification_verdict)
        ? { verification_verdict: str(p.verification_verdict) }
        : {}),
      units: (Array.isArray(p.units) ? p.units : [])
        .filter(isObj)
        .map((u, i) => ({
          n: typeof u.n === "number" ? u.n : i + 1,
          ...(str(u.printed_n) ? { printed_n: str(u.printed_n) } : {}),
          text_ar: str(u.text_ar),
        }))
        .filter((u) => u.text_ar),
    }))
    .filter((p) => p.id && p.units.length > 0);
}

function normOutOfScope(raw: unknown): LessonOutOfScope[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isObj)
    .map((o) => ({
      text: str(o.text),
      ...(str(o.skill) ? { skill: str(o.skill) } : {}),
      reason: str(o.reason),
    }))
    .filter((o) => o.text && o.reason);
}

function normalize(lessonId: string, raw: unknown): LessonContent | null {
  if (!isObj(raw)) return null;
  return {
    lessonId: str(raw.lessonId) || lessonId,
    title: str(raw.title),
    ...(str(raw.tamheed) ? { tamheed: str(raw.tamheed) } : {}),
    subtopics: normSubtopics(raw.subtopics),
    key_terms: normKeyTerms(raw.key_terms),
    enrichment: normEnrichment(raw.enrichment),
    misconceptions: normMisconceptions(raw.misconceptions),
    interactives: normInteractives(raw.interactives),
    passages: normPassages(raw.passages),
    out_of_scope: normOutOfScope(raw.out_of_scope),
    qadaya: Array.isArray(raw.qadaya)
      ? raw.qadaya.map(str).filter(Boolean)
      : [],
  };
}

/* ------------------------------------------------------------------ */
/* Loader                                                              */
/* ------------------------------------------------------------------ */

// The Next app runs with cwd = app/; the content bundles live at the repo
// root under services/extraction/seed/content (mirrors the gazetteer read in
// lib/lesson.ts, which resolves public/maps against process.cwd()).
const CONTENT_DIR = path.join(
  process.cwd(),
  "..",
  "services",
  "extraction",
  "seed",
  "content"
);

// lessonIds are pipeline slugs like "soc1-1" / "geo1-2" (plus "_sample" for
// the dev harness). Whitelist the charset so the id can never escape the dir.
const ID_RE = /^[a-z0-9_-]{1,40}$/;

/**
 * Read the rich content bundle for a lesson, or null if none exists yet.
 * Server-only (fs). Never throws on a missing file, malformed JSON, or a
 * partially-shaped bundle — a broken file simply yields null / empty sections.
 */
export async function getLessonContent(
  lessonId: string
): Promise<LessonContent | null> {
  if (!ID_RE.test(lessonId)) return null;
  let raw: string;
  try {
    raw = await readFile(path.join(CONTENT_DIR, `${lessonId}.json`), "utf8");
  } catch {
    return null; // no bundle for this lesson yet — the common case
  }
  try {
    return normalize(lessonId, JSON.parse(raw));
  } catch {
    return null; // corrupt JSON — degrade, never crash the lesson surface
  }
}

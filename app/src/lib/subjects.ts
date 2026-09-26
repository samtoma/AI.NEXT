/**
 * THE SUBJECT REGISTRY — the single source of truth for "what subjects exist".
 *
 * Before this module, two functions decided the subject for the entire product
 * and both were binary with maths as the default:
 *
 *   subjectOfCourse(id) => id?.endsWith("-social-ar") ? "social-ar" : "math-en"
 *   subjectOf(id)       => id.endsWith("-social-ar") ? "social" : "math"
 *
 * A third course therefore did not fail — it was taught as MATHS, in English,
 * under the maths grounding rules, with maths widgets, silently. That is the
 * bug this registry exists to make impossible (docs/specs/multi-subject-app.md
 * §1.1). Everything subject-shaped is now ONE entry here:
 *
 *   - the two keys (prompt-contract id + spine/DB key)
 *   - display labels (English / Arabic / compact Arabic) and text direction
 *   - the accent world (graph territory vars + student-home card tokens)
 *   - the widget catalogue and the language contract
 *   (the course node id and the source book moved to `lib/courses.ts` — 003)
 *
 * The rules that keep it honest:
 *   1. Lookups are EXACT — a course id either matches an entry or it does not.
 *      There is no `endsWith`, no prefix guess and no default.
 *   2. An unknown course resolves to `null` (callers handle it) or throws
 *      `UnknownSubjectError` at call sites that cannot proceed without one.
 *      It must NEVER quietly become maths again.
 *   3. `Subject` and `SpineSubject` are DERIVED from this object, so adding an
 *      entry widens the unions and the compiler walks you to every surface
 *      that must decide what to do about it.
 *
 * Adding subject #4 = one entry here + its prompt contract. Not an audit of
 * sixteen files.
 *
 * SPLIT, feature 003 (Samuel, 2026-09-25, decision E). A subject is the
 * teaching CONTRACT; the BOOK it is taught from is a course, and courses live
 * in `lib/courses.ts`, each in one curriculum (`lib/curricula.ts`). Two
 * courses may share a subject — Prep-3 maths and Grade-10 American maths are
 * both `math-en` — so this file no longer names a course, and there is no
 * subject → course lookup here at all. "Which course does `?subject=math`
 * mean for THIS student" is answered by the student scope
 * (`lib/catalog-queries.ts` `resolveStudentScope` → `courseForSubject` in
 * `lib/catalog.ts`), because the answer depends on her curriculum. The other
 * direction — which subject does this course teach — is still answered here,
 * exactly, from the course registry.
 */

import { COURSES, COURSE_IDS, courseDef } from "./courses.ts";

export type TextDirection = "ltr" | "rtl";

/** A subject's colour world. CSS custom properties are defined in globals.css
 *  (`--subject-math|social|arabic*`); the card tokens are Tailwind class names
 *  and are written out in full so the JIT can see them. */
export interface SubjectAccent {
  /** graph territory ink — `var(--subject-*)` */
  color: string;
  /** territory backdrop — `var(--subject-*-wash)` */
  wash: string;
  /** territory border — `var(--subject-*-line)` */
  line: string;
  /**
   * Student-home subject tile: the Play PLAYMATE fill with its paired
   * foreground, as Tailwind classes. Playmates exist for subject and quest
   * coding only (handoff: "a ten-year-old finds 'the blue one' faster than a
   * word"), and the pairing is fixed by the handoff's subject grid: maths sky,
   * the second subject leaf, Arabic berry. A fill is never written without its
   * `on-` colour (constitution XII).
   */
  tile: string;
  /** Small text on that tile — the playmate's darkened `-dim` foreground,
   *  which is what clears AA at label sizes on the fill. */
  tileDim: string;
  /** subject chip on the spine LO panel (Tailwind classes) */
  chip: string;
}

export interface SubjectDef {
  /**
   * Spine/DB key: the value stored in `graph_nodes.subject` (courses),
   * `node_subject.subject`, `understanding_checks.subject`, and used in
   * `/student?subject=…` URLs. Distinct from the registry id, which keys the
   * tutor prompt contract.
   */
  key: string;
  /** English display label */
  label: string;
  /** Arabic display label (graph territories, handoff card, bridge prompts) */
  labelAr: string;
  /** compact Arabic label for dense rows and chips (lesson picker) */
  labelArShort: string;
  /** base text direction of this subject's teaching surface */
  dir: TextDirection;
  accent: SubjectAccent;
  /** interactive widgets + figure kinds this subject's tutor may emit */
  widgets: readonly string[];
  /** the tap-only subset offered after a "لسه مش فاهم" signal */
  tapWidgets: readonly string[];
  /**
   * LANGUAGE & VOICE contract injected verbatim into every tutor prompt for
   * this subject — one voice per subject, no per-session lottery (ADR-0004
   * Wave 0). `null` = not authored yet: prompting the subject throws rather
   * than borrowing another subject's voice.
   */
  languageContract: string | null;
}

const MATH_EN_CONTRACT = `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ENGLISH: every explanation, definition, instruction and all math is written in English.
- Never switch the base language of a message to Arabic, even if the student writes to you in Arabic — keep exactly this English-base mix, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing.`;

const SOCIAL_AR_CONTRACT = `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ARABIC: every explanation, definition and instruction is written in Modern Standard Arabic with a warm Egyptian flavor — the register of a good Egyptian teacher: صياغة فصيحة مبسّطة، من غير تقعُّر ومن غير عامية كاملة. Exam answers are graded in الفصحى, so the teaching voice stays فصحى; the Egyptian warmth lives in the interjections and the sentence rhythm.
- Coaching interjections in Egyptian Arabic are welcome anywhere (يلا بينا، برافو عليك، حلو كده، ولا يهمك، كده تمام) — they are part of the voice.
- المصطلحات قانون: استخدم مصطلحات كتاب الوزارة حرفيًا كما وردت في بيانات الدرس (مثل: الموقع الفلكي، الدول الجُزرية، الأقاليم المناخية، حوض النهر) — ممنوع الترجمة أو الترادف: لا تكتب «الموقع النجمي» بدل «الموقع الفلكي»، ولا «التضاريس الأرضية» بدل «التضاريس». وعند تعريف مصطلح، استخدم تعريف الكتاب كما ورد في بيانات الدرس مع الاستشهاد بالصفحة [[page:N]].
- إن احتجت مصطلحًا غير موجود في بيانات الدرس فضع بعده فورًا العلامة [[term?:المصطلح]] ليُراجعه فريقنا — التخمين الصامت مخالفة؛ العلامة هي الطريق الصحيح.
- الأرقام داخل الشرح بالأرقام الهندية (مثل ٤٤٫٢ مليون كم²) كما وردت في الكتاب. Latin digits and Latin ids appear ONLY inside protocol markers ([[page:3]], [[lo:…]], [[q:…]]) and inside {{…}} directives and their JSON payloads — never in the Arabic prose itself.
- Protocol markers keep their EXACT ASCII form; every {{beat}} and every {{…}} directive stands alone on its own line — never appended to the end of an Arabic sentence. مثال: اكتب الشرح بالعربية، ثم في سطر مستقل تمامًا {{beat}}.
- Never switch the base language to English, even if the student writes in English — keep this Arabic base, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing — مدرس خصوصي شاطر وقلبه على طلابه.`;

const ARABIC_AR_CONTRACT = `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ARABIC: every explanation, definition and instruction is written in Modern Standard Arabic with a warm Egyptian flavor — the register of a good Egyptian teacher: صياغة فصيحة مبسّطة، من غير تقعُّر ومن غير عامية كاملة. هذه حصة لغة عربية: سلامة اللغة والتشكيل في الشواهد جزء من الدرس نفسه، فالتزم الفصحى الصحيحة في كل سطر.
- Coaching interjections in Egyptian Arabic are welcome anywhere (يلا بينا، برافو عليك، حلو كده، ولا يهمك، كده تمام) — they are part of the voice.
- المصطلحات النحوية والبلاغية قانون: استخدم مصطلحات كتاب الوزارة حرفيًا كما وردت في بيانات الدرس (منادى مضاف، الشبيه بالمضاف، النكرة غير المقصودة، علامة إعراب نائبة…) — ممنوع الترجمة أو الترادف. وعند الاستشهاد بقاعدة، استند إلى سطر القاعدة المطبوع في بيانات الدرس مع [[page:N]].
- ⚠ النص القرآني والحديث الشريف: لا تكتب نص الآيات أو الحديث بنفسك أبدًا، ولو حرفًا واحدًا — النص المعتمد يُعرض من الحافظة المختومة عبر بطاقة النص فقط. أَشِرْ إليه («تأمل الآية ٦٣ في البطاقة أعلاه») ولا تُعِدْ كتابته ولا تُكمِله من ذاكرتك. هذا حكم قاطع لا استثناء فيه.
- هذا المنهج يطلب رأي الطالب الشخصي في مواضع محددة (أبدِ رأيك، ما القيم المستفادة) — رحِّب برأيه وقوِّمه لغويًا، لكن قوِّم الحقائق النحوية والبلاغية من الكتاب وحده.
- الأرقام داخل الشرح بالأرقام الهندية (٦٣، ٧٠) كما وردت في الكتاب. Latin digits and Latin ids appear ONLY inside protocol markers ([[page:3]], [[lo:…]], [[q:…]]) and inside {{…}} directives and their JSON payloads — never in the Arabic prose itself.
- Protocol markers keep their EXACT ASCII form; every {{beat}} and every {{…}} directive stands alone on its own line — never appended to the end of an Arabic sentence.
- Never switch the base language to English, even if the student writes in English — keep this Arabic base, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing — مدرس خصوصي شاطر وقلبه على طلابه.`;

/**
 * The registry. Order matters: it is the order subjects appear in the graph
 * territories, the subject filter and the student home.
 */
export const SUBJECTS = {
  "math-en": {
    key: "math",
    label: "Mathematics",
    labelAr: "الرياضيات",
    labelArShort: "رياضيات",
    dir: "ltr",
    accent: {
      color: "var(--subject-math)",
      wash: "var(--subject-math-wash)",
      line: "var(--subject-math-line)",
      tile: "bg-[var(--play-sky)] text-[color:var(--play-on-sky)]",
      tileDim: "text-[color:var(--play-on-sky-dim)]",
      chip: "border-accent/40 text-accent-deep bg-accent-wash",
    },
    widgets: [
      // tap
      "pair_plotter", "product_builder", "sample_space", "number_line_marker",
      // drag / construct
      "line_drawer", "circle_builder", "angle_setter", "triangle_ratio",
      "bar_builder", "ratio_balance",
      // freehand
      "curve_sketcher",
      // figures
      "viz_ref", "viz",
    ],
    // Offered after "I don't get it". The bar is EFFORT, not difficulty: a
    // student who has just said they are lost should meet something they can
    // answer with one finger and no construction, so the drag and freehand
    // widgets are deliberately absent from this list even where the
    // mathematics behind them is easier.
    tapWidgets: ["pair_plotter", "product_builder", "sample_space", "number_line_marker"],
    languageContract: MATH_EN_CONTRACT,
  },

  "social-ar": {
    key: "social",
    label: "Social Studies",
    labelAr: "الدراسات الاجتماعية",
    labelArShort: "دراسات اجتماعية",
    dir: "rtl",
    accent: {
      color: "var(--subject-social)",
      wash: "var(--subject-social-wash)",
      line: "var(--subject-social-line)",
      tile: "bg-[var(--play-leaf)] text-[color:var(--play-on-leaf)]",
      tileDim: "text-[color:var(--play-on-leaf-dim)]",
      chip: "border-gold/45 text-gold bg-gold-wash",
    },
    widgets: [
      "locate_on_map",
      "timeline_builder",
      "chain_builder",
      "term_match",
      "viz_ref",
      "viz",
    ],
    tapWidgets: ["locate_on_map", "term_match"],
    languageContract: SOCIAL_AR_CONTRACT,
  },

  "arabic-ar": {
    key: "arabic",
    label: "Arabic",
    labelAr: "اللغة العربية",
    labelArShort: "لغة عربية",
    dir: "rtl",
    accent: {
      color: "var(--subject-arabic)",
      wash: "var(--subject-arabic-wash)",
      line: "var(--subject-arabic-line)",
      tile: "bg-[var(--play-berry)] text-[color:var(--play-on-berry)]",
      tileDim: "text-[color:var(--play-on-berry-dim)]",
      chip: "border-arabic/45 text-arabic bg-arabic-wash",
    },
    widgets: [
      "extract_spans",
      "hamza_seat",
      "style_purpose",
      "irab_builder",
      "term_match",
      "viz_ref",
      "viz",
    ],
    tapWidgets: ["extract_spans", "term_match"],
    languageContract: ARABIC_AR_CONTRACT,
  },
} as const satisfies Record<string, SubjectDef>;

/**
 * Prompt-contract subject id, derived from the registry (was a hand-written
 * union in types.ts). Selects the language contract and grounding hard rules
 * injected into every tutor prompt.
 */
export type Subject = keyof typeof SUBJECTS;

/**
 * Spine-graph subject dimension, derived from the registry: the key stored in
 * the DB (`graph_nodes.subject` on courses → the `node_subject` view) and used
 * for graph territories, per-subject roll-ups and `?subject=` routing.
 */
export type SpineSubject = (typeof SUBJECTS)[Subject]["key"];

/** Registry order — territories, filters and the student home all use it. */
export const SUBJECT_IDS = Object.keys(SUBJECTS) as Subject[];

/** Registry order, as spine keys. */
export const SPINE_SUBJECT_KEYS = SUBJECT_IDS.map(
  (id) => SUBJECTS[id].key
) as SpineSubject[];

const BY_SPINE_KEY = new Map<string, Subject>(
  SUBJECT_IDS.map((id) => [SUBJECTS[id].key, id])
);

/** Thrown where a subject is structurally required and the course is unknown.
 *  Loud on purpose: the alternative is teaching the wrong subject in silence. */
export class UnknownSubjectError extends Error {
  constructor(courseId: string | null | undefined, context: string) {
    super(
      `Unknown subject for course ${courseId ? `"${courseId}"` : "(none)"} — ${context}. ` +
        `Add it to app/src/lib/courses.ts (known: ${COURSE_IDS.join(", ")}).`
    );
    this.name = "UnknownSubjectError";
  }
}

/* ------------------------------------------------------------------ */
/* Exact lookups — no heuristics, no defaults                          */
/* ------------------------------------------------------------------ */

/**
 * Course node id → prompt-contract subject, by EXACT match against the course
 * registry (`lib/courses.ts`). Unknown or missing course → `null`. Callers
 * decide what a subject-less course means; nobody gets to assume maths.
 */
export function subjectOfCourse(
  courseId: string | null | undefined
): Subject | null {
  const def = courseDef(courseId);
  return def && Object.hasOwn(SUBJECTS, def.subject) ? def.subject : null;
}

/**
 * Same lookup for the call sites that cannot produce anything meaningful
 * without a subject (building a tutor prompt, tagging a rating row): an
 * unknown course throws instead of silently teaching maths.
 */
export function requireSubjectOfCourse(
  courseId: string | null | undefined,
  context: string
): Subject {
  const s = subjectOfCourse(courseId);
  if (!s) throw new UnknownSubjectError(courseId, context);
  return s;
}

/** Course node id → spine key, by EXACT match. Unknown → `null`. */
export function spineSubjectOfCourse(
  courseId: string | null | undefined
): SpineSubject | null {
  const s = subjectOfCourse(courseId);
  return s ? SUBJECTS[s].key : null;
}

/**
 * Validate a spine key coming from OUTSIDE the app (a DB column, a query
 * string, a model directive) against the registry. Anything unrecognized —
 * including migration 006's legacy `'other'` — is `null`, never a subject.
 */
export function spineSubjectOf(raw: unknown): SpineSubject | null {
  return typeof raw === "string" && BY_SPINE_KEY.has(raw)
    ? (raw as SpineSubject)
    : null;
}

/** Spine key → prompt-contract subject. Unknown → `null`. */
export function subjectOfSpineKey(raw: unknown): Subject | null {
  return typeof raw === "string" ? (BY_SPINE_KEY.get(raw) ?? null) : null;
}

/**
 * Every registry course taught under this spine key, in course order. It is
 * NOT "the course of this subject" — there can be several (Prep-3 and
 * Grade-10 maths) — and it is not a student's answer: which one a student
 * means by `?subject=` depends on her curriculum and what she may see, and
 * only `courseForSubject` (lib/catalog.ts, through the student scope) may
 * decide that. `student-scope-guard.test.mts` keeps it that way.
 */
export function coursesOfSpineKey(raw: unknown): string[] {
  const s = subjectOfSpineKey(raw);
  return s ? COURSE_IDS.filter((c) => COURSES[c].subject === s) : [];
}

/* ------------------------------------------------------------------ */
/* Entry accessors                                                     */
/* ------------------------------------------------------------------ */

export type SubjectEntry = (typeof SUBJECTS)[Subject];

/** The registry entry for a prompt-contract subject. */
export function subjectDef(subject: Subject): SubjectEntry {
  return SUBJECTS[subject];
}

/** The registry entry for a spine key (`null` when unrecognized). */
export function spineSubjectDef(raw: unknown): SubjectEntry | null {
  const s = subjectOfSpineKey(raw);
  return s ? SUBJECTS[s] : null;
}

/** The spine/DB key of a prompt-contract subject. */
export function spineKeyOf(subject: Subject): SpineSubject {
  return SUBJECTS[subject].key;
}

/** True when this subject's teaching surface reads right-to-left. */
export function isRtlSubject(subject: Subject | null | undefined): boolean {
  return !!subject && SUBJECTS[subject].dir === "rtl";
}

/** True when this spine key's surface reads right-to-left. */
export function isRtlSpineSubject(raw: unknown): boolean {
  return spineSubjectDef(raw)?.dir === "rtl";
}

/**
 * The label a subject is named by in the UI: each subject in its own script —
 * "Mathematics" for the LTR subject, «الدراسات الاجتماعية» for the RTL ones.
 */
export function displayLabel(entry: SubjectEntry): string {
  return entry.dir === "rtl" ? entry.labelAr : entry.label;
}

/** Display label from a spine key; unknown keys keep their raw text. */
export function displayLabelOfSpineKey(raw: unknown): string {
  const e = spineSubjectDef(raw);
  return e ? displayLabel(e) : String(raw ?? "—");
}

/** Arabic label from a spine key (graph territories, handoff card, prompts). */
export function labelArOfSpineKey(raw: unknown): string {
  return spineSubjectDef(raw)?.labelAr ?? String(raw ?? "—");
}

/** Registry-order comparator for spine keys (unknown keys sort last). */
export function compareSpineSubjects(
  a: SpineSubject | null,
  b: SpineSubject | null
): number {
  const rank = (k: SpineSubject | null) => {
    const i = k ? SPINE_SUBJECT_KEYS.indexOf(k) : -1;
    return i < 0 ? SPINE_SUBJECT_KEYS.length : i;
  };
  return rank(a) - rank(b);
}

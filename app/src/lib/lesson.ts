import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db";
import type { AskContext } from "./ask";
import { getLessonContent, type LessonContent } from "./lesson-content";
import { getLessonBridges } from "./subject-queries";
import { getVisualsForLos } from "./visuals";
import {
  figureDirectivesDoc,
  socialFigureDirectivesDoc,
  visualsCatalogLines,
} from "./viz-prompt";
import type {
  ClaimStep,
  LessonBridge,
  LessonData,
  LessonInfo,
  LessonLo,
  LessonMode,
  SolutionStep,
  SpineQuestion,
  Subject,
  Tier,
} from "./types";

const BRIDGE_SUBJECT_LABEL: Record<LessonBridge["otherSubject"], string> = {
  math: "الرياضيات",
  social: "الدراسات الاجتماعية",
};

/**
 * Adaptive lesson modes — "How did today's lesson go?"
 *
 * Same engine, two temperaments:
 *  - learn  : Omar understood nothing at school → AI-led interactive lesson
 *             in small beats (explanation → widget / check question → adapt).
 *  - review : Omar understood everything → non-annoying 3-minute lock-it-in
 *             (3 quick-fire questions + one widget moment, ≤ 5 AI turns).
 *
 * The lesson itself is a PARAMETER: any (module, syllabus_ref) group of LOs
 * in the spine — Algebra Lesson 1-1 or Geometry "The Circle" alike. Both
 * modes are grounded EXCLUSIVELY in the human-reviewed spine slice for the
 * selected lesson: its LO descriptions, the canonical solutions of its live
 * questions, and its curated figure library. The model never teaches from
 * scratch beyond that scope.
 */

const STUDENT_ID = 1;

export const DEFAULT_LESSON_SLUG = "u1-1";

const SLUG_RE = /^[a-z0-9]{1,12}-[0-9]{1,3}$/;

/** "lo:geo1-2-1" → lesson slug "geo1-2" (LO-id prefix minus the last part). */
function slugOfLo(loId: string): string {
  return loId.replace(/^lo:/, "").replace(/-[0-9]+$/, "");
}

/**
 * Subject detection (ADR-0004 Wave 0): the lesson's module sits `part_of` a
 * course node; the course id keys the language contract + grounding rules.
 *   course:prep3-math-en   → "math-en"
 *   course:prep3-social-ar → "social-ar"
 * Unknown/missing course → "math-en" (the original single-subject behavior).
 */
export function subjectOfCourse(courseId: string | null | undefined): Subject {
  return courseId?.endsWith("-social-ar") ? "social-ar" : "math-en";
}

/** Short display titles per lesson slug; fallback = first LO label. */
const LESSON_TITLES: Record<string, string> = {
  "u1-1": "Cartesian product",
  "u1-2": "Relations",
  "u1-3": "Functions",
  "u1-4": "Polynomial functions",
  "u2-1": "Ratio",
  "u2-2": "Proportion",
  "u2-3": "Direct and inverse variation",
  "u3-1": "Collecting data and samples",
  "u3-2": "Dispersion and standard deviation",
  "u4-1": "Trigonometric ratios",
  "u4-2": "Special angles and applications",
  "u5-1": "The distance between two points",
  "u5-2": "The midpoint of a segment",
  "u5-3": "The slope of a straight line",
  "u5-4": "The equation of a straight line",
  "geo1-1": "The circle: definitions and chords",
  "geo1-2": "Point, line and circle positions — tangents",
  "geo1-3": "The circumcircle",
  "geo1-4": "Chords and distance from the center",
};

export function sanitizeLessonSlug(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return SLUG_RE.test(s) ? s : DEFAULT_LESSON_SLUG;
}

/* ------------------------------------------------------------------ */
/* Catalog — every teachable lesson, grouped by module                 */
/* ------------------------------------------------------------------ */

const LO_MODULE_SELECT = `
  SELECT lo.id, lo.label, lo.description, lo.syllabus_ref, lo.source_page,
         lo.order_in_parent,
         m.id AS module_id, m.label AS module_label,
         m.order_in_parent AS module_order,
         c.id AS course_id
  FROM graph_nodes lo
  LEFT JOIN graph_edges e
    ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
  LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
  LEFT JOIN graph_edges ec
    ON ec.src_id = m.id AND ec.edge_type = 'part_of' AND ec.system_to IS NULL
  LEFT JOIN graph_nodes c ON c.id = ec.dst_id AND c.kind = 'course'
  WHERE lo.kind = 'learning_objective'
`;

/** Term-1 algebra units first, Term-2 geometry after (both are "Unit 4"). */
const MODULE_ORDER = `CASE WHEN m.id LIKE 'module:geo%' THEN 1 ELSE 0 END,
         m.order_in_parent NULLS LAST, lo.order_in_parent, lo.id`;

export async function getLessonCatalog(): Promise<LessonInfo[]> {
  const [losRes, masteryRes] = await Promise.all([
    pool.query(`${LO_MODULE_SELECT} ORDER BY ${MODULE_ORDER}`),
    pool.query(
      `SELECT lo_id, score FROM mastery
       WHERE student_id = $1 AND system_to IS NULL`,
      [STUDENT_ID]
    ),
  ]);
  const mastery = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id, Number(r.score)])
  );

  const bySlug = new Map<string, LessonInfo>();
  const out: LessonInfo[] = [];
  for (const r of losRes.rows) {
    const slug = slugOfLo(r.id);
    let info = bySlug.get(slug);
    if (!info) {
      info = {
        slug,
        ref: r.syllabus_ref ?? slug,
        title: LESSON_TITLES[slug] ?? r.label,
        moduleId: r.module_id ?? "module:unfiled",
        moduleLabel: r.module_label ?? "Unfiled",
        courseId: r.course_id ?? null,
        subject: subjectOfCourse(r.course_id),
        los: [],
      };
      bySlug.set(slug, info);
      out.push(info);
    }
    info.los.push({
      id: r.id,
      label: r.label,
      description: r.description,
      sourcePage: r.source_page,
      mastery: mastery.get(r.id) ?? 0,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* One lesson's full grounded slice                                    */
/* ------------------------------------------------------------------ */

export async function getLessonData(
  slug: string = DEFAULT_LESSON_SLUG
): Promise<LessonData> {
  const safeSlug = sanitizeLessonSlug(slug);
  const loPattern = `lo:${safeSlug}-%`;

  const [losRes, studentRes] = await Promise.all([
    pool.query(
      `${LO_MODULE_SELECT} AND lo.id LIKE $1 ORDER BY lo.order_in_parent, lo.id`,
      [loPattern]
    ),
    pool.query(`SELECT display_name FROM students WHERE id = $1`, [STUDENT_ID]),
  ]);
  if (losRes.rows.length === 0 && safeSlug !== DEFAULT_LESSON_SLUG) {
    return getLessonData(DEFAULT_LESSON_SLUG); // unknown slug → default lesson
  }

  const loIds: string[] = losRes.rows.map((r) => r.id);

  const [masteryRes, qRes, visuals] = await Promise.all([
    pool.query(
      `SELECT lo_id, score FROM mastery
       WHERE student_id = $1 AND lo_id = ANY($2) AND system_to IS NULL`,
      [STUDENT_ID, loIds]
    ),
    pool.query(
      `SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
              canonical_solution, solution_version, status,
              source, source_sha256, source_page, source_note,
              reviewed_by, reviewed_at
       FROM questions
       WHERE status = 'live' AND lo_id = ANY($1)
       ORDER BY lo_id, tier, id`,
      [loIds]
    ),
    getVisualsForLos(loIds),
  ]);

  const mastery = new Map<string, number>(
    masteryRes.rows.map((r) => [r.lo_id, Number(r.score)])
  );

  const questions: SpineQuestion[] = qRes.rows.map((r) => ({
    id: r.id,
    loId: r.lo_id,
    tier: r.tier as Tier,
    questionType: r.question_type,
    stem: r.stem,
    choices: r.choices,
    correctAnswer: r.correct_answer,
    solution: r.canonical_solution ?? [],
    solutionVersion: Number(r.solution_version ?? 1),
    status: r.status,
    provenance: {
      source: r.source,
      sourceSha256: r.source_sha256,
      sourcePage: r.source_page,
      sourceNote: r.source_note,
      reviewedBy: r.reviewed_by,
      reviewedAt: r.reviewed_at ? new Date(r.reviewed_at).toISOString() : null,
      extractor: null,
      extractorVersion: null,
      extractionFinishedAt: null,
    },
  }));

  const first = losRes.rows[0];
  const subject = subjectOfCourse(first?.course_id);

  // Distinct base maps referenced by the stored map_scene figures (≤2, in
  // first-appearance order) — keys the gazetteer injection for social lessons.
  const mapBases: string[] = [];
  for (const v of visuals) {
    if (v.kind !== "map_scene") continue;
    const base = (v.spec as { base?: unknown }).base;
    if (
      typeof base === "string" &&
      /^[a-z_]{1,32}$/.test(base) &&
      !mapBases.includes(base)
    ) {
      mapBases.push(base);
      if (mapBases.length >= 2) break;
    }
  }

  // Social lessons name their actual source book (كتاب الوزارة) in the data
  // block; math stays null so its prompts remain byte-identical.
  let docTitle: string | null = null;
  if (subject === "social-ar" && first?.course_id) {
    const docRes = await pool.query(
      `SELECT d.title FROM graph_nodes c
       JOIN source_documents d ON d.sha256 = c.source_sha256
       WHERE c.id = $1`,
      [first.course_id]
    );
    docTitle = (docRes.rows[0]?.title as string | undefined) ?? null;
  }

  const los: LessonLo[] = losRes.rows.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    sourcePage: r.source_page,
    mastery: mastery.get(r.id) ?? 0,
  }));

  return {
    slug: safeSlug,
    lessonRef: first?.syllabus_ref ?? safeSlug,
    title: LESSON_TITLES[safeSlug] ?? first?.label ?? safeSlug,
    moduleLabel: first?.module_label ?? "Unfiled",
    courseId: first?.course_id ?? null,
    subject,
    los,
    questions,
    visuals: visuals.map((v) => ({
      id: v.id,
      kind: v.kind,
      loId: v.loId,
      caption: v.caption,
      sourcePage: v.sourcePage,
    })),
    mapBases,
    docTitle,
    studentName: (studentRes.rows[0]?.display_name as string) ?? "Omar",
  };
}

/** understanding_checks FK anchor — the lesson's first LO. */
export function lessonAnchorLo(data: LessonData): string {
  return data.los[0]?.id ?? "lo:u1-1-1";
}

const isGeoLesson = (data: LessonData) => data.slug.startsWith("geo");

/* ------------------------------------------------------------------ */
/* Grounding block shared by both modes + the rating pass              */
/* ------------------------------------------------------------------ */

/**
 * Formats canonical steps for the prompt. Math steps ({step, text_md}) render
 * exactly as before (byte-identical). Social claim-steps ({step, claim_ar,
 * evidence_page, …} — see docs/specs/social-extraction-contract.md) render the
 * Arabic claim with its per-claim evidence page so the model can cite it.
 */
function fmtSteps(steps: SolutionStep[]): string {
  return steps
    .map((s) => {
      const c = s as Partial<SolutionStep> & Partial<ClaimStep>;
      if (c.text_md != null) return `Step ${s.step}. ${c.text_md}`;
      const ev =
        c.evidence_page != null
          ? ` [evidence: p.${c.evidence_page}${c.evidence_kind ? `, ${c.evidence_kind}` : ""}]`
          : "";
      return `Step ${s.step}. ${c.claim_ar ?? ""}${ev}`;
    })
    .join(" | ");
}

export function lessonDataBlock(data: LessonData): string {
  const social = data.subject === "social-ar";
  const solutionLabel = social
    ? "MODEL ANSWER WITH EVIDENCE (الإجابة النموذجية — v"
    : "CANONICAL SOLUTION (v";
  const bankNote = social
    ? "each with its human-reviewed model answer — الإجابة النموذجية بالأدلة — the ONLY permitted factual path"
    : "each with its human-reviewed canonical solution — the ONLY permitted mathematical paths";
  const loLines = data.los
    .map(
      (l) =>
        `- ${l.id} | "${l.label}" | book p.${l.sourcePage ?? "—"} | mastery today ${Math.round(l.mastery * 100)}%\n  ${l.description ?? ""}`
    )
    .join("\n");

  const qLines = data.questions
    .map((q) => {
      const choices = q.choices
        ? q.choices.map((c) => `(${c.key}) ${c.text}`).join(" ")
        : "(numeric)";
      return `- ${q.id} | ${q.loId} | ${q.tier} | ${q.questionType} | p.${q.provenance.sourcePage ?? "—"}\n  Stem: ${q.stem}\n  Choices: ${choices}\n  Correct: ${q.correctAnswer}\n  ${solutionLabel}${q.solutionVersion}, human-reviewed): ${fmtSteps(q.solution)}`;
    })
    .join("\n");

  const vizLines = visualsCatalogLines(data.visuals);
  const bookName =
    social && data.docTitle
      ? `كتاب الوزارة «${data.docTitle}»`
      : "Egyptian ministry textbook";

  return `LESSON DATA — your ONLY source of truth (school ${data.lessonRef}: ${data.title} — ${data.moduleLabel}, ${bookName})
Student: ${data.studentName} (id 1), grade 10.

LEARNING OBJECTIVES of this lesson, in teaching order:
${loLines}

QUESTION BANK for this lesson (${bankNote}):
${qLines}

FIGURE LIBRARY for this lesson (stored animated figures — push by id with {{widget:viz_ref:<id>}}):
${vizLines || "(none for this lesson — compose custom figures with {{widget:viz:…}} when needed)"}`;
}

/* ------------------------------------------------------------------ */
/* Gazetteer injection (social lessons — Wave 1)                       */
/* ------------------------------------------------------------------ */

const GAZ_KIND_ORDER = ["point", "region", "line", "sea"];

/**
 * Compact gazetteer name lists (names only, grouped by kind) for the ≤2 base
 * maps referenced by a social lesson's stored visuals, read server-side from
 * app/public/maps/<base>.json. Appended to the lesson data block so the model
 * only ever names places the hit-tester can resolve. Empty string when no
 * base resolves — the data block is unchanged then.
 */
async function gazetteerBlock(bases: string[]): Promise<string> {
  const sections: string[] = [];
  for (const base of bases.slice(0, 2)) {
    if (!/^[a-z_]{1,32}$/.test(base)) continue;
    try {
      const raw = await readFile(
        path.join(process.cwd(), "public", "maps", `${base}.json`),
        "utf8"
      );
      const gaz = JSON.parse(raw) as {
        places?: Record<string, { kind?: unknown }>;
      };
      const byKind = new Map<string, string[]>();
      for (const [name, p] of Object.entries(gaz.places ?? {})) {
        const kind = typeof p?.kind === "string" ? p.kind : "point";
        const arr = byKind.get(kind) ?? [];
        arr.push(name);
        byKind.set(kind, arr);
      }
      if (byKind.size === 0) continue;
      const kinds = [
        ...GAZ_KIND_ORDER.filter((k) => byKind.has(k)),
        ...[...byKind.keys()].filter((k) => !GAZ_KIND_ORDER.includes(k)),
      ];
      sections.push(
        `[base "${base}"]\n${kinds
          .map((k) => `  ${k}: ${byKind.get(k)!.join("، ")}`)
          .join("\n")}`
      );
    } catch {
      /* missing/corrupt gazetteer asset — skip this base */
    }
  }
  if (sections.length === 0) return "";
  return `

GAZETTEER — أسماء الأماكن المعتمدة (the base maps used by this lesson's figures). In every map widget and map_scene ("target", "decoys", "place", every "through" entry) use ONLY these names, copied EXACTLY as written — never invent a place, never use coordinates:
${sections.join("\n")}`;
}

/* ------------------------------------------------------------------ */
/* Cross-subject connections (bridge-aware hint — Wave 1.5 §5)          */
/* ------------------------------------------------------------------ */

/**
 * The curated `relates_to` links touching this lesson, formatted as an
 * OPTIONAL grounding hint. Grounded because each connection is human-approved
 * with its own rationale — the tutor cites it, never fabricates one. Empty
 * string when the lesson has no bridges (so those lessons' prompts are
 * unchanged). Appended to the data block, like the gazetteer.
 */
function bridgeBlock(bridges: LessonBridge[]): string {
  if (bridges.length === 0) return "";
  const lines = bridges
    .map(
      (b) =>
        `- this "${b.thisLabel}" ↔ ${BRIDGE_SUBJECT_LABEL[b.otherSubject]} «${b.otherLabel}»: ${b.rationale}`
    )
    .join("\n");
  return `

CROSS-SUBJECT CONNECTIONS (curated, human-approved links between THIS lesson and another subject — mention naturally ONLY IF the student reaches this idea; cite the connection, never fabricate one; at most ONE gentle one-line hint per lesson, then move on):
${lines}
The hint is light and optional — e.g. «فكرة الإحداثيات دي شفتها في الرياضيات» / "you already met this coordinates idea in math" — dropped at the natural moment, never forced, never a second lesson.`;
}

/* ------------------------------------------------------------------ */
/* System prompts                                                      */
/* ------------------------------------------------------------------ */

/**
 * Cross-subject recognition + offered handoff (Wave 1.5 — Samuel's core call:
 * seamless awareness, never a hard pause, never a blind inline answer). Added
 * IDENTICALLY to every subject's lesson prompt: a math session must recognize
 * a history question, and a social session a math question. The literal string
 * is shared so the only prompt delta this wave introduces is byte-for-byte the
 * same in math and social. `{{switch_subject:…}}` is parsed into a warm
 * handoff card, NOT answered from memory — that keeps grounding honest.
 */
const CROSS_SUBJECT_RULE = `CROSS-SUBJECT AWARENESS (subjects stay separate; offer a clean handoff): if the student asks about a DIFFERENT school subject — e.g. a history or geography question during a math lesson, or a math question during a social-studies lesson (NOT merely another lesson inside THIS subject) — do NOT answer it from memory or from this lesson's data. Give ONE short warm acknowledgment in your own voice, then emit {{switch_subject:<subject>}} alone on its own line, where <subject> is exactly "math" or "social". This offers a handoff to that subject; it is NOT one of the interactive directives above and does not count as this message's single directive.`;

function sharedProtocol(data: LessonData, rhythm: string): string {
  const exLo = data.los[0]?.id.replace(/^lo:/, "") ?? "u1-1-1";
  const exQ = data.questions[0]?.id.replace(/^q:/, "") ?? "u1-1-1:001";
  const exPage = data.los[0]?.sourcePage ?? 8;
  if (data.subject === "social-ar") {
    const exViz = data.visuals[0]?.id ?? "v:soc1-1:001";
    return `CITATIONS: embed [[lo:${exLo}]] / [[q:${exQ}]] / [[page:${exPage}]] receipt markers after substantive claims, ids strictly from the LESSON DATA. Flag any needed term missing from the LESSON DATA with [[term?:المصطلح]] right after it — never guess a definition silently.

MESSAGE RHYTHM:
${rhythm}

INTERACTIVE DIRECTIVES (each on its OWN line; at most ONE interactive directive per message, always as its LAST beat — {{beat}} itself is a pause marker, not an interactive directive):
- {{show_question:q:${exQ}}} — pushes that live question card (ids from the QUESTION BANK only; each id at most once per session).
- {{widget:locate_on_map:{"base":"egypt","prompt":"فين قناة السويس؟ دوس على مكانها","target":"قناة السويس","decoys":["نهر النيل","خليج العقبة"]}}} — «حدد على الخريطة» as a tap. "base" is one of the GAZETTEER bases below; "target" and every "decoys" entry are EXACT gazetteer names. Give 2–3 decoys for the easier pick-among-markers mode; omit "decoys" for the harder free tap. Payload must be flat JSON exactly in this shape.
- {{widget:timeline_builder:{"prompt":"رتب الأحداث زي ما حصلت","events":["وصول الحملة الفرنسية","موقعة إمبابة","ثورة القاهرة الأولى"],"correctOrder":[0,1,2]}}} — «رتب الأحداث» by tapping. List "events" (3–5 short Arabic labels, facts strictly from the model answers) in story order; "correctOrder" is their indexes in that order.
- {{widget:chain_builder:{"prompt":"ركّب سلسلة «بم تفسر»","cards":[{"label":"فرض الضرائب الفادحة","role":"سبب"},{"label":"ثورة القاهرة الأولى","role":"حدث"},{"label":"إعدام عدد من الثوار","role":"نتيجة"}],"correctChain":[0,1,2]}}} — the student assembles the سبب → حدث → نتيجة chain in causal order (3–4 cards, facts strictly from the model answers).
- {{widget:term_match:{"prompt":"وصّل المصطلح بمعناه","pairs":[{"term":"الموقع الفلكي","definition":"موقع المكان بالنسبة لدوائر العرض وخطوط الطول"}],"decoyDefs":["تعريف قريب للتشتيت"]}}} — «ضع المصطلح» matching, 2–4 pairs; terms and definitions VERBATIM from the LESSON DATA (المصطلحات قانون); "decoyDefs" optional.
- ${socialFigureDirectivesDoc(exViz)}
  A figure counts as the ONE directive of its message. This is a SOCIAL-STUDIES lesson: اشرح بالرسم — a map_scene for every place, a timeline for every sequence of events, a flow_chain for every «بم تفسر» — pick the stored library figure when one fits the beat.
- {{finish_lesson}} — ends the session and triggers the comprehension report. Emit it alone on the final line of your LAST message only.
Results of widgets and questions arrive as "[live event]" lines — ALWAYS adapt your next beat to the latest result.

${CROSS_SUBJECT_RULE}

FORMAT: plain short Arabic paragraphs. No headings, no numbered lesson plans, no walls of text.`;
  }
  const exViz = data.visuals[0]?.id ?? "v:geo1-1:001";
  const vizGuidance = isGeoLesson(data)
    ? `This is a GEOMETRY lesson: lean on figures — open almost every teaching beat with a stored geo_scene from the FIGURE LIBRARY ({{widget:viz_ref:…}}), or compose one, so he SEES every definition and theorem drawn out. pair_plotter/product_builder rarely fit here.`
    : `Use pair_plotter/product_builder for doing, and viz figures for seeing — pick the stored library figure when one fits the beat.`;

  return `CITATIONS: embed [[lo:${exLo}]] / [[q:${exQ}]] / [[page:${exPage}]] receipt markers after substantive claims, ids strictly from the LESSON DATA. Never inside $...$ math.

MESSAGE RHYTHM:
${rhythm}

INTERACTIVE DIRECTIVES (each on its OWN line; at most ONE interactive directive per message, always as its LAST beat — {{beat}} itself is a pause marker, not an interactive directive):
- {{show_question:q:${exQ}}} — pushes that live question card (ids from the QUESTION BANK only; each id at most once per session).
- {{widget:pair_plotter:{"prompt":"Plot the point (3,2)","target":[3,2]}}} — interactive coordinate grid (-5..5); the student taps a point. Target coordinates must be integers in -5..5. Payload must be flat JSON exactly in this shape.
- {{widget:product_builder:{"X":[1,2],"Y":[3,4,5],"prompt":"Tap all the pairs of X x Y"}}} — the student taps candidate ordered pairs to build X×Y (decoys added automatically). Use small sets: 2–3 elements each, numbers only. Payload must be flat JSON exactly in this shape (plain ASCII inside the JSON).
- ${figureDirectivesDoc(exViz)}
  A figure counts as the ONE directive of its message. ${vizGuidance}
- {{finish_lesson}} — ends the session and triggers the comprehension report. Emit it alone on the final line of your LAST message only.
Results of widgets and questions arrive as "[live event]" lines — ALWAYS adapt your next beat to the latest result.

${CROSS_SUBJECT_RULE}

FORMAT: plain short paragraphs, inline math in $...$ (LaTeX). No headings, no numbered lesson plans, no walls of text.`;
}

/**
 * Language contracts, keyed by subject (ADR-0004 Wave 0) — one voice per
 * subject, no per-session lottery. "math-en" is the original contract,
 * byte-for-byte. "social-ar" is Arabic-first per
 * docs/specs/social-studies-ai-pipeline.md §2.1.
 */
const LANGUAGE_CONTRACTS: Record<Subject, string> = {
  "math-en": `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ENGLISH: every explanation, definition, instruction and all math is written in English.
- Flavor: sprinkle SHORT Egyptian Arabic coaching interjections (يلا بينا، برافو، ماشي؟، حلو كده، ولا يهمك) — a few words at a time, never a full Arabic sentence.
- Placement: an Arabic interjection goes at the END of a sentence or on its own — never as the first word of a sentence or paragraph (it flips the whole line right-to-left and scrambles any math in it). Transliteration ("wala yehimmak", "yalla") is always safe anywhere.
- Never switch the base language of a message to Arabic, even if the student writes to you in Arabic — keep exactly this English-base mix, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing.`,

  "social-ar": `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ARABIC: every explanation, definition and instruction is written in Modern Standard Arabic with a warm Egyptian flavor — the register of a good Egyptian teacher: صياغة فصيحة مبسّطة، من غير تقعُّر ومن غير عامية كاملة. Exam answers are graded in الفصحى, so the teaching voice stays فصحى; the Egyptian warmth lives in the interjections and the sentence rhythm.
- Coaching interjections in Egyptian Arabic are welcome anywhere (يلا بينا، برافو عليك، حلو كده، ولا يهمك، كده تمام) — they are part of the voice.
- المصطلحات قانون: استخدم مصطلحات كتاب الوزارة حرفيًا كما وردت في بيانات الدرس (مثل: الموقع الفلكي، الدول الجُزرية، الأقاليم المناخية، حوض النهر) — ممنوع الترجمة أو الترادف: لا تكتب «الموقع النجمي» بدل «الموقع الفلكي»، ولا «التضاريس الأرضية» بدل «التضاريس». وعند تعريف مصطلح، استخدم تعريف الكتاب كما ورد في بيانات الدرس مع الاستشهاد بالصفحة [[page:N]].
- إن احتجت مصطلحًا غير موجود في بيانات الدرس فضع بعده فورًا العلامة [[term?:المصطلح]] ليُراجعه فريقنا — التخمين الصامت مخالفة؛ العلامة هي الطريق الصحيح.
- الأرقام داخل الشرح بالأرقام الهندية (مثل ٤٤٫٢ مليون كم²) كما وردت في الكتاب. Latin digits and Latin ids appear ONLY inside protocol markers ([[page:3]], [[lo:…]], [[q:…]]) and inside {{…}} directives and their JSON payloads — never in the Arabic prose itself.
- Protocol markers keep their EXACT ASCII form; every {{beat}} and every {{…}} directive stands alone on its own line — never appended to the end of an Arabic sentence. مثال: اكتب الشرح بالعربية، ثم في سطر مستقل تمامًا {{beat}}.
- Never switch the base language to English, even if the student writes in English — keep this Arabic base, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing — مدرس خصوصي شاطر وقلبه على طلابه.`,
};

/**
 * Subject-keyed HARD GROUNDING RULES for the learn prompt. "math-en" is the
 * original two-rule text, byte-for-byte. "social-ar" adds the book-wins rule,
 * the outside-book acknowledge→decline→redirect script, the sensitive-content
 * hard rule (ADR-0004 §5) and the model-answer-only clause
 * (docs/specs/social-studies-ai-pipeline.md §3.2).
 */
function groundingRules(data: LessonData): string {
  if (data.subject === "social-ar") {
    return `HARD GROUNDING RULES (non-negotiable):
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Never drift into other lessons, terms or grades.
2. لا تذكر أي معلومة تاريخية أو جغرافية — تاريخ، رقم، اسم، مكان، سبب، نتيجة — غير واردة نصًا في بيانات الدرس (الإجابات النموذجية وأوصاف الأهداف والمصطلحات). معلوماتك العامة عن التاريخ والجغرافيا لا وجود لها في هذه الجلسة: كتاب الوزارة وحده هو الحقيقة. THE BOOK'S STATEMENT WINS even when you believe the world disagrees: حتى لو كنت تعتقد أن الرقم أو الرواية في الكتاب غير دقيقة، فكلام الكتاب هو الإجابة الصحيحة في الامتحان — الامتحان يصحَّح من الكتاب، والاستشهاد بالصفحة [[page:N]] واجب.
3. الإجابة النموذجية هي المسار الوحيد المسموح به للحقائق: when walking through any question, follow its HUMAN-REVIEWED model answer (الإجابة النموذجية) claim-steps exactly — a different pedagogical angle is allowed, different or additional FACTS are not, and never change a final answer. Every claim-bearing beat carries its [[page:N]]. If you cannot phrase a re-explanation without contradicting a model-answer fact, give the claim-steps verbatim instead.
4. OUTSIDE THE BOOK — acknowledge → decline → redirect, in that exact order, always: إذا سأل عن معلومة غير واردة في بيانات الدرس، رحِّب بالسؤال، ثم وضِّح أننا نذاكر من كتاب الوزارة فقط لأنه أساس الامتحان، ثم وجِّهه لأقرب معلومة واردة فعلًا مع الاستشهاد. النمط: «سؤال حلو — بس ده مش في كتاب الوزارة بتاعنا، وإحنا بنذاكر من الكتاب بس عشان ده اللي جاي في الامتحان. اللي الكتاب بيقوله عن الموضوع ده هو: … [[page:N]]». NEVER answer first and disclaim after — the ungrounded answer must never be produced at all. And never claim «لا أعرف» — the honest framing is «إحنا بنذاكر من الكتاب».
5. SENSITIVE CONTENT (hard rule): historical and political material is explained strictly as the book presents it — no commentary of your own, no modern political parallels, no evaluative judgments beyond the book's own framing. عرض الكتاب كما هو: بلا رأي شخصي، وبلا إسقاط على الحاضر، وبلا حكم قيمي زائد على صياغة الكتاب نفسه.`;
  }
  return `HARD GROUNDING RULES:
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Every mathematical claim must be derivable from the LO descriptions and the canonical solutions provided. Never invent other methods, notations, or topics.
2. When walking through any exercise, follow its HUMAN-REVIEWED CANONICAL SOLUTION steps exactly — never change a final answer.`;
}

/** Extra review-mode rule bullets for social-ar (math-en gets none — byte-identical). */
function reviewSubjectRules(data: LessonData): string {
  if (data.subject !== "social-ar") return "";
  return `
- كلام الكتاب هو الصواب دائمًا: corrective lines come ONLY from that question's model answer (الإجابة النموذجية), cited [[page:N]] — never from your general knowledge. The book's statement wins even when you believe the world disagrees.
- Off-book question from him: acknowledge → decline → redirect to the nearest in-book claim with [[page:N]] — never answer-then-disclaim. Historical/political material: strictly the book's own framing — no commentary, no modern parallels, no evaluative judgments.`;
}

export function learnPrompt(data: LessonData): string {
  const arc = data.los
    .map((l, i) => `${l.id} "${l.label}" (${i === data.los.length - 1 ? "1–2" : "2–3"} messages)`)
    .join(" → ");
  const tapWidgets =
    data.subject === "social-ar"
      ? "figure / locate_on_map / term_match"
      : "figure / pair_plotter / product_builder";
  const rhythm = `- Every message is 2–4 beats, separated by {{beat}} alone on its own line ({{beat}} renders as a natural writing pause, never as text).
- One beat = at most 2 short sentences (≤25 words total), OR one figure directive, OR one interactive directive.
- The LAST beat of a message carries its single interactive directive (widget or check question), with nothing after it — make him DO something in almost every message.
- Open with one warm beat reacting to his latest [live event]. If he got it wrong: re-explain THAT exact point a different way (grounded in the canonical steps), walking him toward the correct answer — never open with the correct letter.
- After a "لسه مش فاهم" / still-confused signal: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (${tapWidgets}) — never a harder question.
- Never repeat a widget, figure or question he already saw.
- Closing message: one-line recap beat of the big ideas, then {{finish_lesson}}.`;
  const richNote =
    data.subject === "social-ar"
      ? `\n\nYOUR SCRIPT: teach FROM the TEACHING SCRIPT in the LESSON DATA below — it is your reviewed narrative for THIS exact lesson. Turn each objective's passage into a short chain of beats (اشرح فكرة صغيرة → افحص بسؤال/تفاعل → كيّف حسب رده), never a wall and never read verbatim. Weave «الأخطاء الشائعة» in as gentle trap-checks that surface his misunderstanding, then correct it. Open by greeting ${data.studentName.split(" ")[0]} by name and naming today's lesson in one warm line.`
      : "";
  return `You are ${data.studentName}'s personal AI tutor at AI.Next. He is an Egyptian grade-10 student who just came home from school. Today's lesson was ${data.lessonRef} — ${data.title} (${data.moduleLabel}) — and he understood NOTHING. Your job: teach him the whole lesson from zero so it finally clicks, one short message of small beats at a time — as if you are writing to him and drawing for him.${richNote}

${groundingRules(data)}

${LANGUAGE_CONTRACTS[data.subject]}

LESSON ARC: greet him in one line and start immediately → ${arc} → closing recap message, then {{finish_lesson}}.
If he says he wants to stop, or a [live event] says he tapped Finish, give one warm closing line then {{finish_lesson}}.

${sharedProtocol(data, rhythm)}`;
}

export function reviewPrompt(data: LessonData): string {
  const social = data.subject === "social-ar";
  const picks = data.los.slice(0, 3);
  const openerEg = social
    ? `"فهمت كله؟ حلو — يلا نثبّته في ٣ دقايق ⏱"`
    : `"فهمت كله؟ حلو — let's lock it in. 3 minutes ⏱"`;
  const checkList = picks
    .map(
      (l, i) =>
        `${i + 1}. ${i === 0 ? `One warm opener line (e.g. ${openerEg}) + immediately` : "One-line reaction (max 12 words) +"} {{show_question:...}} with a ${i === 0 ? "basic" : "basic or standard"}-tier question from ${l.id}.`
    )
    .join("\n");
  const widgetMoment = social
    ? `ONE widget moment: {{widget:term_match:{"prompt":"آخر واحدة — وصّل المصطلح بمعناه","pairs":[…2–3 pairs, terms and definitions VERBATIM from the LESSON DATA…]}}} (or a locate_on_map / stored map figure if it fits this lesson better — gazetteer names only).`
    : isGeoLesson(data)
      ? `ONE visual moment: push the single most illustrative stored figure ({{widget:viz_ref:...}} from the FIGURE LIBRARY) and ask him ONE quick question about what it shows — he answers in chat.`
      : `ONE widget moment: {{widget:product_builder:{"X":[1,2],"Y":[4,5],"prompt":"Last one - build X x Y yourself"}}} (or a pair_plotter / stored figure if it fits this lesson better).`;
  return `You are ${data.studentName}'s AI tutor at AI.Next. He is an Egyptian grade-10 student who came home saying he understood today's lesson (${data.lessonRef} — ${data.title}, ${data.moduleLabel}) COMPLETELY. Respect that: do NOT teach, do NOT lecture, do NOT be annoying. This is a fast, warm, 3-minute lock-it-in revision.

HARD BUDGET: at most 5 messages total, then the session ends. Follow this script exactly:
${checkList}
${picks.length + 1}. One-line reaction + ${widgetMoment}
${picks.length + 2}. One-line warm wrap (e.g. "تمام يا بطل — confirmed.") + {{finish_lesson}}.

RULES:
- Never more than ONE short line of prose per message. No explanations unless he got it wrong — then ONE crisp corrective line taken from that question's canonical solution, and still move on.
- Question ids strictly from the QUESTION BANK, each used once, spread across the lesson's LOs.
- If a [live event] says he tapped End now, skip straight to a one-line wrap + {{finish_lesson}}.${reviewSubjectRules(data)}

${LANGUAGE_CONTRACTS[data.subject]}

${sharedProtocol(
    data,
    "- Review messages are ONE beat — never emit {{beat}}. One short line + the directive."
  )}`;
}

/**
 * The rich, human-reviewed TEACHING SCRIPT the extraction pipeline emits
 * (tamheed → per-objective exposition → key terms → misconceptions). It rides
 * in the learn-mode data block so the AI teaches FROM the reviewed narrative —
 * turned into beats in its own voice — instead of improvising off bare LO
 * stubs. Misconceptions become check-traps. Social-only; math has no content
 * files, so its data block stays byte-identical.
 */
function teachingScriptBlock(c: LessonContent): string {
  const subs = c.subtopics
    .filter((s) => s.exposition)
    .map((s) => `• ${s.title ? `[${s.title}] ` : ""}${s.exposition}`)
    .join("\n");
  if (!subs && !c.tamheed) return "";
  const terms = c.key_terms.length
    ? "\nمفاهيم أتعلمها (بتعريف الكتاب الحرفي — علّمها كما وردت):\n" +
      c.key_terms.map((t) => `- ${t.term_ar}: ${t.definition_ar}`).join("\n")
    : "";
  const misc = c.misconceptions.length
    ? "\nأخطاء شائعة (وظِّف كل واحدة كسؤال فخّ/فحص: اطرح الاعتقاد الخاطئ أو أمسكه إن ظهر، ثم صحّحه بلطف):\n" +
      c.misconceptions
        .map((m) => `- خطأ شائع: ${m.wrong}\n  الصواب: ${m.correction}`)
        .join("\n")
    : "";
  return `

TEACHING SCRIPT — النص التعليمي المُراجَع لهذا الدرس (كل جملة من الكتاب، بمراجعة بشرية). علِّم منه لكن بصوتك الدافئ وبأسلوبك التفاعلي: فكرة واحدة صغيرة في كل {{beat}}، لا تقرأه حرفيًا ولا تسرده دفعة واحدة، بل حوِّل كل فقرة إلى سلسلة (اشرح فكرة → فحص/تفاعل → كيّف حسب رده).
تمهيد: ${c.tamheed ?? ""}
شرح الأهداف (كل فقرة نصُّ تدريسِ هدفها بالترتيب):
${subs}${terms}${misc}`;
}

/** AskContext for the lesson surfaces — same shape /api/ask already streams. */
export async function buildLessonContext(
  mode: LessonMode,
  chatSession: string,
  lessonSlug?: string
): Promise<AskContext> {
  const data = await getLessonData(sanitizeLessonSlug(lessonSlug));
  // Social lessons append the gazetteer name lists of their referenced base
  // maps (≤2) — math data blocks stay byte-identical (mapBases only ever
  // gates in for social bundles' map_scene visuals).
  const gazetteer =
    data.subject === "social-ar" && data.mapBases.length > 0
      ? await gazetteerBlock(data.mapBases)
      : "";
  // Curated cross-subject bridges touching this lesson's LOs (§5). Fetched for
  // every subject — the connection is symmetric — and appended only when some
  // exist, so lessons without a bridge keep byte-identical data blocks.
  const bridges = bridgeBlock(await getLessonBridges(data.los.map((l) => l.id)));
  // The rich teaching script grounds the AI-LED lesson (learn mode) only —
  // review stays a fast 3-minute lock-in, and math has no content file.
  const content =
    mode === "learn" && data.subject === "social-ar"
      ? await getLessonContent(data.slug)
      : null;
  const teaching = content ? teachingScriptBlock(content) : "";
  return {
    systemPrompt: mode === "learn" ? learnPrompt(data) : reviewPrompt(data),
    dataBlock: lessonDataBlock(data) + gazetteer + bridges + teaching,
    grounding: {
      lo_ids: data.los.map((l) => l.id),
      question_ids: data.questions.map((q) => q.id),
      pages: [
        ...new Set(
          data.los
            .map((l) => l.sourcePage)
            .filter((p): p is number => p != null)
        ),
      ],
      chat_session: chatSession,
      lesson: data.slug,
    },
  };
}

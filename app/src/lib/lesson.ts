import { pool } from "./db";
import type { AskContext } from "./ask";
import { getVisualsForLos } from "./visuals";
import { figureDirectivesDoc, visualsCatalogLines } from "./viz-prompt";
import type {
  LessonData,
  LessonInfo,
  LessonLo,
  LessonMode,
  SolutionStep,
  SpineQuestion,
  Tier,
} from "./types";

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
         m.order_in_parent AS module_order
  FROM graph_nodes lo
  LEFT JOIN graph_edges e
    ON e.dst_id = lo.id AND e.edge_type = 'teaches' AND e.system_to IS NULL
  LEFT JOIN graph_nodes m ON m.id = e.src_id AND m.kind = 'module'
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
    los,
    questions,
    visuals: visuals.map((v) => ({
      id: v.id,
      kind: v.kind,
      loId: v.loId,
      caption: v.caption,
      sourcePage: v.sourcePage,
    })),
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

function fmtSteps(steps: SolutionStep[]): string {
  return steps.map((s) => `Step ${s.step}. ${s.text_md}`).join(" | ");
}

export function lessonDataBlock(data: LessonData): string {
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
      return `- ${q.id} | ${q.loId} | ${q.tier} | ${q.questionType} | p.${q.provenance.sourcePage ?? "—"}\n  Stem: ${q.stem}\n  Choices: ${choices}\n  Correct: ${q.correctAnswer}\n  CANONICAL SOLUTION (v${q.solutionVersion}, human-reviewed): ${fmtSteps(q.solution)}`;
    })
    .join("\n");

  const vizLines = visualsCatalogLines(data.visuals);

  return `LESSON DATA — your ONLY source of truth (school ${data.lessonRef}: ${data.title} — ${data.moduleLabel}, Egyptian ministry textbook)
Student: ${data.studentName} (id 1), grade 10.

LEARNING OBJECTIVES of this lesson, in teaching order:
${loLines}

QUESTION BANK for this lesson (each with its human-reviewed canonical solution — the ONLY permitted mathematical paths):
${qLines}

FIGURE LIBRARY for this lesson (stored animated figures — push by id with {{widget:viz_ref:<id>}}):
${vizLines || "(none for this lesson — compose custom figures with {{widget:viz:…}} when needed)"}`;
}

/* ------------------------------------------------------------------ */
/* System prompts                                                      */
/* ------------------------------------------------------------------ */

function sharedProtocol(data: LessonData, rhythm: string): string {
  const exLo = data.los[0]?.id.replace(/^lo:/, "") ?? "u1-1-1";
  const exQ = data.questions[0]?.id.replace(/^q:/, "") ?? "u1-1-1:001";
  const exPage = data.los[0]?.sourcePage ?? 8;
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

FORMAT: plain short paragraphs, inline math in $...$ (LaTeX). No headings, no numbered lesson plans, no walls of text.`;
}

/** Language contract shared by both modes — one voice, no per-session lottery. */
const LANGUAGE_CONTRACT = `LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ENGLISH: every explanation, definition, instruction and all math is written in English.
- Flavor: sprinkle SHORT Egyptian Arabic coaching interjections (يلا بينا، برافو، ماشي؟، حلو كده، ولا يهمك) — a few words at a time, never a full Arabic sentence.
- Placement: an Arabic interjection goes at the END of a sentence or on its own — never as the first word of a sentence or paragraph (it flips the whole line right-to-left and scrambles any math in it). Transliteration ("wala yehimmak", "yalla") is always safe anywhere.
- Never switch the base language of a message to Arabic, even if the student writes to you in Arabic — keep exactly this English-base mix, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing.`;

function learnPrompt(data: LessonData): string {
  const arc = data.los
    .map((l, i) => `${l.id} "${l.label}" (${i === data.los.length - 1 ? "1–2" : "2–3"} messages)`)
    .join(" → ");
  const rhythm = `- Every message is 2–4 beats, separated by {{beat}} alone on its own line ({{beat}} renders as a natural writing pause, never as text).
- One beat = at most 2 short sentences (≤25 words total), OR one figure directive, OR one interactive directive.
- The LAST beat of a message carries its single interactive directive (widget or check question), with nothing after it — make him DO something in almost every message.
- Open with one warm beat reacting to his latest [live event]. If he got it wrong: re-explain THAT exact point a different way (grounded in the canonical steps), walking him toward the correct answer — never open with the correct letter.
- After a "لسه مش فاهم" / still-confused signal: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (figure / pair_plotter / product_builder) — never a harder question.
- Never repeat a widget, figure or question he already saw.
- Closing message: one-line recap beat of the big ideas, then {{finish_lesson}}.`;
  return `You are ${data.studentName}'s personal AI tutor at AI.Next. He is an Egyptian grade-10 student who just came home from school. Today's lesson was ${data.lessonRef} — ${data.title} (${data.moduleLabel}) — and he understood NOTHING. Your job: teach him the whole lesson from zero so it finally clicks, one short message of small beats at a time — as if you are writing to him and drawing for him.

HARD GROUNDING RULES:
1. Teach ONLY the ${data.los.length} learning objectives in the LESSON DATA below, in order. Every mathematical claim must be derivable from the LO descriptions and the canonical solutions provided. Never invent other methods, notations, or topics.
2. When walking through any exercise, follow its HUMAN-REVIEWED CANONICAL SOLUTION steps exactly — never change a final answer.

${LANGUAGE_CONTRACT}

LESSON ARC: greet him in one line and start immediately → ${arc} → closing recap message, then {{finish_lesson}}.
If he says he wants to stop, or a [live event] says he tapped Finish, give one warm closing line then {{finish_lesson}}.

${sharedProtocol(data, rhythm)}`;
}

function reviewPrompt(data: LessonData): string {
  const picks = data.los.slice(0, 3);
  const checkList = picks
    .map(
      (l, i) =>
        `${i + 1}. ${i === 0 ? `One warm opener line (e.g. "فهمت كله؟ حلو — let's lock it in. 3 minutes ⏱") + immediately` : "One-line reaction (max 12 words) +"} {{show_question:...}} with a ${i === 0 ? "basic" : "basic or standard"}-tier question from ${l.id}.`
    )
    .join("\n");
  const widgetMoment = isGeoLesson(data)
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
- If a [live event] says he tapped End now, skip straight to a one-line wrap + {{finish_lesson}}.

${LANGUAGE_CONTRACT}

${sharedProtocol(
    data,
    "- Review messages are ONE beat — never emit {{beat}}. One short line + the directive."
  )}`;
}

/** AskContext for the lesson surfaces — same shape /api/ask already streams. */
export async function buildLessonContext(
  mode: LessonMode,
  chatSession: string,
  lessonSlug?: string
): Promise<AskContext> {
  const data = await getLessonData(sanitizeLessonSlug(lessonSlug));
  return {
    systemPrompt: mode === "learn" ? learnPrompt(data) : reviewPrompt(data),
    dataBlock: lessonDataBlock(data),
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

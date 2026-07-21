import { pool } from "./db";
import { getAllVisuals } from "./visuals";
import { figureDirectivesDoc, visualsCatalogLines } from "./viz-prompt";
import { subjectOfCourse } from "./lesson";
import type { Subject } from "./types";

/**
 * "Ask the Spine" — server-side grounding assembly.
 *
 * Every chat turn is grounded in the curriculum graph: the full LO list with
 * mastery, the prerequisite edge list, the question catalog, and (when a
 * question is in scope) its human-reviewed canonical solution. The model is
 * never allowed to solve from scratch — it explains *via* the canonical steps.
 */

const STUDENT_ID = 1;

export type AskSurface = "spine_chat" | "student_chat";

export interface Grounding {
  lo_ids: string[];
  question_ids: string[];
  pages: number[];
  chat_session: string;
  question_id?: string;
  wrong_answer?: string;
  /** lesson slug for the lesson surfaces (e.g. "geo1-2") */
  lesson?: string;
}

export interface AskContext {
  systemPrompt: string;
  dataBlock: string;
  grounding: Grounding;
}

const pctStr = (v: number) => `${Math.round(v * 100)}%`;

/**
 * How many LOs get the FULL treatment (description + question stems +
 * figure catalog). Everything else stays in the block as a compact index —
 * graph-as-index, not graph-as-payload. Keeps a spine turn ≤ ~8k input
 * tokens instead of shipping all 240 stems + 123 visuals (39.9k).
 */
const FOCUS_LO_COUNT = 8;

export async function buildAskContext(
  surface: AskSurface,
  chatSession: string,
  questionId?: string,
  wrongAnswer?: string
): Promise<AskContext> {
  const [losRes, edgesRes, masteryRes, qRes, docRes, studentRes, modulesRes, allVisuals] =
    await Promise.all([
      pool.query(`
        SELECT id, label, description, syllabus_ref, source_page
        FROM graph_nodes WHERE kind = 'learning_objective'
        ORDER BY order_in_parent
      `),
      pool.query(`
        SELECT src_id, dst_id FROM graph_edges
        WHERE edge_type = 'prerequisite_of' AND system_to IS NULL
      `),
      pool.query(
        `SELECT lo_id, score, system_from, system_to FROM mastery
         WHERE student_id = $1 ORDER BY lo_id, system_from`,
        [STUDENT_ID]
      ),
      pool.query(`
        SELECT id, lo_id, tier, question_type, stem, choices, correct_answer,
               canonical_solution, solution_version, source_page, source_sha256
        FROM questions WHERE status = 'live' ORDER BY lo_id, tier, id
      `),
      pool.query(
        `SELECT sha256, title, publisher, edition, grade, subject
         FROM source_documents ORDER BY ingested_at, sha256`
      ),
      pool.query(`SELECT display_name FROM students WHERE id = $1`, [
        STUDENT_ID,
      ]),
      pool.query(`
        SELECT id, label FROM graph_nodes WHERE kind = 'module'
        ORDER BY CASE WHEN id LIKE 'module:geo%' THEN 1 ELSE 0 END,
                 order_in_parent, id
      `),
      getAllVisuals(),
    ]);

  const docs = docRes.rows as {
    sha256: string;
    title: string;
    publisher: string;
    edition: string | null;
    grade: string;
    subject: string;
  }[];
  const student =
    (studentRes.rows[0]?.display_name as string) ?? "the demo student";

  // baseline = earliest row per LO, current = open row
  const baseline = new Map<string, number>();
  const current = new Map<string, number>();
  for (const r of masteryRes.rows) {
    if (!baseline.has(r.lo_id)) baseline.set(r.lo_id, Number(r.score));
    if (r.system_to === null) current.set(r.lo_id, Number(r.score));
  }

  // ---- per-session grounding slice (graph-as-index) ----
  // Focus = the question in scope's LO + the weakest LOs today. Snapshotted
  // per chat session by the route, so the block is byte-stable across turns
  // (prompt-cache prefix survives) and mastery never "live-updates" mid-chat.
  const focusLos = new Set<string>();
  const focusQRow = questionId
    ? qRes.rows.find((q) => q.id === questionId)
    : undefined;
  if (focusQRow) focusLos.add(focusQRow.lo_id);

  // Subject plumbing (ADR-0004 Wave 0): when a question is in scope, its
  // LO → module → course chain keys the language/grounding sections of the
  // system prompt. No question in scope → "math-en" (original behavior).
  let subject: Subject = "math-en";
  if (focusQRow) {
    const courseRes = await pool.query(
      `SELECT c.id FROM graph_edges t
       JOIN graph_edges p
         ON p.src_id = t.src_id AND p.edge_type = 'part_of' AND p.system_to IS NULL
       JOIN graph_nodes c ON c.id = p.dst_id AND c.kind = 'course'
       WHERE t.edge_type = 'teaches' AND t.system_to IS NULL AND t.dst_id = $1
       LIMIT 1`,
      [focusQRow.lo_id]
    );
    subject = subjectOfCourse(courseRes.rows[0]?.id);
  }

  // Per-course source doc (Wave 1): a question in scope pins the document it
  // was actually extracted from (its bundle sha) instead of whichever book
  // `LIMIT 1` happened to return. No question in scope (spine explorer):
  // a single-doc install reads exactly as before; a multi-doc install lists
  // every loaded book.
  const focusDoc = focusQRow
    ? docs.find((d) => d.sha256 === focusQRow.source_sha256)
    : undefined;
  const doc = focusDoc ??
    docs[0] ?? {
      title: "ministry textbook",
      publisher: "",
      edition: null,
      grade: "",
      subject: "",
    };
  const sourceLine =
    focusDoc || docs.length <= 1
      ? `Source book: "${doc.title}" — ${doc.publisher} (edition ${doc.edition}, ${doc.subject}, grade ${doc.grade}). Syllabus 2025–2026.`
      : `Source books (all ingested): ${docs
          .map((d) => `"${d.title}" — ${d.publisher} (${d.subject}, grade ${d.grade})`)
          .join("; ")}. Syllabus 2025–2026.`;
  const byWeakness = [...losRes.rows].sort(
    (a, b) => (current.get(a.id) ?? 0) - (current.get(b.id) ?? 0)
  );
  for (const l of byWeakness) {
    if (focusLos.size >= FOCUS_LO_COUNT) break;
    focusLos.add(l.id);
  }

  const loLines = losRes.rows
    .map((l) => {
      const head = `- ${l.id} | "${l.label}" | ref ${l.syllabus_ref ?? "—"} | book p.${l.source_page ?? "—"} | mastery today ${pctStr(current.get(l.id) ?? 0)} | at baseline diagnostic ${pctStr(baseline.get(l.id) ?? 0)}`;
      return focusLos.has(l.id) && l.description
        ? `${head}\n  ${l.description}`
        : head;
    })
    .join("\n");

  const edgeLines = edgesRes.rows
    .map((e) => `${e.src_id} -> ${e.dst_id}`)
    .join("\n");

  // Detailed bank (stems) only for focus LOs; compact per-LO index for the
  // rest — enough to reason about coverage without shipping 240 stems.
  const qLines = qRes.rows
    .filter((q) => focusLos.has(q.lo_id))
    .map(
      (q) =>
        `- ${q.id} | ${q.lo_id} | ${q.tier} | ${q.question_type} | p.${q.source_page ?? "—"} | "${String(q.stem).slice(0, 150)}"`
    )
    .join("\n");

  const qIndexByLo = new Map<string, { n: number; tiers: Map<string, number> }>();
  for (const q of qRes.rows) {
    if (focusLos.has(q.lo_id)) continue;
    let e = qIndexByLo.get(q.lo_id);
    if (!e) {
      e = { n: 0, tiers: new Map() };
      qIndexByLo.set(q.lo_id, e);
    }
    e.n++;
    e.tiers.set(q.tier, (e.tiers.get(q.tier) ?? 0) + 1);
  }
  const qIndexLines = [...qIndexByLo.entries()]
    .map(
      ([lo, e]) =>
        `- ${lo} | ${e.n} reviewed questions (${[...e.tiers.entries()].map(([t, n]) => `${n} ${t}`).join(", ")})`
    )
    .join("\n");

  const pages = [
    ...new Set(
      [
        ...losRes.rows.map((l) => l.source_page),
        ...qRes.rows.map((q) => q.source_page),
      ].filter((p): p is number => p != null)
    ),
  ].sort((a, b) => a - b);

  let focusBlock = "";
  const focusQ = questionId
    ? qRes.rows.find((q) => q.id === questionId)
    : undefined;
  if (focusQ) {
    const steps = (
      (focusQ.canonical_solution ?? []) as {
        step: number;
        text_md?: string;
        claim_ar?: string;
        evidence_page?: number;
      }[]
    )
      .map((s) =>
        s.text_md != null
          ? `  Step ${s.step}. ${s.text_md}`
          : `  Step ${s.step}. ${s.claim_ar ?? ""}${s.evidence_page != null ? ` [evidence: p.${s.evidence_page}]` : ""}`
      )
      .join("\n");
    const choices = focusQ.choices
      ? (focusQ.choices as { key: string; text: string }[])
          .map((c) => `    (${c.key}) ${c.text}`)
          .join("\n")
      : "    (numeric answer)";
    const solutionHeading =
      subject === "social-ar"
        ? `HUMAN-REVIEWED MODEL ANSWER WITH EVIDENCE (الإجابة النموذجية — v${focusQ.solution_version}) — the ONLY permitted factual path for explaining this question:`
        : `HUMAN-REVIEWED CANONICAL SOLUTION (v${focusQ.solution_version}) — the ONLY permitted mathematical path for explaining this question:`;
    focusBlock = `
QUESTION IN SCOPE (the one being discussed right now):
${focusQ.id} | ${focusQ.lo_id} | ${focusQ.tier} | book p.${focusQ.source_page ?? "—"}
Stem: ${focusQ.stem}
Choices:
${choices}
Correct answer: ${focusQ.correct_answer}
${wrongAnswer ? `${student}'s wrong answer: "${wrongAnswer}"` : ""}
${solutionHeading}
${steps}
`;
  }

  const moduleLines = modulesRes.rows
    .map((m) => `${m.id} "${m.label}"`)
    .join("; ");

  const vizLines = visualsCatalogLines(
    allVisuals.filter((v) => focusLos.has(v.loId))
  );
  const vizIndexByLo = new Map<string, string[]>();
  for (const v of allVisuals) {
    if (focusLos.has(v.loId)) continue;
    const arr = vizIndexByLo.get(v.loId) ?? [];
    arr.push(`${v.id} (${v.kind})`);
    vizIndexByLo.set(v.loId, arr);
  }
  const vizIndexLines = [...vizIndexByLo.entries()]
    .map(([lo, ids]) => `- ${lo} | ${ids.join(", ")}`)
    .join("\n");

  const dataBlock = `CURRICULUM DATA — your only source of truth
${sourceLine}
Ingested units: ${moduleLines}.
Student: ${student} (id 1). Mastery is 0–100%; "baseline" is his placement diagnostic, "today" is a snapshot taken when this chat began.

LEARNING OBJECTIVES (id | label | syllabus ref | book page | mastery; descriptions included for the current focus objectives):
${loLines}

PREREQUISITE EDGES ("A -> B" means A is a prerequisite of B):
${edgeLines}

DETAILED QUESTION BANK — focus objectives only (id | LO | tier | type | book page | stem). Push question cards ONLY from this list:
${qLines || "(none in focus)"}

QUESTION INDEX for all other objectives (coverage only — you may cite these LOs, but never invent or push question ids from here):
${qIndexLines || "(none)"}

FIGURE LIBRARY — focus objectives (stored animated figures — push by id with {{widget:viz_ref:<id>}}; id | kind | LO | book page | caption):
${vizLines || "(none in focus)"}

FIGURE INDEX for other objectives (ids you may push by id, uncaptioned here):
${vizIndexLines || "(none)"}
${focusBlock}`;

  const grounding: Grounding = {
    lo_ids: losRes.rows.map((l) => l.id),
    question_ids: qRes.rows.map((q) => q.id),
    pages,
    chat_session: chatSession,
    ...(questionId ? { question_id: questionId } : {}),
    ...(wrongAnswer ? { wrong_answer: wrongAnswer } : {}),
  };

  return {
    systemPrompt: systemPromptFor(surface, student, subject),
    dataBlock,
    grounding,
  };
}

function systemPromptFor(
  surface: AskSurface,
  student: string,
  subject: Subject = "math-en"
): string {
  const social = subject === "social-ar";
  const voiceLine = social
    ? `Voice: a warm, precise Egyptian tutor. Concise. ARABIC — Egyptian-flavored Modern Standard Arabic (صياغة فصيحة مبسّطة بروح مصرية), ministry terminology verbatim from the data (مصطلحات كتاب الوزارة حرفيًا — flag any missing term with [[term?:المصطلح]]), Arabic-Indic numerals in prose; Latin characters ONLY inside [[…]] citations and {{…}} directives.`
    : `Voice: a warm, precise human tutor. Concise. English.`;
  const groundingRules = social
    ? `HARD GROUNDING RULES (non-negotiable):
1. The curriculum data provided below is your ONLY source of truth. لا تذكر أي معلومة تاريخية أو جغرافية — تاريخ، رقم، اسم، مكان، سبب، نتيجة — غير واردة نصًا في البيانات. THE BOOK'S STATEMENT WINS even when you believe the world disagrees: كلام الكتاب هو الإجابة الصحيحة في الامتحان، والاستشهاد بالصفحة واجب.
2. NEVER state or explain facts from your own knowledge. الإجابة النموذجية (the HUMAN-REVIEWED MODEL ANSWER WITH EVIDENCE) is the ONLY permitted factual path — walk its claim-steps; a different pedagogical angle is allowed, different or additional facts are not. If no model answer is in scope for a question, do not state its answer — push the question card or point to it.
3. OUTSIDE THE BOOK — acknowledge → decline → redirect, always in that order: welcome the question, explain we study from كتاب الوزارة because it is what the exam grades, then redirect to the nearest in-book claim with its citation. NEVER answer first and disclaim after.
4. SENSITIVE CONTENT (hard rule): historical and political material is explained strictly as the book presents it — no commentary of your own, no modern political parallels, no evaluative judgments beyond the book's own framing.`
    : `HARD GROUNDING RULES (non-negotiable):
1. The curriculum data provided below is your ONLY source of truth. Never state a fact about the syllabus, the student, a question, or a page that is not derivable from it.
2. NEVER solve a math problem from scratch. You may only walk through mathematics using a provided HUMAN-REVIEWED CANONICAL SOLUTION. If no canonical solution is in scope for a question, do not derive its answer — instead push the question card or point to it.
3. If asked about anything outside the ingested units listed in the data, say plainly that it is outside the ingested syllabus slice, and point to what IS covered.`;
  const base = `You are "Ask the Spine" — the AI tutor of AI.Next, an adaptive ${social ? "" : "math "}tutor whose brain is a curriculum knowledge graph ("the spine") extracted, with provenance, from the official Egyptian ministry textbook. You are chatting inside a live demo about the student ${student}. ${voiceLine}

${groundingRules}

CITATIONS (mandatory — this is the product's signature):
Embed inline receipt markers right after each substantive claim:
- [[lo:u1-4-3]] when referencing a learning objective (use the id WITHOUT the "lo:" prefix repeated — i.e. exactly [[lo:u1-4-3]])
- [[q:u1-4-3:002]] when referencing a question
- [[page:22]] when referencing a book page
Use them liberally — every claim about mastery, prerequisites, questions or pages gets one. Use ONLY ids that exist in the data. Never invent ids. Never put markers inside $...$ math.

ACTIONS (interactive directives, each on its own line):
- {{show_question:q:u1-4-1:002}} — pushes that live question card into the chat for ${student} to answer. AT MOST ONE per turn, and only at the natural moment (e.g. when quizzing). Pick the question deliberately (right LO, right tier for his mastery).
- {{highlight:lo:u1-2-1,lo:u1-3-1}} — pulses those nodes on the on-screen curriculum graph. Use when tracing a path or contrasting objectives.
- ${figureDirectivesDoc("v:geo1-2:004")}

FORMAT:
- Plain paragraphs and "- " bullets only. No headings. **bold** sparingly.
- Inline math in $...$ (LaTeX), e.g. $f(x) = 3x^2 - 5$.
- 60–120 words in 2–3 beats. Separate beats with {{beat}} alone on its own line — it renders as a natural pause, never as text. One beat = 1–2 short sentences, or one figure, or one interactive directive; if the message has an interactive directive it is the LAST beat, with nothing after it. Answer first, then evidence.`;

  if (surface === "student_chat") {
    if (social) {
      return `${base}

MODE — RE-EXPLANATION TO THE STUDENT (you are talking directly to ${student} now):
He answered the QUESTION IN SCOPE wrongly and the model-answer claim-steps were already shown to him once. Your job:
- Diagnose, from his specific wrong answer, where his thinking most likely diverged — name the confusion gently (خلط بين مصطلحين، رقم متشابه، سبب في غير موضعه…).
- Re-explain using ONLY the الإجابة النموذجية claim-steps, but through a DIFFERENT pedagogical angle than a plain restatement (start from the map or definition, contrast his answer with the book's claim to show the mismatch, or rebuild the enumeration item by item) — each claim cited [[page:N]].
- Never introduce facts beyond the claim-steps and never change the final answer. If in doubt, quote the claim-step verbatim.
- Do NOT emit {{show_question:...}} in this mode. Cite [[q:...]], [[lo:...]] and [[page:...]] as usual.
- End with one short encouraging line. Address him as "you" (بصيغة المخاطب).`;
    }
    return `${base}

MODE — RE-EXPLANATION TO THE STUDENT (you are talking directly to ${student} now):
He answered the QUESTION IN SCOPE wrongly and the canonical steps were already shown to him once. Your job:
- Diagnose, from his specific wrong answer, where his thinking most likely diverged — name the misconception gently.
- Re-explain using ONLY the canonical solution steps, but through a DIFFERENT pedagogical angle than a plain restatement (work backwards from the answer, plug his answer in to show the contradiction, lean on the definition, or use the simplest possible parallel case from the same LO).
- Never introduce a different solution method and never change the final answer. If in doubt, quote the canonical step.
- Do NOT emit {{show_question:...}} in this mode. Cite [[q:...]], [[lo:...]] and [[page:...]] as usual.
- End with one short encouraging line. Address him as "you".`;
  }

  return `${base}

MODE — SPINE EXPLORER (you are talking to an observer watching ${student}'s graph):
Typical asks: what he should work on next and why (reason over mastery + prerequisite edges — weakest objective whose prerequisites are met; gate is 50%), why he is weak somewhere (look at its prerequisites' mastery), baseline vs today comparisons, or quizzing him (pick ONE question from his weakest LO at a fitting tier and push it with {{show_question:...}}).
Ground every recommendation in numbers from the data and cite as you go — the audience literally watches cited nodes light up on the graph while you speak.`;
}

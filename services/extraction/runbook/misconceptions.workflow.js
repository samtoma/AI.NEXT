export const meta = {
  name: 'misconceptions',
  description: 'S5 (B11): a misconception catalogue with refutations per objective, grounded in the book and fail-closed verified by a second agent',
  whenToUse: 'After S1 objectives and S3 book questions exist for a book. Run stage "draft" before S6/S7, then stage "final" with their distractors. Args: assemble_misconceptions.py --s5-args OUT --stage … [--by-ref].',
  phases: [
    { title: 'Author', detail: 'per objective: at most 4 errors the book evidences, each with a refutation in the house style (Sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'a different agent works every entry and every distractor against the canonical solutions; anything but CONFIRMED is dropped (Sonnet)', model: 'sonnet' },
  ],
}

/*
 * S5 — MISCONCEPTIONS AND REFUTATIONS (docs/specs/extraction-pipeline.md §3.8, B11;
 * spec 003 FR-4307; spec 001 FR-1111…FR-1115).
 *
 * WHY. A wrong answer should be met with a refutation of the specific error the
 * student made, not a restatement of the right method (FR-1113). This stage
 * writes those refutations for a new book, one objective at a time, from the
 * book's own evidence. It replaces refutation.workflow.js (retired, B18), and
 * keeps that design's fail-closed verifier and author ≠ grader rule, with `mc:`
 * ids and everything read from `args`.
 *
 * GROUNDED, NEVER SOLVED FROM SCRATCH. The canonical solutions passed in (the
 * book's worked examples and the EPUB worked solutions, S3) are the authority.
 * Neither agent solves anything the book has not solved.
 *
 * TWO RUNS PER BOOK (§3.2 order):
 *   stage "draft"  Author only. S6 and S7 then name these ids on their
 *                  distractors and widget predicates. A draft is NEVER loadable:
 *                  assemble_misconceptions.py refuses it.
 *   stage "final"  The draft is carried (its ids are never renamed), S6/S7
 *                  distractors are attached to the entry whose error they encode
 *                  (one error, one entry, FR-1115), new errors are authored, and
 *                  a DIFFERENT agent verifies every entry and every attachment.
 *
 * FAIL CLOSED. The verifier returns CONFIRMED, CONTRADICTS_CANONICAL, UNSUPPORTED
 * or UNCLEAR per entry, and fits true/false per attached distractor. Only
 * CONFIRMED entries and fits === true attachments survive; silence is a drop.
 * Every drop is in the return value (`dropped`, `stripped`), which is committed
 * under runs/<book>/misconceptions/, so it is logged and never shipped. The
 * assembler strips any distractor tag that points at a dropped entry (FR-1112).
 *
 * ARGS (everything comes from here; the runtime injects nothing else):
 * {
 *   book: "g10-math",                         // books/<book>.json
 *   stage: "draft" | "final",
 *   language: "en",                           // only "en" is supported (see below)
 *   notation: {decimal: "point", pair_separator: "comma"},   // book config, decision 15
 *   objectives: [{id: "lo:…", label, description?, lesson?, page?}],          // S1, after G1
 *   questions:  [{id, lo, kind?: "worked_example"|"exercise", stem, answer?,
 *                 choices?: [{key, text}], canonical_solution: [string | {text_md}],
 *                 solution_provenance?, source_page?}],                        // S3, after G2
 *   sources:    [{lo, kind: "caution"|"remark"|"resolve_disagreement", ref, page?, text}],
 *               // caution / "important" boxes and worked-example remarks (S0a blocks),
 *               // and the recurring wrong turns S3's blind re-solves exposed
 *   distractors: [{lo, origin: "book"|"S6"|"S7", ref, question_id?, text,
 *                  misconception_id?, proposed?: {label, description}}],
 *               // book: an MCQ choice (question_id + exact choice text → `maps`);
 *               // S6: a family distractor; S7: a widget predicate (text = what it detects)
 *   draft: <the draft run's return value>,    // final stage: carried entries, ids kept
 *   only: ["lo:…"],                           // optional subset
 *   max_per_objective: 4                      // optional; never more than 4
 * }
 *
 * PACKET BY REFERENCE (`assemble_misconceptions.py --s5-args … --by-ref`, packet_ref.py): instead of
 * `questions` and `sources`, the args carry `by_ref` {dir, stage, shards_sha256, files}, `counts`
 * {questions, sources} and `objective_refs` {"lo:…": {questions: n, sources: n}}. Each objective's
 * canonical solutions and book evidence are shard files under by_ref.dir, the blocks the prompts below
 * carry inline, and the prompts show [[file: <path>]] instead:
 *   o/<objective tail>.questions.txt   questionBlock(qs)     o/<objective tail>.sources.txt   sourceBlock(srcs)
 * By reference they are WHOLE (decision of 2026-09-26): inline clips them at 14000 and 8000 characters
 * and notes the cut; by reference nothing is cut, so no note is written.
 * The objectives, distractors and the draft stay in the args: this script's control flow reads them.
 * Author and verifier read only their own objective's shards; neither is blind to them.
 *
 * ARGS IN THE SCRIPT (--s5-args … --embed, embed_workflow.py; decision of 2026-09-26). S5 final's
 * args stay big even by reference (every distractor, every draft entry: ~66 KB for a chapter), so the
 * builder can write a COPY of this script with the args embedded, run with scriptPath and no args. It
 * sets ARGS.embedded {source, source_sha256, args_sha256, generated_sha256}, echoed as `embedded`.
 *
 * RETURNS { book, stage, records: [{lo, entries, dropped, stripped, flags, notes}], totals }.
 * Save it to runs/<book>/misconceptions/<stage>-<runId>.json, then
 *   uv run assemble_misconceptions.py runs/<book>/misconceptions/final-<runId>.json \
 *       --book <book> --out seed/generated/<book>/misconceptions.json --bundle …
 */

const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const PROMPTS_VERSION = 's5-v4'   // v2: packet by reference; v3: by-ref shards unclipped (whole solutions and evidence);
                                  // v4: each question names its figure image files, and the agents may open them

// ---- the house style (was build_misconceptions.py's mc() docstring; retired by decision 22) ----
const HOUSE_STYLE = `HOUSE STYLE for a refutation (the live catalogue's style; extraction-pipeline.md §3.8):
- A refutation is a short list of plain steps, one idea per step.
- Step 1 ALWAYS names what the student was thinking WITHOUT calling it stupid: name the mistake
  precisely and kindly. Where the student got part of it right, say so.
- The middle steps argue against THAT error — show where the reasoning diverges and why it fails —
  using the book's own method. One concrete case from this objective's questions, where the error
  gives a different answer from the canonical one, is often the clearest argument.
- The LAST step ALWAYS leaves the student with the move that works, so the entry ends on something
  usable rather than on the correction.
- Restating the correct method is not a refutation. If that is all you can honestly write for an
  error, leave the error out: the runtime then falls back to the canonical solution, which is fine.

TWO KINDS OF ENTRY, and the difference matters:
- an error a wrong option ENCODES: choosing that option IS the diagnosis, no classifier needed;
- a CONCEPTUAL confusion a student voices rather than clicks (FR-1114): a question brought from a
  tutor, a sibling, a calculator mode or another AI. It still answers WITHIN this book.

GROUNDING. Write against this objective's own description and this book's own questions, never
against mathematics in general. Correcting a student with a convention the book does not teach is
worse than silence: it contradicts their textbook and their teacher.`

const RULES = (notation) => `RULES (non-negotiable — these refutations reach students UNREVIEWED):
- The canonical solutions below are the authority. Never contradict their method or their final
  answers, and never solve anything the book has not solved.
- Teach only mathematics this objective and its questions cover. No outside technique, and no
  reference to any other book or course.
- Use the book's own terms, as its solutions and evidence word them. If you are unsure a term is the
  one this book uses, keep the book's wording and list the term under "flags" for human review.
- Numbers in the app's notation: ${notation.decimal === 'point' ? 'a decimal POINT (3.5, never 3,5)' : 'as printed'}; coordinate pairs as ${notation.pair_separator === 'comma' ? '(x, y), never (x; y)' : 'printed'}. Keep the book's contexts (names, currency, places) as printed.
- Maths in LaTeX between $…$. English, plain, warm, concrete. No preamble and no filler praise.
- Fewer entries is correct; padding is not.`

// ---- schemas -----------------------------------------------------------------------------------
const STEP = {
  type: 'object', required: ['step', 'text_md'],
  properties: { step: { type: 'integer' }, text_md: { type: 'string' } },
}

const SOURCE_REF = {
  type: 'object', required: ['type', 'ref'],
  properties: {
    type: { type: 'string', enum: ['caution', 'remark', 'resolve_disagreement', 'distractor', 'canonical_solution'] },
    ref: { type: 'string' },
  },
}

const AUTHOR_SCHEMA = {
  type: 'object', required: ['lo', 'entries', 'assignments', 'flags'],
  properties: {
    lo: { type: 'string' },
    entries: {
      type: 'array',
      items: {
        type: 'object', required: ['slug', 'label', 'description', 'sources', 'refutation'],
        properties: {
          slug: { type: 'string' },
          label: { type: 'string' },
          description: { type: 'string' },
          // Optional on purpose: a GUESSED signal drives a wrong diagnosis, which is worse
          // than none. Only when the error is recognisable from a final answer.
          signal: { type: 'string' },
          sources: { type: 'array', items: SOURCE_REF },
          refutation: { type: 'array', items: STEP },
        },
      },
    },
    assignments: {
      type: 'array',
      items: {
        type: 'object', required: ['distractor', 'entry', 'reason'],
        properties: {
          distractor: { type: 'integer' },
          // an existing entry id, a new entry's slug, or "" when the option encodes no named error
          entry: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    flags: {
      type: 'array',
      items: {
        type: 'object', required: ['kind', 'text'],
        properties: { kind: { type: 'string', enum: ['terminology', 'evidence', 'other'] }, text: { type: 'string' } },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', required: ['lo', 'verdicts'],
  properties: {
    lo: { type: 'string' },
    verdicts: {
      type: 'array',
      items: {
        type: 'object', required: ['id', 'verdict', 'reason', 'signal_ok', 'distractors'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'CONTRADICTS_CANONICAL', 'UNSUPPORTED', 'UNCLEAR'] },
          reason: { type: 'string' },
          signal_ok: { type: 'boolean' },
          distractors: {
            type: 'array',
            items: {
              type: 'object', required: ['index', 'fits', 'reason'],
              properties: { index: { type: 'integer' }, fits: { type: 'boolean' }, reason: { type: 'string' } },
            },
          },
        },
      },
    },
  },
}

// ---- args ----------------------------------------------------------------------------------------
const need = (cond, msg) => { if (!cond) throw new Error(`misconceptions.workflow.js: ${msg}`) }
need(typeof ARGS.book === 'string' && ARGS.book, 'args.book is required (the books/<book>.json name)')
need(ARGS.stage === 'draft' || ARGS.stage === 'final', 'args.stage must be "draft" or "final"')
const LANGUAGE = ARGS.language || 'en'
// The house style, the rules and the verifier are written for English-medium maths. An Arabic
// book needs its ministry terminology rules first; guessing them is exactly what we must not do.
need(LANGUAGE === 'en', `language "${LANGUAGE}" is not supported yet: S5 is written for English books`)
const NOTATION = ARGS.notation || { decimal: 'point', pair_separator: 'comma' }
need(Array.isArray(ARGS.objectives) && ARGS.objectives.length > 0, 'args.objectives (S1 output) is required')
for (const o of ARGS.objectives) need(/^lo:[a-z0-9-]+$/.test(o.id || '') && o.label, `bad objective ${JSON.stringify(o).slice(0, 120)}`)
// Inline (args.questions, args.sources) or by reference (args.by_ref + args.objective_refs): one, never both.
const REF = ARGS.by_ref || null
const OREF = ARGS.objective_refs || null
need(!((ARGS.questions || ARGS.sources) && (REF || OREF)),
  'give args.questions and args.sources (inline) or args.by_ref with args.objective_refs (by reference), not both')
need(!!REF === !!OREF, 'by reference needs both args.by_ref and args.objective_refs (`--s5-args … --by-ref` writes them)')
need(REF || Array.isArray(ARGS.questions), 'args.questions (inline) or args.by_ref (by reference) is required: use assemble_misconceptions.py --s5-args')
need(!REF || (typeof REF.dir === 'string' && REF.dir.startsWith('/') && REF.shards_sha256), 'args.by_ref must name the absolute shard directory and its shards_sha256')
const QUESTIONS = REF ? [] : (ARGS.questions || [])
const SOURCES = REF ? [] : (ARGS.sources || [])
const N_QUESTIONS = REF ? ((ARGS.counts || {}).questions || 0) : QUESTIONS.length
const N_SOURCES = REF ? ((ARGS.counts || {}).sources || 0) : SOURCES.length
const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const refFile = (name) => `[[file: ${REF.dir}/${name}]]`
const readRule = () => (REF ? `\n\n${READ_RULE}` : '')
// s5-v4 (the pilot's S5 draft): a question whose stem shows [figure] names its image files; the agent
// must SEE the diagram (points A–E, shapes W–Z) to name the error an option encodes. In both modes.
const FIGURE_RULE = 'Some questions list Figure(s): the image files of the diagrams their stems show as [figure]. Read every figure image of a question you use, with the Read tool, before you judge that question or its options; you may open those image files as well.'
const figureRule = (p) => ((REF ? (oref(p.lo).figures || 0) : p.qs.reduce((n, q) => n + ((q.figures || []).length), 0)) ? `\n\n${FIGURE_RULE}` : '')
const DISTRACTORS = ARGS.distractors || []
for (const d of DISTRACTORS) {
  need(['book', 'S6', 'S7'].includes(d.origin), `distractor origin must be book, S6 or S7: ${JSON.stringify(d).slice(0, 120)}`)
  need(d.origin !== 'book' || (d.question_id && typeof d.text === 'string'), `a book distractor needs question_id and its exact choice text: ${JSON.stringify(d).slice(0, 120)}`)
}
const MAX = Math.min(4, Math.max(1, ARGS.max_per_objective || 4))
const ONLY = ARGS.only || null

const draftEntries = (() => {
  if (ARGS.stage === 'draft') return []
  const d = ARGS.draft
  if (!d) return []
  const recs = Array.isArray(d) ? d : (d.records || [])
  return recs.flatMap((r) => (r.entries ? r.entries : [r]))
})()

// ---- ids -------------------------------------------------------------------------------------------
const MC_RE = /^mc:([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/
const loTail = (lo) => lo.replace(/^lo:/, '')
const slugify = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '')
const wellFormedFor = (id, lo) => { const m = MC_RE.exec(id || ''); return !!m && m[1] === loTail(lo) }

// ---- evidence per objective -----------------------------------------------------------------------
const clip = (text, max, what, notes) => {
  if (text.length <= max) return text
  notes.push(`${what} truncated from ${text.length} to ${max} characters`)
  return text.slice(0, max) + '\n… [truncated]'
}
const solText = (q) => (q.canonical_solution || q.solution || []).map((s, i) => `  ${i + 1}. ${typeof s === 'string' ? s : (s.text_md || s.text || '')}`).join('\n')

const questionBlock = (qs, notes) => clip(qs.map((q) => [
  `[${q.id}]${q.kind ? ` (${q.kind})` : ''}${q.source_page ? ` p.${q.source_page}` : ''}${q.solution_provenance ? ` — solution: ${q.solution_provenance}` : ''}`,
  `  Q: ${q.stem}`,
  q.figures && q.figures.length ? `  Figure(s): ${q.figures.join(', ')}` : null,
  q.choices && q.choices.length ? `  Options: ${q.choices.map((c) => `${c.key}) ${c.text}`).join('   ')}` : null,
  q.answer != null ? `  Answer: ${q.answer}` : null,
  `  Canonical solution:\n${solText(q)}`,
].filter(Boolean).join('\n')).join('\n\n'), 14000, 'canonical solutions', notes)

const sourceBlock = (srcs, notes) => srcs.length
  ? clip(srcs.map((s) => `[${s.kind} ${s.ref}${s.page ? ` p.${s.page}` : ''}] ${s.text}`).join('\n'), 8000, 'book evidence', notes)
  : '(none)'

const distractorLine = (d, i) => {
  const where = d.origin === 'book' ? `book option on ${d.question_id}` : d.origin === 'S6' ? `generated family ${d.ref}` : `widget predicate ${d.ref}`
  const named = d.misconception_id ? ` — currently tagged ${d.misconception_id}` : ''
  const prop = d.proposed ? ` — its author's reading: "${d.proposed.label}: ${d.proposed.description}"` : ''
  return `D${i}. ${where}: "${d.text}"${named}${prop}`
}

// The two big blocks of both prompts, rendered here (inline) or read from the objective's shards.
const oref = (lo) => OREF[lo.id] || { questions: 0, sources: 0, notes: { questions: [], sources: [] } }
const questionsFor = (p, notes) => {
  if (!REF) return questionBlock(p.qs, notes)
  notes.push(...((oref(p.lo).notes || {}).questions || []))
  return refFile(`o/${loTail(p.lo.id)}.questions.txt`)
}
const sourcesFor = (p, notes) => {
  if (!REF) return sourceBlock(p.srcs, notes)
  if (!oref(p.lo).sources) return '(none)'
  notes.push(...((oref(p.lo).notes || {}).sources || []))
  return refFile(`o/${loTail(p.lo.id)}.sources.txt`)
}

const entryBlock = (entries) => entries.length
  ? entries.map((e) => `${e.id} — ${e.label}: ${e.description}`).join('\n')
  : '(none)'

// ---- prompts ---------------------------------------------------------------------------------------
const authorPrompt = (lo, ctx) => `You are a mathematics teacher who has marked thousands of scripts for this book, writing the
misconception catalogue for ONE learning objective.

LEARNING OBJECTIVE ${lo.id}: "${lo.label}"
${lo.description ? `Description: ${lo.description}\n` : ''}${lo.lesson ? `Lesson: ${lo.lesson}\n` : ''}${lo.page ? `Book page: ${lo.page}\n` : ''}
THE BOOK'S QUESTIONS ON THIS OBJECTIVE, WITH THEIR CANONICAL SOLUTIONS (the authority):
${ctx.questions}

THE BOOK'S OWN EVIDENCE OF WHERE STUDENTS GO WRONG (caution boxes, worked-example remarks, and the
wrong turns an independent re-solve of these questions took):
${ctx.sources}

ENTRIES THIS OBJECTIVE ALREADY HAS (keep them; never add a second entry for the same error):
${ctx.existing}

WRONG OPTIONS AND WIDGET PREDICATES THAT STILL NEED AN ERROR (index them as D0, D1, …):
${ctx.distractors}

${HOUSE_STYLE}

${RULES(NOTATION)}

YOUR TASK
1. Name the distinct errors this objective invites that the evidence above SUPPORTS: a caution the
   book prints, a remark, a re-solve's wrong turn, or a wrong option someone deliberately wrote.
   Each must be one diagnosable error that produces a predictable wrong answer or a voiced
   confusion. "Careless mistake" or "did not study" are not errors.
2. ONE ERROR, ONE ENTRY. If an error is already listed above, do not write it again: assign its
   distractors to that existing id instead. Two new entries must never be the same error.
3. You may add at most ${ctx.capacity} new entr${ctx.capacity === 1 ? 'y' : 'ies'}. Fewer is correct.
4. For each new entry: a short kebab-case slug, a label, a one-sentence description of what the
   student does, a signal ONLY when the error is recognisable from a final answer (omit it
   otherwise), the evidence it rests on (sources: type + ref as given above), and the refutation
   in the house style.
5. For EVERY distractor D0, D1, … return one assignment: the id of an existing entry, the slug of a
   new entry, or "" when the option encodes no error you can name honestly.
6. List under flags any term you were unsure the book uses, and any evidence you could not use.

Output AUTHOR_SCHEMA with lo="${lo.id}".${readRule()}${ctx.figureRule || ''}`

const verifyPrompt = (lo, ctx) => `You are a DIFFERENT teacher checking a colleague's misconception catalogue. You did not write it.
These refutations will reach real students WITHOUT human review, and you are the only check. Be
adversarial: work every entry through yourself, against the canonical solutions, before judging it.

LEARNING OBJECTIVE ${lo.id}: "${lo.label}"
${lo.description ? `Description: ${lo.description}\n` : ''}
CANONICAL SOLUTIONS (the authority):
${ctx.questions}

THE BOOK'S EVIDENCE:
${ctx.sources}

ENTRIES TO CHECK, each with the wrong options and widget predicates attached to it:
${ctx.entries}

For EACH entry, by its id, return a verdict:
- CONFIRMED             — the error is real for this objective and supported by the evidence; the
                          refutation is mathematically correct, consistent with the canonical method
                          and final answers, argues against THIS error (not a restatement of the
                          method), and teaches nothing this book does not.
- CONTRADICTS_CANONICAL — any step uses a different method from the book's, or reaches a different
                          answer from a canonical solution.
- UNSUPPORTED           — the error, or a claim in the refutation, is not supported by this objective
                          and its evidence, it teaches outside the book, or it only restates the method.
- UNCLEAR               — you cannot confirm it is correct.
Set signal_ok to false if the entry's signal would misdiagnose a student (or it has none: then true).
For each attached option or predicate (by its index), fits is true ONLY if a student making exactly
this error would choose exactly this option, or trigger exactly this predicate.

Only CONFIRMED entries are kept. When in doubt, do NOT confirm: a dropped entry costs a fallback to
the canonical solution; a wrong one teaches a child the error it was meant to fix.

Output VERIFY_SCHEMA with lo="${lo.id}".${readRule()}${ctx.figureRule || ''}`

// ---- per objective -----------------------------------------------------------------------------------
const los = ARGS.objectives.filter((lo) => !ONLY || ONLY.includes(lo.id))
need(los.length > 0, 'no objectives selected — check args.only')
const loIds = new Set(ARGS.objectives.map((o) => o.id))
const entryLo = new Map(draftEntries.map((e) => [e.id, e.lo_id]))

log(`S5 ${ARGS.stage} for ${ARGS.book}: ${los.length} objective(s), ${N_QUESTIONS} questions, ` +
    `${N_SOURCES} evidence items, ${DISTRACTORS.length} distractors, ${draftEntries.length} carried entries` +
    (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))

const kindOf = (covers) => covers.some((c) => c.origin === 'book') ? 'book_distractor'
  : covers.some((c) => c.origin === 'S6' || c.origin === 'S7') ? 'generated_distractor' : 'conceptual'

const prepare = (lo) => {
  const notes = []
  const qs = QUESTIONS.filter((q) => q.lo === lo.id)
  const srcs = SOURCES.filter((s) => s.lo === lo.id)
  const nq = REF ? oref(lo).questions : qs.length
  const carried = draftEntries.filter((e) => e.lo_id === lo.id).map((e) => ({
    id: e.id, lo_id: lo.id, label: e.label, description: e.description, signal: e.signal || null,
    sources: e.sources || [], refutation: e.refutation || [], covers: [], aliases: [...(e.aliases || [])],
    draftCovers: e.covers || [],
  }))
  const carriedIds = new Set(carried.map((e) => e.id))
  // A distractor the draft already attached (book options, usually) stays with that entry
  // without a second author call: matched on origin + question/ref + exact text.
  const key = (d) => `${d.origin}|${d.origin === 'book' ? d.question_id : d.ref}|${d.text}`
  const draftOwner = new Map()
  for (const e of carried) for (const c of e.draftCovers) draftOwner.set(key(c), e.id)
  const ds = DISTRACTORS.map((d, index) => ({ ...d, index })).filter((d) => d.lo === lo.id)
  const stripped = []
  const open = []
  for (const d of ds) {
    const owner = d.misconception_id && carriedIds.has(d.misconception_id) ? d.misconception_id
      : !d.misconception_id ? draftOwner.get(key(d)) : undefined
    if (owner) {
      carried.find((e) => e.id === owner).covers.push(d)
    } else if (d.misconception_id && entryLo.has(d.misconception_id) && entryLo.get(d.misconception_id) !== lo.id) {
      // FR-1106: a distractor names a misconception of its OWN objective. Re-attach it here.
      notes.push(`D${d.index} was tagged ${d.misconception_id}, an entry of ${entryLo.get(d.misconception_id)}; re-attached on ${lo.id}`)
      open.push(d)
    } else {
      open.push(d)
    }
  }
  return { lo, qs, srcs, nq, carried, open, stripped, notes }
}

const author = async (p) => {
  const { lo, carried, open, notes } = p
  if (p.nq === 0) {
    // Nothing canonical to ground in: fail closed rather than write from general mathematics.
    notes.push('no canonical solution for this objective — skipped, nothing authored')
    return { ...p, fresh: [], assignments: [], flags: [], skipped: true }
  }
  const needAuthor = ARGS.stage === 'draft' || open.length > 0 || carried.length === 0
  if (!needAuthor) return { ...p, fresh: [], assignments: [], flags: [] }
  const capacity = Math.max(0, MAX - carried.length)
  const ctx = {
    questions: questionsFor(p, notes),
    sources: sourcesFor(p, notes),
    existing: entryBlock(carried),
    distractors: open.length ? open.map((d, i) => distractorLine(d, i)).join('\n') : '(none)',
    capacity,
    figureRule: figureRule(p),
  }
  const out = await agent(authorPrompt(lo, ctx), {
    label: `author:${lo.id}`, phase: 'Author', model: 'sonnet', schema: AUTHOR_SCHEMA,
  })
  if (!out) {
    notes.push('author returned nothing (skipped or failed) — no new entries')
    return { ...p, fresh: [], assignments: [], flags: [] }
  }
  let fresh = out.entries || []
  if (fresh.length > capacity) {
    notes.push(`author wrote ${fresh.length} new entries, capacity ${capacity}: kept the first ${capacity}, dropped ${fresh.slice(capacity).map((e) => e.slug).join(', ')}`)
    fresh = fresh.slice(0, capacity)
  }
  return { ...p, fresh, assignments: out.assignments || [], flags: out.flags || [] }
}

// Mint ids and attach every open distractor to the entry the author named (or strip its tag).
const assemble = (p) => {
  const { lo, carried, open, fresh, assignments, stripped, notes } = p
  const taken = new Set([...draftEntries.map((e) => e.id), ...carried.map((e) => e.id)])
  const bySlug = new Map()
  const minted = []
  for (const e of fresh) {
    const slug = slugify(e.slug || e.label)
    if (!slug || bySlug.has(slug)) { notes.push(`new entry "${e.label}" has an empty or repeated slug — dropped`); continue }
    // Adopt a well-formed id an S6/S7 author already used for this error, so no tag needs rewriting.
    const proposals = assignments
      .filter((a) => slugify(a.entry) === slug && open[a.distractor] && open[a.distractor].misconception_id)
      .map((a) => open[a.distractor].misconception_id)
      .filter((id) => wellFormedFor(id, lo.id) && !taken.has(id))
    let id = proposals[0] || `mc:${loTail(lo.id)}:${slug}`
    for (let n = 2; taken.has(id); n++) id = `mc:${loTail(lo.id)}:${slug}-${n}`
    taken.add(id)
    const entry = {
      id, lo_id: lo.id, label: e.label, description: e.description, signal: e.signal || null,
      sources: e.sources || [], refutation: (e.refutation || []).map((s, i) => ({ step: i + 1, text_md: s.text_md })),
      covers: [], aliases: [],
    }
    bySlug.set(slug, entry)
    minted.push(entry)
  }
  const all = [...carried, ...minted]
  const byId = new Map(all.map((e) => [e.id, e]))
  const seen = new Set()
  for (const a of assignments) {
    const d = open[a.distractor]
    if (!d || seen.has(a.distractor)) continue
    seen.add(a.distractor)
    const target = byId.get(a.entry) || bySlug.get(slugify(a.entry))
    if (!target) {
      stripped.push({ ...d, reason: a.entry ? `assigned to unknown entry "${a.entry}"` : `no named error: ${a.reason}` })
      continue
    }
    // An id an S6/S7 author invented for this error becomes an alias in toRecord, and only if
    // the verifier agrees this item encodes this entry's error (FR-1115).
    target.covers.push(d)
  }
  open.forEach((d, i) => { if (!seen.has(i)) stripped.push({ ...d, reason: 'the author returned no assignment for it' }) })
  return { ...p, all }
}

const verify = async (p) => {
  const { lo, all, stripped, notes } = p
  if (ARGS.stage === 'draft' || p.skipped || all.length === 0) {
    return { ...p, kept: all, dropped: [] }
  }
  const ctx = {
    questions: questionsFor(p, []),
    sources: sourcesFor(p, []),
    figureRule: figureRule(p),
    entries: all.map((e) => [
      `ENTRY ${e.id} — ${e.label}`,
      `  What the student does: ${e.description}`,
      `  Signal: ${e.signal || '(none)'}`,
      `  Evidence cited: ${(e.sources || []).map((s) => `${s.type} ${s.ref}`).join('; ') || '(none)'}`,
      `  Refutation:\n${e.refutation.map((s) => `    ${s.step}. ${s.text_md}`).join('\n')}`,
      e.covers.length ? `  Attached:\n${e.covers.map((d) => `    [${d.index}] ${distractorLine(d, d.index).replace(/^D\d+\. /, '')}`).join('\n')}` : '  Attached: (none)',
    ].join('\n')).join('\n\n'),
  }
  const out = await agent(verifyPrompt(lo, ctx), {
    label: `verify:${lo.id}`, phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA,
  })
  const byId = new Map()
  for (const v of (out && out.verdicts) || []) {
    // Two verdicts for one id that disagree count as not confirmed.
    const prev = byId.get(v.id)
    byId.set(v.id, prev && prev.verdict !== v.verdict ? { ...v, verdict: 'UNCLEAR', reason: 'conflicting verdicts' } : v)
  }
  const kept = []
  const dropped = []
  for (const e of all) {
    const v = byId.get(e.id)
    if (!v || v.verdict !== 'CONFIRMED') {
      dropped.push({ id: e.id, lo_id: lo.id, label: e.label, aliases: e.aliases,
        verdict: v ? v.verdict : 'NO_VERDICT', reason: v ? v.reason : 'the verifier returned no verdict for this entry' })
      for (const d of e.covers) stripped.push({ ...d, reason: `its entry ${e.id} was dropped (${v ? v.verdict : 'NO_VERDICT'})` })
      continue
    }
    const fits = new Map((v.distractors || []).map((x) => [x.index, x]))
    const covers = []
    for (const d of e.covers) {
      const f = fits.get(d.index)
      if (f && f.fits === true) covers.push(d)
      else stripped.push({ ...d, reason: f ? `does not encode ${e.id}: ${f.reason}` : `the verifier did not judge it against ${e.id}` })
    }
    if (e.signal && v.signal_ok !== true) notes.push(`${e.id}: signal removed — the verifier could not confirm it`)
    kept.push({ ...e, covers, signal: v.signal_ok === true ? e.signal : null, verdict: { verdict: v.verdict, reason: v.reason } })
  }
  if (dropped.length) log(`${lo.id}: dropped ${dropped.length}/${all.length} — ${dropped.map((d) => d.verdict).join(', ')}`)
  return { ...p, kept, dropped }
}

const aliasesOf = (e) => [...new Set([
  ...e.aliases,
  ...e.covers.filter((d) => d.origin !== 'book' && d.misconception_id && d.misconception_id !== e.id).map((d) => d.misconception_id),
])]

const toRecord = (p) => ({
  lo: p.lo.id,
  entries: p.kept.map((e) => ({
    id: e.id,
    lo_id: e.lo_id,
    label: e.label,
    description: e.description,
    signal: e.signal,
    kind: kindOf(e.covers),
    refutation: e.refutation,
    maps: e.covers.filter((d) => d.origin === 'book').map((d) => ({ question_id: d.question_id, choice_text: d.text })),
    aliases: aliasesOf(e),
    sources: e.sources,
    covers: e.covers.map((d) => ({ origin: d.origin, ref: d.ref, question_id: d.question_id || null, text: d.text, tagged: d.misconception_id || null })),
    ...(ARGS.stage === 'final' ? { verdict: e.verdict } : { verified: false }),
  })),
  dropped: p.dropped,
  stripped: p.stripped.map((d) => ({ lo: p.lo.id, origin: d.origin, ref: d.ref, question_id: d.question_id || null, text: d.text, tagged: d.misconception_id || null, reason: d.reason })),
  flags: p.flags || [],
  notes: p.notes,
  ...(p.skipped ? { skipped: true } : {}),
})

// Distractors on objectives that are not in this run are reported, never silently ignored.
const orphans = DISTRACTORS.filter((d) => !loIds.has(d.lo))
if (orphans.length) log(`${orphans.length} distractor(s) name objectives not in args.objectives — ignored: ${orphans.slice(0, 3).map((d) => d.ref).join(', ')}`)

const records = (await pipeline(los,
  (lo) => author(prepare(lo)),
  (p) => verify(assemble(p)),
  (p) => toRecord(p),
)).filter(Boolean)

const totals = records.reduce((a, r) => ({
  objectives: a.objectives + 1,
  entries: a.entries + r.entries.length,
  dropped: a.dropped + r.dropped.length,
  stripped: a.stripped + r.stripped.length,
  skipped: a.skipped + (r.skipped ? 1 : 0),
  flags: a.flags + r.flags.length,
}), { objectives: 0, entries: 0, dropped: 0, stripped: 0, skipped: 0, flags: 0 })

if (records.length < los.length) log(`${los.length - records.length} objective(s) failed outright and have no record`)
log(`S5 ${ARGS.stage}: ${totals.entries} entries kept, ${totals.dropped} dropped by the verifier, ` +
    `${totals.stripped} distractor tag(s) stripped, ${totals.skipped} objective(s) skipped, ${totals.flags} flag(s) for review`)
if (ARGS.stage === 'draft') log('DRAFT: not loadable. Run stage "final" after S6 and S7.')
else log('Every kept entry loads reviewed=false: unreviewed, attributed, sampled at G4.')

return { book: ARGS.book, stage: ARGS.stage, prompts_version: PROMPTS_VERSION, ...(REF ? { by_ref: REF } : {}),
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  max_per_objective: MAX, records, totals }

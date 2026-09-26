export const meta = {
  name: 'widgets',
  description: 'S7 (B13): widget questions per lesson from the existing kinds, or a recorded widget gap (mode author); a blind reachability verifier (mode verify) — decision 11',
  whenToUse: 'mode "author" after S5 draft with args from generate_widget_questions.py --author-args; mode "verify" on its --verify-args output.',
  phases: [
    { title: 'Author', detail: 'per lesson: pick an existing kind only where it genuinely fits, write the template, or record the gap and the kind it would need (Sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'blind: a different agent constructs an answer on the instrument from the stem alone, and checks each predicate is the error its misconception names (Sonnet)', model: 'sonnet' },
  ],
}

/*
 * S7 — WIDGET QUESTIONS (docs/specs/extraction-pipeline.md §3.10, B13; spec 003 FR-4306;
 * spec 001 FR-1201…FR-1219; ADR-0009; decision 11).
 *
 * A widget is a question whose wrong answers are PREDICATES over a construction,
 * each mapped to a misconception (ADR-0009). This stage writes them for a new book
 * from the kinds that already exist (contracts/widget-predicates.json). It NEVER
 * invents a kind: where none genuinely fits it records a GAP with the kind the
 * lesson would need, and the gap list goes to Samuel. A new kind is built only
 * after he approves it (decision 11, T356).
 *
 * THE LOOP (the operator runs the Python steps; this script never touches files):
 *   1. uv run generate_widget_questions.py --author-args A.json [--by-ref] --book <book> --dsn "$AINEXT_DB_DSN"
 *   2. this workflow, args = A.json (mode "author") → runs/<book>/widgets/author-<runId>.json;
 *      write each template to widgets/<book>/<lo tail>--<slug>.json
 *   3. uv run generate_widget_questions.py --templates widgets/<book> --book <book> --dsn … \
 *          --pre-catalogue --verify-args V.json [--by-ref] --s5-distractors runs/<book>/widgets/s5.json
 *      (every check but catalogue existence; the predicates go to S5's final pass)
 *   4. this workflow, args = V.json (mode "verify") → runs/<book>/widgets/verify-<runId>.json
 *   5. after S5 final is loaded into the scratch DB:
 *      uv run generate_widget_questions.py --templates widgets/<book> --book <book> --dsn … \
 *          --verdicts runs/<book>/widgets/verify-*.json --gaps runs/<book>/widgets/author-*.json \
 *          --gap-report coverage/<book>.widget-gaps.json --out seed/generated/<book>/widget-questions.json
 *   6. uv run meter_run.py record --book <book> --stage S7 --run <wf_id>
 *
 * BLIND MEANS BLIND. The verifier sees the stem, the kind, the instrument's limits
 * and the predicate → misconception mappings. It never sees the canonical solution
 * or the stored spec. From the stem alone it:
 *   - READS the question's parameters in the kind's own fields (`reading`), which the
 *     Python side compares with the stored spec. A spec that disagrees with its own
 *     stem is refused. (That was the defect in the Prep-3 widgets q:t2u2-2-1:w001–w003
 *     until v0.9.3, migration 032: their targets were the negatives of the excluded values.)
 *   - CONSTRUCTS a correct answer on the instrument (FR-1207: a target the instrument
 *     cannot reach marks a correct student wrong);
 *   - says for each predicate whether the construction that fires it is the error its
 *     misconception names.
 * The Python side accepts a template only if every instance's reading agrees, it is
 * reachable, and every mapping is confirmed. Silence is not approval.
 *
 * ARGS
 *   author: { mode, book, course_id, contract: {kind: {predicates: {name: meaning}, instrument}},
 *             objectives: [{lo_id, label, description, module, module_label,
 *               anchor_questions: [{id, stem, type, answer}],
 *               misconceptions: [{id, lo_id, label, description, own}]}],
 *             only_modules?: ["module:…"] }
 *   verify: { mode, book, widgets: [{question_id, template_id, template_sha, lo_id, kind, spec,
 *             stem, instrument, reading_fields, diagnostics: [{predicate, predicate_meaning,
 *             misconception_id, misconception_label, misconception_description}]}] }
 *             (`spec` is in args for the operator's record; it is never put in a prompt)
 *
 * PACKET BY REFERENCE (--author-args … --by-ref, --verify-args … --by-ref; packet_ref.py). The
 * args carry `by_ref` {dir, stage, shards_sha256, files} and, instead of the big blocks, what this
 * script's control flow reads; the prompts show [[file: <path>]] where the text used to be:
 *   author: `contract_kinds` {kind: [predicate names]} and `lesson_refs` [{lesson, module,
 *           module_label, lo_ids}] instead of `contract` and `objectives`; shards contract.txt and
 *           lessons/<lesson>.txt: the JSON the prompt carries inline, WHOLE (inline clips it at 9000
 *           and 14000 characters, which cuts the contract's last kinds off; by reference nothing is cut).
 *   verify: `widget_refs` [{template_id, widgets: [{question_id, template_sha}]}] instead of
 *           `widgets`; per template n the shard t/t<n>.txt: the widget blocks of the prompt below
 *           (stem, instrument, reading fields, claimed diagnoses). No spec is written anywhere in
 *           the packet: the blind verifier cannot be pointed at one.
 * RETURNS
 *   author: { mode, book, records: [{lesson, templates: [template], gaps: [{lo_id, need_kind,
 *             description, why}]}], gaps: [...all gaps...] }
 *   verify: { mode, book, results: [{question_id, template_sha, reading, construction, reachable,
 *             predicates: [{predicate, matches, why}]}] }
 */

const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const PROMPTS_VERSION = 's7-v3'   // v2: packet by reference; v3: by-ref shards unclipped (the whole contract)
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
need(ARGS.mode === 'author' || ARGS.mode === 'verify', 'args.mode must be "author" or "verify" (see the header of this script)')
need(ARGS.book && ARGS.book.book, 'args.book must be the book config (generate_widget_questions.py writes it)')
const BOOK = ARGS.book
const clip = (v, n) => JSON.stringify(v, null, 1).slice(0, n)

// ---- packet by reference ------------------------------------------------------------------------
const REF = ARGS.by_ref || null
need(!REF || (typeof REF.dir === 'string' && REF.dir.startsWith('/') && REF.shards_sha256),
  'args.by_ref must name the absolute shard directory and its shards_sha256')
if (ARGS.mode === 'author') {
  need(!((ARGS.contract || ARGS.objectives) && (REF || ARGS.lesson_refs || ARGS.contract_kinds)),
    'give args.contract and args.objectives (inline) or args.by_ref with args.lesson_refs and args.contract_kinds (by reference), not both')
  need(!REF || (ARGS.lesson_refs && ARGS.contract_kinds), 'by reference needs args.lesson_refs and args.contract_kinds (`--author-args … --by-ref` writes them)')
  need(REF || !(ARGS.lesson_refs || ARGS.contract_kinds), 'args.lesson_refs and args.contract_kinds need args.by_ref')
}
if (ARGS.mode === 'verify') {
  need(!(ARGS.widgets && (REF || ARGS.widget_refs)), 'give args.widgets (inline) or args.by_ref with args.widget_refs (by reference), not both')
  need(!!REF === !!ARGS.widget_refs, 'by reference needs both args.by_ref and args.widget_refs (`--verify-args … --by-ref` writes them)')
}
const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const refFile = (name) => `[[file: ${REF.dir}/${name}]]`
const readRule = () => (REF ? `\n\n${READ_RULE}` : '')

// ---------------------------------------------------------------- author
const TEMPLATE_RULES = `A WIDGET TEMPLATE (format "ainext.widget-template/1"):
{
  "format": "ainext.widget-template/1",
  "id": "wt:<objective tail>:<slug>",
  "lo_id": "<one objective of this lesson>",
  "parent_question_id": "<that objective's anchor book question, from the list>",
  "tier": "basic" | "standard" | "advanced",
  "kind": "<an EXISTING kind from the contract>",
  "instances": [{"m": 2, "b": -1}, …],        optional: one question per row of parameters
  "spec": {… the kind's fields; a value that is exactly "{=m}" takes the row's value, typed …},
  "stem": "template, e.g. Draw the line $y = {=linear(m, b)}$.",
  "solution": ["step", …],                    the canonical construction, one idea per step
  "diagnostics": [{"predicate": "<one of the kind's predicates>", "misconception_id": "mc:…"}, …],
  "notes": "…"
}
Spec fields per kind (the app's validator): pair_plotter {target:[x,y]}; product_builder {X:[…],Y:[…]};
line_drawer {mode:"equation",m,b} or {mode:"points",through:[[x1,y1],[x2,y2]]}; circle_builder {element};
angle_setter {ask:"central"|"inscribed",target}; triangle_ratio {ask:"sin"|"cos"|"tan",target};
bar_builder {ask:"mean"|"median"|"mode"|"range",target,n}; number_line_marker {mode:"points",range:[lo,hi],
targets:[…]} or {mode:"interval",range,from,to,openFrom,openTo}; ratio_balance {mode:"direct"|"inverse",a,b,c};
sample_space {rows,cols,rule:{kind,op,value}}; curve_sketcher {fn:"linear"|"quadratic",coefs:[…]}.`

const AUTHOR_RULES = `RULES:
- A kind must GENUINELY fit: the construction is the mathematics of this objective, not an answer box
  in disguise. If you are stretching, it is a gap. Record it: the kind this lesson would need, one
  paragraph on what the student would construct and what errors it would diagnose.
- Stay inside the instrument's limits (given per kind). A target the instrument cannot reach is a
  question nobody can answer (FR-1207).
- Grade the property, not a position: say in the stem what is asked; any construction with that
  property is correct (FR-1205).
- Diagnostics: map each predicate the construction can plausibly fire to the misconception that
  construction reveals, LIKELIEST ERROR FIRST. A misconception may be on this objective or on one of
  its prerequisites (the list marks own=true for this objective's). Only ids from the list.
- Parent: the objective's anchor book question. Tiers as the book's own exercises.
- NOTATION: decimal point, (x, y). The book's vocabulary. Maths in $…$.
- Every chapter needs at least one widget, but never at the price of a forced fit: an honest gap goes
  to Samuel, a forced widget goes to a student.`

const TEMPLATE_SCHEMA = {
  type: 'object',
  required: ['format', 'id', 'lo_id', 'parent_question_id', 'tier', 'kind', 'spec', 'stem', 'solution', 'diagnostics'],
  properties: {
    format: { type: 'string', enum: ['ainext.widget-template/1'] },
    id: { type: 'string' },
    lo_id: { type: 'string' },
    parent_question_id: { type: 'string' },
    tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
    kind: { type: 'string' },
    instances: { type: 'array', items: { type: 'object' } },
    spec: { type: 'object' },
    stem: { type: 'string' },
    solution: { type: 'array', items: { type: 'string' }, minItems: 1 },
    diagnostics: {
      type: 'array', minItems: 1,
      items: { type: 'object', required: ['predicate', 'misconception_id'], properties: { predicate: { type: 'string' }, misconception_id: { type: 'string' } } },
    },
    notes: { type: 'string' },
  },
}

const AUTHOR_SCHEMA = {
  type: 'object',
  required: ['templates', 'gaps'],
  properties: {
    templates: { type: 'array', items: TEMPLATE_SCHEMA },
    gaps: {
      type: 'array',
      items: {
        type: 'object', required: ['lo_id', 'need_kind', 'description', 'why'],
        properties: {
          lo_id: { type: 'string' },
          need_kind: { type: 'string' },
          description: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    notes: { type: 'string' },
  },
}

const lessonOf = (lo) => lo.replace(/^lo:/, '').replace(/-[0-9]+$/, '')

// By reference `objs` is the lesson's ref row ({module, module_label}, the objectives in its shard).
const authorPrompt = (lesson, objs) => `You are choosing interactive widget questions for one lesson of
${BOOK.title || BOOK.book} (${objs[0].module_label || objs[0].module}).

THE EXISTING WIDGET KINDS — the only ones that exist. Each with its instrument and its predicates:
${REF ? refFile('contract.txt') : clip(ARGS.contract, 9000)}

LESSON ${lesson}, its objectives, anchor book questions and the misconceptions each may name:
${REF ? refFile(`lessons/${lesson}.txt`) : clip(objs, 14000)}

${TEMPLATE_RULES}

${AUTHOR_RULES}

Return AUTHOR_SCHEMA: templates for the objectives an existing kind genuinely fits (usually zero to
two for the lesson), and a gap for each objective where one would help and no kind fits.${readRule()}`

// ---------------------------------------------------------------- verify
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', required: ['widget', 'reading', 'construction', 'reachable', 'predicates'],
        properties: {
          widget: { type: 'string' },
          reading: { type: 'object' },
          construction: { type: 'string' },
          reachable: { type: 'boolean' },
          predicates: {
            type: 'array',
            items: { type: 'object', required: ['predicate', 'matches', 'why'], properties: { predicate: { type: 'string' }, matches: { type: 'boolean' }, why: { type: 'string' } } },
          },
        },
      },
    },
  },
}

// No canonical solution, no stored spec, no template notes: the stem, the instrument, the mappings.
const verifyPrompt = (ws, gi) => `You are checking interactive widget questions you did not write. For each one you get
what the student gets — the question and the instrument — plus the claimed diagnoses.

${REF ? refFile(`t/t${String(gi + 1).padStart(3, '0')}.txt`) : ws.map((w, i) => `WIDGET W${i + 1} (kind ${w.kind})
Question: ${w.stem}
Instrument: ${w.instrument}
Fields to read from the question: ${JSON.stringify(w.reading_fields || {})}
Claimed diagnoses (predicate → misconception):
${w.diagnostics.map((d) => `  - ${d.predicate} ("${d.predicate_meaning}") → ${d.misconception_id}: ${d.misconception_label || '?'} — ${d.misconception_description || ''}`).join('\n')}`).join('\n\n')}

For EACH widget:
0. reading: from the QUESTION'S WORDS ALONE, fill the fields listed for its kind — what the question
   actually asks the student to build (e.g. the values the student must mark). Work it out; do not guess.
1. construction: build a correct answer ON THIS INSTRUMENT, concretely (exact lattice points, the angle,
   the five values, the cells). reachable = true only if you produced one that satisfies every limit.
   If the question is ambiguous or the target cannot be hit, reachable = false and say why.
2. predicates: for each claimed diagnosis, describe the construction that fires the predicate and
   decide whether that construction is what a student holding THAT misconception would build.
   matches = false if the predicate would mostly fire for a different reason, or never for this error.
When in doubt, false: a wrong diagnosis serves a student the refutation of a mistake she did not make.
Return VERIFY_SCHEMA with widget = "W1", "W2", … as labelled.${readRule()}`

// ---------------------------------------------------------------- run
if (ARGS.mode === 'author') {
  const KINDS = REF ? ARGS.contract_kinds : ARGS.contract
  need(KINDS && Object.keys(KINDS).length, 'args.contract is missing — use generate_widget_questions.py --author-args')
  need(REF ? (Array.isArray(ARGS.lesson_refs) && ARGS.lesson_refs.length) : (Array.isArray(ARGS.objectives) && ARGS.objectives.length), 'args.objectives is empty')
  const lessons = []
  const byLesson = new Map()
  let nObjs = 0
  if (REF) {
    for (const l of ARGS.lesson_refs.filter((x) => !ARGS.only_modules || ARGS.only_modules.includes(x.module))) {
      byLesson.set(l.lesson, [l]); lessons.push(l.lesson); nObjs += l.lo_ids.length
    }
  } else {
    const objs = ARGS.objectives.filter((o) => !ARGS.only_modules || ARGS.only_modules.includes(o.module))
    for (const o of objs) {
      const l = lessonOf(o.lo_id)
      if (!byLesson.has(l)) { byLesson.set(l, []); lessons.push(l) }
      byLesson.get(l).push(o)
    }
    nObjs = objs.length
  }
  const loIdsOf = (lesson) => (REF ? byLesson.get(lesson)[0].lo_ids : byLesson.get(lesson).map((o) => o.lo_id))
  log(`${lessons.length} lesson(s), ${nObjs} objective(s), ${Object.keys(KINDS).length} existing kinds` +
    (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))
  const known = new Set(Object.keys(KINDS))
  const records = await pipeline(lessons, (lesson) => agent(authorPrompt(lesson, byLesson.get(lesson)), {
    label: `author:${lesson}`, phase: 'Author', model: 'sonnet', schema: AUTHOR_SCHEMA,
  }))
  const out = []
  const allGaps = []
  records.forEach((r, i) => {
    const lesson = lessons[i]
    const mine = new Set(loIdsOf(lesson))
    if (!r) { log(`${lesson}: no answer — recorded as an unexamined gap`); allGaps.push({ lo_id: [...mine][0], need_kind: 'unexamined', description: '', why: 'author did not return' }); return }
    const templates = []
    const gaps = [...(r.gaps || [])].filter((g) => mine.has(g.lo_id))
    for (const t of r.templates || []) {
      // decision 11: an unknown kind is never a template, whatever the model wrote — it is a gap
      if (!known.has(t.kind)) { gaps.push({ lo_id: t.lo_id, need_kind: t.kind, description: t.stem, why: 'written as a template of a kind that does not exist' }); continue }
      if (!mine.has(t.lo_id)) { log(`${lesson}: dropped a template for ${t.lo_id}, not an objective of this lesson`); continue }
      templates.push(t)
    }
    allGaps.push(...gaps)
    out.push({ lesson, templates, gaps, notes: r.notes || '' })
  })
  const nt = out.reduce((a, r) => a + r.templates.length, 0)
  log(`${nt} template(s) from existing kinds; ${allGaps.length} gap(s) — the gap list goes to Samuel before any new kind is built`)
  return { mode: 'author', book: BOOK.book, prompts_version: PROMPTS_VERSION, ...(REF ? { by_ref: REF } : {}),
    ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), records: out, gaps: allGaps }
}

// verify
need(REF ? (Array.isArray(ARGS.widget_refs) && ARGS.widget_refs.length) : (Array.isArray(ARGS.widgets) && ARGS.widgets.length),
  'args.widgets is empty — use generate_widget_questions.py --verify-args')
const byTemplate = new Map()
if (REF) {
  for (const g of ARGS.widget_refs) byTemplate.set(g.template_id, g.widgets)   // the shard order is this order
} else {
  for (const w of ARGS.widgets) {
    if (!byTemplate.has(w.template_id)) byTemplate.set(w.template_id, [])
    byTemplate.get(w.template_id).push(w)
  }
}
const groups = [...byTemplate.entries()]
const nWidgets = groups.reduce((n, [, ws]) => n + ws.length, 0)
log(`verifying ${nWidgets} widget(s) from ${groups.length} template(s), blind` +
  (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))
const verified = await pipeline(groups, ([tid, ws], _item, gi) => agent(verifyPrompt(ws, gi), {
  label: `verify:${tid}`, phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA,
}))
const results = []
verified.forEach((v, gi) => {
  const ws = groups[gi][1]
  const got = new Map(((v && v.results) || []).map((r) => [String(r.widget || '').trim().toUpperCase(), r]))
  ws.forEach((w, i) => {
    const r = got.get(`W${i + 1}`)
    // ids and shas come from args, never from the model
    results.push(r
      ? { question_id: w.question_id, template_sha: w.template_sha, reading: r.reading || null, construction: r.construction, reachable: r.reachable === true, predicates: r.predicates || [] }
      : { question_id: w.question_id, template_sha: w.template_sha, reading: null, construction: 'NO VERDICT', reachable: false, predicates: [] })
  })
})
const bad = results.filter((r) => !r.reachable || r.predicates.some((p) => p.matches !== true)).length
log(`${results.length - bad}/${results.length} widget(s) reachable with every mapping confirmed; the rest are refused by generate_widget_questions.py`)
return { mode: 'verify', book: BOOK.book, prompts_version: PROMPTS_VERSION, ...(REF ? { by_ref: REF } : {}),
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), results }

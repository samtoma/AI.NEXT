export const meta = {
  name: 'widgets-book',
  description: 'S7 variant (book widgets, Tamer 2026-10-21): the book\'s own construction exercises put on an existing widget kind, with method hints for the errors no misconception names (mode author); the blind verifier, which also judges each hint (mode verify)',
  whenToUse: 'book_widgets.py author / verify. Samuel\'s runbook/widgets.workflow.js is untouched and stays the S7 default; this runs only when named.',
  phases: [
    { title: 'Author', detail: 'per lesson: each book exercise an existing kind genuinely fits becomes a template, its parent the book item, its key the book\'s; hints grounded in a solution step (Sonnet)', model: 'sonnet' },
    { title: 'Verify', detail: 'blind, as Samuel\'s S7 verifier: read the stem, construct an answer, judge each mapping — and each method hint (Sonnet)', model: 'sonnet' },
  ],
}

/*
 * BOOK WIDGETS — a variant of S7 (runbook/widgets.workflow.js, ADR-0009), built beside it the way
 * links-cross.workflow.js was built beside links.workflow.js: the original is untouched and stays the default.
 *
 * WHAT IS DIFFERENT. Samuel's S7 starts from a MISCONCEPTION and asks which kind would reveal it, so an
 * objective with no misconception gets no widget, and a predicate no misconception names says nothing but
 * "not quite". Tamer, 2026-10-21 ("let's try 1+2 for unit 1"):
 *   1. start from the BOOK'S OWN CONSTRUCTION EXERCISES ("Represent graphically f(x) = x + 2", "Find X × Y"):
 *      where an existing kind is that exercise's mathematics, the exercise becomes a widget question — its
 *      stem the book's words, its key the book's (or read off the stem, never solved by a model's guess),
 *      its parent the book item (the part's own question row, else the objective's worked example,
 *      parent_kind "teaching", migration 038);
 *   2. METHOD HINTS: for a predicate this question can emit that no misconception names, a one- or
 *      two-sentence hint taken from one step of the canonical solution (grounded, constitution III), which
 *      points at the method and never gives the answer. The app shows it only when no misconception was
 *      diagnosed.
 * WHAT IS THE SAME. The kinds are the existing ones (decision 11: a missing kind is a GAP for Samuel); every
 * template goes through generate_widget_questions.py's checks and Samuel's blind verifier prompt, word for
 * word, plus one step that judges the hints; a mapping OR a hint the verifier does not confirm is HELD for a
 * human (decision 47) — never shown — and a template whose stem does not read as its spec, or whose target
 * cannot be reached, is rejected.
 *
 * ARGS
 *   author: { mode, book, contract: {kind: {predicates, can_emit, instrument}},
 *             lessons: [{lesson, module_label, objectives: [{lo_id, label, description,
 *               misconceptions: [{id, lo_id, label, description, own}],
 *               worked_examples: [{id, problem, steps: [..]}],
 *               exercises: [{item, type, page, text, parts: [{part, stem, book_answer?, parent, parent_kind}]}]}]}] }
 *   verify: generate_widget_questions.py --verify-args (inline), whose widgets may carry `hints`
 *           [{predicate, predicate_meaning, text}] (`spec` is in args for the record; never in a prompt)
 * RETURNS
 *   author: { mode, book, records: [{lesson, templates, gaps}], gaps } — the shape of widgets.workflow.js's
 *   verify: { mode, book, results: [{question_id, template_sha, reading, construction, reachable,
 *             predicates: [{predicate, matches, why}], hints: [{predicate, ok, why}]}] }
 */

const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const PROMPTS_VERSION = 's7b-v3'   // v2: the grid option and the new modes (several points, relation, system); v3: arrow_builder, region_shader
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
need(ARGS.mode === 'author' || ARGS.mode === 'verify', 'args.mode must be "author" or "verify"')
need(ARGS.book && ARGS.book.book, 'args.book must be the book config')
const BOOK = ARGS.book
const FIGURE_RULE = 'A widget question you write must never point at a [figure] or "the previous graph": its instrument is all the student sees.'

// ---------------------------------------------------------------- author
const TEMPLATE_RULES = `A BOOK WIDGET TEMPLATE (format "ainext.widget-template/1"):
{
  "format": "ainext.widget-template/1",
  "id": "wt:<objective tail>:<slug>",                 e.g. wt:pp3u1-4-3:drill-4-1
  "lo_id": "<the exercise's objective>",
  "book_item": "<the exercise item>#<part>",           e.g. "pp3u1-4:drill-4#1" (no #part for an item with no parts)
  "parent_question_id": "<the part's parent, COPIED from the list>",
  "parent_kind": "question" | "teaching",              COPIED from the list with the parent
  "tier": "basic" | "standard" | "advanced",
  "kind": "<an EXISTING kind from the contract>",
  "spec": {… the kind's fields, plain values (no {=…} holes) …},
  "stem": "the book's own words for this part, made to stand alone, e.g. Represent graphically the function $f(x) = x + 2$.",
  "solution": ["step", …],                             the method, one idea per step, from the objective's worked example
  "diagnostics": [{"predicate": "…", "misconception_id": "mc:…"}],   may be EMPTY
  "hints": [{"predicate": "…", "step": <n>, "text": "…"}],            may be empty only when diagnostics is not
  "notes": "…"
}
No "instances": one template per exercise part.
Spec fields per kind (the app's validator): pair_plotter {target:[x,y]} or {targets:[[x,y],…],join?} (2–8 points,
graded as a set; join draws the polygon through them, a frequency polygon); product_builder {X:[…],Y:[…]} or
{mode:"relation",X,Y,pairs:[[a,b],…]} (a subset of X×Y the stem's rule gives — the stem states the rule, never the
pairs); line_drawer {mode:"equation",m,b} or {mode:"points",through:[[x1,y1],[x2,y2]]} or
{mode:"system",lines:[{m,b},{m,b}]} (two lines on one board: "find the solution set graphically"); circle_builder {element};
angle_setter {ask:"central"|"inscribed",target}; triangle_ratio {ask:"sin"|"cos"|"tan",target};
bar_builder {ask:"mean"|"median"|"mode"|"range",target,n}; number_line_marker {mode:"points",range:[lo,hi],
targets:[…]} or {mode:"interval",range,from,to,openFrom,openTo}; ratio_balance {mode:"direct"|"inverse",a,b,c};
sample_space {rows,cols,rule:{kind,op,value}}; curve_sketcher {fn:"linear"|"quadratic"|"hyperbola"|
"exponential"|"sine"|"cosine"|"tangent",coefs:[…]}; polygon_builder {mode:"construct",shape} or
{mode:"midsegment",triangle:[[x,y],[x,y],[x,y]],apex} or {mode:"area",shape:"triangle"|"quadrilateral",target};
solid_scaler {solid,ask:"volume"|"area",ratio,dims?}; box_plot_builder {data:[…]};
venn_builder {sets,labels:[…],mode:"shade",target} or {sets,labels,mode:"counts",regions:{…},total?,clues?};
area_model {mode:"expand"|"factor",a,b}; arrow_builder {X:[…],Y:[…],pairs:[[a,b],…]} (the student DRAWS the
relation's arrows; X and Y numbers or short words, the stem gives the rule or the pairs);
region_shader {x:[lo,hi],y:[lo,hi],open?:{left,right,bottom,top},grid?} (the student marks X × Y for two
intervals, each edge included or excluded — "the location which represents X × X").
THE GRID: pair_plotter, line_drawer and curve_sketcher (linear, quadratic) take an optional
"grid":{"x":[lo,hi],"y":[lo,hi],"step":s or [sx,sy]} — use it whenever the book's numbers are off the default −5..5
whole-step board: a half (step 0.5), a point or line past ±5, an interval the book names ([−1, 5]), axes counting
in fives. The ends of each range sit on its step; at most 16 steps an axis. Keep the book's numbers: a grid that
fits them, never numbers that fit the grid.`

const AUTHOR_RULES = `RULES:
- START FROM THE BOOK'S EXERCISES, not from a misconception. For each exercise part decide: is building the
  answer on one existing kind EXACTLY what the part asks the student to do? ("Represent graphically
  f(x) = x + 2" on line_drawer: yes. "Find X × Y" on product_builder: yes. "Identify the quadrant of A": no —
  that is a reading, not a construction.) If you are stretching, it is not a widget: record a gap.
- Stay inside the instrument's limits (given per kind). Where the book's numbers are off the default board, give
  the widget a GRID that holds them (see THE GRID). A part no grid can reach is a GAP with that reason — never
  change the book's numbers.
- THE KEY. Where a part has "book_answer", the spec must agree with it exactly. Otherwise the spec is read off
  the stem itself (f(x) = 3x is m = 3, b = 0). Never a value you had to guess.
- Grade the property, not a position (FR-1205): in line_drawer "equation" mode any two points on the line are
  right, which is what "represent graphically" asks; use "points" mode only when the part names two points.
- STEM: the book's own words and notation for that part, made to stand alone (bring in the sets or the rule
  the exercise's heading gives), plus one short instruction for the instrument ("Drag the two points so the
  line is the graph."). Maths in $…$, (x, y) for pairs, decimal point.
- SOLUTION: the method the objective's worked example teaches, applied to THIS part — one idea per step,
  concrete numbers. This is the canonical solution the student is shown, so it must be right.
- DIAGNOSTICS (as in S7): map a predicate THIS spec can emit (the kind's can_emit, for your spec's mode / ask /
  element / fn) to a misconception from THAT OBJECTIVE'S OWN list only where the construction that fires it IS
  that misconception. One predicate, one misconception. None is fine.
- HINTS — for the predicates this spec can emit that no diagnostic names, where a method reminder would help:
  { "predicate", "step": the number of the solution step the hint is taken from, "text" }. The text:
    * points at the METHOD of that step (what to check, which value to substitute, which set comes first),
      in one or two sentences, in the book's vocabulary;
    * NEVER gives the answer: no target coordinates, no final equation, no list of the pairs, no "the answer is";
    * is about the construction that fires its predicate (line_drawer's intercept-wrong: the line is parallel to
      the right one but at the wrong height — so the hint is about where the line meets the y-axis);
    * is never a misconception in disguise ("you think …"): it names no error, only the step.
  Skip a predicate where no step of the method would help (a hint for nothing is noise). off-target may take a
  general method hint from the first step.
- Tiers as the book's own: drills basic, worked-example-like standard.
- Every template needs at least one diagnostic or one hint: a widget that cannot say why is not shipped.`

const TEMPLATE_SCHEMA = {
  type: 'object',
  required: ['format', 'id', 'lo_id', 'book_item', 'parent_question_id', 'parent_kind', 'tier', 'kind', 'spec', 'stem', 'solution', 'diagnostics', 'hints'],
  properties: {
    format: { type: 'string', enum: ['ainext.widget-template/1'] },
    id: { type: 'string' },
    lo_id: { type: 'string' },
    book_item: { type: 'string' },
    parent_question_id: { type: 'string' },
    parent_kind: { type: 'string', enum: ['question', 'teaching'] },
    tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
    kind: { type: 'string' },
    spec: { type: 'object' },
    stem: { type: 'string' },
    solution: { type: 'array', items: { type: 'string' }, minItems: 1 },
    diagnostics: {
      type: 'array',
      items: { type: 'object', required: ['predicate', 'misconception_id'], properties: { predicate: { type: 'string' }, misconception_id: { type: 'string' } } },
    },
    hints: {
      type: 'array',
      items: { type: 'object', required: ['predicate', 'step', 'text'], properties: { predicate: { type: 'string' }, step: { type: 'integer' }, text: { type: 'string' } } },
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
        properties: { lo_id: { type: 'string' }, need_kind: { type: 'string' }, description: { type: 'string' }, why: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

const authorPrompt = (L) => `You are turning the book's own construction exercises into interactive widget questions, for one
lesson of ${BOOK.title || BOOK.book} (${L.module_label || ''}).

THE EXISTING WIDGET KINDS — the only ones that exist. Each with its instrument, its predicates and what
each spec can emit:
${JSON.stringify(ARGS.contract, null, 1)}

LESSON ${L.lesson}: its objectives, each with its misconceptions (own=true: the objective's own), its worked
examples (the method to ground every solution and hint in) and its book exercises (each part with the
parent you must copy, and the book's answer where the book or its checked key has one):
${JSON.stringify(L.objectives, null, 1)}

${TEMPLATE_RULES}

${AUTHOR_RULES}

${FIGURE_RULE}

Return AUTHOR_SCHEMA: a template for each exercise part an existing kind genuinely fits, and a gap for each
construction exercise (or part) none fits, saying why. Exercises that are not constructions need no gap.`

// ---------------------------------------------------------------- verify
// Samuel's verifier (widgets.workflow.js s7-v7), word for word, with the claimed hints and step 3 added.
const VERIFY_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object', required: ['widget', 'reading', 'construction', 'reachable', 'predicates', 'hints'],
        properties: {
          widget: { type: 'string' },
          reading: { type: 'object' },
          construction: { type: 'string' },
          reachable: { type: 'boolean' },
          predicates: {
            type: 'array',
            items: { type: 'object', required: ['predicate', 'matches', 'why'], properties: { predicate: { type: 'string' }, matches: { type: 'boolean' }, why: { type: 'string' } } },
          },
          hints: {
            type: 'array',
            items: { type: 'object', required: ['predicate', 'ok', 'why'], properties: { predicate: { type: 'string' }, ok: { type: 'boolean' }, why: { type: 'string' } } },
          },
        },
      },
    },
  },
}

const verifyPrompt = (ws) => `You are checking interactive widget questions you did not write. For each one you get
what the student gets — the question and the instrument — plus the claimed diagnoses.

${ws.map((w, i) => `WIDGET W${i + 1} (kind ${w.kind})
Question: ${w.stem}
Instrument: ${w.instrument}
Fields to read from the question: ${JSON.stringify(w.reading_fields || {})}
What this kind can emit, per its spec field: ${JSON.stringify(w.can_emit || null)}
Claimed diagnoses (predicate → misconception):
${w.diagnostics.length ? w.diagnostics.map((d) => `  - ${d.predicate} ("${d.predicate_meaning}") → ${d.misconception_id}: ${d.misconception_label || '?'} — ${d.misconception_description || ''}`).join('\n') : '  (none)'}
Claimed method hints (predicate → the hint the student is shown when that predicate fires):
${(w.hints || []).length ? w.hints.map((h) => `  - ${h.predicate} ("${h.predicate_meaning}") → "${h.text}"`).join('\n') : '  (none)'}`).join('\n\n')}

For EACH widget:
0. reading: from the QUESTION'S WORDS ALONE, fill the fields listed for its kind — what the question
   actually asks the student to build (e.g. the values the student must mark). Work it out; do not guess.
   Write each field as a JSON VALUE, never as text: numbers as numbers (-0.5, not "-1/2"), a point as
   [x, y], a list as a list, true/false as booleans — and no words inside a value.
1. construction: build a correct answer ON THIS INSTRUMENT, concretely (exact lattice points, the angle,
   the five values, the cells). reachable = true only if you produced one that satisfies every limit.
   If the question is ambiguous or the target cannot be hit, reachable = false and say why.
2. predicates: for each claimed diagnosis, describe the construction that fires the predicate and
   decide whether that construction is what a student holding THAT misconception would build.
   "predicate" is the predicate's NAME exactly as listed (e.g. slope-inverted) — nothing else.
   matches = false if the predicate would mostly fire for a different reason, or never for this error —
   and always false for a predicate the kind's can_emit table does not list for what THIS question asks
   (its mode, ask, element or fn, which you read from the question's words): it never fires.
3. hints: for each claimed method hint, describe a construction that fires its predicate on THIS question,
   then decide ok. ok = true only if ALL hold:
   - the hint is mathematically right for this question;
   - it helps the student who built that construction find the step they got wrong;
   - it does NOT give the answer away: no target coordinates, no final equation or rule, no list of the
     answer's pairs — a student must still do the step;
   - its predicate can fire for what this question asks (the can_emit table, as in 2).
   "predicate" is the predicate's NAME exactly as listed. Return one entry per claimed hint (none if none).
When in doubt, false: a wrong diagnosis serves a student the refutation of a mistake she did not make, and
a hint that gives the answer away teaches nothing.
Return VERIFY_SCHEMA with widget = "W1", "W2", … as labelled.`

// ---------------------------------------------------------------- run
if (ARGS.mode === 'author') {
  need(ARGS.contract && Object.keys(ARGS.contract).length, 'args.contract is missing — use book_widgets.py author')
  need(Array.isArray(ARGS.lessons) && ARGS.lessons.length, 'args.lessons is empty')
  const known = new Set(Object.keys(ARGS.contract))
  log(`${ARGS.lessons.length} lesson(s), ${ARGS.lessons.reduce((n, l) => n + l.objectives.reduce((m, o) => m + o.exercises.length, 0), 0)} book exercise(s)`)
  const records = await pipeline(ARGS.lessons, (L) => agent(authorPrompt(L), {
    label: `author:${L.lesson}`, phase: 'Author', model: 'sonnet', schema: AUTHOR_SCHEMA,
  }))
  const out = []
  const allGaps = []
  records.forEach((r, i) => {
    const L = ARGS.lessons[i]
    const mine = new Set(L.objectives.map((o) => o.lo_id))
    if (!r) { log(`${L.lesson}: no answer — recorded as an unexamined gap`); allGaps.push({ lo_id: L.objectives[0].lo_id, need_kind: 'unexamined', description: '', why: 'author did not return' }); return }
    const templates = []
    const gaps = [...(r.gaps || [])].filter((g) => mine.has(g.lo_id))
    for (const t of r.templates || []) {
      if (!known.has(t.kind)) { gaps.push({ lo_id: t.lo_id, need_kind: t.kind, description: t.stem, why: 'written as a template of a kind that does not exist' }); continue }
      if (!mine.has(t.lo_id)) { log(`${L.lesson}: dropped a template for ${t.lo_id}, not an objective of this lesson`); continue }
      if (!(t.hints || []).length) delete t.hints   // a template with none is Samuel's shape exactly
      templates.push(t)
    }
    allGaps.push(...gaps)
    out.push({ lesson: L.lesson, templates, gaps, notes: r.notes || '' })
  })
  log(`${out.reduce((a, r) => a + r.templates.length, 0)} book widget template(s); ${allGaps.length} gap(s)`)
  return { mode: 'author', book: BOOK.book, prompts_version: PROMPTS_VERSION,
    ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), records: out, gaps: allGaps }
}

need(Array.isArray(ARGS.widgets) && ARGS.widgets.length, 'args.widgets is empty — use book_widgets.py verify')
const byTemplate = new Map()
for (const w of ARGS.widgets) {
  if (!byTemplate.has(w.template_id)) byTemplate.set(w.template_id, [])
  byTemplate.get(w.template_id).push(w)
}
const groups = [...byTemplate.entries()]
log(`verifying ${ARGS.widgets.length} widget(s) from ${groups.length} template(s), blind`)
const verified = await pipeline(groups, ([tid, ws]) => agent(verifyPrompt(ws), {
  label: `verify:${tid}`, phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA,
}))
const results = []
verified.forEach((v, gi) => {
  const ws = groups[gi][1]
  const got = new Map(((v && v.results) || []).map((r) => [String(r.widget || '').trim().toUpperCase(), r]))
  ws.forEach((w, i) => {
    const r = got.get(`W${i + 1}`)
    results.push(r
      ? { question_id: w.question_id, template_sha: w.template_sha, reading: r.reading || null, construction: r.construction, reachable: r.reachable === true, predicates: r.predicates || [], hints: r.hints || [] }
      : { question_id: w.question_id, template_sha: w.template_sha, reading: null, construction: 'NO VERDICT', reachable: false, predicates: [], hints: [] })
  })
})
const bad = results.filter((r) => !r.reachable || r.predicates.some((p) => p.matches !== true) || r.hints.some((h) => h.ok !== true)).length
log(`${results.length - bad}/${results.length} widget(s) reachable with every mapping and hint confirmed; the rest are held or refused by generate_widget_questions.py`)
return { mode: 'verify', book: BOOK.book, prompts_version: PROMPTS_VERSION,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), results }

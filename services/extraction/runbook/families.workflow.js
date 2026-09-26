export const meta = {
  name: 'families',
  description: 'S6 (B12): declarative question families per objective (mode author), and a blind instance grader (mode grade) — decision 16',
  whenToUse: 'mode "author" after S5 draft, with the tier-gap list from generate_questions.py --author-args [--by-ref]; mode "grade" with generate_questions.py --grading-set … --grade-args [--by-ref].',
  phases: [
    { title: 'Author', detail: 'per objective: declarative family specs for the missing tiers, or authored one-offs where a family would be nonsense (Sonnet)', model: 'sonnet' },
    { title: 'Solve', detail: 'blind: a different agent solves the sampled instances seeing only the stem and the options (Sonnet)', model: 'sonnet' },
    { title: 'Judge', detail: 'a third agent checks each distractor is the error it names, the key form, the context and the worked steps (Sonnet)', model: 'sonnet' },
  ],
}

/*
 * S6 — GENERATED QUESTION FAMILIES (docs/specs/extraction-pipeline.md §3.9, B12;
 * spec 003 FR-4304, FR-4305; spec 001 FR-1101…FR-1109; ADR-0008; decision 16).
 *
 * A FAMILY IS DATA. The author writes a declarative spec (services/extraction/
 * families/__init__.py documents the format). generate_questions.py instantiates
 * it with a safe evaluator — no model-written code is ever executed — and computes
 * every answer key from the same parameters that write the stem, so the key cannot
 * disagree with the question.
 *
 * THE LOOP (the operator runs the Python steps; this script never touches files):
 *   1. uv run generate_questions.py --families families/<book> --book <book> \
 *          --catalogue <S5 draft or catalogue> --author-args A.json [--by-ref]
 *   2. this workflow, args = A.json (mode "author")  → save the return value to
 *      runs/<book>/families/author-<runId>.json; write each returned spec to
 *      families/<book>/<lo tail>--<slug>.json
 *   3. uv run generate_questions.py --families families/<book> --book <book> --check
 *      (a failing spec goes back through this workflow with args.revise)
 *   4. uv run generate_questions.py … --grading-set runs/<book>/families/grading-set.json \
 *          --grade-args G.json [--by-ref]
 *   5. this workflow, args = G.json (mode "grade"; by ref, possibly in parts G.part1.json …)
 *      → save to runs/<book>/families/grade-<runId>.json
 *   6. uv run generate_questions.py … --catalogue <final catalogue> \
 *          --grades runs/<book>/families/grade-*.json --out seed/generated/<book>/generated-questions.json
 *   7. uv run meter_run.py record --book <book> --stage S6 --run <wf_id>
 *
 * BLIND MEANS BLIND. In grade mode the solver's prompt is built ONLY from each
 * instance's `blind` block (stem, options, answer format). The key, the worked
 * solution, the misconception tags and the family's other instances never reach
 * it. The comparison is not the model's either: this script returns the answers,
 * and generate_questions.py compares them with the computed keys deterministically.
 * One disagreement rejects the whole family (ADR-0008: reading one instance
 * validates the family, so one wrong instance condemns it).
 *
 * ARGS
 *   mode "author": the output of `generate_questions.py --author-args`:
 *     { mode, book: <book config>, objectives: [{lo_id, label, description, module, lesson,
 *       tier_gaps: ["basic"|"standard"|"advanced"], existing_families: [ids],
 *       book_questions: [{id, tier, type, stem, choices, answer, solution, source_page}],
 *       misconceptions: [{id, label, description}]}],
 *       revise?: [{spec, problems: [string], figures?: [image path]}],   // re-author these specs only;
 *                                                   // figures: the parent question's, the only files it may open
 *       only?: ["lo:…"] }
 *   mode "grade": { mode, book, grading_set: <generate_questions.py --grading-set output> }
 *     (generate_questions.py --grade-args writes exactly this)
 *
 * PACKET BY REFERENCE (--author-args … --by-ref, --grade-args … --by-ref; packet_ref.py). The args
 * carry `by_ref` {dir, stage, shards_sha256, files} and, instead of the big blocks, what this
 * script's control flow reads; the prompts show [[file: <path>]] where the text used to be:
 *   author: `objective_refs` [{lo_id, label, description, module, lesson, tier_gaps,
 *           existing_families}] instead of `objectives`; per objective the shards
 *           o/<tail>.book-questions.txt and o/<tail>.misconceptions.txt (the JSON the prompt carries
 *           inline, WHOLE: inline clips it at 12000 and 4000 characters, by reference nothing is cut).
 *   grade:  `grading_ref` {format, families: [{f: family_id, s: spec_sha, i: [[instance_id, stem_sha,
 *           fmt]]}]} instead of `grading_set`, fmt being the options [[key, text], …] (a choice), "n"
 *           (a number) or the blind answer_format (anything else); per family n the solver's shards
 *           solve/f<n>-q<i>.txt (an instance's STEM, nothing else) and the judge's judge/f<n>.txt (the
 *           "Family … on …" line and {id, stem, ...sealed} per instance, whole: inline clips each at 5000
 *           characters). Blind stays blind: the
 *           solver's prompt names only its stems, and nothing sealed is in them. A chapter too big for
 *           one call is split into PARTS (--grade-args writes <out>.part1.json …, each run on its own):
 *           `grading_ref.offset` numbers a part's families in the shared shard directory.
 *
 * RETURNS
 *   author: { mode, book, records: [{lo_id, families: [spec], infeasible: [{tier, reason}],
 *             notes}], revised: [spec] }
 *   grade:  { mode, book, results: [{family_id, spec_sha, answers: [{instance_id, stem_sha,
 *             answer: {value|choice_text|plain}, working}], judge: {distractors_ok, key_form_ok,
 *             context_ok, solution_ok, notes, distractors: [...]}}] }
 */

const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const PROMPTS_VERSION = 's6-v5'   // v2: packet by reference; v3: by-ref shards unclipped; v4: book questions name their figure images
                                  // v5: revise mode names its inputs: the spec, the reasons and the parent's figure images only;
                                  //     the blind solver writes values without names (it wrote "x = [0, 8]", "H = (3, 1)")
const need = (cond, msg) => { if (!cond) throw new Error(msg) }
need(ARGS.mode === 'author' || ARGS.mode === 'grade', 'args.mode must be "author" or "grade" (see the header of this script)')
need(ARGS.book && ARGS.book.book, 'args.book must be the book config (generate_questions.py --author-args writes it)')
const BOOK = ARGS.book
const NOTATION = BOOK.notation || { decimal: 'point', pair_separator: 'comma' }

// ---- packet by reference ------------------------------------------------------------------------
const REF = ARGS.by_ref || null
need(!REF || (typeof REF.dir === 'string' && REF.dir.startsWith('/') && REF.shards_sha256),
  'args.by_ref must name the absolute shard directory and its shards_sha256')
if (ARGS.mode === 'author' && !(ARGS.revise && ARGS.revise.length)) {
  need(!(ARGS.objectives && (REF || ARGS.objective_refs)), 'give args.objectives (inline) or args.by_ref with args.objective_refs (by reference), not both')
  need(!!REF === !!ARGS.objective_refs, 'by reference needs both args.by_ref and args.objective_refs (`--author-args … --by-ref` writes them)')
}
if (ARGS.mode === 'grade') {
  need(!(ARGS.grading_set && (REF || ARGS.grading_ref)), 'give args.grading_set (inline) or args.by_ref with args.grading_ref (by reference), not both')
  need(!!REF === !!ARGS.grading_ref, 'by reference needs both args.by_ref and args.grading_ref (`--grade-args … --by-ref` writes them)')
}
const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const refFile = (name) => `[[file: ${REF.dir}/${name}]]`
const readRule = () => (REF ? `\n\n${READ_RULE}` : '')
// s6-v4: a book question whose stem shows [figure] names its image files ("figures"); the author may open them
const FIGURE_RULE = 'Some book questions list "figures": the image files of the diagrams their stems show as [figure]. Read the figure images of the questions you build on, with the Read tool, so a family never rests on a diagram you have not seen; you may open those image files as well.'
const figureRule = (o) => ((REF ? (o.figures || 0) : (o.book_questions || []).reduce((n, q) => n + ((q.figures || []).length), 0)) ? `\n\n${FIGURE_RULE}` : '')
const loTailOf = (lo) => String(lo).replace(/^lo:/, '')

// ---------------------------------------------------------------- author
const FORMAT_RULES = `THE FAMILY SPEC (format "ainext.family/1"). One JSON object per family:
{
  "format": "ainext.family/1",
  "id": "tpl:<objective tail>:<slug>",        e.g. tpl:g10m4s2-1-1:balance (lower case, digits, hyphens)
  "kind": "family" | "authored",              authored = a one-off with no sampled params
  "lo_id": "<the objective>",
  "parent_question_id": "<a book question OF THIS objective, from the list given>",
  "source_page": <printed page of that book question>,
  "tier": "basic" | "standard" | "advanced",
  "answer_type": "numeric" | "mcq" | "expression",
  "context": null | "<the word problem's fixed situation, in words>",
  "params": [ drawn IN ORDER; each is ONE of:
     {"name": "a", "randint": [low, high]}              bounds may be expressions: [1, "b - 1"]
     {"name": "k", "choice": [2, 3, 5]}                 or an expression producing a list
     {"name": "v", "sample": {"from": "range(1, 20)", "k": 4}}
     {"name": "s", "shuffle": "some_list"}
     {"name": "c", "let": "a * k + 1"}                  computed, no randomness
     {"require": "c != 0", "why": "…"}                  false → this attempt is thrown away
     any randint/choice may add "resample_while": "b == a" ],
  "constraints": ["gcd(a, b) == 1"],                   checked after all params
  "stem": "template",
  "answer": "expression",                              numeric only: a whole number, or a string you format
  "solution": ["template", …],                          one idea per step, computed like the stem
  "choices": {"correct": "template", "distractors": [   mcq only; at least three
       {"text": "template", "misconception_id": "mc:<objective tail>:<slug>" | null}, …]},
  "marker": {"kind": "expression"|"equation"|"values"|"interval"|"coordinates"|"surd"|"recurring",
             "answer": "PLAIN maths template, e.g. (x + {=p})*(x - {=q})",
             "form": null|"factorised"|"expanded"|"simplest"|{"subject": "x"},
             "variables": ["x"], "tolerance": null},    expression only
  "proposed_misconceptions": [{"id": "mc:<objective tail>:<slug>", "label": "…", "description": "…"}],
  "notes": "for the human reviewer"
}
TEMPLATES interpolate {=expression}. A number renders the book's way (no trailing .0; a fraction as
\\frac with the minus outside). LaTeX braces are yours: \\frac{{=b}}{2} is the fraction b over 2.
Never put a brace inside a {=…} hole — put a table in a "let" param instead.
EXPRESSIONS are a small safe language: + - * / // % **, comparisons, and/or/not, x if c else y,
lists, dicts, indexing, [f(v) for v in xs if …]. Division of whole numbers is EXACT (7/2 is a fraction).
Functions: num paren signed linear quadratic pair setof frac fixed Fraction int float str abs min max
round sqrt isqrt is_square gcd lcm floor ceil numerator denominator is_int sum len sorted unique range
list reversed; constant pi. Nothing else exists: no attributes, no imports, no other calls.
A NUMERIC answer that is not a whole number must be formatted by you, e.g. fixed(x, 2); say in the
stem how to round. A PLAIN marker answer uses * for multiplication, ** or ^ for powers, sqrt(),
[a, b] for several values, (a, b) for coordinates, interval(lo, hi, closed_lo, closed_hi).`

const AUTHOR_RULES = `RULES (the instances reach students after only a sampled review, ADR-0008 / ADR-0019):
- Stay inside THIS objective and the book's own method, vocabulary and notation. The book questions
  and their solutions are your model; never teach a technique they do not use.
- One family = one solution skeleton. Only the numbers change. The worked solution is computed from
  the same parameters, so every instance's steps are true for that instance.
- Choose parameters so every instance is clean: no division by zero, no answer the book would not
  print, no negative lengths or prices, no huge numbers. Use constraints and require for this.
- WORD PROBLEMS: the context is FIXED — write it once, set "context", and vary only numbers. Keep the
  book's contexts as printed (the Rand stays the Rand). If no family can be written without nonsense,
  write kind "authored" one-offs instead (no sampled params) — each will be solved blind too.
- ANSWER TYPE: "numeric" for a number; "expression" (with marker) for an algebraic expression, an
  equation, several values, an interval, coordinates, a surd or a recurring decimal; "mcq" ONLY where
  a choice is natural (a classification, a comparison) or where every distractor is a specific,
  diagnosable error. Never use mcq to dodge typing.
- DISTRACTORS name an error of THIS objective: an id from the list given, or a new id you declare in
  proposed_misconceptions (mc:<objective tail>:<slug>, with label and description). A plausible wrong
  option with no named error takes misconception_id null. The correct option never has one.
- TIERS: basic = the entry point of the skill, standard = the book's typical exercise, advanced = the
  book's harder exercises (several steps, or a twist the book itself uses). Fill the listed gaps first.
- NOTATION (decision 15): decimal POINT, coordinates as (x, y) with a comma, maths in $…$.
- If a gap cannot be filled honestly, say so in "infeasible". Fewer families is correct; padding is not.`

const SPEC_SCHEMA = {
  type: 'object',
  required: ['format', 'id', 'kind', 'lo_id', 'parent_question_id', 'tier', 'answer_type', 'params', 'stem', 'solution'],
  properties: {
    format: { type: 'string', enum: ['ainext.family/1'] },
    id: { type: 'string' },
    kind: { type: 'string', enum: ['family', 'authored'] },
    lo_id: { type: 'string' },
    parent_question_id: { type: 'string' },
    source_page: { type: ['integer', 'null'] },
    tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
    answer_type: { type: 'string', enum: ['numeric', 'mcq', 'expression'] },
    context: { type: ['string', 'null'] },
    params: { type: 'array', items: { type: 'object' } },
    constraints: { type: 'array', items: { type: 'string' } },
    stem: { type: 'string' },
    answer: { type: 'string' },
    solution: { type: 'array', items: { type: 'string' }, minItems: 1 },
    choices: { type: 'object' },
    marker: { type: 'object' },
    proposed_misconceptions: { type: 'array', items: { type: 'object' } },
    notes: { type: 'string' },
    version: { type: 'integer' },
  },
}

const AUTHOR_SCHEMA = {
  type: 'object',
  required: ['lo_id', 'families', 'infeasible'],
  properties: {
    lo_id: { type: 'string' },
    families: { type: 'array', items: SPEC_SCHEMA },
    infeasible: {
      type: 'array',
      items: { type: 'object', required: ['tier', 'reason'], properties: { tier: { type: 'string' }, reason: { type: 'string' } } },
    },
    notes: { type: 'string' },
  },
}

const REVISE_SCHEMA = {
  type: 'object',
  required: ['spec', 'changes'],
  properties: { spec: SPEC_SCHEMA, changes: { type: 'string' } },
}

const clip = (v, n) => JSON.stringify(v, null, 1).slice(0, n)

const authorPrompt = (o) => `You are writing generated question families for one learning objective of
${BOOK.title || BOOK.book}. Every instance a family produces may reach a student after only a sampled
human review, and a different agent will solve three instances blind: one disagreement rejects the family.

OBJECTIVE ${o.lo_id} (lesson ${o.lesson}, ${o.module}): "${o.label}"
${o.description ? `Description: ${o.description}` : ''}
Tier gaps to fill first: ${o.tier_gaps && o.tier_gaps.length ? o.tier_gaps.join(', ') : '(none — add only what adds real variety)'}
Families that already exist here: ${(o.existing_families || []).join(', ') || '(none)'}

BOOK QUESTIONS of this objective, with the book's canonical solutions (your model and your parents):
${REF ? refFile(`o/${loTailOf(o.lo_id)}.book-questions.txt`) : clip(o.book_questions || [], 12000)}

MISCONCEPTIONS already catalogued for this objective (use these ids on distractors):
${REF ? refFile(`o/${loTailOf(o.lo_id)}.misconceptions.txt`) : clip(o.misconceptions || [], 4000)}

${FORMAT_RULES}

${AUTHOR_RULES}

Return AUTHOR_SCHEMA with lo_id="${o.lo_id}": the families (usually one per missing tier, at most four in all),
and "infeasible" for any gap you could not fill honestly, with the reason.${readRule()}${figureRule(o)}`

// s6-v5: a revise agent works from its message alone. In the pilot one opened the pipeline's source and tests
// to reason about the refusal; the only files it may open are the parent question's figure images, if any.
const REVISE_READ_RULE = 'Work from this message alone: the spec and the reasons above are your only inputs. Do not open any file — not the pipeline\'s source code or tests, not other specs, not earlier runs.'
const reviseReadRule = (r) => `\n\n${REVISE_READ_RULE}` + ((r.figures || []).length
  ? ` The one exception: the image files of the diagrams this family's parent book question shows, which you may read with the Read tool: ${r.figures.join(', ')}.`
  : '')

const revisePrompt = (r) => `A family spec you (or a colleague) wrote was refused. Fix it.

THE SPEC:
${clip(r.spec, 12000)}

WHY IT WAS REFUSED (deterministic checks, or a blind grader's disagreement):
${(r.problems || []).map((p) => `- ${p}`).join('\n')}

${FORMAT_RULES}

${AUTHOR_RULES}

If the refusal was a blind-grader disagreement, first decide who was right by working one instance
yourself. If the family is wrong, fix its mathematics; if the question was ambiguous, fix its wording.
Increase "version" by one (start at 2). Keep the id. Return REVISE_SCHEMA.${reviseReadRule(r)}`

// ---------------------------------------------------------------- grade
const SOLVE_SCHEMA = {
  type: 'object',
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        required: ['question', 'working'],
        properties: {
          question: { type: 'string' },
          working: { type: 'string' },
          value: { type: 'string' },
          choice: { type: 'string' },
          plain: { type: 'string' },
        },
      },
    },
  },
}

const JUDGE_SCHEMA = {
  type: 'object',
  required: ['distractors_ok', 'key_form_ok', 'context_ok', 'solution_ok', 'notes'],
  properties: {
    distractors_ok: { type: 'boolean' },
    key_form_ok: { type: 'boolean' },
    context_ok: { type: 'boolean' },
    solution_ok: { type: 'boolean' },
    notes: { type: 'string' },
    distractors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['instance_id', 'option', 'verdict'],
        properties: {
          instance_id: { type: 'string' },
          option: { type: 'string' },
          verdict: { type: 'string', enum: ['IS_THAT_ERROR', 'WRONG_LABEL', 'ALSO_CORRECT', 'NOT_A_PLAUSIBLE_ERROR', 'UNTAGGED_OK'] },
          why: { type: 'string' },
        },
      },
    },
  },
}

const formatHint = (f) => {
  if (!f || f.type === 'number') return 'Answer with a number in "value" (a decimal point, a fraction like 7/2, or a whole number). Round exactly as the question asks.'
  if (f.type === 'choice') return 'Answer with the LETTER of the option you choose in "choice".'
  const form = f.form ? ` The question asks for the ${typeof f.form === 'object' ? `formula with ${f.form.subject} as the subject` : f.form} form.` : ''
  return `Answer in "plain" as plain maths (kind: ${f.kind}), using only the letters ${JSON.stringify(f.variables || [])}: ` +
    '* for multiplication, ^ for powers, sqrt(), [a, b] for several values, (a, b) for coordinates, ' +
    `interval(lo, hi, closed_lo, closed_hi) for an interval, "=" for an equation. Write the value itself, ` +
    `with no name in front: [0, 8], not x = [0, 8]; (3, 1), not H = (3, 1).${form}`
}

// ONLY the blind block of each instance goes in here. Nothing sealed. (By reference the stem is the
// instance's own shard.)
const blindOf = (inst) => inst.blind
const famNo = (fam) => String(((GS && GS.offset) || 0) + GS.families.indexOf(fam) + 1).padStart(3, '0')   // a part's families are numbered from its offset
const solvePrompt = (fam) => `Solve these ${fam.instances.length} questions. They are independent; work each one carefully
from its own words. You have no answer key and no worked solution — you are the check.

${fam.instances.map((inst, i) => {
  const b = blindOf(inst)
  const opts = b.options ? '\nOptions:\n' + b.options.map((o) => `  ${o.key}. ${o.text}`).join('\n') : ''
  return `QUESTION Q${i + 1}\n${REF ? refFile(`solve/f${famNo(fam)}-q${i + 1}.txt`) : b.stem}${opts}\nHow to answer: ${formatHint(b.answer_format)}`
}).join('\n\n')}

For each question give a SHORT working (the steps you actually took) and your final answer.
Return SOLVE_SCHEMA with one entry per question, "question" exactly as labelled (Q1, Q2, …).${readRule()}`

const judgePrompt = (fam) => `You are checking a generated question family after it has been solved blind. You see
the computed key, the worked solution and every wrong option's claimed error.

${REF ? refFile(`judge/f${famNo(fam)}.txt`) : `Family ${fam.family_id} on ${fam.lo_id}, tier ${fam.tier}, answer type ${fam.answer_type}.
${fam.context ? `Fixed context: ${fam.context}` : ''}

INSTANCES:
${fam.instances.map((i) => clip({ id: i.instance_id, stem: i.blind.stem, ...i.sealed }, 5000)).join('\n\n')}`}

Judge, adversarially:
- distractors_ok: for EVERY wrong option carrying a misconception_id, is the option exactly what a
  student making THAT error would produce? Is every wrong option definitely wrong? One ALSO_CORRECT or
  WRONG_LABEL makes this false. (An untagged wrong option only needs to be wrong: UNTAGGED_OK.)
  List each wrong option in "distractors". If the family has no options, true.
- key_form_ok: does the key say what the stem asks, in the asked form (factorised, simplest, subject
  of the formula)? For a typed answer, is the LaTeX key the same expression as answer_check?
- context_ok: is the question sensible and unambiguous as a ${BOOK.language === 'en' ? 'Grade ' + (BOOK.grade || '') : ''} student
  reads it (realistic numbers, the book's contexts kept)? true when there is no word problem.
- solution_ok: does each worked solution reach its key by the book's method, step by step, correctly?
When in doubt, answer false and say why in notes: a rejected family costs a rewrite; a wrong one
teaches a child the error.
Return JUDGE_SCHEMA.${readRule()}`

// ---------------------------------------------------------------- run
if (ARGS.mode === 'author') {
  if (ARGS.revise && ARGS.revise.length) {
    phase('Author')
    const revised = await parallel(ARGS.revise.map((r, i) => () => agent(revisePrompt(r), {
      label: `revise:${(r.spec && r.spec.id) || i}`, phase: 'Author', model: 'sonnet', schema: REVISE_SCHEMA,
    })))
    const ok = revised.filter(Boolean)
    log(`revised ${ok.length}/${ARGS.revise.length} spec(s); run generate_questions.py --check on them before grading`)
    return { mode: 'author', book: BOOK.book, prompts_version: PROMPTS_VERSION, records: [], revised: ok.map((r) => r.spec), changes: ok.map((r) => r.changes) }
  }
  const OBJS = REF ? ARGS.objective_refs : ARGS.objectives
  need(Array.isArray(OBJS) && OBJS.length, 'args.objectives is empty — run generate_questions.py --author-args')
  const objs = OBJS.filter((o) => !ARGS.only || ARGS.only.includes(o.lo_id))
  need(objs.length, 'no objective selected — check args.only')
  log(`authoring families for ${objs.length} objective(s); tier gaps: ${objs.reduce((n, o) => n + (o.tier_gaps || []).length, 0)}` +
    (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))
  const records = await pipeline(objs, (o) => agent(authorPrompt(o), {
    label: `author:${o.lo_id}`, phase: 'Author', model: 'sonnet', schema: AUTHOR_SCHEMA,
  }))
  const kept = []
  records.forEach((r, i) => {
    if (!r) { log(`${objs[i].lo_id}: no answer from the author (skipped by the operator or failed) — still a gap`); return }
    // The model cannot re-home a family: anything not on the objective it was given is dropped here.
    const fams = (r.families || []).filter((f) => f.lo_id === objs[i].lo_id)
    if (fams.length !== (r.families || []).length) log(`${objs[i].lo_id}: dropped ${(r.families || []).length - fams.length} spec(s) written for another objective`)
    kept.push({ lo_id: objs[i].lo_id, families: fams, infeasible: r.infeasible || [], notes: r.notes || '' })
  })
  const n = kept.reduce((a, r) => a + r.families.length, 0)
  const inf = kept.reduce((a, r) => a + r.infeasible.length, 0)
  log(`${n} family spec(s) written; ${inf} gap(s) reported infeasible. Next: save, write the specs, run --check.`)
  return { mode: 'author', book: BOOK.book, prompts_version: PROMPTS_VERSION, ...(REF ? { by_ref: REF } : {}),
    ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), records: kept, revised: [] }
}

// grade
// By reference each compact family becomes the shape the inline grading set has, minus the text
// (stems, the sealed blocks, the family line) the shards carry: {family_id, spec_sha, instances:
// [{instance_id, blind: {stem_sha, options?, answer_format}}]}.
const fromRef = (gr) => gr && Object.assign({}, gr, { families: (gr.families || []).map((r) => ({
  family_id: r.f, spec_sha: r.s,
  instances: (r.i || []).map(([iid, sha, fmt]) => ({ instance_id: iid, blind: Array.isArray(fmt)
    ? { stem_sha: sha, options: fmt.map(([key, text]) => ({ key, text })), answer_format: { type: 'choice' } }
    : { stem_sha: sha, answer_format: fmt === 'n' ? { type: 'number' } : fmt } })),
})) })
const GS = REF ? fromRef(ARGS.grading_ref) : ARGS.grading_set
need(GS && GS.format === 'ainext.family-grading/1' && Array.isArray(GS.families),
  'args.grading_set must be the output of generate_questions.py --grading-set (or use --grade-args)')
const fams = GS.families.filter((f) => f.instances && f.instances.length)
const empty = GS.families.length - fams.length
if (empty) log(`${empty} famil(ies) produced no instance to grade — they stay ungraded and cannot load`)
log(`grading ${fams.length} famil(ies), ${fams.reduce((a, f) => a + f.instances.length, 0)} instance(s), blind` +
  (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))

const results = await pipeline(fams,
  (fam) => agent(solvePrompt(fam), { label: `solve:${fam.family_id}`, phase: 'Solve', model: 'sonnet', schema: SOLVE_SCHEMA }),
  async (solved, fam) => {
    const judge = await agent(judgePrompt(fam), { label: `judge:${fam.family_id}`, phase: 'Judge', model: 'sonnet', schema: JUDGE_SCHEMA })
    // positional labels in, ids back out: the solver never sees an instance id (it names the family)
    const byLabel = new Map(((solved && solved.answers) || []).map((a) => [String(a.question || '').trim().toUpperCase(), a]))
    const answers = fam.instances.map((inst, i) => {
      const a = byLabel.get(`Q${i + 1}`)
      const b = blindOf(inst)
      let answer = {}
      if (a) {
        if (b.options) {
          // the letter is mapped to the option's TEXT here, from the options the solver saw,
          // so the comparison survives key rebalancing (generate_questions.py compares text)
          const opt = b.options.find((o) => o.key === String(a.choice || '').trim().toUpperCase())
          answer = { choice: a.choice || null, choice_text: opt ? opt.text : null }
        } else if (b.answer_format && b.answer_format.type === 'expression') {
          answer = { plain: a.plain || '' }
        } else {
          answer = { value: a.value || '' }
        }
      }
      // stem_sha and spec_sha are copied from the grading set, never from a model
      return { instance_id: inst.instance_id, stem_sha: b.stem_sha, answer, working: a ? a.working : 'NO ANSWER' }
    })
    return { family_id: fam.family_id, spec_sha: fam.spec_sha, answers, judge: judge || { distractors_ok: null, key_form_ok: null, context_ok: null, solution_ok: null, notes: 'judge did not return' } }
  },
)
const out = results.filter(Boolean)
if (out.length !== fams.length) log(`${fams.length - out.length} famil(ies) lost a stage — they stay ungraded`)
log('answers returned; generate_questions.py --grades compares them with the computed keys (one disagreement rejects the family)')
return { mode: 'grade', book: BOOK.book, prompts_version: PROMPTS_VERSION, ...(REF ? { by_ref: REF } : {}),
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), results: out }

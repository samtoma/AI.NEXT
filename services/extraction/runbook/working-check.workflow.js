export const meta = {
  name: 'working-check',
  description: 'Step-level working checker (answer 30, backlog 78; sw-v3): one blind Sonnet agent per BATCH of canonical solutions reads each question, its options, its figure, the key and the numbered working, and flags every step that does not follow — never corrects; run twice (two independent passes) and union the flags',
  whenToUse: 'After a chapter is assembled (seed/<book>/<prefix>-cNN.json), before its content is reviewed. Args come from `uv run working_check.py args --book <book> --seed <bundle> --chapter N --by-ref DIR --out A.json` (or its generated copy, --embed).',
  phases: [
    { title: 'SW Check', detail: 'one agent per batch of up to 12 solutions (default 8): does each step follow from the question, its figure and the steps before it? (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// THE STEP-LEVEL WORKING CHECKER (Samuel's answer 30, 2026-09-27; integration backlog 78).
//
// S3's three-way check compares FINAL answers only, so a typo inside the book's working passes
// whenever the final answer is right, and the grounded tutor teaches that working. Here an agent reads
// canonical solutions step by step and reports every step that does not follow from the question and the
// steps before it. It never re-solves the problem its own way, and it never writes a correction: a flag
// goes to a human (the console backlog, answer 37c), the content stays as the book and G2 have it.
// `working_check.py collect` merges these verdicts with the free pre-check, which this workflow never
// sees (two independent signals).
//
// sw-v2 (2026-10-01, the Chapter 8 calibration). sw-v1 ran ONE agent per solution and metered $31.0 for 192
// solutions ($0.161 each against a plan of $0.03-0.05): every agent pays ~30K tokens of cache writes and
// ~95K of cache reads ($0.094) before it opens a shard, its thinking added $0.034 on average, and opening
// figure images added ~$0.06 to the 66 agents that did. Its flags were 23 real book defects out of 25; the
// two false ones came from a shard that omitted the multiple-choice options. So: ONE agent per BATCH of
// ARGS.batch solutions (the fixed cost is shared), a figure only where the question text does not give its
// points, effort ARGS.effort, and notes only on flags. The tool budget is an instruction (the agent() hook
// has no turn cap); the run's meter record shows whether it held.
//
// sw-v3 (2026-10-01, after two sw-v2 calibration runs, recall 12 and 14 of 16 real solutions by the agents
// alone). Both missed Ex8-4:19b, whose points exist only in its figure: told to open a figure "only if" a
// value was in no text, the agents back-solved A, B, C from the working itself (circular: the swapped labels
// then look right) and called it consistent. A figure the shard offers is now read in the agent's FIRST turn,
// with the shards (the prompt names it), and back-solving is forbidden; a TRACE rule makes every substituted
// number and every label be matched to its source. The other misses differed between the two runs (lapses of
// a shallow pass over 5-8 solutions), so the whole-book configuration is TWO independent passes (ARGS.pass_id
// A and B, the second with ARGS.order 'shuffled') whose flags `working_check.py collect` unions.
//
// Args (by reference only; packet_ref.py): {book: {book}, stage: 'SW', prompts_version, chapter, part,
// parts, batch, effort, model, pass_id, order, fig_dir, figs: {<shard number>: [image file …]}, solutions:
// [id …], by_ref: {dir, stage, shards_sha256, files}}. Solution i's text is the shard s/<i, 4 digits>.txt: the
// question, its options, the key, the numbered steps, and a FIGURE line when its picture holds the question's
// points. `figs` names each such picture (a bare file name sits under `fig_dir`). Batch b is solutions
// [b*batch, (b+1)*batch). The script never reads a shard; the agent does.
//
// After the run: save the return value to runs/<book>/working-check/chNN-<runId>.json, then
//   uv run working_check.py collect --args <A.json> --runs <that file> --out runs/<book>/working-check/chNN.flags.json
//   uv run meter_run.py record --book <book> --stage SW --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'sw-v3'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
const REF = ARGS.by_ref || null
const SOLS = Array.isArray(ARGS.solutions) ? ARGS.solutions : null
if (ARGS.stage !== 'SW' || !BOOK.book || !SOLS) {
  throw new Error('args must be the output of `uv run working_check.py args --book <book> --seed <bundle> --chapter N --by-ref DIR`')
}
if (!(REF && typeof REF.dir === 'string' && REF.dir.startsWith('/') && REF.shards_sha256 && REF.stage === 'SW')) {
  throw new Error(`args.by_ref must name the absolute SW shard directory and its shards_sha256: ${JSON.stringify(REF).slice(0, 160)}`)
}
if (REF.files !== SOLS.length) {
  throw new Error(`args name ${SOLS.length} solution(s) but the shard directory holds ${REF.files} shard(s): rebuild the args`)
}
if (ARGS.prompts_version !== PROMPTS_VERSION) {
  throw new Error(`the args were built for prompts ${ARGS.prompts_version}; this script is ${PROMPTS_VERSION}: rebuild them`)
}
const BATCH = ARGS.batch
const EFFORT = ARGS.effort
const MODEL = ARGS.model
const PASS = ARGS.pass_id
const FIGS = ARGS.figs
if (!(Number.isInteger(BATCH) && BATCH >= 1 && BATCH <= 12 && ['low', 'medium', 'high'].includes(EFFORT) &&
      ['sonnet', 'haiku'].includes(MODEL) && typeof PASS === 'string' && /^[A-Za-z0-9_-]{1,12}$/.test(PASS) &&
      FIGS && typeof FIGS === 'object' && !Array.isArray(FIGS) && typeof ARGS.fig_dir === 'string')) {
  throw new Error('args must carry batch (1-12), effort (low|medium|high), model (sonnet|haiku), pass_id, fig_dir and figs: rebuild them with working_check.py args')
}
const figPath = (f) => (f.startsWith('/') ? f : (ARGS.fig_dir.startsWith('/') ? `${ARGS.fig_dir}/${f}` : ''))
for (const [k, v] of Object.entries(FIGS)) {
  if (!(Number.isInteger(+k) && +k >= 1 && +k <= SOLS.length && Array.isArray(v) && v.every((f) => typeof f === 'string' && figPath(f) !== ''))) {
    throw new Error(`args.figs[${JSON.stringify(k)}] is not a shard number with absolute image paths: rebuild the args`)
  }
}

const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const shardOf = (i) => `[[file: ${REF.dir}/s/${String(i + 1).padStart(4, '0')}.txt]]`

const KINDS = ['wrong_value', 'arithmetic', 'sign', 'label', 'copy', 'final_answer', 'other']
const WHERE = ['working', 'question', 'unsure']
const CHECK_SCHEMA = {
  type: 'object', required: ['results'], properties: {
    results: {
      type: 'array', items: {
        type: 'object', required: ['solution_id', 'verdict'], properties: {
          solution_id: { type: 'string' },
          verdict: { type: 'string', enum: ['consistent', 'flagged', 'unclear'] },
          flags: {
            type: 'array', items: {
              type: 'object', required: ['step', 'quote', 'kind', 'why'], properties: {
                step: { type: 'integer' },
                quote: { type: 'string' },
                kind: { type: 'string', enum: KINDS },
                where: { type: 'string', enum: WHERE },
                expected: { type: 'string' },
                why: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
    },
  },
}

const prompt = (idxs) => `You check ${idxs.length} worked solution${idxs.length > 1 ? 's' : ''} from a mathematics textbook, one at a time, step by step. Students are taught exactly this working, so a step that does not follow would teach them something wrong.

${idxs.map((i, k) => {
  const figs = (FIGS[String(i + 1)] || []).map(figPath)
  return `Solution ${k + 1}: ${shardOf(i)}${figs.length ? ` and its FIGURE image${figs.length > 1 ? 's' : ''}: ${figs.join(', ')}` : ''}`
}).join('\n')}

YOUR TOOL BUDGET (a hard limit; do not exceed it):
1. ONE turn that reads all ${idxs.length} file${idxs.length > 1 ? 's' : ''} above AND every FIGURE image named above (parallel Read calls).
2. Then call StructuredOutput once. No other tool use, no other file, no search.

For EVERY step of EVERY solution, decide whether it follows from the question, the options, the figure and the steps before it. Judge each solution on its own; never carry a value from one to another. A short solution is not a safe one: check every step.
- wrong_value: a value used or substituted (a coordinate, a length, a coefficient, a given) is not the one the question, the figure or an earlier step gives;
- arithmetic: a line's arithmetic or algebra does not equal what it is set equal to (check each "=" in a chain, and each line of an aligned derivation against the line before it);
- sign: a minus sign or a bracket is lost or flipped;
- label: a named point, side, variable or quantity changes (the working says N where the question says M);
- copy: an expression is copied wrongly from an earlier step (a formula with a term changed);
- final_answer: the last step does not state the FINAL ANSWER given as the key. When the key is a letter, OPTIONS says which answer it stands for, and the working's conclusion must name that same answer;
- other: any other step that does not follow, including a conclusion the earlier steps do not support.
Rules:
- TRACE before you answer: for every line that substitutes values into a formula or names a point, side or quantity, find where each number and each label comes from (the question text, an option, the key, the figure, or an earlier step) and check that the line uses it as it is given there: the right point's coordinates for the right label, the right sign, the right variable. A number that comes from none of these, or a label that is not the question's, is a flag.
- Judge the working AS WRITTEN. Do not solve the problem your own way, do not judge the choice of method, and never rewrite the solution or propose a corrected one.
- Rounding the book does on purpose is not an error when it is right to the places shown (e.g. √90 = 9.5 to one decimal place). A step that only states a formula correctly, describes the method, or draws a sketch ([figure]) is fine.
- The maths is LaTeX; read it as the mathematics it typesets (spacing and \\text{…} wrappers mean nothing).
- FIGURES: a solution named above with a FIGURE image has its points, lengths or labels only in that picture (its question text does not give them): the picture is the ONLY source for them, so read it in your first turn and check every point name and coordinate the working uses against it. NEVER reconstruct a figure's values from the working itself: that is circular and hides exactly the swapped labels and wrong coordinates you are here to find. Read printed labels and coordinates; never measure pixels. A solution named without a figure has what it needs in its text; when a value is in no text and no figure is named, it comes from an earlier part of the exercise (next rule).
- A solution whose id ends in a letter (…ex8-6-46c) is one part of a multi-part exercise; it may use a result of an earlier part you cannot see. Never flag a value only because it is not in its file. If its conclusion cannot be judged without that part, the verdict is "unclear" with a one-sentence note.
- where: "working" when a step is wrong; "question" when the QUESTION TEXT (or an option) is what conflicts with an otherwise consistent working (the question names a side XY, the working and its figure name it ZY); "unsure" when they conflict and you cannot tell which is wrong. The flag's step is the step where the conflict shows.
- Report every step that does not follow: its number, quote (a short EXACT span copied from that step), kind, where, expected, why. "flagged" when you report any; "consistent" (no flags) when every step follows; "unclear" only when you cannot judge — the working depends on something you cannot see, or a step is unreadable.
- Be strict but not pedantic: a flag must point at a real inconsistency a student would be taught.
- Be brief: quote at most one short span; why is ONE sentence of at most 25 words; expected is at most 12 words naming only the value or label the earlier text gives (never a rewritten step), or empty; note is only for "unclear" (one sentence). A consistent solution needs only its id and verdict.
- Return one entry in results per solution, copying its id exactly from the first line of its file (the text after "SOLUTION ").

${READ_RULE} You may also open the FIGURE image files named above, and nothing else.

Return CHECK_SCHEMA.`

const BATCHES = []
for (let i = 0; i < SOLS.length; i += BATCH) BATCHES.push(SOLS.slice(i, i + BATCH).map((_, k) => i + k))

log(`chapter ${ARGS.chapter}${ARGS.parts > 1 ? `, part ${ARGS.part} of ${ARGS.parts}` : ''}: ${SOLS.length} solution(s) in ${BATCHES.length} batch(es) of up to ${BATCH}, one checking agent each (${PROMPTS_VERSION}, pass ${PASS}, ${MODEL}, effort ${EFFORT}, ${Object.values(FIGS).reduce((n, v) => n + v.length, 0)} figure(s) read); packet by reference: ${REF.files} shard(s) in ${REF.dir}`)

phase('SW Check')
const raw = await parallel(BATCHES.map((idxs, b) => () =>
  agent(prompt(idxs), {
    label: `SW:check:b${String(b + 1).padStart(3, '0')}:${SOLS[idxs[0]]}${idxs.length > 1 ? `+${idxs.length - 1}` : ''}`,
    phase: 'SW Check', model: MODEL, effort: EFFORT, schema: CHECK_SCHEMA,
  })))

const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const byId = new Map()
const problems = []
BATCHES.forEach((idxs, b) => {
  const r = raw[b]
  const mine = new Set(idxs.map((i) => SOLS[i]))
  const seen = new Set()
  if (!r || !Array.isArray(r.results)) {
    problems.push(`batch ${b + 1} (${SOLS[idxs[0]]} …): the checking agent returned nothing (its ${idxs.length} solution(s) are unchecked: re-run it)`)
    return
  }
  for (const x of r.results) {
    const id = x && x.solution_id
    if (!mine.has(id)) { problems.push(`batch ${b + 1}: an answer names ${JSON.stringify(id)}, which is not in this batch (ignored)`); continue }
    if (seen.has(id)) { problems.push(`batch ${b + 1}: ${id} answered twice (the first kept)`); continue }
    seen.add(id)
    byId.set(id, x)
  }
})

const results = SOLS.map((id) => {
  const r = byId.get(id)
  if (!r) {
    if (!problems.some((p) => p.includes(id))) problems.push(`${id}: the checking agent gave no verdict for it (unchecked: re-run it)`)
    return { solution_id: id, verdict: null, flags: [], note: 'no answer' }
  }
  const flags = (r.flags || []).filter((f) => f && Number.isInteger(f.step)).map((f) => ({
    step: f.step, quote: cut(f.quote, 300), kind: f.kind, ...(f.where ? { where: f.where } : {}),
    expected: cut(f.expected, 300), why: cut(f.why, 400),
  }))
  let verdict = r.verdict
  if (verdict === 'consistent' && flags.length) verdict = 'flagged'       // a flag is never dropped
  if (verdict === 'flagged' && !flags.length) {
    problems.push(`${id}: verdict flagged with no flag (kept as unclear)`)
    verdict = 'unclear'
  }
  return { solution_id: id, verdict, flags, note: cut(r.note, 400) }
})
const n = (v) => results.filter((x) => x.verdict === v).length
for (const p of problems) log(p)
log(`${n('consistent')} consistent, ${n('flagged')} flagged (${results.reduce((a, x) => a + x.flags.length, 0)} step(s)), ${n('unclear')} unclear, ${results.filter((x) => !x.verdict).length} unchecked. ` +
  `Save this return value as runs/${BOOK.book}/working-check/ch${String(ARGS.chapter).padStart(2, '0')}-<runId>.json, then working_check.py collect.`)

return {
  stage: 'SW', workflow: 'working-check', prompts_version: PROMPTS_VERSION, book: BOOK.book,
  chapter: ARGS.chapter, part: ARGS.part || 1, parts: ARGS.parts || 1,
  batch: BATCH, agents: BATCHES.length, effort: EFFORT, model: MODEL, pass_id: PASS, order: ARGS.order || 'bundle',
  by_ref: REF,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  results, problems,
  meter: { stage: 'SW', record: `uv run meter_run.py record --book ${BOOK.book} --stage SW --run <runId>` },
}

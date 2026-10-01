export const meta = {
  name: 'working-check',
  description: 'Step-level working checker (answer 30, backlog 78; sw-v2): one blind Sonnet agent per BATCH of canonical solutions reads each question, its options, the key and the numbered working, and flags every step that does not follow — never corrects',
  whenToUse: 'After a chapter is assembled (seed/<book>/<prefix>-cNN.json), before its content is reviewed. Args come from `uv run working_check.py args --book <book> --seed <bundle> --chapter N --by-ref DIR --out A.json` (or its generated copy, --embed).',
  phases: [
    { title: 'SW Check', detail: 'one agent per batch of up to 8 solutions: does each step follow from the question and the steps before it? (Sonnet, medium effort)' },
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
// ARGS.batch solutions (default 8; the fixed cost is shared), a figure only where the question text does not
// give its points (the shard offers it or not) and at most ARGS.fig_cap images per batch, all in one turn,
// effort ARGS.effort (default medium), and notes only on flags. The tool budget is an instruction (the
// agent() hook has no turn cap); the run's meter record shows whether it held.
//
// Args (by reference only; packet_ref.py): {book: {book}, stage: 'SW', prompts_version, chapter, part,
// parts, batch, fig_cap, effort, model, solutions: [id …], by_ref: {dir, stage: 'SW', shards_sha256,
// files}}. Solution i's text is the shard s/<i, 4 digits>.txt: the question, its options, the key, the
// numbered steps, and the figure the question shows when the shard offers one. Batch b is solutions
// [b*batch, (b+1)*batch). The script never reads a shard; the agent does.
//
// After the run: save the return value to runs/<book>/working-check/chNN-<runId>.json, then
//   uv run working_check.py collect --args <A.json> --runs <that file> --out runs/<book>/working-check/chNN.flags.json
//   uv run meter_run.py record --book <book> --stage SW --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'sw-v2'
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
const FIG_CAP = ARGS.fig_cap
const EFFORT = ARGS.effort
const MODEL = ARGS.model
if (!(Number.isInteger(BATCH) && BATCH >= 1 && BATCH <= 12 && Number.isInteger(FIG_CAP) && FIG_CAP >= 0 && FIG_CAP <= 6 &&
      ['low', 'medium', 'high'].includes(EFFORT) && ['sonnet', 'haiku'].includes(MODEL))) {
  throw new Error('args must carry batch (1-12), fig_cap (0-6), effort (low|medium|high) and model (sonnet|haiku): rebuild them with working_check.py args')
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

${idxs.map((i, k) => `Solution ${k + 1}: ${shardOf(i)}`).join('\n')}

YOUR TOOL BUDGET (a hard limit; do not exceed it):
1. ONE turn that reads all ${idxs.length} file${idxs.length > 1 ? 's' : ''} above (parallel Read calls).
2. At most ONE more turn, only to open figure images (rule below); skip it when nothing needs a figure.
3. Then call StructuredOutput once. No other tool use, no other file, no search.

For EVERY step of EVERY solution, decide whether it follows from the question, the options and the steps before it. Judge each solution on its own; never carry a value from one to another.
- wrong_value: a value used or substituted (a coordinate, a length, a coefficient, a given) is not the one the question or an earlier step gives;
- arithmetic: a line's arithmetic or algebra does not equal what it is set equal to (check each "=" in a chain, and each line of an aligned derivation against the line before it);
- sign: a minus sign or a bracket is lost or flipped;
- label: a named point, side, variable or quantity changes (the working says T where the question says Q);
- copy: an expression is copied wrongly from an earlier step (a formula with a term changed);
- final_answer: the last step does not state the FINAL ANSWER given as the key. When the key is a letter, OPTIONS says which answer it stands for, and the working's conclusion must name that same answer;
- other: any other step that does not follow, including a conclusion the earlier steps do not support (for instance "all sides equal, so a square" for a parallelogram).
Rules:
- Judge the working AS WRITTEN. Do not solve the problem your own way, do not judge the choice of method, and never rewrite the solution or propose a corrected one.
- Rounding the book does on purpose is not an error when it is right to the places shown (e.g. √90 = 9.5 to one decimal place). A step that only states a formula correctly, describes the method, or draws a sketch ([figure]) is fine.
- The maths is LaTeX; read it as the mathematics it typesets (spacing and \\text{…} wrappers mean nothing).
- FIGURES: a file lists a FIGURE image only when its question text does not give the points. Open an image ONLY when a value the working uses (a coordinate, a length, a label) is in no text of that file and a step's correctness depends on it. Open every image the batch needs together, in your one figure turn, at most ${FIG_CAP} in all; read printed labels and coordinates, never measure pixels. When a value is in no text and no figure is offered, it comes from the book's figure or from an earlier part of the exercise: do not flag it for that reason.
- A solution whose id ends in a letter (…ex8-6-46c) is one part of a multi-part exercise; it may use a result of an earlier part you cannot see. Never flag a value only because it is not in its file. If its conclusion cannot be judged without that part, the verdict is "unclear" with a one-sentence note.
- where: "working" when a step is wrong; "question" when the QUESTION TEXT (or an option) is what conflicts with an otherwise consistent working (the question calls a point Q, the working and its figure call it T); "unsure" when they conflict and you cannot tell which is wrong. The flag's step is the step where the conflict shows.
- Report every step that does not follow: its number, quote (a short EXACT span copied from that step), kind, where, expected, why. "flagged" when you report any; "consistent" (no flags) when every step follows; "unclear" only when you cannot judge — the working depends on something you cannot see, or a step is unreadable.
- Be strict but not pedantic: a flag must point at a real inconsistency a student would be taught.
- Be brief: quote at most one short span; why is ONE sentence of at most 25 words; expected is at most 12 words naming only the value or label the earlier text gives (never a rewritten step), or empty; note is only for "unclear" (one sentence). A consistent solution needs only its id and verdict.
- Return one entry in results per solution, copying its id exactly from the first line of its file (the text after "SOLUTION ").

${READ_RULE} You may also open the image files that a file lists under FIGURE, and nothing else.

Return CHECK_SCHEMA.`

const BATCHES = []
for (let i = 0; i < SOLS.length; i += BATCH) BATCHES.push(SOLS.slice(i, i + BATCH).map((_, k) => i + k))

log(`chapter ${ARGS.chapter}${ARGS.parts > 1 ? `, part ${ARGS.part} of ${ARGS.parts}` : ''}: ${SOLS.length} solution(s) in ${BATCHES.length} batch(es) of up to ${BATCH}, one checking agent each (${PROMPTS_VERSION}, ${MODEL}, effort ${EFFORT}); packet by reference: ${REF.files} shard(s) in ${REF.dir}`)

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
  batch: BATCH, agents: BATCHES.length, effort: EFFORT, model: MODEL, fig_cap: FIG_CAP,
  by_ref: REF,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  results, problems,
  meter: { stage: 'SW', record: `uv run meter_run.py record --book ${BOOK.book} --stage SW --run <runId>` },
}

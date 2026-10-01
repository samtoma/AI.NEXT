export const meta = {
  name: 'working-check',
  description: 'Step-level working checker (answer 30, backlog 78): one blind Sonnet agent per canonical solution reads the question, the key and the numbered working, and flags every step that does not follow — never corrects',
  whenToUse: 'After a chapter is assembled (seed/<book>/<prefix>-cNN.json), before its content is reviewed. Args come from `uv run working_check.py args --book <book> --seed <bundle> --chapter N --by-ref DIR --out A.json` (or its generated copy, --embed).',
  phases: [
    { title: 'SW Check', detail: 'one agent per solution: does each step follow from the question and the steps before it? (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// THE STEP-LEVEL WORKING CHECKER (Samuel's answer 30, 2026-09-27; integration backlog 78).
//
// S3's three-way check compares FINAL answers only, so a typo inside the book's working passes
// whenever the final answer is right, and the grounded tutor teaches that working. Here one agent per
// canonical solution reads it step by step and reports every step that does not follow from the
// question and the steps before it. It never re-solves the problem its own way, and it never writes
// a correction: a flag goes to a human (the console backlog, answer 37c), the content stays as the
// book and G2 have it. `working_check.py collect` merges these verdicts with the free numeric
// pre-check, which this workflow never sees (two independent signals).
//
// Args (by reference only; packet_ref.py): {book: {book}, stage: 'SW', prompts_version, chapter, part,
// parts, solutions: [id …], by_ref: {dir, stage: 'SW', shards_sha256, files}}. Solution i's text is the
// shard s/<i, 4 digits>.txt: the question, the key, the numbered steps, and the image files of the
// figures the question shows. The script never reads it; the agent does.
//
// After the run: save the return value to runs/<book>/working-check/chNN-<runId>.json, then
//   uv run working_check.py collect --args <A.json> --runs <that file> --out runs/<book>/working-check/chNN.flags.json
//   uv run meter_run.py record --book <book> --stage SW --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'sw-v1'
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
if (ARGS.prompts_version && ARGS.prompts_version !== PROMPTS_VERSION) {
  throw new Error(`the args were built for prompts ${ARGS.prompts_version}; this script is ${PROMPTS_VERSION}: rebuild them`)
}

const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const shardOf = (i) => `[[file: ${REF.dir}/s/${String(i + 1).padStart(4, '0')}.txt]]`

const KINDS = ['wrong_value', 'arithmetic', 'sign', 'label', 'copy', 'final_answer', 'other']
const CHECK_SCHEMA = {
  type: 'object', required: ['verdict', 'flags'], properties: {
    verdict: { type: 'string', enum: ['consistent', 'flagged', 'unclear'] },
    flags: {
      type: 'array', items: {
        type: 'object', required: ['step', 'quote', 'kind', 'why'], properties: {
          step: { type: 'integer' },
          quote: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          expected: { type: 'string' },
          why: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
}

const prompt = (i) => `You check ONE worked solution from a mathematics textbook, step by step. Students are taught exactly this working, so a step that does not follow would teach them something wrong.

${shardOf(i)}

For EVERY step, decide whether it follows from the question and the steps before it:
- wrong_value: a value used or substituted (a coordinate, a length, a coefficient, a given) is not the one the question or an earlier step gives;
- arithmetic: a line's arithmetic or algebra does not equal what it is set equal to (check each "=" in a chain, and each line of an aligned derivation against the line before it);
- sign: a minus sign or a bracket is lost or flipped;
- label: a named point, side, variable or quantity changes (the working says T where the question says Q);
- copy: an expression is copied wrongly from an earlier step (a formula with a term changed);
- final_answer: the last step does not state the FINAL ANSWER given as the key (when a key is given);
- other: any other step that does not follow.
Rules:
- Judge the working AS WRITTEN. Do not solve the problem your own way, do not judge the choice of method, and never rewrite the solution.
- Rounding the book does on purpose is not an error when it is right to the places shown (e.g. √90 = 9.5 to one decimal place). A step that only states a formula correctly, describes the method, or draws a sketch ([figure]) is fine.
- The maths is LaTeX; read it as the mathematics it typesets (spacing and \\text{…} wrappers mean nothing).
- If the question's values come from a figure, open the figure image files the file lists and read them from there.
- Report every step that does not follow: its number, quote (a short EXACT span copied from that step), kind, expected (what would follow from the earlier steps, if you can say), why (one sentence). Verdict "flagged" when you report any; "consistent" with no flags when every step follows; "unclear" (with a note) only when you cannot judge — the working depends on something you cannot see, or a step is unreadable.
- Be strict but not pedantic: a flag must point at a real inconsistency a student would be taught.

${READ_RULE} You may also open the image files that file lists under FIGURES, and nothing else.

Return CHECK_SCHEMA.`

log(`chapter ${ARGS.chapter}${ARGS.parts > 1 ? `, part ${ARGS.part} of ${ARGS.parts}` : ''}: ${SOLS.length} solution(s), one checking agent each (${PROMPTS_VERSION}); packet by reference: ${REF.files} shard(s) in ${REF.dir}`)

phase('SW Check')
const raw = await parallel(SOLS.map((id, i) => () =>
  agent(prompt(i), { label: `SW:check:${id}`, phase: 'SW Check', model: 'sonnet', schema: CHECK_SCHEMA })))

const results = []
const problems = []
SOLS.forEach((id, i) => {
  const r = raw[i]
  if (!r) {
    problems.push(`${id}: the checking agent returned nothing (unchecked: re-run it)`)
    results.push({ solution_id: id, verdict: null, flags: [], note: 'no answer' })
    return
  }
  const flags = (r.flags || []).filter((f) => f && Number.isInteger(f.step))
  let verdict = r.verdict
  if (verdict === 'consistent' && flags.length) verdict = 'flagged'       // a flag is never dropped
  if (verdict === 'flagged' && !flags.length) {
    problems.push(`${id}: verdict flagged with no flag (kept as unclear)`)
    verdict = 'unclear'
  }
  results.push({ solution_id: id, verdict, flags, note: r.note || '' })
})
const n = (v) => results.filter((x) => x.verdict === v).length
for (const p of problems) log(p)
log(`${n('consistent')} consistent, ${n('flagged')} flagged (${results.reduce((a, x) => a + x.flags.length, 0)} step(s)), ${n('unclear')} unclear, ${results.filter((x) => !x.verdict).length} unchecked. ` +
  `Save this return value as runs/${BOOK.book}/working-check/ch${String(ARGS.chapter).padStart(2, '0')}-<runId>.json, then working_check.py collect.`)

return {
  stage: 'SW', workflow: 'working-check', prompts_version: PROMPTS_VERSION, book: BOOK.book,
  chapter: ARGS.chapter, part: ARGS.part || 1, parts: ARGS.parts || 1,
  by_ref: REF,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  results, problems,
  meter: { stage: 'SW', record: `uv run meter_run.py record --book ${BOOK.book} --stage SW --run <runId>` },
}

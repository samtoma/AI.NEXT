export const meta = {
  name: 'answers',
  description: 'Answers for book records: generated answers for prompts the book leaves unanswered (an author and a blind re-solve), and the blind re-solve of every printed answer with a judge for what the comparison cannot settle',
  whenToUse: 'After extraction (and crops, for the figures a question needs). Built and accepted by answer_gen.py run / check-printed; never run alone.',
  phases: [
    { title: 'Author', detail: 'the answer and the worked steps a student is taught, from the lesson material only (Sonnet)' },
    { title: 'Re-solve', detail: 'blind: only the final answer, never seeing the author or the printed answer (Sonnet)' },
    { title: 'Judge', detail: 'are two answers the same thing, where the deterministic comparison could not say (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// ANSWERS (answer_gen.py; Tamer, 2026-10-16). The prompts, word for word from answer_gen.py ans-v2 / chk-v1, live here;
// answer_gen.py builds each group's material (the lesson as the model may use it, and the parts to answer: data, not
// instructions), compares the answers deterministically (same_answer, the numeric step check) and decides the status.
// ARGS: { stage: 'S3-answers', mode: 'answer' | 'blind' | 'judge', book: {book}, model?: 'sonnet',
//         groups: [{label, material}]          (answer: author + re-solve per group; blind: re-solve per group)
//         judge: {label, material, kind?}       (judge: one call; kind 'generated': two solvers, not the book) }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'ans-v3'   // v3: answer_gen.py's prompts in this workflow, unchanged (ans-v2, chk-v1)
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
if (ARGS.stage !== 'S3-answers' || !['answer', 'blind', 'judge'].includes(ARGS.mode)) throw new Error('args must be built by answer_gen.py')
const MODEL = ARGS.model || 'sonnet'
const AUTHOR = "You write the answer and the worked solution a Prep-3 (Grade 9) student in Egypt is taught for exercises in their maths textbook.\n\nRules:\n- Use ONLY the lesson material given: its definitions, rules, conventions and worked-example methods. Cite the ids you used in grounded_in. Never use a method the lesson does not teach.\n- Steps are short, one idea each, in the order a student would write them. The last step states the answer.\n- kind: \"value\" when the answer is something a student writes (numbers, pairs, sets, names, yes/no);\n  \"drawing\" when the answer is a drawing (say exactly what to draw and where, in steps);\n  \"explanation\" when the question asks why or to describe (give the reasoning in steps; answer is one sentence).\n- Read every value from the question or, where given, the page image. Never invent data.\n- If a part cannot be answered from what is given, set kind \"explanation\" and start the answer with \"CANNOT ANSWER:\" and the reason.\n\nAnswer format (both of you use it, so answers can be compared):\n- numbers plainly: 7, -4, 3/2;\n- several unknowns as assignments: a = 4, b = -4;\n- an ordered pair as (x, y); a set as {(1, 2), (1, 3)} or {1, 2, 3};\n- a place or a name in words: \"fourth quadrant\", \"y-axis\";\n- yes/no questions start with Yes or No.\nMaths in $...$ inside sentences. English."
const RESOLVE = "You solve exercises from a Prep-3 (Grade 9) maths textbook, using the lesson material given.\nGive only each part's final answer and its kind (\"value\", \"drawing\" or \"explanation\"). For a drawing, say in one line what is drawn.\nRead every value from the question or, where given, the page image. If a part cannot be answered, start the answer with \"CANNOT ANSWER:\".\n\nAnswer format (both of you use it, so answers can be compared):\n- numbers plainly: 7, -4, 3/2;\n- several unknowns as assignments: a = 4, b = -4;\n- an ordered pair as (x, y); a set as {(1, 2), (1, 3)} or {1, 2, 3};\n- a place or a name in words: \"fourth quadrant\", \"y-axis\";\n- yes/no questions start with Yes or No.\nMaths in $...$ inside sentences. English."
const JUDGE = "You compare two final answers to the same maths exercise: the one the textbook prints and one a solver gave without seeing it.\n\"equivalent\" when they say the same thing (the same values, pairs, sets or conclusion, in any order or notation, a set written with or without braces, a value with or without its name).\n\"different\" when they do not. \"unclear\" only when the question itself does not let you decide. Give the reason in one line."
// two solvers, not the book and a solver (generated answers: answer_gen.py judge; Tamer, 2026-10-18)
const JUDGE_GENERATED = "You compare two final answers to the same maths exercise, each given by a different solver; the textbook prints none.\n\"equivalent\" when they reach the same conclusion: the same values, pairs, sets, choice or claim, in any order, notation or wording, with or without the working, the reason or the name of the value.\n\"different\" when the conclusions differ, or when one leaves out or adds a value, a case or a condition the other has (\"x < 4\" and \"27/8 < x < 4\" are different).\n\"unclear\" only when the question itself does not let you decide. Give the reason in one line."
const AUTHOR_SCHEMA = {"type": "object", "required": ["answers"], "properties": {"answers": {"type": "array", "items": {"type": "object", "required": ["ref", "kind", "answer", "solution", "grounded_in"], "properties": {"ref": {"type": "string"}, "kind": {"enum": ["value", "drawing", "explanation"]}, "answer": {"type": "string"}, "solution": {"type": "array", "items": {"type": "string"}}, "grounded_in": {"type": "array", "items": {"type": "string"}}}}}}}
const RESOLVE_SCHEMA = {"type": "object", "required": ["answers"], "properties": {"answers": {"type": "array", "items": {"type": "object", "required": ["ref", "kind", "answer"], "properties": {"ref": {"type": "string"}, "kind": {"enum": ["value", "drawing", "explanation"]}, "answer": {"type": "string"}}}}}}
const JUDGE_SCHEMA = {"type": "object", "required": ["verdicts"], "properties": {"verdicts": {"type": "array", "items": {"type": "object", "required": ["ref", "verdict", "reason"], "properties": {"ref": {"type": "string"}, "verdict": {"enum": ["equivalent", "different", "unclear"]}, "reason": {"type": "string"}}}}}}
const FILES = 'Open every file this message names with the Read tool before answering.'

let out = {}
if (ARGS.mode === 'judge') {
  phase('Judge')
  out.judge = await agent(`${ARGS.judge.kind === 'generated' ? JUDGE_GENERATED : JUDGE}\n\n${ARGS.judge.material}`, { label: `judge:${ARGS.judge.label}`, phase: 'Judge', model: MODEL, schema: JUDGE_SCHEMA })
} else {
  const groups = await pipeline(ARGS.groups, async (g) => {
    const jobs = [() => agent(`${RESOLVE}\n\n${FILES}\n\n${g.material}`, { label: `resolve:${g.label}`, phase: 'Re-solve', model: MODEL, schema: RESOLVE_SCHEMA })]
    if (ARGS.mode === 'answer') jobs.unshift(() => agent(`${AUTHOR}\n\n${FILES}\n\n${g.material}`, { label: `author:${g.label}`, phase: 'Author', model: MODEL, schema: AUTHOR_SCHEMA }))
    const res = await parallel(jobs)
    return ARGS.mode === 'answer' ? { label: g.label, authored: res[0], resolved: res[1] } : { label: g.label, resolved: res[0] }
  })
  out.groups = groups.filter(Boolean)
}
return { stage: 'S3-answers', workflow: 'answers', mode: ARGS.mode, prompts_version: PROMPTS_VERSION,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), ...out }

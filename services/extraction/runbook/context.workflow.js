export const meta = {
  name: 'context',
  description: "After G1: two blind readings sort a lesson's linking text into real-life openers, concept introductions and the rest, file each under an approved objective, and name the book questions set in a real situation",
  whenToUse: 'After book_record_filing.py. Args: `uv run book_record_context.py args <book> <unit>`; accept the saved return with `book_record_context.py accept <book> <unit> <file>`.',
  phases: [
    { title: 'Reading A', detail: 'one agent per lesson: its linking text, open prompts and questions, in the book\'s order (Sonnet, text only)' },
    { title: 'Reading B', detail: 'one agent per lesson, blind to A: the same, in reverse order (Sonnet, text only)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// CONTEXT (book_record_context.py; Tamer, 2026-10-22: "context and real life examples for each learning objective";
// part of the ingestion pipeline by default, no setting). The page reader keeps the book's linking text — the
// real-life story a lesson opens with ("A single E. coli bacterium enters a bloodstream…"), the sentence that
// introduces a concept, and much that is neither (instructions, a worked step, a side note) — and files none of it
// under an objective, so the tutor never sees it. Here two readings, neither seeing the other (B reads in reverse
// order), sort each passage and file it under the objective it introduces, and name the lesson's questions that are
// set in a real situation (the tutor's one "bridge" question per objective). The script writes nothing:
// book_record_context.py accept compares the readings — only an agreement is used; the rest is held for the review
// tool's Context task (decision 47's rule: a doubtful one is never shown).
// ARGS: { stage: 'context', book: {book, title}, lessons: [{slug, title, objectives: [{n, label, description}],
//         passages: [{key, page, type, text}], questions: [{key, type, page, objective, text}]}], options?: {model} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'context-v2'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'context' || !Array.isArray(ARGS.lessons)) throw new Error('args must be the output of `uv run book_record_context.py args <book> <unit>`')
const MODEL = (ARGS.options || {}).model || 'sonnet'

const RULES = `You read one lesson of a school maths textbook (${BOOK.title || BOOK.book}) for a tutor who will open each learning objective with context before asking the student anything. A person has approved the objectives; you never change, add or merge them.

PART 1 — THE PASSAGES. For each passage — the book's linking text and its open prompts — give its kind:
- "real_life": a situation from outside mathematics the book uses to motivate the maths (a doctor's dosing schedule, bacteria doubling, GPS finding a phone). Its maths may be light; what matters is that a student could picture it.
- "concept_intro": the book's own sentence or two introducing WHY or WHAT an idea is ("How do you find the best design when no equation gives one answer? You use inequalities."), with no worked numbers — including the "Guiding question" a lesson opens with.
- "closing_reflection": a question the book asks AFTER the work, to look back on what was learned ("How did breaking the sequence into its parts help?", "If we change the ratio, how does the point move?"). It closes an objective; it never opens one. A question that asks the student to work something out is not one.
- "none": anything else — an instruction ("Solve the following problems", "Work with a partner"), a step of a worked solution, a side note, a formula restated, an example of the method, a heading.
And give the NUMBER of the objective it introduces, or 0 when it introduces the lesson as a whole (a story that sets up several objectives at once). For "none", give 0.
A story or guiding question at the start of a lesson usually introduces the whole lesson (0) unless it is plainly about one objective. A closing reflection goes to the objective it looks back on, or 0 when it looks back on the whole lesson.

PART 2 — THE QUESTIONS. List the keys of the questions SET IN A REAL SITUATION: a word problem about people, money, populations, medicine, travel, building, sport — a context a student could picture. Not a question that is only symbols and numbers, not "find the 5th term of 2, 6, 18, …", not a proof.

why: one short sentence, in the book's terms. Return every passage with its key exactly as given; list only the question keys that qualify.`
const SCHEMA = {"type": "object", "required": ["passages", "real_life_questions"], "properties": {
  "passages": {"type": "array", "items": {"type": "object", "required": ["key", "kind", "objective", "why"], "properties": {
    "key": {"type": "string"}, "kind": {"type": "string", "enum": ["real_life", "concept_intro", "closing_reflection", "none"]}, "objective": {"type": "integer"}, "why": {"type": "string"}}}},
  "real_life_questions": {"type": "array", "items": {"type": "string"}}}}

const objLines = (L) => L.objectives.map((o) => `${o.n}. ${o.label}: ${o.description}`).join('\n')
const passLines = (ps) => ps.map((p) => `[${p.key}] ${p.type || 'linking text'} (p.${p.page}): ${p.text}`).join('\n')
const qLines = (qs) => qs.map((q) => `[${q.key}] ${q.type} (p.${q.page}, objective ${q.objective || '?'}): ${q.text}`).join('\n')
const prompt = (L, ps, qs) => `${RULES}\n\nLesson: ${L.title}\n\nThe objectives:\n${objLines(L)}\n\nTHE PASSAGES (${ps.length}):\n${passLines(ps) || '(none)'}\n\nTHE QUESTIONS (${qs.length}):\n${qLines(qs) || '(none)'}`

const todo = ARGS.lessons.filter((L) => L.passages.length || L.questions.length)
phase('Reading A')
const A = await parallel(todo.map((L) => () => agent(prompt(L, L.passages, L.questions), { label: `context:A:${L.slug}`, phase: 'Reading A', model: MODEL, schema: SCHEMA })))
phase('Reading B')
const B = await parallel(todo.map((L) => () => agent(prompt(L, [...L.passages].reverse(), [...L.questions].reverse()), { label: `context:B:${L.slug}`, phase: 'Reading B', model: MODEL, schema: SCHEMA })))
log(`${todo.length} lesson(s), ${todo.reduce((n, L) => n + L.passages.length, 0)} passage(s), ${todo.reduce((n, L) => n + L.questions.length, 0)} question(s); ${A.filter(Boolean).length + B.filter(Boolean).length} reading(s) returned`)

return { stage: 'context', workflow: 'context', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: BOOK.book, lessons: todo.map((L, i) => ({ slug: L.slug, A: A[i] || null, B: B[i] || null })) }

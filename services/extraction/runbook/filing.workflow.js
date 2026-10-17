export const meta = {
  name: 'filing',
  description: "After G1: two blind readings file each of a lesson's statements, tables and figures under one of the objectives a person approved (or none); where they disagree, a person decides",
  whenToUse: 'After book_record_objectives.py apply. Args: `uv run book_record_filing.py args <book> <unit>`; accept the saved return with `book_record_filing.py accept <book> <unit> <file>`.',
  phases: [
    { title: 'Reading A', detail: 'one agent per lesson: every unfiled item, in the book\'s order (Sonnet, text only)' },
    { title: 'Reading B', detail: 'one agent per lesson, blind to A: the same items in reverse order (Sonnet, text only)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// FILING (book_record_filing.py; Tamer, 2026-10-17: "Sam's way"). Samuel's S1 files a lesson's exercises and worked
// examples under its objectives; on Grade 10 the book's statements get their objective at S2 and its figures at S4,
// both after G1, from agents that read the approved objectives. A book-record lesson's statements, tables and figures
// come from the page reader, filed under its provisional objectives, which G1 replaces. This files them again under
// the approved ones. Two readings, neither seeing the other; B reads the items in reverse order, so an agreement is
// not one reading's order effect. The script writes nothing: the comparison and what a disagreement becomes (the
// review tool's Objectives task, kind "Filing") are book_record_filing.py accept's.
// ARGS: { stage: 'filing', book: {book, title}, lessons: [{slug, title, objectives: [{n, label, description,
//         examples: [string]}], items: [{key, type, page, text}]}], options?: {model} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'file-v1'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'filing' || !Array.isArray(ARGS.lessons)) throw new Error('args must be the output of `uv run book_record_filing.py args <book> <unit>`')
const MODEL = (ARGS.options || {}).model || 'sonnet'

const RULES = `You file the printed items of one lesson of a school maths textbook (${BOOK.title || BOOK.book}) under the lesson's learning objectives. A person has approved the objectives; you never change, add or merge them.
For each item, give the NUMBER of the one objective it teaches, states a rule for, or illustrates: the objective a student is learning when the tutor quotes this definition or rule, or shows this table or figure.
- 0 when it teaches none of them in particular: an introduction to the whole lesson, a general remark, a figure that only decorates, prior knowledge the lesson assumes without teaching it.
- A statement that serves two objectives goes to the one it is printed for: the objective whose worked examples and exercises it sits among, or that uses it first.
- Read each objective's description and the items already filed under it; those show what it covers.
- why: one short sentence, in the book's terms.
Return one row per item, with its key exactly as given.`
const SCHEMA = {"type": "object", "required": ["filing"], "properties": {"filing": {"type": "array", "items": {"type": "object", "required": ["key", "objective", "why"], "properties": {"key": {"type": "string"}, "objective": {"type": "integer"}, "why": {"type": "string"}}}}}}

const objLines = (L) => L.objectives.map((o) => `${o.n}. ${o.label}: ${o.description}` + (o.examples.length ? `\n   already filed here: ${o.examples.join(' | ')}` : '')).join('\n')
const itemLines = (items) => items.map((i) => `[${i.key}] ${i.type} (p.${i.page}): ${i.text}`).join('\n')
const prompt = (L, items) => `${RULES}\n\nLesson: ${L.title}\n\nThe objectives:\n${objLines(L)}\n\nThe items to file (${items.length}):\n${itemLines(items)}`

const todo = ARGS.lessons.filter((L) => L.items.length)
phase('Reading A')
const A = await parallel(todo.map((L) => () => agent(prompt(L, L.items), { label: `filing:A:${L.slug}`, phase: 'Reading A', model: MODEL, schema: SCHEMA })))
phase('Reading B')
const B = await parallel(todo.map((L) => () => agent(prompt(L, [...L.items].reverse()), { label: `filing:B:${L.slug}`, phase: 'Reading B', model: MODEL, schema: SCHEMA })))
log(`${todo.length} lesson(s), ${todo.reduce((n, L) => n + L.items.length, 0)} item(s) to file; ${A.filter(Boolean).length + B.filter(Boolean).length} reading(s) returned`)

return { stage: 'filing', workflow: 'filing', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: BOOK.book, lessons: todo.map((L, i) => ({ slug: L.slug, A: A[i] ? A[i].filing : null, B: B[i] ? B[i].filing : null })) }

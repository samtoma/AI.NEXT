export const meta = {
  name: 'context-gen',
  description: "After S1C: for each objective the book gives no real-life opener, a writer says the lesson's own story serves it or writes one short real-life example from the objective's own maths; a blind checker recomputes it and confirms or rejects",
  whenToUse: 'After book_record_context.py run. Args: `uv run book_record_context.py generate-args <book> <unit>`; accept the saved return with `book_record_context.py generate-accept <book> <unit> <file>`.',
  phases: [
    { title: 'Write', detail: 'one agent per lesson: every objective without a real-life opener (Sonnet, text only)' },
    { title: 'Check', detail: 'one agent per lesson, blind to the writer\'s working: recompute every number, judge fit and safety (Sonnet, text only)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// GENERATED CONTEXT (book_record_context.py generate, S1G; Tamer, 2026-10-22: "implement the generation step for
// context that is missing … as part of the ingestion pipeline"). S1C files the book's own real-life openers; an
// objective the book gives none gets, here, either the lesson's own story (when the writer shows it serves this
// objective too) or ONE short real-life example built only from the objective's own maths — its rules and worked
// examples, as printed. A second agent, who never sees the writer's working, recomputes every number and judges whether
// the example uses only this objective's maths, is true to the world, and suits an Egyptian Grade 11 student. The script
// writes nothing: book_record_context.py generate-accept keeps only what the checker confirms; the rest is held for the
// review tool's Context task (decision 47: a doubtful one is never shown). Stored unreviewed (ADR-0007/0008).
// ARGS: { stage: 'context-gen', book: {book, title, grade}, lessons: [{slug, title, lesson_story: string|null,
//         objectives: [{n, label, description, statements: [string], worked: [string]}], gaps: [n]}], options?: {model} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'context-gen-v1'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'context-gen' || !Array.isArray(ARGS.lessons)) throw new Error('args must be the output of `uv run book_record_context.py generate-args <book> <unit>`')
const MODEL = (ARGS.options || {}).model || 'sonnet'

const WRITE = `You write the real-life opener a tutor uses to start teaching one learning objective of a school maths textbook (${BOOK.title || BOOK.book}, grade ${BOOK.grade || '?'}). The student is an Egyptian secondary student studying in English.

For EACH objective listed under "OBJECTIVES TO OPEN", decide:
- "lesson_story" when the lesson's own story (given below, from the book) already sets this objective up — the objective's maths happens naturally inside that same situation. Say how in "why". Write no new text.
- "generate" otherwise: write ONE short real-life example (2–4 sentences) a student could picture — money in Egyptian pounds, a phone plan, a football league, a bus route, a bakery, a school trip, plants growing, a water tank. Rules:
  * Its mathematics is ONLY this objective's, as the book's statements and worked examples below show it. No method from another objective or a later lesson.
  * Every number is either given in the situation or computed from it with this objective's method; list each computed one in "numbers" with its working and value, and get them exactly right.
  * Use "suppose" / "imagine" for made-up figures. Never present a made-up statistic as a fact about the world, never name a real person, company or brand, never a medical, political or religious claim.
  * End with what the student would be asked to work out, in plain words, without giving the answer.
  * Write maths in $…$, in the book's notation.
- "none" when no honest real-life situation fits this objective (a purely formal idea, a proof technique). Better nothing than a forced story.`
const WRITE_SCHEMA = {"type": "object", "required": ["examples"], "properties": {"examples": {"type": "array", "items": {"type": "object",
  "required": ["objective", "decision", "why"], "properties": {"objective": {"type": "integer"}, "decision": {"type": "string", "enum": ["lesson_story", "generate", "none"]},
  "text": {"type": "string"}, "numbers": {"type": "array", "items": {"type": "object", "required": ["working", "value"], "properties": {"working": {"type": "string"}, "value": {"type": "string"}}}},
  "why": {"type": "string"}}}}}}

const CHECK = `You check real-life openers written for a school maths textbook (${BOOK.title || BOOK.book}, grade ${BOOK.grade || '?'}), for Egyptian secondary students. You did not write them and you are not shown how they were worked out. For EACH item:
- An example ("generate"): work out every number in it yourself from the situation, with the objective's own method. Then judge:
  1. numbers_ok: every number it states or implies is right;
  2. maths_fits: the maths it needs is THIS objective's (its statements and worked examples below), nothing from another objective or a later lesson;
  3. true_to_world: nothing false or presented as fact that is made up; no real person, company or brand; no medical, political or religious claim;
  4. suits_student: clear, short, something an Egyptian Grade ${BOOK.grade || '?'} student can picture; it does not give away the answer.
  verdict "confirmed" only when all four hold; otherwise "rejected" with the reason.
- A "lesson_story" claim: "confirmed" only if the objective's maths really does happen inside the lesson's story as given; otherwise "rejected".
Return one verdict per item, with its objective number.`
const CHECK_SCHEMA = {"type": "object", "required": ["verdicts"], "properties": {"verdicts": {"type": "array", "items": {"type": "object",
  "required": ["objective", "verdict", "why"], "properties": {"objective": {"type": "integer"}, "verdict": {"type": "string", "enum": ["confirmed", "rejected"]},
  "numbers_ok": {"type": "boolean"}, "maths_fits": {"type": "boolean"}, "true_to_world": {"type": "boolean"}, "suits_student": {"type": "boolean"}, "why": {"type": "string"}}}}}}

const objBlock = (o) => `${o.n}. ${o.label}: ${o.description}\n   the book's statements: ${o.statements.join(' | ') || '(none)'}\n   its worked examples: ${o.worked.join(' || ') || '(none)'}`
const lessonHead = (L) => `Lesson: ${L.title}\nThe lesson's own story (from the book): ${L.lesson_story || '(none)'}`
const writePrompt = (L) => `${WRITE}\n\n${lessonHead(L)}\n\nOBJECTIVES TO OPEN:\n${L.objectives.filter((o) => L.gaps.includes(o.n)).map(objBlock).join('\n')}`
const checkPrompt = (L, items) => `${CHECK}\n\n${lessonHead(L)}\n\nTHE OBJECTIVES:\n${L.objectives.filter((o) => L.gaps.includes(o.n)).map(objBlock).join('\n')}\n\nTHE ITEMS:\n${items.map((x) => x.decision === 'lesson_story'
  ? `[objective ${x.objective}] lesson_story — the writer says the lesson's story serves it`
  : `[objective ${x.objective}] generate — ${x.text}`).join('\n')}`

const todo = ARGS.lessons.filter((L) => L.gaps.length)
phase('Write')
const W = await parallel(todo.map((L) => () => agent(writePrompt(L), { label: `context-gen:write:${L.slug}`, phase: 'Write', model: MODEL, schema: WRITE_SCHEMA })))
phase('Check')
const C = await parallel(todo.map((L, i) => () => {
  const items = ((W[i] || {}).examples || []).filter((x) => x.decision !== 'none' && L.gaps.includes(x.objective))
  return items.length ? agent(checkPrompt(L, items), { label: `context-gen:check:${L.slug}`, phase: 'Check', model: MODEL, schema: CHECK_SCHEMA }) : Promise.resolve({ verdicts: [] })
}))
log(`${todo.length} lesson(s), ${todo.reduce((n, L) => n + L.gaps.length, 0)} objective(s) without an opener; ${W.filter(Boolean).length} written, ${C.filter(Boolean).length} checked`)

return { stage: 'context-gen', workflow: 'context-gen', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: BOOK.book, lessons: todo.map((L, i) => ({ slug: L.slug, written: W[i] ? W[i].examples : null, checked: C[i] ? C[i].verdicts : null })) }

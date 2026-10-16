export const meta = {
  name: 'tiers',
  description: "S3 tiers for book records: Grade 10's tier rule, read twice on every book question — once with its answer and worked solution, once blind",
  whenToUse: 'After extraction and answers. Args: `uv run tier_questions.py args <book> <lessons>`; accept the saved return with `tier_questions.py accept <book> <file>`.',
  phases: [
    { title: 'Typing reading', detail: 'the question with its answer and worked solution (Haiku, as S3 Typing)' },
    { title: 'Blind reading', detail: 'the question alone (Sonnet, as S3 Tier check)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// TIERS (tier_questions.py; Tamer, 2026-10-16). The rule is Grade 10's, word for word (runbook/lesson.workflow.js S3
// Typing and S3 Tier check; tests/test_tier_questions.py pins it). Grade 10 re-reads one item in five blind; a book-record
// lesson has a few dozen prompts, so every one is read twice. Neither reading sees the other. The comparison, and what a
// disagreement becomes (the review tool's Question tiers task), is tier_questions.py accept's.
// ARGS: { stage: 'S3-tiers', book: {book}, lessons: [{slug, units: [{ref, type, question, answer, solution: [string]}]}] }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'tier-v2'   // v2: tier_questions.py's two readings as a workflow, prompts unchanged
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
if (ARGS.stage !== 'S3-tiers' || !Array.isArray(ARGS.lessons)) throw new Error('args must be the output of `uv run tier_questions.py args <book> <lessons>`')
const RULE = "basic = one method step; standard = a multi-step application of one method; advanced = methods combined, a word problem, or an end-of-chapter item."
const SYSTEM = "You assign difficulty tiers to textbook items for a Prep-3 (Grade 9) maths course. Return the structured output asked for."
const TIER_SCHEMA = {"type": "object", "required": ["tiers"], "properties": {"tiers": {"type": "array", "items": {"type": "object", "required": ["ref", "tier"], "properties": {"ref": {"type": "string"}, "tier": {"enum": ["basic", "standard", "advanced"]}}}}}}
const ROWS = 'Return one row per item; ref is the item\'s id as shown in brackets, written without the brackets.'

const typingPrompt = (L) => `${SYSTEM}

Assign each book item below a difficulty tier from its QUESTION, its ANSWER and its WORKED SOLUTION: what the steps actually take. tier: ${RULE} Do not read any file.

LESSON ${L.slug}
${L.units.map((u) => `[${u.ref}] (${u.type.replace('_', ' ')})\n  QUESTION: ${u.question}\n  ANSWER: ${u.answer || '(none)'}\n  WORKED SOLUTION: ${(u.solution || []).join(' ⏎ ') || '(none)'}`).join('\n\n')}

${ROWS}`
const blindPrompt = (L) => `${SYSTEM}

Assign each item a difficulty tier: ${RULE} Do not read any file.

${L.units.map((u) => `[${u.ref}] ${u.question}`).join('\n\n')}

${ROWS}`

const lessons = await pipeline(ARGS.lessons, async (L) => {
  const [typing, blind] = await parallel([
    () => agent(typingPrompt(L), { label: `tiers:typing:${L.slug}`, phase: 'Typing reading', model: 'haiku', schema: TIER_SCHEMA }),
    () => agent(blindPrompt(L), { label: `tiers:blind:${L.slug}`, phase: 'Blind reading', model: 'sonnet', schema: TIER_SCHEMA }),
  ])
  const un = (x) => String(x || '').replace(/^\[|\]$/g, '')
  return { slug: L.slug, typing: ((typing && typing.tiers) || []).map((t) => ({ ref: un(t.ref), tier: t.tier })),
           blind: ((blind && blind.tiers) || []).map((t) => ({ ref: un(t.ref), tier: t.tier })) }
})
return { stage: 'S3-tiers', workflow: 'tiers', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  lessons: lessons.filter(Boolean) }

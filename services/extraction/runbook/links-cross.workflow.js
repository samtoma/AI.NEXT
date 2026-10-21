export const meta = {
  name: 'links-cross',
  description: "Prerequisite links INTO EARLIER UNITS only, for a chapter whose objectives G1 has approved: a linker that must quote the step and name the earlier result that justifies it, and an independent checker that applies a removal test",
  whenToUse: 'After G1, to find what a unit needs from earlier units of the same book. Args: `uv run book_record_links.py args <book> <chapter> --cross`; accept with `book_record_links.py accept <book> <chapter> <file>`.',
  phases: [
    { title: 'S1 Cross links', detail: 'links from an earlier unit\'s objective to this unit\'s, each quoting the step and naming the earlier result it rests on (Sonnet)' },
    { title: 'S1 Cross link check', detail: 'a second, independent agent: is the quoted step there, and could it stand WITHOUT the earlier objective? (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// LINKS INTO EARLIER UNITS — links-v2-cross (Tamer, 2026-10-21). A VARIANT of links.workflow.js, which stays Samuel's
// prompts word for word and is untouched. Why a variant: on prep3-parallel his linker proposed 76 links for units 2–10
// and only 7 started in an earlier unit (units 8–10: none, with 65–83 earlier objectives shown), because the book rarely
// writes "recall" or names a section — it USES an earlier result as an unstated step (pp3u10-2 example 1: "m(∠ABM) =
// 90°" on a tangent, Unit 9's tangent ⟂ radius). This variant changes the two prompts only:
//   * the linker looks ONLY for links whose SRC is an earlier chapter's objective, and every link names the STEP it
//     rests on (quoted) and the earlier RESULT that justifies it; an unstated use of an earlier result counts;
//   * the checker adds a removal test: could the quoted step be justified WITHOUT the earlier objective, from this
//     lesson or an earlier part of this unit? Then REJECTED. A fact from an earlier GRADE is never a link.
// Everything else — the packet, the anchors, the schemas, the deterministic checks in assemble_objectives.
// evaluate_links, and the person who keeps or drops each link at G1 — is the same. book_record_links.py adds the
// filters this variant needs (a link the approved graph already implies, a cap per objective).
// ---------------------------------------------------------------------------------------------
// (the original header follows)
// S1 LINKS, ALONE (book_record_links.py; Tamer, 2026-10-18: "fix S1 to pass earlier units' approved objectives, run
// Sam's linker and checker only"). runbook/objectives.workflow.js runs the linker after its finders and reconciler, on
// the objectives it has just derived, and takes `prior_objectives` (the earlier chapters' objectives approved at G1) as
// the only other ids a link may start at. The book-record line ran it with none, so no link could cross a unit. This
// runs his linker and his link checker ONLY, with the chapter's objectives as G1 approved them and the earlier
// chapters' as prior objectives. His prompts, schemas and the text they show are kept word for word (copied below from
// objectives.workflow.js, s1-v5, inline packet form), with one change: the chapter's objectives are read from
// args.objectives (approved, with their app ids) instead of from his reconciler.
// ARGS: { stage: 'S1-links', book: {book, …}, chapter: <the S1 chapter packet, inline>, objectives:
//         {<slug>: [{id, statement}]}, prior_objectives: [{id, statement, lesson}] }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'links-v2-cross (cross-unit linker and removal-test checker)'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
if (ARGS.stage !== 'S1-links' || !ARGS.chapter || !ARGS.objectives) throw new Error('args must be the output of `uv run book_record_links.py args <book> <chapter>`')
const BOOK = ARGS.book || {}
const CH = ARGS.chapter
const CHN = CH.n
const LESSONS = CH.lessons
const CHTAG = `ch${String(CHN).padStart(2, '0')}`
const PRIOR = Array.isArray(ARGS.prior_objectives) ? ARGS.prior_objectives : []
const noFile = (sentence) => sentence

// ---- the packet as text (deterministic) — objectives.workflow.js, unchanged --------------------
const citeNote = (b) => (Array.isArray(b.cite) ? `; cite as: ${b.cite.length ? b.cite.join(' or ') : 'nothing'}` : '')
const blockLine = (b) => `[${b.anchor || b.id}] (${b.type}${b.kind ? ':' + b.kind : ''}${b.term ? ': ' + b.term : ''}, p.${b.printed_page}${citeNote(b)}) ${b.text}`
const weText = (w) => `[${w.anchor}] Worked example ${w.n}: ${w.title} (p.${w.printed_page})\n  QUESTION: ${w.question}\n` +
  w.steps.map((s) => `  - ${s.title ? s.title + ': ' : ''}${s.text}`).join('\n') + (w.loose_solution ? `\n  ${w.loose_solution}` : '')
const provText = (p) => p.sections.map((s) => `${s.number} ${s.title}`).join(' + ') +
  (p.part ? ` (part ${p.part.n} of ${p.part.of})` : '') + (p.chapter_intro ? ' (the chapter introduction, taught as a lesson)' : '')
function chapterContext() {
  const intro = CH.intro.length ? CH.intro.map(blockLine).join('\n') : '(no separate introduction: the first lesson opens the chapter)'
  const summary = CH.summary.length ? CH.summary.map(blockLine).join('\n') : '(none)'
  return `CHAPTER ${CH.n}: ${CH.title}\n\nCHAPTER INTRODUCTION (evidence kind "intro"):\n${intro}\n\nCHAPTER SUMMARY (evidence kind "summary"):\n${summary}`
}
const POOL_HEAD = `END-OF-CHAPTER ITEMS IN THIS LESSON'S SCOPE — the problems only (evidence kind "exercise", anchor = the item id). Cite one only where it practises a skill this lesson's own text or worked examples teach. They are NOT this lesson's items: never list one in exercise_items (the chapter's two blind mappers place every one of them):`
const poolInScope = (l) => CH.pool.filter((p) => (p.scope || []).includes(l.slug))
function lessonText(l, order) {
  const blocks = l.blocks.length ? l.blocks.map(blockLine).join('\n') : '(none)'
  const wes = l.worked_examples.length ? l.worked_examples.map(weText).join('\n\n') : '(none)'
  const items = l.items.length ? l.items.map((i) => `[${i.item_id}] (p.${i.printed_page}) ${i.problem}`).join('\n') : '(none)'
  const mine = poolInScope(l)
  const eoc = mine.length ? mine.map((i) => `[${i.item_id}] (p.${i.printed_page}) ${i.problem}`).join('\n') : '(none)'
  const parts = {
    text: `TEXT, DEFINITIONS AND HEADINGS:\n${blocks}`,
    we: `WORKED EXAMPLES (evidence kind "worked_example", anchor WE<n>):\n${wes}`,
    ex: `EXERCISE ITEMS — the problems only (evidence kind "exercise", anchor = the item id, e.g. Ex8-2:5a, or the question Ex8-2:5 for all its parts):\n${items}`,
    pool: `${POOL_HEAD}\n${eoc}`,
  }
  return `LESSON ${l.slug}: ${l.title}\nBook section: ${provText(l.provenance)}\n\n` + order.map((k) => parts[k]).join('\n\n')
}
const chapterHead = () => chapterContext().split('\n\nCHAPTER INTRODUCTION')[0]

const ANCHORS = {}
const put = (k, v) => { if (k && !(k in ANCHORS)) ANCHORS[k] = v }
for (const b of [...CH.intro, ...CH.summary]) { put(b.id, b.text); put(b.anchor, b.text) }
for (const l of CH.lessons) {
  for (const b of l.blocks) { put(b.id, b.text); put(b.anchor, b.text) }
  for (const w of l.worked_examples) put(w.anchor, `${w.title} ${w.question} ` + w.steps.map((s) => `${s.title} ${s.text}`).join(' ') + ` ${w.loose_solution || ''}`)
  for (const i of l.items) put(i.item_id, i.problem)
}
for (const i of CH.pool) put(i.item_id, i.problem)
const anchorText = (a) => {
  if (a in ANCHORS) return ANCHORS[a]
  const subs = Object.keys(ANCHORS).filter((k) => k.startsWith(a) && /^[a-z]{1,2}$/.test(k.slice(a.length)))
  return subs.length ? subs.map((k) => ANCHORS[k]).join(' | ') : null
}
const unbracket = (ev) => {
  const a = String((ev && ev.anchor) || '').trim()
  const m = /^\[([^\[\]]+)\]$/.exec(a)
  if (!m || anchorText(a) !== null || anchorText(m[1]) === null) return ev
  return Object.assign({}, ev, { anchor: m[1], anchor_written: ev.anchor })
}
const unbracketAll = (evs) => (Array.isArray(evs) ? evs.map(unbracket) : evs)

// ---- prerequisite links — objectives.workflow.js (answer 4), unchanged but for where the objectives come from --
const LINK_EVIDENCE = {
  type: 'object', required: ['kind', 'anchor', 'printed_page', 'quote'],
  properties: {
    kind: { type: 'string', enum: ['text', 'worked_example', 'exercise'] },
    anchor: { type: 'string' }, printed_page: { type: 'integer' }, quote: { type: 'string' },
  },
}
const LINK_SCHEMA = {
  type: 'object', required: ['links', 'outside_book'],
  properties: {
    links: { type: 'array', items: {
      type: 'object', required: ['src', 'dst', 'signal', 'evidence', 'reason'],
      properties: {
        src: { type: 'string' }, dst: { type: 'string' },
        signal: { type: 'string', enum: ['recall', 'reference', 'uses_method'] },
        evidence: { type: 'array', items: LINK_EVIDENCE }, reason: { type: 'string' },
      } } },
    outside_book: { type: 'array', items: {
      type: 'object', required: ['dst', 'anchor', 'quote'],
      properties: { dst: { type: 'string' }, anchor: { type: 'string' }, printed_page: { type: 'integer' },
        quote: { type: 'string' }, note: { type: 'string' } } } },
  },
}
const LINK_CHECK_SCHEMA = {
  type: 'object', required: ['checks'],
  properties: { checks: { type: 'array', items: {
    type: 'object', required: ['i', 'verdict'],
    properties: { i: { type: 'integer' }, verdict: { type: 'string', enum: ['CONFIRMED', 'REJECTED', 'UNCLEAR'] },
      note: { type: 'string' } } } } },
}

const OBJS = ARGS.objectives   // {slug: [{id, statement}]}, as G1 approved them
const objectivesByLesson = () => LESSONS.map((l) => {
  const objs = OBJS[l.slug] || []
  return `${l.slug} — ${l.title} (${provText(l.provenance)}):\n` +
    (objs.length ? objs.map((o) => `  ${o.id}: ${o.statement}`).join('\n') : '  (none)')
}).join('\n')

const priorText = () => PRIOR.length
  ? PRIOR.map((o) => `  ${o.id}: ${o.statement}${o.section ? ` (section ${o.section})` : ''}`).join('\n')
  : '  (none: no earlier chapter has passed G1)'

const linkPrompt = () => `Find what THIS CHAPTER NEEDS FROM EARLIER CHAPTERS OF THIS BOOK: prerequisite links "SRC -> DST" where SRC is one of the EARLIER CHAPTERS' OBJECTIVES below and DST is one of this chapter's. A link means a student cannot do DST without first being able to do SRC. Links between two of this chapter's own objectives are NOT wanted here (they were decided already).

The book shows such a dependency in one of these ways:
- recall: DST's lesson asks the student to recall, revise or remember what SRC teaches;
- reference: DST's lesson refers back to where SRC is taught;
- uses_method: a worked example, exercise or line of text of DST's lesson USES SRC's method or result as a step — INCLUDING WHEN THE BOOK DOES NOT NAME IT. This book rarely writes "recall": it writes the step and moves on. Example: a proof writes "m(∠ABM) = 90°" where AB is a tangent and M the centre — that step rests on the earlier result "a tangent is perpendicular to the radius at the point of contact", so it is evidence for a link from the earlier objective that teaches that result.

${chapterHead()}

THIS CHAPTER'S OBJECTIVES (by lesson; DST must be one of these):
${objectivesByLesson()}

EARLIER CHAPTERS' OBJECTIVES (SRC MUST be one of these):
${priorText()}

THE CHAPTER'S TEXT, WORKED EXAMPLES AND EXERCISE PROBLEMS (cite these anchors):
${LESSONS.map((l) => lessonText(l, ['text', 'we', 'ex'])).join('\n\n')}

Rules:
- Use the ids exactly as listed. SRC is an earlier chapter's objective; DST is this chapter's. Evidence comes from DST's lesson.
- Every link cites 1 to 3 evidence items: kind text | worked_example | exercise, anchor (the id in square brackets at the start of the cited line, WITHOUT the brackets: e.g. b03141, WE9, Ex8-2:5a), printed_page, and quote — a short EXACT span of that anchored text that IS THE STEP relying on SRC (the equation or sentence itself, not a topic word).
- reason MUST be written as: "STEP: <what the quoted step does> | RESULT: <the earlier result from SRC that justifies it, in words> | WHY NOT LOCAL: <why this chapter's own lessons do not already give that result>". A link whose reason cannot fill all three is not a link.
- A link is NOT wanted when: the two objectives only share a topic or a word; the step is justified by something this chapter itself teaches before it; the step only uses arithmetic, algebra or geometry from an earlier GRADE (the angles of a triangle sum to 180°, an isosceles triangle's base angles are equal, solving a linear equation) — list that under outside_book instead; or another, more direct earlier objective is the real source (link the most direct one only).
- Prefer the most specific SRC: the objective that teaches exactly the result the step uses.
- At most 3 links into any one DST: choose the strongest.
- Never link the parts of one split section to each other.
${noFile('Everything you need is in this message; do not read any file.')}

Return LINK_SCHEMA.`

const statementOf = (id) => {
  for (const objs of Object.values(OBJS)) { const o = objs.find((x) => x.id === id); if (o) return o.statement }
  const p = PRIOR.find((x) => x.id === id)
  return p ? p.statement : '(not an objective of this book)'
}

const linkCheckPrompt = (links) => `Check each claimed prerequisite link below. Each claims that a step in the SECOND objective's lesson (dst) rests on a result taught by the FIRST objective (src), in an EARLIER chapter. You decide from the text shown only.
Answer each with three tests, in order:
1. THE STEP IS THERE: the quote is in the anchored text, and it is a step (an equation, a claim, an instruction), not a heading or a topic word. If not: REJECTED.
2. IT USES THE EARLIER RESULT: the step cannot be taken without the result the reason names, and that result is what src teaches. A shared word or topic is not enough. If not: REJECTED.
3. THE REMOVAL TEST: imagine src was never taught. Could a student still justify the step from what dst's own lesson (or an earlier lesson of THIS chapter) states, or from earlier-grade knowledge (triangle angle sum, isosceles triangles, solving linear equations)? If yes: REJECTED — the link is unnecessary.
CONFIRMED only when all three pass. UNCLEAR when you cannot tell. Be strict: when unsure, not CONFIRMED. In note, name the test that decided it. ${noFile('Do not read any file.')}

${links.map((ln, i) => `i=${i}
  first (src)  ${ln.src}: ${statementOf(ln.src)}
  second (dst) ${ln.dst}: ${statementOf(ln.dst)}
  claimed: ${ln.reason || '(no reason given)'}
` + (ln.evidence || []).map((e) => `  cited: ${e.kind} [${e.anchor}] p.${e.printed_page} quote "${e.quote}"
  the anchored text: ${anchorText(e.anchor) === null ? '(NO SUCH ANCHOR IN THE CHAPTER)' : anchorText(e.anchor)}`).join('\n')).join('\n\n')}

Return LINK_CHECK_SCHEMA with one check per i.`

// ---- run ------------------------------------------------------------------------------------------
const nObj = Object.values(OBJS).reduce((n, o) => n + o.length, 0)
log(`chapter ${CHN}: ${LESSONS.length} lessons, ${nObj} approved objective(s), ${PRIOR.length} prior objective(s) a link may start at`)
phase('S1 Cross links')
const linkRes = nObj ? await agent(linkPrompt(), { label: `S1:xlinks:${CHTAG}`, phase: 'S1 Cross links', model: 'sonnet', schema: LINK_SCHEMA }) : null
const proposed = ((linkRes && linkRes.links) || []).map((ln) => Object.assign({}, ln, { evidence: unbracketAll(ln.evidence) }))
let linkChecks = null
if (proposed.length) {
  phase('S1 Cross link check')
  linkChecks = await agent(linkCheckPrompt(proposed), { label: `S1:xlinkcheck:${CHTAG}`, phase: 'S1 Cross link check', model: 'sonnet', schema: LINK_CHECK_SCHEMA })
}
if (nObj && !linkRes) log('the linker returned nothing: run it again')
log(`${proposed.length} link(s) proposed, ${proposed.filter((_, i) => ((linkChecks && linkChecks.checks) || []).some((c) => c.i === i && c.verdict === 'CONFIRMED')).length} confirmed by the checker`)

return {
  stage: 'S1-links', workflow: 'links-cross', prompts_version: PROMPTS_VERSION, book: BOOK.book, chapter: CHN,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  links: { asked: nObj > 0, prior_objectives: PRIOR.length, proposed: linkRes ? proposed : null,
    outside_book: linkRes ? (linkRes.outside_book || []).map(unbracket) : null, checks: linkChecks },
}

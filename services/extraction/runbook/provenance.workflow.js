export const meta = {
  name: 'provenance',
  description: "S2 provenance for book records: each of the book's statements (a definition, rule, method, convention, caution, key term or prior knowledge, in the reader's words) checked against what the page prints where its quote sits (Haiku); what that cannot confirm is re-audited (Sonnet)",
  whenToUse: 'After the page reader, before Label extraction. Args: `uv run book_record_provenance.py args <book> <lessons>`; accept the saved return with `book_record_provenance.py accept <book> <file>`.',
  phases: [
    { title: 'S2 Provenance', detail: 'one agent per printed page: is each statement on it supported by what the page prints, with nothing added? (Haiku, vision)' },
    { title: 'S2 Re-audit', detail: 'one agent per page with statements the first check could not confirm (Sonnet, vision)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// S2 PROVENANCE (book_record_provenance.py; Tamer, 2026-10-17: "adopt the provenance check, same as the Grade 10 pipeline").
// Samuel's S2 (runbook/lesson.workflow.js, phase 'S2 Provenance') keeps a claim whose quote the anchored text contains;
// every other claim is checked by Haiku against the anchored text, and what Haiku cannot confirm is re-audited by Sonnet,
// with the first check's note; an UNSUPPORTED claim is kept, flagged. His prompts are kept word for word, with one change:
// a page-image book has no text to anchor to, so the anchored text is the printed page itself, read from its image
// (containment needs no model and is book_record_provenance.py's, for an EPUB book's verbatim statements).
// ARGS: { stage: 'S2-provenance', book: {book, title}, pages: [{lesson, printed, image,
//         statements: [{i, id, type, claim, quote}]}], options?: {model, audit_model} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'prov-v1'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
if (ARGS.stage !== 'S2-provenance' || !Array.isArray(ARGS.pages)) throw new Error('args must be the output of `uv run book_record_provenance.py args <book> <lessons>`')
const OPT = ARGS.options || {}
const PROV_SCHEMA = { type: 'object', required: ['checks'], properties: { checks: { type: 'array', items: {
  type: 'object', required: ['i', 'supported'], properties: { i: { type: 'integer' }, supported: { type: 'boolean' }, note: { type: 'string' } } } } } }
const AUDIT_SCHEMA = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: {
  type: 'object', required: ['i', 'verdict'], properties: { i: { type: 'integer' },
    verdict: { type: 'string', enum: ['SUPPORTED', 'UNSUPPORTED'] }, note: { type: 'string' } } } } } }

const PAGE = (P) => `The anchored text is printed page ${P.printed} of a school maths textbook: read the page image with the Read tool first, and judge only from it. Each claim's quote is a few printed words that locate it on the page.\nThe page image: ${P.image}`
const rowOf = (s) => `i=${s.i}\n  claim (${s.type}): ${s.claim}\n  quote locating it: "${s.quote}"`

const pages = ARGS.pages.filter((P) => P.statements.length)
phase('S2 Provenance')
const first = await parallel(pages.map((P) => () => agent(
  `For each claim below: is it supported by the anchored text shown — stated there, or shown by it, with nothing added? Judge only from the text shown; when unsure, false.\n\n${PAGE(P)}\n\n${P.statements.map(rowOf).join('\n\n')}\n\nReturn PROV_SCHEMA with one check per i.`,
  { label: `S2:prov:${P.lesson}:p${P.printed}`, phase: 'S2 Provenance', model: OPT.model || 'haiku', effort: 'low', schema: PROV_SCHEMA })))

const verdict = pages.map((P, k) => Object.fromEntries(((first[k] && first[k].checks) || []).map((c) => [c.i, c])))
const doubts = pages.map((P, k) => P.statements.filter((s) => !(verdict[k][s.i] && verdict[k][s.i].supported)))
phase('S2 Re-audit')
const audit = await parallel(pages.map((P, k) => () => doubts[k].length ? agent(
  `Re-audit these claims, which a first check could not confirm. SUPPORTED only if the anchored text states or shows the claim with nothing added; otherwise UNSUPPORTED.\n\n${PAGE(P)}\n\n` +
  doubts[k].map((s) => `${rowOf(s)}\n  first check said: ${(verdict[k][s.i] && verdict[k][s.i].note) || 'no verdict'}`).join('\n\n') + '\n\nReturn AUDIT_SCHEMA.',
  { label: `S2:audit:${P.lesson}:p${P.printed}`, phase: 'S2 Re-audit', model: OPT.audit_model || 'sonnet', schema: AUDIT_SCHEMA }) : null))

const results = []
pages.forEach((P, k) => {
  const v2 = Object.fromEntries(((audit[k] && audit[k].verdicts) || []).map((v) => [v.i, v]))
  for (const s of P.statements) {
    const v1 = verdict[k][s.i]
    if (v1 && v1.supported) results.push({ id: s.id, page: P.printed, provenance: 'checked', note: v1.note || '' })
    else if (v2[s.i] && v2[s.i].verdict === 'SUPPORTED') results.push({ id: s.id, page: P.printed, provenance: 're-audited', first_note: (v1 && v1.note) || 'no verdict', note: v2[s.i].note || '' })
    else results.push({ id: s.id, page: P.printed, provenance: 'unsupported', first_note: (v1 && v1.note) || 'no verdict', note: (v2[s.i] && v2[s.i].note) || 'no verdict' })
  }
})
log(`${pages.length} page(s), ${results.length} statement(s): ${results.filter((r) => r.provenance === 'checked').length} checked, ${results.filter((r) => r.provenance === 're-audited').length} re-audited, ${results.filter((r) => r.provenance === 'unsupported').length} unsupported`)

return { stage: 'S2-provenance', workflow: 'provenance', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: (ARGS.book || {}).book, results }

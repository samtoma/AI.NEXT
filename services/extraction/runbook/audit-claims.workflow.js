export const meta = {
  name: 'audit-claims',
  description: 'Sonnet re-audit of Haiku-flagged claims: re-read the book pages, rule each claim supported / unsupported / wrong',
  phases: [{ title: 'Audit', detail: 'one strong reviewer per lesson re-checks its flagged claims against the book' }],
}

// ---- book config (B1/B20) --------------------------------------------------
// Nothing in this script names a path. The operating session resolves the book
// config and passes it as `args`:
//     uv run book_config.py workflow-args prep3-social-ar [--only a,b]
// Absolute paths exist only in that runtime value, and point at whichever
// checkout the operator stands in — a worktree included (the gitignored source
// PDF is found in the main checkout, read-only).
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book
if (!BOOK || BOOK.book !== 'prep3-social-ar') {
  throw new Error('args.book must be the prep3-social-ar config: run `uv run book_config.py workflow-args ' +
    'prep3-social-ar` in services/extraction and pass its output as this workflow\'s args.')
}
if (!BOOK.paths || !BOOK.paths.pdf) {
  throw new Error(`the source PDF ${BOOK.sources && BOOK.sources.pdf} was not found in this checkout, ` +
    'the main checkout, or $AINEXT_SOURCES_ROOT (it is gitignored: put it in docs/Source/).')
}
const PDF = BOOK.paths.pdf
// The claims to re-audit: collected from the rich-lesson run's provenance output.
// The 2026-07 run's list is committed at runs/prep3-social-ar/audit-claims/2026-07-22.input.json.
const AUDIT = ARGS.audit
if (!Array.isArray(AUDIT) || !AUDIT.length) {
  throw new Error('args.audit must be a non-empty list of {lessonId, pdf, claims:[{claim_ar, cited_page}]}')
}

const SCHEMA = { type: 'object', required: ['lessonId', 'results'], properties: {
  lessonId: { type: 'string' },
  results: { type: 'array', items: { type: 'object', required: ['claim_ar', 'verdict'], properties: {
    claim_ar: { type: 'string' },
    verdict: { type: 'string', enum: ['supported', 'unsupported', 'wrong'] },
    correct_page: { type: 'integer' },
    note: { type: 'string' },
  } } } } }

const prompt = (a) => `أنت مُدقِّق مستقل صارم. أعِد قراءة صفحات الكتاب بعناية واحكم على كل ادعاء.
الملف: ${PDF}
اقرأ صفحات الـPDF (pages): ${a.pdf}.
لكل ادعاء أدناه حدِّد verdict: supported (موجود فعلًا في هذه الصفحات ولو على صفحة مطبوعة مختلفة قليلًا) أو unsupported (لا تجد ما يؤكده إطلاقًا) أو wrong (موجود بمعلومة مختلفة). إن supported على صفحة أخرى اذكر correct_page، وإن wrong اذكر التصحيح في note.

الادعاءات (${a.claims.length}):
${a.claims.map((c, i) => `${i + 1}. [صفحة مذكورة ${c.cited_page}] ${c.claim_ar}`).join('\n')}

أخرج SCHEMA: {lessonId:"${a.lessonId}", results:[...]}.`

const out = await parallel(AUDIT.map((a) => () =>
  agent(prompt(a), { label: `audit:${a.lessonId}`, phase: 'Audit', model: 'sonnet', schema: SCHEMA })))

return { audits: out.filter(Boolean) }

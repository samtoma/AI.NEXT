export const meta = {
  name: 'lesson-map',
  description: "S0, page images: two blind readings of the book's contents pages (units, lessons, printed start pages) and one reading of the printed page number on a few body pages, for the PDF-to-printed-page offset",
  whenToUse: 'A new page-image book, before the page reader. Args: `uv run book_record_lessons.py args <book>`; accept the saved return with `book_record_lessons.py accept <book> <file>`, then a person approves the proposal.',
  phases: [
    { title: 'Contents', detail: 'two readers, neither seeing the other, read every contents page given (Sonnet, vision)' },
    { title: 'Page numbers', detail: 'one agent per probe page reads its printed page number (Haiku, vision)' },
    { title: 'Unit openers', detail: "mode 'openers': is the page before each unit's first lesson that unit's opener? (Haiku, vision)" },
  ],
}

// ---------------------------------------------------------------------------------------------
// S0, LESSON MAP (docs/design/maths-ingestion-pipeline.md; Tamer, 2026-10-16: an S0 scout for page-image books).
// Grade 10's S0 read the EPUB's own structure; a PDF without one has only its printed contents pages. Two readers read
// them blind, as S1's finders do, so a misread start page shows up as a disagreement instead of a wrong lesson. The
// probe pages give the offset (PDF page = printed page + offset). The script never writes a file: the comparison, the
// end pages and the proposal are book_record_lessons.py accept's, and a person approves the proposal (G0).
// ARGS: { stage: 'S0-lesson-map', book: {book, title, language}, contents: [{pdf_page, image}],
//         probes: [{pdf_page, image}] (body pages just after the contents, so they share its numbering),
//         pdf_pages: <int>, options?: {model: 'sonnet'} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'map-v3'   // v2: a unit's strand (Algebra, Statistics); v3: mode 'openers', the page before each unit
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'S0-lesson-map' || (ARGS.mode === 'openers' ? !Array.isArray(ARGS.openers) : !Array.isArray(ARGS.contents) || !ARGS.contents.length)) {
  throw new Error('args must be the output of `uv run book_record_lessons.py args <book>`')
}
const MODEL = (ARGS.options || {}).model || 'sonnet'

const CONTENTS_RULES = `You read the table of contents of a school maths textbook (${BOOK.title || BOOK.book}) and record its structure exactly as printed. You never add, merge or renumber anything.
You are given the images of the book's first pages; some are contents pages, some are not (cover, preface, a unit opener). Read every image with the Read tool, then use only the contents pages.
- units: each printed unit (or chapter) in order: its printed number and title exactly as printed (the unit's subject in brackets, if printed, is part of the title), and the printed page it starts on.
- strand: a heading the contents prints above one or more units ("Algebra", "Statistics", "Geometry") is not a unit: give it as the strand of each unit under it.
- lessons: inside each unit, each printed lesson in order: its printed reference exactly as printed ("Lesson 1-1", "1.2"), its title exactly as printed, and its printed start page. A unit review, test or project that the contents lists as its own entry is a lesson too, with kind "review"; a lesson is kind "lesson".
- start pages are the PRINTED page numbers the contents shows, never a PDF page.
- terms: if the book is printed in terms (First Term, Second Term) give each unit's term as printed; else leave it out.
- contents_pages: which of the given PDF pages are contents pages.
- notes: anything a person should check (a page number you could not read, an entry that looks out of order).`
const CONTENTS_SCHEMA = {"type": "object", "required": ["contents_pages", "units"], "properties": {"contents_pages": {"type": "array", "items": {"type": "integer"}}, "units": {"type": "array", "items": {"type": "object", "required": ["number", "title", "start", "lessons"], "properties": {"number": {"type": "string"}, "title": {"type": "string"}, "start": {"type": ["integer", "null"]}, "term": {"type": "string"}, "strand": {"type": "string"}, "lessons": {"type": "array", "items": {"type": "object", "required": ["ref", "title", "start", "kind"], "properties": {"ref": {"type": "string"}, "title": {"type": "string"}, "start": {"type": ["integer", "null"]}, "kind": {"enum": ["lesson", "review"]}}}}}}}, "notes": {"type": "string"}}}
const PAGE_RULES = 'Read this page image of a textbook with the Read tool. Give the page number PRINTED on the page itself (in a header, footer or corner), as an integer, or null when the page prints none. Never give the position of the page in the file.'
const PAGE_SCHEMA = {"type": "object", "required": ["printed"], "properties": {"printed": {"type": ["integer", "null"]}, "notes": {"type": "string"}}}

const OPENER_RULES = 'Read this page image of a textbook with the Read tool. A contents page lists where each lesson starts but not the pages a unit opens with. Say whether this page belongs to the unit named below as its opener or introduction (a title page for the unit, a picture, a "Do you know?" box, the unit\'s objectives) rather than to the lesson printed before it (its explanations, examples, exercises).'
const OPENER_SCHEMA = {"type": "object", "required": ["opener"], "properties": {"opener": {"type": "boolean"}, "notes": {"type": "string"}}}

// mode 'openers' (book_record_lessons.py run, after the contents are read): the page before each later unit's first lesson
if (ARGS.mode === 'openers') {
  phase('Unit openers')
  const got = await parallel(ARGS.openers.map((o) => () =>
    agent(`${OPENER_RULES}\n\nThe unit: ${o.unit_title}. Its first lesson starts on printed page ${o.printed + 1}; this is printed page ${o.printed}.\nThe page image: ${o.image}`,
      { label: `map:opener:${o.unit}`, phase: 'Unit openers', model: 'haiku', schema: OPENER_SCHEMA })))
  return { stage: 'S0-lesson-map', mode: 'openers', workflow: 'lesson-map', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
    openers: ARGS.openers.map((o, i) => ({ unit: o.unit, printed: o.printed, opener: got[i] ? got[i].opener : null, notes: got[i] ? got[i].notes || '' : 'no answer' })) }
}

const list = (pages) => pages.map((p) => `PDF page ${p.pdf_page}: ${p.image}`).join('\n')
const contentsPrompt = () => `${CONTENTS_RULES}\n\nBook: ${BOOK.title || BOOK.book} (${ARGS.pdf_pages} PDF pages).\nThe page images:\n${list(ARGS.contents)}`

phase('Contents')
const [a, b] = await parallel([
  () => agent(contentsPrompt(), { label: 'map:contents:A', phase: 'Contents', model: MODEL, schema: CONTENTS_SCHEMA }),
  () => agent(contentsPrompt(), { label: 'map:contents:B', phase: 'Contents', model: MODEL, schema: CONTENTS_SCHEMA }),
])
phase('Page numbers')
const probes = await parallel((ARGS.probes || []).map((p) => () =>
  agent(`${PAGE_RULES}\n\nThe page image (PDF page ${p.pdf_page}): ${p.image}`,
    { label: `map:page:${p.pdf_page}`, phase: 'Page numbers', model: 'haiku', schema: PAGE_SCHEMA })))
log(`contents read twice (${(a && a.units || []).length} and ${(b && b.units || []).length} units); ${probes.filter(Boolean).length} page numbers read`)

return { stage: 'S0-lesson-map', workflow: 'lesson-map', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: BOOK.book, pdf_pages: ARGS.pdf_pages, first_unit: ARGS.first_unit || 1, readings: { A: a, B: b },
  probes: (ARGS.probes || []).map((p, i) => ({ pdf_page: p.pdf_page, printed: probes[i] ? probes[i].printed : null, notes: probes[i] ? probes[i].notes || '' : 'no answer' })) }

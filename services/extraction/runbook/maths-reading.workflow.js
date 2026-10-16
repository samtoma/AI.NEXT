export const meta = {
  name: 'maths-reading',
  description: "S0a's second reading for page-image books: one agent per printed page transcribes every formula the first reading recorded, told only where it sits (never what the first reading wrote), so a misread formula shows up as a disagreement",
  whenToUse: 'After the page reader, before G0. Args: `uv run book_record_maths.py args <book> <lessons>`; accept the saved return with `book_record_maths.py accept <book> <file>`; disagreements go to the review tool\'s Maths reading task.',
  phases: [
    { title: 'Second reading', detail: 'one agent per printed page, the page image and the masked places of its formulas (Sonnet, vision)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// MATHS SECOND READING (docs/design/maths-ingestion-pipeline.md; Tamer, 2026-10-16). Grade 10's EPUB carried its maths
// as images that S0b transcribed with two passes and a third on disagreement; a page-image book's maths is read once,
// by the page reader, inside everything else it records. This is the page-image route's second pass. Each place is
// given as the item it sits in (type, label, the book's words around it) with EVERY formula of that text masked: ⟨?⟩
// the one to read, ⟨…⟩ the others. The comparison and what a disagreement becomes are book_record_maths.py accept's.
// ARGS: { stage: 'S0a-maths-reading', book: {book, title}, pages: [{lesson, printed, image,
//         places: [{ref, item, field, context}]}], options?: {model: 'sonnet'} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'mread-v3'   // v2: a formula runs over lines and = signs; v3: places located by their printed opening words; an item over a page break is offered each page
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'S0a-maths-reading' || !Array.isArray(ARGS.pages)) {
  throw new Error('args must be the output of `uv run book_record_maths.py args <book> <lessons>`')
}
const MODEL = (ARGS.options || {}).model || 'sonnet'

const RULES = `You transcribe the mathematics printed on one page of a school maths textbook (${BOOK.title || BOOK.book}) as LaTeX. Read the page image with the Read tool first.
You are given a list of places. Each place names the printed item it sits in and the item's words, with every formula masked: ⟨?⟩ is the formula you must read, ⟨…⟩ are other formulas (not yours to read). Find that spot on the page and transcribe exactly the formula printed at ⟨?⟩.
- ⟨?⟩ stands for ALL the mathematics printed in that place, from the words before it to the words after it: it may run over several printed lines, chain several = signs, or hold ∴ (\\therefore) between two statements. Transcribe all of it, never only its first line or first statement.
- Transcribe what is PRINTED, misprints included. Never solve, simplify, complete or correct.
- Keep the book's notation: its brackets, its separators (a comma or a semicolon in a pair), its multiplication sign, its order of terms.
- Only the formula itself: no surrounding words, no $ signs.
- An item that runs over a page break is given to the agent of each of its pages: if its ⟨?⟩ is printed on the other page, set unreadable to true with the note "not on this page".
- If the spot cannot be found or the formula cannot be read, set unreadable to true and say why in notes.
Return one row per place, with its ref exactly as given.`
const SCHEMA = {"type": "object", "required": ["readings"], "properties": {"readings": {"type": "array", "items": {"type": "object", "required": ["ref", "latex"], "properties": {"ref": {"type": "string"}, "latex": {"type": "string"}, "unreadable": {"type": "boolean"}, "notes": {"type": "string"}}}}}}

const placeLine = (p) => `[${p.ref}] ${p.item}, ${p.field}: ${p.context}`

phase('Second reading')
const got = await parallel(ARGS.pages.map((P) => () =>
  agent(`${RULES}\n\nThis is printed page ${P.printed} (lesson ${P.lesson}). The page image: ${P.image}\n\nThe places (${P.places.length}):\n${P.places.map(placeLine).join('\n')}`,
    { label: `maths:${P.lesson}:p${P.printed}`, phase: 'Second reading', model: MODEL, schema: SCHEMA })))
log(`${ARGS.pages.length} page(s), ${ARGS.pages.reduce((n, P) => n + P.places.length, 0)} formula(s); ${got.filter(Boolean).length} page(s) read`)

return { stage: 'S0a-maths-reading', workflow: 'maths-reading', prompts_version: PROMPTS_VERSION, ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  book: BOOK.book, pages: ARGS.pages.map((P, i) => ({ lesson: P.lesson, printed: P.printed, failed: !got[i],
    readings: got[i] ? got[i].readings || [] : [] })) }

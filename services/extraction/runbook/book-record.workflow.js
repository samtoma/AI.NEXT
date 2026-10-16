export const meta = {
  name: 'book-record',
  description: 'S0a, page images: one agent per printed page records everything it prints as book-record items (never solving, adding or correcting); then one text-only agent per lesson files the items under provisional objectives and links each prompt to the figures it needs',
  whenToUse: 'A book with no usable EPUB or text layer. Args: `uv run extract_book_record.py args <book> <lessons>` writes the embedded copy; save the return value and run `extract_book_record.py accept <book> <saved return>`.',
  phases: [
    { title: 'Pages', detail: 'one agent per printed page, in order, reading the page image (Sonnet, vision)' },
    { title: 'Filing', detail: 'per lesson: provisional objectives, each item filed, figure links (Sonnet, text only); S1 replaces the objectives at G1' },
  ],
}

// ---------------------------------------------------------------------------------------------
// S0a, PAGE IMAGES (docs/design/maths-ingestion-pipeline.md; Tamer, 2026-10-16). The page-image route of the one
// source adapter, for a book whose PDF has no usable text layer and no EPUB (Prep-3: 178 pages, 15 with text).
// Pages of one lesson run in order, because a worked example or exercise can run over a page break: each page agent
// is told the previous page's last record. Lessons run in parallel.
// The script never writes a file or an id: extract_book_record.py accept assigns ids (groundtruth/README.md "Ids"),
// joins continuations, resolves links and validates the record. Prompts moved here, word for word, from
// extract_book_record.py ext-v4 (PAGE_SYSTEM, OBJ_SYSTEM); the book's title is the args' own.
//
// ARGS: { stage: 'S0a-pages', book: {book, title}, lessons: [{slug, syllabus_ref, title, module, pages: [first, last],
//         images: {"<printed page>": "<absolute path of its image>"}}], options?: {model: 'sonnet'},
//         mode?: 'filing' (filing only, for a saved record: lessons[].items_text holds its item lines) }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'ext-v5'   // v5: the page and filing prompts in this script (ext-v4's, word for word, the book named by args)
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'S0a-pages' || !Array.isArray(ARGS.lessons) || !ARGS.lessons.length) {
  throw new Error('args must be the output of `uv run extract_book_record.py args <book> <lessons>`')
}
const MODEL = (ARGS.options || {}).model || 'sonnet'

const PAGE_RULES = "You read one printed page of a school maths textbook (BOOK_TITLE) and record everything it prints, as structured data. You never solve, add or correct anything: you record what the page prints.\n\nONE RECORD PER PRINTED THING, in reading order (top to bottom; a side column before the main column only when it is printed first, like \"What you'll learn\" and \"Key terms\").\nTypes (use exactly one):\n- definition, rule, caution, convention, method (a printed method box only): a statement. Put it in `claim`, in your words but faithful; a printed formula also in `formula` as $...$.\n- exercise (Drill, Exercise, a \"Complete:\" task, any question for the student), activity (\"Think and Discuss\" points), open_prompt (a printed \"Think\", \"Why?\" with no printed answer): the instruction in `text`, the lettered/numbered sub-questions in `parts` [{label, stem}].\n- worked_example (\"Example n\"): `stem` = the question; `solution` = the printed solution steps; `answer` = the final printed answer; a multi-part example uses `parts` with each part's printed `answer`.\n- figure: a picture that carries maths or that the text refers to. `caption` describes it with every value, label and point read from it.\n- table: `caption` (what it shows, row/column titles), `header` (column headings, corner cell first), `rows` (each row left to right, row label first). Cells exactly as printed.\n- key_term (each printed key term, `term`), printed_objective (the \"What you'll learn\" box, `text`), heading (a printed section heading, `text`), linking_text (prose leading between items, `text`), prior_knowledge (what the page says the student already knows, `text`).\nCOUNTING RULES:\n- Skip page furniture: running headers, page numbers, footers (\"Student's Book\", \"For More Exercises, go to MOE website\" stays as linking_text), decorative pictures, QR codes.\n- Each printed bullet or numbered point of a box is its own statement record.\n- A prompt with its own printed label or box (\"Think\", \"Notice\") printed inside a worked example's frame is its own record with `belongs_to` = that example's key. An unlabelled question inside the stem stays in the stem.\n- Each printed question number is one exercise; its lettered sub-questions are parts. A drill with letters only is one exercise with parts. Nested labels are joined with a space (\"First A\").\n- NUMBERED QUESTIONS ARE SEPARATE RECORDS: points printed 1, 2, 3 in a \"Think and Discuss\" or \"Think\" box are three records (label \"Think and Discuss\", number 1, 2, 3), never one record with parts. Only letters (A, B, C) or labelled things inside ONE question are parts. A worked example's own steps are its `solution`, not parts, unless the book prints labelled sub-questions (\"First:\", \"A\", \"B\").\n- When an exercise or example asks the same thing of several labelled things (points A, B, C, D; points A(3, 3), B(3, -2), \u2026), each is its own part, labelled as printed (\"A\", \"B\", \u2026). A task that also asks for something else (shade a region, draw the net, complete C and O) gets a part for that too (\"region\", \"plot\", \"C\", \"O\"). A worked example's printed answers then go on the parts.\n- A sentence that fixes notation or a name (\"where n denotes the number of elements\", \"X \u00d7 X is written X\u00b2 and read X two\") is a convention, its own record, even inside a numbered box.\n- A worked example's `answer` is only the final answer it prints, as a short value; leave it out when the solution ends without one.\n- A figure or table inside an example: `belongs_to` = the example's key. A printed answer that is a drawing: put the figure's key in the example's (or part's) `answer_figure_keys`.\nFIELDS ON EVERY RECORD:\n- key: \"k1\", \"k2\", \u2026 in reading order on this page.\n- label: the label the book prints for prompts and examples only (\"Example\", \"Drill\", \"Think\", \"Think and Discuss\", \"Exercise\"), else \"\". number: the printed number for that label, else null.\n- quote: a few EXACT printed words (5\u201312) that locate it, misprints and spelling slips included.\n- continues: true only for the first record, when it continues the previous page's last record (same example or exercise running over the page break); then give only what is on this page.\nMATHS in $...$ (LaTeX). Keep the book's notation; where a printed form needs reading, `notation` {printed, normalised}.\nMISPRINTS: if the page prints something plainly wrong (a wrong value in a solution, a missing \"=\", a bracket that does not close, a label that contradicts the text), record it as printed and add to `misprints` [{field, printed, intended, notes}]: field names where it sits (\"stem\", \"solution[1]\", \"caption\", \"quote\", \"rows[2][1]\"), notes say how you know. Spelling slips that change no meaning need no entry.\nNOTES: anything a reviewer should check, e.g. \"point read from the figure; verify\".\nRead the page image with the Read tool first.".replace('BOOK_TITLE', BOOK.title || BOOK.book)
const FILING_RULES = "You draw the \"can do\" learning objectives of one textbook lesson from what it prints. You are given the printed objective box and every printed item (key, type, label, quote, content).\n- Objectives follow the book's teaching order; each is one thing a student can do, phrased \"Find\u2026\", \"Represent\u2026\", \"Decide\u2026\". Usually 3\u20136 for a lesson.\n- Ground them in the printed \"What you'll learn\" box and in what the items actually teach. Never invent content the items do not cover.\n- evidence_keys: the items that teach it; at least two, of different types where possible.\n- item_objective: for every statement, worked example, exercise, activity, open prompt, figure and table, the objective it teaches, by its NUMBER: 1 for the first objective you list, 2 for the second. Headings, key terms, linking text and printed objectives get none.\n- prompt_figures: for every exercise, activity, open prompt and worked example that a student cannot answer without LOOKING at a figure printed apart from it (\"the previous graphical net\", \"which of the following arrow diagrams\", relations shown only in a figure printed just before it), the key(s) of that figure. Not a figure the student is asked to draw, not a figure printed inside the item (marked \"inside\"), and not a figure that only shows the answer."
const PAGE_SCHEMA = {"type": "object", "required": ["records"], "properties": {"records": {"type": "array", "items": {"type": "object", "required": ["key", "type", "quote"], "properties": {"key": {"type": "string"}, "type": {"enum": ["definition", "rule", "caution", "convention", "method", "exercise", "activity", "open_prompt", "worked_example", "figure", "table", "key_term", "printed_objective", "heading", "linking_text", "prior_knowledge"]}, "label": {"type": "string"}, "number": {"type": ["integer", "null"]}, "continues": {"type": "boolean"}, "belongs_to_key": {"type": "string"}, "quote": {"type": "string"}, "claim": {"type": "string"}, "term": {"type": "string"}, "stem": {"type": "string"}, "text": {"type": "string"}, "caption": {"type": "string"}, "header": {"type": "array", "items": {"type": "string"}}, "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}}, "formula": {"type": "string"}, "examples": {"type": "array", "items": {"type": "string"}}, "notation": {"type": "object", "properties": {"printed": {"type": "string"}, "normalised": {"type": "string"}, "notes": {"type": "string"}}}, "parts": {"type": "array", "items": {"type": "object", "required": ["label"], "properties": {"label": {"type": "string"}, "stem": {"type": "string"}, "answer": {"type": "string"}, "solution": {"type": "array", "items": {"type": "string"}}, "answer_figure_keys": {"type": "array", "items": {"type": "string"}}, "notes": {"type": "string"}, "misprints": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "printed": {"type": "string"}, "intended": {"type": "string"}, "notes": {"type": "string"}}}}}}}, "solution": {"type": "array", "items": {"type": "string"}}, "answer": {"type": "string"}, "answer_figure_keys": {"type": "array", "items": {"type": "string"}}, "misprints": {"type": "array", "items": {"type": "object", "properties": {"field": {"type": "string"}, "printed": {"type": "string"}, "intended": {"type": "string"}, "notes": {"type": "string"}}}}, "notes": {"type": "string"}}}}}}
const FILING_SCHEMA = {"type": "object", "required": ["objectives", "item_objective"], "properties": {"objectives": {"type": "array", "items": {"type": "object", "required": ["label", "description", "evidence_keys"], "properties": {"label": {"type": "string"}, "description": {"type": "string"}, "evidence_keys": {"type": "array", "items": {"type": "string"}}}}}, "item_objective": {"type": "array", "items": {"type": "object", "required": ["key", "objective"], "properties": {"key": {"type": "string"}, "objective": {"type": "integer"}}}}, "prompt_figures": {"type": "array", "items": {"type": "object", "required": ["key", "figures"], "properties": {"key": {"type": "string"}, "figures": {"type": "array", "items": {"type": "string"}}}}}}}

// the item line the filing agent reads (extract_book_record.item_summary, ported)
const itemLine = (r) => {
  const body = r.claim || r.stem || r.text || r.caption || r.term || ''
  const parts = (r.parts || []).map((p) => `${p.label}: ${p.stem || ''}`).join('; ')
  const inside = r.belongs_to_key ? ` (inside ${r.belongs_to_key})` : ''
  return `[${r._key}] ${r.type}${r.label ? ' ' + r.label : ''} (p.${r.source_page})${inside}: ${body.slice(0, 240)}${parts ? ' | parts: ' + parts.slice(0, 200) : ''}`
}

async function readPages(L) {
  const [first, last] = L.pages
  const pages = []
  let prev = null
  for (let printed = first; printed <= last; printed++) {
    const img = L.images[String(printed)]
    const ctx = prev ? `The previous page's last record: ${prev.type}${prev.label ? ' ' + prev.label : ''} "${String(prev.quote || '').slice(0, 80)}". If this page starts by continuing it, set continues=true on the first record.`
      : "This is the lesson's first page."
    const prompt = `${PAGE_RULES}

Book: ${BOOK.title || BOOK.book}
Lesson: ${L.syllabus_ref} ${L.title} (${L.module}), printed pages ${first}–${last}.
This is printed page ${printed}. The page image: ${img}
${ctx}
${printed === last ? 'Records on this page that belong to the next lesson or unit: leave them out.\n' : ''}Record everything this page prints for this lesson.`
    const out = await agent(prompt, { label: `page:${L.slug}:p${printed}`, phase: 'Pages', model: MODEL, schema: PAGE_SCHEMA })
    const recs = (out && out.records) || []
    recs.forEach((r) => {
      r._key = `p${printed}-${r.key || recs.length}`
      r.source_page = printed
      r.belongs_to_key = r.belongs_to_key ? `p${printed}-${r.belongs_to_key}` : null
      r.answer_figure_keys = (r.answer_figure_keys || []).map((k) => `p${printed}-${k}`)
      ;(r.parts || []).forEach((p) => { p.answer_figure_keys = (p.answer_figure_keys || []).map((k) => `p${printed}-${k}`) })
    })
    pages.push({ printed, records: recs, failed: !out })
    if (recs.length) prev = recs[recs.length - 1]
  }
  return pages
}

async function fileLesson(L, lines) {
  return agent(`${FILING_RULES}

Lesson: ${L.syllabus_ref} ${L.title}

ITEMS
${lines.join('\n')}`, { label: `filing:${L.slug}`, phase: 'Filing', model: MODEL, schema: FILING_SCHEMA })
}

const lessons = await pipeline(ARGS.lessons, async (L) => {
  if (ARGS.mode === 'filing') return { slug: L.slug, filing: await fileLesson(L, L.items_text || []) }
  phase('Pages')
  const pages = await readPages(L)
  phase('Filing')
  const lines = pages.flatMap((p) => p.records.map(itemLine))
  return { slug: L.slug, pages, filing: await fileLesson(L, lines) }
})
log(`${ARGS.lessons.length} lesson(s); ${lessons.filter(Boolean).length} read`)
return { stage: 'S0a-pages', workflow: 'book-record', prompts_version: PROMPTS_VERSION, book: BOOK.book,
  ...(ARGS.mode ? { mode: ARGS.mode } : {}),
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  lessons: lessons.filter(Boolean), failed_lessons: ARGS.lessons.filter((l, i) => !lessons[i]).map((l) => l.slug) }

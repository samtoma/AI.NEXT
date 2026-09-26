export const meta = {
  name: 'objectives',
  description: 'S1: derive one chapter\'s learning objectives from the book with two blind finders, a reconciler, two blind item mappers, a Haiku evidence check, and the prerequisite links between objectives (a linker and an independent checker)',
  whenToUse: 'A book with objectives_mode "derived", after S0b. Args come from `uv run assemble_objectives.py s1-args <book> --chapter N --by-ref` (compact; or without --by-ref, inline).',
  phases: [
    { title: 'S1 Find', detail: 'two finders per lesson, blind to each other (Sonnet)' },
    { title: 'S1 Reconcile', detail: 'align the two lists; choose evidence, never add it (Sonnet)' },
    { title: 'S1 Map', detail: 'end-of-chapter and shared exercise items to one objective each, by two blind mappers (Sonnet)' },
    { title: 'S1 Evidence', detail: 'is each quote at its anchor, and does it support the objective (Haiku)' },
    { title: 'S1 Links', detail: 'prerequisite links the book evidences (recall, a reference back, a method used before it is taught), each citing its evidence (Sonnet)' },
    { title: 'S1 Link check', detail: 'a second, independent agent confirms or rejects every link from its evidence (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// S1 OBJECTIVES (docs/specs/extraction-pipeline.md §3.4; build item B4, task T334).
//
// Pipeline policy, NOT a requirement: Samuel's decision 12 (ADR-0005 amendment #1). The book
// prints no objectives box, so S1 finds each lesson's objectives in the book and makes every
// one cite where it came from. The CAPS document and outside knowledge are excluded.
//
// Nothing here decides whether an objective is good enough. The workflow gathers; the
// deterministic checks and the review page are `assemble_objectives.py assemble`, and a human
// passes gate G1 per chapter before any later stage runs.
//
// Inputs (all from `args`; the script names no path and no book):
//   args.book            {book, course_id, objectives_mode: "derived", …}
//   args.chapter         the chapter packet: lessons (text blocks, worked examples, exercise
//                        PROBLEMS — never a solution or a printed answer), intro, summary, and
//                        `pool`: the items S1 distributes (end-of-chapter; a split section's
//                        shared set), each with the lessons it may go to
//   args.packet_sha256   echoed back so the assembler can prove what the run read
//   args.options         {second_mapper: true, pool_batch: 60, links: true}
//   args.prior_objectives the objectives of EARLIER chapters already approved at G1
//                        ([{id, statement, lesson, section}]): the only other ids a link may start at
// Teacher-only blocks are not in the packet (FR-4408): assemble_objectives.py leaves them out.
//
// PACKET BY REFERENCE (`s1-args --by-ref`, services/extraction/packet_ref.py). Instead of
// args.chapter, the args carry args.by_ref {dir, stage, shards_sha256, files, pool_batch} and
// args.chapter_ref: the chapter reduced to what this script's control flow reads (lesson slugs,
// titles, provenance, item ids, worked-example anchors, the pool's size and batch, the ANCHORS key
// order). The text lives in shard files under by_ref.dir, each exactly what a prompt below used to
// carry inline, and the prompt shows [[file: <path>]] in its place:
//   context.txt            chapterContext()                  lessons/<slug>.A.txt / .B.txt  lessonText
//   pool/b0001.txt …       one mapper batch's item lines     anchors/a0001.txt …           ANCHORS[key]
// This script never reads them (it cannot); the agents do, and they may open nothing else. The
// blind rules hold as inline: every shard is written before any agent runs, so none holds an
// agent's output, and each prompt names only the shards whose text it used to carry.
//
// Independence (rule 5): finder A starts from the headings, introduction and summary; finder B
// from the worked examples and exercises. Neither prompt contains the other's output. Finder
// keys are assigned HERE by position (A1, A2 … / B1, B2 …), not trusted from the model.
//
// Mapping (answer 12, Samuel 2026-09-25): the end-of-chapter and shared items are mapped by TWO
// blind mappers by default (the second with a different framing, neither seeing the other); an
// item they place differently is a decision G1 owes.
//
// Prerequisite links (answer 4, Samuel 2026-09-25): after the objectives are reconciled, a linker
// reads the chapter for the book's own evidence that one objective needs another — "recall",
// a reference back to an earlier section, or a method used before this lesson teaches it — and
// proposes links, each citing that evidence (kind, anchor, page, exact quote). A SECOND agent,
// which never sees the linker's reasons, confirms or rejects each link from the anchored text
// alone. assemble_objectives.py keeps only confirmed links whose evidence checks out, drops any
// link between consecutive parts of one split section (those are DERIVED, never written —
// FR-4317), and G1 approves the links with the objectives.
//
// S1-v4 (the Chapter 8 pilot, run wf_02ba66d9-470, rejected at assembly; 2026-09-26). Causes fixed:
//   * anchors: "copy the bracketed anchor exactly" was read as "with its brackets" ("[EMA69]", "[WE1]").
//     The rules now say the id WITHOUT brackets, and this script strips one pair of brackets from an
//     anchor whose inner id is a known anchor (recorded as `anchor_written`), before any check sees it.
//   * evidence kinds: a text line now says which kinds it may be cited as ("cite as: intro"), from
//     the assembler's own table, so a lesson's paragraph is not cited as a "definition".
//   * the evidence check judged every heading as if it had to demonstrate a method. It now judges each
//     kind by what that kind can show (a heading names the topic; a summary line states the fact).
//   * the reconciler read the finders' evidence as JSON, where a LaTeX backslash is escaped, and lost
//     it when copying ("$\text{1}$" became "$text{1}$"). The evidence is now listed as plain text.
// S1-v5 (Samuel's answer 15 (c), 2026-09-26). The finders ALSO read the end-of-chapter items in their
// lesson's scope (the pool items whose "may go to" includes it), each finder in its own order (A after
// the lesson's exercises, B with the practice before the text), so an objective practised only there
// can be found. They may cite such an item as exercise evidence; they never list one in
// exercise_items: the two blind mappers still place every pool item. The linker does not read them (a
// link's evidence comes from the dependent objective's own lesson). An objective no item ends up
// mapped to is a decision G1 owes (assemble_objectives.py). Answer 15 (b), a G1 verdict that rules an
// end-of-chapter item outside the chapter's objectives, is the assembler's, not this script's.
// Output: save the return value to runs/<book>/objectives/chNN-<runId>.json, then
//   uv run assemble_objectives.py assemble <book> runs/<book>/objectives/chNN-<runId>.json
//   uv run meter_run.py record --book <book> --stage S1 --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 's1-v5'   // v3: packet by reference; v4: the Chapter 8 pilot's fixes (see "S1-v4" below); v5: answer 15 (c)
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
const CH = ARGS.chapter || null                 // inline: the whole chapter packet
const REF = ARGS.by_ref || null                 // by reference: the shard directory …
const CHR = ARGS.chapter_ref || null            // … and the chapter reduced to the control flow's needs
if (CH && (REF || CHR)) {
  throw new Error('give args.chapter (inline) or args.by_ref with args.chapter_ref (by reference), not both')
}
if (!REF !== !CHR) {
  throw new Error('by reference needs both args.by_ref and args.chapter_ref (`s1-args … --by-ref` writes them)')
}
if (ARGS.stage !== 'S1' || !ARGS.packet_sha256 || !((CH && Array.isArray(CH.lessons)) || (CHR && Array.isArray(CHR.lessons)))) {
  throw new Error('args must be the output of `uv run assemble_objectives.py s1-args <book> --chapter N` (with or without --by-ref)')
}
if (REF && !(typeof REF.dir === 'string' && REF.dir.startsWith('/') && REF.shards_sha256)) {
  throw new Error(`args.by_ref must name the absolute shard directory and its shards_sha256: ${JSON.stringify(REF).slice(0, 160)}`)
}
if (BOOK.objectives_mode !== 'derived') {
  throw new Error(`${BOOK.book}: objectives_mode is "${BOOK.objectives_mode}"; S1 derives objectives only for "derived" books`)
}
const OPT = Object.assign({ second_mapper: true, pool_batch: 60, links: true }, ARGS.options || {})
const PRIOR = Array.isArray(ARGS.prior_objectives) ? ARGS.prior_objectives : []
if (REF && OPT.pool_batch !== CHR.pool_batch) {
  throw new Error(`options.pool_batch is ${OPT.pool_batch} but the pool shards were cut in batches of ${CHR.pool_batch}: rebuild with s1-args --by-ref`)
}
// The chapter as the control flow reads it, in either mode.
const CHN = CH ? CH.n : CHR.n
const CHMODULE = CH ? CH.module : CHR.module
const LESSONS = CH ? CH.lessons : CHR.lessons
const POOL_N = CH ? CH.pool.length : CHR.pool_n
const itemIdsOf = (l) => (CH ? l.items.map((i) => i.item_id) : l.item_ids)
const weAnchorsOf = (l) => (CH ? l.worked_examples.map((w) => w.anchor) : l.we_anchors)
const CHTAG = `ch${String(CHN).padStart(2, '0')}`

// ---- packet by reference ------------------------------------------------------------------------
const READ_RULE = 'Parts of this message are kept in files: wherever it shows [[file: <path>]], read that file with the Read tool (read them all in one turn); its whole content belongs in that place. Those files are the only files you may open.'
const refFile = (name) => `[[file: ${REF.dir}/${name}]]`
const noFile = (sentence) => (REF ? READ_RULE : sentence)

// ---- schemas ----------------------------------------------------------------------------------
const EVIDENCE = {
  type: 'object', required: ['kind', 'anchor', 'printed_page', 'quote'],
  properties: {
    kind: { type: 'string', enum: ['heading', 'intro', 'summary', 'definition', 'worked_example', 'exercise'] },
    anchor: { type: 'string' }, printed_page: { type: 'integer' }, quote: { type: 'string' },
  },
}
const FINDER_SCHEMA = {
  type: 'object', required: ['objectives'],
  properties: {
    objectives: { type: 'array', items: {
      type: 'object', required: ['statement', 'label', 'evidence', 'exercise_items', 'worked_examples'],
      properties: {
        statement: { type: 'string' }, label: { type: 'string' },
        evidence: { type: 'array', items: EVIDENCE },
        exercise_items: { type: 'array', items: { type: 'string' } },
        worked_examples: { type: 'array', items: { type: 'string' } },
      } } },
  },
}
const RECONCILE_SCHEMA = {
  type: 'object', required: ['objectives', 'rejected', 'unmapped_items'],
  properties: {
    objectives: { type: 'array', items: {
      type: 'object', required: ['statement', 'label', 'confidence', 'from', 'evidence', 'exercise_items', 'worked_examples', 'terms'],
      properties: {
        statement: { type: 'string' }, label: { type: 'string' },
        confidence: { type: 'string', enum: ['agreed', 'merged', 'single'] },
        from: { type: 'object', required: ['a', 'b'], properties: {
          a: { type: 'array', items: { type: 'string' } }, b: { type: 'array', items: { type: 'string' } } } },
        evidence: { type: 'array', items: EVIDENCE },
        exercise_items: { type: 'array', items: { type: 'string' } },
        worked_examples: { type: 'array', items: { type: 'string' } },
        terms: { type: 'array', items: { type: 'string' } },
        term_flags: { type: 'array', items: { type: 'object', required: ['term', 'why'],
          properties: { term: { type: 'string' }, why: { type: 'string' } } } },
      } } },
    rejected: { type: 'array', items: { type: 'object', required: ['key', 'reason'],
      properties: { key: { type: 'string' }, reason: { type: 'string' } } } },
    unmapped_items: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
const EVIDENCE_CHECK_SCHEMA = {
  type: 'object', required: ['checks'],
  properties: { checks: { type: 'array', items: {
    type: 'object', required: ['objective_n', 'evidence_index', 'present', 'supports'],
    properties: { objective_n: { type: 'integer' }, evidence_index: { type: 'integer' },
      present: { type: 'boolean' }, supports: { type: 'boolean' }, note: { type: 'string' } } } } },
}
const MAP_SCHEMA = {
  type: 'object', required: ['mapping'],
  properties: { mapping: { type: 'array', items: {
    type: 'object', required: ['item_id', 'objective', 'reason'],
    properties: { item_id: { type: 'string' }, objective: { type: 'string' }, reason: { type: 'string' } } } } },
}

// Prerequisite links (answer 4). Evidence kinds differ from an objective's: any anchored text block
// ("text"), a worked example or an exercise item of the DEPENDENT objective's lesson.
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

// ---- the packet as text (deterministic) ---------------------------------------------------------
// `cite`: the evidence kinds the block may be cited as (assemble_objectives.py, from rule 1's table)
const citeNote = (b) => (Array.isArray(b.cite) ? `; cite as: ${b.cite.length ? b.cite.join(' or ') : 'nothing'}` : '')
const blockLine = (b) => `[${b.anchor || b.id}] (${b.type}${b.kind ? ':' + b.kind : ''}${b.term ? ': ' + b.term : ''}, p.${b.printed_page}${citeNote(b)}) ${b.text}`
const weText = (w) => `[${w.anchor}] Worked example ${w.n}: ${w.title} (p.${w.printed_page})\n  QUESTION: ${w.question}\n` +
  w.steps.map((s) => `  - ${s.title ? s.title + ': ' : ''}${s.text}`).join('\n') + (w.loose_solution ? `\n  ${w.loose_solution}` : '')
const provText = (p) => p.sections.map((s) => `${s.number} ${s.title}`).join(' + ') +
  (p.part ? ` (part ${p.part.n} of ${p.part.of})` : '') + (p.chapter_intro ? ' (the chapter introduction, taught as a lesson)' : '')

function chapterContext() {
  if (REF) return refFile('context.txt')
  const intro = CH.intro.length ? CH.intro.map(blockLine).join('\n') : '(no separate introduction: the first lesson opens the chapter)'
  const summary = CH.summary.length ? CH.summary.map(blockLine).join('\n') : '(none)'
  return `CHAPTER ${CH.n}: ${CH.title}\n\nCHAPTER INTRODUCTION (evidence kind "intro"):\n${intro}\n\nCHAPTER SUMMARY (evidence kind "summary"):\n${summary}`
}

// the three reading orders (assemble_objectives.S1_FINDER_ORDER): finder A, finder B, the linker
const ORDER_CODE = { 'text,we,ex,pool': 'A', 'we,ex,pool,text': 'B', 'text,we,ex': 'L' }
const POOL_HEAD = `END-OF-CHAPTER ITEMS IN THIS LESSON'S SCOPE — the problems only (evidence kind "exercise", anchor = the item id). Cite one only where it practises a skill this lesson's own text or worked examples teach. They are NOT this lesson's items: never list one in exercise_items (the chapter's two blind mappers place every one of them):`
const poolInScope = (l) => (CH ? CH.pool.filter((p) => (p.scope || []).includes(l.slug)) : [])
function lessonText(l, order) {
  if (REF) return refFile(`lessons/${l.slug}.${ORDER_CODE[order.join(',')]}.txt`)
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

const chapterHead = () => (REF ? `CHAPTER ${CHN}: ${CHR.title}` : chapterContext().split('\n\nCHAPTER INTRODUCTION')[0])

const RULES = `Rules (the pipeline's; a deterministic checker enforces them after you):
1. Use THIS BOOK ONLY: the text above. Never the CAPS document, another curriculum or your own knowledge of what Grade 10 "should" cover. If the book does not demonstrate or practise a skill, it is not an objective.
2. Every objective cites AT LEAST TWO evidence items of DIFFERENT kinds, and at least one of them is a worked_example or an exercise. Each evidence item: kind, anchor, printed_page (the page shown with it), and quote: a short EXACT span copied from that anchored text (a few words; maths as shown, $…$, backslashes included).
   - anchor: the id shown in square brackets at the start of the cited line, written WITHOUT the brackets (for example EMA69, b03141, WE1, Ex8-2:5a).
   - kind: for a line of text, one of the kinds its line lists after "cite as:" (a lesson's own explanatory paragraph is cited as intro; definition only where the line lists it); worked_example for a worked example; exercise for an exercise item.
3. Every exercise item of the lesson belongs to EXACTLY ONE objective (exercise_items, by item id). Every worked example to at most one (worked_examples, WE<n>). The end-of-chapter items are not the lesson's: cite one as exercise evidence where it practises a skill this lesson teaches — an objective practised only there is still an objective, with two kinds of evidence like any other — but never list one in exercise_items.
4. Use the book's own terms ("gradient", "surd", "mid-point") exactly as printed. Never translate them into another curriculum's vocabulary.
5. Between 2 and 5 objectives. Each statement is what the student CAN DO, in an observable verb the exercises ask for ("calculate", "factorise", "determine") — never "understand", "know" or "appreciate". The label is 2–6 words.
6. Number the objectives in the order the book teaches them.
${noFile('Everything you need is in this message; do not read any file.')}`

const finderPrompt = (l, side) => {
  const lens = side === 'A'
    ? 'Work TOP-DOWN: start from the section headings, the chapter introduction and the chapter summary to see what the book says this lesson teaches, then confirm each candidate against the worked examples and exercises.'
    : 'Work BOTTOM-UP: start from the worked examples and the exercise items — what does the book actually demonstrate and make the student practise? — then find the heading, definition, introduction or summary text that names each skill.'
  const order = side === 'A' ? ['text', 'we', 'ex', 'pool'] : ['we', 'ex', 'pool', 'text']
  return `You are deriving the learning objectives of one lesson of a school mathematics textbook, from the book alone. ${lens}

${chapterContext()}

${lessonText(l, order)}

${RULES}

Return the lesson's objectives (FINDER_SCHEMA): statement, label, evidence, exercise_items, worked_examples.`
}

// Evidence as plain text, never JSON: in JSON a LaTeX backslash is escaped ("\\text"), and a copy
// of it back into the answer loses it (S1-v4). Each quote is everything after "quote: " on its line.
const evLine = (e) => `      - kind=${e.kind} anchor=${e.anchor} printed_page=${e.printed_page} quote: ${e.quote}`
const listForReconciler = (objs, side) => objs.map((o) => `${o.key}: ${o.statement} [${o.label}]
   evidence:
${(o.evidence || []).map(evLine).join('\n') || '      (none)'}
   exercise_items: ${o.exercise_items.join(', ') || '(none)'} · worked_examples: ${o.worked_examples.join(', ') || '(none)'}`).join('\n') || `(finder ${side} returned nothing)`

const reconcilePrompt = (l, a, b) => `Two analysts derived the objectives of lesson ${l.slug} ("${l.title}") independently, blind to each other. Align their lists into one.

LIST A:
${listForReconciler(a, 'A')}

LIST B:
${listForReconciler(b, 'B')}

The lesson's exercise items: ${itemIdsOf(l).join(', ') || '(none)'}
The lesson's worked examples: ${weAnchorsOf(l).join(', ') || '(none)'}

How to reconcile:
- Each output objective lists in "from" the keys it comes from: a: [A-keys], b: [B-keys]. confidence = "agreed" when one A and one B objective are the same objective; "merged" when one side's objective covers several of the other's; "single" when only one finder found it. Never output an objective neither finder found.
- Account for EVERY key of both lists: either in some objective's "from", or in "rejected" with a reason (for example: not an assessable skill, a duplicate, outside the book).
- Evidence: CHOOSE from the two finders' evidence items, copied exactly (kind, anchor, printed_page, quote — the quote is everything after "quote: " on its line, character for character, backslashes included). Never write a new evidence item or change a quote.
- Statement and label: the clearer of the aligned wordings, in the book's own terms. Do not rewrite a term into another curriculum's vocabulary.
- exercise_items: every item above in exactly one objective; list any that fit none in unmapped_items. worked_examples likewise, at most one objective each. An end-of-chapter item a finder cited is evidence only: never put it in exercise_items (the chapter's mappers place those).
- terms: the book's mathematical terms each statement uses (e.g. "gradient", "mid-point", "surd"). term_flags: any term a reader from another curriculum might know by a different name, with why. Flag; never rewrite.
- 2 to 5 objectives, in the order the book teaches them.
Everything you need is in this message; do not read any file.

Return RECONCILE_SCHEMA.`

// ---- anchors for the evidence check (the same index assemble_objectives.py builds) ------------
const ANCHORS = {}
const put = (k, v) => { if (k && !(k in ANCHORS)) ANCHORS[k] = v }
if (CH) {
  for (const b of [...CH.intro, ...CH.summary]) { put(b.id, b.text); put(b.anchor, b.text) }
  for (const l of CH.lessons) {
    for (const b of l.blocks) { put(b.id, b.text); put(b.anchor, b.text) }
    for (const w of l.worked_examples) put(w.anchor, `${w.title} ${w.question} ` + w.steps.map((s) => `${s.title} ${s.text}`).join(' ') + ` ${w.loose_solution || ''}`)
    for (const i of l.items) put(i.item_id, i.problem)
  }
  for (const i of CH.pool) put(i.item_id, i.problem)      // answer 15 (c): citable end-of-chapter items
}
// By reference: the same keys in the same order (args.chapter_ref.anchor_keys); the text of key n
// is the shard anchors/a<n>.txt, and a question cited whole joins its parts' shards with ' | '.
const KEY_N = new Map(REF ? CHR.anchor_keys.map((k, i) => [k, i + 1]) : [])
const anchorShard = (k) => refFile(`anchors/a${String(KEY_N.get(k)).padStart(4, '0')}.txt`)
// A model that copied an anchor WITH its brackets ("[EMA69]"): the one bracket pair is stripped when
// the id inside is a known anchor, and what it wrote is kept as `anchor_written` (S1-v4).
const unbracket = (ev) => {
  const a = String((ev && ev.anchor) || '').trim()
  const m = /^\[([^\[\]]+)\]$/.exec(a)
  if (!m || anchorText(a) !== null || anchorText(m[1]) === null) return ev
  return Object.assign({}, ev, { anchor: m[1], anchor_written: ev.anchor })
}
const unbracketAll = (evs) => (Array.isArray(evs) ? evs.map(unbracket) : evs)
const anchorText = (a) => {
  if (REF) {
    if (KEY_N.has(a)) return anchorShard(a)
    const subs = CHR.anchor_keys.filter((k) => k.startsWith(a) && /^[a-z]{1,2}$/.test(k.slice(a.length)))
    return subs.length ? subs.map(anchorShard).join(' | ') : null
  }
  if (a in ANCHORS) return ANCHORS[a]
  const subs = Object.keys(ANCHORS).filter((k) => k.startsWith(a) && /^[a-z]{1,2}$/.test(k.slice(a.length)))
  return subs.length ? subs.map((k) => ANCHORS[k]).join(' | ') : null
}

const evidencePrompt = (l, objs) => {
  const rows = []
  objs.forEach((o, i) => (o.evidence || []).forEach((e, j) => {
    const text = anchorText(e.anchor)
    rows.push(`objective_n=${i + 1} evidence_index=${j}
  objective: ${o.statement}
  cited: kind=${e.kind} anchor=${e.anchor} p.${e.printed_page} quote="${e.quote}"
  the anchored text: ${text === null ? '(NO SUCH ANCHOR IN THE LESSON PACKET)' : text}`)
  }))
  return `Check evidence cited for the objectives of lesson ${l.slug}. For EACH row below decide:
- present: is the quote (or its exact meaning, allowing for maths written differently) in the anchored text shown? If the anchor does not exist, present=false.
- supports: does the anchored text back this objective in the way its KIND can?
  heading — the heading names this objective's topic or skill: it is the section the book teaches it under. A heading only names; it is not asked to demonstrate or explain. It does NOT support an objective on a different topic that merely shares a word with it.
  intro or definition — the text states, defines or explains something the objective uses or does.
  summary — the summary line states the fact, formula or method the objective uses.
  worked_example — the example demonstrates the skill the objective states.
  exercise — the item makes the student practise the skill the objective states.
Judge only from the text shown. Be strict: when unsure, false. ${noFile('Do not read any file.')}

${rows.join('\n\n') || '(no evidence cited)'}

Return EVIDENCE_CHECK_SCHEMA with one check per row.`
}

const mapPrompt = (items, objectivesByLesson, which) => `Assign each exercise item below to exactly ONE learning objective of this chapter: the objective whose skill the item practises. ${which === 2 ? 'Work independently (you are the second of two blind mappers): for each item, first name in a few words the skill its problem text practises, then choose the objective that states that skill.' : ''}

${chapterHead()}

THE CHAPTER'S OBJECTIVES (by lesson):
${objectivesByLesson}

ITEMS (each may only go to an objective of a lesson listed in its "may go to"):
${REF ? refFile(items.file) : items.map((i) => `[${i.item_id}] (p.${i.printed_page}; may go to: ${i.scope.join(', ')}) ${i.problem}`).join('\n')}

Rules: use the objective ids exactly as listed (lo:…). One objective per item, from an allowed lesson. If an item fits no listed objective, objective = "none" and say why. Give a one-line reason for each. ${noFile('Everything you need is here; do not read any file.')}

Return MAP_SCHEMA with one row per item.`

// ---- prerequisite links (answer 4) ---------------------------------------------------------------
const objectivesByLesson = () => lessonsOut.map((r) => {
  const l = LESSONS.find((x) => x.slug === r.slug)
  const objs = (r.reconciled && r.reconciled.objectives) || []
  return `${r.slug} — ${l.title} (${provText(l.provenance)}):\n` +
    (objs.length ? objs.map((o, k) => `  lo:${r.slug}-${k + 1}: ${o.statement}`).join('\n') : '  (none)')
}).join('\n')

const priorText = () => PRIOR.length
  ? PRIOR.map((o) => `  ${o.id}: ${o.statement}${o.section ? ` (section ${o.section})` : ''}`).join('\n')
  : '  (none: no earlier chapter has passed G1)'

const linkPrompt = () => `Find the PREREQUISITE LINKS between learning objectives that this textbook chapter itself shows. A link "SRC -> DST" means a student must be able to do SRC before DST, and the book shows it in one of three ways:
- recall: DST's lesson asks the student to recall, revise or remember what SRC teaches ("Recall that …", "Remember …", "revision");
- reference: DST's lesson refers back to where SRC is taught ("in section 8.2 we …", "the distance formula we found earlier");
- uses_method: a worked example or exercise of DST's lesson uses SRC's method as a step, without teaching it again.

${chapterHead()}

THIS CHAPTER'S OBJECTIVES (by lesson; DST must be one of these):
${objectivesByLesson()}

EARLIER CHAPTERS' OBJECTIVES (SRC may also be one of these):
${priorText()}

THE CHAPTER'S TEXT, WORKED EXAMPLES AND EXERCISE PROBLEMS (cite these anchors):
${LESSONS.map((l) => lessonText(l, ['text', 'we', 'ex'])).join('\n\n')}

Rules:
- Use the ids exactly as listed. SRC and DST differ. Evidence comes from DST's lesson.
- Every link cites 1 to 3 evidence items: kind text | worked_example | exercise, anchor (the id in square brackets at the start of the cited line, WITHOUT the brackets: e.g. b03141, WE9, Ex8-2:5a), printed_page, and quote (a short EXACT span of that anchored text). Any line of text is kind text here (the "cite as" notes on text lines are for objective evidence, not for links).
- Never link the parts of one split section to each other (part 1 -> part 2): the pipeline adds those itself.
- No link from general knowledge: where the book shows no evidence, there is no link. Fewer, well-evidenced links are right.
- When the book recalls something taught in an earlier GRADE (not in this book), list it under outside_book (dst, anchor, printed_page, quote), not as a link.
${noFile('Everything you need is in this message; do not read any file.')}

Return LINK_SCHEMA.`

const statementOf = (id) => {
  const m = /^lo:(.+)-(\d+)$/.exec(id || '')
  if (m) {
    const r = lessonsOut.find((x) => x.slug === m[1])
    const o = r && r.reconciled && (r.reconciled.objectives || [])[Number(m[2]) - 1]
    if (o) return o.statement
  }
  const p = PRIOR.find((x) => x.id === id)
  return p ? p.statement : '(not an objective of this book)'
}

const linkCheckPrompt = (links) => `Check each claimed prerequisite link below against the book text it cites. You decide from the text shown only.
For each row, CONFIRMED only when the anchored text shows that a student doing the SECOND objective (dst) relies on the FIRST (src): the text recalls it, refers back to it, or uses its method as a step. REJECTED when the text does not show that (a shared word or topic is not enough), or the quote is not in the anchored text. UNCLEAR when you cannot tell. Be strict: when unsure, not CONFIRMED. ${noFile('Do not read any file.')}

${links.map((ln, i) => `i=${i}
  first (src)  ${ln.src}: ${statementOf(ln.src)}
  second (dst) ${ln.dst}: ${statementOf(ln.dst)}
` + (ln.evidence || []).map((e) => `  cited: ${e.kind} [${e.anchor}] p.${e.printed_page} quote "${e.quote}"
  the anchored text: ${anchorText(e.anchor) === null ? '(NO SUCH ANCHOR IN THE CHAPTER)' : anchorText(e.anchor)}`).join('\n')).join('\n\n')}

Return LINK_CHECK_SCHEMA with one check per i.`

// ---- run ------------------------------------------------------------------------------------------
const calls = {}
const count = (phase, slug) => { calls[phase] = calls[phase] || { total: 0, by_lesson: {} }; calls[phase].total += 1; if (slug) calls[phase].by_lesson[slug] = (calls[phase].by_lesson[slug] || 0) + 1 }
const rekey = (res, side) => ((res && res.objectives) || []).map((o, i) => Object.assign({}, o, { key: `${side}${i + 1}`, evidence: unbracketAll(o.evidence) }))
const unbracketRec = (rec) => (rec && Array.isArray(rec.objectives)
  ? Object.assign({}, rec, { objectives: rec.objectives.map((o) => Object.assign({}, o, { evidence: unbracketAll(o.evidence) })) }) : rec)

log(`chapter ${CHN}: ${LESSONS.length} lessons, ${LESSONS.reduce((n, l) => n + itemIdsOf(l).length, 0)} lesson items, ${POOL_N} items to distribute; teacher-only blocks left out: ${ARGS.teacher_only_dropped || 0}` +
  (REF ? `; packet by reference: ${REF.files} shard(s) in ${REF.dir}` : ''))

const reconciledLessons = await pipeline(
  LESSONS,
  (l) => {
    count('S1 Find', l.slug); count('S1 Find', l.slug)
    return parallel([
      () => agent(finderPrompt(l, 'A'), { label: `S1:findA:${l.slug}`, phase: 'S1 Find', model: 'sonnet', schema: FINDER_SCHEMA }),
      () => agent(finderPrompt(l, 'B'), { label: `S1:findB:${l.slug}`, phase: 'S1 Find', model: 'sonnet', schema: FINDER_SCHEMA }),
    ])
  },
  ([ra, rb], l) => {
    const a = rekey(ra, 'A')
    const b = rekey(rb, 'B')
    if (!a.length && !b.length) {
      log(`${l.slug}: both finders returned nothing — S1 must be re-run for it`)
      return { slug: l.slug, finders: { a: ra, b: rb }, reconciled: null }
    }
    count('S1 Reconcile', l.slug)
    return agent(reconcilePrompt(l, a, b), { label: `S1:reconcile:${l.slug}`, phase: 'S1 Reconcile', model: 'sonnet', schema: RECONCILE_SCHEMA })
      .then((rec) => ({ slug: l.slug, finders: { a: { objectives: a }, b: { objectives: b } }, reconciled: unbracketRec(rec) }))
  },
)

// Barrier: the distributed items need every lesson's objectives.
const lessonsOut = LESSONS.map((l, i) => reconciledLessons[i] || { slug: l.slug, finders: null, reconciled: null })
const byLesson = lessonsOut.map((r) => {
  const l = LESSONS.find((x) => x.slug === r.slug)
  const objs = (r.reconciled && r.reconciled.objectives) || []
  return `${r.slug} — ${l.title} (${provText(l.provenance)}):\n` +
    (objs.length ? objs.map((o, k) => `  lo:${r.slug}-${k + 1}: ${o.statement}`).join('\n') : '  (no objectives: this lesson failed S1)')
}).join('\n')

const chunks = []
for (let i = 0; i < POOL_N; i += OPT.pool_batch) {
  chunks.push(REF ? { file: `pool/b${String(chunks.length + 1).padStart(4, '0')}.txt`, n: Math.min(OPT.pool_batch, POOL_N - i) }
    : CH.pool.slice(i, i + OPT.pool_batch))
}
if (chunks.length) log(`distributing ${POOL_N} item(s) in ${chunks.length} batch(es)${OPT.second_mapper ? ', with a blind second mapper' : ''}`)

const mapperRuns = (which) => chunks.map((c, k) => () => {
  count('S1 Map')
  return agent(mapPrompt(c, byLesson, which), { label: `S1:map${which === 2 ? '2' : ''}:${CHTAG}:${k + 1}`, phase: 'S1 Map', model: 'sonnet', schema: MAP_SCHEMA })
})
const evidenceRuns = lessonsOut.map((r) => () => {
  const l = LESSONS.find((x) => x.slug === r.slug)
  if (!r.reconciled || !(r.reconciled.objectives || []).length) return Promise.resolve(null)
  count('S1 Evidence', l.slug)
  return agent(evidencePrompt(l, r.reconciled.objectives), { label: `S1:evidence:${l.slug}`, phase: 'S1 Evidence', model: 'haiku', effort: 'low', schema: EVIDENCE_CHECK_SCHEMA })
})
const m1 = mapperRuns(1)
const m2 = OPT.second_mapper ? mapperRuns(2) : []
const haveObjectives = lessonsOut.some((r) => r.reconciled && (r.reconciled.objectives || []).length)
const linkRun = OPT.links && haveObjectives ? [() => { count('S1 Links'); return agent(linkPrompt(), { label: `S1:links:${CHTAG}`, phase: 'S1 Links', model: 'sonnet', schema: LINK_SCHEMA }) }] : []
const results = await parallel([...evidenceRuns, ...m1, ...m2, ...linkRun])
const linkRes = linkRun.length ? results[results.length - 1] : null
if (linkRun.length) results.pop()
const evid = results.slice(0, evidenceRuns.length)
const merge = (rs) => {
  if (!rs.length || rs.every((r) => !r)) return null
  if (rs.some((r) => !r)) log(`a mapper batch returned nothing: its items stay unmapped and the chapter fails rule 2 until S1 is re-run`)
  return { mapping: rs.filter(Boolean).flatMap((r) => r.mapping || []) }
}
const mappers = [merge(results.slice(evidenceRuns.length, evidenceRuns.length + m1.length)), merge(results.slice(evidenceRuns.length + m1.length))].filter(Boolean)
lessonsOut.forEach((r, i) => { r.evidence_check = evid[i] })

// The link checker: a different agent, which sees each proposed link as a claim and the anchored
// text it cites — never the linker's reason — and confirms it only when that text shows it.
const proposed = ((linkRes && linkRes.links) || []).map((ln) => Object.assign({}, ln, { evidence: unbracketAll(ln.evidence) }))
let linkChecks = null
if (proposed.length) {
  count('S1 Link check')
  linkChecks = await agent(linkCheckPrompt(proposed), { label: `S1:linkcheck:${CHTAG}`, phase: 'S1 Link check', model: 'sonnet', schema: LINK_CHECK_SCHEMA })
}
if (OPT.links && haveObjectives && !linkRes) log('the linker returned nothing: this chapter has no prerequisite links until S1 is re-run (G1 is told)')

const perLesson = {}
for (const [phase, c] of Object.entries(calls)) for (const [s, n] of Object.entries(c.by_lesson)) perLesson[s] = (perLesson[s] || 0) + n
return {
  stage: 'S1', workflow: 'objectives', prompts_version: PROMPTS_VERSION,
  book: BOOK.book, chapter: CHN, module: CHMODULE, packet_sha256: ARGS.packet_sha256,
  ...(REF ? { by_ref: REF } : {}),
  teacher_only_dropped: ARGS.teacher_only_dropped || 0,
  lessons: lessonsOut,
  pool: { items: POOL_N, batches: chunks.length, mappers, second_mapper: !!OPT.second_mapper },
  links: { asked: !!(OPT.links && haveObjectives), prior_objectives: PRIOR.length,
    proposed: linkRes ? proposed : null, outside_book: linkRes ? (linkRes.outside_book || []).map(unbracket) : null,
    checks: linkChecks },
  calls: { by_phase: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v.total])), per_lesson: perLesson,
    total: Object.values(calls).reduce((n, c) => n + c.total, 0) },
  meter: {
    stage: 'S1',
    record: `uv run meter_run.py record --book ${BOOK.book} --stage S1 --run <runId>`,
    summary: `uv run meter_run.py summary --book ${BOOK.book} --by lesson`,
    note: 'Each agent label carries its lesson slug (S1:findA:<slug>), so the ledger splits the cost per lesson; the S1 Map agents are chapter-level ("(book)").',
  },
}

export const meta = {
  name: 'g2-recommend',
  description: 'G2 recommendation run (answers 37a, 42): one Sonnet agent per batch of ~8 book questions the G2 auto-pass HELD (a three-way disagreement) or EXCLUDED (a typing problem) recommends a verdict for each — accept / fix with the book\'s own key re-typed / hold / exclude, with its reason — then one independent Sonnet agent per batch derives the answer itself and confirms every verdict that would put a question live',
  whenToUse: 'After a chapter\'s lessons are closed (fanout.py close-chapter N) and BEFORE its working check and S5 draft are launched. A generated copy: `uv run auto_pass_gates.py g2-recommend-args <book> --chapter N --lesson-run … --embed <copy>` (fanout.py close-chapter prepares it). Run the copy with NO args.',
  phases: [
    { title: 'G2R Recommend', detail: 'one agent per batch of ~8 held/excluded items: derive the answer from the stem, compare with the book\'s printed answer and worked solution, recommend a verdict with a reason (Sonnet, high)' },
    { title: 'G2R Verify', detail: 'one independent agent per batch of verdicts that would put a question live: work the stem alone first, then judge the key (Sonnet, high)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// THE G2 RECOMMENDATION RUN (Samuel's answers 37a and 42: students always full, quality first, every
// decision recorded for his review in the console; the Chapter 8 pilot's G2 recommendations, which an
// agent wrote by hand per disputed item, now as a pipeline stage).
//
// WHAT IT IS FOR. The G2 auto-pass (auto_pass_gates.py g2) decides on the checks' own rule: a typing
// problem is EXCLUDED, a three-way disagreement is HELD with no verdict. Of Chapter 1's 47 held items 42 have the
// printed answer and the book's worked solution equivalent and only the blind solver differs; most of its
// 35 exclusions are text comparisons the key survives. Here an agent reads each such item with everything
// the checks saw and recommends what G2's file records: accept, fix (with the corrected typed fields), hold
// or exclude, each with a class, a confidence and a reason.
//
// GROUNDED. The book is the authority. A recommendation never writes an answer of its own: a key is the
// book's printed answer or the last line of its own worked solution, re-typed, and every accept and fix quotes
// the book span it rests on (auto_pass_gates.py g2-recommend-collect checks the quote against the item's
// book text). The blind re-solve is a witness: a disagreement alone, when the printed answer and the
// worked solution agree and the agent's own derivation confirms the key, is no reason to exclude. When the
// agent's OWN derivation shows the book is wrong the item is a book error: excluded, with the right answer
// written beside it for Samuel (`correct_answer`), never put live and never "fixed" with the agent's answer.
//
// TWO AGENTS FOR EVERY QUESTION THAT WOULD GO LIVE. A wrong live question costs parents' trust for good, so a
// recommendation to accept or fix is not enough: a second, independent agent is given only the question as a
// student sees it, the proposed key and the book's text (never the first agent's reasoning or the blind
// answer), derives its own answer BEFORE it reads the key, and confirms or not. Anything it does not confirm
// is held, never accepted. Exclusions and holds are not verified: they put nothing in front of a student.
//
// WHAT THIS SCRIPT DOES NOT DO. It never edits an item, a G2 file or a database: it returns what the agents
// said, item by item (`results[].rec`, `.ver`). The policy, the validation (the item's typed shape through the
// pipeline's own models, the app's marker over every key, the book quote, a stem repair's size) and the
// recommendation file are `uv run auto_pass_gates.py g2-recommend-collect` (g2_recommend.py), deterministic.
//
// Args (a generated copy carries them, embed_workflow.py): {book: {book, multiplication_dot}, stage: 'G2R',
// prompts_version, chapter, part, parts, batch, verify_batch, model, effort, items_sha256, lessons: {slug: title},
// items: [{key, lesson, state: 'held'|'excluded', why, item: {…the item's facts…}}]}. Items in book order; a
// batch is `batch` consecutive items.
//
// After the run: save the return value to runs/<book>/g2rec/chNN-<runId>.json, then
//   uv run auto_pass_gates.py g2-recommend-collect <book> --chapter N --lesson-run … --run <that file> --out runs/<book>/g2-chNN.recommended.json
//   uv run meter_run.py record --book <book> --stage G2R --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'g2rec-v1'
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
const ITEMS = Array.isArray(ARGS.items) ? ARGS.items : null
if (ARGS.stage !== 'G2R' || !BOOK.book || !ITEMS || !ITEMS.length || !ARGS.embedded) {
  throw new Error('this script runs only as a generated copy: `uv run auto_pass_gates.py g2-recommend-args <book> --chapter N --lesson-run … --embed <copy>`')
}
if (ARGS.prompts_version !== PROMPTS_VERSION) {
  throw new Error(`the args were built for prompts ${ARGS.prompts_version}; this script is ${PROMPTS_VERSION}: rebuild them`)
}
const BATCH = ARGS.batch
const VBATCH = ARGS.verify_batch
const MODEL = ARGS.model
const EFFORT = ARGS.effort
if (!(Number.isInteger(BATCH) && BATCH >= 1 && BATCH <= 12 && Number.isInteger(VBATCH) && VBATCH >= 1 && VBATCH <= 12 &&
      ['sonnet', 'haiku'].includes(MODEL) && ['medium', 'high'].includes(EFFORT))) {
  throw new Error('args must carry batch (1-12), verify_batch (1-12), model (sonnet|haiku) and effort (medium|high): rebuild them')
}
const KEYS = ITEMS.map((e) => e.key)
if (new Set(KEYS).size !== KEYS.length || ITEMS.some((e) => !e.key || !e.item || !['held', 'excluded'].includes(e.state))) {
  throw new Error('args.items must be unique keys, each with an item and a state (held | excluded)')
}

const LETTERS = 'ABCDE'
const MARKER_KINDS = ['expression', 'equation', 'values', 'interval', 'coordinates', 'surd', 'recurring']
const CLASSES = [
  'book answer confirmed',        // accept: the book's answer checks out; the blind solver differs in form, scope or accuracy
  'printed text damaged',         // accept: the PDF text layer lost a bar, an exponent, a fraction; the key follows the EPUB's LaTeX
  'check too strict',             // accept: the typing check's text comparison complains about a key that is right
  'typing error',                 // fix: the book's answer re-typed (type, marker, options)
  'compound answer',              // fix: several true categories — the most specific is the key, the others less_specific
  'selected from a list',         // fix: a list in the stem to select from — typed as values
  'no working',                   // fix: the book prints no working — answer_only
  'several parts',                // fix: several answers of different kinds — teaching only (not_markable)
  'printed answer misaligned',    // fix: the printed answer belongs to another part or lost its place
  'item wording',                 // fix: the stem repaired from the book's own working
  'book error',                   // exclude: your own derivation shows the book's key or working is wrong
  'stem damaged',                 // exclude: the stem as extracted cannot give the book's answer, or the options it names are not in it
  'partial answer',               // exclude: the book answers only part of what the stem asks
  'several accepted answers',     // exclude/hold: the book accepts more than one answer and a single key would mark one right answer wrong
  'marker cannot check',          // hold: sound in the book; the app's marker cannot check this form or read this key today
  'needs the page image',         // hold: only the book's page can settle it
  'unverified',                   // hold: you could not settle it
]

// ---- schemas ------------------------------------------------------------------------------------
const FIX_SCHEMA = {
  type: 'object', properties: {
    answer_type: { type: 'string', enum: ['numeric', 'choice', 'expression', 'not_markable'] },
    key: { type: 'string' },
    marker_kind: { type: 'string', enum: ['', ...MARKER_KINDS] },
    form: { type: 'string', enum: ['', 'factorised', 'expanded', 'simplest', 'subject', 'decimal'] },
    subject: { type: 'string' },
    variables: { type: 'array', items: { type: 'string' } },
    options: { type: 'array', items: { type: 'string' } },
    options_source: { type: 'string', enum: ['', 'stem', 'figure', 'lesson'] },
    less_specific: { type: 'array', items: { type: 'string' } },
    answer_only: { type: 'boolean' },
    not_markable_reason: { type: 'string' },
    printed_answer: { type: 'string' },
    stem: { type: 'string' },
    unit: { type: 'string' },
  },
}
const REC_SCHEMA = {
  type: 'object', required: ['results'], properties: {
    results: {
      type: 'array', items: {
        type: 'object', required: ['key', 'verdict', 'class', 'confidence', 'note'], properties: {
          key: { type: 'string' },
          verdict: { type: 'string', enum: ['accept', 'fix', 'hold', 'exclude'] },
          class: { type: 'string', enum: CLASSES },
          confidence: { type: 'string', enum: ['high', 'low'] },
          note: { type: 'string' },
          why_low: { type: 'string' },
          own_value: { type: 'string' },
          book_quote: { type: 'string' },
          correct_answer: { type: 'string' },
          defect: { type: 'string' },
          fix: FIX_SCHEMA,
        },
      },
    },
  },
}
const VER_SCHEMA = {
  type: 'object', required: ['results'], properties: {
    results: {
      type: 'array', items: {
        type: 'object', required: ['key', 'own_answer', 'verdict', 'other_correct_answers', 'note'], properties: {
          key: { type: 'string' },
          own_answer: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'wrong', 'unsure'] },
          other_correct_answers: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
  },
}

// ---- helpers ------------------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0')
const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const unbr = (x) => String(x == null ? '' : x).trim().replace(/^\[+|\]+$/g, '').trim()
const chunk = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }
const READ_FIGS = (figs) => (figs.length
  ? `YOUR TOOL BUDGET (a hard limit): ONE turn that reads every FIGURE image named below with the Read tool (parallel Read calls), then call StructuredOutput once. No other tool, no other file, no search.`
  : 'You need no tool: do not read any file, then call StructuredOutput once.')

function whereOf(it) {
  const m = /^Ex([\d]+-[\d]+):(.+)$/.exec(it.ref || '')
  if (m) return `Exercise ${m[1]}, question ${m[2]}`
  const w = /^WE(\d+)$/.exec(it.ref || '')
  return w ? `Worked example ${w[1]}` : it.ref
}

function typedOf(it) {
  const t = it.answer_type
  if (t === 'choice') {
    const opts = (it.choices || []).map((c) => `${c.key}. ${c.text}`).join('  |  ')
    const k = it.answer ? (it.choices || []).find((c) => c.key === it.answer) : null
    return `choice (options from: ${it.options_source || 'unknown'}) — ${opts || 'no options'}; key: ${k ? `${k.key} (${k.text})` : 'none: the book\'s answer is not one of the options'}`
  }
  if (t === 'expression') {
    const m = it.marker || {}
    const f = m.form && typeof m.form === 'object' ? `make ${m.form.subject} the subject` : (m.form || 'none')
    return `expression — marker kind ${m.kind || '?'}, form ${f}, variables [${(m.variables || []).join(', ')}], key: ${m.key || '(none)'}`
  }
  if (t === 'numeric') return `numeric — key: ${it.answer || '(none)'}`
  return `not markable — ${it.not_markable_reason || 'no reason given'}`
}

const figPaths = (it) => (it.figures || []).filter((f) => typeof f === 'string' && f.startsWith('/'))

function renderItem(e) {
  const it = e.item
  const figs = figPaths(it)
  const pairs = (it.pairs || []).map((p) => `${p.p}: ${p.v}${p.r ? ` — ${p.r}` : ''}`).join('\n      ')
  const rules = [it.asked_form ? `the stem asks for a form the book's rules name: ${typeof it.asked_form === 'object' ? JSON.stringify(it.asked_form) : it.asked_form}` : '',
    it.printed_form_defect ? 'the printed answer is not in the form the question asks for (a book defect the checks listed)' : '',
    it.raised_dot ? 'this book prints multiplication as a raised dot: the printed answer shows it as " . " between digits; a key writes \\cdot' : ''].filter(Boolean)
  return `[${e.key}] ${whereOf(it)} (page ${it.printed_page == null ? '?' : it.printed_page}) — ${e.state === 'excluded' ? 'EXCLUDED by the checks: the typing check found a problem' : 'HELD by the checks: the three answers disagree'}
  STEM (exactly what a student would read): ${it.stem}
${figs.length ? `  FIGURE image${figs.length > 1 ? 's' : ''} (read ${figs.length > 1 ? 'them' : 'it'}; the stem shows [figure]): ${figs.join(', ')}\n` : ''}  BOOK WORKING (${it.solution_provenance || 'book'}; every line is the book's own, as the EPUB prints it):
${(it.solution || []).map((s, i) => `    ${i + 1}. ${s}`).join('\n')}
  PRINTED ANSWER (the PDF's text layer, FLATTENED: a fraction's two parts sit side by side, "1 3" is one third; a root loses its bar; a power drops to the line, "x2" is x squared; "̸=" is not-equal; a recurring decimal loses its bar): ${it.printed_answer == null ? '(none printed)' : it.printed_answer}
  EPUB FINAL ANSWER (LaTeX from the book's own source): ${it.epub_final_answer ? it.epub_final_answer : '(the EPUB gives none)'}
  BLIND RE-SOLVE (a solver that saw only the stem; a witness, not an authority): ${it.blind_answer == null ? '(none)' : it.blind_answer}
  THE THREE-WAY CHECK:
      ${pairs || '(no pair recorded)'}
  AS THE PIPELINE TYPED IT FOR MARKING: ${typedOf(it)}
  TYPING PROBLEMS THE CHECK REPORTED: ${(it.typing_problems || []).length ? (it.typing_problems || []).join(' ¶ ') : 'none'}${rules.length ? `\n  BOOK RULES: ${rules.join('; ')}` : ''}`
}

function lessonLine(batch) {
  const ls = [...new Set(batch.map((e) => e.lesson))]
  return ls.map((l) => `${l}: ${(ARGS.lessons || {})[l] || ''}`).join('; ')
}

// ---- the recommender's prompt --------------------------------------------------------------------
const recPrompt = (batch) => {
  const figs = batch.flatMap((e) => figPaths(e.item))
  return `You are the G2 reviewer's assistant for a Grade 10 mathematics question bank built from one school textbook (the BOOK). Each item below was held out of the live bank by the automatic checks: either its three independent answers disagreed (the book's printed answer; the answer in the book's own worked solution, from the EPUB; and a blind re-solve by a solver that saw only the stem), or the answer-typing check found a problem with how the item was typed for automatic marking. For EACH item you recommend ONE verdict. A person reviews every verdict afterwards, but until then nothing stands between your verdict and a student, and one wrong question destroys parents' trust for good: when you cannot verify an item, you never accept it.

THE BOOK IS THE AUTHORITY, AND YOU NEVER WRITE AN ANSWER OF YOUR OWN.
- A live question's key is only ever the book's own answer: its printed answer or the last line of its own worked solution, re-typed, never changed in value.
- The blind re-solve is a witness. It reads only the stem: it often answers a different part, gives more than was asked, writes another form, or simply errs. When the book's printed answer and its worked solution AGREE and your own derivation from the stem confirms the key, a blind disagreement alone is NOT a reason to exclude.
- But work every question yourself from its stem before you trust any answer (expand, simplify, substitute; evaluate both sides at a number when in doubt). If YOUR derivation shows the book's key is wrong (the book has errata: a lost exponent, a sign, a wrong coefficient, a step that does not follow, a printed answer that is not in the form the question asks for), the item is a BOOK ERROR: exclude it. Never accept a book error, and never fix it with an answer from you or from the blind solver. Write the right answer in correct_answer and where the book goes wrong in defect, so a person can decide.
- Read the stem as the student will: complete and self-contained? A statement, an option label ("(i)", "(ii)") or a symbol the stem does not show, a figure the question needs that you cannot read, an exponent or sign that looks lost, a part that depends on another part: say so.

THE VERDICTS.
- accept: the item as typed needs no change and the book's key is a correct, complete answer to the stem as it stands. Typical: the blind solver misread, answered more or less than asked, or used another form; the PDF's flattened printed answer lost a bar, an exponent or a fraction while the EPUB's LaTeX is intact; the typing check's complaint is a text comparison ("does not read as the printed answer", "book_final is not in the book solution") over a key that is right. NOT acceptable: a choice whose options were invented, more than 5 options, a key that is not among the options, a numeric key that is not one number.
- fix: the book's answer is right but the item is typed wrongly for marking. Return the item's complete NEW typing in fix (below). A fix changes how the book's answer is typed, never its value.
- exclude: a book error (your derivation, above); a stem that cannot give the book's answer or cannot be answered as it reads and that the book's own working does not let you repair; the book answers only part of what the stem asks and the unmarked part is not a pre-step (a stem that asks for two things whose answer covers one). When the stem asks a pre-step and then a conclusion ("write the next three digits; state whether it is rational") and the book's answer states the conclusion, the choice marks the conclusion: accept, confidence low, why_low naming the part that is not marked; the book accepts more than one answer ("3,7 or 3,8") and a single key would mark a right answer wrong; options that exist only as the typing agent's inventions and cannot be re-typed from the book's own words.
- hold: the item is sound in the book but cannot be checked or shown today, or you could not settle it: the stem asks for a form the app's marker cannot check (a product of prime factors), the key is a value the marker cannot read (the square root of minus one, division by zero, "undefined"), only the book's page image could settle it. Say exactly what is missing. hold is never "probably fine".

HOW TO WORK EACH ITEM, IN THIS ORDER.
1. Read the stem, the figure if one is named, and the book's working line by line.
2. Derive the answer to the stem yourself; write your result in own_value.
3. Compare your result with the book's key (read the printed answer with the EPUB's LaTeX beside it), the EPUB final answer, the working's last line and the blind answer.
4. Decide, and write book_quote: for accept and fix, the exact span (at most 200 characters), copied from the BOOK WORKING, the EPUB FINAL ANSWER or the PRINTED ANSWER above, that states the key. Never a span from the blind answer, never your own.

HOW A FIX IS WRITTEN. fix carries the item's complete new typing and ONLY what the book's own text gives:
- answer_type numeric: the answer is ONE number (integer or decimal; keep the book's decimal comma; leave the unit out). A fraction, a mixed number, a surd or an expression is NOT numeric: it is expression. key is the number.
- answer_type expression: key is the book's answer as LaTeX the app's marker can read (copy the EPUB's LaTeX); marker_kind is expression (algebra; a fraction, a mixed number or a number written as a fraction), equation, values (several answers in any order; also a list in the stem to select from: key "-1; 0; 1; 6"), interval, coordinates, surd or recurring; form only when the stem asks for one (factorised, expanded, simplest, subject with subject = the variable, decimal) — never "a product of prime factors": the app cannot check it, so hold; variables are the letters in the key.
- answer_type choice: ONLY where the options are the book's own: the stem's own alternatives (options_source "stem": every option's text must occur in the stem), the labels a figure shows ("figure"), or a closed set of one-word categories the book itself uses ("lesson": rational / irrational, real / non-real, true / false). 2 to 5 options, key = the exact text of one option, in options. NEVER an option of your own: a number, a pair of numbers or a combination of categories is the book's ANSWER to type (expression or numeric), not an option to invent; and the options a student must choose between must be visible to the student (labels like "(i)" must appear in the stem or in the options themselves).
  A question whose book answer lists SEVERAL true categories ("rational, an integer, a whole number and a natural number") is typed as a choice whose options are the stem's own category words, one per option, key = the MOST SPECIFIC true option and less_specific = the texts of the other options that are also true (a student who picks one is asked to be more precise, never marked wrong). Use it only where the stem names the categories.
- answer_only true (expression items only): the book prints NO working for the item (its solution is just the answer or a sketch instruction) AND the printed answer and the blind answer agree. The tutor then gives no step-by-step explanation.
- answer_type not_markable (with not_markable_reason): the book's answer is a sketch, a proof, a table or several answers of different kinds ("(i) 555 (ii) rational"): the item stays as a teaching example and is never marked.
- stem: ONLY to restore text the book's own worked solution proves was lost or garbled in the stem (the working's first line shows 4×7^b − 3×7^b where the stem shows "+"; the working factorises "(a+4)(a+1)" from "a+5a+4", so an exponent was lost). The book's key stays, the repair is the fewest characters, confidence is low, and the working line is in book_quote. If the working does not show the intended text, do not guess it: exclude.
- printed_answer: ONLY to re-type the printed answer from the EPUB's final answer when the PDF text layer misaligned it.
- answer_type (with its key and the rest of the typing) is needed only when the TYPING changes; a repair of the stem or the printed answer alone leaves it out.
Examples of a complete fix (JSON): a fraction typed as a number: {"answer_type":"expression","key":"-\\\\frac{1}{2}","marker_kind":"expression","form":"","variables":[]}; several true categories: {"answer_type":"choice","key":"isosceles trapezium","options":["parallelogram","trapezium","isosceles trapezium","kite"],"options_source":"stem","less_specific":["trapezium"]}; a list to select from: {"answer_type":"expression","key":"-3; 7; 11","marker_kind":"values","variables":[]}.

confidence: "high" when the maths is checked and the verdict follows from the rules above; "low" when the maths is checked but the choice between verdicts is a content decision a person should make (a partial answer, a stem repair, a teaching-only retype, anything you hesitated over): then why_low says what the decision is. note: at most 60 words, plain, the check you made and what it showed (maths in LaTeX between $…$).

${READ_FIGS(figs)}

LESSON(S): ${lessonLine(batch)}

${batch.map(renderItem).join('\n\n')}

Return REC_SCHEMA with one row per item; key is the item's id as shown in brackets, written without the brackets. Do not omit an item.`
}

// ---- the verifier's prompt -----------------------------------------------------------------------
function finalView(e, rec) {
  const it = e.item
  const fix = rec.verdict === 'fix' ? (rec.fix || {}) : {}
  const type = fix.answer_type || it.answer_type
  const stem = fix.stem || it.stem
  if (type === 'choice') {
    const opts = (fix.options && fix.options.length) ? fix.options : (it.choices || []).map((c) => c.text)
    const keyText = fix.key || ((it.choices || []).find((c) => c.key === it.answer) || {}).text || ''
    const less = fix.less_specific || (it.less_specific || []).map((k) => ((it.choices || []).find((c) => c.key === k) || {}).text)
    return { stem, shown: `a multiple-choice question; the student sees these options: ${opts.map((o, i) => `${LETTERS[i]}. ${o}`).join('   ')}`,
      key: `${keyText}${less && less.length ? `   (also true, but less precise — returned to the student for another try, never marked wrong: ${less.join('; ')})` : ''}` }
  }
  if (type === 'expression') {
    const m = it.marker || {}
    const kind = fix.marker_kind || m.kind
    const form = fix.answer_type ? (fix.form === 'subject' ? `make ${fix.subject} the subject` : fix.form) : (m.form && typeof m.form === 'object' ? `make ${m.form.subject} the subject` : m.form)
    return { stem, shown: `the student types an answer; the marker compares it with the key by value${form ? ` and ALSO requires the form: ${form}` : ''} (marker kind ${kind})`, key: fix.key || m.key }
  }
  if (type === 'numeric') return { stem, shown: 'the student types one number', key: fix.key || it.answer }
  return { stem, shown: 'not marked', key: '' }
}

const verPrompt = (batch, recs) => {
  const figs = batch.flatMap((e) => figPaths(e.item))
  return `You are an independent checker of mathematics questions that are about to be shown to students. For each question below you are given the question exactly as the student will see it, the key the marker will accept as correct, and the textbook's own working and answer for comparison. You do NOT know what anyone else thought of it.

For EACH question, in this order:
1. Work the question yourself from its text alone (and its figure, if one is named). Do the algebra or arithmetic in full; when in doubt, check by substituting or evaluating at a number. Write your own final answer in own_answer BEFORE you look at the key.
2. Then compare with the KEY (for a multiple-choice question, with every option: exactly one option, the key, may be right, apart from any option listed as also true but less precise).
3. verdict:
   confirmed — the key is a correct and complete answer to the question as the student reads it, in the form the question asks for;
   wrong — the key is not a correct answer to the question as printed (a wrong value, a lost exponent, a sign, an error in the book), or the question as printed cannot yield the key; say in note what is right;
   unsure — you cannot settle it (say in note what stops you).
   other_correct_answers: true when a student could give a different answer that is also correct and the marker would call it wrong (two values both acceptable; another equally valid form; two options both true), else false.
4. note: one sentence.
The textbook's working is shown only for comparison: never trust it over your own derivation.

${READ_FIGS(figs)}

${batch.map((e) => {
  const v = finalView(e, recs.get(e.key))
  const it = e.item
  const fs = figPaths(it)
  return `[${e.key}] ${whereOf(it)}
  QUESTION (exactly what the student reads): ${v.stem}
${fs.length ? `  FIGURE image${fs.length > 1 ? 's' : ''} (read ${fs.length > 1 ? 'them' : 'it'}): ${fs.join(', ')}\n` : ''}  HOW IT IS ANSWERED: ${v.shown}
  THE KEY: ${v.key}
  THE BOOK'S WORKING (EPUB): ${(it.solution || []).join(' ⏎ ')}
  THE BOOK'S PRINTED ANSWER (flattened PDF text; "1 3" is one third, "x2" is x squared): ${it.printed_answer == null ? '(none)' : it.printed_answer}   ·   EPUB final answer: ${it.epub_final_answer || '(none)'}`
}).join('\n\n')}

Return VER_SCHEMA with one row per question; key is the question's id as shown in brackets, written without the brackets. Do not omit a question.`
}

// ---- the pipeline ----------------------------------------------------------------------------------
const BATCHES = chunk(ITEMS, BATCH)
const problems = []
// every accept and every fix puts a question in front of students, so it needs a second, independent reading — except a
// teaching-only retype (not_markable), which marks nothing and so has no key to confirm
const needsVerify = (rec) => !!rec && ['accept', 'fix'].includes(rec.verdict) && !(rec.verdict === 'fix' && (rec.fix || {}).answer_type === 'not_markable')
const labelOf = (b, stage, bi, extra) => `G2R:${stage}:b${pad(bi + 1)}${extra || ''}:${b[0].lesson}${b.length > 1 ? `+${b.length - 1}` : ''}`

async function recommend(batch, bi) {
  const got = new Map()
  const asked = new Set(batch.map((e) => e.key))
  let todo = batch
  for (let attempt = 0; attempt < 2 && todo.length; attempt++) {
    const r = await agent(recPrompt(todo), {
      label: labelOf(todo, 'rec', bi, attempt ? ':again' : ''), phase: 'G2R Recommend', model: MODEL, effort: EFFORT, schema: REC_SCHEMA,
    })
    if (!r || !Array.isArray(r.results)) {
      problems.push(`batch ${bi + 1}${attempt ? ' (again)' : ''}: the recommending agent returned nothing`)
      continue
    }
    for (const x of r.results) {
      const k = unbr(x && x.key)
      if (!asked.has(k)) { problems.push(`batch ${bi + 1}: an answer names ${JSON.stringify(cut(String(x && x.key), 60))}, which is not an item of this batch (ignored)`); continue }
      if (got.has(k)) { problems.push(`batch ${bi + 1}: ${k} answered twice (the first kept)`); continue }
      got.set(k, Object.assign({}, x, { key: k }))
    }
    todo = todo.filter((e) => !got.has(e.key))
    if (todo.length && !attempt) log(`batch ${bi + 1}: ${todo.length} of ${batch.length} item(s) unanswered — asking again once`)
  }
  for (const e of todo) problems.push(`${e.key}: the recommending agent gave no verdict for it (re-run it)`)
  return { batch, got }
}

async function verify(rd, bi) {
  const { batch, got } = rd
  const live = batch.filter((e) => needsVerify(got.get(e.key)))
  const vers = new Map()
  if (!live.length) return Object.assign({ vers }, rd)
  for (const [vi, vb] of chunk(live, VBATCH).entries()) {
    const r = await agent(verPrompt(vb, got), {
      label: labelOf(vb, 'ver', bi, vi ? `.${vi + 1}` : ''), phase: 'G2R Verify', model: MODEL, effort: EFFORT, schema: VER_SCHEMA,
    })
    if (!r || !Array.isArray(r.results)) { problems.push(`batch ${bi + 1}: the verifying agent returned nothing (its ${vb.length} verdict(s) are unconfirmed)`); continue }
    const mine = new Set(vb.map((e) => e.key))
    for (const x of r.results) {
      const k = unbr(x && x.key)
      if (!mine.has(k)) { problems.push(`batch ${bi + 1}: a verifier answer names ${JSON.stringify(cut(String(x && x.key), 60))}, not in its batch (ignored)`); continue }
      if (vers.has(k)) { problems.push(`batch ${bi + 1}: ${k} verified twice (the first kept)`); continue }
      vers.set(k, Object.assign({}, x, { key: k }))
    }
  }
  return Object.assign({ vers }, rd)
}

log(`chapter ${ARGS.chapter}${ARGS.parts > 1 ? `, part ${ARGS.part} of ${ARGS.parts}` : ''}: ${ITEMS.length} item(s) (${ITEMS.filter((e) => e.state === 'held').length} held, ${ITEMS.filter((e) => e.state === 'excluded').length} excluded by the checks) in ${BATCHES.length} batch(es) of up to ${BATCH}; ` +
  `a recommending agent and, for every accept or fix, an independent verifying agent per batch (${PROMPTS_VERSION}, ${MODEL}, effort ${EFFORT}); items sha256 ${String(ARGS.items_sha256 || '').slice(0, 12)}`)

phase('G2R Recommend')
const done = await pipeline(BATCHES, (b, _i, bi) => recommend(b, bi), (rd, b, bi) => verify(rd, bi))

const rows = []
done.forEach((d, bi) => {
  if (!d) { problems.push(`batch ${bi + 1}: the batch failed (its ${BATCHES[bi].length} item(s) have no recommendation)`); return }
  for (const e of d.batch) {
    const rec = d.got.get(e.key) || null
    const ver = (d.vers && d.vers.get(e.key)) || null
    rows.push({ key: e.key, state: e.state, rec, ver })
  }
})
const tally = {}
for (const r of rows) {
  const k = r.rec ? `${r.rec.verdict}${needsVerify(r.rec) ? (r.ver ? `/${r.ver.verdict}` : '/unverified') : ''}` : 'no verdict'
  tally[k] = (tally[k] || 0) + 1
}
for (const p of problems) log(p)
log(`${rows.filter((r) => r.rec).length} of ${ITEMS.length} item(s) recommended: ${Object.entries(tally).sort().map(([k, n]) => `${k} ${n}`).join(', ')}. ` +
  `Save this return value as runs/${BOOK.book}/g2rec/ch${pad(ARGS.chapter)}-<runId>.json, then g2-recommend-collect.`)

return {
  stage: 'G2R', workflow: 'g2-recommend', prompts_version: PROMPTS_VERSION, book: BOOK.book,
  chapter: ARGS.chapter, part: ARGS.part || 1, parts: ARGS.parts || 1,
  batch: BATCH, verify_batch: VBATCH, model: MODEL, effort: EFFORT, items_sha256: ARGS.items_sha256 || null, keys: KEYS,
  agents: { recommend: BATCHES.length, verify: done.filter(Boolean).reduce((n, d) => n + Math.ceil(d.batch.filter((e) => needsVerify(d.got.get(e.key))).length / VBATCH), 0) },
  embedded: ARGS.embedded,
  results: rows, tally, problems,
  meter: { stage: 'G2R', record: `uv run meter_run.py record --book ${BOOK.book} --stage G2R --run <runId>` },
}

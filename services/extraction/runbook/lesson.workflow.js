export const meta = {
  name: 'lesson',
  description: 'S2 claims, S3 book questions (the book\'s own solutions, typed for marking, verified three ways), S4 visuals from existing kinds, S8 coverage oracle — per lesson, after G1',
  whenToUse: 'Lessons whose objectives passed G1. Run the copy `uv run embed_workflow.py lesson-args <book> --lessons a,b` writes (scriptPath, no args), or this script with the args `assemble_objectives.py lesson-args` writes.',
  phases: [
    { title: 'S2 Claims', detail: 'claims from the student text; teacher-only material never enters (Sonnet)' },
    { title: 'S2 Provenance', detail: 'paraphrased claims checked at their anchor (Haiku), then re-audited (Sonnet)' },
    { title: 'S3 Typing', detail: 'answer type, marker spec, key and tier from the printed answer (Haiku)' },
    { title: 'S3 Blind re-solve', detail: 'each item solved from its stem alone (Sonnet)' },
    { title: 'S3 Judge', detail: 'equivalence of answers the normaliser could not settle (Sonnet)' },
    { title: 'S3 Tier check', detail: 'blind re-tiering of a sample (Sonnet)' },
    { title: 'S4 Visuals', detail: 'each figure as a spec of an existing VIZ kind, or a gap (Sonnet, vision)' },
    { title: 'S4 Compare', detail: 'does the spec show what the crop shows (Haiku, vision)' },
    { title: 'S8 Oracle', detail: 'every sub-heading covered by claims and questions (Sonnet)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// THE LESSON CONVEYOR (docs/specs/extraction-pipeline.md §3.5–§3.7, §3.11; B6, task T337).
//
// NEVER SOLVED FROM SCRATCH. A worked example keeps the book's printed solution
// (`book_worked`); an exercise takes the worked solution the EPUB carries for it
// (`book_worked_epub`, decision 19, FR-4302). No agent here writes a canonical solution. The
// blind re-solve is a CHECK: an item is `agreed` only when the blind answer, the printed answer
// and the book solution's final answer all agree (FR-4302). An item with no printed answer is
// checked against the book solution alone and listed for G2. A disagreement is never corrected;
// it is held for Samuel at G2.
//
// TEACHER-ONLY MATERIAL (FR-4408). args.lessons[].teacher_only is used ONLY to catch a claim
// that echoes a teacher note; it is never put in any prompt.
//
// ANSWER TYPING (decision 20, FR-4303, FR-4320). numeric | choice (only where natural: the
// options are the stem's own, or the lesson's own closed vocabulary) | expression, with the
// marker spec of specs/003 contracts/answer-marker.md | not_markable (proofs, sketches, "show
// that": teaching material, not a question). Keys are written as the book prints them;
// decision 15's notation is normalised once, at assembly (assemble_lesson_bundle.py).
//
// THE BOOK'S ANSWER RULES (book config `answer_rules`, marked on each item by lesson-args; backlog
// 30/31). The raised dot is multiplication (2·3^x), never a decimal point: keys write \cdot, and a
// key that reads it as a decimal is a typing problem. An item whose stem asks for a form carries
// that form check on its marker spec whatever the typing agent said — but only a form the APP'S
// marker knows (answer-marker.ts FORM_NAMES: factorised, expanded, simplest, decimal; subject on an
// equation). A form it does not know (the book's "product of prime factors") never reaches a spec:
// the item is HELD and listed for G2 until the marker can check it. An item whose printed answer is
// not in the form its question asks for is never corrected here: it is held (disputed) and listed.
// Keys are LaTeX the marker can read: the flattened printed answer ("1 3 x") is read with the book
// solution's LaTeX; assemble_lesson_bundle.py runs the app's marker over every key and holds any
// it cannot mark.
//
// FIGURES (S4). Only kinds that exist in VIZ_SPEC.md; anything else is a viz gap, never forced
// into the nearest kind. An exercise whose figure is a gap is flagged `blocked_on_figure`: a
// student cannot answer it without the figure.
//
// Inputs (all from `args`): book, lessons[] (objectives with their items, text blocks, worked
// examples, items with stem / solution / printed answer, figures with absolute crop paths),
// viz_kinds, options {blind_batch, typing_batch, figures_per_call, tier_sample_every}.
// ARGS IN THE SCRIPT (embed_workflow.py lesson-args, decision of 2026-09-26). A chapter's lesson
// args are ~190 KB, too big to type into the Workflow call, and this script's checks read every
// item's text, so there is no by-reference mode. Instead the builder writes a COPY of this script with
// the args embedded (work/<book>/packets/embedded/lesson.<lessons>.workflow.js), run with scriptPath
// and no args. The copy is this script with its args line replaced; its prompts and checks are these.
// It sets ARGS.embedded {source, source_sha256, args_sha256, generated_sha256}, echoed below as
// `embedded`, so the saved run says which script ran.
// Output: save the return value to runs/<book>/lessons/<runId>.json, then
//   uv run assemble_objectives.py lesson-runs <book> runs/<book>/lessons/<runId>.json [--g2 …]
//   uv run meter_run.py record --book <book> --stage S2-S4,S8 --run <runId>
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'lesson-v8'   // v3: ids are asked for WITHOUT their brackets, and read either way
// v4 (2026-09-26, the Chapter 8 pilot): a choice's options may be the labels a figure shows ("Which point lies
// at (5; −4)?" A–E, shape W–Z): options_source "figure". Only the TYPING prompt changed; on a resume the
// claims replay, and typing and every agent after it run again.
// v5 (2026-09-27, consistency review A8): the visuals prompt carries each figure's question and the rule "a figure
// never draws the unknown, never contradicts the question's numbers, and its caption never changes the question".
// ARGS.visuals_only (A3): run S4 alone, for the figures each lesson lists in rerun_figures (merge_visual_reruns.py).
// v6 (2026-09-27, after the first re-run): an EXERCISE figure withholds its unknown by name ("withheld") and draws the
// rest — Compare accepts exactly that omission; a worked example's figure is drawn whole (it may show its answer);
// every element a figure shows is drawn, or the figure is a gap naming exactly what its kind cannot draw.
// v7: a caption describes only what is drawn — never a withheld point as marked (assembly drops such a clause).
// v8 (2026-10-01, the first Chapter 1 lessons): ONLY the typing prompt changed. A choice's options are never the typing
// agent's to make up: the stem's alternatives, a figure's labels, or a closed set of one-word categories the book itself
// uses (rational / irrational; real / non-real / undefined). A number, a pair of numbers ("4 and 5"), several values or a
// list to select from is numeric or expression (values), never a choice with options placed around the printed answer
// (28 of one lesson's 34 items were). book_final is a quote of the solution's last sentence, a parenthetical left out at
// most — never a summary, never a computation of the agent's own (23 of 96 items of one lesson failed that containment).
// A two-part answer of different kinds is not markable. The collection (COLLECT-6) refuses what this prompt forbids.
// The script's own deterministic collection is versioned apart from the prompts: a change here replays
// every cached agent on a resume (no prompt changed) and re-decides what they answered.
const COLLECT_VERSION = 'collect-6'   // collect-2/-3/-4: the Chapter 8 pilot's S3 fixes (see "COLLECT-2" and "COLLECT-3" below);
                                      // collect-5: an objective id without "lo:" is that objective; a subject form from the book's rule;
                                      // collect-6: the first Chapter 1 lessons (see "COLLECT-6" below): verbal finals, a closed set of
                                      // options, options that were never the book's, a choice that names one option
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book || {}
if (ARGS.stage !== 'S2-S4,S8' || !Array.isArray(ARGS.lessons) || !ARGS.lessons.length) {
  throw new Error('args must be the output of `uv run assemble_objectives.py lesson-args <book> --lessons …`')
}
const OPT = Object.assign({ blind_batch: 16, typing_batch: 30, figures_per_call: 16, tier_sample_every: 5 }, ARGS.options || {})
const VIZ = ARGS.viz_kinds || []
const VIZ_NAMES = VIZ.map((k) => k.kind)
const MARKER_KINDS = ['expression', 'equation', 'values', 'interval', 'coordinates', 'surd', 'recurring']
// the forms the app's marker knows (app/src/lib/answer-marker.ts FORM_NAMES, plus the subject object)
const APP_FORMS = ['factorised', 'expanded', 'simplest', 'decimal']

// ---- schemas ----------------------------------------------------------------------------------
const CLAIMS_SCHEMA = { type: 'object', required: ['claims'], properties: { claims: { type: 'array', items: {
  type: 'object', required: ['lo', 'type', 'text', 'anchor', 'printed_page', 'quote'],
  properties: { lo: { type: 'string' }, type: { type: 'string', enum: ['definition', 'rule', 'method', 'convention', 'caution'] },
    text: { type: 'string' }, anchor: { type: 'string' }, printed_page: { type: 'integer' }, quote: { type: 'string' } } } } } }
const PROV_SCHEMA = { type: 'object', required: ['checks'], properties: { checks: { type: 'array', items: {
  type: 'object', required: ['i', 'supported'], properties: { i: { type: 'integer' }, supported: { type: 'boolean' }, note: { type: 'string' } } } } } }
const AUDIT_SCHEMA = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: {
  type: 'object', required: ['i', 'verdict'], properties: { i: { type: 'integer' },
    verdict: { type: 'string', enum: ['SUPPORTED', 'UNSUPPORTED'] }, note: { type: 'string' } } } } } }
const TYPING_SCHEMA = { type: 'object', required: ['items'], properties: { items: { type: 'array', items: {
  type: 'object', required: ['ref', 'answer_type', 'key', 'book_final', 'tier'],
  properties: {
    ref: { type: 'string' },
    answer_type: { type: 'string', enum: ['numeric', 'choice', 'expression', 'not_markable'] },
    key: { type: 'string' }, unit: { type: 'string' },
    marker_kind: { type: 'string', enum: ['', ...MARKER_KINDS] },
    form: { type: 'string', enum: ['', 'factorised', 'expanded', 'simplest', 'subject', 'prime_factors', 'decimal'] },
    subject: { type: 'string' },
    variables: { type: 'array', items: { type: 'string' } },
    options: { type: 'array', items: { type: 'string' } },
    options_source: { type: 'string', enum: ['', 'stem', 'figure', 'lesson'] },
    book_final: { type: 'string' },
    not_markable_reason: { type: 'string' },
    tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
  } } } } }
const BLIND_SCHEMA = { type: 'object', required: ['answers'], properties: { answers: { type: 'array', items: {
  type: 'object', required: ['ref', 'final_answer', 'markable'],
  properties: { ref: { type: 'string' }, final_answer: { type: 'string' }, markable: { type: 'boolean' }, working: { type: 'string' } } } } } }
const JUDGE_SCHEMA = { type: 'object', required: ['verdicts'], properties: { verdicts: { type: 'array', items: {
  type: 'object', required: ['pair_id', 'verdict'],
  properties: { pair_id: { type: 'string' }, verdict: { type: 'string', enum: ['equivalent', 'different', 'unclear'] }, reason: { type: 'string' } } } } } }
const TIER_SCHEMA = { type: 'object', required: ['tiers'], properties: { tiers: { type: 'array', items: {
  type: 'object', required: ['ref', 'tier'], properties: { ref: { type: 'string' }, tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] } } } } } }
const VIZ_SCHEMA = { type: 'object', required: ['figures'], properties: { figures: { type: 'array', items: {
  type: 'object', required: ['figure_id', 'decision', 'lo'],
  properties: { figure_id: { type: 'string' }, decision: { type: 'string', enum: ['viz', 'gap'] },
    kind: { type: 'string' }, spec: { type: 'object' }, caption: { type: 'string' }, lo: { type: 'string' },
    withheld: { type: 'array', items: { type: 'string' } },
    gap_reason: { type: 'string' }, needed_kind: { type: 'string' } } } } } }
const COMPARE_SCHEMA = { type: 'object', required: ['checks'], properties: { checks: { type: 'array', items: {
  type: 'object', required: ['figure_id', 'faithful'], properties: { figure_id: { type: 'string' }, faithful: { type: 'boolean' }, issues: { type: 'string' } } } } } }
const ORACLE_SCHEMA = { type: 'object', required: ['verdict', 'subheadings'], properties: {
  verdict: { type: 'string', enum: ['GREEN', 'RED'] },
  subheadings: { type: 'array', items: { type: 'object', required: ['anchor', 'status'],
    properties: { anchor: { type: 'string' }, status: { type: 'string', enum: ['covered', 'thin', 'MISSING'] },
      missing_items: { type: 'array', items: { type: 'string' } } } } } } }

// ---- deterministic helpers ---------------------------------------------------------------------
// COLLECT-2 (the Chapter 8 pilot's lesson runs, 2026-09-26). Causes of false "disputed" items, fixed in
// this script's deterministic collection only — no prompt changed, so a resume replays every agent:
//   * "book_final is not in the book solution": the solutions are aligned derivations
//     (d&=\sqrt{45}\\&\approx 6,71) and a final answer states the left side with the last line
//     (d \approx 6,71). The check now reads each continuation line with its implicit left side, ignores
//     the alignment marker &, and checks every maths segment of a final written as a sentence. It still
//     refuses a final the solution does not contain (a final copied from another item, a changed value).
//   * a final answer written as a sentence ("Therefore $y=-3$ or $y=21$.") is compared by its maths;
//     a printed list "A(3; −4), … and E(5; −4)." reads its "and" as the list's comma; a flattened
//     printed left side ("mAC = −15 7") is a left side like "m_{AC} =".
//   * a batch an agent answered in part, or off task, is asked again ONCE for the items it left out
//     (label …:again), and anything still missing is reported as UNCHECKED — never as a disagreement
//     between the book's sources. (The pilot's cause: the Workflow harness relays the latest user
//     message to every agent and tells it that message wins; agents answered that instead.)
// COLLECT-3 (the five lesson-v4 runs of Chapter 8, 2026-09-26), again deterministic only:
//   * the typing check read a correct key as not matching: a named point ("M (1; 0)" is the pair
//     (1; 0)), a chain of names ("dAC = dBD = √26"), a key typed as a set of values ("3; 9" is
//     "x = 3 or x = 9"), a sentence final whose maths names things ("The coordinates of $D$ are
//     $(4;-10)$"), a list joined by "and" on either side, an alignment & left in a copied line;
//   * "book_final is not in the book solution" refused a final listing several statements
//     ("d_{FG}=\sqrt{26}, d_{GH}=\sqrt{8}"), a chain the typing agent wrote out ("A=…=42,5" where the
//     solution holds A=42,5), {m}_{AB} for m_{AB}, and a value the solution states as a whole segment;
//   * an item typing AND the blind solver both call not markable (a proof) is not "missing" a check;
//   * a stem that refers to a figure the blind solver was not given (the question's figure was not
//     attached to its parts — fixed in assemble_objectives lesson-args): a blind answer that does not
//     agree is UNCHECKED, not a book dispute;
//   * three pairwise verdicts that contradict each other (equivalent, equivalent, different) are
//     flagged `inconsistent`: the judge got one wrong. The item stays held.
// COLLECT-4 (the final Chapter 8 runs): a numeric key is stored as the bare number the check read,
//   without the book's \text{…} wrapper ("\text{0,5}"), which assembly refused as not a number.
// COLLECT-6 (the first four Chapter 1 lessons, 2026-10-01; the prompts are unchanged, so a saved run is re-collected
// with recollect_lessons.py and no model call). What the algebra chapter showed that Chapter 8 never did:
//   * "book_final is not in the book solution" fired on 23 of 96 items of one lesson, none of them wrong. The book's
//     solution for a classification is a SENTENCE ("… and is not divided by zero, so it is real.") and the typing
//     agent copies a sentence with its parenthetical dropped. A copy with ELISIONS is the book's text: the final's
//     words, numbers and symbols are an ordered subsequence of the solution's, and no skipped word negates
//     ("not", "no", "non-"). A value changed, a word added, a final from another item are still refused.
//   * a choice whose options the typing agent INVENTED. options_source "lesson" is a closed set the book itself
//     uses ("rational" / "irrational"; "real" / "non-real" / "undefined"; true / false): one verbal category each,
//     named in the stem or the lesson. Numbers, pairs of integers, values, and combinations of categories
//     ("rational, integer") are never options: the book printed none, and distractors placed around the printed
//     answer ("4 and 5" among "3 and 4", "5 and 6") are the typing agent's, not the book's. Also refused: more
//     than 5 options (a list in the stem to select from), a key that is not among the options, repeated options.
//   * such a choice is typed again from the KEY the book printed, deterministically and only where the key is
//     plainly a number (numeric) or a list of numbers ("4 and 5" — marker kind values, in any order); anything
//     else keeps the choice's problems and G2 decides. The retype is recorded (`typing_retyped`).
//   * a verbal choice settles by the option each source NAMES. "Real" and "…so it is real." both name the one
//     option "real" (whole words: "rational" is not in "irrational", "real" is not in "non-real"; a negation —
//     "not rational" — settles nothing): the pair is `equivalent` (route "options") without a judge. The
//     answer-bearing texts (the printed and the blind answer) must be words only: a number or maths in an answer
//     ("2,82843; irrational") is a second part the option does not cover, so the judge reads it as before.
//   * a FORM the marker kind cannot carry (g10m1s7-3, Ex1-9:11 "Factorise: 25x^3 + 1"; the key (\sqrt[3]{25}x+1)(…) typed kind
//     "surd" with form "factorised", which AnswerSpec refuses: 'factorised' / 'expanded' apply to an expression or an equation, a
//     subject form to an equation, and the whole lesson's G2 draft could not be written). When the key is plainly algebra in the
//     declared variables (a variable in it, no list, inequality, set or words), the KIND is normalised: expression, or equation when
//     the key has an "=". The key is kept exactly; the retype is recorded (`typing_retyped`, rule 'kind-for-form'). Where the kind
//     cannot be settled that way (an interval, coordinates, a list of values, no variable in the key) the item keeps a typing
//     problem naming the form and the kind, so it is held for G2 instead of crashing the split. The app's marker reads a surd
//     inside an `expression` key (tests/test_typing_seam.py runs it on this very key).
// COLLECT-6 (Chapters 3 and 4, 2026-10-01; the prompts are unchanged, so a saved run is re-collected with recollect_lessons.py and no model
// call). G2's auto-pass excluded 24 of 93 items of g10m3s2-1 and 75 of 88 owed items of Chapter 4, nearly all of them correct answers the
// typing check could not match to what the book printed. runbook/README.md §3 has the rules; tests/test_lesson_collect6.py pins each one
// beside the real mismatch it must not accept (and NoSingleEditIsAccepted: any one-character change of an accepted key is refused). In short:
//   * a printed list that labels its values (T4 = …; T5 = …, T1 = −3 and T2 = 3, Tn = …, T10 = …) is the key's list: labels set aside, "and" a
//     separator, a decimal comma never one, the order kept where the labels differ; a printed "= …" is read by its right side; "±8" is two values;
//   * a values key of plain numbers matches a sentence that states exactly those numbers, in order; a book sentence in maths by its `var = value`;
//   * an inequality, a membership or an interval is compared whole (relations, signs, brackets, constraints); a number line's axis and the next
//     part's answer are not the answer; a printed fraction after ≠ is not read (Ex1-11:37a stays held);
//   * the KIND the app's marker cannot read is normalised, the key kept exactly, the retype recorded: a fraction typed numeric → expression
//     ('fraction-key': the numeric grader reads "-5/3" as -5), a list typed surd/expression → values ('kind-for-list'), inequalities typed
//     equation/expression/values → interval ('kind-for-relations'), one "=" typed expression/surd → equation ('kind-for-equation'); Greek
//     marker variables by name, π not a variable;
//   * in the book solution: an equation the other way round, a relation row of an aligned array, \text{and} with its spaces lost, "T_2=23 and
//     T_4=53", a chain d=T_2-T_1=7-4=3 whose every link is stated; the signature keeps ± and Greek letters.
// The collection is still `collect-6` (same day, as kind-for-form): the recollected file records the script's sha.
const norm = (s) => String(s || '').normalize('NFKC').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[’‘]/g, "'")
  .replace(/\$/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const contains = (hay, needle) => { const n = norm(needle); return n.length >= 8 && norm(hay).includes(n) }

// The comparison normal form of an answer (LaTeX or printed text). Decision 15's notation is
// read both ways here; nothing is written back.
const GREEK_NAME = { 'λ': '\\lambda', 'θ': '\\theta', 'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'μ': '\\mu', 'σ': '\\sigma', 'φ': '\\phi', 'ω': '\\omega' }
const GREEK = { pi: 'π', lambda: 'λ', theta: 'θ', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', mu: 'μ', sigma: 'σ', phi: 'φ', omega: 'ω' }
function normTex(s) {
  let t = String(s == null ? '' : s)
  t = t.replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, '')
  t = t.replace(/\\(?:left|right|displaystyle)(?![a-zA-Z])/g, '').replace(/\\[,;:! ]|\\q?quad(?![a-zA-Z])|~/g, '')
  t = t.replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac')
  t = t.replace(/\\(?:text|mathrm|textrm|mbox)\{\s*and\s*\}/g, ', ')                // the EPUB's own "\text{and}", spaces lost: T_6=28\text{and}T_9=43 (COLLECT-6)
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, '$1')
  t = t.replace(/\s+and\s+/g, ', ')                                      // a list's "and" is its comma (COLLECT-3: both sides)
  t = t.replace(/\\geq?(?![a-zA-Z])/g, '≥').replace(/\\leq?(?![a-zA-Z])/g, '≤').replace(/>=/g, '≥').replace(/<=/g, '≤')   // before the "&" goes: "-3&\le&k" (COLLECT-6)
  // a Greek letter's command is the sign it names, so the letter after it is not swallowed with it: "2\pi r" is not "2\pir" (COLLECT-6)
  t = t.replace(/\\pm(?![a-zA-Z])/g, '±').replace(/\\pi(?!tchfork)/g, 'π').replace(/\\(lambda|theta|alpha|beta|gamma|delta|mu|sigma|phi|omega)(?![a-zA-Z])/g, (_m, g) => GREEK[g])
  t = t.replace(/&/g, '')                                                  // alignment markup, never maths (COLLECT-3)
  t = t.replace(/\{([A-Za-z])\}(?=[_^])/g, '$1')                          // {m}_{AB} is m_{AB} (COLLECT-3)
  t = t.replace(/\\(?:cdot|times)(?![a-zA-Z])/g, '*').replace(/[×·]/g, '*')
  t = t.replace(/[−–]/g, '-')
  t = t.replace(/(\d)\{,\}(\d)/g, '$1.$2').replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ',')
  t = t.replace(/([\^_])\{([A-Za-z0-9])\}/g, '$1$2')
  t = t.replace(/\\frac\{-([^{}]+)\}\{([^{}]+)\}/g, '-\\frac{$1}{$2}')   // \frac{-2}{3} is -\frac{2}{3} (COLLECT-2)
  t = t.replace(/\s+/g, '').replace(/^\\therefore/, '').replace(/^(?:answer|ans)[:=]/i, '').replace(/\.$/, '')
  return t
}
// a named left side: x=, y_1=, m_{AB}=, d_{AB}\approx, the text layer's flattened mAC=, and a named point
// with its variables, P(x,y)= (COLLECT-2, COLLECT-3)
const stripLhs = (t) => t.replace(/^[A-Za-zπλθαβγδμσφω]{1,4}(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?(?:\([a-z](?:,[a-z])*\))?(?:=|\\approx)/, '')
// a point's name before its coordinates: M(1,0) is the pair (1,0); only a name directly before ONE
// parenthesised pair, so f(2) or 3(x+1) is never touched (COLLECT-3)
const stripPointName = (t) => (/^[A-Za-z]{1,2}(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\([^()]*,[^()]*\)$/.test(t) ? t.replace(/^[^(]+/, '') : t)
// what survives the PDF text layer's flattening of maths: digits, letters (Greek ones too: a key with π is not a printed answer without it)
// and relations, and ± ("b = ±8" states two values: the key "8" is not that answer) — COLLECT-6
const SIG_DROP = /[^0-9A-Za-zπλθαβγδμσφω±+\-=<>≤≥.]/g
const sig = (s) => normTex(s).replace(/\\[a-zA-Z]+/g, '').replace(SIG_DROP, '')

// The PDF text layer flattens the book's raised multiplication dot to " . " between digits; this
// book writes decimals with a comma, so there it is always a product.
const RAISED_DOT = /(\d)\s+\.\s+(\d)/g
// a trailing "units" / "square units" is a unit word, not maths ("42,5 units") — COLLECT-3
const printedTex = (s) => { const t = String(s == null ? '' : s).replace(/\s+(?:square\s+)?units?\s*\.?\s*$/i, ''); return BOOK.multiplication_dot ? t.replace(RAISED_DOT, '$1*$2') : t }

// The maths of an answer written as a sentence. A segment that only NAMES something ($AB$, $D$,
// $\triangle ABC$) carries no value and is set aside (COLLECT-3); of the rest, the one segment, or the
// span from the first to the last with the words between kept ("$y=-3$ or $y=21$"). COLLECT-2.
const NAME_SEG = /^\$\s*(?:\\triangle\s*)?[A-Z]{1,4}(?:_\{?[A-Za-z0-9]+\}?)?\s*\$$/
function mathsSpan(s) {
  const t = String(s == null ? '' : s)
  const segs = (t.match(/\$[^$]+\$/g) || []).filter((x) => !NAME_SEG.test(x))
  if (!segs.length) return t
  return segs.length === 1 ? segs[0] : t.slice(t.indexOf(segs[0]), t.lastIndexOf(segs[segs.length - 1]) + segs[segs.length - 1].length)
}

// an equation read either way round: 4=y is y=4 (COLLECT-2)
const swapEq = (t) => { const i = t.indexOf('='); return i > 0 && t.indexOf('=', i + 1) < 0 ? t.slice(i + 1) + '=' + t.slice(0, i) : null }
// the forms one answer may be compared in: as written, without its named left side(s) — a chain
// d_{AC}=d_{BD}=\sqrt{26} names two things equal to one value (COLLECT-3) — either way round, and a
// point's coordinates without its name
const eqForms = (t) => {
  const w = swapEq(t)
  // a worked chain L=m1=…=R states its last value R (COLLECT-3); a single equation keeps its left side
  const last = workedChain(t) ? t.split('=').pop() : null
  const base = [t, stripLhs(t), stripLhs(stripLhs(t)), ...(w ? [w, stripLhs(w)] : []), ...(last ? [last] : [])]
  return new Set(base.flatMap((x) => [x, stripPointName(x)]).filter(Boolean))
}
const sameForm = (x, y) => { const fy = eqForms(y); return [...eqForms(x)].some((f) => fy.has(f)) }
// L=m1=…=R is a WORKED CHAIN only when everything after its left side is arithmetic: no letter outside
// a LaTeX command, no top-level comma. So "x=2 or x=3" (a word, a second unknown) and a list of
// equations "FG=\sqrt{26},GH=2\sqrt{2}" are never read as a chain ending in their last value (COLLECT-3)
function workedChain(t) {
  const parts = String(t).split('=')
  return parts.length > 2 && topLevelParts(t).length === 1 &&
    parts.slice(1).every((x) => !/[A-Za-z]/.test(x.replace(/\\[a-zA-Z]+/g, '')))
}
function settleOne(a, b, textLayer) {
  if (textLayer) b = printedTex(b)
  const na = normTex(a), nb = normTex(b)
  if (na && sameForm(na, nb)) return { route: 'normalised', verdict: 'equivalent' }
  if (textLayer) {
    // the signature of each side, and of a named point's pair without its name ("T ( −1; 1 2 )")
    const sigs = (n) => [...new Set([n, stripPointName(n), stripLhs(n)])].map((x) => x.replace(/\\[a-zA-Z]+/g, '').replace(SIG_DROP, ''))
    const sa = sigs(na), sb = sigs(nb)
    if (sa[0] && sa.some((x) => sb.some((y) => sameForm(x, y)))) return { route: 'signature', verdict: 'equivalent' }
  }
  return null
}

function settle(a, b, textLayer) {
  if (!a || !b) return { route: 'missing', verdict: 'missing' }
  for (const x of [...new Set([a, mathsSpan(a)])]) {
    for (const y of [...new Set([b, mathsSpan(b)])]) {
      const r = settleOne(x, y, textLayer)
      if (r) return r
    }
  }
  return { route: 'judge', verdict: null }
}

// A list of values ("x = 3 or x = 9", "3; 9", "a = 1 and b = 7 2", "T4 = −28,1; T5 = −33,1; T6 = −38,1") as its values IN ORDER,
// each without its own label, and the label each carried — the marker's "values" kind is exactly such a list (COLLECT-3).
// Only the TYPING check uses it, and only for a key typed as values: the three-way pairs are not read as lists here (the
// judge reads "values in any order").
//   * a value's label is what the book prints in front of it: a letter or a short name with a subscript (T_4, T_{10}, T4, Tn,
//     x, n, m_{AB}) and "=" (COLLECT-3; COLLECT-6 adds one letter + digits, the text layer's flattened T_4, which the
//     chain 4 / 5 / 6 of g10m3s2-1's "T4 = …; T5 = …; T6 = …" printed). Only a label, never part of a value: the sign, the
//     digits, a decimal comma, a unit, a variable ("-39x") and the order are exactly as written.
//   * the separators are ";", "and", "or", and a comma that is not a decimal comma (a comma BETWEEN TWO DIGITS, "-28,1", or between
//     a digit and a recurring bar, "1,\overline{34}", is a decimal point, as normTex reads it; the old split broke it in two on both
//     sides, so "1,5; 2" and "5; 1,2" read alike) and not inside a bracket ("(1,2)").
const VALUE_LABEL = /^(?:[A-Za-zπλθαβγδμσφω]{1,4}(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?(?:\([a-z](?:,[a-z])*\))?|[A-Za-z]\d{1,3})(?:=|\\approx)/
const DECIMAL_COMMA = /(?<=\d),(?=\d|\\(?:overline|bar|dot|ddot)\s*\{?\s*\d)/g
function valueList(s, textLayer) {
  const t = mathsSpan(textLayer ? printedTex(s) : s).replace(/\$/g, ' ').replace(/(\d)\{,\}(\d)/g, '$1.$2').replace(DECIMAL_COMMA, '.')
  const parts = t.split(/\s+or\s+|\s+and\s+|\\text\{\s*(?:or|and)\s*\}|;|,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean)
  const flat = (rest) => (textLayer ? rest.replace(/\\[a-zA-Z]+/g, '').replace(SIG_DROP, '') : rest)
  const one = (x) => {
    const n = normTex(x), m = VALUE_LABEL.exec(n)
    const rest = m ? n.slice(m[0].length) : n
    const label = m ? m[0].replace(/(?:=|\\approx)$/, '') : null
    // "b = ±2" states TWO values, +2 and -2 (in that order): the sign is read, never dropped (COLLECT-6)
    const pm = /^(?:±|\\pm(?![a-zA-Z]))(?=[^-+±])/.exec(rest)
    if (pm) { const v = flat(rest.slice(pm[0].length)); return v ? [{ label, value: v }, { label, value: `-${v}` }] : [] }
    return [{ label, value: flat(rest) }]
  }
  const rows = parts.flatMap(one).filter((r) => r.value)
  return { values: rows.map((r) => r.value), labels: rows.map((r) => r.label) }
}
// the values as a set (sorted): what the marker's "values" kind compares
const valueSet = (s, textLayer) => valueList(s, textLayer).values.sort()
// A list in which each value has ITS OWN label (T4, T5, T6: a sequence) pins each value to a place, so the key lists them in the same
// order; a list with one label ("x = 3 or x = 9") or none is a set, in any order (the marker's "values" kind takes any order).
const sameValues = (key, against, textLayer) => {
  const k = valueList(key, textLayer), a = valueList(against, textLayer)
  if (!(k.values.length > 1 && k.values.length === a.values.length)) return false
  const named = new Set([...k.labels, ...a.labels].filter(Boolean)).size > 1
  const kv = named ? k.values : [...k.values].sort(), av = named ? a.values : [...a.values].sort()
  return kv.every((x, i) => x === av[i])
}

// ---- COLLECT-6 (Chapters 3 and 4): a key against an answer the book printed another way -------------------------------------
// Everything below only ACCEPTS a key, and only when every value, relation, sign and bracket of the key is found in the printed (or
// book-final) answer and the answer states nothing else; a different value, sign, relation or bracket, a constraint the key
// leaves out, or a value the key does not list is a mismatch exactly as before. Nothing is written back.
const normNum = (x) => { let n = String(x).replace(',', '.').replace(/^\+/, ''); if (n.includes('.')) n = n.replace(/0+$/, '').replace(/\.$/, ''); return n === '-0' ? '0' : n }
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/

// The numbers a SENTENCE states, in order: "There are 5 tricycles and 2 bicycles." → 5, 2; "7 and 35 years old." → 7, 35;
// "b = 8 cm and l = 2b = 16 cm" → 8, 16 (once the sentence has an "=", only the numbers it sets after one count: 2b is a
// coefficient, and a number it does not set is refused); "R9,00" is 9. A sentence with maths in it, with no word, or whose numbers are
// glued to letters ("5kg") is not read (null), so nothing is guessed.
function sentenceNumbers(text) {
  let t = String(text == null ? '' : text).normalize('NFKC').replace(/[−–—]/g, '-')
  if (/[\\$]/.test(t) || !(t.includes('=') || t.replace(/\b(?:and|or)\b/gi, ' ').match(/[A-Za-z]{3,}/))) return null
  t = t.replace(/\bR\s?(?=\d)/g, '')
  const hasEq = t.includes('=')
  const out = []
  const re = /(?<![\w.,])(-?\d+(?:[.,]\d+)?)(?![\w])/g
  let m
  while ((m = re.exec(t))) {
    if (hasEq && !/=\s*$/.test(t.slice(0, m.index))) return null
    out.push(normNum(m[1]))
  }
  return out.length ? out : null
}
// a values key of plain numbers, listed in the order its sentence states them
function sentenceMatchesValues(key, text) {
  const kv = valueList(key, false).values
  if (kv.length < 2 || !kv.every((v) => PLAIN_NUMBER.test(v.replace(/^\+/, '')))) return false
  const sn = sentenceNumbers(text)
  return !!sn && sn.length === kv.length && sn.every((x, i) => x === normNum(kv[i]))
}
// A sentence of the book's solution in maths ("The solution to $3x^2+2x-1=0$ is $x=-1$ or $x=\frac{1}{3}$"): the answer is what its
// `var = value` segments set; a given equation beside them is not an answer, but a bare value in a segment of its own is refused.
function assignedList(text) {
  const segs = String(text == null ? '' : text).match(/\$[^$]+\$/g)
  if (!segs) return null
  const asg = [], given = []
  for (const sg of segs) (/^[A-Za-z](?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?=[^=]+$/.test(normTex(sg)) ? asg : given).push(sg)
  if (asg.length < 2 || given.some((sg) => !normTex(sg).includes('='))) return null
  return asg.map((sg) => sg.replace(/\$/g, '')).join('; ')
}

// Inequalities, set membership and intervals, compared as one canonical string: the same relations, the same signs and values, the same
// brackets, the same connectors, in the same order. The book's flattened print is read first (never guessed): ≠ is a solidus + "=", a
// fraction in an interval's endpoint is "6 5" (6/5), ∈ and ∞ are signs, a number line's axis ("x 0 1 2 3 4 5 …") and the next
// part's answer that runs on ("… ] . e) ( −∞; −55 13 )") are not this answer.
function canonRel(s, printed) {
  let t = String(s == null ? '' : s).normalize('NFKC').replace(/[−–—]/g, '-').replace(/\u0338\s*=|=\s*\u0338/g, '≠').replace(/\\neq?(?![a-zA-Z])/g, '≠')
  if (printed) t = t.replace(/(?<=[;(\[]\s*)(?<![\d.])(-?\d+)\s+(\d+)(?![\d.])(?=\s*[;)\]])/g, '$1/$2')
  t = normTex(t).replace(/\\in(?![a-zA-Z])/g, '∈').replace(/\\mathbb\{([A-Za-z])\}/g, '$1').replace(/[ℝℕℤℚ]/g, (c) => ({ 'ℝ': 'R', 'ℕ': 'N', 'ℤ': 'Z', 'ℚ': 'Q' })[c])
    .replace(/\\infty(?![a-zA-Z])/g, '∞').replace(/\\cup(?![a-zA-Z])/g, '∪').replace(/\\frac\{(-?\d+)\}\{(\d+)\}/g, '$1/$2')
  return t.replace(/^[A-Za-z]∈(?=[(\[])/, '')               // "x ∈ (−∞; 6/5]" is the interval
}
// the readings of a printed answer that is no more than its own answer: as printed; without the next part's answer (the item's part
// letter is the only thing it is cut at: "d" runs on into "e)"); without a number line's axis, a variable and its ticks
function relReadings(printed, ref) {
  let t = String(printed == null ? '' : printed).normalize('NFKC').replace(/[−–—]/g, '-')
  const part = /\d([a-z])$/.exec(String(ref || ''))
  if (part && part[1] < 'z') {
    const next = String.fromCharCode(part[1].charCodeAt(0) + 1)
    const i = t.search(new RegExp(`(?:^|[\\s.;,])${next}\\)`))
    if (i > 0) t = t.slice(0, i)
  }
  const out = [t]
  const ax = /^\s*([A-Za-z])\s+(?:-?\d+(?:[.,]\d+)?\s+){2,}?(?=\1\s*[<>≤≥=∈≠\u0338]|-?\d+(?:[.,]\d+)?\s*[<≤>≥])/.exec(t)
  if (ax) out.push(t.slice(ax[0].length))
  return out
}
const RELATION_KEY = /[<>≤≥≠∈]|\\(?:leq?|geq?|neq?|in)(?![a-zA-Z])|^\s*(?:\\left)?[(\[].*[;,].*(?:\\right)?[)\]]\s*$/
function relEquivalent(key, printed, ref) {
  if (!RELATION_KEY.test(String(key))) return false
  const k = canonRel(key, false)
  if (k.length < 3) return false
  if (relReadings(printed, ref).some((r) => canonRel(r, true) === k)) return true
  // "true for all real values of x" says the whole line, (-∞;∞); a negation or an exception says something else
  return /^(?:[A-Za-z]∈)?(?:\(-∞,∞\)|R)$/.test(k) && /\b(?:all|any|every)\s+real\s+(?:values?|numbers?)\b/i.test(printed) &&
    !/\b(?:not|no|except|other\s+than|never|cannot)\b|n't/i.test(printed)
}
// a printed answer's trailing unit word ("19 50 litres"), when the item's own stem or typing names the unit
function withoutUnit(text, stem, unit) {
  const m = /^(.*\d)\s+([A-Za-z]+)\.?\s*$/.exec(String(text == null ? '' : text))
  if (!m) return null
  const w = m[2].toLowerCase(), sing = w.replace(/s$/, '')
  const named = norm(unit || '') === w || norm(unit || '').replace(/s$/, '') === sing || new RegExp(`(?:^|[^a-z])${sing}s?(?:[^a-z]|$)`).test(norm(stem))
  return named ? m[1] : null
}

// Is a final answer in the book solution? The solution's text, and each line of an aligned
// derivation read with its left side (d&=\sqrt{45}\\&\approx 6,71 states "d \approx 6,71"). Every maths
// segment of the final must be there; a final with no maths must be there whole. COLLECT-2.
function alignStatements(text) {
  const out = []
  const re = /\\begin\{(align\*?|aligned)\}([\s\S]*?)\\end\{\1\}/g
  let m
  while ((m = re.exec(String(text || '')))) {
    let lhs = ''
    for (const raw of m[2].split(/\\\\/)) {
      const line = raw.trim()
      if (!line) continue
      const i = line.indexOf('&')
      if (i < 0) { out.push(line); continue }
      const left = line.slice(0, i).trim()
      if (left) lhs = left
      out.push(lhs + line.slice(i + 1))
    }
  }
  return out
}
// A final copied as plain text ("θ ≈ 26,6°", "x ≈ 76,60", "sin B̂ = AC/AB") against a solution in LaTeX (`\theta\approx\text{26,6}^{\circ}`,
// `x&\approx\text{76,60}`, `\sin\hat{B}=\frac{AC}{AB}`): both are read as the same SIGNS (≈, °, a hat, a function name, a simple fraction as a/b,
// \text{…} unwrapped). Only a sign is ever changed, never a digit (COLLECT-6, Chapter 5).
function plainSigns(s) {
  let t = String(s == null ? '' : s)
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, '$1')
  return t.replace(/\\(?:approx|simeq)(?![a-zA-Z])/g, '≈')
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ(?![a-zA-Z])|\\circ(?![a-zA-Z])/g, '°')
    .replace(/\\(?:widehat|hat)\s*\{\s*([A-Za-z])\s*\}|\\(?:widehat|hat)\s*([A-Za-z])/g, (_m, a, b) => `${a || b}̂`)
    .replace(/ˆ\s*([A-Za-z])/g, '$1̂')
    .replace(/\\(sin|cos|tan|cot|sec|csc)(?![a-zA-Z])/g, '$1')
    .replace(/\\[dt]?frac\s*\{\s*(-?[A-Za-z0-9.,]+)\s*\}\s*\{\s*(-?[A-Za-z0-9.,]+)\s*\}/g, '$1/$2')
}
const containNorm = (s) => normTex(plainSigns(s).replace(/\\therefore(?![a-zA-Z])/g, ' therefore ')
  .replace(/\\because(?![a-zA-Z])/g, ' because ')).toLowerCase()
// `n` is in `h` AS A WHOLE VALUE: a number is not found inside a longer one ("76,6" is not in "76,60", "x=2" not in "x=2/3" or "x=25", "5" not in
// "-5"), so a different rounding or a different digit is refused (COLLECT-6, Chapter 5)
function hasValue(h, n) {
  for (let i = h.indexOf(n); i >= 0; i = h.indexOf(n, i + 1)) {
    const before = i > 0 ? h[i - 1] : '', after = h[i + n.length] || ''
    if (/\d/.test(n[0]) && /[\d.\-]/.test(before)) continue
    if (/\d/.test(n[n.length - 1]) && (/[\d^/!]/.test(after) || (after === '.' && /\d/.test(h[i + n.length + 1] || '')))) continue
    return true
  }
  return false
}
// top-level commas of one segment ("d_{FG}=\sqrt{26}, d_{GH}=\sqrt{8}"), never inside (), {} or []
function topLevelParts(seg) {
  const out = []; let depth = 0, cur = ''
  for (const ch of seg) {
    if ('({['.includes(ch)) depth++
    if (')}]'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}
function inBookSolution(solution, final) {
  const hay = [solution.join(' '), ...solution.flatMap(alignStatements)].map(containNorm)
  // the solution's maths segments, whole: "the appropriate value is $\text{3}$" states 3 (COLLECT-3)
  const wholeSegs = new Set(solution.flatMap((x) => String(x).match(/\$[^$]+\$/g) || []).map(containNorm))
  const found = (p) => {
    const n = containNorm(p)
    if (!n) return false
    if (hay.some((h) => hasValue(h, n))) return true
    // an equation the other way round: the final "a=\frac{…}{t^{2}}" is the solution's last line "\frac{…}{t^{2}}&=a" (COLLECT-6)
    const sw = swapEq(n)
    if (sw && hay.some((h) => hasValue(h, sw))) return true
    const parts = n.split('=')
    // a worked chain L=m1=…=R the typing agent wrote out states L=R, which the solution must hold (COLLECT-3)
    if (workedChain(n) && hay.some((h) => hasValue(h, `${parts[0]}=${parts[parts.length - 1]}`))) return true
    // x=3 where the solution states the value as a whole segment of its own (COLLECT-3)
    if (parts.length === 2 && /^[a-z]{1,2}(?:_[a-z0-9{}]+)?$/.test(parts[0]) && wholeSegs.has(parts[1])) return true
    // a worked chain L=m1=m2=…=R whose middle terms hold letters (d=T_2-T_1=7-4=3) is the derivation's aligned lines `d=T_2-T_1`,
    // `=7-4`, `=3` written on one line: it is in the solution when EVERY link L=mi is a statement the solution makes (the
    // lines are read with their carried left side). A changed link (…=7-5=3) is not, so that final is still refused (COLLECT-6)
    return parts.length > 2 && !n.includes(',') && parts.every(Boolean) && parts.slice(1).every((m) => hay.some((h) => hasValue(h, `${parts[0]}=${m}`)))
  }
  const segs = String(final).match(/\$[^$]+\$/g) || [String(final)]
  // a segment that lists several statements must have each of them in the solution (COLLECT-3); a list joined by "and"
  // ("T_2=23 and T_4=53") is the same list, "and" being its comma (COLLECT-6)
  return segs.every((p) => found(p) || (() => { const ps = topLevelParts(p.replace(/\$/g, '').replace(/\\text\{\s*and\s*\}|\s+and\s+/g, ', '))
    return ps.length > 1 && ps.every((x) => x.includes('=') && found(x)) })()) || verbalElision(solution, final)
}

// ---- COLLECT-6 helpers ----------------------------------------------------------------------------
// words, numbers and the few symbols that carry meaning, in order (spacing, punctuation, braces and $ ignored)
function wordTokens(s) {
  let t = String(s == null ? '' : s).normalize('NFKC').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[’‘]/g, "'")
  t = t.replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, ' ')
  t = t.replace(/\\(?:left|right|displaystyle)(?![a-zA-Z])/g, ' ').replace(/\\[,;:! ]/g, ' ').replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac')
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, ' $1 ')
  return t.toLowerCase().replace(/&/g, ' ').match(/\\[a-z]+|[a-z]+(?:'[a-z]+)?(?:-[a-z]+)*|\d+(?:[.,]\d+)?|[=+*/<>^_≤≥≈√π-]/g) || []
}
const NEGATION_WORDS = new Set(['not', 'no', 'never', 'cannot', "can't", "isn't", "doesn't", "don't", 'neither', 'nor', 'without'])
const negates = (w) => NEGATION_WORDS.has(w) || /^non-/.test(w) || /n't$/.test(w)
// A final written as a sentence, copied with elisions: its tokens are an ordered subsequence of the solution's, and nothing
// skipped BETWEEN two matched tokens negates. A sentence only (>= 4 tokens, >= 2 of them words); a value is never loosened.
function verbalElision(solution, final) {
  const f = wordTokens(final)
  if (f.length < 4 || f.filter((x) => /^[a-z]{2,}/.test(x)).length < 2) return false
  const h = wordTokens(solution.join(' '))
  let j = 0, last = -1
  for (let i = 0; i < h.length && j < f.length; i++) {
    if (h[i] !== f[j]) continue
    if (last >= 0) for (let k = last + 1; k < i; k++) if (negates(h[k])) return false
    last = i; j++
  }
  return j === f.length
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const plainOption = (o) => String(o == null ? '' : o).replace(/\$/g, '').replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, '$1').trim()
// one verbal category: a word, or up to seven joined by a space or hyphen (a yes/no question's two sentences: "opposite sides are
// parallel" / "opposite sides are not parallel"); never digits or maths, never a list ("rational, integer", "a and b")
const VERBAL_OPTION = /^[A-Za-z][A-Za-z'’]*(?:[ -][A-Za-z][A-Za-z'’]*){0,6}$/
const LIST_OPTION = /[,;/]|\s(?:and|or)\s/i
const isCategory = (o) => { const w = plainOption(o); return VERBAL_OPTION.test(w) && !LIST_OPTION.test(w) }
const STOCK_CLOSED = new Set(['true', 'false', 'yes', 'no'])
// options_source "lesson" is a closed set the book uses: one category each, named in the stem or the lesson (or true/false)
function closedSetProblems(it, opts, lessonText) {
  const bad = opts.filter((o) => !isCategory(o))
  if (bad.length) {
    return [`options said to be the lesson's closed set are not categories: ${bad.slice(0, 3).map((o) => `"${o}"`).join(', ')}` +
      ' — numbers, pairs, values and combinations are the book\'s answer to type, never options to invent']
  }
  // named in the stem or the lesson: every word of the option is a word they use ("Irrational number" where the stem says
  // "irrational"; "opposite sides are not parallel" where the question asks whether opposite sides are parallel)
  const hayWords = new Set(norm(`${it.stem} ${lessonText}`).match(/[a-z]+(?:-[a-z]+)*/g) || [])
  const unnamed = opts.filter((o) => !STOCK_CLOSED.has(norm(plainOption(o))) &&
    !(norm(plainOption(o)).match(/[a-z]+(?:-[a-z]+)*/g) || []).every((w) => hayWords.has(w) || ['number', 'numbers', 'not', 'no'].includes(w)))
  return unnamed.length ? [`options said to be the lesson's closed set are named neither in the stem nor in the lesson: ${unnamed.slice(0, 3).map((o) => `"${o}"`).join(', ')}`] : []
}
const NUM_RE = /^-?\d+(?:[.,]\d+)?$/
// A choice whose options were never the book's: typed again from the KEY, only where it is plainly a number or a list of
// numbers. Returns the typing row to use instead (and the rule), or null (the choice keeps its problems; G2 decides).
function retypeFromKey(t) {
  const key = plainOption(t.key).replace(/\\[,;:! ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (NUM_RE.test(key.replace(/ /g, ''))) return { rule: 'numeric', t: Object.assign({}, t, { answer_type: 'numeric', key: key.replace(/ /g, ''), options: [], options_source: '' }) }
  const parts = key.split(/\s+and\s+|\s+or\s+|\s*;\s*|,\s+/).map((x) => x.trim()).filter(Boolean)
  if (parts.length >= 2 && parts.every((x) => NUM_RE.test(x))) {
    return { rule: 'values', t: Object.assign({}, t, { answer_type: 'expression', marker_kind: 'values', form: '', variables: [], key: parts.join('; '), options: [], options_source: '' }) }
  }
  return null
}
// "between which two consecutive integers does √26 lie?": the book's final is the chain 5 < √26 < 6 — its two ends are the key's values
function betweenEnds(stem, against, key) {
  const m = /^(-?\d+)<[^<>]+<(-?\d+)$/.exec(normTex(against))
  return !!m && /\bbetween\b/i.test(String(stem)) && JSON.stringify(valueSet(key, false)) === JSON.stringify([m[1], m[2]].sort())
}
// which of the options a text NAMES (whole words, so "rational" is not in "irrational" nor "real" in "non-real"), and
// whether any is negated ("not rational")
function optionsNamed(text, opts) {
  const s = ` ${norm(text).replace(/[.;:,()!?]/g, ' ').replace(/\s+/g, ' ')} `
  const named = new Set()
  let negated = false
  opts.forEach((o, k) => {
    const w = norm(plainOption(o)).replace(/[.;:,()!?]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!w) return
    const re = new RegExp(`(?<![\\w-])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g')
    let m
    while ((m = re.exec(s))) {
      named.add(k)
      if (s.slice(0, m.index).trim().split(' ').slice(-3).some(negates)) negated = true
    }
  })
  return { named, negated }
}
const namesOnly = (text, opts, k) => { const r = optionsNamed(text, opts); return r.named.size === 1 && r.named.has(k) && !r.negated }
const wordsOnly = (text) => !!text && !/[\d\\]/.test(String(text).replace(/\$/g, ''))

// The S1 pilot (Chapter 8) found models copying a bracketed id WITH its brackets ("[EMA69]"). Every
// id this script looks up in a model's answer (a claim's anchor, an item's ref, a figure's id) is read
// with one bracket pair stripped when the id inside is one it knows; the prompts ask for ids without.
const unbr = (x, known) => {
  const t = String(x == null ? '' : x).trim()
  const m = /^\[([^\[\]]+)\]$/.exec(t)
  return m && !known(t) && known(m[1]) ? m[1] : x
}

function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h }
const chunk = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

const calls = {}
const count = (phase, slug) => { calls[phase] = calls[phase] || { total: 0, by_lesson: {} }; calls[phase].total += 1; calls[phase].by_lesson[slug] = (calls[phase].by_lesson[slug] || 0) + 1 }
const call = (phase, slug, label, prompt, opts) => { count(phase, slug); return agent(prompt, Object.assign({ label, phase }, opts)) }

const objList = (L) => L.objectives.map((o) => `${o.id}: ${o.statement}`).join('\n')
// collect-5 (consistency review A3): an agent that writes an objective id without its "lo:" prefix
// ("g10m8s3-2-2") means that objective — lesson 8.3b lost 7 figures to "unknown objective g10m8s3-2-2"
const loOf = (los, x) => (los.has(x) ? x : (x && los.has('lo:' + x) ? 'lo:' + x : null))
const blockLine = (b) => `[${b.anchor || b.id}] (${b.type}${b.kind ? ':' + b.kind : ''}, p.${b.printed_page}) ${b.text}`
const weLine = (w) => `[${w.ref}] Worked example ${w.n}: ${w.title} (p.${w.printed_page})\n  QUESTION: ${w.stem}\n` + w.solution.map((s) => `  - ${s}`).join('\n')

// ---- S2 claims ------------------------------------------------------------------------------------
async function runS2(L) {
  const s = L.slug
  const anchors = {}
  for (const b of L.blocks) { anchors[b.id] = b; if (b.anchor) anchors[b.anchor] = b }
  for (const w of L.worked_examples) anchors[w.ref] = { text: `${w.title} ${w.stem} ${w.solution.join(' ')}`, printed_page: w.printed_page, type: 'worked_example' }
  const studentText = Object.values(anchors).map((b) => b.text).join(' ')
  const prompt = `Extract the mathematical claims lesson ${s} ("${L.title}") of a textbook teaches, for a tutor that must never say anything the book does not.

THE LESSON'S OBJECTIVES (tie every claim to exactly one, by id):
${objList(L)}

THE LESSON TEXT:
${L.blocks.map(blockLine).join('\n') || '(none)'}

THE WORKED EXAMPLES:
${L.worked_examples.map(weLine).join('\n\n') || '(none)'}

A claim is one of: definition; rule (a law, identity or theorem as printed); method (the steps of a procedure, as the worked examples do it); convention (notation, rounding, units); caution (the book's own note or warning). For each: lo, type, text (one atomic statement in the book's own terms — "gradient", not "slope"), anchor (the id in square brackets at the start of the line it comes from, written WITHOUT the brackets), printed_page, and quote (an EXACT span of that anchored text the claim rests on). Cover every definition, rule and method the lesson teaches. Nothing from outside this text. Do not read any file.

Return CLAIMS_SCHEMA.`
  const res = await call('S2 Claims', s, `S2:claims:${s}`, prompt, { model: 'sonnet', schema: CLAIMS_SCHEMA })
  const out = { kept: [], dropped: [], teacher_caught: 0 }
  if (!res) return Object.assign(out, { failed: true })
  const los = new Set(L.objectives.map((o) => o.id))
  const pending = []
  res.claims.forEach((c, i) => {
    c.anchor = unbr(c.anchor, (k) => k in anchors)
    const a = anchors[c.anchor]
    const teacher = (L.teacher_only || []).some((t) => contains(t.text, c.quote) || contains(t.text, c.text))
    if (teacher && !contains(studentText, c.quote)) { out.teacher_caught += 1; out.dropped.push(Object.assign({}, c, { reason: 'echoes a teacher-only note (FR-4408)' })); return }
    if (loOf(los, c.lo)) c.lo = loOf(los, c.lo)
    if (!los.has(c.lo)) { out.dropped.push(Object.assign({}, c, { reason: `unknown objective ${c.lo}` })); return }
    if (!a) { out.dropped.push(Object.assign({}, c, { reason: `anchor ${c.anchor} is not in the lesson` })); return }
    const claim = { lo: c.lo, type: c.type, text: c.text, anchor: c.anchor, printed_page: c.printed_page, quote: c.quote, supported: true, teacher_only: false }
    if (contains(a.text, c.quote)) { claim.provenance = 'containment'; out.kept.push(claim) } else pending.push({ i, claim, a })
  })
  if (pending.length) {
    const rows = pending.map((p) => `i=${p.i}\n  claim: ${p.claim.text}\n  anchored text [${p.claim.anchor}, p.${p.a.printed_page}]: ${p.a.text}`).join('\n\n')
    const prov = await call('S2 Provenance', s, `S2:prov:${s}`, `For each claim below: is it supported by the anchored text shown — stated there, or shown by it, with nothing added? Judge only from the text shown; when unsure, false. Do not read any file.\n\n${rows}\n\nReturn PROV_SCHEMA with one check per i.`, { model: 'haiku', effort: 'low', schema: PROV_SCHEMA })
    const verdict = {}
    for (const c of (prov && prov.checks) || []) verdict[c.i] = c
    const doubt = pending.filter((p) => !(verdict[p.i] && verdict[p.i].supported))
    for (const p of pending) if (verdict[p.i] && verdict[p.i].supported) { p.claim.provenance = 'checked'; out.kept.push(p.claim) }
    if (doubt.length) {
      const rows2 = doubt.map((p) => `i=${p.i}\n  claim: ${p.claim.text}\n  anchored text [${p.claim.anchor}]: ${p.a.text}\n  first check said: ${(verdict[p.i] && verdict[p.i].note) || 'no verdict'}`).join('\n\n')
      const audit = await call('S2 Provenance', s, `S2:audit:${s}`, `Re-audit these claims, which a first check could not confirm. SUPPORTED only if the anchored text states or shows the claim with nothing added; otherwise UNSUPPORTED. Do not read any file.\n\n${rows2}\n\nReturn AUDIT_SCHEMA.`, { model: 'sonnet', schema: AUDIT_SCHEMA })
      const v2 = {}
      for (const v of (audit && audit.verdicts) || []) v2[v.i] = v
      for (const p of doubt) {
        if (v2[p.i] && v2[p.i].verdict === 'SUPPORTED') { p.claim.provenance = 're-audited'; out.kept.push(p.claim) } else {
          out.kept.push(Object.assign({}, p.claim, { supported: false, provenance: 'unsupported' }))
          out.dropped.push(Object.assign({}, p.claim, { reason: `unsupported at its anchor: ${(v2[p.i] && v2[p.i].note) || 'no verdict'}` }))
        }
      }
    }
  }
  return out
}

// ---- S3 book questions ----------------------------------------------------------------------------
function s3Items(L) {
  const wes = L.worked_examples.map((w) => ({ ref: w.ref, kind: 'worked_example', lo: w.lo, stem: w.stem, solution: w.solution,
    solution_provenance: 'book_worked', printed_answer: null, printed_page: w.printed_page, shortcode: null, figures: w.figures || [] }))
  const exs = L.items.map((i) => ({ ref: i.ref, kind: 'exercise', lo: i.lo, stem: i.stem, solution: i.solution,
    solution_provenance: i.solution_provenance, printed_answer: i.printed_answer, printed_answer_scope: i.printed_answer_scope,
    printed_page: i.printed_page, shortcode: i.shortcode, figures: i.figures || [], figures_missing: i.figures_missing || [],
    asked_form: i.asked_form || null, printed_form_defect: i.printed_form_defect || null, raised_dot: !!i.raised_dot }))
  return wes.concat(exs)
}

const typingPrompt = (L, batch) => `Type each book item below for automatic marking, from its PRINTED ANSWER and its BOOK SOLUTION. You do not solve anything.

For each item:
- answer_type:
  numeric — the answer is one number (integer or decimal, possibly with a unit or currency: put the number alone in key, as printed, and the unit in unit);
  choice — a verbal or choice answer ("irrational", "rhombus", "(ii)"). The options are NEVER yours to make up. Give only: the alternatives the stem itself offers in its words (options_source "stem"); or, when the answer is one of the labels a figure of the item shows (a point, a shape), those labels as the figure prints them, each option one label, optionally after the one word the stem uses for them ("E", "shape Z") (options_source "figure"); or a CLOSED SET OF CATEGORIES the book itself uses for exactly this kind of question — "rational" / "irrational", "real" / "non-real" / "undefined", true / false, "parallel" / "not parallel" — each option one word or short phrase that the stem or the lesson names (options_source "lesson"). Two to five options, with the key among them, written as the book writes them. A NUMBER, a pair of numbers ("4 and 5"), several values, an expression, an equation or a combination of categories ("rational, an integer") is the book's ANSWER, not a category: type it numeric or expression, never choice, and never with options you place around it (the book prints "4 and 5": expression, marker_kind "values", key "4; 5"; it prints "3,1": numeric "3,1"). A question that asks for several numbers out of a list in its stem ("which of these are integers?") is expression with marker_kind "values" (key the numbers, as "-1; 0; 1; 6"), or numeric when the answer is one number: never a choice with the whole list as options. An answer of two parts of different kinds ("(i) 555 (ii) rational") is not_markable with not_markable_reason "two-part answer";
  expression — an algebraic expression, factorised or expanded form, equation, several values, interval, inequality or set, coordinates, surd or π, recurring decimal. Give marker_kind (expression | equation | values | interval | coordinates | surd | recurring), form when the question asks for one (factorised | expanded | simplest | subject, with subject = the variable), variables (the letters in the answer), and key in LaTeX;
  not_markable — a proof, a sketch or drawing, "show that", "represent", "complete the table", or an explanation: give not_markable_reason.
- key: the PRINTED ANSWER's value, in LaTeX the marker can read. Keep decimal commas and (x; y) as printed. The printed answer is the PDF's flattened text: a fraction's numerator and denominator sit side by side ("y = 1 3 x" is $y = \\frac{1}{3}x$), a root loses its bar ("√ 29" is \\sqrt{29}), a power drops to the line ("x2" is x^{2}) — read its structure from the book solution's final line, which is LaTeX, and never change a value. Only when there is no printed answer, from the book solution's final answer.
- book_final: the final answer of the BOOK SOLUTION, QUOTED from its last sentence or line exactly as written (for a worked example, from its last step): you may leave out a parenthetical remark, but never add a word, a number, a calculation or a step the solution does not contain, never summarise, and never drop or add a "not". Copy it; never from the printed answer.
- tier: basic = one method step; standard = a multi-step application of one method; advanced = methods combined, a word problem, or an end-of-chapter item.
- form: when the question asks for one — factorised, expanded, simplest, subject, prime_factors ("a product of prime factors"; a single number is not that form), decimal ("write in decimal form"; a fraction is not that form). An item marked ASKED FORM below takes exactly that form.
${BOOK.multiplication_dot ? '- THIS BOOK PRINTS MULTIPLICATION AS A RAISED DOT (2·3^x). In the flattened printed answer it shows as " . " between digits ("2 . 3x"). It is NEVER a decimal point (this book writes decimals with a comma): write it as \\cdot in the key (2\\cdot 3^{x}).\n' : ''}Do not read any file.

LESSON ${L.slug}: ${L.title}
${batch.map((it) => `[${it.ref}] (${it.kind})${it.asked_form ? `\n  ASKED FORM: ${it.asked_form}` : ''}\n  STEM: ${it.stem}\n  PRINTED ANSWER: ${it.printed_answer || '(none printed)'}\n  BOOK SOLUTION: ${it.solution.join(' ⏎ ')}`).join('\n\n')}

Return TYPING_SCHEMA with one row per item; ref is the item's id as shown in brackets, written without the brackets.`

const blindPrompt = (L, batch) => `Solve each problem below yourself, independently, and give its FINAL answer. You are a checker: no answer or solution is shown to you, and none exists for you to find — do not look for one.
${batch.some((it) => it.figures.length) ? 'Some problems have a figure: read the image file named with the Read tool before answering.\n' : 'Do not read any file.\n'}
- final_answer: LaTeX, in the form the question asks for (factorised, simplest, surd form, to 2 decimal places …). Several values: all of them. Coordinates: (x; y).
- markable: false when the item asks for a proof, a sketch, a drawing, a table or an explanation (then final_answer may be "").
- working: a line or two.

${batch.map((it) => `[${it.ref}] ${it.stem}${it.figures.length ? `\n  figure(s): ${it.figures.join(', ')}` : ''}`).join('\n\n')}

Return BLIND_SCHEMA with one row per problem; ref is the problem's id as shown in brackets, written without the brackets.`

// options_source "figure" (lesson-v4): the item has a figure, and every option is ONE label as a figure
// prints it (a letter, with an index or a prime), all after the same optional word, which the stem uses
// ("shape Z" when the stem speaks of shapes). The labels are distinct. The book gives no figure's label
// set as data (the EPUB's figures are images; the PDF's are vector forms with no position on the page), so
// whether each label is in the figure is not checked here: the blind re-solve reads the figure and must
// pick the same label as the printed answer.
const FIGURE_LABEL = /^(?:([A-Za-z]+)\s+)?\$?([A-Za-z](?:_\{?\d{1,2}\}?|\d)?(?:'|′){0,2})\$?$/
function figureOptionProblems(it, opts) {
  const problems = []
  if (!(it.figures || []).length) problems.push('options said to be a figure\'s labels, but the item has no figure')
  const parsed = opts.map((o) => FIGURE_LABEL.exec(String(o).trim()))
  if (parsed.some((m) => !m)) { problems.push('options said to be a figure\'s labels are not all single labels'); return problems }
  const words = new Set(parsed.map((m) => (m[1] || '').toLowerCase()))
  if (words.size > 1) problems.push('options said to be a figure\'s labels do not name them alike')
  const w = [...words][0]
  if (w && !norm(it.stem).includes(w)) problems.push(`options said to be a figure's labels call them "${w}", a word the stem does not use`)
  if (new Set(parsed.map((m) => m[2])).size !== parsed.length) problems.push('options said to be a figure\'s labels repeat a label')
  return problems
}

// a choice's own problems (collect-6) and whether the OPTIONS are the typing agent's inventions rather than the book's
function choiceProblems(it, t, lessonText) {
  const opts = (t.options || []).filter((o) => o && o.trim())
  const at = opts.findIndex((o) => norm(o) === norm(t.key))
  const problems = []
  if (opts.length < 2 || at < 0) problems.push('a choice needs 2–5 options with the key among them')
  if (opts.length > 5) problems.push(`a choice needs 2–5 options, not ${opts.length}: a list in the stem to select from is not a choice`)
  if (new Set(opts.map((o) => norm(o))).size !== opts.length) problems.push('a choice\'s options repeat')
  if (t.options_source === 'stem' && opts.some((o) => !norm(it.stem).includes(norm(o)))) problems.push('options said to be the stem\'s are not all in the stem')
  if (t.options_source === 'figure') problems.push(...figureOptionProblems(it, opts))
  const closed = t.options_source === 'lesson' ? closedSetProblems(it, opts, lessonText) : []
  problems.push(...closed)
  return { opts, at, problems, invented: closed.length > 0 || opts.length > 5 || opts.length < 2 || at < 0 }
}

// A form the marker kind cannot carry (collect-6): the coherence rules of schemas.AnswerSpec, with its words. 'simplest' fits any
// kind (the app's marker marks a surd under it), so it is never a problem here.
function formKindProblem(form, kind) {
  if (!form) return null
  if (typeof form === 'object') return kind === 'equation' ? null : 'a subject form needs marker kind "equation" (the app\'s marker)'
  if ((form === 'factorised' || form === 'expanded') && kind !== 'expression' && kind !== 'equation') {
    return `form '${form}' applies to an expression or an equation, not to kind '${kind}'`
  }
  if (form === 'decimal' && !['expression', 'recurring', 'values'].includes(kind)) {
    return `form 'decimal' applies to a number, a recurring decimal or values, not to kind '${kind}'`
  }
  return null
}
// The kind a form needs, where the KEY says so: plainly algebra in the declared variables. Not a list ("2; 3", "x=2 or x=3"), an
// inequality or interval, a set, a coordinate pair, a sentence; never an interval or a pair of coordinates by kind. Returns
// 'expression' | 'equation' | null (null: leave the problem to G2). The key itself is never touched.
function kindForForm(t, form) {
  if (t.marker_kind === 'interval' || t.marker_kind === 'coordinates') return null
  const key = String(t.key || '')
  const vars = (t.variables || []).filter((v) => typeof v === 'string' && v)
  if (!vars.length) return null
  if (/[<>;]|\\(?:le|ge|leq|geq|ne|neq|in|cup|cap)(?![a-zA-Z])|\\[{}]|\\(?:text|mbox|mathrm|textrm)\{|\b(?:or|and)\b/.test(key)) return null
  const bare = key.replace(/\\[a-zA-Z]+/g, ' ')                        // LaTeX command names are not variables
  const has = (v) => (v.startsWith('\\') ? key.includes(v) : bare.includes(v))   // "xy", "jkl": juxtaposed variables
  if (!vars.some(has)) return null
  const eq = (key.match(/=/g) || []).length
  if (eq > 1) return null
  if (typeof form === 'object') return eq === 1 ? 'equation' : null    // "make x the subject" is of an equation
  return eq === 1 ? 'equation' : 'expression'
}

// a numeric key that is one fraction: "\frac{9}{10}", "-\frac{3}{8}", "\frac{-3}{8}", "-5/3" (the unit, if any, dropped). Returns the key as
// the typing agent wrote it, without the unit, or null.
function fractionKey(key) {
  const k = String(key == null ? '' : key).replace(/\$/g, '').replace(/\\(?:text|mathrm|textrm|mbox)\{[^{}]*\}/g, '').replace(/\s*[A-Za-z%°][A-Za-z%°0-9\s]*$/, '').trim()
  const n = normTex(k)
  return /^-?\\frac\{\d+\}\{\d+\}$/.test(n) || /^-?\d+\/\d+$/.test(n) ? k : null
}
// the top-level ";"-separated parts of a key (never inside (), {} or [])
function semicolonParts(key) {
  const out = []; let depth = 0, cur = ''
  for (const ch of String(key)) {
    if ('({['.includes(ch)) depth++
    if (')}]'.includes(ch)) depth--
    if (ch === ';' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map((x) => x.trim()).filter(Boolean)
}
// The kind a KEY needs when the typing agent's kind cannot read it (see checkTyping): "values" for a list of plain values (numbers, fractions,
// surds: no variable, no relation) typed "surd" or "expression"; "interval" for inequalities and set membership typed "equation", "expression"
// or "values" (the app's interval kind reads x<4; x∈ℕ, x≠3 and 3<x<6; its equation and values kinds refuse them); "equation" for one equals
// sign typed "expression" or "surd". null: the kind stands.
function kindForKey(key, kind) {
  const k = String(key == null ? '' : key)
  if (kind === 'surd' || kind === 'expression') {
    const parts = semicolonParts(k)
    if (parts.length >= 2 && parts.every((x) => { const n = normTex(x); return !/[=<>≤≥≠∈]/.test(n) && !/[A-Za-z]/.test(n.replace(/\\[a-zA-Z]+/g, '')) })) return 'values'
  }
  if (kind === 'equation' || kind === 'expression' || kind === 'values') {
    const n = normTex(k)
    if (/[<>≤≥∈≠]|\\neq?(?![a-zA-Z])|\\in(?![a-zA-Z])/.test(n) && !/=/.test(n)) return 'interval'
  }
  // one equals sign (T_n=4n-1, r=\pm\sqrt{…}, y=2x+1) is an equation: the app's expression and surd kinds refuse it ("unexpected input after the
  // answer"), its equation kind reads it
  if (kind === 'expression' || kind === 'surd') {
    const n = normTex(k)
    if ((n.match(/=/g) || []).length === 1 && !/[<>≤≥∈≠,]|\\neq?(?![a-zA-Z])|\\in(?![a-zA-Z])/.test(n) && !/^=|=$/.test(n)) return 'equation'
  }
  return null
}

function checkTyping(it, t, lessonText) {
  const problems = []
  if (!t) return { problems: ['typing returned nothing'] }
  // collect-6: a choice whose options are not the book's is typed again from the key, where the key is plainly a number or numbers
  if (t.answer_type === 'choice') {
    const c = choiceProblems(it, t, lessonText || '')
    const re = c.invented ? retypeFromKey(t) : null
    if (re) {
      const r = checkTyping(it, re.t, lessonText)
      r.typed.retyped = { from: 'choice', as: re.rule === 'numeric' ? 'numeric' : 'expression (values)', rule: re.rule, options_source: t.options_source || null,
        options: c.opts, because: c.problems.filter((p) => !/^a choice needs 2–5 options with the key/.test(p)).concat(c.opts.length < 2 || c.at < 0 ? ['the key is not among the options'] : []) }
      return r
    }
  }
  // collect-6 (Chapter 4): a numeric key that is a fraction is an exact value the app's NUMERIC grader cannot mark ("-5/3" is read as -5 by
  // parseFloat, so a correct "-5/3" or "-1.6667" is marked wrong); the expression marker marks it ("9/10", "0.9" and "18/20" for 9/10).
  // Typed again as an expression, the key kept exactly (the unit, if any, is the stem's), and recorded.
  if (t.answer_type === 'numeric') {
    const fk = fractionKey(t.key)
    if (fk) {
      const r = checkTyping(it, Object.assign({}, t, { answer_type: 'expression', marker_kind: 'expression', form: '', variables: [], key: fk }), lessonText)
      r.typed.retyped = { from: 'numeric', as: 'expression (an exact fraction)', rule: 'fraction-key',
        because: [`the numeric key "${t.key}" is a fraction: the numeric grader reads "a/b" as a, the expression marker marks the fraction`] }
      return r
    }
  }
  let effKind = t.marker_kind
  // (collect-6: an item typed not markable marks no answer, so a copy of the book's final that is not faithful is no problem)
  if (t.answer_type !== 'not_markable' && t.book_final && !inBookSolution(it.solution, t.book_final)) problems.push('book_final is not in the book solution')
  if (!t.book_final && t.answer_type !== 'not_markable') problems.push('no book_final')
  const typed = { answer_type: t.answer_type, answer: null, choices: null, marker: null, unit: t.unit || null, options_source: null }
  if (t.answer_type === 'numeric') {
    const k = normTex(t.key).replace(/[A-Za-z%°]+[0-9]*$/, '')
    if (!/^-?\d+(?:\.\d+)?(?:\/\d+)?$/.test(k)) problems.push(`numeric key "${t.key}" is not a number`)
    // the number the check above read: without the book's \text{…} wrapper ("\text{0,5}" is 0,5) —
    // assembly reads a numeric key as a bare number (COLLECT-4)
    typed.answer = String(t.key).replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, '$1')
      .replace(/\s*[A-Za-z%°][A-Za-z%°0-9\s]*$/, '').replace(/\$/g, '').trim()
  } else if (t.answer_type === 'choice') {
    const c = choiceProblems(it, t, lessonText || '')
    problems.push(...c.problems)
    // every option keyed (collect-6: 'ABCDE'[5] was undefined, an option without a key)
    typed.choices = c.opts.map((o, k) => ({ key: LETTERS[k], text: o }))
    typed.answer = c.at >= 0 ? LETTERS[c.at] : null
    typed.options_source = t.options_source || null
  } else if (t.answer_type === 'expression') {
    if (!MARKER_KINDS.includes(t.marker_kind)) problems.push(`marker kind "${t.marker_kind}" is not one of ${MARKER_KINDS.join(', ')}`)
    if (!String(t.key || '').trim()) problems.push('empty marker key')
    let form = null
    if (t.form === 'subject') form = t.subject ? { subject: t.subject } : (problems.push('form "subject" names no variable'), null)
    else if (t.form) form = t.form
    // the book's rule wins: the stem asks for this form, so the marker checks it (backlog 30/31) —
    // when the app's marker knows the form; otherwise the item is held (below), never mis-specified
    if (it.asked_form && APP_FORMS.includes(it.asked_form) && form !== it.asked_form) {
      typed.form_overridden = { typing: form, book_rule: it.asked_form }; form = it.asked_form
    }
    // collect-5 (consistency review A9): "in the form y = mx + c" — a subject form from the book's rule
    if (it.asked_form && typeof it.asked_form === 'object' && it.asked_form.subject && t.marker_kind === 'equation' &&
        !(form && typeof form === 'object' && form.subject === it.asked_form.subject)) {
      typed.form_overridden = { typing: form, book_rule: it.asked_form }; form = { subject: it.asked_form.subject }
    }
    if (form && typeof form === 'string' && !APP_FORMS.includes(form)) { problems.push(`form "${form}" is not one the app's marker knows`); form = null }
    // collect-6 (Ex1-9:11): a form the kind cannot carry. The key is algebra in the variables → the kind is normalised (expression, or
    // equation) and the retype recorded; otherwise the item carries the problem, so it is held (schemas.AnswerSpec would refuse it)
    let kind = t.marker_kind
    // collect-6 (Chapter 4): a kind the key cannot be read under. A list of values typed "surd" (x = √18 or x = −√18) or an
    // inequality / set-membership list typed "equation" ("not an equation" to the app's marker) is held as unanswerable at assembly; the
    // marker reads the same key under "values" / "interval" (checked against the app's marker), so the KIND is normalised, the key kept exactly.
    const reKind = MARKER_KINDS.includes(kind) ? kindForKey(t.key, kind) : null
    if (reKind) {
      typed.retyped = { from: `expression (${kind})`, as: `expression, kind ${reKind} (was ${kind})`,
        rule: reKind === 'values' ? 'kind-for-list' : reKind === 'equation' ? 'kind-for-equation' : 'kind-for-relations',
        because: [reKind === 'values' ? `the key lists values, which kind "${kind}" cannot read`
          : reKind === 'equation' ? `the key has an equals sign, which kind "${kind}" cannot read`
          : `the key is an inequality or a set-membership list, which kind "${kind}" cannot read`] }
      kind = reKind
    }
    effKind = kind
    const formWhy = MARKER_KINDS.includes(kind) ? formKindProblem(form, kind) : null
    if (formWhy) {
      const to = kindForForm(t, form)
      if (to) { typed.retyped = { from: `expression (${kind})`, as: `expression, kind ${to} (was ${kind})`, rule: 'kind-for-form', form, because: [formWhy] }; kind = to }
      else problems.push(formWhy)
    }
    // the variables the marker is told (schemas.AnswerSpec: a letter, a subscripted letter or a LaTeX Greek NAME): a Greek letter the typing agent
    // wrote as the sign ("λ") is its name ("\lambda"); π is the constant, not a variable (declared, it would stop meaning 3,14…) — COLLECT-6
    const vars = [...new Set((t.variables || []).filter((v) => typeof v === 'string' && v && !/^(?:π|\\pi)$/.test(v)).map((v) => GREEK_NAME[v] || v))]
    typed.marker = { kind, key: t.key, form, variables: vars, tolerance: null }
    typed.answer = t.key
  } else if (!t.not_markable_reason) problems.push('not_markable without a reason')
  if (it.asked_form === 'prime_factors' && t.answer_type !== 'expression' && t.answer_type !== 'not_markable') {
    problems.push('a product of prime factors is typed "expression" with the prime_factors form: as a number the marker would accept 143 for 11 × 13')
  }
  if (it.raised_dot && t.key && /\d\.\d/.test(t.key) && !/\\cdot|\\times/.test(t.key)) {
    problems.push('the book\'s raised dot is multiplication: the key must write \\cdot, not a decimal point')
  }
  if (t.answer_type !== 'not_markable' && t.key) {
    const against = it.printed_answer || t.book_final
    // the number an answer states: after its last "=" ("f(2) = 5" states 5, never 2) — COLLECT-3
    const numOf = (x) => { const m = normTex(x).split('=').pop().match(/-?\d+(?:\.\d+)?(?:\/\d+)?/); return m ? m[0] : null }
    // a printed answer that opens with "=" has lost its left side to the text layer ("= −14n + 7" for "T_n = −14n + 7"): its right side
    // is what it states, and the key's own left side is not what the book printed (COLLECT-6; the value is never touched)
    const unitless = against && it.printed_answer ? withoutUnit(against, it.stem, t.unit) : null     // "19 50 litres": the stem names the unit
    const readAs = against ? [against, ...(it.printed_answer && /^\s*=\s*\S/.test(against) ? [against.replace(/^\s*=\s*/, '')] : []), ...(unitless ? [unitless] : [])] : []
    const asValues = t.answer_type === 'expression' && effKind === 'values'
    if (against && !(readAs.some((ag) => settle(t.key, ag, !!it.printed_answer).verdict === 'equivalent') ||
      (asValues && sameValues(t.key, against, !!it.printed_answer)) ||
      // collect-6 (Chapter 4): the values a SENTENCE states ("There are 5 tricycles and 2 bicycles."), in order and with nothing else; the
      // `var = value` segments of a book solution's sentence; a key that is an inequality / interval, found whole in the printed answer
      (asValues && sentenceMatchesValues(t.key, against)) ||
      (asValues && (() => { const al = assignedList(against); return !!al && sameValues(t.key, al, false) })()) ||
      (t.answer_type === 'expression' && relEquivalent(t.key, against, it.ref)) ||
      (t.answer_type === 'numeric' && numOf(typed.answer) !== null && numOf(typed.answer) === numOf(against)) ||
      (asValues && betweenEnds(it.stem, against, t.key)) ||
      (t.answer_type === 'choice' && norm(against).includes(norm(t.key))))) {
      problems.push(`the key "${t.key}" does not read as the ${it.printed_answer ? 'printed answer' : 'book final answer'} "${against}"`)
    }
  }
  return { typed, problems }
}

async function runS3(L) {
  const s = L.slug
  const items = s3Items(L)
  // what the lesson itself says (collect-6): the closed set an option may come from
  const lessonText = [...L.blocks.map((b) => b.text), ...L.worked_examples.map((w) => `${w.title} ${w.stem} ${w.solution.join(' ')}`)].join(' ')
  const typingBatches = chunk(items, OPT.typing_batch)
  const blindBatches = chunk(items, OPT.blind_batch)
  const sampled = items.filter((it) => fnv(`${s}:${it.ref}`) % OPT.tier_sample_every === 0)
  if (!sampled.length && items.length) sampled.push(items[0])
  const jobs = [
    ...typingBatches.map((b, k) => () => call('S3 Typing', s, `S3:type:${s}:${k + 1}`, typingPrompt(L, b), { model: 'haiku', effort: 'low', schema: TYPING_SCHEMA })),
    ...blindBatches.map((b, k) => () => call('S3 Blind re-solve', s, `S3:blind:${s}:${k + 1}`, blindPrompt(L, b), { model: 'sonnet', schema: BLIND_SCHEMA })),
  ]
  if (sampled.length) {
    jobs.push(() => call('S3 Tier check', s, `S3:tier:${s}`, `Assign each item a difficulty tier: basic = one method step; standard = a multi-step application of one method; advanced = methods combined, a word problem, or an end-of-chapter item. Do not read any file.\n\n${sampled.map((it) => `[${it.ref}] ${it.stem}`).join('\n\n')}\n\nReturn TIER_SCHEMA.`, { model: 'sonnet', schema: TIER_SCHEMA }))
  }
  const res = await parallel(jobs)
  const typing = {}, blind = {}, tier2 = {}
  const REFS = new Set(items.map((it) => it.ref))
  const isRef = (k) => REFS.has(k)
  const offTask = []                       // refs an agent answered that it was never asked (COLLECT-2)
  const collect = (rows, into, asked, what) => rows.forEach((x) => {
    const ref = unbr(x.ref, isRef)
    if (!asked.has(ref)) { offTask.push(`${what}: ${String(x.ref).slice(0, 60)}`); return }
    x.ref = ref
    into[ref] = x
  })
  typingBatches.forEach((b, k) => collect(((res[k] || {}).items) || [], typing, new Set(b.map((it) => it.ref)), `typing ${k + 1}`))
  blindBatches.forEach((b, k) => collect(((res[typingBatches.length + k] || {}).answers) || [], blind, new Set(b.map((it) => it.ref)), `blind ${k + 1}`))
  // a batch answered in part (or off task) is asked again, once, for the items it left out
  const again = []
  typingBatches.forEach((b, k) => { const left = b.filter((it) => !typing[it.ref]); if (left.length) again.push({ kind: 'type', k, left }) })
  blindBatches.forEach((b, k) => { const left = b.filter((it) => !blind[it.ref]); if (left.length) again.push({ kind: 'blind', k, left }) })
  if (again.length) {
    log(`${s}: ${again.map((a) => `${a.kind} batch ${a.k + 1} left ${a.left.length} item(s) unanswered`).join('; ')}` +
      (offTask.length ? `; off-task answers: ${offTask.slice(0, 3).join(', ')}` : '') + ' — asking again once')
    const redo = await parallel(again.map((a) => () => (a.kind === 'type'
      ? call('S3 Typing', s, `S3:type:${s}:${a.k + 1}:again`, typingPrompt(L, a.left), { model: 'haiku', effort: 'low', schema: TYPING_SCHEMA })
      : call('S3 Blind re-solve', s, `S3:blind:${s}:${a.k + 1}:again`, blindPrompt(L, a.left), { model: 'sonnet', schema: BLIND_SCHEMA }))))
    again.forEach((a, i) => collect(((redo[i] || {})[a.kind === 'type' ? 'items' : 'answers']) || [],
      a.kind === 'type' ? typing : blind, new Set(a.left.map((it) => it.ref)), `${a.kind} ${a.k + 1} again`))
  }
  const tierRes = sampled.length ? res[res.length - 1] : null
  ;((tierRes && tierRes.tiers) || []).forEach((t) => { tier2[unbr(t.ref, isRef)] = t.tier })

  // three-way comparison: settle deterministically what can be, send the rest to the judge
  const rows = items.map((it) => {
    const { typed, problems } = checkTyping(it, typing[it.ref], lessonText)
    const t = typing[it.ref] || {}
    const b = blind[it.ref]
    const blindAns = b && b.markable !== false && b.final_answer ? b.final_answer : null
    const typedNotMarkable = t.answer_type === 'not_markable'
    const bookFinal = typedNotMarkable || problems.includes('book_final is not in the book solution') ? null : (t.book_final || null)
    // what a missing pair is missing, so an unchecked item is never read as the book disagreeing
    const missing = []
    if (!typing[it.ref]) missing.push('no typing answer')
    if (!b) missing.push('no blind re-solve answer')
    else if (!blindAns && t.answer_type !== 'not_markable' && b.markable !== false) missing.push('an empty blind answer')
    if (t.book_final && !bookFinal && !typedNotMarkable) missing.push('book_final is not in the book solution')
    // not a missing check: the blind solver ran and judged the item not markable (typing said it is)
    const blindSaysNotMarkable = !!b && b.markable === false && t.answer_type && t.answer_type !== 'not_markable'
    // both say there is no answer to mark (a proof, a "show that"): the blind pairs agree on that (COLLECT-3)
    const bothNotMarkable = !!b && b.markable === false && t.answer_type === 'not_markable'
    // the stem refers to a figure the blind solver was never given: its answer is no check (COLLECT-3)
    const figureWithheld = /\[figure\]/.test(it.stem) && !(it.figures || []).length
    const pairs = []
    if (it.kind === 'worked_example' || !it.printed_answer) {
      pairs.push({ pair_id: `${it.ref}|blind~book`, a: blindAns, b: bookFinal, ...settle(blindAns, bookFinal, false) })
    } else {
      pairs.push({ pair_id: `${it.ref}|blind~printed`, a: blindAns, b: it.printed_answer, ...settle(blindAns, it.printed_answer, true) })
      pairs.push({ pair_id: `${it.ref}|blind~book`, a: blindAns, b: bookFinal, ...settle(blindAns, bookFinal, false) })
      pairs.push({ pair_id: `${it.ref}|book~printed`, a: bookFinal, b: it.printed_answer, ...settle(bookFinal, it.printed_answer, true) })
    }
    if (blindSaysNotMarkable) {
      for (const p of pairs) if (p.verdict === 'missing' && /^.+\|blind~/.test(p.pair_id)) p.reason = 'the blind solver judged the item not markable; typing says it is'
    }
    if (bothNotMarkable) {
      for (const p of pairs) if (/^.+\|blind~/.test(p.pair_id)) Object.assign(p, { route: 'not_markable', verdict: 'equivalent', reason: 'typing and the blind solver agree it has no answer to mark' })
    }
    // collect-6: an item typed not markable has nothing to mark, so the book's final is not compared; only what the blind
    // solver and the printed answer say of each other can still disagree
    if (typedNotMarkable) {
      for (const p of pairs) {
        if (/\|(?:blind~book|book~printed)$/.test(p.pair_id) && p.verdict !== 'equivalent') {
          Object.assign(p, { route: 'not_markable', verdict: 'equivalent', reason: 'typed not markable: nothing is marked, so the book\'s final is not compared' })
        }
      }
    }
    // collect-6: a verbal choice settles by the option each source names (no judge). The printed and the blind answer must be
    // words only; the book side is the solution's own text (digits and maths allowed in its explanation), so a typing agent's
    // faulty copy of the book's final does not hold the item up when the solution itself names the key option.
    if (typed && typed.answer_type === 'choice' && typed.answer && typed.choices && typed.choices.length >= 2 &&
        typed.choices.length <= 5 && typed.choices.every((c) => isCategory(c.text)) && !figureWithheld) {
      const opts = typed.choices.map((c) => c.text)
      const kIdx = typed.choices.findIndex((c) => c.key === typed.answer)
      const says = (x) => wordsOnly(x) && namesOnly(x, opts, kIdx)
      // the book's conclusion is its last sentence ("Therefore π + 3 is irrational."); when that names no option the whole
      // solution is read ("… is rational. Note that b cannot be 0 …")
      const whole = it.solution.join(' ')
      const sentences = whole.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean)
      const lastS = sentences.length ? sentences[sentences.length - 1] : ''
      const bookSays = optionsNamed(lastS, opts).named.size ? namesOnly(lastS, opts, kIdx) : namesOnly(whole, opts, kIdx)
      const same = { route: 'options', verdict: 'equivalent', reason: `both name only "${opts[kIdx]}"` }
      let bookSettled = false
      for (const p of pairs) {
        if (p.verdict === 'equivalent') continue
        const id = p.pair_id.split('|')[1]
        const ok = id === 'blind~printed' ? says(blindAns) && says(it.printed_answer)
          : id === 'blind~book' ? says(blindAns) && bookSays
          : id === 'book~printed' ? bookSays && says(it.printed_answer) : false
        if (ok) { Object.assign(p, same); if (id !== 'blind~printed') bookSettled = true }
      }
      // the typing agent's copy of the book's final was no use, but the solution names the key option: nothing is missing
      if (bookSettled && !bookFinal && !pairs.some((p) => p.verdict === 'missing')) {
        const k = problems.indexOf('book_final is not in the book solution')
        if (k >= 0) problems.splice(k, 1)
        const m = missing.indexOf('book_final is not in the book solution')
        if (m >= 0) missing.splice(m, 1)
      }
    }
    return { it, typed, problems, t, blindAns, bookFinal, pairs, missing, figureWithheld }
  })
  const pending = rows.flatMap((r) => r.pairs.filter((p) => p.route === 'judge').map((p) => ({ p, stem: r.it.stem })))
  if (pending.length) {
    const judged = await parallel(chunk(pending, 60).map((c, k) => () => call('S3 Judge', s, `S3:judge:${s}:${k + 1}`,
      `Decide whether each pair of answers to the stated problem is mathematically the same answer. The two may be written differently: LaTeX or flattened print (a fraction "3 25" is 3/25), a decimal comma or point, (x; y) or (x, y), "x = 2" or "2", values in any order, an equivalent rearrangement. They are "different" if they are different values or sets, or if a form the problem asks for (factorised, surd form, a stated rounding) is met by one and not the other. "unclear" if you cannot tell. You are not told which answer is right, and neither may be. Do not read any file.\n\n${c.map(({ p, stem }) => `pair_id=${p.pair_id}\n  problem: ${stem}\n  answer 1: ${p.a}\n  answer 2: ${p.b}`).join('\n\n')}\n\nReturn JUDGE_SCHEMA.`,
      { model: 'sonnet', schema: JUDGE_SCHEMA })))
    const v = {}
    judged.forEach((r) => ((r && r.verdicts) || []).forEach((x) => { v[x.pair_id] = x }))
    for (const { p } of pending) { const x = v[p.pair_id]; p.verdict = x ? x.verdict : 'unclear'; p.reason = x ? x.reason : 'the judge returned no verdict' }
  }
  for (const r of rows) {
    // a blind answer given without the figure the stem refers to: agreement stands (the text sufficed),
    // anything else is UNCHECKED — the check was never made, it is not the book disagreeing (COLLECT-3)
    if (r.figureWithheld) {
      let hit = false
      for (const p of r.pairs) if (/^.+\|blind~/.test(p.pair_id) && p.verdict !== 'equivalent') { Object.assign(p, { verdict: 'missing', reason: 'the blind solver was not shown the figure its stem refers to' }); hit = true }
      if (hit) r.missing.push('the blind solver was not shown the figure')
    }
    // three answers cannot be pairwise "equivalent, equivalent, different": one verdict is wrong (COLLECT-3)
    const vs = r.pairs.filter((p) => p.route !== 'not_markable' && (p.verdict === 'equivalent' || p.verdict === 'different'))
    r.judgeInconsistent = r.pairs.length === 3 && vs.length === 3 && vs.filter((p) => p.verdict === 'different').length === 1
  }

  const out = []
  const tierChecks = []
  for (const r of rows) {
    const { it, typed, problems, t } = r
    const agree = r.pairs.every((p) => p.verdict === 'equivalent')
    let verification = it.kind === 'exercise' && !it.printed_answer ? 'no_printed_answer' : (agree ? 'agreed' : 'disputed')
    // a printed answer not in the form its question asks for: held for G2, never corrected here
    if (it.printed_form_defect && verification === 'agreed') verification = 'disputed'
    // a form the app's marker cannot check (a product of prime factors): held until it can
    const formUnsupported = it.asked_form && typeof it.asked_form === 'string' && !APP_FORMS.includes(it.asked_form) ? it.asked_form : null
    if (formUnsupported && verification === 'agreed') verification = 'disputed'
    let tier = t.tier || 'standard'
    let tierSource = typing[it.ref] ? 'typing' : 'default'
    if (it.ref in tier2) { tierChecks.push({ ref: it.ref, typing: t.tier || null, check: tier2[it.ref] }); if (tier2[it.ref] !== tier) { tier = tier2[it.ref]; tierSource = 'tier check' } }
    if (!typing[it.ref]) problems.push('typing returned nothing for this item')
    out.push({
      ref: it.ref, kind: it.kind, lo: it.lo, stem: it.stem,
      answer_type: (typed && typed.answer_type) || 'not_markable',
      answer: typed ? typed.answer : null, choices: typed && typed.choices, marker: typed && typed.marker,
      solution: it.solution, solution_provenance: it.solution_provenance,
      printed_answer: it.printed_answer || null, epub_final_answer: r.bookFinal, blind_answer: r.blindAns,
      verification, tier, printed_page: it.printed_page, shortcode: it.shortcode || null,
      // diagnostics for G2 and the coverage audit
      verify: { agreed_with_book_solution: it.kind === 'exercise' && !it.printed_answer ? r.pairs[0].verdict === 'equivalent' : undefined,
        pairs: r.pairs.map((p) => ({ pair_id: p.pair_id, route: p.route, verdict: p.verdict, reason: p.reason })),
        ...(r.missing.length && r.pairs.some((p) => p.verdict === 'missing') ? { unchecked: r.missing } : {}),
        ...(r.judgeInconsistent ? { inconsistent: 'the three pairwise verdicts contradict each other: one is wrong' } : {}) },
      typing_problems: problems, unit: typed && typed.unit, options_source: typed && typed.options_source,
      not_markable_reason: t.not_markable_reason || null, tier_source: tierSource,
      printed_answer_scope: it.printed_answer_scope || null, figures: it.figures, figures_missing: it.figures_missing || [],
      asked_form: it.asked_form, printed_form_defect: it.printed_form_defect, form_overridden: (typed && typed.form_overridden) || null,
      form_unsupported: formUnsupported,
      ...(typed && typed.retyped ? { typing_retyped: typed.retyped } : {}),
    })
  }
  return { items: out, tier_checks: tierChecks, off_task: offTask }
}

// ---- S4 visuals -------------------------------------------------------------------------------------
const stemOf = (L, ref) => { const it = ref && (L.items || []).find((i) => i.ref === ref); return it ? String(it.stem || '').slice(0, 600) : '' }
async function runS4(L, s2) {
  const s = L.slug
  // visuals-only re-run (consistency review A3/A8): only the figures named in L.rerun_figures
  const figs = (L.figures || []).filter((f) => !ARGS.visuals_only || (L.rerun_figures || []).includes(f.figure_id))
  const gaps = [], visuals = []
  const usable = figs.filter((f) => { if (!f.path) { gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: 'no crop file for this figure' }); return false } return true })
  if (!usable.length) return { visuals, gaps, compared: 0 }
  const claims = ((s2 && s2.kept) || []).filter((c) => c.supported).map((c) => `${c.lo}: ${c.text}`).slice(0, 80).join('\n')
  const kinds = VIZ.map((k) => `- ${k.kind}: ${k.doc}`).join('\n')
  const authored = await parallel(chunk(usable, OPT.figures_per_call).map((batch, k) => () => call('S4 Visuals', s, `S4:viz:${s}:${k + 1}`,
    `Turn each book figure below into a parametric spec of ONE of these existing visual kinds, so the app can draw it:
${kinds}

Read each figure's image file with the Read tool. For each figure: decision "viz" with kind, spec (exactly the kind's shape, with the figure's own numbers and labels), a one-line caption in plain student-voiced English, and lo (the objective it illustrates); or decision "gap" when no kind above can show it faithfully (a hyperbola, an exponential or trig graph, a Venn diagram, a box plot, a 3-D solid, a triangle or quadrilateral scene …), with gap_reason and needed_kind. Never force a figure into the nearest kind: a wrong picture teaches the wrong thing.

EVERY FIGURE: draw every element it shows — every labelled point, segment, side, line, function and label — with the figure's own values, except a withheld unknown (below). If the kind cannot draw one of them (two functions on one set of axes, a text annotation such as a slope, a shaded region …), decision "gap" with needed_kind naming exactly what is missing (e.g. "function_graph with two functions on one set of axes") — never a spec that leaves it out.

A FIGURE THAT BELONGS TO AN EXERCISE (marked "exercise" below; its question is shown with it) MUST NOT ANSWER IT:
- leave out the unknown the question asks for — a point written with a letter for a coordinate (B(1; y), M(x; y)) or the point to be found — name its label in "withheld" (e.g. ["B"]), and DRAW THE REST: the known points, segments, lines and labels. A figure is never a gap only because it holds the unknown;
- never draw a point at a value that contradicts the question's own numbers;
- the caption describes only what is DRAWN; it never restates, changes or adds to the question, and it never describes a withheld point as marked, shown or drawn (no "with M marked on it", no tick marks the spec does not draw).
A WORKED EXAMPLE's figure may show its answer, as the book's does: draw it whole, at the book's values, with "withheld" empty.

The lesson's objectives:
${objList(L)}
What the lesson claims (context only):
${claims || '(none)'}

FIGURES:
${batch.map((f) => `[${f.figure_id}] ${f.path} (context ${f.context}${f.ref ? `, belongs to ${f.context === 'exercise_problem' ? 'exercise' : f.context === 'we' ? 'worked example' : ''} ${f.ref}` : ''}, p.${f.printed_page})${f.caption ? ' caption: ' + f.caption : ''}${stemOf(L, f.ref) ? `\n  ITS QUESTION: ${stemOf(L, f.ref)}` : ''}`).join('\n')}

Return VIZ_SCHEMA with one row per figure; figure_id as shown in brackets, written without the brackets.`, { model: 'sonnet', schema: VIZ_SCHEMA })))
  const byId = {}
  const isFig = (k) => usable.some((f) => f.figure_id === k)
  authored.forEach((r) => ((r && r.figures) || []).forEach((f) => { byId[unbr(f.figure_id, isFig)] = f }))
  const los = new Set(L.objectives.map((o) => o.id))
  const candidates = []
  for (const f of usable) {
    const a = byId[f.figure_id]
    if (!a) { gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: 'the visuals agent returned nothing for it' }); continue }
    if (a.decision === 'gap') { gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: a.gap_reason || 'no existing kind fits', needed_kind: a.needed_kind || null }); continue }
    const lo = loOf(los, a.lo)
    if (!VIZ_NAMES.includes(a.kind) || !a.spec || !Object.keys(a.spec).length || !lo) {
      gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, needed_kind: a.needed_kind || null,
        reason: !VIZ_NAMES.includes(a.kind) ? `"${a.kind}" is not an existing VIZ kind` : (!lo ? `unknown objective ${a.lo}` : 'empty spec') })
      continue
    }
    // lesson-v6: an exercise's figure may withhold its unknown (labels); anything else draws the figure whole
    a.withheld = f.context === 'exercise_problem' && Array.isArray(a.withheld) ? a.withheld.map(String).filter(Boolean) : []
    candidates.push({ f, a, lo })
  }
  if (candidates.length) {
    const cmp = await call('S4 Compare', s, `S4:compare:${s}`, `For each figure, read its image file with the Read tool and compare it with the spec an agent wrote to redraw it. faithful = the spec shows the same mathematical object: the same points, values, labels and relationships (styling may differ). Any wrong or missing value, point or label: faithful=false, with the issue.\n\n${candidates.map(({ f, a }) => `[${f.figure_id}] ${f.path}\n  kind ${a.kind} spec ${JSON.stringify(a.spec)}${a.withheld.length ? `\n  WITHHELD on purpose (the exercise's unknown, which the image shows): ${a.withheld.join(', ')} — their absence, and that of a segment ending at them, is not a mismatch; anything else missing, extra or wrong is` : ''}`).join('\n\n')}\n\nReturn COMPARE_SCHEMA.`, { model: 'haiku', effort: 'low', schema: COMPARE_SCHEMA })
    const v = {}
    for (const c of (cmp && cmp.checks) || []) v[unbr(c.figure_id, isFig)] = c
    for (const { f, a, lo } of candidates) {
      if (!(v[f.figure_id] && v[f.figure_id].faithful)) {
        gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: `the spec does not match the figure: ${(v[f.figure_id] && v[f.figure_id].issues) || 'no compare verdict'}`, rejected_spec: { kind: a.kind, spec: a.spec } })
        continue
      }
      visuals.push({ n: visuals.length + 1, lo, question: f.context === 'exercise_problem' || f.context === 'we' ? f.ref : null,
        kind: a.kind, spec: a.spec, caption: a.caption || null, printed_page: f.printed_page, figure_id: f.figure_id, src: f.src,
        ...(a.withheld.length ? { withheld: a.withheld } : {}) })
    }
  }
  return { visuals, gaps, compared: candidates.length }
}

// ---- S8 oracle ------------------------------------------------------------------------------------
async function runS8(L, s2, s3) {
  const s = L.slug
  const subs = (L.subheadings || []).filter((h) => h.anchor)
  const claims = ((s2 && s2.kept) || []).filter((c) => c.supported)
  const items = (s3 && s3.items) || []
  const tally = { claims: claims.length, questions: items.filter((i) => i.answer_type !== 'not_markable').length,
    worked_examples_kept_as_teaching: items.filter((i) => i.answer_type === 'not_markable').length,
    by_objective: L.objectives.map((o) => ({ lo: o.id, claims: claims.filter((c) => c.lo === o.id).length, items: items.filter((i) => i.lo === o.id).length })) }
  const res = await call('S8 Oracle', s, `S8:oracle:${s}`, `Coverage audit for lesson ${s} ("${L.title}"). The book teaches the material below. Compare it with what the line PRODUCED and say, per sub-heading, whether it is covered, thin or MISSING, listing what is missing. verdict = GREEN only if every sub-heading is covered. Do not read any file.

WHAT THE BOOK TEACHES (sub-headings, then the lesson text):
${subs.map((h) => `[${h.anchor}] ${h.title}`).join('\n') || `[${s}] the whole lesson (no sub-headings)`}
${L.blocks.map(blockLine).join('\n')}

WHAT WAS PRODUCED:
claims:
${claims.map((c) => `- (${c.lo}, ${c.anchor}) ${c.text}`).join('\n') || '(none)'}
questions and worked examples:
${items.map((i) => `- ${i.ref} (${i.lo}, ${i.answer_type}): ${i.stem}`).join('\n') || '(none)'}
tally: ${JSON.stringify(tally)}

Return ORACLE_SCHEMA; use anchor "${s}" for the whole lesson when there are no sub-headings.`, { model: 'sonnet', schema: ORACLE_SCHEMA })
  return { result: res, tally }
}

// ---- run ------------------------------------------------------------------------------------------
async function runVisualsOnly(L) {
  const s4 = await runS4(L, null)
  return { lesson: L.slug, mode: 'visuals', rerun_figures: L.rerun_figures || [], visuals: s4.visuals, viz_gaps: s4.gaps,
    counts: { visuals: s4.visuals.length, viz_gaps: s4.gaps.length, compared: s4.compared } }
}

async function runLesson(L) {
  if (ARGS.visuals_only) return runVisualsOnly(L)
  const [s2, s3] = await parallel([() => runS2(L), () => runS3(L)])
  const s4 = await runS4(L, s2)
  const s8 = await runS8(L, s2, s3)
  const items = (s3 && s3.items) || []
  // a question whose figure the app cannot draw cannot be answered: flag it for the assembler
  const gapRefs = new Set(s4.gaps.filter((g) => g.ref).map((g) => g.ref))
  for (const it of items) it.blocked_on_figure = it.kind === 'exercise' && (gapRefs.has(it.ref) || (it.figures_missing || []).length > 0)
  const teaching = new Set(items.filter((i) => i.answer_type === 'not_markable').map((i) => i.ref))
  for (const v of s4.visuals) if (v.question && teaching.has(v.question)) v.question = null
  const count = (f) => items.filter(f).length
  const byType = {}, byProv = {}, byVer = {}
  for (const i of items) { byType[i.answer_type] = (byType[i.answer_type] || 0) + 1; byProv[i.solution_provenance] = (byProv[i.solution_provenance] || 0) + 1; byVer[i.verification] = (byVer[i.verification] || 0) + 1 }
  const tchr = (L.teacher_only || []).length
  return {
    lesson: L.slug,
    claims: ((s2 && s2.kept) || []).map((c) => ({ lo: c.lo, type: c.type, text: c.text, anchor: c.anchor, printed_page: c.printed_page, supported: c.supported, teacher_only: false, quote: c.quote, provenance: c.provenance })),
    claims_dropped: (s2 && s2.dropped) || [],
    items, visuals: s4.visuals, viz_gaps: s4.gaps,
    // FR-4408: every teacher-only block of the lesson was left out of every prompt (dropped);
    // `caught` counts claims that echoed one anyway and were dropped; none reaches a claim.
    teacher_only: { seen: tchr, dropped: tchr, reached_claim: 0, caught_in_claims: (s2 && s2.teacher_caught) || 0 },
    verify: {
      disagreements: items.filter((i) => i.verification === 'disputed').map((i) => ({ ref: i.ref, printed: i.printed_answer, book: i.epub_final_answer, blind: i.blind_answer, pairs: i.verify.pairs, typing_problems: i.typing_problems,
        ...(i.verify.unchecked ? { unchecked: i.verify.unchecked } : {}) })),
      // COLLECT-2: items a check never ran on (an agent answered in part or off task): re-run, not G2's to judge
      unchecked: items.filter((i) => i.verify.unchecked).map((i) => ({ ref: i.ref, missing: i.verify.unchecked })),
      off_task: (s3 && s3.off_task) || [],
      no_printed_answer: items.filter((i) => i.verification === 'no_printed_answer').map((i) => ({ ref: i.ref, book: i.epub_final_answer, blind: i.blind_answer, agreed_with_book_solution: i.verify.agreed_with_book_solution, answer_type: i.answer_type })),
      typing_problems: items.filter((i) => i.typing_problems.length).map((i) => ({ ref: i.ref, problems: i.typing_problems })),
      printed_not_in_asked_form: items.filter((i) => i.printed_form_defect).map((i) => ({ ref: i.ref, printed: i.printed_answer, ...i.printed_form_defect })),
      forms_from_book_rules: items.filter((i) => i.asked_form).map((i) => ({ ref: i.ref, form: i.asked_form, overridden: i.form_overridden })),
      forms_the_marker_cannot_check: items.filter((i) => i.form_unsupported).map((i) => ({ ref: i.ref, form: i.form_unsupported, printed: i.printed_answer })),
      // collect-6: a choice whose options were the typing agent's inventions, typed again from the book's printed key; or a marker kind a
      // form cannot apply to (rule 'kind-for-form': the key is kept exactly)
      retyped: items.filter((i) => i.typing_retyped).map((i) => ({ ref: i.ref, as: i.typing_retyped.as, rule: i.typing_retyped.rule, key: (i.marker && i.marker.key) || i.answer, because: i.typing_retyped.because })),
      tier_checks: (s3 && s3.tier_checks) || [],
    },
    figure_blocked: items.filter((i) => i.blocked_on_figure).map((i) => i.ref),
    oracle: s8.result ? Object.assign({ tally: s8.tally }, s8.result) : { verdict: 'RED', subheadings: [], tally: s8.tally, note: 'the oracle returned nothing' },
    counts: { claims: ((s2 && s2.kept) || []).filter((c) => c.supported).length, claims_dropped: ((s2 && s2.dropped) || []).length,
      items: items.length, worked_examples: count((i) => i.kind === 'worked_example'), exercises: count((i) => i.kind === 'exercise'),
      by_answer_type: byType, by_solution_provenance: byProv, by_verification: byVer,
      visuals: s4.visuals.length, viz_gaps: s4.gaps.length, figure_blocked: count((i) => i.blocked_on_figure),
      unmapped_worked_examples: (L.unmapped_worked_examples || []).length },
    failed: { s2: !s2 || !!s2.failed, s3: !s3 },
  }
}

log(`${ARGS.lessons.length} lesson(s): ${ARGS.lessons.map((l) => `${l.slug} (${l.items.length} items, ${l.worked_examples.length} WE, ${l.figures.length} figures)`).join('; ')}`)
const lessons = await pipeline(ARGS.lessons, (L) => runLesson(L))
lessons.forEach((r, i) => { if (!r) log(`${ARGS.lessons[i].slug}: the lesson failed; re-run it (resume keeps the others)`) })

const perLesson = {}
for (const c of Object.values(calls)) for (const [s, n] of Object.entries(c.by_lesson)) perLesson[s] = (perLesson[s] || 0) + n
return {
  stage: 'S2-S4,S8', workflow: 'lesson', prompts_version: PROMPTS_VERSION, collect_version: COLLECT_VERSION, book: BOOK.book,
  ...(ARGS.visuals_only ? { mode: 'visuals' } : {}),
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}),
  lessons: lessons.filter(Boolean),
  failed_lessons: ARGS.lessons.filter((l, i) => !lessons[i]).map((l) => l.slug),
  calls: { by_phase: Object.fromEntries(Object.entries(calls).map(([k, v]) => [k, v.total])), per_lesson: perLesson,
    total: Object.values(calls).reduce((n, c) => n + c.total, 0) },
  meter: {
    stage: 'S2-S4,S8',
    record: `uv run meter_run.py record --book ${BOOK.book} --stage S2-S4,S8 --run <runId>`,
    by_stage: `uv run meter_run.py summary --book ${BOOK.book} --by phase`,
    by_lesson: `uv run meter_run.py summary --book ${BOOK.book} --by lesson`,
    note: 'Phase titles start with their stage (S2, S3, S4, S8), so `--by phase` is the per-stage cost; every label carries the lesson slug (S3:blind:<slug>:1), so `--by lesson` is the per-lesson cost.',
  },
}

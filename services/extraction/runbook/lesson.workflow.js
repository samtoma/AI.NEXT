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

const PROMPTS_VERSION = 'lesson-v4'   // v3: ids are asked for WITHOUT their brackets, and read either way
// v4 (2026-09-26, the Chapter 8 pilot): a choice's options may be the labels a figure shows ("Which point lies
// at (5; −4)?" A–E, shape W–Z): options_source "figure". Only the TYPING prompt changed; on a resume the
// claims replay, and typing and every agent after it run again.
// The script's own deterministic collection is versioned apart from the prompts: a change here replays
// every cached agent on a resume (no prompt changed) and re-decides what they answered.
const COLLECT_VERSION = 'collect-4'   // collect-2/-3/-4: the Chapter 8 pilot's S3 fixes (see "COLLECT-2" and "COLLECT-3" below)
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
const norm = (s) => String(s || '').normalize('NFKC').replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[’‘]/g, "'")
  .replace(/\$/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const contains = (hay, needle) => { const n = norm(needle); return n.length >= 8 && norm(hay).includes(n) }

// The comparison normal form of an answer (LaTeX or printed text). Decision 15's notation is
// read both ways here; nothing is written back.
function normTex(s) {
  let t = String(s == null ? '' : s)
  t = t.replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, '')
  t = t.replace(/\\(?:left|right|displaystyle)(?![a-zA-Z])/g, '').replace(/\\[,;:! ]|\\q?quad(?![a-zA-Z])|~/g, '')
  t = t.replace(/\\[dt]frac(?![a-zA-Z])/g, '\\frac')
  for (let k = 0; k < 3; k++) t = t.replace(/\\(?:text|mathrm|textrm|mbox)\{([^{}]*)\}/g, '$1')
  t = t.replace(/\s+and\s+/g, ', ')                                      // a list's "and" is its comma (COLLECT-3: both sides)
  t = t.replace(/&/g, '')                                                  // alignment markup, never maths (COLLECT-3)
  t = t.replace(/\{([A-Za-z])\}(?=[_^])/g, '$1')                          // {m}_{AB} is m_{AB} (COLLECT-3)
  t = t.replace(/\\(?:cdot|times)(?![a-zA-Z])/g, '*').replace(/[×·]/g, '*')
  t = t.replace(/[−–]/g, '-')
  t = t.replace(/\\geq?(?![a-zA-Z])/g, '≥').replace(/\\leq?(?![a-zA-Z])/g, '≤').replace(/>=/g, '≥').replace(/<=/g, '≤')
  t = t.replace(/(\d)\{,\}(\d)/g, '$1.$2').replace(/(\d),(\d)/g, '$1.$2').replace(/;/g, ',')
  t = t.replace(/([\^_])\{([A-Za-z0-9])\}/g, '$1$2')
  t = t.replace(/\\frac\{-([^{}]+)\}\{([^{}]+)\}/g, '-\\frac{$1}{$2}')   // \frac{-2}{3} is -\frac{2}{3} (COLLECT-2)
  t = t.replace(/\s+/g, '').replace(/^\\therefore/, '').replace(/^(?:answer|ans)[:=]/i, '').replace(/\.$/, '')
  return t
}
// a named left side: x=, y_1=, m_{AB}=, d_{AB}\approx, the text layer's flattened mAC=, and a named point
// with its variables, P(x,y)= (COLLECT-2, COLLECT-3)
const stripLhs = (t) => t.replace(/^[A-Za-z]{1,4}(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]+))?(?:\([a-z](?:,[a-z])*\))?(?:=|\\approx)/, '')
// a point's name before its coordinates: M(1,0) is the pair (1,0); only a name directly before ONE
// parenthesised pair, so f(2) or 3(x+1) is never touched (COLLECT-3)
const stripPointName = (t) => (/^[A-Za-z]{1,2}(?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?\([^()]*,[^()]*\)$/.test(t) ? t.replace(/^[^(]+/, '') : t)
// digits, letters and relations: what survives the PDF text layer's flattening of maths
const sig = (s) => normTex(s).replace(/\\[a-zA-Z]+/g, '').replace(/[^0-9A-Za-z+\-=<>≤≥.]/g, '')

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
    const sigs = (n) => [...new Set([n, stripPointName(n)])].map((x) => x.replace(/\\[a-zA-Z]+/g, '').replace(/[^0-9A-Za-z+\-=<>≤≥.]/g, ''))
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

// A set of values ("x = 3 or x = 9", "3; 9", "a = 1 and b = 7 2") as the sorted list of its values,
// each without its named left side — the marker's "values" kind is exactly such a set (COLLECT-3).
// Only the TYPING check uses it, and only for a key typed as values: the three-way pairs are not
// read as sets here (the judge reads "values in any order").
function valueSet(s, textLayer) {
  const t = mathsSpan(textLayer ? printedTex(s) : s).replace(/\$/g, ' ')
  const parts = t.split(/\s+or\s+|\s+and\s+|\\text\{\s*(?:or|and)\s*\}|;|,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean)
  const one = (x) => { const n = normTex(x); return textLayer ? stripLhs(n).replace(/\\[a-zA-Z]+/g, '').replace(/[^0-9A-Za-z+\-=<>≤≥.]/g, '') : stripLhs(n) }
  return parts.map(one).filter(Boolean).sort()
}
const sameValues = (key, against, textLayer) => {
  const k = valueSet(key, textLayer), a = valueSet(against, textLayer)
  return k.length > 1 && k.length === a.length && k.every((x, i) => x === a[i])
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
const containNorm = (s) => normTex(String(s == null ? '' : s).replace(/\\therefore(?![a-zA-Z])/g, ' therefore ')
  .replace(/\\because(?![a-zA-Z])/g, ' because ')).toLowerCase()
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
    if (hay.some((h) => h.includes(n))) return true
    const parts = n.split('=')
    // a worked chain L=m1=…=R the typing agent wrote out states L=R, which the solution must hold (COLLECT-3)
    if (workedChain(n) && hay.some((h) => h.includes(`${parts[0]}=${parts[parts.length - 1]}`))) return true
    // x=3 where the solution states the value as a whole segment of its own (COLLECT-3)
    return parts.length === 2 && /^[a-z]{1,2}(?:_[a-z0-9{}]+)?$/.test(parts[0]) && wholeSegs.has(parts[1])
  }
  const segs = String(final).match(/\$[^$]+\$/g) || [String(final)]
  // a segment that lists several statements must have each of them in the solution (COLLECT-3)
  return segs.every((p) => found(p) || (() => { const ps = topLevelParts(p.replace(/\$/g, ''))
    return ps.length > 1 && ps.every((x) => x.includes('=') && found(x)) })())
}

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
  choice — a verbal or choice answer ("irrational", "rhombus", "(ii)"). Give options: the alternatives the stem itself offers in its words (options_source "stem"); or, when the answer is one of the labels a figure of the item shows (a point, a shape), those labels as the figure prints them, each option one label, optionally after the one word the stem uses for them ("E", "shape Z") (options_source "figure"); or, when neither offers any, the natural closed set this lesson uses for such answers (options_source "lesson"); 2–5 options with the key among them;
  expression — an algebraic expression, factorised or expanded form, equation, several values, interval, inequality or set, coordinates, surd or π, recurring decimal. Give marker_kind (expression | equation | values | interval | coordinates | surd | recurring), form when the question asks for one (factorised | expanded | simplest | subject, with subject = the variable), variables (the letters in the answer), and key in LaTeX;
  not_markable — a proof, a sketch or drawing, "show that", "represent", "complete the table", or an explanation: give not_markable_reason.
- key: the PRINTED ANSWER's value, in LaTeX the marker can read. Keep decimal commas and (x; y) as printed. The printed answer is the PDF's flattened text: a fraction's numerator and denominator sit side by side ("y = 1 3 x" is $y = \\frac{1}{3}x$), a root loses its bar ("√ 29" is \\sqrt{29}), a power drops to the line ("x2" is x^{2}) — read its structure from the book solution's final line, which is LaTeX, and never change a value. Only when there is no printed answer, from the book solution's final answer.
- book_final: the final answer of the BOOK SOLUTION, copied from its last lines (for a worked example, from its last step). Copy it; never from the printed answer.
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

function checkTyping(it, t) {
  const problems = []
  if (!t) return { problems: ['typing returned nothing'] }
  if (t.book_final && !inBookSolution(it.solution, t.book_final)) problems.push('book_final is not in the book solution')
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
    const opts = (t.options || []).filter((o) => o && o.trim())
    const at = opts.findIndex((o) => norm(o) === norm(t.key))
    if (opts.length < 2 || at < 0) problems.push('a choice needs 2–5 options with the key among them')
    if (t.options_source === 'stem' && opts.some((o) => !norm(it.stem).includes(norm(o)))) problems.push('options said to be the stem\'s are not all in the stem')
    if (t.options_source === 'figure') problems.push(...figureOptionProblems(it, opts))
    typed.choices = opts.map((o, k) => ({ key: 'ABCDE'[k], text: o }))
    typed.answer = at >= 0 ? 'ABCDE'[at] : null
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
    if (form && typeof form === 'string' && !APP_FORMS.includes(form)) { problems.push(`form "${form}" is not one the app's marker knows`); form = null }
    if (form && typeof form === 'object' && t.marker_kind !== 'equation') problems.push('a subject form needs marker kind "equation" (the app\'s marker)')
    typed.marker = { kind: t.marker_kind, key: t.key, form, variables: t.variables || [], tolerance: null }
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
    if (against && !(settle(t.key, against, !!it.printed_answer).verdict === 'equivalent' ||
      (t.answer_type === 'expression' && t.marker_kind === 'values' && sameValues(t.key, against, !!it.printed_answer)) ||
      (t.answer_type === 'numeric' && numOf(typed.answer) !== null && numOf(typed.answer) === numOf(against)) ||
      (t.answer_type === 'choice' && norm(against).includes(norm(t.key))))) {
      problems.push(`the key "${t.key}" does not read as the ${it.printed_answer ? 'printed answer' : 'book final answer'} "${against}"`)
    }
  }
  return { typed, problems }
}

async function runS3(L) {
  const s = L.slug
  const items = s3Items(L)
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
    const { typed, problems } = checkTyping(it, typing[it.ref])
    const t = typing[it.ref] || {}
    const b = blind[it.ref]
    const blindAns = b && b.markable !== false && b.final_answer ? b.final_answer : null
    const bookFinal = problems.includes('book_final is not in the book solution') ? null : (t.book_final || null)
    // what a missing pair is missing, so an unchecked item is never read as the book disagreeing
    const missing = []
    if (!typing[it.ref]) missing.push('no typing answer')
    if (!b) missing.push('no blind re-solve answer')
    else if (!blindAns && t.answer_type !== 'not_markable' && b.markable !== false) missing.push('an empty blind answer')
    if (t.book_final && !bookFinal) missing.push('book_final is not in the book solution')
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
    const formUnsupported = it.asked_form && !APP_FORMS.includes(it.asked_form) ? it.asked_form : null
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
    })
  }
  return { items: out, tier_checks: tierChecks, off_task: offTask }
}

// ---- S4 visuals -------------------------------------------------------------------------------------
async function runS4(L, s2) {
  const s = L.slug
  const figs = L.figures || []
  const gaps = [], visuals = []
  const usable = figs.filter((f) => { if (!f.path) { gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: 'no crop file for this figure' }); return false } return true })
  if (!usable.length) return { visuals, gaps, compared: 0 }
  const claims = ((s2 && s2.kept) || []).filter((c) => c.supported).map((c) => `${c.lo}: ${c.text}`).slice(0, 80).join('\n')
  const kinds = VIZ.map((k) => `- ${k.kind}: ${k.doc}`).join('\n')
  const authored = await parallel(chunk(usable, OPT.figures_per_call).map((batch, k) => () => call('S4 Visuals', s, `S4:viz:${s}:${k + 1}`,
    `Turn each book figure below into a parametric spec of ONE of these existing visual kinds, so the app can draw it:
${kinds}

Read each figure's image file with the Read tool. For each figure: decision "viz" with kind, spec (exactly the kind's shape, with the figure's own numbers and labels), a one-line caption in plain student-voiced English, and lo (the objective it illustrates); or decision "gap" when no kind above can show it faithfully (a hyperbola, an exponential or trig graph, a Venn diagram, a box plot, a 3-D solid, a triangle or quadrilateral scene …), with gap_reason and needed_kind. Never force a figure into the nearest kind: a wrong picture teaches the wrong thing.

The lesson's objectives:
${objList(L)}
What the lesson claims (context only):
${claims || '(none)'}

FIGURES:
${batch.map((f) => `[${f.figure_id}] ${f.path} (context ${f.context}${f.ref ? ', belongs to ' + f.ref : ''}, p.${f.printed_page})${f.caption ? ' caption: ' + f.caption : ''}`).join('\n')}

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
    const lo = los.has(a.lo) ? a.lo : null
    if (!VIZ_NAMES.includes(a.kind) || !a.spec || !Object.keys(a.spec).length || !lo) {
      gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, needed_kind: a.needed_kind || null,
        reason: !VIZ_NAMES.includes(a.kind) ? `"${a.kind}" is not an existing VIZ kind` : (!lo ? `unknown objective ${a.lo}` : 'empty spec') })
      continue
    }
    candidates.push({ f, a, lo })
  }
  if (candidates.length) {
    const cmp = await call('S4 Compare', s, `S4:compare:${s}`, `For each figure, read its image file with the Read tool and compare it with the spec an agent wrote to redraw it. faithful = the spec shows the same mathematical object: the same points, values, labels and relationships (styling may differ). Any wrong or missing value, point or label: faithful=false, with the issue.\n\n${candidates.map(({ f, a }) => `[${f.figure_id}] ${f.path}\n  kind ${a.kind} spec ${JSON.stringify(a.spec)}`).join('\n\n')}\n\nReturn COMPARE_SCHEMA.`, { model: 'haiku', effort: 'low', schema: COMPARE_SCHEMA })
    const v = {}
    for (const c of (cmp && cmp.checks) || []) v[unbr(c.figure_id, isFig)] = c
    for (const { f, a, lo } of candidates) {
      if (!(v[f.figure_id] && v[f.figure_id].faithful)) {
        gaps.push({ figure_id: f.figure_id, src: f.src, ref: f.ref, printed_page: f.printed_page, reason: `the spec does not match the figure: ${(v[f.figure_id] && v[f.figure_id].issues) || 'no compare verdict'}`, rejected_spec: { kind: a.kind, spec: a.spec } })
        continue
      }
      visuals.push({ n: visuals.length + 1, lo, question: f.context === 'exercise_problem' || f.context === 'we' ? f.ref : null,
        kind: a.kind, spec: a.spec, caption: a.caption || null, printed_page: f.printed_page, figure_id: f.figure_id, src: f.src })
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
async function runLesson(L) {
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

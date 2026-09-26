// DRY-RUN STUB RESPONDER — the no-spend dry run of the extraction line (dryrun_chapter.py).
//
// NO MODEL IS CALLED. tests/workflow_stub.mjs runs each runbook/*.workflow.js as it is, and asks this
// module for every agent's answer. Each answer is DETERMINISTIC and built from the REAL book data the
// workflow was given in `args` (the S0a blocks, S0b's maths, the manifest's lessons, the S1 objectives,
// the EPUB solutions and printed answers). It proves the PLUMBING — every stage hands valid input to the
// next — and says NOTHING about quality: a stub objective is a partition of the practice, a stub
// "blind re-solve" echoes the book solution's last line, a stub verifier confirms what it is shown.
// Every text a person could read as content starts with STUB, "[DRY-RUN STUB]".
//
// Where a real agent would be blind, this stub is not: it reads `args` (solutions, specs). That is the
// point of a stub and the reason none of its output may ever be loaded outside a scratch database.
//
// PACKET BY REFERENCE (packet_ref.py). When the args carry `by_ref` (or S0b's `batch_files`), the
// book data is not in `args`: it is in the shard files the PROMPT names as [[file: <path>]] (S0b: the
// image list file it names). The stub then reads exactly those files — the files a real agent would
// read — and parses its data back out of them, so the dry run proves the shards carry what each agent
// needs. Only where a stub needs a file its prompt does not name (the reconciler re-derives the
// finders' partition) does it take the path from args.by_ref.dir.

import fs from 'node:fs'

export const STUB = '[DRY-RUN STUB]'
const FILE_RE = /\[\[file: (\/[^\]]+)\]\]/g
export const splice = (prompt) => prompt.replace(FILE_RE, (_, p) => fs.readFileSync(p, 'utf8'))
const filesIn = (prompt) => [...prompt.matchAll(FILE_RE)].map((m) => m[1])
const readJson = (path) => { try { return JSON.parse(fs.readFileSync(path, 'utf8')) } catch (e) { return null } }

const h32 = (hex) => parseInt(String(hex).replace(/[^0-9a-f]/g, '').slice(0, 8) || '0', 16)
const hashStr = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return h }
const words = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' ')
const lastLine = (sol) => (Array.isArray(sol) && sol.length ? String(sol[sol.length - 1]) : '')
const chunk = (xs, n) => { const out = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out }

// ARGS IN THE SCRIPT (embed_workflow.py): a generated copy is run with no args; the stub reads the args
// the copy carries from the copy itself (its `const EMBEDDED_ARGS = …` line), named by the dry run.
const embeddedArgs = new Map()
const argsOfCopy = (path) => {
  if (!embeddedArgs.has(path)) {
    const line = fs.readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith('const EMBEDDED_ARGS = '))
    embeddedArgs.set(path, JSON.parse(line.slice('const EMBEDDED_ARGS = '.length)))
  }
  return embeddedArgs.get(path)
}

export async function respond({ label, prompt, args, stub }) {
  if (stub.embedded_script) args = argsOfCopy(stub.embedded_script)
  if (args && args.by_ref) {
    // what a real agent sees after reading the files its prompt names
    const files = filesIn(prompt)
    const text = splice(prompt)
    switch (stub.workflow) {
      case 'objectives': return s1ByRef(label, text, files, args)
      case 'misconceptions': return s5(label, text, { sources: null, questions: null })
      case 'families': return s6(label, text, args, files)
      case 'widgets': return s7(label, text, args, stub, files)
      default: return undefined
    }
  }
  switch (stub.workflow) {
    case 'transcribe-maths': return s0b(label, args, prompt)
    case 'objectives': return s1(label, prompt, args)
    case 'lesson': return lesson(label, prompt, args, stub)
    case 'misconceptions': return s5(label, prompt, args)
    case 'families': return s6(label, prompt, args)
    case 'widgets': return s7(label, prompt, args, stub)
    default: return undefined
  }
}

// ============================================================================ S0b
// Pass A reads every image as a placeholder named by its md5; pass B agrees except where the md5
// says otherwise (every 7th a different reading, every 13th unreadable), so the third reading has
// work; pass C agrees with A except every 5th, which agrees with neither and goes to G0b.
export const stubLatex = (md5) => `\\text{[m:${md5.slice(0, 8)}]}`

function s0b(label, args, prompt) {
  const m = /^([ABC])-b(\d+)$/.exec(label)
  if (!m) return undefined
  const size = Math.max(1, Math.min(60, args.batch || 25))
  // batch-file mode (vision-args --batch-dir): the prompt names the list file; read it
  const listed = /listed in the JSON file (.+?\.json) \(field "images"/.exec(prompt || '')
  const batch = listed ? ((readJson(listed[1]) || {}).images || [])
    : (args.images || []).slice((Number(m[2]) - 1) * size, Number(m[2]) * size)
  return { results: batch.map((im) => {
    const n = h32(im.md5)
    const base = { md5: im.md5, status: 'transcribed', latex: stubLatex(im.md5), note: STUB }
    if (m[1] === 'B') {
      if (n % 13 === 0) return { md5: im.md5, status: 'unreadable', latex: '', note: `${STUB} unreadable, so the third reading decides` }
      if (n % 7 === 0) return { ...base, latex: stubLatex(im.md5) + "'", note: `${STUB} a deliberate disagreement` }
    }
    if (m[1] === 'C' && n % 5 === 0) return { ...base, latex: stubLatex(im.md5) + '^{?}', note: `${STUB} agrees with neither` }
    return base
  }) }
}

// ============================================================================ S1
// A lesson's stub objectives PARTITION its practice (worked examples and exercise items, book order)
// into 2 or 3 groups; each cites a text anchor of the lesson and its group's first practice anchor,
// with quotes copied from the anchored text, so every deterministic rule can pass on real data.
export function lessonObjectives(l) {
  const items = l.items.map((i) => i.item_id)
  const wes = l.worked_examples.map((w) => w.anchor)
  const practice = wes.length + items.length
  const k = practice >= 6 ? 3 : practice >= 2 ? 2 : 1
  const split = (xs) => { const out = Array.from({ length: k }, () => []); xs.forEach((x, i) => out[Math.min(k - 1, Math.floor(i * k / xs.length))].push(x)); return out }
  const itemGroups = split(items)
  const weGroups = split(wes)
  // a group with no practice borrows from its neighbour so every objective is practised (rule 1)
  for (let g = 0; g < k; g++) {
    if (!itemGroups[g].length && !weGroups[g].length) {
      const donor = [...Array(k).keys()].find((j) => itemGroups[j].length > 1) ?? [...Array(k).keys()].find((j) => weGroups[j].length > 1)
      if (donor !== undefined) (itemGroups[donor].length > 1 ? itemGroups[g].push(itemGroups[donor].pop()) : weGroups[g].push(weGroups[donor].pop()))
    }
  }
  const textBlock = l.blocks.find((b) => b.type === 'heading' && b.anchor) || l.blocks.find((b) => b.type === 'definition') ||
    l.blocks.find((b) => b.type === 'para' && b.text) || null
  const textEv = textBlock ? {
    kind: textBlock.type === 'heading' ? 'heading' : textBlock.type === 'definition' ? 'definition' : 'intro',
    anchor: textBlock.type === 'heading' ? textBlock.anchor : textBlock.id,
    printed_page: textBlock.printed_page, quote: words(textBlock.text, 5),
  } : null
  const out = []
  for (let g = 0; g < k; g++) {
    const firstWe = weGroups[g][0]
    const firstItem = itemGroups[g][0]
    const practiceEv = firstWe
      ? (() => { const w = l.worked_examples.find((x) => x.anchor === firstWe); return { kind: 'worked_example', anchor: w.anchor, printed_page: w.printed_page, quote: words(w.title, 4) } })()
      : firstItem ? (() => { const it = l.items.find((x) => x.item_id === firstItem); return { kind: 'exercise', anchor: it.item_id, printed_page: it.printed_page, quote: words(it.problem, 4) } })()
      : null
    const refs = [...weGroups[g], ...itemGroups[g]]
    out.push({
      statement: `${STUB} Solve the practice of "${l.title}" (${refs[0] || 'none'} to ${refs[refs.length - 1] || 'none'})`,
      label: `${l.title}`.slice(0, 40) + ` (stub ${g + 1})`,
      evidence: [textEv, practiceEv].filter(Boolean),
      exercise_items: itemGroups[g],
      worked_examples: weGroups[g],
    })
  }
  return out
}

const KEYWORDS = [
  [/mid-?point/i, /mid-?point/i],
  [/perpendicular|parallel|equation of (the|a) (straight )?line|straight line|y-intercept/i, /straight lines|equation/i],
  [/gradient|slope/i, /gradient/i],
  [/distance|length|isosceles|perimeter/i, /distance/i],
]

// An end-of-chapter item about AREA is placed nowhere by both stub mappers, so the dry run's stubbed G1
// exercises answer 15 (b): it rules the item outside the chapter's objectives, by name, with a reason.
export const OUTSIDE_RE = /\barea\b/i
export function mapItem(item, lessons, second) {
  if (OUTSIDE_RE.test(item.problem)) return 'none'
  const scope = lessons.filter((l) => item.scope.includes(l.slug))
  let pick = null
  for (const [itemRe, titleRe] of KEYWORDS) {
    if (itemRe.test(item.problem)) { pick = scope.find((l) => titleRe.test(l.title)); if (pick) break }
  }
  pick = pick || scope[0]
  if (second && h32(hashStr(item.item_id).toString(16)) % 9 === 0 && scope.length > 1) {
    pick = scope[(scope.indexOf(pick) + 1) % scope.length]      // a deliberate disagreement for G1
  }
  return `lo:${pick.slug}-1`
}

export function chapterLinks(ch) {
  const out = []
  for (let i = 1; i < ch.lessons.length; i++) {
    const prev = ch.lessons[i - 1], cur = ch.lessons[i]
    const b = cur.blocks.find((x) => x.text && x.type !== 'heading') || cur.blocks[0]
    if (!b) continue
    out.push({ src: `lo:${prev.slug}-1`, dst: `lo:${cur.slug}-1`, signal: 'reference',
      evidence: [{ kind: 'text', anchor: b.anchor || b.id, printed_page: b.printed_page, quote: words(b.text, 5) }],
      reason: `${STUB} consecutive lessons` })
  }
  if (ch.lessons.length > 2) {             // one the checker rejects, so the drop path runs
    const cur = ch.lessons[2]
    const b = cur.blocks.find((x) => x.text) || cur.blocks[0]
    if (b) out.push({ src: `lo:${ch.lessons[0].slug}-2`, dst: `lo:${cur.slug}-2`, signal: 'recall',
      evidence: [{ kind: 'text', anchor: b.anchor || b.id, printed_page: b.printed_page, quote: words(b.text, 5) }],
      reason: `${STUB} rejected by the stub checker` })
  }
  return out
}

function s1(label, prompt, args) {
  const ch = args.chapter
  const L = (slug) => ch.lessons.find((l) => l.slug === slug)
  let m
  if ((m = /^S1:find[AB]:(.+)$/.exec(label))) return { objectives: lessonObjectives(L(m[1])) }
  if ((m = /^S1:reconcile:(.+)$/.exec(label))) {
    return { objectives: lessonObjectives(L(m[1])).map((o, i) => ({ ...o, confidence: 'agreed', from: { a: [`A${i + 1}`], b: [`B${i + 1}`] }, terms: [] })),
      rejected: [], unmapped_items: [], notes: STUB }
  }
  if ((m = /^S1:evidence:(.+)$/.exec(label))) {
    const rows = [...prompt.matchAll(/objective_n=(\d+) evidence_index=(\d+)/g)]
    return { checks: rows.map((r) => ({ objective_n: Number(r[1]), evidence_index: Number(r[2]), present: true, supports: true, note: STUB })) }
  }
  if ((m = /^S1:map(2?):ch\d+:(\d+)$/.exec(label))) {
    const size = (args.options && args.options.pool_batch) || 60
    const batch = chunk(ch.pool, size)[Number(m[2]) - 1] || []
    return { mapping: batch.map((it) => ({ item_id: it.item_id, objective: mapItem(it, ch.lessons, m[1] === '2'), reason: OUTSIDE_RE.test(it.problem) ? `${STUB} no objective of the chapter practises area` : `${STUB} keyword match` })) }
  }
  if (/^S1:links:/.test(label)) return { links: chapterLinks(ch), outside_book: [] }
  if (/^S1:linkcheck:/.test(label)) {
    const links = chapterLinks(ch)
    return { checks: links.map((ln, i) => ({ i, verdict: /rejected/.test(ln.reason) ? 'REJECTED' : 'CONFIRMED', note: STUB })) }
  }
  return undefined
}

// S1 by reference: the lesson, pool and chapter data are parsed back out of the shard text the
// prompt names (objectives.workflow.js's lessonText and mapper item lines).
function sectionOf(text, header) {
  const at = text.indexOf(header)
  if (at < 0) return []
  const rest = text.slice(at + header.length).replace(/^[^\n]*\n/, '')
  const end = rest.search(/\n\n(TEXT, DEFINITIONS AND HEADINGS|WORKED EXAMPLES \(|EXERCISE ITEMS —|END-OF-CHAPTER ITEMS)/)
  const body = end < 0 ? rest : rest.slice(0, end)
  return body === '(none)' ? [] : body.split('\n')
}

export function parseLesson(meta, text) {
  const blocks = sectionOf(text, 'TEXT, DEFINITIONS AND HEADINGS:').map((ln) => {
    const m = /^\[([^\]]*)\] \(([a-z_]+)[^)]*?, p\.([^;)]*)(?:; cite as: [^)]*)?\) (.*)$/.exec(ln)
    if (!m) return null
    // the bracketed key is the block's anchor when it has one, else its id: either resolves
    return { id: m[1], anchor: m[2] === 'heading' ? m[1] : undefined, type: m[2], printed_page: Number(m[3]), text: m[4] }
  }).filter(Boolean)
  const worked_examples = sectionOf(text, 'WORKED EXAMPLES (').map((ln) => {
    const m = /^\[(WE\d+)\] Worked example (\S+): (.*) \(p\.([^)]*)\)$/.exec(ln)
    return m ? { anchor: m[1], n: m[2], title: m[3], printed_page: Number(m[4]) } : null
  }).filter(Boolean)
  const items = sectionOf(text, 'EXERCISE ITEMS —').map((ln) => {
    const m = /^\[([^\]]+)\] \(p\.([^)]*)\) (.*)$/.exec(ln)
    return m ? { item_id: m[1], printed_page: Number(m[2]), problem: m[3] } : null
  }).filter(Boolean)
  return { slug: meta.slug, title: meta.title, blocks, worked_examples, items }
}

function s1ByRef(label, prompt, files, args) {
  const CR = args.chapter_ref
  const lessonFile = (slug, side) => files.find((f) => f.endsWith(`/lessons/${slug}.${side}.txt`))
  const L = (slug, side) => parseLesson(CR.lessons.find((l) => l.slug === slug),
    fs.readFileSync(lessonFile(slug, side) || `${args.by_ref.dir}/lessons/${slug}.A.txt`, 'utf8'))
  let m
  if ((m = /^S1:find([AB]):(.+)$/.exec(label))) return { objectives: lessonObjectives(L(m[2], m[1])) }
  if ((m = /^S1:reconcile:(.+)$/.exec(label))) {
    // the reconciler's prompt names no file (its input is the finders' lists); the stub re-derives
    // the same partition from the lesson shard, found through args.by_ref.dir
    return { objectives: lessonObjectives(L(m[1], 'A')).map((o, i) => ({ ...o, confidence: 'agreed', from: { a: [`A${i + 1}`], b: [`B${i + 1}`] }, terms: [] })),
      rejected: [], unmapped_items: [], notes: STUB }
  }
  if ((m = /^S1:evidence:(.+)$/.exec(label))) return s1(label, prompt, args)
  if ((m = /^S1:map(2?):ch\d+:(\d+)$/.exec(label))) {
    const pool = files.find((f) => /\/pool\/b\d+\.txt$/.test(f))
    const batch = fs.readFileSync(pool, 'utf8').split('\n').map((ln) => {
      const x = /^\[([^\]]+)\] \(p\.([^;]*); may go to: ([^)]*)\) (.*)$/.exec(ln)
      return x ? { item_id: x[1], printed_page: Number(x[2]), scope: x[3].split(', '), problem: x[4] } : null
    }).filter(Boolean)
    return { mapping: batch.map((it) => ({ item_id: it.item_id, objective: mapItem(it, CR.lessons, m[1] === '2'), reason: OUTSIDE_RE.test(it.problem) ? `${STUB} no objective of the chapter practises area` : `${STUB} keyword match` })) }
  }
  if (/^S1:links:/.test(label)) {
    return { links: chapterLinks({ lessons: CR.lessons.map((l) => L(l.slug, 'A')) }), outside_book: [] }
  }
  if (/^S1:linkcheck:/.test(label)) {
    // the checker never sees the linker's reasons: the stub rejects the one link it planted between
    // second objectives (chapterLinks), read from the rows it is shown
    const rows = [...prompt.matchAll(/^i=(\d+)\n  first \(src\)  (\S+):/gm)]
    return { checks: rows.map((r) => ({ i: Number(r[1]), verdict: /-2$/.test(r[2]) ? 'REJECTED' : 'CONFIRMED', note: STUB })) }
  }
  return undefined
}

// ============================================================================ S2–S4, S8
const s3Items = (L) => [
  ...L.worked_examples.map((w) => ({ ref: w.ref, kind: 'worked_example', lo: w.lo, stem: w.stem, solution: w.solution, printed_answer: null })),
  ...L.items.map((i) => ({ ...i, kind: 'exercise' })),
]
const NUMBER = /^[−-]?\d+(?:[.,]\d+)?$/
const stripMaths = (s) => String(s || '').replace(/^\$+|\$+$/g, '').trim()

export function stubTyping(it) {
  const tier = it.kind === 'worked_example' ? 'basic' : /^Ex\d+-\d+:/.test(it.ref) && it.end_of_chapter ? 'advanced' : 'standard'
  let bookFinal = lastLine(it.solution)
  let key
  if (it.printed_answer) key = String(it.printed_answer).trim()
  else if (it.kind === 'worked_example') {
    // a worked example's answer is the last maths of its last step (book_final is that span too)
    const spans = [...bookFinal.matchAll(/\$([^$]+)\$/g)].map((x) => x[1])
    key = spans.length ? spans[spans.length - 1].trim() : null
    if (key) bookFinal = key
  } else key = null
  if (!key) {
    return { ref: it.ref, answer_type: 'not_markable', key: '', book_final: bookFinal || '(none)', tier,
      not_markable_reason: `${STUB} ${it.kind === 'worked_example' ? 'the final line is prose' : 'no printed answer'}` }
  }
  if (it.raised_dot) key = key.replace(/(\d)\s+\.\s+(\d)/g, '$1\\cdot $2')
  const bare = stripMaths(key).replace(/\s+/g, '').replace(/^[a-zA-Z]=/, '')
  if (NUMBER.test(bare) && !it.asked_form) {
    return { ref: it.ref, answer_type: 'numeric', key: bare, book_final: bookFinal, tier }
  }
  const variables = [...new Set((stripMaths(key).replace(/\\[a-zA-Z]+/g, ' ').match(/[a-zA-Z]/g) || []))].slice(0, 6)
  const kind = /^\(.*[;,].*\)$/.test(stripMaths(key)) ? 'coordinates' : 'expression'
  return { ref: it.ref, answer_type: 'expression', key, marker_kind: kind, form: it.asked_form || '',
    variables: kind === 'coordinates' ? [] : variables, book_final: bookFinal, tier }
}

const digits = (s) => (String(s || '').match(/\d/g) || []).sort().join('')

function lesson(label, prompt, args, stub) {
  const opt = Object.assign({ blind_batch: 16, typing_batch: 30, figures_per_call: 16 }, args.options || {})
  const m = /^(S\d):(\w+):([^:]+)(?::(\d+))?$/.exec(label)
  if (!m) return undefined
  const [, , step, slug, k] = m
  const L = args.lessons.find((x) => x.slug === slug)
  if (!L) return undefined
  const items = s3Items(L)
  if (step === 'claims') {
    const claims = []
    for (const o of L.objectives) {
      const we = L.worked_examples.find((w) => w.lo === o.id)
      if (we) claims.push({ lo: o.id, type: 'method', text: `${STUB} Worked example ${we.n}: ${we.title}`, anchor: we.ref,
        printed_page: we.printed_page, quote: we.title })
    }
    const text = L.blocks.filter((b) => ['definition', 'para', 'box'].includes(b.type) && (b.text || '').length > 20)
    L.objectives.forEach((o, i) => {
      if (claims.some((c) => c.lo === o.id)) return
      const b = text[i % Math.max(1, text.length)]
      if (b) claims.push({ lo: o.id, type: b.type === 'definition' ? 'definition' : 'rule', text: `${STUB} ${words(b.text, 18)}`,
        anchor: b.anchor || b.id, printed_page: b.printed_page, quote: words(b.text, 6) })
    })
    if (text[0]) claims.push({ lo: L.objectives[0].id, type: 'rule', text: `${STUB} a paraphrase the provenance check must read`,
      anchor: text[0].anchor || text[0].id, printed_page: text[0].printed_page, quote: `${STUB} not a span of the text` })
    return { claims }
  }
  if (step === 'prov') return { checks: [...prompt.matchAll(/^i=(\d+)$/gm)].map((r) => ({ i: Number(r[1]), supported: true, note: STUB })) }
  if (step === 'audit') return { verdicts: [...prompt.matchAll(/^i=(\d+)$/gm)].map((r) => ({ i: Number(r[1]), verdict: 'SUPPORTED', note: STUB })) }
  if (step === 'type') {
    const batch = chunk(items, opt.typing_batch)[Number(k) - 1] || []
    return { items: batch.map(stubTyping) }
  }
  if (step === 'blind') {
    const batch = chunk(items, opt.blind_batch)[Number(k) - 1] || []
    return { answers: batch.map((it) => {
      const t = stubTyping(it)
      return { ref: it.ref, final_answer: t.answer_type === 'not_markable' ? '' : lastLine(it.solution),
        markable: t.answer_type !== 'not_markable', working: `${STUB} echoes the book solution's last line` }
    }) }
  }
  if (step === 'judge') {
    const pairs = [...prompt.matchAll(/pair_id=(\S+)\n\s+problem: [^\n]*\n\s+answer 1: ([^\n]*)\n\s+answer 2: ([^\n]*)/g)]
    return { verdicts: pairs.map((p) => {
      const same = digits(p[2]) && digits(p[2]) === digits(p[3])
      return { pair_id: p[1], verdict: same ? 'equivalent' : 'different', reason: `${STUB} same digits: ${same ? 'yes' : 'no'}` }
    }) }
  }
  if (step === 'tier') return { tiers: [...prompt.matchAll(/^\[([^\]]+)\] /gm)].map((r) => ({ ref: r[1], tier: stubTyping(items.find((x) => x.ref === r[1]) || { ref: r[1], solution: [] }).tier })) }
  if (step === 'viz') {
    const ids = [...prompt.matchAll(/^\[([^\]]+)\] (.+?) \(context (\w+)/gm)]   // paths hold spaces
    const first = L.figures.find((f) => f.path)
    return { figures: ids.map((r) => {
      const f = L.figures.find((x) => x.figure_id === r[1]) || {}
      const type = (stub.figure_types || {})[f.src] || 'unclassified'
      if (first && r[1] === first.figure_id) {
        return { figure_id: r[1], decision: 'viz', kind: 'coordinate_plot', lo: L.objectives[0].id,
          spec: { xRange: [-6, 6], yRange: [-6, 6], points: [{ x: 0, y: 0, label: 'O' }], animate: 'plot-sequence', interactive: false },
          caption: `${STUB} a placeholder redraw of the lesson's first figure` }
      }
      return { figure_id: r[1], decision: 'gap', lo: L.objectives[0].id, gap_reason: `${STUB} not redrawn by the stub (figure type: ${type})`,
        needed_kind: type }
    }) }
  }
  if (step === 'compare') return { checks: [...prompt.matchAll(/^\[([^\]]+)\] /gm)].map((r) => ({ figure_id: r[1], faithful: true, issues: STUB })) }
  if (step === 'oracle') {
    const subs = (L.subheadings || []).filter((h) => h.anchor)
    return { verdict: 'GREEN', subheadings: (subs.length ? subs : [{ anchor: L.slug }]).map((h) => ({ anchor: h.anchor, status: 'covered', missing_items: [] })) }
  }
  return undefined
}

// ============================================================================ S5
function s5(label, prompt, args) {
  let m
  if ((m = /^author:(lo:.+)$/.exec(label))) {
    const lo = m[1]
    const tail = lo.replace(/^lo:/, '')
    const existing = [...(prompt.split('ENTRIES THIS OBJECTIVE ALREADY HAS')[1] || '').split('WRONG OPTIONS')[0].matchAll(/^(mc:\S+) — /gm)].map((x) => x[1])
    const ds = [...(prompt.split('WRONG OPTIONS AND WIDGET PREDICATES')[1] || '').matchAll(/^D(\d+)\. /gm)].map((x) => Number(x[1]))
    let src, q
    if (args.sources === null) {                 // by reference: read back from the spliced prompt
      const ev = (prompt.split('independent re-solve of these questions took):\n')[1] || '').split('\n\nENTRIES THIS OBJECTIVE')[0]
      const s1m = /^\[(\S+) (\S+?)(?: p\.\S+)?\] /m.exec(ev)
      src = s1m ? { kind: s1m[1], ref: s1m[2] } : undefined
      const qs = (prompt.split('WITH THEIR CANONICAL SOLUTIONS (the authority):\n')[1] || '')
      const q1 = /^\[([^\]]+)\]/m.exec(qs)
      q = q1 ? { id: q1[1] } : undefined
    } else {
      src = (args.sources || []).find((s) => s.lo === lo)
      q = (args.questions || []).find((x) => x.lo === lo)
    }
    const fresh = existing.length ? [] : [{
      slug: 'stub-error', label: `${STUB} an error on ${tail}`,
      description: `${STUB} the student applies the method to the wrong quantities`,
      sources: [src ? { type: src.kind, ref: src.ref } : { type: 'canonical_solution', ref: q ? q.id : lo }],
      refutation: [{ step: 1, text_md: `${STUB} You used the right method on the wrong numbers — a natural slip.` },
        { step: 2, text_md: `${STUB} Check which values the question gives, then apply the book's method to them.` }],
    }]
    return { lo, entries: fresh, assignments: ds.map((d) => ({ distractor: d, entry: existing[0] || 'stub-error', reason: STUB })), flags: [] }
  }
  if ((m = /^verify:(lo:.+)$/.exec(label))) {
    const blocks = prompt.split(/^ENTRY /m).slice(1)
    return { lo: m[1], verdicts: blocks.map((b) => ({ id: b.split(/\s/)[0], verdict: 'CONFIRMED', reason: STUB, signal_ok: true,
      distractors: [...b.matchAll(/^\s+\[(\d+)\] /gm)].map((x) => ({ index: Number(x[1]), fits: true, reason: STUB })) })) }
  }
  return undefined
}

// ============================================================================ S6
function s6(label, prompt, args, files) {
  let m
  if ((m = /^author:(lo:.+)$/.exec(label))) {
    let o = (args.objectives || []).find((x) => x.lo_id === m[1])
    if (args.by_ref) {                           // by reference: the shards the prompt names
      const ref = args.objective_refs.find((x) => x.lo_id === m[1])
      const bq = readJson(files.find((f) => f.endsWith('.book-questions.txt')))
      const mc = readJson(files.find((f) => f.endsWith('.misconceptions.txt')))
      o = { ...ref, book_questions: bq || [], misconceptions: mc || [] }
    }
    const parent = (o.book_questions || [])[0]
    const tail = o.lo_id.replace(/^lo:/, '')
    if (!parent) return { lo_id: o.lo_id, families: [], infeasible: (o.tier_gaps || []).map((t) => ({ tier: t, reason: `${STUB} no book question to be a parent` })), notes: STUB }
    const mc = (o.misconceptions || [])[0]
    const fams = (o.tier_gaps || []).slice(0, 3).map((tier, i) => {
      const base = { format: 'ainext.family/1', id: `tpl:${tail}:stub-${tier}`, kind: 'family', lo_id: o.lo_id,
        parent_question_id: parent.id, source_page: parent.source_page || null, tier, context: null,
        params: [{ name: 'a', randint: [2, 9] }, { name: 'b', randint: [11, 19] }], constraints: [],
        stem: `${STUB} family: work out \${=a} + {=b}$.`,
        solution: [`${STUB} Add: \${=a} + {=b} = {=a + b}$.`], proposed_misconceptions: [], notes: STUB, version: 1 }
      if (i === 0 && mc) {
        return { ...base, answer_type: 'mcq', choices: { correct: '${=a + b}$', distractors: [
          { text: '${=a + b + 1}$', misconception_id: mc.id }, { text: '${=a * b + 100}$', misconception_id: null },
          { text: '${=a + b - 1}$', misconception_id: null }] } }
      }
      return { ...base, answer_type: 'numeric', answer: 'a + b' }
    })
    return { lo_id: o.lo_id, families: fams, infeasible: [], notes: STUB }
  }
  if (/^solve:/.test(label)) {
    const qs = prompt.split(/^QUESTION /m).slice(1)
    return { answers: qs.map((q) => {
      const id = q.split('\n')[0].trim()
      const mm = /(\d+) \+ (\d+)/.exec(q)
      const v = mm ? Number(mm[1]) + Number(mm[2]) : null
      const opt = [...q.matchAll(/^\s+([A-E])\. \$(-?\d+)\$/gm)].find((x) => Number(x[2]) === v)
      return opt ? { question: id, working: STUB, choice: opt[1] } : { question: id, working: STUB, value: String(v) }
    }) }
  }
  if (/^judge:/.test(label)) return { distractors_ok: true, key_form_ok: true, context_ok: true, solution_ok: true, notes: STUB }
  return undefined
}

// ============================================================================ S7
const KIND_FOR = [[/gradient|straight line/i, 'line_drawer'], [/distance|mid-?point|cartesian/i, 'pair_plotter']]

function s7(label, prompt, args, stub, files) {
  let m
  if (args.by_ref && (m = /^verify:(.+)$/.exec(label)) && args.mode === 'verify') return s7VerifyByRef(prompt)
  if ((m = /^author:(.+)$/.exec(label)) && args.mode === 'author') {
    const lesson = m[1]
    const objs = args.by_ref ? (readJson(files.find((f) => f.endsWith(`/lessons/${lesson}.txt`))) || [])
      : args.objectives.filter((o) => o.lo_id.replace(/^lo:/, '').replace(/-[0-9]+$/, '') === lesson)
    const o = objs[0]
    const kind = (KIND_FOR.find(([re]) => re.test(`${o.label} ${o.description || ''} ${stub.lesson_titles && stub.lesson_titles[lesson] || ''}`)) || [])[1]
    const anchor = (o.anchor_questions || [])[0]
    const tail = o.lo_id.replace(/^lo:/, '')
    const mcId = ((o.misconceptions || []).find((x) => x.own) || {}).id || (stub.draft_ids || {})[o.lo_id]
    const predicates = args.by_ref ? (args.contract_kinds || {})[kind] : args.contract[kind] && Object.keys(args.contract[kind].predicates)
    if (!kind || !anchor || !mcId || !predicates || !predicates.length) {
      return { templates: [], gaps: [{ lo_id: o.lo_id, need_kind: 'none', description: '', why: `${STUB} no stub template for this lesson` }], notes: STUB }
    }
    const pred = predicates[0]
    const t = kind === 'pair_plotter'
      ? { instances: [{ x: 2, y: -3 }, { x: -4, y: 1 }], spec: { target: ['{=x}', '{=y}'] },
          stem: `${STUB} widget: plot the point $({=x}, {=y})$.`, solution: [`${STUB} Move {=x} along the x-axis and {=y} up the y-axis.`] }
      : { instances: [{ x1: -2, y1: -3, x2: 2, y2: 5 }], spec: { mode: 'points', through: [['{=x1}', '{=y1}'], ['{=x2}', '{=y2}']] },
          stem: `${STUB} widget: draw the straight line through $A({=x1}, {=y1})$ and $B({=x2}, {=y2})$.`,
          solution: [`${STUB} Put one handle on $A$ and the other on $B$.`] }
    return { templates: [{ format: 'ainext.widget-template/1', id: `wt:${tail}:stub-${kind.replace(/_/g, '-')}`, lo_id: o.lo_id,
      parent_question_id: anchor.id, tier: 'standard', kind, ...t, diagnostics: [{ predicate: pred, misconception_id: mcId }], notes: STUB }],
    gaps: [], notes: STUB }
  }
  if ((m = /^verify:(.+)$/.exec(label)) && args.mode === 'verify') {
    const ws = args.widgets.filter((w) => w.template_id === m[1])
    return { results: ws.map((w, i) => ({ widget: `W${i + 1}`,
      reading: w.kind === 'pair_plotter' ? { target: w.spec.target } : { mode: w.spec.mode, through: w.spec.through, m: w.spec.m, b: w.spec.b },
      construction: `${STUB} read from the stored spec (a real verifier reads the stem)`, reachable: true,
      predicates: w.diagnostics.map((d) => ({ predicate: d.predicate, matches: true, why: STUB })) })) }
  }
  return undefined
}

// S7 verify by reference: the widgets are read back from the prompt, and the "reading" is taken from
// the STEM (as a real blind verifier must), not from a stored spec (the packet has none).
function s7VerifyByRef(prompt) {
  const blocks = prompt.split(/^WIDGET /m).slice(1)
  return { results: blocks.map((b) => {
    const head = /^W(\d+) \(kind (\w+)\)\nQuestion: (.*)$/m.exec(b)
    const kind = head && head[2]
    const stem = head ? head[3] : ''
    let reading = null
    if (kind === 'pair_plotter') {
      const x = /\$\((-?[\d.]+), (-?[\d.]+)\)\$/.exec(stem)
      reading = x ? { target: [Number(x[1]), Number(x[2])] } : null
    } else if (kind === 'line_drawer') {
      const x = /A\((-?[\d.]+), (-?[\d.]+)\)\$ and \$B\((-?[\d.]+), (-?[\d.]+)\)/.exec(stem)
      reading = x ? { mode: 'points', through: [[Number(x[1]), Number(x[2])], [Number(x[3]), Number(x[4])]] } : null
    }
    const preds = [...b.matchAll(/^  - (\S+) \("/gm)].map((x) => x[1])
    return { widget: `W${head ? head[1] : '?'}`, reading: reading || {}, construction: `${STUB} read from the stem (by reference: no spec in the packet)`,
      reachable: !!reading, predicates: preds.map((p) => ({ predicate: p, matches: true, why: STUB })) }
  }) }
}

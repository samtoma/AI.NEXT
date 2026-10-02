// A/B of the key-vs-printed comparator (lesson.workflow.js `settle`) over every recorded pair — no model call, no Workflow, nothing written.
//
//   node tests/settle_ab.mjs <old lesson.workflow.js> <new lesson.workflow.js> [repo root = services/extraction]
//   git show <commit>:services/extraction/runbook/lesson.workflow.js > /tmp/old.js
//   node tests/settle_ab.mjs /tmp/old.js runbook/lesson.workflow.js
//
// Why: the comparator decides whether a typed key, the blind re-solve, the printed answer and the book's solution agree, and a change to it for one
// chapter moves every other chapter's pairs (Chapter 6's function names sent 9 pairs of Chapter 5 to the judge). Every pair of every saved run under
// runs/<book>/lessons/ (a recollected file replaces its original) is settled by both scripts, as the workflow builds it (blind~printed and book~printed
// on the text layer, blind~book not). Reported: pairs that were settled and no longer are (REGRESSION: must be none), pairs that were not settled and now
// are (NEWLY SETTLED: read each one: it is a loosening), and pairs whose route label alone changed.
//
// It cuts the comparator out of each script by its markers (from `const GREEK_NAME` to the end of `function settle`, plus `topLevelParts`) and runs it in a
// vm context: a change that moves those markers needs this file's two `indexOf` lines changed too.
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import url from 'node:url'

function load(file) {
  const src = fs.readFileSync(file, 'utf8')
  const a = src.indexOf('const GREEK_NAME')
  const bm = src.indexOf('function settle(')
  const b = src.indexOf('\n}\n', bm) + 3
  const t0 = src.indexOf('function topLevelParts')
  const t1 = src.indexOf('\n}\n', t0) + 3
  if (a < 0 || bm < 0 || t0 < 0) throw new Error(`${file}: the comparator's markers are not there`)
  const ctx = vm.createContext({ BOOK: { multiplication_dot: true }, console })
  vm.runInContext(src.slice(a, b) + '\n' + src.slice(t0, t1) + '\nthis.settle = settle\n', ctx)
  return ctx
}

const [oldFile, newFile, rootArg] = process.argv.slice(2)
if (!oldFile || !newFile) { console.error('usage: node tests/settle_ab.mjs <old script> <new script> [root]'); process.exit(2) }
const root = rootArg || path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..')
const O = load(oldFile), N = load(newFile)
const dir = path.join(root, 'runs/g10-math/lessons')
const files = new Map()
for (const d of [dir, path.join(dir, 'recollected')]) {
  if (!fs.existsSync(d)) continue
  for (const f of fs.readdirSync(d)) if (/^wf_.*\.json$/.test(f)) files.set(f, path.join(d, f))   // the recollected file wins
}
let pairs = 0, same = 0
const out = []
for (const [f, p] of files) {
  let d
  try { d = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
  for (const L of (d.result && d.result.lessons) || d.lessons || []) for (const it of L.items || []) {
    const blind = it.blind_answer, printed = it.printed_answer, book = it.epub_final_answer
    const combos = it.kind === 'worked_example' || !printed
      ? [['blind~book', blind, book, false]]
      : [['blind~printed', blind, printed, true], ['blind~book', blind, book, false], ['book~printed', book, printed, true]]
    for (const [name, a, b, textLayer] of combos) {
      if (!a || !b) continue
      pairs++
      const o = O.settle(a, b, textLayer), n = N.settle(a, b, textLayer)
      if (o.route === n.route && o.verdict === n.verdict) { same++; continue }
      const was = o.verdict === 'equivalent', now = n.verdict === 'equivalent'
      out.push({ f, ref: it.ref, name, a: String(a).slice(0, 90), b: String(b).slice(0, 90), from: o.route, to: n.route,
        kind: was && !now ? 'REGRESSION (settled -> judge)' : !was && now ? 'NEWLY SETTLED' : 'route only' })
    }
  }
}
console.log(JSON.stringify({ pairs, identical: same, differing: out.length }))
const by = {}
for (const x of out) (by[x.kind] ||= []).push(x)
for (const k of Object.keys(by)) {
  console.log('##', k, by[k].length)
  for (const x of by[k]) console.log('  ', x.f.slice(0, 15), x.ref, x.name, x.from, '->', x.to, '|', JSON.stringify(x.a), '||', JSON.stringify(x.b))
}
process.exit(by['REGRESSION (settled -> judge)'] ? 1 : 0)

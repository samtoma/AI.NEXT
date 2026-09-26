// The APP'S OWN KaTeX, run over student-facing text before anything is loaded (consistency review A2).
//
//   … | node --no-warnings services/extraction/katex_check.mjs check    JSON lines {where, text} on stdin
//   … | node --no-warnings services/extraction/katex_check.mjs known    JSON lines {name} on stdin
//
// check: every `$…$` segment is split out exactly as the app's TeXRenderer splits it (/(\$[^$]+\$)/g),
// passed through the app's `inlineSafeTex` (app/src/lib/math-text.ts), and rendered with the app's KaTeX
// with throwOnError: true — the app itself renders with throwOnError: false, which is how a glued command
// such as `\triangleABC` reached a student as red error text. Prints {checked, errors: [{where, segment, why}]}.
//
// known: for each command name, whether KaTeX knows `\name` — an unknown one fails with "Undefined control
// sequence"; a known one either renders or fails for another reason (a missing argument). Prints
// {known: [names]}. Used by the S0b re-spacing pass (assemble_lesson_bundle.respace_latex).
//
// Exit 0 when it could run; 2 when the app's modules cannot be loaded.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'
import { createRequire } from 'node:module'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const app = path.resolve(here, '..', '..', 'app')
let katex, inlineSafeTex
try {
  katex = createRequire(path.join(app, 'package.json'))('katex')
  ;({ inlineSafeTex } = await import(url.pathToFileURL(path.join(app, 'src', 'lib', 'math-text.ts')).href))
} catch (e) {
  console.error(`katex_check: cannot load the app's KaTeX or math-text.ts: ${e.message}`)
  process.exit(2)
}

const mode = process.argv[2]
const rows = fs.readFileSync(0, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))

if (mode === 'known') {
  const known = []
  for (const { name } of rows) {
    try {
      katex.renderToString('\\' + name, { throwOnError: true })
      known.push(name)
    } catch (e) {
      if (!/Undefined control sequence/.test(String(e.message))) known.push(name)
    }
  }
  console.log(JSON.stringify({ known, katex: katex.version }))
} else if (mode === 'check') {
  const out = { checked: 0, errors: [], katex: katex.version }
  for (const { where, text } of rows) {
    if (typeof text !== 'string') continue
    for (const part of text.split(/(\$[^$]+\$)/g)) {
      if (!(part.startsWith('$') && part.endsWith('$') && part.length > 2)) continue
      out.checked += 1
      try {
        katex.renderToString(inlineSafeTex(part.slice(1, -1)), { throwOnError: true, output: 'html' })
      } catch (e) {
        out.errors.push({ where, segment: part.slice(0, 200), why: String(e.message).slice(0, 200) })
      }
    }
  }
  console.log(JSON.stringify(out))
} else {
  console.error('usage: katex_check.mjs check|known  (JSON lines on stdin)')
  process.exit(2)
}

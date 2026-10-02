// The APP'S OWN marker, run over a bundle's typed answers before anything is loaded.
//
//   node --no-warnings services/extraction/marker_check.mjs <bundle.json> [more.json …]
//   … | node --no-warnings services/extraction/marker_check.mjs -      (JSON lines {id, choices} on stdin)
//
// WHY. A question graded by the expression marker carries its spec in `choices.marker`. The app reads it
// with `readMarkerSpec` (app/src/lib/answer-marker.ts), which THROWS on a spec it does not know — a
// content defect the route turns into a server error — and every key must mark itself correct
// (`validateKey`), or no student could ever be marked right. Mirroring those rules in Python would drift;
// this imports the app's module itself (Node strips its types), so a bundle cannot carry a spec or a key
// the app would reject. Used by assemble_lesson_bundle.py (book questions) and load_generated_questions.py
// (generated typed answers).
//
// Prints JSON: {checked, specs_rejected: [{id, why}], keys_unreadable: [{id, key, why}]}. Exit 0 always
// when it could run; the caller decides what a finding means (a malformed spec refuses; an unmarkable key
// holds the question). Exit 2 when the app's module cannot be loaded.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const markerPath = process.env.AINEXT_MARKER_MODULE || path.resolve(here, '..', '..', 'app', 'src', 'lib', 'answer-marker.ts')
let M
try {
  M = await import(url.pathToFileURL(markerPath).href)
} catch (e) {
  console.error(`marker_check: cannot load the app's marker ${markerPath}: ${e.message}`)
  process.exit(2)
}

const rows = []
const files = process.argv.slice(2)
if (!files.length || files[0] === '-') {
  for (const line of fs.readFileSync(0, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line))
} else {
  for (const f of files) {
    const b = JSON.parse(fs.readFileSync(f, 'utf8'))
    for (const q of b.questions || []) rows.push({ id: q.id, choices: q.choices })
  }
}

const out = { checked: 0, specs_rejected: [], keys_unreadable: [], marker: markerPath }
for (const r of rows) {
  let spec
  try {
    spec = M.readMarkerSpec(r.choices)
  } catch (e) {
    out.specs_rejected.push({ id: r.id, why: e.message })
    continue
  }
  if (!spec) continue                       // not a marker question: today's grade() marks it
  out.checked += 1
  const why = M.validateKey(spec)
  if (why) out.keys_unreadable.push({ id: r.id, key: spec.key, why })
}
console.log(JSON.stringify(out))

// The APP'S OWN marker as a deterministic identity oracle for the G2 recommendation run (g2_recommend.py).
//
//   node --no-warnings services/extraction/g2rec_identity.mjs -      (JSON lines {id, expr, marker} on stdin)
//
// "Simplify / Expand / Factorise: <expression>" asks for an expression EQUAL to the one in the stem, so the book's key must equal the
// stem's expression at every sampled point. This runs the app's `mark(<the stem's expression>, <a spec whose key is the book's key>)`
// and reports `equal` (correct, or wrong_form: equal in value, a form the key does not have), `different` (incorrect: the key is not equal
// to the stem's expression: a book error, or a stem the extraction damaged) or `unreadable` (the marker cannot read one of them: no
// signal). The form is left out of the spec, so the answer is about the VALUE only. No language model, deterministic (seeded points).
// Exit 0 when it could run; exit 2 when the app's module cannot be loaded.
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

const here = path.dirname(url.fileURLToPath(import.meta.url))
const markerPath = process.env.AINEXT_MARKER_MODULE || path.resolve(here, '..', '..', 'app', 'src', 'lib', 'answer-marker.ts')
let M
try {
  M = await import(url.pathToFileURL(markerPath).href)
} catch (e) {
  console.error(`g2rec_identity: cannot load the app's marker ${markerPath}: ${e.message}`)
  process.exit(2)
}
const rows = fs.readFileSync(0, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const results = {}
for (const r of rows) {
  try {
    const spec = M.readMarkerSpec({ marker: r.marker })
    if (!spec) { results[r.id] = 'unreadable'; continue }
    const m = M.mark(r.expr, spec)
    results[r.id] = m.result === 'correct' || m.result === 'wrong_form' ? 'equal' : m.result === 'incorrect' ? 'different' : 'unreadable'
  } catch (e) {
    results[r.id] = 'unreadable'
  }
}
console.log(JSON.stringify({ checked: rows.length, results, marker: markerPath }))

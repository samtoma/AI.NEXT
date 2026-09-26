// A stub of the Claude Workflow runtime, for running a runbook/*.workflow.js script against
// canned agent responses. No model is called.
//
//   node tests/workflow_stub.mjs <script.workflow.js> <fixture.json>
//
// fixture: { "args": <the Workflow `args`>,
//            "responses": { "<agent label>": <the agent's return value> | null },
//            "responder": "<absolute path to an ES module>" (optional),
//            "stub": { … anything the responder needs } (optional) }
// A response is checked against the schema the script passed (the real runtime forces a
// structured output to validate, so a fixture that does not is a broken fixture). `null` models
// an agent the user skipped or that died. A label with no canned response goes to the
// responder's `respond({label, prompt, schema, phase, model, args, stub})`, when there is one —
// the no-spend dry run's DETERMINISTIC stub answers, built from the real book data in `args`
// (dryrun_chapter.py). A label neither answers fails the run. Each call records its response.
//
// Prints JSON: { ok, result, error, calls: [{label, phase, model, prompt}], logs, phases, meta }.
// The runtime's own rules are enforced: `meta` must be a pure literal, `Date.now()`, argless
// `new Date()` and `Math.random()` throw, and a schema's root must be an object whose required
// keys are all properties.
import fs from 'node:fs'

const [scriptPath, fixturePath] = process.argv.slice(2)
const src = fs.readFileSync(scriptPath, 'utf8')
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

const out = { ok: false, result: null, error: null, calls: [], logs: [], phases: [], meta: null }
const responder = fixture.responder ? await import(fixture.responder) : null

// ---- meta: a pure literal ----------------------------------------------------------------------
const metaMatch = /^export const meta = (\{[\s\S]*?\n\})\n/m.exec(src)
if (!metaMatch) {
  out.error = 'no `export const meta = {...}` block at column 0'
  console.log(JSON.stringify(out)); process.exit(0)
}
try {
  out.meta = new Function(`"use strict"; return (${metaMatch[1]})`)()
} catch (e) {
  out.error = `meta is not a pure literal: ${e.message}`
  console.log(JSON.stringify(out)); process.exit(0)
}

// ---- a small JSON-schema check (the subset the runbook scripts use) ------------------------------
function check(schema, value, path, problems) {
  if (!schema) return
  const t = schema.type
  const is = {
    object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
    array: Array.isArray,
    string: (v) => typeof v === 'string',
    integer: Number.isInteger,
    number: (v) => typeof v === 'number',
    boolean: (v) => typeof v === 'boolean',
  }
  if (t && is[t] && !is[t](value)) { problems.push(`${path}: expected ${t}`); return }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} not in ${schema.enum}`)
  if (t === 'object') {
    for (const k of schema.required || []) if (!(k in value)) problems.push(`${path}.${k}: required`)
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) check(s, value[k], `${path}.${k}`, problems)
  }
  if (t === 'array') value.forEach((v, i) => check(schema.items, v, `${path}[${i}]`, problems))
}
function checkSchemaShape(schema, label) {
  if (!schema || schema.type !== 'object' || !schema.properties) throw new Error(`${label}: schema root must be {type:'object', properties}`)
  const missing = (schema.required || []).filter((k) => !(k in schema.properties))
  if (missing.length) throw new Error(`${label}: required keys not in properties: ${missing}`)
}

// ---- hooks -------------------------------------------------------------------------------------------
let currentPhase = null
const agent = async (prompt, opts = {}) => {
  const label = opts.label || `agent-${out.calls.length}`
  const call = { label, phase: opts.phase || currentPhase, model: opts.model || null, prompt }
  out.calls.push(call)
  if (opts.schema) checkSchemaShape(opts.schema, label)
  let r
  if (label in (fixture.responses || {})) r = fixture.responses[label]
  else if (responder) {
    r = await responder.respond({ label, prompt, schema: opts.schema || null, phase: call.phase, model: call.model,
      args: fixture.args, stub: fixture.stub || {} })
    if (r === undefined) throw new Error(`stub: the responder has no answer for agent "${label}"`)
  } else throw new Error(`stub: no response for agent "${label}"`)
  call.response = r
  if (r === null) return null
  if (opts.schema) {
    const problems = []
    check(opts.schema, r, label, problems)
    if (problems.length) throw new Error(`stub: fixture response for "${label}" violates its schema: ${problems.slice(0, 5).join('; ')}`)
  }
  return JSON.parse(JSON.stringify(r))
}
const parallel = async (thunks) => Promise.all(thunks.map(async (t) => {
  try { return await t() } catch (e) { out.logs.push(`[parallel] thunk failed: ${e.message}`); return null }
}))
const pipeline = async (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let prev = item
  for (const stage of stages) {
    try { prev = await stage(prev, item, i) } catch (e) { out.logs.push(`[pipeline] item ${i} failed: ${e.message}`); return null }
  }
  return prev
}))
const phase = (t) => { currentPhase = t; out.phases.push(t) }
const log = (m) => out.logs.push(String(m))
const budget = { total: null, spent: () => 0, remaining: () => Infinity }
const workflow = async () => { throw new Error('stub: nested workflow() is not supported') }

const RealDate = Date
function StubDate(...a) {
  if (!new.target) throw new Error('Date() is unavailable in a workflow script')
  if (a.length === 0) throw new Error('argless new Date() is unavailable in a workflow script')
  return new RealDate(...a)
}
StubDate.now = () => { throw new Error('Date.now() is unavailable in a workflow script') }
StubDate.UTC = RealDate.UTC
StubDate.parse = RealDate.parse
const StubMath = Object.create(Math)
StubMath.random = () => { throw new Error('Math.random() is unavailable in a workflow script') }

const body = src.replace(/^export const meta = /m, 'const meta = ')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
try {
  const run = new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', 'Date', 'Math', body)
  out.result = await run(agent, parallel, pipeline, phase, log, fixture.args, budget, workflow, StubDate, StubMath)
  out.ok = true
} catch (e) {
  out.error = e.message
}
console.log(JSON.stringify(out))

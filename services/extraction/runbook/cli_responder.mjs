// Answers a runbook workflow's agents with the `claude` CLI, so the SAME script runs outside Claude Code.
//
//   node tests/workflow_stub.mjs <script or its embedded copy> <fixture.json>
//   fixture: { "responses": {}, "responder": "<abs path to this file>",
//              "stub": { "cap_usd": 3, "read_dirs": ["<dir the agents may read>"], "ledger": "<file.jsonl>" } }
//
// tests/workflow_stub.mjs is the Workflow runtime's contract (agent, parallel, pipeline, phase, log; its rules
// enforced: a pure meta, no Date.now / Math.random, schemas checked). Here it hands every agent call to respond()
// below instead of a canned answer, so the script's prompts, schemas and deterministic checks are the runbook's own,
// byte for byte. In Claude Code the same script runs with the Workflow tool; this is for a run from a shell
// (book_record_figures.py run), with each call metered.
//
// Each call: `claude -p` with a minimal system prompt, no project settings, the Read tool only (and only on
// `read_dirs`), the agent's model and its JSON schema, in a temporary working directory. Costs go to `ledger`;
// `cap_usd` stops the run before it spends more. An agent that errors or returns no structured answer comes back
// as null — what the runtime gives the script for an agent that died, which the scripts already handle.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// What the work is, said once: without it the model's safety filter refused some plain circle-geometry exercises
// outright ("safeguards flagged this message"), the same stem passing with other numbers (Prep 3 S6, 2026-10-29)
const SYSTEM = 'You are one agent in a workflow that checks school mathematics: the exercises of a secondary-school maths textbook (algebra, statistics, geometry of circles and triangles) and questions generated from them for students. Do exactly the task in the message. Open every file it names with the Read tool. Return the structured output it asks for.'
let spent = 0

function run(args, prompt, cwd) {
  return new Promise((resolve) => {
    const p = spawn('claude', args, { cwd })
    let so = '', se = ''
    p.stdout.on('data', (d) => { so += d })
    p.stderr.on('data', (d) => { se += d })
    p.on('close', (code) => resolve({ code, so, se }))
    p.stdin.end(prompt)
  })
}

export async function respond({ label, prompt, schema, phase, model, stub }) {
  const cap = Number(stub.cap_usd ?? 3)
  if (spent >= cap - 0.05) throw new Error(`cost cap reached ($${spent.toFixed(3)} of $${cap}): stopped before ${label}`)
  const m = model || 'sonnet'
  const args = ['-p', '--output-format', 'json', '--model', m, '--no-session-persistence', '--setting-sources', '',
    '--system-prompt', SYSTEM, '--max-budget-usd', (cap - spent).toFixed(2)]
  if (schema) args.push('--json-schema', JSON.stringify(schema))
  const dirs = stub.read_dirs || []
  if (dirs.length) {
    args.push('--tools', 'Read', '--allowedTools', 'Read')
    for (const d of dirs) args.push('--add-dir', d)
  } else args.push('--tools', '')
  // a call the CLI flags as an error with nothing written (an API error under parallel load: is_error, subtype
  // "success", 0 output tokens) is asked again, twice at most; it used to come back as no answer, and the grade read
  // that as a disagreement (Prep 3 S6, 2026-10-29: 6 of 17 families, never the same ones twice)
  let res, cost = 0, tries = 0, failed = []
  for (;;) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-agent-'))
    const out = await run(args, prompt, cwd)
    fs.rmSync(cwd, { recursive: true, force: true })
    try { res = JSON.parse(out.so) } catch {
      throw new Error(`${label}: the CLI returned no JSON (exit ${out.code}): ${(out.se || out.so).slice(-400)}`)
    }
    cost += Number(res.total_cost_usd || 0)
    const wrote = Object.values(res.modelUsage || {}).reduce((a, u) => a + (u.outputTokens || 0), 0)
    if (!(res.is_error && !wrote) || tries >= 2) break
    const why = String(res.result || res.api_error_status || res.subtype || 'error')
    failed.push(why.slice(0, 200))
    tries += 1
    // a safety filter's false positive on a maths prompt repeats on the same model: the next try is another model
    if (/safeguards flagged/i.test(why) && args[args.indexOf('--model') + 1] !== 'opus') {
      args[args.indexOf('--model') + 1] = 'opus'
      failed[failed.length - 1] += ' (asked again on opus)'
    }
    await new Promise((r) => setTimeout(r, 2000 * tries))
  }
  spent += cost
  if (stub.ledger) {
    // per model, the tokens meter_run.py prices (input, cache writes 5m/1h, cache reads, output): one call here is
    // one agent of the run, so the runner can write meter_run's own ledger line (runs/<book>/cost.jsonl)
    const c = (res.usage && res.usage.cache_creation) || {}
    const byModel = {}
    for (const [id, u] of Object.entries(res.modelUsage || {})) {
      byModel[u.canonicalModel || id] = { input: u.inputTokens || 0, output: u.outputTokens || 0,
        cache_read: u.cacheReadInputTokens || 0, cache_write_5m: 0, cache_write_1h: 0, cache_write: u.cacheCreationInputTokens || 0 }
    }
    const models = Object.keys(byModel)
    if (models.length === 1) {   // the split of cache writes is only reported for the call as a whole
      byModel[models[0]].cache_write_5m = c.ephemeral_5m_input_tokens || 0
      byModel[models[0]].cache_write_1h = c.ephemeral_1h_input_tokens || 0
    }
    fs.appendFileSync(stub.ledger, JSON.stringify({ label, phase: phase || null, model: m, cost_usd: Math.round(cost * 1e4) / 1e4,
      turns: res.num_turns ?? null, error: res.is_error ? (res.subtype || true) : null,
      ...(res.is_error ? { error_text: String(res.result || res.api_error_status || '').slice(0, 300) } : {}),
      ...(failed.length ? { retried: failed } : {}), by_model: byModel }) + '\n')
  }
  process.stderr.write(`  ${label}: $${cost.toFixed(4)} (total $${spent.toFixed(3)} of $${cap})\n`)
  if (res.is_error) return null
  if (schema) return res.structured_output && typeof res.structured_output === 'object' ? res.structured_output : null
  return res.result ?? null
}

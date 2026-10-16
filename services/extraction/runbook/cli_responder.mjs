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

const SYSTEM = 'You are one agent in a workflow. Do exactly the task in the message. Open every file it names with the Read tool. Return the structured output it asks for.'
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

export async function respond({ label, prompt, schema, model, stub }) {
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
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-agent-'))
  const out = await run(args, prompt, cwd)
  fs.rmSync(cwd, { recursive: true, force: true })
  let res
  try { res = JSON.parse(out.so) } catch {
    throw new Error(`${label}: the CLI returned no JSON (exit ${out.code}): ${(out.se || out.so).slice(-400)}`)
  }
  const cost = Number(res.total_cost_usd || 0)
  spent += cost
  if (stub.ledger) {
    fs.appendFileSync(stub.ledger, JSON.stringify({ label, model: m, cost_usd: Math.round(cost * 1e4) / 1e4,
      turns: res.num_turns ?? null, error: res.is_error ? (res.subtype || true) : null }) + '\n')
  }
  process.stderr.write(`  ${label}: $${cost.toFixed(4)} (total $${spent.toFixed(3)} of $${cap})\n`)
  if (res.is_error) return null
  if (schema) return res.structured_output && typeof res.structured_output === 'object' ? res.structured_output : null
  return res.result ?? null
}

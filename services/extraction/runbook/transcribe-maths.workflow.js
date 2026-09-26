export const meta = {
  name: 'transcribe-maths',
  description: 'S0b maths transcription (B21, FR-4407): two blind vision passes over the equation images no hash could prove, and a third blind reading of the ones they disagree on',
  whenToUse: 'Once per book whose maths exists only as images (book config maths_source "epub-images-md5"), after `assemble_maths.py recover`. Args come from `assemble_maths.py vision-args <book>` (passes A and B), then `vision-args <book> --pass C --runs …` (the third reading).',
  phases: [
    { title: 'Pass A', detail: 'transcribe each image, reading it symbol by symbol' },
    { title: 'Pass B', detail: 'transcribe each image again, blind to pass A, structure first' },
    { title: 'Pass C', detail: 'the third reading, only where A and B disagree: blind to both, region by region' },
  ],
}

// ---- args (B1/B20) ---------------------------------------------------------------------------
// Nothing in this script names a path or a book. The operating session builds the args:
//     uv run assemble_maths.py vision-args <book> --pass AB [--batch 25] [--limit N]
// which carries the book config, the images still unproven after the deterministic recovery
// (absolute paths into the gitignored work/<book>/equations/, runtime only), and the command a
// transcriber may use to test its own answer against the image's name.
//
// THE RULE THIS STAGE SERVES (decision 21, amended by Samuel's answer 11). Each image is named
// md5(its LaTeX source, with the whitespace removed). This workflow only transcribes; it accepts
// nothing. `assemble_maths.py assemble` accepts an image by hash (re-verified there), or when
// passes A and B agree after normalisation, or — where A and B did NOT agree — when the third
// reading C agrees with one of them (two of three blind readings). It cross-checks against the
// PDF text layer and queues every other image for a human at G0b. Nothing is guessed: an
// unreadable image is reported unreadable. An image printed only inside an EPUB worked solution
// follows the same rule.
//
// INDEPENDENCE. A, B and C are different agents with different framings; none sees another's
// output, the recovered map, or any earlier run. C is given only the images (never A's or B's
// readings, never the reason they disagreed). Running the passes in one workflow or in several
// (`--pass A`, `--pass B`, then `--pass C`) is the same: every (pass, batch) is its own agent.
//
// After the run: save its return value as runs/<book>/maths/<passes>-<runId>.json and meter it:
//     uv run meter_run.py record --book <book> --stage S0b --run <wf_id>
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const BOOK = ARGS.book
if (!BOOK || !BOOK.book) {
  throw new Error('args.book is missing: run `uv run assemble_maths.py vision-args <book>` in services/extraction ' +
    'and pass its output as this workflow\'s args.')
}
if (BOOK.maths_source !== 'epub-images-md5') {
  throw new Error(`book ${BOOK.book} has maths_source ${JSON.stringify(BOOK.maths_source)}: S0b is only for sources ` +
    'whose maths is images named md5(LaTeX)')
}
const PASSES = [].concat(ARGS.pass || ['A', 'B'])
for (const p of PASSES) if (!['A', 'B', 'C'].includes(p)) throw new Error(`args.pass must be A, B, [A, B] or C, not ${p}`)
if (PASSES.includes('C') && PASSES.length > 1) {
  throw new Error('pass C (the third reading) runs alone, on the images A and B did not agree on: build its args with ' +
    '`assemble_maths.py vision-args <book> --pass C --runs <the A and B runs>`')
}
const IMAGES = ARGS.images || []
// Batch-file mode (`vision-args --batch-dir`): the image list stays on disk, one small JSON file per
// batch ({images: [{md5, path, w, h}]}), and each agent reads its own file. The args then carry only
// file paths and counts, so a chapter's hundreds of images never have to be pasted into a tool call.
// A script has no filesystem access, so in this mode it cannot check which md5s an agent was given;
// assemble_maths.py re-verifies every md5 (by hash and against the batch files) instead.
const BATCH_FILES = ARGS.batch_files || []
const HEX = /^[0-9a-f]{32}$/
for (const im of IMAGES) {
  if (!HEX.test(im.md5) || !String(im.path || '').endsWith(`/${im.md5}.png`)) {
    throw new Error(`args.images: ${JSON.stringify(im).slice(0, 120)} is not {md5, path …/<md5>.png}`)
  }
}
for (const bf of BATCH_FILES) {
  if (!bf || typeof bf.file !== 'string' || !bf.file.endsWith('.json') || !(bf.n > 0)) {
    throw new Error(`args.batch_files: ${JSON.stringify(bf).slice(0, 160)} is not {file: …/<name>.json, n: <count>}`)
  }
}
if (IMAGES.length && BATCH_FILES.length) throw new Error('give args.images or args.batch_files, not both')
if (!IMAGES.length && !BATCH_FILES.length) throw new Error('args.images and args.batch_files are both empty: nothing to transcribe')
const BATCH = Math.max(1, Math.min(60, ARGS.batch || 25))
const MODEL = ARGS.model || 'sonnet'           // spec §5: Sonnet (vision) ×2
const PROBE = ARGS.md5check || null

const batches = []
if (BATCH_FILES.length) {
  for (const bf of BATCH_FILES) batches.push({ file: bf.file, n: bf.n })
} else {
  for (let i = 0; i < IMAGES.length; i += BATCH) batches.push(IMAGES.slice(i, i + BATCH))
}
const countOf = (batch) => (batch.file ? batch.n : batch.length)
const TOTAL = batches.reduce((s, b) => s + countOf(b), 0)
log(`${TOTAL} images in ${batches.length} batches${BATCH_FILES.length ? ' (batch files)' : ` of up to ${BATCH}`}, pass ${PASSES.join(' + ')}, model ${MODEL}`)

// ---- the output --------------------------------------------------------------------------------
const RESULT = {
  type: 'object', required: ['results'], properties: {
    results: {
      type: 'array', items: {
        type: 'object', required: ['md5', 'status', 'latex'], properties: {
          md5: { type: 'string' },
          status: { type: 'string', enum: ['transcribed', 'unreadable'] },
          latex: { type: 'string' },              // '' when unreadable; '' is also a real (empty) image
          hash_match: { type: 'boolean' },        // the transcriber's own probe said md5(latex) == md5; re-verified later
          note: { type: 'string' },
        },
      },
    },
  },
}

// ---- the two framings --------------------------------------------------------------------------
const STYLE = `The book's LaTeX has a house style, and matching it exactly lets the file name prove your answer:
- no spaces at all (they were stripped before hashing): \`x=\\text{3}\`, \`(A\\cupB)'\`, \`\\text{R5}\`;
- numbers are usually wrapped in \\text{…} and keep the book's decimal comma and spaces: \`\\text{345,04399906}\\approx\\text{345,0440}\`, \`\\text{12 566}\`; bare digits also occur (\`a=0\`, \`3^x=81\`);
- scripts are usually braced (\`k^{2}\`, \`y_{1}\`), sometimes not (\`3^x\`), and a base is sometimes braced (\`{a}^{2}-{b}^{2}\`);
- pairs are written as printed with a semicolon: \`(x;y)\`; degrees are \`^{\\circ}\`; roots \`\\sqrt{…}\`; fractions \`\\frac{…}{…}\`;
- a multi-line derivation is one image: write every line, in order, separated by \\\\ (use \\begin{align*} … \\end{align*} with & before the = sign).
Transcribe exactly what is printed. Never correct the maths, never complete a missing step, never change a number's notation (a decimal comma stays a comma). If any symbol cannot be read with certainty, answer status "unreadable" with latex "" and say what is unclear in note: a guess is worse than a gap.`

const probeText = (batch) => PROBE ? `
When you have a transcription for every image, test them against the file names in ONE Bash call:
  ${PROBE}
with one JSON line per image on stdin: {"md5": "<the image's md5>", "candidates": ["<your LaTeX>", "<up to 5 variants that differ only in the house-style points above>"]}
(write the JSON with a quoted heredoc so backslashes survive: cat <<'EOF' | …). It prints {"md5", "match"} per line. Where a candidate matches, answer with exactly that string and hash_match true. Where none matches, keep your own reading and hash_match false — do not trade a faithful reading for a variant that changes the maths.` : ''

const listText = (batch) => batch.file
  ? `Your ${batch.n} images are listed in the JSON file ${batch.file} (field "images": one {md5, path, w, h} per image). ` +
    'Read that list file first; it and the image files it lists are the only files you may open.'
  : batch.map((im, i) => `${i + 1}. md5 ${im.md5} — ${im.path} (${im.w}×${im.h} px)`).join('\n')

const promptA = (batch) => `You are transcribing equation images from a mathematics textbook into LaTeX (pass A of two independent passes).
Read every image below with the Read tool — issue all the Read calls together in one turn — then transcribe each one, reading left to right and symbol by symbol. Open no other file (apart from an image list file you are given).

${STYLE}
${probeText(batch)}

Images (${countOf(batch)}):
${listText(batch)}

Answer with one result per image, using each image's md5 exactly as given.`

const promptB = (batch) => `Independent check transcription (pass B). Another transcriber may have read these images; you have not seen their work and must not look for it.
Open the images below with the Read tool (all in one turn) and nothing else (apart from an image list file you are given). For each image, first work out its structure — how many lines, where the fractions, roots, scripts, brackets and aligned = signs are — then write the LaTeX for that structure, and finally re-read the image to check every digit, sign and letter against what you wrote.

${STYLE}
${probeText(batch)}

Images (${countOf(batch)}):
${listText(batch)}

Return one result per image, keyed by the md5 given.`

const promptC = (batch) => `Independent reading (pass C). These images are hard to read; other transcribers may have read them, and you have not seen their work and must not look for it.
Open the images below with the Read tool (all in one turn) and nothing else (apart from an image list file you are given). Read each image REGION BY REGION: split it into its parts from left to right (and top to bottom for several lines), transcribe each part on its own — every digit, sign, letter, bracket, script and fraction bar — then join the parts. Finally compare your LaTeX with the whole image once more.

${STYLE}
${probeText(batch)}

Images (${countOf(batch)}):
${listText(batch)}

Return one result per image, keyed by the md5 given. If you cannot read an image with certainty, it is "unreadable": a guess is worse than a gap.`

// ---- run -----------------------------------------------------------------------------------------
const jobs = []
for (const pass of PASSES) {
  batches.forEach((batch, i) => jobs.push({ pass, batch, i }))
}
const raw = await parallel(jobs.map(({ pass, batch, i }) => () =>
  agent(pass === 'A' ? promptA(batch) : pass === 'B' ? promptB(batch) : promptC(batch), {
    label: `${pass}-b${String(i + 1).padStart(4, '0')}`,
    phase: `Pass ${pass}`,
    schema: RESULT,
    model: MODEL,
  })))

// ---- collect: one row per (pass, image), nothing invented ---------------------------------------
const results = []
const problems = []
jobs.forEach(({ pass, batch, i }, k) => {
  const r = raw[k]
  // Batch-file mode: the script never saw this batch's md5s, so `want` is null and membership is
  // re-checked by assemble_maths.py against the batch files.
  const want = batch.file ? null : new Set(batch.map((im) => im.md5))
  if (!r) {
    if (want) for (const im of batch) results.push({ md5: im.md5, pass, latex: null, status: 'missing', note: 'agent skipped or failed' })
    problems.push(`${pass} batch ${i + 1}: no answer (${countOf(batch)} images left for the other pass / G0b)`)
    return
  }
  const seen = new Set()
  for (const x of r.results || []) {
    if (!HEX.test(String(x.md5))) { problems.push(`${pass} batch ${i + 1}: answered a malformed md5 (${String(x.md5).slice(0, 40)})`); continue }
    if (want && !want.has(x.md5)) { problems.push(`${pass} batch ${i + 1}: answered an md5 it was not given (${x.md5})`); continue }
    if (seen.has(x.md5)) { problems.push(`${pass} batch ${i + 1}: answered ${x.md5} twice; first answer kept`); continue }
    seen.add(x.md5)
    results.push({
      md5: x.md5, pass,
      latex: x.status === 'transcribed' ? x.latex : null,
      status: x.status,
      hash_match_claimed: !!x.hash_match,
      note: x.note || null,
    })
  }
  if (want) {
    for (const im of batch) {
      if (!seen.has(im.md5)) {
        results.push({ md5: im.md5, pass, latex: null, status: 'missing', note: 'not in the agent\'s answer' })
        problems.push(`${pass} batch ${i + 1}: no answer for ${im.md5}`)
      }
    }
  } else if (seen.size !== batch.n) {
    problems.push(`${pass} batch ${i + 1}: answered ${seen.size} of the ${batch.n} images in ${batch.file}`)
  }
})
for (const p of problems) log(p)
const count = (pass, st) => results.filter((x) => x.pass === pass && x.status === st).length
for (const pass of PASSES) {
  log(`pass ${pass}: ${count(pass, 'transcribed')} transcribed, ${count(pass, 'unreadable')} unreadable, ` +
      `${count(pass, 'missing')} missing, ${results.filter((x) => x.pass === pass && x.hash_match_claimed).length} ` +
      'claimed hash matches (re-verified by assemble_maths.py)')
}
log(`save this return value as runs/${BOOK.book}/maths/${PASSES.join('')}-<runId>.json, then ` +
    `uv run assemble_maths.py assemble ${BOOK.book} runs/${BOOK.book}/maths/*.json; meter it with ` +
    `meter_run.py record --book ${BOOK.book} --stage S0b --run <wf_id>`)

return {
  stage: 'S0b',
  book: BOOK.book,
  pass: PASSES.length === 1 ? PASSES[0] : PASSES,
  model: MODEL,
  batch: BATCH,
  images: TOTAL,
  batch_files: BATCH_FILES.length ? BATCH_FILES.map((b) => b.file) : undefined,
  results,
  problems,
}

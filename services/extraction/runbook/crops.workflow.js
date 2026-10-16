export const meta = {
  name: 'crops',
  description: "S0a figure crops for a PDF book: place a figure's box on a gridded page (locate), place it again on a close-up (refine), and check a crop edge by edge (check)",
  whenToUse: 'Run by crop_figures.py, one task at a time: it renders the grids, close-ups and crops between the calls (a workflow cannot write a file).',
  phases: [
    { title: 'Locate', detail: 'the box on the whole page, read from its 5% grid (Sonnet, vision)' },
    { title: 'Refine', detail: 'the box again on a close-up with its own 10% grid (Sonnet, vision)' },
    { title: 'Check', detail: 'each crop, edge by edge: cut, crowded, or not the figure at all (Sonnet, vision)' },
  ],
}

// ---------------------------------------------------------------------------------------------
// CROPS (crop_figures.py; Tamer, 2026-10-16). The prompts, word for word from crop_figures.py crop-v1, live here; the
// material of each task (the image paths, the figures' captions, what the last check said) is crop_figures.py's.
// ARGS: { stage: 'S0a-crops', mode: 'locate' | 'refine' | 'check', book: {book}, model?: 'sonnet', task: {label, material} }
// ---------------------------------------------------------------------------------------------

const PROMPTS_VERSION = 'crop-v2'   // v2: crop_figures.py's prompts in this workflow, unchanged
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const MODES = {
  locate: { phase: 'Locate', system: "You find figures on a printed textbook page and give the box around each.\nThe page image has a grid drawn over it: thin lines every 5% of the page's width and height, numbered 0-100 along the edges.\nFor each figure listed, give the smallest box that holds the WHOLE figure: every line, arrow, point, label, number and the figure's own title or set names (e.g. \"X \u00d7 Y\" printed under an arrow diagram). Leave out everything that is not part of the figure: paragraph text, headings, other figures, page decoration.\nGive left, top, right and bottom as percentages of the page (0-100), to the nearest 0.5. A figure listed that is not on the page: found=false.\nRead the page image with the Read tool first.", schema: {"type": "object", "required": ["figures"], "properties": {"figures": {"type": "array", "items": {"type": "object", "required": ["id", "found"], "properties": {"id": {"type": "string"}, "found": {"type": "boolean"}, "left": {"type": "number"}, "top": {"type": "number"}, "right": {"type": "number"}, "bottom": {"type": "number"}}}}}} },
  refine: { phase: 'Refine', system: "You place a tight box around a figure in a close-up of a textbook page.\nEach close-up has a grid drawn over it: lines every 10% of ITS width and height, numbered 0-100 along the edges. The figure is somewhere inside, with parts of the page around it.\nFor each close-up, give the smallest box that holds the WHOLE figure described: every line, arrow, point, label, number and the figure's own title or set names. Leave out everything that is not part of it: paragraph text beside it, headings, other figures.\nGive left, top, right and bottom as percentages of the CLOSE-UP (0-100), to the nearest 0.5. If the figure runs off an edge of the close-up, give that edge as 0 or 100.\nRead each close-up with the Read tool first.", schema: {"type": "object", "required": ["figures"], "properties": {"figures": {"type": "array", "items": {"type": "object", "required": ["id", "found"], "properties": {"id": {"type": "string"}, "found": {"type": "boolean"}, "left": {"type": "number"}, "top": {"type": "number"}, "right": {"type": "number"}, "bottom": {"type": "number"}}}}}} },
  check:  { phase: 'Check',  system: "You check crops cut from a textbook page, one per figure.\nFor each crop, read the image with the Read tool and compare it with the figure's description. For each edge (left, top, right, bottom) say:\n- \"extend\": the figure is cut at this edge (a line, arrow, label or number of the figure runs off it, or a described part is missing on that side);\n- \"trim\": something that is NOT part of the figure is inside the crop along this edge (paragraph text, a heading, part of another figure);\n- \"ok\": neither.\nshows_figure=false when the crop does not show the described figure at all (it shows other text, a page header or footer, another figure).\nBlank margin is fine. ok=true only when shows_figure is true and all four edges are \"ok\".",  schema: {"type": "object", "required": ["crops"], "properties": {"crops": {"type": "array", "items": {"type": "object", "required": ["id", "shows_figure", "ok", "left", "top", "right", "bottom"], "properties": {"id": {"type": "string"}, "shows_figure": {"type": "boolean"}, "ok": {"type": "boolean"}, "left": {"type": "string", "enum": ["ok", "extend", "trim"]}, "top": {"type": "string", "enum": ["ok", "extend", "trim"]}, "right": {"type": "string", "enum": ["ok", "extend", "trim"]}, "bottom": {"type": "string", "enum": ["ok", "extend", "trim"]}, "note": {"type": "string"}}}}}} },
}
if (ARGS.stage !== 'S0a-crops' || !MODES[ARGS.mode] || !ARGS.task) throw new Error('args must be built by crop_figures.py')
const M = MODES[ARGS.mode]
phase(M.phase)
const result = await agent(`${M.system}\n\n${ARGS.task.material}`, { label: `${ARGS.mode}:${ARGS.task.label}`, phase: M.phase, model: ARGS.model || 'sonnet', schema: M.schema })
return { stage: 'S0a-crops', workflow: 'crops', mode: ARGS.mode, prompts_version: PROMPTS_VERSION,
  ...(ARGS.embedded ? { embedded: ARGS.embedded } : {}), result: result || {} }

# Chat Protocol Contract — citations, directives, widgets (As-Built)

**Date**: 2026-08-02 · Parser: `app/src/lib/chat-parse.ts` (string-aware brace matcher,
streaming tail holdback — half-typed protocol never renders). Prompt side:
per-subject kits in `app/src/lib/lesson.ts` + `ask.ts`.

## Inline citation markers (receipts)

`[[lo:u1-4-3]]` · `[[q:u1-4-3:002]]` · `[[page:22]]` · `[[term?:المصطلح]]` (flags a
missing ministry term — never a silently guessed definition). Rendered as provenance
chips with hover cards; extracted per turn into `ai_interactions.citations`.

## Line-level directives (`{{…}}`, one interactive per message, last beat)

| Directive | Meaning |
|---|---|
| `{{beat}}` | Pacing pause (renders as a natural writing pause, never text) |
| `{{show_question:q:…}}` | Push a live question card (bank ids only, once per session) |
| `{{highlight:lo:…,lo:…}}` | Highlight LOs on the spine surface |
| `{{widget:<name>:{…json}}}` | Interactive widget (payload JSON, nested braces OK) |
| `{{widget:viz_ref:v:…}}` | Stored figure by id (no JSON payload) |
| `{{show_passage:…}}` | Sealed passage pointer — see below |
| `{{switch_subject:math\|social}}` | Cross-subject handoff card (never an inline answer) |
| `{{check_in}}` / `{{finish_lesson}}` | Mid-lesson check / end session → report |

Malformed payloads are consumed silently (never rendered raw); models' miscounted
closing braces tolerated (+2).

## Sealed passage pointers (`show_passage`) — ADR-0006 + 2026-08-02 extensions

```jsonc
{{show_passage:t:ara1-1:001}}                                    // bare: scroll chip
{{show_passage:{"id":"t:ara2-1:001","quote":"…3–12 words…","view":"line"}}}   // prose
{{show_passage:{"id":"t:ara1-1:001","unit":63,"view":"context"}}}             // sacred
```

- `quote` — verbatim consecutive words of a **non-sacred** passage; matched
  diacritics-insensitively (LOOSE fold); a locator only — **store bytes render, never
  the model's text**; no match ⇒ plain chip, nothing invented.
- `unit` — آية/unit **number** (printed mushaf numbering ﴿٦٣﴾ or sequential index both
  accepted); the ONLY pointer into sacred text — `quote` is forbidden there (and would
  die in the runtime guard anyway).
- `view: "line"` (default with a span) — inline excerpt card carrying only the marked
  span + attribution + «شوف السياق كامل ⬆» jump. Synonyms excerpt/inline/small.
- `view: "context"` — highlight inside the pinned full card + pointer chip. Synonyms
  full/card/pin.
- Pointers are never asks: the message must still end with a question/widget; never
  two pointer messages in a row.

## Widget catalog (payloads grounded in lesson data only)

Math: `pair_plotter` (lattice point −5..5), `product_builder` (X×Y pairs).
Social: `locate_on_map` (gazetteer names only), `timeline_builder`, `chain_builder`
(سبب→حدث→نتيجة), `term_match`.
Arabic: `extract_spans` (never sacred text), `hamza_seat` (printed case rows),
`style_purpose` (مواطن الجمال verbatim), `irab_builder` (grounding gate: `rule_ref.quote`
must be a printed rule line with page), `term_match`.
Figures: `viz`/`viz_ref` render the 19-primitive parametric library (`components/viz/`);
a figure counts as the message's one directive.

Results return as `[live event]` note lines; the tutor MUST adapt its next beat to the
latest result. Widgets grade deterministically client-side and fire `onResult` exactly
once.

## Sacred-text hard rules (prompt + runtime, both)

- The model never types Quran/Hadith — not in prose, not in any payload; single
  glossary words are allowed.
- Any reply containing a ≥4-word LOOSE run of sealed sacred text is killed server-side
  before it reaches the client (96-char holdback) and replaced with a redirect to the
  sealed card.

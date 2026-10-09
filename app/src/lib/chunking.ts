/**
 * Chunked tutor turns (FR-3501…FR-3508, docs/design/chunking.md).
 *
 * Two pure halves, shared by the client and the server:
 *
 *   - `gateAtBoundary` — the paced reveal's question at every `{{beat}}` /
 *     `{{ask}}`: wait for a tap on Next, keep the timed pause, or wait for
 *     more of the stream before deciding (ChatCore).
 *   - `chunkingViolations` — what a delivered reply broke, by rule id, for
 *     the `chunking_violation` event (api/ask). Never the text itself.
 *
 * Both read the message through `parseMessage`, so "a word", "a beat" and
 * "the ask" mean exactly what the student was shown.
 */

import { parseMessage, type Block, type Inline } from "./chat-parse";

/** FR-3501: a reply of more than one beat with at least this many words of
 *  prose is stepped through with Next; a shorter one keeps the timed pause. */
export const GATE_MIN_WORDS = 40;

const inlineText = (inlines: Inline[]) =>
  inlines.map((x) => (x.t === "text" ? x.v : "")).join("");

const countWords = (s: string) =>
  s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** The prose a block shows, as plain text (citations and directives drop out). */
function blockText(b: Block): string {
  if (b.t === "para") return inlineText(b.inlines);
  if (b.t === "list") return b.items.map(inlineText).join("\n");
  if (b.t === "ask") return b.paras.map(inlineText).join("\n");
  return "";
}

/** Words of prose in a (possibly still streaming) reply. */
export function proseWordCount(text: string, streaming = true): number {
  return parseMessage(text, streaming).reduce((n, b) => n + countWords(blockText(b)), 0);
}

/** Blocks that put something on screen. `beat`, `highlight`, `finish` and the
 *  probing directives render nothing; an ask with no line yet is empty too. */
function rendersSomething(b: Block): boolean {
  switch (b.t) {
    case "beat":
    case "highlight":
    case "finish":
    case "answer_submitted":
    case "reveal_answer":
      return false;
    case "ask":
      return b.paras.length > 0;
    default:
      return true;
  }
}

/** True when the text holds anything the student would see. */
export function hasVisibleContent(text: string, streaming = true): boolean {
  return parseMessage(text, streaming).some(rendersSomething);
}

export const FIGURE_DIRECTIVE_RE = /^\{\{(widget:viz(_ref)?:|show_passage:)/;

export type GateDecision = "gate" | "pause" | "wait";

/**
 * At a beat boundary of the reply being revealed: stop for Next ("gate"),
 * keep the timed pause ("pause"), or hold until more of the stream arrives
 * ("wait") because the answer depends on text not here yet.
 *
 * - Nothing revealed since the last gate (a `{{beat}}` straight after an
 *   `{{ask}}`'s gate, or two markers in a row) → never a second gate.
 * - Nothing visible after the boundary → no gate: Next must always lead
 *   somewhere. While the stream is open that is not known yet → wait.
 * - A figure revealed since the last gate → gate, whatever the length
 *   (FR-3505).
 * - Otherwise gate once the reply has GATE_MIN_WORDS words (FR-3501); below
 *   that, decide only once the stream has ended.
 */
export function gateAtBoundary(o: {
  /** the whole reply so far */
  text: string;
  /** where the boundary marker ends */
  boundaryEnd: number;
  streamEnded: boolean;
  revealedSinceGate: boolean;
  figureSinceGate: boolean;
}): GateDecision {
  if (!o.revealedSinceGate) return "pause";
  if (!hasVisibleContent(o.text.slice(o.boundaryEnd))) {
    return o.streamEnded ? "pause" : "wait";
  }
  if (o.figureSinceGate) return "gate";
  if (proseWordCount(o.text) >= GATE_MIN_WORDS) return "gate";
  return o.streamEnded ? "pause" : "wait";
}

/* ------------------------------------------------------------------ */
/* Violations (FR-3507)                                                 */
/* ------------------------------------------------------------------ */

export type ChunkingRule =
  | "sentence_too_long"
  | "beat_too_long"
  | "too_many_beats"
  | "multiple_asks"
  | "ask_not_last"
  | "missing_ask_marker"
  | "multiple_objectives"
  | "figure_and_ask_same_beat"
  | "figure_not_alone"
  | "compound_question"
  | "all_caps"
  | "dash_overuse"
  | "italics"
  | "idiom";

export const SENTENCE_MAX_WORDS = 20;
export const BEAT_MAX_WORDS = 25;
export const MAX_BEATS = 4;

/** Capitalised words that are not shouting. Extend as the curriculum needs. */
const ACRONYMS = new Set([
  "IGCSE", "PDF", "LCM", "HCF", "GCD", "BC", "AD", "USA", "UK", "UN", "EGP",
  "CM", "KM", "MM", "KG", "TV", "OK", "ID", "AI", "SAS", "ASA", "SSS", "RHS",
  "LHS", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII",
]);

/** Phrases a B1 reader of English cannot be expected to know (§4 rule 4). */
export const IDIOMS = [
  "close cousin",
  "make the cut",
  "nice catch",
  "piece of cake",
  "spot on",
  "on the money",
  "hit the nail",
  "ballpark",
  "no-brainer",
  "under your belt",
  "in a nutshell",
  "the gist",
  "get the hang",
  "a walk in the park",
  "tricky customer",
];

const INTERACTIVE_WIDGETS_EXCLUDED = new Set(["viz", "viz_ref"]);

const isAskBlock = (b: Block) =>
  b.t === "ask" ||
  b.t === "question" ||
  b.t === "check_in" ||
  (b.t === "widget" && !INTERACTIVE_WIDGETS_EXCLUDED.has(b.name));

const isFigureBlock = (b: Block) =>
  (b.t === "widget" && INTERACTIVE_WIDGETS_EXCLUDED.has(b.name)) || b.t === "passage_ref";

/** Strip $…$ math and citation markers so they never count as caps or dashes. */
const plain = (s: string) => s.replace(/\$[^$]*\$/g, " ").replace(/\[\[[^\]]*\]\]/g, " ");

function sentencesOf(s: string): string[] {
  return plain(s)
    .split(/(?<=[.!?؟])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface ChunkingReport {
  rules: ChunkingRule[];
  counts: Partial<Record<ChunkingRule, number>>;
  words: number;
  beats: number;
}

/**
 * Check one delivered reply against docs/design/chunking.md §6. `lesson`
 * turns on the one-objective rule (FR-3504), which the Your Progress chat
 * deliberately does not keep — it traces paths across objectives.
 */
export function chunkingViolations(text: string, opts: { lesson: boolean }): ChunkingReport {
  const blocks = parseMessage(text, false);
  const counts: Partial<Record<ChunkingRule, number>> = {};
  const hit = (r: ChunkingRule, n = 1) => {
    if (n > 0) counts[r] = (counts[r] ?? 0) + n;
  };

  // beats: split the blocks at {{beat}} markers
  const beats: Block[][] = [[]];
  for (const b of blocks) {
    if (b.t === "beat") beats.push([]);
    else beats[beats.length - 1].push(b);
  }
  const shown = beats.filter((bt) => bt.some(rendersSomething));
  if (shown.length > MAX_BEATS) hit("too_many_beats");

  let words = 0;
  for (const beat of shown) {
    const prose = beat.filter((b) => b.t !== "ask").map(blockText).join(" ");
    const w = countWords(plain(prose));
    words += countWords(plain(beat.map(blockText).join(" ")));
    if (w > BEAT_MAX_WORDS) hit("beat_too_long");
    if (beat.some(isFigureBlock) && beat.some(isAskBlock)) hit("figure_and_ask_same_beat");
    else if (beat.some(isFigureBlock) && w > 0) hit("figure_not_alone");
  }

  const asks = blocks.filter(isAskBlock);
  if (asks.length > 1) hit("multiple_asks");
  if (asks.length > 0) {
    const firstAsk = blocks.indexOf(asks[0]);
    if (blocks.slice(firstAsk + 1).some(rendersSomething)) hit("ask_not_last");
  }
  // FR-3503: an ask is ONE question — "…? Why or why not?" is two
  for (const b of blocks) {
    if (b.t !== "ask") continue;
    const q = plain(blockText(b));
    if ((q.match(/[?؟]/g) ?? []).length > 1 || /\bwhy or why not\b/i.test(q)) {
      hit("compound_question");
    }
  }
  if (!text.includes("{{ask}}") && blocks.some((b) => b.t === "ask")) {
    hit("missing_ask_marker");
  }

  if (opts.lesson) {
    const los = new Set(
      [...text.matchAll(/\[\[lo:([^\]\n]{1,80})\]\]/g)].map((m) => m[1].trim())
    );
    if (los.size > 1) hit("multiple_objectives");
  }

  const prose = blocks.map(blockText).join("\n");
  for (const s of sentencesOf(prose)) {
    if (countWords(s) > SENTENCE_MAX_WORDS) hit("sentence_too_long");
    if ((s.match(/—/g) ?? []).length > 1) hit("dash_overuse");
  }
  const bare = plain(prose).replace(/\*\*[^*]+\*\*/g, (m) => m.replace(/\*/g, ""));
  for (const w of bare.match(/\b[A-Z]{3,}\b/g) ?? []) {
    if (!ACRONYMS.has(w)) hit("all_caps");
  }
  hit("italics", (plain(prose).match(/(?<![*\w])\*(?!\s|\*)[^*\n]+?(?<!\s)\*(?![*\w])/g) ?? []).length);
  const lower = prose.toLowerCase();
  for (const idiom of IDIOMS) if (lower.includes(idiom)) hit("idiom");

  return {
    rules: Object.keys(counts) as ChunkingRule[],
    counts,
    words,
    beats: shown.length,
  };
}

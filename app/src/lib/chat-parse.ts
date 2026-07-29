/**
 * Parser for the Ask-the-Spine chat protocol.
 *
 * Assistant text carries inline citation markers —
 *   [[lo:u1-4-3]]  [[q:u1-4-3:002]]  [[page:22]]
 * — and line-level action directives —
 *   {{show_question:q:u1-4-1:002}}  {{highlight:lo:u1-2-1,lo:u1-3-1}}
 *   {{widget:pair_plotter:{"prompt":"Plot (3,2)","target":[3,2]}}}
 *   {{widget:viz:{"kind":"ratio_bars","spec":{"parts":[…]},"caption":"…"}}}
 *   {{widget:viz_ref:v:geo1-1:001}}   (stored figure by id — no JSON payload)
 *   {{finish_lesson}}
 *
 * Widget payloads are JSON objects and may nest (the viz directive carries a
 * full primitive spec), so directives are scanned with a small string-aware
 * brace matcher rather than a regex.
 *
 * While streaming we hold back an incomplete trailing marker so the user
 * never sees half-typed protocol syntax.
 */

import { SPINE_SUBJECT_KEYS } from "./subjects";
import type { SpineSubject } from "./subjects";

export type CiteKind = "lo" | "q" | "page" | "term";

export interface Cite {
  kind: CiteKind;
  /** full id: "lo:u1-4-3", "q:u1-4-3:002", "22" for pages, or the flagged
   *  Arabic term itself for "term" ([[term?:المصطلح]] — Arabic-script
   *  subjects' contract) */
  id: string;
}

export type Inline = { t: "text"; v: string } | ({ t: "cite" } & Cite);

export type Block =
  | { t: "para"; inlines: Inline[] }
  | { t: "list"; items: Inline[][] }
  | { t: "question"; qid: string }
  | { t: "highlight"; ids: string[] }
  | { t: "widget"; name: string; props: Record<string, unknown> }
  | { t: "beat" }
  | { t: "check_in" }
  | { t: "switch_subject"; subject: SpineSubject }
  | { t: "finish" };

const CITE_RE = /\[\[(lo|q|page|term\?):([^\]\n]{1,80})\]\]/g;

/** Marker keyword → CiteKind ("term?" flags a missing ministry term). */
const citeKind = (k: string): CiteKind => (k === "term?" ? "term" : (k as CiteKind));

/** True once the (complete, non-streaming) text carries {{finish_lesson}}. */
export function hasFinishDirective(text: string): boolean {
  return text.includes("{{finish_lesson}}");
}

const fullId = (kind: string, rest: string) =>
  kind === "page" || kind === "term?" ? rest.trim() : `${kind}:${rest.trim()}`;

/* ------------------------------------------------------------------ */
/* Directive scanning (string-aware, supports nested widget JSON)      */
/* ------------------------------------------------------------------ */

interface Action {
  start: number;
  end: number;
  /** null ⇒ consume the directive but render nothing (malformed payload) */
  block: Block | null;
}

const SIMPLE_RE = /^\{\{(show_question|highlight):([^}\n]{1,160})\}\}/;
const WIDGET_HEAD_RE = /^\{\{widget:([a-z_]{1,40}):/;
/** Built from the subject registry, so a handoff to a subject the product
 *  actually has is parsed instead of being rendered as raw protocol text.
 *  (What the tutor is TOLD it may emit is a separate, per-prompt decision.) */
const SWITCH_RE = new RegExp(
  `^\\{\\{switch_subject:(${SPINE_SUBJECT_KEYS.join("|")})\\}\\}`
);
const FINISH = "{{finish_lesson}}";
const BEAT = "{{beat}}";
const CHECK_IN = "{{check_in}}";
const MAX_PAYLOAD = 4000;

/** Balanced-JSON scan from `start` (which must be "{"), string-aware. */
function scanJson(s: string, start: number): { text: string; end: number } | null {
  if (s[start] !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < s.length && j - start < MAX_PAYLOAD; j++) {
    const ch = s[j];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { text: s.slice(start, j + 1), end: j + 1 };
    }
  }
  return null; // incomplete (still streaming) or overlong
}

/** Parse one complete directive at position `i` (must point at "{{"). */
function parseActionAt(s: string, i: number): Action | null {
  const head = s.slice(i, i + 220);
  const m = SIMPLE_RE.exec(head);
  if (m) {
    const block: Block =
      m[1] === "show_question"
        ? { t: "question", qid: m[2].trim() }
        : {
            t: "highlight",
            ids: m[2].split(",").map((x) => x.trim()).filter(Boolean),
          };
    return { start: i, end: i + m[0].length, block };
  }
  if (head.startsWith(FINISH)) {
    return { start: i, end: i + FINISH.length, block: { t: "finish" } };
  }
  if (head.startsWith(BEAT)) {
    return { start: i, end: i + BEAT.length, block: { t: "beat" } };
  }
  if (head.startsWith(CHECK_IN)) {
    return { start: i, end: i + CHECK_IN.length, block: { t: "check_in" } };
  }
  const sw = SWITCH_RE.exec(head);
  if (sw) {
    return {
      start: i,
      end: i + sw[0].length,
      block: { t: "switch_subject", subject: sw[1] as SpineSubject },
    };
  }
  const w = WIDGET_HEAD_RE.exec(head);
  if (w && w[1] === "viz_ref") {
    // {{widget:viz_ref:v:geo1-1:001}} — bare id payload, no JSON
    const rest = s.slice(i + w[0].length, i + w[0].length + 120);
    const rm = /^([^{}\n]{1,80})\}\}/.exec(rest);
    if (rm) {
      let end = i + w[0].length + rm[0].length;
      if (s[end] === "}") end++; // tolerate one miscounted extra brace
      const id = rm[1].trim();
      return {
        start: i,
        end,
        block: id ? { t: "widget", name: "viz_ref", props: { id } } : null,
      };
    }
    return null; // still streaming the id
  }
  if (w) {
    const payload = scanJson(s, i + w[0].length);
    if (payload) {
      // Models sometimes miscount the closing braces ("}}" instead of
      // "}}}"), so once the JSON payload balances, tolerantly consume up
      // to two trailing "}" whether or not both are present.
      let end = payload.end;
      for (let k = 0; k < 2 && s[end] === "}"; k++) end++;
      let block: Block | null = null;
      try {
        const props = JSON.parse(payload.text) as unknown;
        if (props !== null && typeof props === "object" && !Array.isArray(props)) {
          block = { t: "widget", name: w[1], props: props as Record<string, unknown> };
        }
      } catch {
        /* malformed widget payload — consume silently */
      }
      return { start: i, end, block };
    }
  }
  return null;
}

function scanActions(s: string): Action[] {
  const out: Action[] = [];
  let i = 0;
  while ((i = s.indexOf("{{", i)) !== -1) {
    const a = parseActionAt(s, i);
    if (a) {
      out.push(a);
      i = a.end;
    } else {
      i += 2;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Streaming tail                                                      */
/* ------------------------------------------------------------------ */

const DIRECTIVE_KEYWORDS = [
  "show_question:",
  "highlight:",
  "widget:",
  "finish_lesson}}",
  "beat}}",
  "check_in}}",
  "switch_subject:",
];

/** True when "{{" at `i` opens a directive that is not yet complete. */
function isIncompleteDirective(s: string, i: number): boolean {
  const after = s.slice(i + 2);
  for (const k of DIRECTIVE_KEYWORDS) {
    if (after.length < k.length) {
      if (k.startsWith(after)) return true; // still typing the keyword
    } else if (after.startsWith(k)) {
      return parseActionAt(s, i) === null; // keyword done, body incomplete
    }
  }
  return false;
}

/** Trim an incomplete trailing `[[…` / `{{…` / `$…` marker during streaming. */
export function stripIncompleteTail(s: string): string {
  const ci = s.lastIndexOf("[[");
  if (ci >= 0 && s.indexOf("]]", ci) === -1) s = s.slice(0, ci);
  // a widget payload may itself contain "{{"/"}}", so check the last widget
  // opener first, then the last generic opener
  const wi = s.lastIndexOf("{{widget:");
  if (wi >= 0 && isIncompleteDirective(s, wi)) {
    s = s.slice(0, wi);
  } else {
    const di = s.lastIndexOf("{{");
    if (di >= 0 && isIncompleteDirective(s, di)) s = s.slice(0, di);
  }
  // unclosed inline math: an odd count of unescaped "$" means the last one
  // opens a segment still being streamed — hold it back too
  let dollars = 0;
  let lastDollar = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "$" && s[i - 1] !== "\\") {
      dollars++;
      lastDollar = i;
    }
  }
  if (dollars % 2 === 1) s = s.slice(0, lastDollar);
  return s;
}

/**
 * For the paced-reveal engine: what lies at position `i` (must point at "{{")?
 * Returns the end index of a COMPLETE directive, "incomplete" while its body
 * is still streaming, or null when it is not directive syntax at all.
 */
export function directiveEndAt(
  s: string,
  i: number
): number | "incomplete" | null {
  const a = parseActionAt(s, i);
  if (a) return a.end;
  return isIncompleteDirective(s, i) ? "incomplete" : null;
}

/* ------------------------------------------------------------------ */
/* Extraction helpers                                                  */
/* ------------------------------------------------------------------ */

/** All complete citations in the text, in order, deduped. */
export function extractCites(text: string): Cite[] {
  const out: Cite[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(text))) {
    const id = fullId(m[1], m[2]);
    const key = `${m[1]}|${id}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ kind: citeKind(m[1]), id });
    }
  }
  return out;
}

/** All complete highlight directives' LO ids. */
export function extractHighlights(text: string): string[] {
  const ids: string[] = [];
  for (const a of scanActions(text)) {
    if (a.block?.t === "highlight") {
      for (const id of a.block.ids) if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/* ------------------------------------------------------------------ */
/* Message → blocks                                                    */
/* ------------------------------------------------------------------ */

function parseInlines(text: string): Inline[] {
  const inlines: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  CITE_RE.lastIndex = 0;
  while ((m = CITE_RE.exec(text))) {
    if (m.index > last) inlines.push({ t: "text", v: text.slice(last, m.index) });
    inlines.push({ t: "cite", kind: citeKind(m[1]), id: fullId(m[1], m[2]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) inlines.push({ t: "text", v: text.slice(last) });
  return inlines;
}

function parseTextChunk(chunk: string, blocks: Block[]) {
  for (const para of chunk.split(/\n{2,}/)) {
    if (!para.trim()) continue;
    const lines = para.split("\n");
    let paraLines: string[] = [];
    let listItems: string[] = [];
    const flushPara = () => {
      if (paraLines.length) {
        blocks.push({ t: "para", inlines: parseInlines(paraLines.join(" ")) });
        paraLines = [];
      }
    };
    const flushList = () => {
      if (listItems.length) {
        blocks.push({ t: "list", items: listItems.map(parseInlines) });
        listItems = [];
      }
    };
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-•]\s+/.test(trimmed)) {
        flushPara();
        listItems.push(trimmed.replace(/^[-•]\s+/, ""));
      } else {
        flushList();
        if (trimmed) paraLines.push(trimmed);
      }
    }
    flushPara();
    flushList();
  }
}

/** Full message → renderable blocks. Streaming ⇒ incomplete tail withheld. */
export function parseMessage(text: string, streaming: boolean): Block[] {
  const s = streaming ? stripIncompleteTail(text) : text;
  const blocks: Block[] = [];
  let last = 0;
  for (const a of scanActions(s)) {
    if (a.start > last) parseTextChunk(s.slice(last, a.start), blocks);
    if (a.block) blocks.push(a.block);
    last = a.end;
  }
  if (last < s.length) parseTextChunk(s.slice(last), blocks);
  return blocks;
}

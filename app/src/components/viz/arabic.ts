/**
 * Arabic text helpers shared by the social-studies primitives and widgets, and
 * by the VIZ_SPEC v3 Arabic kinds (ADR-0006).
 *
 * Policy (spec §4.3, social-studies-interactions.md): Arabic-Indic digits in
 * all student-facing prose, timelines and dates (matching the ministry book);
 * Western digits stay inside charts. Mixed runs (date ranges, «٧٠٫٧٪») must
 * be wrapped in <bdi> by the caller — these helpers only convert glyphs.
 *
 * THE RULE that governs everything below (arabic-viz-widgets.md §1.0):
 * **normalize for MATCHING, render the ORIGINAL.** Character offsets are not a
 * usable anchor for vowelled Arabic — producers count combining marks
 * inconsistently and any offset drifts the moment a harakah is added — so spans
 * are anchored by content (`{find, nth}`) and resolved through a position map.
 * A stripped string may be compared; it must never reach the screen, because in
 * this subject the تشكيل IS the content.
 */

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

/** Convert Western digits in a string to Arabic-Indic (٠١٢٣…). */
export function arDigits(v: string | number): string {
  return String(v).replace(/[0-9]/g, (d) => AR_DIGITS[+d]);
}

/**
 * Normalize an Arabic place/term name for tolerant lookup: strips diacritics
 * and tatweel, unifies alef/yaa/taa-marbuta variants, collapses whitespace.
 * Applied to BOTH sides of a gazetteer lookup, so producers writing «العقبه»
 * still resolve «العقبة».
 */
export function normalizeArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟـ]/g, "") // harakat, dagger alif, tatweel
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ة/g, "ه") // ة → ه
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/* Span anchoring — the shared mechanism (arabic-viz-widgets.md §1.0)   */
/* ------------------------------------------------------------------ */

/** Combining marks + tatweel + the Quranic annotation block (U+06D6–U+06ED). */
const MARK_RE = /[ً-ٰٟـۖ-ۭ]/;

/** True for a character that hangs off a base letter rather than being one. */
export function isArabicMark(ch: string): boolean {
  return MARK_RE.test(ch);
}

export interface Folded {
  /** the comparison string — marks removed, letters unified */
  folded: string;
  /** map[i] = index in the ORIGINAL string of folded[i] */
  map: number[];
}

/**
 * Strip the marks off `text` while remembering where every surviving character
 * came from. The position map is the piece that makes content-anchored spans
 * possible: we match on the stripped copy and slice the original.
 */
export function stripHarakat(text: string): { plain: string; map: number[] } {
  let plain = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (MARK_RE.test(ch)) continue;
    map.push(i);
    plain += ch;
  }
  return { plain, map };
}

/**
 * The matching form: marks stripped, alef/yaa/taa-marbuta unified, whitespace
 * runs collapsed to one space — with a position map back into the original.
 * Every transformation is 1:1 or deleting, never inserting, so the map stays
 * exact.
 */
export function foldForMatch(text: string): Folded {
  let folded = "";
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (MARK_RE.test(ch)) continue;
    if (/\s/.test(ch)) {
      if (lastWasSpace) continue;
      lastWasSpace = true;
      map.push(i);
      folded += " ";
      continue;
    }
    lastWasSpace = false;
    let out = ch;
    if (ch === "آ" || ch === "أ" || ch === "إ" || ch === "ٱ")
      out = "ا";
    else if (ch === "ى") out = "ي";
    else if (ch === "ة") out = "ه";
    map.push(i);
    folded += out;
  }
  return { folded, map };
}

/** Folded form of a needle (no map needed). */
function foldNeedle(s: string): string {
  return foldForMatch(s).folded.trim();
}

const WORD_BOUNDARY = /[\s.,؛،؟!:"'«»()[\]{}…—–\-۝]/;

/**
 * Resolve `find` (occurrence `nth`, 1-based) inside `text` and return the
 * half-open range **of the ORIGINAL string**, with the last letter's combining
 * marks included — so «هَوْنًا» highlights with its tanween, not without it.
 *
 * Returns null when the needle does not occur, which is a *soft* failure: the
 * renderer skips that one span (same posture as an unknown gazetteer place in
 * map_scene) rather than blanking the passage. Producers get an offline
 * validator in the extraction pipeline so an unresolved find fails the bundle,
 * not the student.
 */
export function locateSpan(
  text: string,
  find: string,
  nth = 1,
  opts: { wholeWord?: boolean } = {}
): [number, number] | null {
  const needle = foldNeedle(find);
  if (!needle) return null;
  const { folded, map } = foldForMatch(text);
  let from = 0;
  let hit = -1;
  for (let k = 0; k < Math.max(1, nth); k++) {
    hit = folded.indexOf(needle, from);
    while (hit !== -1 && opts.wholeWord && !isWholeWord(folded, hit, needle.length)) {
      hit = folded.indexOf(needle, hit + 1);
    }
    if (hit === -1) return null;
    from = hit + 1;
  }
  const start = map[hit];
  let end = map[hit + needle.length - 1] + 1;
  // carry the trailing combining marks of the final letter
  while (end < text.length && MARK_RE.test(text[end])) end++;
  return [start, end];
}

function isWholeWord(folded: string, at: number, len: number): boolean {
  const before = at === 0 ? " " : folded[at - 1];
  const after = at + len >= folded.length ? " " : folded[at + len];
  return WORD_BOUNDARY.test(before) && WORD_BOUNDARY.test(after);
}

export interface WordToken {
  text: string;
  start: number;
  end: number;
  isWord: boolean;
}

/**
 * Split on whitespace ONLY — never inside a word.
 *
 * Arabic words do not join across spaces, so per-word `<span>`s are safe; a
 * per-character split breaks the cursive join in every browser and takes the
 * mark positioning with it (arabic-viz-widgets.md §3.3). Every tappable
 * passage and every إعراب leader line goes through this function.
 */
export function tokenizeWords(text: string): WordToken[] {
  const out: WordToken[] = [];
  const re = /\s+/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last)
      out.push({ text: text.slice(last, m.index), start: last, end: m.index, isWord: true });
    out.push({ text: m[0], start: m.index, end: re.lastIndex, isWord: false });
    last = re.lastIndex;
  }
  if (last < text.length)
    out.push({ text: text.slice(last), start: last, end: text.length, isWord: true });
  return out;
}

/**
 * Is this string carrying enough تشكيل to need the vowelled line-height?
 * Used so no producer has to think about `--ar-line-vowelled` vs `-plain`.
 */
export function isVowelled(text: string): boolean {
  let marks = 0;
  let letters = 0;
  for (const ch of text) {
    if (MARK_RE.test(ch)) marks++;
    else if (/[ؠ-يٮ-ە]/.test(ch)) letters++;
  }
  return letters > 0 && marks / letters >= 0.2;
}

/* ------------------------------------------------------------------ */
/* harakat_reveal — stage strings, never per-character spans (§1.7)     */
/* ------------------------------------------------------------------ */

export interface MarkTarget {
  /** half-open span of the combining marks being revealed */
  start: number;
  end: number;
  /** the base letter they sit on (for the leader/chip) */
  letterIndex: number;
}

/** The mark names a producer may write, → the codepoints they license. */
const MARK_NAMES: Record<string, string[]> = {
  fatha: ["َ"],
  damma: ["ُ"],
  kasra: ["ِ"],
  sukun: ["ْ"],
  shadda: ["ّ"],
  fathatan: ["ً"],
  dammatan: ["ٌ"],
  kasratan: ["ٍ"],
};

/**
 * Locate the marks sitting on one letter of a word: `on:"last"` (the إعراب
 * position — the whole point of the primitive) or a 0-based letter index.
 * When `expect` names a mark, a mismatch returns null instead of revealing
 * something the producer did not describe.
 */
export function locateMark(
  text: string,
  find: string,
  on: "last" | number = "last",
  expect?: string
): MarkTarget | null {
  const span = locateSpan(text, find);
  if (!span) return null;
  const [ws, we] = span;
  // base letters of the word, in original indices
  const letters: number[] = [];
  for (let i = ws; i < we; i++) if (!MARK_RE.test(text[i])) letters.push(i);
  if (letters.length === 0) return null;
  const letterIndex =
    on === "last"
      ? letters[letters.length - 1]
      : letters[Math.max(0, Math.min(letters.length - 1, on))];
  const s = letterIndex + 1;
  let e = s;
  while (e < text.length && MARK_RE.test(text[e])) e++;
  if (e === s) return null; // the letter carries no mark to reveal
  if (expect) {
    const allowed = MARK_NAMES[expect];
    if (allowed && !allowed.some((cp) => text.slice(s, e).includes(cp))) return null;
  }
  return { start: s, end: e, letterIndex };
}

/**
 * Build the reveal stages for `harakat_reveal`.
 *
 * Stage 0 is the text with every targeted mark hidden; stage k additionally
 * carries targets 0…k−1. Each stage is a COMPLETE, independently-shaped run —
 * which is the entire reason this technique exists. Animating a combining mark
 * by wrapping it in its own span breaks the cursive join and moves the mark to
 * the wrong base letter; cross-fading whole strings cannot.
 */
export function stageVowelled(text: string, targets: MarkTarget[]): string[] {
  const ordered = [...targets].sort((a, b) => a.start - b.start);
  const stages: string[] = [];
  for (let k = 0; k <= ordered.length; k++) {
    const hidden = ordered.slice(k);
    let out = "";
    for (let i = 0; i < text.length; i++) {
      if (hidden.some((t) => i >= t.start && i < t.end)) continue;
      out += text[i];
    }
    stages.push(out);
  }
  return stages;
}

/**
 * Runtime sacred-text containment (ADR-0006 §2: "the runtime still emits span
 * tokens, never scripture, with an output-containment check that FAILS
 * CLOSED").
 *
 * The tutor's prompt forbids reproducing Quran/Hadith and the sealed passage
 * is displayed to the student from verified data — but a prompt rule is not a
 * guarantee. This module is the guarantee: the ask route scans the model's
 * output stream against every sealed passage of the lesson and aborts the
 * turn the moment a quote-run appears, BEFORE the quoted words reach the
 * client (emission runs behind a holdback window longer than the detection
 * threshold).
 *
 * Matching is LOOSE — the TS mirror of services/extraction/arabic_text.py
 * compare_loose(): harakat/annotation stripped, أإآٱ→ا, ى→ي, ة→ه, ؤ→و, ئ→ي —
 * so an imlā'ī re-typing of an Uthmani آية is still caught. Threshold = 4
 * consecutive words (verification §1.6): long enough that ordinary vocabulary
 * overlap (single glossary words are legitimate) never trips it.
 */

const THRESHOLD = 4;

/** How many trailing characters of the stream we hold back from the client.
 *  Must exceed the longest possible rendering of a (THRESHOLD)-word run —
 *  4 fully vocalised Arabic words stay well under 96 chars. */
export const SACRED_HOLDBACK_CHARS = 96;

function foldWords(s: string): string[] {
  const out: string[] = [];
  let w = "";
  for (const ch of s.normalize("NFC")) {
    const cp = ch.codePointAt(0)!;
    // dropped outright: harakat + shadda/sukun + hamza marks, dagger alef,
    // Quranic annotation block, tatweel, ornate brackets
    if (
      (cp >= 0x064b && cp <= 0x0656) ||
      cp === 0x0670 ||
      (cp >= 0x06d6 && cp <= 0x06ed) ||
      cp === 0x0640 ||
      cp === 0xfd3e ||
      cp === 0xfd3f
    ) {
      continue;
    }
    // folded letters
    let c = ch;
    if (ch === "أ" || ch === "إ" || ch === "آ" || ch === "ٱ") c = "ا";
    else if (ch === "ى") c = "ي";
    else if (ch === "ة") c = "ه";
    else if (ch === "ؤ") c = "و";
    else if (ch === "ئ") c = "ي";
    // token boundaries: whitespace + punctuation
    if (/[\s،؛؟.,!:"'()\[\]«»—\-…]/.test(c)) {
      if (w) out.push(w);
      w = "";
      continue;
    }
    w += c;
  }
  if (w) out.push(w);
  return out;
}

export interface SacredGuard {
  /** true ⇒ the text contains a ≥4-word run of some sealed passage */
  violates(text: string): boolean;
  /** id of the first sealed passage (for the {{show_passage:…}} redirect) */
  firstPassageId: string;
}

/**
 * Build a guard from the lesson's sealed passages. Detection is a set of
 * 4-word shingles over the folded sealed text — O(words) per scan, no
 * quadratic alignment, and immune to the model splitting a quote across
 * stream deltas (the caller scans the ACCUMULATED text).
 */
export function makeSacredGuard(
  passages: { id: string; text: string }[]
): SacredGuard | null {
  const shingles = new Set<string>();
  let firstPassageId = "";
  for (const p of passages) {
    const words = foldWords(p.text);
    if (words.length < THRESHOLD) continue;
    if (!firstPassageId) firstPassageId = p.id;
    for (let i = 0; i + THRESHOLD <= words.length; i++) {
      shingles.add(words.slice(i, i + THRESHOLD).join(" "));
    }
  }
  if (shingles.size === 0) return null;
  return {
    firstPassageId,
    violates(text: string): boolean {
      const words = foldWords(text);
      for (let i = 0; i + THRESHOLD <= words.length; i++) {
        if (shingles.has(words.slice(i, i + THRESHOLD).join(" "))) return true;
      }
      return false;
    },
  };
}

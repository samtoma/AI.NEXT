/**
 * Internal ids never reach a student (UI clean-up, 2026-10-23).
 *
 * The report's strengths, gaps and next step are written by the model, and the
 * prompt names each objective by its id, so a phrase like "Cartesian product
 * formation (lo:u1-1-2)" can come back. The prompt now asks for names only;
 * this is the net for when it does not listen, and for reports already stored.
 *
 * The id shapes are the graph's: `lo:u1-1-2`, `q:pp3u7-2-2:w011`,
 * `v:pp3u10-5:figure-16` — a prefix, a colon, then lowercase id characters.
 */
const ID = String.raw`\b(?:lo|q|v):[a-z0-9][a-z0-9._:-]*`;

/** "(lo:a)", "(lo:a, lo:b)" — a bracket holding nothing but ids goes whole. */
const ID_ONLY_BRACKET = new RegExp(String.raw`\s*\(\s*${ID}(?:\s*[,;/]\s*(?:or\s+|and\s+)?${ID})*\s*\)`, "g");
const BARE_ID = new RegExp(ID, "g");

export function stripInternalIds(text: string): string {
  return text
    .replace(ID_ONLY_BRACKET, "")
    .replace(BARE_ID, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}

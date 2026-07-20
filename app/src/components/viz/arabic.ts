/**
 * Arabic text helpers shared by the social-studies primitives and widgets.
 *
 * Policy (spec §4.3, social-studies-interactions.md): Arabic-Indic digits in
 * all student-facing prose, timelines and dates (matching the ministry book);
 * Western digits stay inside charts. Mixed runs (date ranges, «٧٠٫٧٪») must
 * be wrapped in <bdi> by the caller — these helpers only convert glyphs.
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
    .replace(/[ً-ْٰـ]/g, "") // harakat, dagger alif, tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Server-side speech sanitation for the neural voice.
 *
 * Mirrors voice.ts `sanitizeForSpeech` EXACTLY except it does NOT strip Arabic:
 * the neural model is multilingual, so we keep Arabic script and let the voice
 * handle it (English-first content is unaffected — it just cleans markup/LaTeX).
 * Kept in a plain (non-"use client") module so the route can import it.
 */

/** Rough spoken form for the tiny LaTeX subset used in lessons. */
function mathToWords(src: string): string {
  return src
    .replace(/\\times/g, " times ")
    .replace(/\\Rightarrow/g, " therefore ")
    .replace(/\\ne(q)?/g, " is not equal to ")
    .replace(/n\\?\(\s*([A-Za-z])\s*\\?\)/g, " n of $1 ")
    .replace(/\\\{|\\\}/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\^\s*2/g, " squared ")
    .replace(/=/g, " equals ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip citations, directives, markdown and LaTeX; KEEP Arabic. */
export function sanitizeForNeuralSpeech(text: string): string {
  return text
    .replace(/\{\{[^}]*\}\}+/g, " ") // action directives (incl. widget JSON tails)
    .replace(/\[\[[^\]]*\]\]/g, " ") // citation markers
    .replace(/\$([^$]+)\$/g, (_, m: string) => ` ${mathToWords(m)} `)
    .replace(/\*\*/g, "")
    .replace(/[•▲▼✓✗✦⚡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

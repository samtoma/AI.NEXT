/**
 * LABELS THAT CARRY MATHS (backlog #37; feature 003).
 *
 * The Grade 10 book's objective labels carry inline LaTeX — "Factorise a
 * quadratic trinomial $x^2 + bx + c$" — in the `$...$` form question stems
 * and canonical solutions already use. Printed as text, the check-in, the
 * subject home and the skill map showed the dollars and backslashes. Where a
 * label is RENDERED, `components/MathText.tsx` hands it to the app's one
 * maths renderer (`components/TeX.tsx`). Where it can only be a STRING — an
 * `aria-label`, a `title` tooltip — this module turns it into readable plain
 * text, so a screen reader says "x squared plus b x plus c" territory rather
 * than "dollar x caret 2".
 *
 * Pure; no React, no KaTeX. Every Prep-3 label has no `$`, so for every
 * National label both functions are the identity.
 */

/** Does this text carry inline `$...$` maths? */
export function hasMath(text: string | null | undefined): boolean {
  return typeof text === "string" && /\$[^$]+\$/.test(text);
}

const SYMBOLS: readonly [RegExp, string][] = [
  [/\\neq\b|\\ne\b/g, "≠"],
  [/\\leq\b|\\le\b/g, "≤"],
  [/\\geq\b|\\ge\b/g, "≥"],
  [/\\times\b/g, "×"],
  [/\\div\b/g, "÷"],
  [/\\cdot\b/g, "·"],
  [/\\pm\b/g, "±"],
  [/\\pi\b/g, "π"],
  [/\\theta\b/g, "θ"],
  [/\\alpha\b/g, "α"],
  [/\\beta\b/g, "β"],
  [/\\infty\b/g, "∞"],
  [/\\degree\b|\^\{?\\circ\}?/g, "°"],
  [/\\in\b/g, "∈"],
  [/\\to\b|\\rightarrow\b/g, "→"],
  [/\\approx\b/g, "≈"],
];

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", n: "ⁿ",
};

/** One `$...$` segment as plain text. */
function plainSegment(tex: string): string {
  let s = tex;
  s = s.replace(/\\(?:left|right)\s*/g, "");
  s = s.replace(/\\(?:text|mathrm|mathbf|operatorname)\{([^{}]*)\}/g, "$1");
  // \frac{a}{b} → a/b, and \sqrt{x} → √x (one level of nesting is all a label uses)
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2");
    s = s.replace(/\\sqrt\{([^{}]*)\}/g, "√$1");
  }
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  // x^2, x^{-1}, x^n — superscripts when every character has one
  s = s.replace(/\^\{([^{}]*)\}|\^(.)/g, (whole, braced: string | undefined, one: string | undefined) => {
    const body = braced ?? one ?? "";
    const sup = [...body].map((c) => SUPERSCRIPT[c]);
    return sup.every(Boolean) ? sup.join("") : `^${body}`;
  });
  s = s.replace(/_\{([^{}]*)\}|_(.)/g, "$1$2");
  // whatever command is left: drop the backslash, keep the name
  s = s.replace(/\\([a-zA-Z]+)/g, "$1");
  s = s.replace(/\\([{}%$&#_ ,;:!])/g, "$1");
  s = s.replace(/[{}]/g, "");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * The label as plain text: every `$...$` segment turned into readable
 * symbols, the delimiters gone. Text with no maths comes back unchanged.
 */
export function plainMath(text: string): string {
  if (!hasMath(text)) return text;
  return text.replace(/\$([^$]+)\$/g, (_, tex: string) => plainSegment(tex));
}

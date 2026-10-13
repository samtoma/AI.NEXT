/**
 * The maths symbol picker's keys: the catalogue, its groups, and which keys a lesson asks for.
 *
 * PROTOTYPE (branch `feat/proto-math-symbol-keys`, no FR yet). Design: the "Math symbol picker" handoff
 * (a ∑ inside the answer box opens a card: twelve keys, then "All symbols" by group). A student cannot type ∩, √ or ∠ on an
 * iPad keyboard. Every book stores its maths the same way — LaTeX in `$…$`, plus a few Unicode signs
 * such as ° — so the "For this lesson" keys are READ from the maths the student is looking at (the
 * tutor's last message, the lesson's questions), one reader and one table for every book, instead of a
 * hand-kept map from lesson to symbol set.
 *
 * Keys insert plain Unicode (handoff §7: no LaTeX, no preview), or a word where no sign survives a plain
 * text field (a segment, a ray, an arc).
 *
 * Pure: no React, no `@/` imports, so the seed-coverage test can run it over every stored question.
 */

export interface MathKey {
  id: string;
  /** the glyph on the key */
  t: string;
  /** the spoken name: the key's aria-label, and the caption under it in the full set */
  name: string;
  /** the text inserted at the caret */
  ins: string;
  /** characters to step the caret back after inserting, so brackets leave it inside */
  back: number;
}

const k = (id: string, t: string, name: string, ins = t, back = 0): MathKey => ({ id, t, name, ins, back });

/** Every key: the picker handoff's table (§6) and the tray handoff's, then what the Prep 3 book needs. */
export const MATH_KEYS: readonly MathKey[] = [
  k("paren", "( )", "brackets", "()", 1),
  k("brace", "{ }", "set brackets", "{}", 1),
  k("in", "∈", "is in"),
  k("notin", "∉", "is not in"),
  k("times", "×", "times"),
  k("div", "÷", "divide"),
  k("plus", "+", "plus"),
  k("minus", "−", "minus"),
  k("eq", "=", "equals"),
  k("neq", "≠", "not equal"),
  k("lt", "<", "less than"),
  k("gt", ">", "greater than"),
  k("le", "≤", "at most"),
  k("ge", "≥", "at least"),
  k("pm", "±", "plus or minus"),
  k("sq", "x²", "squared", "²"),
  k("pow", "xⁿ", "power", "^"),
  k("sqrt", "√", "square root", "√()", 1),
  k("frac", "a/b", "fraction", "()/()", 4),
  k("abs", "| |", "absolute value", "||", 1),
  k("pi", "π", "pi"),
  k("approx", "≈", "about equal"),
  k("arrow", "→", "maps to"),
  k("inf", "∞", "infinity"),
  k("union", "∪", "union"),
  k("inter", "∩", "intersection"),
  k("subset", "⊂", "subset"),
  k("subseteq", "⊆", "subset or equal"),
  k("empty", "∅", "empty set"),
  k("N", "ℕ", "natural numbers"),
  k("Z", "ℤ", "integers"),
  k("R", "ℝ", "real numbers"),
  k("deg", "°", "degrees"),
  k("angle", "∠", "angle"),
  k("tri", "△", "triangle"),
  k("perp", "⊥", "perpendicular"),
  k("par", "∥", "parallel"),
  k("cong", "≅", "congruent"),
  k("Pf", "P( )", "probability", "P()", 1),
  k("nf", "n( )", "number of", "n()", 1),
  k("fact", "!", "factorial"),
  k("pct", "%", "percent"),
  k("bar", "|", "given that"),

  k("nsubset", "⊄", "not a subset"),
  k("Q", "ℚ", "rational numbers"),
  k("equiv", "≡", "identical to"),
  k("propto", "∝", "varies as"),
  k("therefore", "∴", "therefore", "∴ "),
  k("segment", "AB̅", "segment", "segment "),
  k("ray", "AB→", "ray", "ray "),
  k("line", "AB↔", "line", "line "),
  k("arc", "AB⌒", "arc", "arc "),
  k("sim", "∼", "similar"),
  k("theta", "θ", "theta"),
  k("sum", "Σ", "sum"),
  k("mean", "x̄", "mean", "x̄"),
  k("sigma", "σ", "standard deviation"),
];

const BY_ID = new Map(MATH_KEYS.map((key) => [key.id, key]));
export const mathKey = (id: string): MathKey | undefined => BY_ID.get(id);

/**
 * The "All symbols" view's groups (picker handoff §6: SETS, NUMBER SETS, COMPARE, ALGEBRA, each as the
 * handoff lists it, then what the Prep 3 book needs beyond them), and two groups the handoff does not
 * have, for the Prep 3 keys that fit none of its four (geometry; probability and statistics).
 */
export const MATH_KEY_GROUPS: readonly { id: string; label: string; keys: readonly string[] }[] = [
  { id: "sets", label: "Sets", keys: ["in", "notin", "subset", "subseteq", "nsubset", "empty", "union", "inter", "brace", "paren", "times"] },
  { id: "number-sets", label: "Number sets", keys: ["N", "Z", "Q", "R"] },
  { id: "compare", label: "Compare", keys: ["eq", "neq", "le", "ge", "plus", "minus", "div", "lt", "gt", "approx", "equiv", "pm", "therefore"] },
  { id: "algebra", label: "Algebra", keys: ["sq", "sqrt", "frac", "abs", "pi", "arrow", "pow", "inf", "propto"] },
  { id: "shapes", label: "Shapes", keys: ["deg", "angle", "tri", "perp", "par", "cong", "sim", "segment", "ray", "line", "arc", "theta"] },
  { id: "chance", label: "Chance and data", keys: ["Pf", "nf", "fact", "pct", "bar", "sum", "mean", "sigma"] },
];

/** The picker's default view has this many keys (handoff §3: 6 × 2). */
export const PICKER_SIZE = 12;
/** How many recently used keys lead the default view. */
export const RECENTS = 2;
/** A lesson whose maths asks for nothing gets these: the lesson chat handoff's default keys (§4). */
export const FALLBACK_KEYS = ["sqrt", "sq", "times", "brace", "plus", "minus", "div", "eq", "neq", "le", "ge", "paren"] as const;

/** A LaTeX command (without its backslash) → the key that types it. */
export const LATEX_TO_KEY: Readonly<Record<string, string>> = {
  frac: "frac", dfrac: "frac", tfrac: "frac",
  sqrt: "sqrt",
  cap: "inter", cup: "union", in: "in", notin: "notin",
  subset: "subset", subseteq: "subseteq", supset: "subset", nsubseteq: "nsubset", not: "nsubset", nsubset: "nsubset",
  emptyset: "empty", varnothing: "empty",
  times: "times", cdot: "times", div: "div",
  neq: "neq", ne: "neq", equiv: "equiv", le: "le", leq: "le", ge: "ge", geq: "ge", approx: "approx",
  therefore: "therefore",
  angle: "angle", circ: "deg", degree: "deg", perp: "perp", parallel: "par",
  triangle: "tri", cong: "cong", sim: "sim",
  overline: "segment", overrightarrow: "ray", overleftrightarrow: "line", frown: "arc", widehat: "arc",
  pi: "pi", theta: "theta",
  pm: "pm", infty: "inf", propto: "propto", to: "arrow", rightarrow: "arrow", mapsto: "arrow",
  sum: "sum", bar: "mean", sigma: "sigma",
  "%": "pct", "{": "brace",
};

/**
 * LaTeX commands that change how maths LOOKS but need no key: layout, spacing, text, and names the
 * keyboard already types (sin, cos, log). The coverage test fails on any command in neither table, so
 * a new book's notation cannot slip past unnoticed.
 */
export const LATEX_NO_KEY: ReadonlySet<string> = new Set([
  "text", "textbf", "textit", "mathrm", "mathbf", "mathit", "operatorname", "displaystyle", "boxed",
  "left", "right", "big", "Big", "bigg", "Bigg", "quad", "qquad", "space", "hspace", "vspace",
  "overset", "underset", "stackrel", "begin", "end", "hline", "limits", "phantom", "hfill", "newline",
  "sin", "cos", "tan", "log", "ln", "min", "max", "lim",
  "dots", "ldots", "cdots", "vdots", "colon", "mid", "vert",
  "Rightarrow", "leftarrow", "Leftarrow", "leftrightarrow", "Leftrightarrow", "implies", "iff",
  "lt", "gt", "&", "#", "$", "_", "|", "}",
  "mathbb", // handled by its argument, below
  "underline", "hat", "vec", "prime",
  "alpha", "beta", "gamma", "delta", "Delta", "lambda", "mu", "omega", "phi", "rho", "tau",
  "checkmark", "square", "blacksquare", "star", "ast", "bullet", "color", "textcolor",
]);

/** A Unicode sign typed straight into the text → its key. */
export const UNICODE_TO_KEY: Readonly<Record<string, string>> = {
  "∩": "inter", "∪": "union", "∈": "in", "∉": "notin", "⊂": "subset", "⊆": "subseteq", "⊄": "nsubset", "⊈": "nsubset",
  "∅": "empty", "ℝ": "R", "ℤ": "Z", "ℕ": "N", "ℚ": "Q",
  "×": "times", "÷": "div", "√": "sqrt", "≠": "neq", "≤": "le", "≥": "ge", "≈": "approx", "≡": "equiv", "∝": "propto",
  "∴": "therefore", "∠": "angle", "°": "deg", "⊥": "perp", "∥": "par", "△": "tri", "≅": "cong", "∼": "sim",
  "π": "pi", "θ": "theta", "±": "pm", "∞": "inf", "→": "arrow", "Σ": "sum", "σ": "sigma", "²": "sq",
};

const MATHBB: Readonly<Record<string, string>> = { R: "R", Z: "Z", N: "N", Q: "Q" };

/** `\not\in`, `\not\subset`, `\not=`: the negated sign is its own key. */
const NEGATED: Readonly<Record<string, string>> = { "\\in": "notin", "\\subset": "nsubset", "\\subseteq": "nsubset", "=": "neq" };

/** Directives and citations carry ids and JSON, never maths a student reads. */
function stripProtocol(text: string): string {
  return text.replace(/\{\{[\s\S]*?\}\}/g, " ").replace(/\[\[[\s\S]*?\]\]/g, " ");
}

/** The `$…$` / `$$…$$` spans of a text. */
function mathSpans(text: string): string[] {
  return [...text.matchAll(/\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g)].map((m) => m[1] ?? m[2] ?? "");
}

/** Every LaTeX command in a text's maths spans, without its backslash, in order of appearance. */
export function latexCommandsIn(text: string): string[] {
  const out: string[] = [];
  for (const span of mathSpans(stripProtocol(text))) {
    for (const m of span.matchAll(/\\([a-zA-Z]+|.)/g)) out.push(m[1]);
  }
  return out;
}

/**
 * The key ids one text asks for, in order of first appearance. Commands in neither table are ignored
 * here (a student surface must never break on new notation); the coverage test is what catches them.
 */
export function keyIdsIn(text: string): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined) => {
    if (id && BY_ID.has(id) && !ids.includes(id)) ids.push(id);
  };
  const clean = stripProtocol(text);
  for (const span of mathSpans(clean)) {
    const re = /\\(mathbb)\{\s*([A-Za-z])|\\not\s*(\\in|\\subset|\\subseteq|=)|\\([a-zA-Z]+|%|\{)|\^\s*(\{\s*\\circ|\\circ|\{\s*2\s*\}|2)?/g;
    for (const m of span.matchAll(re)) {
      if (m[1]) add(MATHBB[m[2]]);
      else if (m[3]) add(NEGATED[m[3]]);
      else if (m[4]) add(LATEX_TO_KEY[m[4]]);
      // `^{\circ}` is a degree sign; `^2` is squared; any other `^` a power
      else if (m[5]?.includes("circ")) add("deg");
      else if (m[0].startsWith("^")) add(m[5] ? "sq" : "pow");
    }
  }
  for (const ch of clean) add(UNICODE_TO_KEY[ch]);
  return ids;
}

/**
 * The lesson's keys for a set of texts, most relevant first (the tutor's last message before the
 * lesson's questions): read from the maths, so no per-lesson list has to be kept by hand.
 */
export function lessonKeyIds(texts: readonly (string | null | undefined)[]): string[] {
  const ids: string[] = [];
  for (const t of texts) for (const id of t ? keyIdsIn(t) : []) if (!ids.includes(id)) ids.push(id);
  return ids;
}

/**
 * The picker's default view (handoff §3): the last RECENTS keys used, most recent first, then the
 * lesson's, skipping duplicates. Exactly PICKER_SIZE keys: a lesson asking for fewer (or none) is
 * topped up from the fallback list.
 */
export function pickerKeyIds(recents: readonly string[], lessonIds: readonly string[]): string[] {
  const ids: string[] = [];
  for (const id of [...recents.slice(0, RECENTS), ...lessonIds, ...FALLBACK_KEYS]) {
    if (ids.length === PICKER_SIZE) break;
    if (BY_ID.has(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Recents after using `id`: moved to the front, de-duplicated, at most RECENTS. */
export function pushRecent(recents: readonly string[], id: string): string[] {
  return [id, ...recents.filter((r) => r !== id)].slice(0, RECENTS);
}

/**
 * The maths symbol picker's switch. The answer box shows its ∑ only under a tutor message carrying
 * {{expects_math}}; absent means hidden (handoff §2). Used by the maths lesson prompt
 * (`lib/lesson.ts`); the picker is a lesson-chat control (handoff scope).
 */
export const EXPECTS_MATH_RULE = (them: string) =>
  `- {{expects_math}} — a SIGNAL, not an interactive directive (it does not count as the message's one directive): put it alone on its own line at the very end of any message that asks ${them} to TYPE a value, a step, a set or an equation in the chat. It shows ${them} a maths symbol button in the answer box. Leave it out for open questions (how is it going, what next, "got it?") and when the answer goes on a question card or widget.`;

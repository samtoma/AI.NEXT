/**
 * The maths-expression answer marker (FR-4320, contracts/answer-marker.md). Built in-house with no library,
 * behind a pluggable `MarkerEngine` slot: Samuel's call at gate T413, recorded as ADR-0025.
 *
 *   mark(answer, spec) -> correct | incorrect | wrong_form (+ form) | unreadable (+ reason)
 *
 * Marking is server-side and deterministic: no language model, no `eval`/`Function`, no randomness except a
 * fixed-seed PRNG for the sample points, so the same input always gives the same verdict. `api/attempts`
 * calls `mark` through `lib/attempt-grading.ts`, and only for a question whose `choices.marker` is present.
 * The student's input control imports `previewLatex` and `markerInputOf` from here too, so the live preview
 * shows the answer exactly as the marker will read it; it never sees a verdict it could fake.
 *
 * Samuel's marking rules (T413, all confirmed 2026-09-25), and where each lives:
 *  - the form a question asks for is enforced: an equivalent answer in another form is `wrong_form`
 *    (`markExpression`, `markEquation`; the forms are measured against the printed key, §6);
 *  - input the marker cannot read goes back for re-entry and is never marked wrong (`unreadable`);
 *  - `1/2x` goes back for re-entry ("add brackets"), never guessed (`Parser.term`);
 *  - a decimal for an exact value is `wrong_form: exact`, not wrong (`exactOnly`);
 *  - a fraction for a recurring decimal is correct, unless the question asks for a decimal: the pipeline
 *    sets `form: "decimal"` on that question (`isDecimalNumeral`);
 *  - an answer of the wrong shape (a number for an interval) goes back for re-entry, naming the shape;
 *  - notation is normalised, in the answer and the key alike: decimal comma, `(x; y)`, `−`, `×`, units
 *    (`normalise`, `stripUnits`).
 *
 * Shape. Everything a student types goes through ONE front end owned here — decision 15's notation
 * (decimal comma, `(x; y)`, `−`, `×`, implicit multiplication), a tokenizer, and a recursive-descent parser for
 * typed maths and for the LaTeX subset the keys use — into one small AST. The kinds (values, intervals,
 * coordinates, equations, recurring decimals) and the form checks (factorised, expanded, simplest, subject,
 * exact) are structural code over that AST. Only "are these two expressions equal?" is delegated, to a
 * `MarkerEngine`; the built-in engine evaluates both sides at seeded rational points, exactly (BigInt
 * rationals) wherever the expression is rational and in float64 otherwise. A computer-algebra library can be
 * plugged into the same slot; `specs/003-curriculum-tracks/marker-evaluation.md` measures the candidates.
 *
 * A key whose `choices.marker` is absent never reaches this module: numbers and choices keep today's
 * `grade()`, unchanged (FR-C03, SC-212).
 */

// ------------------------------------------------------------------ the contract

export type MarkerKind = "expression" | "equation" | "values" | "interval" | "coordinates" | "surd" | "recurring";
/**
 * The form the question asks for. `"decimal"` is the per-question flag for "write it as a decimal": without
 * it a fraction is a correct answer to a recurring-decimal question (Samuel, T413).
 */
export type MarkerForm = null | "factorised" | "expanded" | "simplest" | "decimal" | { subject: string };

export const MARKER_KINDS: readonly MarkerKind[] = ["expression", "equation", "values", "interval", "coordinates", "surd", "recurring"];

export interface MarkerSpec {
  kind: MarkerKind;
  /** The key, in the marker's canonical LaTeX (written by S3, T337). */
  key: string;
  form?: MarkerForm;
  /** The letters the student may use. Multi-letter names (theta, m_{PR}) are read as one name. */
  variables?: string[];
  /** Numeric kinds only. `null` means exact: a decimal approximation of an exact key is refused. */
  tolerance?: null | { abs: number };
}

export type MarkResult =
  | { result: "correct" }
  | { result: "incorrect" }
  | { result: "wrong_form"; form: string }
  | { result: "unreadable"; reason: string };

/** "Are these two expressions equal for every value of the variables?" */
export interface MarkerEngine {
  name: string;
  equivalent(a: Expr, b: Expr, variables: string[]): boolean;
}

// ------------------------------------------------------------------ AST

export type Expr =
  /** `text` is the numeral as typed (normalised), for the preview; `mixed` marks a mixed number (8 4/5). */
  | { t: "num"; v: Q; text?: string; mixed?: boolean }
  | { t: "var"; name: string }
  | { t: "add"; terms: Expr[] }
  | { t: "mul"; factors: Expr[]; implicit?: boolean }
  | { t: "div"; num: Expr; den: Expr }
  | { t: "pow"; base: Expr; exp: Expr }
  | { t: "neg"; arg: Expr }
  | { t: "fn"; name: "sqrt" | "sin" | "cos" | "tan" | "ln" | "log"; arg: Expr }
  | { t: "const"; name: "pi" }
  | { t: "pm"; arg: Expr }; // ±arg: a two-valued leaf, expanded into branches by `branches()`

/** The KEY could not be read: a content defect (S3 must fix the key), never the student's problem. */
export class MarkerKeyError extends Error {}

class Unreadable extends Error {
  reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

// ------------------------------------------------------------------ exact rationals

// BigInt constants (the app targets ES2017, which has no BigInt literals)
const b0 = BigInt(0);
const b1 = BigInt(1);
const b2 = BigInt(2);
const b3 = BigInt(3);
const b5 = BigInt(5);
const b10 = BigInt(10);
const b37 = BigInt(37);
const b40 = BigInt(40);
const b100 = BigInt(100);
const b200 = BigInt(200);
const b400 = BigInt(400);

export interface Q {
  n: bigint;
  d: bigint;
}
const bgcd = (a: bigint, b: bigint): bigint => {
  a = a < b0 ? -a : a;
  b = b < b0 ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a;
};
export function q(n: bigint, d: bigint = b1): Q {
  if (d === b0) throw new RangeError("division by zero");
  if (d < b0) {
    n = -n;
    d = -d;
  }
  const g = bgcd(n, d) || b1;
  return { n: n / g, d: d / g };
}
const qadd = (a: Q, b: Q) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qmul = (a: Q, b: Q) => q(a.n * b.n, a.d * b.d);
const qdiv = (a: Q, b: Q) => q(a.n * b.d, a.d * b.n);
const qneg = (a: Q) => ({ n: -a.n, d: a.d });
const qeq = (a: Q, b: Q) => a.n === b.n && a.d === b.d;
const qnum = (a: Q) => Number(a.n) / Number(a.d);
const qint = (a: Q) => a.d === b1;
const qnumText = (a: Q) => (a.d === b1 ? String(a.n) : `${a.n}/${a.d}`);
const ZERO = q(b0);
const ONE = q(b1);

function parseDecimal(s: string): Q {
  const [i, f = ""] = s.split(".");
  return q(BigInt((i || "0") + f), b10 ** BigInt(f.length));
}

// ------------------------------------------------------------------ 1. normalisation (decision 15)

const SUPERSCRIPT: Record<string, string> = {
  "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-",
};

/** Unicode and typing variants -> one plain notation. LaTeX is lowered to the same notation first. */
export function normalise(raw: string): string {
  let s = raw.normalize("NFC");
  if (/\\[A-Za-z{}]|\\\\|[\^_]\s*\{/.test(s)) s = fromLatex(s);
  s = s
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅∙✕]/g, "*")
    .replace(/÷/g, "/")
    .replace(/π/g, " pi ")
    .replace(/θ/g, " theta ")
    .replace(/α/g, " alpha ")
    .replace(/β/g, " beta ")
    .replace(/λ/g, " lambda ")
    .replace(/±|\+\/-|\+-/g, " +- ")
    .replace(/≤|=</g, "<=")
    .replace(/≥|=>/g, ">=")
    .replace(/≠|=\/=|<>/g, "!=")
    .replace(/∞|\binfinity\b|\binf\b/gi, " inf ")
    .replace(/∈/g, " in ")
    .replace(/∪/g, " U ")
    .replace(/[ℝ]/g, "R")
    .replace(/[ℤ]/g, "Z")
    .replace(/[ℕ]/g, "N")
    .replace(/[°º]|\^\s*\\?circ|\^\s*o\b/g, "") // an angle's degree sign is notation
    .replace(/√/g, " sqrt ")
    .replace(/∛/g, " cbrt ")
    .replace(/…/g, "...");
  // combining dot above (recurring): 0,2̇1̇ -> 0,2'1'  (the digit before each dot is marked)
  s = s.replace(/(\d)̇/g, "$1'");
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => "^(" + [...m].map((c) => SUPERSCRIPT[c]).join("") + ")");
  return s.replace(/\s+/g, " ").trim();
}

/** The LaTeX the keys use (and a math field emits) -> plain notation. Unknown commands are unreadable. */
function fromLatex(s: string): string {
  let i = 0;
  const out: string[] = [];
  const group = (): string => {
    while (s[i] === " ") i++;
    if (s[i] === "{") {
      let depth = 0;
      const start = i;
      for (; i < s.length; i++) {
        if (s[i] === "\\") {
          i++;
          continue;
        }
        if (s[i] === "{") depth++;
        else if (s[i] === "}" && --depth === 0) {
          i++;
          return fromLatex(s.slice(start + 1, i - 1));
        }
      }
      throw new Unreadable("unbalanced braces");
    }
    if (s[i] === "\\") {
      const m = /^\\([A-Za-z]+)/.exec(s.slice(i));
      if (m) {
        i += m[0].length;
        return fromLatex(m[0]);
      }
    }
    if (i >= s.length) throw new Unreadable("missing argument");
    return s[i++];
  };
  while (i < s.length) {
    const c = s[i];
    if (c !== "\\") {
      if (c === "^" || c === "_") {
        i++;
        const g = group();
        out.push(c === "^" ? `^(${g})` : `_${subName(g)}`);
        continue;
      }
      if (c === "{" ) {
        out.push("(" + group() + ")");
        continue;
      }
      out.push(c);
      i++;
      continue;
    }
    const m = /^\\([A-Za-z]+|.)/.exec(s.slice(i));
    if (!m) throw new Unreadable("stray backslash");
    const name = m[1];
    i += m[0].length;
    switch (name) {
      case "frac":
      case "dfrac":
      case "tfrac": {
        const a = group();
        const b = group();
        // an integer right before an integer fraction is a mixed number: 8\frac{4}{5}
        const prev = out.join("");
        const mixed = /\d\s*$/.test(prev) && /^\s*\d+\s*$/.test(a) && /^\s*\d+\s*$/.test(b);
        out.push(mixed ? ` &${a}/${b}` : `((${a})/(${b}))`);
        break;
      }
      case "sqrt": {
        let idx: string | null = null;
        while (s[i] === " ") i++;
        if (s[i] === "[") {
          const close = s.indexOf("]", i);
          if (close < 0) throw new Unreadable("unclosed root index");
          idx = s.slice(i + 1, close);
          i = close + 1;
        }
        const a = group();
        out.push(idx ? `((${a})^(1/(${idx})))` : `sqrt(${a})`);
        break;
      }
      case "dot": {
        const a = group();
        out.push(`${a}'`);
        break;
      }
      case "overline":
      case "bar": {
        const a = group();
        out.push(`${a}_bar`);
        break;
      }
      case "text":
      case "mathrm":
      case "operatorname": {
        const a = group();
        out.push(` ${a} `);
        break;
      }
      case "mathbb": {
        const a = group();
        out.push(` ${a} `);
        break;
      }
      case "left":
      case "right":
      case "big":
      case "Big":
      case "bigl":
      case "bigr":
        if (s[i] === "\\" && (s[i + 1] === "{" || s[i + 1] === "}")) {
          out.push(s[i + 1]);
          i += 2;
        } else if (s[i] === ".") i++;
        break;
      case "{":
      case "}":
        out.push(name);
        break;
      case ",":
      case ";":
      case "!":
      case " ":
      case "quad":
      case "qquad":
        out.push(" ");
        break;
      case "%":
        break;
      default: {
        const map: Record<string, string> = {
          pi: " pi ", theta: " theta ", alpha: " alpha ", beta: " beta ", lambda: " lambda ",
          times: "*", cdot: "*", div: "/", pm: " +- ", mp: " -+ ", le: "<=", leq: "<=", ge: ">=", geq: ">=",
          ne: "!=", neq: "!=", lt: "<", gt: ">", infty: " inf ", in: " in ", cup: " U ", circ: "", sin: " sin ",
          cos: " cos ", tan: " tan ", ln: " ln ", log: " log ", colon: ":", mid: "|", vert: "|", ldots: "...",
          cdots: "...", dots: "...",
        };
        if (!(name in map)) throw new Unreadable(`unknown command \\${name}`);
        out.push(map[name]);
      }
    }
  }
  return out.join("");
}

// ------------------------------------------------------------------ 2. tokens

type Tok =
  | { k: "num"; v: Q; text: string; recurring?: boolean }
  | { k: "id"; v: string }
  | { k: "op"; v: string }
  | { k: "word"; v: "or" | "and" | "in" | "U" }
  | { k: "set"; v: "R" | "Z" | "N" };

const FUNCS = new Set(["sqrt", "cbrt", "sin", "cos", "tan", "ln", "log"]);
const NAMES = ["theta", "alpha", "beta", "lambda", "pi"];

/**
 * @param variables multi-letter names the spec allows (read whole); every other letter run is split into
 *   single-letter variables, so "4xy" is 4·x·y, never a variable called "xy".
 */
function tokenize(s: string, variables: string[] = []): Tok[] {
  const toks: Tok[] = [];
  const long = variables.filter((v) => v.length > 1).map((v) => v.replace(/[{}]/g, "")).sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " ") {
      i++;
      continue;
    }
    // a recurring decimal with its period in brackets: 0.(21), 4,8(3)
    const per = /^(\d+)[.,](\d*)\((\d+)\)/.exec(s.slice(i));
    if (per) {
      toks.push({ k: "num", v: recurring(per[1], per[2], per[3]), text: per[0], recurring: true });
      i += per[0].length;
      continue;
    }
    // a number: 3.5 ; 10 000 (thousands, SA print) ; a decimal comma between digits ; recurring marks
    if (/[0-9.]/.test(c) && (c !== "." || /[0-9]/.test(s[i + 1] ?? ""))) {
      const m = /^(\d{1,3}(?: \d{3})+(?![\d/])|\d*(?:[.,]\d+(?:')?(?:\d'?)*)?|\d+)((?:\.\.\.)?)/.exec(s.slice(i));
      let text = m && m[0] ? m[1] : "";
      if (!text) {
        const m2 = /^\d+/.exec(s.slice(i))!;
        text = m2[0];
      }
      const ell = s.slice(i + text.length, i + text.length + 3) === "...";
      i += text.length + (ell ? 3 : 0);
      toks.push(numberToken(text, ell));
      continue;
    }
    if (c === "&") {
      // a mixed-number marker from LaTeX: 8&4/5
      toks.push({ k: "op", v: "&" });
      i++;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      // a bracketed subscript typed as text: T_(n-1)
      const subm = /^([A-Za-z])_\(([^()]*)\)/.exec(s.slice(i));
      if (subm) {
        toks.push({ k: "id", v: `${subm[1]}_${subName(subm[2])}` });
        i += subm[0].length;
        continue;
      }
      const run = /^[A-Za-z]+(?:_[A-Za-z0-9]+)?/.exec(s.slice(i))![0];
      const bare = run.replace(/_.*/, "");
      const lower = bare.toLowerCase();
      if (lower === "or" || lower === "and" || lower === "in") {
        toks.push({ k: "word", v: lower as "or" | "and" | "in" });
        i += bare.length;
        continue;
      }
      if (bare === "U" && !variables.includes("U")) {
        toks.push({ k: "word", v: "U" });
        i += 1;
        continue;
      }
      if ((bare === "R" || bare === "Z" || bare === "N") && run === bare && !variables.includes(bare)) {
        const prev = toks[toks.length - 1];
        if (prev && prev.k === "word" && prev.v === "in") {
          toks.push({ k: "set", v: bare });
          i += 1;
          continue;
        }
      }
      if (lower === "inf") {
        toks.push({ k: "id", v: "inf" });
        i += 3;
        continue;
      }
      // split the run: long spec names, function names, Greek names, then single letters
      let j = 0;
      while (j < run.length) {
        const rest = run.slice(j);
        const hit =
          long.find((v) => rest.startsWith(v)) ??
          [...FUNCS].find((f) => rest.toLowerCase().startsWith(f) && j === 0) ??
          NAMES.find((n) => rest.startsWith(n));
        if (hit) {
          toks.push(FUNCS.has(hit) ? { k: "op", v: hit } : { k: "id", v: hit });
          j += hit.length;
          continue;
        }
        if (rest[0] === "_") break;
        // a subscript belongs to the last single letter: m_PR, T_1
        const sub = /^([A-Za-z])(_[A-Za-z0-9]+)/.exec(rest);
        if (sub) {
          const name = sub[1] + sub[2];
          toks.push({ k: "id", v: long.includes(name) ? name : name });
          j += name.length;
          continue;
        }
        toks.push({ k: "id", v: rest[0] });
        j++;
      }
      i += run.length;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (["<=", ">=", "!=", "+-", "-+"].includes(two)) {
      toks.push({ k: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^()[]{}=<>;,:|".includes(c)) {
      toks.push({ k: "op", v: c });
      i++;
      continue;
    }
    throw new Unreadable(`unexpected character "${c}"`);
  }
  return toks;
}

/** A subscript as part of a name: n-1 -> nm1, n+1 -> np1 (so they stay distinct). */
function subName(g: string): string {
  return g.replace(/\s+/g, "").replace(/-/g, "m").replace(/\+/g, "p").replace(/[^A-Za-z0-9]/g, "");
}

function numberToken(text: string, ellipsis: boolean): Tok {
  const t = text.replace(/ /g, "").replace(",", ".");
  if (t.includes("'")) {
    // digits marked ' repeat: the first and last marked digit bound the period
    const [ip, frac] = t.split(".");
    const digits = [...frac.matchAll(/(\d)('?)/g)].map((m) => ({ d: m[1], dot: m[2] === "'" }));
    const marked = digits.map((x, k) => (x.dot ? k : -1)).filter((k) => k >= 0);
    const a = marked[0];
    const b = marked[marked.length - 1];
    const pre = digits.slice(0, a).map((x) => x.d).join("");
    const rep = digits.slice(a, b + 1).map((x) => x.d).join("");
    return { k: "num", v: recurring(ip, pre, rep), text, recurring: true };
  }
  if (ellipsis && t.includes(".")) {
    const [ip, frac] = t.split(".");
    for (let p = 1; p <= Math.floor(frac.length / 2); p++) {
      const block = frac.slice(-p);
      if (frac.slice(-2 * p, -p) === block) {
        let pre = frac;
        while (pre.endsWith(block)) pre = pre.slice(0, -p);
        return { k: "num", v: recurring(ip, pre, block), text: `${text}...`, recurring: true };
      }
    }
    throw new Unreadable("an ellipsis with no repeating block");
  }
  return { k: "num", v: parseDecimal(t), text };
}

function recurring(ip: string, pre: string, rep: string): Q {
  const whole = q(BigInt(ip || "0"));
  const p = b10 ** BigInt(pre.length);
  const head = pre ? q(BigInt(pre), p) : ZERO;
  const tail = q(BigInt(rep), p * (b10 ** BigInt(rep.length) - b1));
  return qadd(qadd(whole, head), tail);
}

// ------------------------------------------------------------------ 3. expression parser

class Parser {
  toks: Tok[];
  i = 0;
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  isOp(v: string, o = 0) {
    const t = this.peek(o);
    return !!t && t.k === "op" && t.v === v;
  }
  eatOp(v: string) {
    if (!this.isOp(v)) throw new Unreadable(`expected "${v}"`);
    this.i++;
  }
  done() {
    return this.i >= this.toks.length;
  }

  /** expr := term (('+'|'-') term)* */
  expr(): Expr {
    const terms: Expr[] = [this.term()];
    while (this.isOp("+") || this.isOp("-") || this.isOp("+-")) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      const t = this.term();
      terms.push(op === "+" ? t : op === "-" ? { t: "neg", arg: t } : { t: "pm", arg: t });
    }
    return terms.length === 1 ? terms[0] : { t: "add", terms };
  }

  /** term := unary (('*'|'/') unary)*  — a '/' whose right side is an implicit product is ambiguous */
  term(): Expr {
    let e = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.peek() as { v: string }).v;
      this.i++;
      const r = this.unary();
      if (op === "/" && r.t === "mul" && r.implicit) {
        // "1/2x": is it 1/(2x) or x/2? Never guessed (Samuel, T413): the student adds brackets.
        throw new Unreadable("ambiguous division: add brackets");
      }
      e = op === "*" ? mulOf(e, r) : { t: "div", num: e, den: r };
    }
    return e;
  }

  unary(): Expr {
    if (this.isOp("-")) {
      this.i++;
      return { t: "neg", arg: this.unary() };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    if (this.isOp("+-")) {
      this.i++;
      return { t: "pm", arg: this.unary() };
    }
    return this.implicit();
  }

  /** Juxtaposition: 3x, 2(x+1), (a+b)(a-b), 2sqrt3. Binds tighter than explicit '*' and '/'. */
  implicit(): Expr {
    const first = this.power();
    const fs: Expr[] = [first];
    while (this.startsPrimary()) fs.push(this.power());
    return fs.length === 1 ? first : { t: "mul", factors: fs, implicit: true };
  }

  startsPrimary(): boolean {
    const t = this.peek();
    if (!t) return false;
    if (t.k === "num" || (t.k === "id" && t.v !== "inf")) return true;
    if (t.k === "op" && (t.v === "(" || FUNCS.has(t.v))) return true;
    return false;
  }

  power(): Expr {
    const base = this.primary();
    if (this.isOp("^")) {
      this.i++;
      const exp = this.isOp("-") ? (this.i++, { t: "neg", arg: this.power() } as Expr) : this.power();
      return { t: "pow", base, exp };
    }
    return base;
  }

  primary(): Expr {
    const t = this.peek();
    if (!t) throw new Unreadable("the answer ends too early");
    if (t.k === "num") {
      this.i++;
      // a mixed number: "8 4/5" (typed) or 8&4/5 (from LaTeX)
      const n1 = this.peek();
      if (
        qint(t.v) && !t.recurring &&
        ((this.isOp("&") && this.peek(1)?.k === "num") ||
          (n1?.k === "num" && qint(n1.v) && this.isOp("/", 1) && this.peek(2)?.k === "num" && qint((this.peek(2) as { v: Q }).v)))
      ) {
        if (this.isOp("&")) this.i++;
        const a = (this.peek() as { v: Q }).v;
        this.i++;
        this.eatOp("/");
        const b = (this.peek() as { v: Q }).v;
        this.i++;
        const frac = qdiv(a, b);
        return {
          t: "num",
          v: t.v.n < b0 ? qadd(t.v, qneg(frac)) : qadd(t.v, frac),
          text: `${t.text} ${qnumText(a)}/${qnumText(b)}`,
          mixed: true,
        };
      }
      return { t: "num", v: t.v, text: t.text };
    }
    if (t.k === "id") {
      this.i++;
      if (t.v === "pi") return { t: "const", name: "pi" };
      return { t: "var", name: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      this.i++;
      const e = this.expr();
      this.eatOp(")");
      // brackets settle a juxtaposition: 1/(4y^2) is not ambiguous
      return e.t === "mul" && e.implicit ? { t: "mul", factors: e.factors } : e;
    }
    if (t.k === "op" && FUNCS.has(t.v)) {
      this.i++;
      // sqrt takes the next primary only: sqrt3x = sqrt(3)*x ; sqrt(3x) needs brackets
      const arg = this.isOp("(") ? this.primary() : this.power();
      if (t.v === "cbrt") return { t: "pow", base: arg, exp: { t: "div", num: { t: "num", v: ONE }, den: { t: "num", v: q(b3) } } };
      return { t: "fn", name: t.v as "sqrt", arg };
    }
    throw new Unreadable(`unexpected "${"v" in t ? t.v : "?"}"`);
  }
}

function mulOf(a: Expr, b: Expr): Expr {
  const fa = a.t === "mul" && !a.implicit ? a.factors : [a];
  return { t: "mul", factors: [...fa, b] };
}

/** One whole expression, or unreadable. */
export function parseExpression(text: string, variables: string[] = []): Expr {
  const p = new Parser(tokenize(normalise(text), variables));
  if (p.done()) throw new Unreadable("empty answer");
  const e = p.expr();
  if (!p.done()) throw new Unreadable("unexpected input after the answer");
  return e;
}

// ------------------------------------------------------------------ 4. evaluation (the built-in engine)

type Val = Q | number;
const isQ = (v: Val): v is Q => typeof v !== "number";
const toF = (v: Val) => (isQ(v) ? qnum(v) : v);

/** Branch expansion for ± : a list of expressions with no `pm` node. */
export function branches(e: Expr): Expr[] {
  switch (e.t) {
    case "pm":
      return branches(e.arg).flatMap((b) => [b, { t: "neg", arg: b } as Expr]);
    case "add": {
      let acc: Expr[][] = [[]];
      for (const term of e.terms) acc = acc.flatMap((xs) => branches(term).map((b) => [...xs, b]));
      return acc.map((terms) => ({ t: "add", terms }));
    }
    case "mul": {
      let acc: Expr[][] = [[]];
      for (const f of e.factors) acc = acc.flatMap((xs) => branches(f).map((b) => [...xs, b]));
      return acc.map((factors) => ({ t: "mul", factors, implicit: e.implicit }));
    }
    case "div":
      return branches(e.num).flatMap((n) => branches(e.den).map((d) => ({ t: "div", num: n, den: d }) as Expr));
    case "pow":
      return branches(e.base).flatMap((b) => branches(e.exp).map((x) => ({ t: "pow", base: b, exp: x }) as Expr));
    case "neg":
      return branches(e.arg).map((a) => ({ t: "neg", arg: a }));
    case "fn":
      return branches(e.arg).map((a) => ({ t: "fn", name: e.name, arg: a }));
    default:
      return [e];
  }
}

const BIG = b10 ** b400;

export function evaluate(e: Expr, env: Record<string, Val>): Val {
  switch (e.t) {
    case "num":
      return e.v;
    case "const":
      return Math.PI;
    case "var": {
      const v = Object.prototype.hasOwnProperty.call(env, e.name) ? env[e.name] : undefined;
      if (v === undefined) return NaN;
      return v;
    }
    case "neg": {
      const a = evaluate(e.arg, env);
      return isQ(a) ? qneg(a) : -a;
    }
    case "pm":
      return NaN; // branches() first
    case "add": {
      let acc: Val = ZERO;
      for (const t of e.terms) {
        const v = evaluate(t, env);
        acc = isQ(acc) && isQ(v) ? qadd(acc, v) : toF(acc) + toF(v);
      }
      return acc;
    }
    case "mul": {
      let acc: Val = ONE;
      for (const f of e.factors) {
        const v = evaluate(f, env);
        acc = isQ(acc) && isQ(v) ? qmul(acc, v) : toF(acc) * toF(v);
      }
      return acc;
    }
    case "div": {
      const a = evaluate(e.num, env);
      const b = evaluate(e.den, env);
      if (isQ(a) && isQ(b)) return b.n === b0 ? NaN : qdiv(a, b);
      return toF(a) / toF(b);
    }
    case "pow": {
      const b = evaluate(e.base, env);
      const x = evaluate(e.exp, env);
      if (isQ(b) && isQ(x) && qint(x) && (x.n < b0 ? -x.n : x.n) <= b200) {
        const k = x.n < b0 ? -x.n : x.n;
        if (b.n === b0 && x.n < b0) return NaN;
        let n = b1;
        let d = b1;
        for (let j = b0; j < k; j++) {
          n *= b.n;
          d *= b.d;
          if (n > BIG || -n > BIG || d > BIG) return Math.pow(qnum(b), Number(x.n));
        }
        return x.n < b0 ? q(d, n) : q(n, d);
      }
      if (isQ(b) && isQ(x) && x.n === b1 && x.d === b2) return sqrtQ(b);
      return Math.pow(toF(b), toF(x));
    }
    case "fn": {
      const a = evaluate(e.arg, env);
      if (e.name === "sqrt") return isQ(a) ? sqrtQ(a) : Math.sqrt(a);
      const f = toF(a);
      if (e.name === "sin") return Math.sin(f);
      if (e.name === "cos") return Math.cos(f);
      if (e.name === "tan") return Math.tan(f);
      if (e.name === "ln") return Math.log(f);
      return Math.log10(f);
    }
  }
}

function isqrt(n: bigint): bigint | null {
  if (n < b0) return null;
  if (n < b2) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + b1) * (x + b1) <= n) x++;
  return x * x === n ? x : null;
}
function sqrtQ(a: Q): Val {
  if (a.n < b0) return NaN;
  const n = isqrt(a.n);
  const d = isqrt(a.d);
  return n !== null && d !== null ? q(n, d) : Math.sqrt(qnum(a));
}

function valEqual(a: Val, b: Val): boolean {
  if (isQ(a) && isQ(b)) return qeq(a, b);
  const x = toF(a);
  const y = toF(b);
  return Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));
}
const finite = (v: Val) => isQ(v) || Number.isFinite(v);

/** mulberry32: a tiny deterministic PRNG. The seed is fixed, so sample points never change between runs. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function varsOf(e: Expr, acc = new Set<string>()): Set<string> {
  switch (e.t) {
    case "var":
      acc.add(e.name);
      break;
    case "add":
      e.terms.forEach((t) => varsOf(t, acc));
      break;
    case "mul":
      e.factors.forEach((t) => varsOf(t, acc));
      break;
    case "div":
      varsOf(e.num, acc);
      varsOf(e.den, acc);
      break;
    case "pow":
      varsOf(e.base, acc);
      varsOf(e.exp, acc);
      break;
    case "neg":
    case "pm":
    case "fn":
      varsOf(e.arg, acc);
      break;
  }
  return acc;
}

/** Sample points: rationals p/q, p in 3..37 with a random sign, q in 2..9; the same points every run. */
export function samplePoints(vars: string[], count: number, seed = 20260925): Record<string, Val>[] {
  const rnd = prng(seed);
  const pts: Record<string, Val>[] = [];
  for (let k = 0; k < count; k++) {
    const env: Record<string, Val> = Object.create(null); // no prototype: a name can never reach Object.prototype
    for (const v of [...vars].sort()) {
      const p = 3 + Math.floor(rnd() * 35);
      const d = 2 + Math.floor(rnd() * 8);
      const neg = k < 32 && k % 3 === 2 && rnd() < 0.7; // the second half is positive-only
      env[v] = q(BigInt(neg ? -p : p), BigInt(d));
    }
    pts.push(env);
  }
  return pts;
}

/** Equal at every sample point where both sides are defined, and defined at enough of them. */
export const numericEngine: MarkerEngine = {
  name: "built-in (exact rationals + seeded float64)",
  equivalent(a, b, variables) {
    const vars = [...new Set([...variables, ...varsOf(a), ...varsOf(b)])];
    let ok = 0;
    for (const env of samplePoints(vars, 64)) {
      let x: Val, y: Val;
      try {
        x = evaluate(a, env);
        y = evaluate(b, env);
      } catch {
        continue;
      }
      const fx = finite(x) && !Number.isNaN(toF(x));
      const fy = finite(y) && !Number.isNaN(toF(y));
      if (fx !== fy) {
        // defined on one side only: not the same expression (e.g. a stray division by zero)
        if (fx && !fy) return false;
        continue;
      }
      if (!fx) continue;
      if (!valEqual(x, y)) return false;
      ok++;
      if (ok >= 8) return true;
    }
    return ok >= 4;
  },
};

// ------------------------------------------------------------------ 5. polynomials (form checks only)

type Mono = string; // "a^2*b^1", sorted; "" is the constant
type Poly = Map<Mono, Q>;

function monoKey(m: Map<string, number>): Mono {
  return [...m.entries()].filter(([, e]) => e !== 0).sort(([a], [b]) => (a < b ? -1 : 1)).map(([v, e]) => `${v}^${e}`).join("*");
}
function monoParse(k: Mono): Map<string, number> {
  const m = new Map<string, number>();
  if (!k) return m;
  for (const p of k.split("*")) {
    const [v, e] = p.split("^");
    m.set(v, Number(e));
  }
  return m;
}
function padd(a: Poly, b: Poly): Poly {
  const r = new Map(a);
  for (const [k, c] of b) {
    const s = qadd(r.get(k) ?? ZERO, c);
    if (s.n === b0) r.delete(k);
    else r.set(k, s);
  }
  return r;
}
function pmul(a: Poly, b: Poly): Poly {
  let r: Poly = new Map();
  for (const [ka, ca] of a)
    for (const [kb, cb] of b) {
      const m = monoParse(ka);
      for (const [v, e] of monoParse(kb)) m.set(v, (m.get(v) ?? 0) + e);
      r = padd(r, new Map([[monoKey(m), qmul(ca, cb)]]));
    }
  return r;
}
const pconst = (c: Q): Poly => (c.n === b0 ? new Map() : new Map([["", c]]));
const pneg = (a: Poly): Poly => new Map([...a].map(([k, c]) => [k, qneg(c)]));

/** A polynomial (integer exponents >= 0, no division by a non-constant), or null. Constant irrationals
 *  (pi, sqrt(8)) are opaque symbols here: 8πz² and πz² are like terms. */
function toPoly(e: Expr): Poly | null {
  switch (e.t) {
    case "num":
      return pconst(e.v);
    case "var":
      return new Map([[`${e.name}^1`, ONE]]);
    case "const":
      return new Map([["#pi^1", ONE]]);
    case "fn": {
      if (varsOf(e).size) return null;
      const v = toF(evaluate(e, {}));
      return Number.isFinite(v) ? new Map([[`#${e.name}${v.toPrecision(12)}^1`, ONE]]) : null;
    }
    case "neg": {
      const a = toPoly(e.arg);
      return a && pneg(a);
    }
    case "add": {
      let r: Poly = new Map();
      for (const t of e.terms) {
        const p = toPoly(t);
        if (!p) return null;
        r = padd(r, p);
      }
      return r;
    }
    case "mul": {
      let r: Poly = pconst(ONE);
      for (const f of e.factors) {
        const p = toPoly(f);
        if (!p) return null;
        r = pmul(r, p);
      }
      return r;
    }
    case "div": {
      const n = toPoly(e.num);
      const d = toPoly(e.den);
      if (!n || !d || d.size !== 1 || !d.has("")) return null;
      const c = d.get("")!;
      return pmul(n, pconst(qdiv(ONE, c)));
    }
    case "pow": {
      const b = toPoly(e.base);
      const x = constValue(e.exp);
      if (!b || !x || !qint(x) || x.n < b0 || x.n > b40) return null;
      let r: Poly = pconst(ONE);
      for (let j = b0; j < x.n; j++) r = pmul(r, b);
      return r;
    }
    default:
      return null;
  }
}

function constValue(e: Expr): Q | null {
  if (varsOf(e).size) return null;
  try {
    const v = evaluate(e, {});
    return isQ(v) ? v : null;
  } catch {
    return null;
  }
}

function degree(p: Poly): number {
  let d = 0;
  for (const k of p.keys()) d = Math.max(d, [...monoParse(k).values()].reduce((s, e) => s + e, 0));
  return d;
}

/** Integer content of a polynomial with integer coefficients (1 = primitive); null if not integral. */
function content(p: Poly): bigint | null {
  let g = b0;
  for (const c of p.values()) {
    if (!qint(c)) return null;
    g = bgcd(g, c.n);
  }
  return g;
}

/** A rational function N/D by cross-multiplication (no cancellation): its total degree, or null. */
function ratDegree(e: Expr): number | null {
  const r = toRat(e);
  return r ? degree(r.n) + degree(r.d) : null;
}
function toRat(e: Expr): { n: Poly; d: Poly } | null {
  switch (e.t) {
    case "add": {
      let acc: { n: Poly; d: Poly } = { n: new Map(), d: pconst(ONE) };
      for (const t of e.terms) {
        const r = toRat(t);
        if (!r) return null;
        acc = sameDen(acc.d, r.d) ? { n: padd(acc.n, r.n), d: acc.d } : { n: padd(pmul(acc.n, r.d), pmul(r.n, acc.d)), d: pmul(acc.d, r.d) };
      }
      return acc;
    }
    case "mul": {
      let acc: { n: Poly; d: Poly } = { n: pconst(ONE), d: pconst(ONE) };
      for (const f of e.factors) {
        const r = toRat(f);
        if (!r) return null;
        acc = { n: pmul(acc.n, r.n), d: pmul(acc.d, r.d) };
      }
      return acc;
    }
    case "div": {
      const a = toRat(e.num);
      const b = toRat(e.den);
      return a && b ? { n: pmul(a.n, b.d), d: pmul(a.d, b.n) } : null;
    }
    case "neg": {
      const a = toRat(e.arg);
      return a && { n: pneg(a.n), d: a.d };
    }
    case "pow": {
      const x = constValue(e.exp);
      const b = toRat(e.base);
      if (!b || !x || !qint(x) || x.n > b40 || x.n < -b40) return null;
      let n: Poly = pconst(ONE);
      let d: Poly = pconst(ONE);
      const k = x.n < b0 ? -x.n : x.n;
      for (let j = b0; j < k; j++) {
        n = pmul(n, b.n);
        d = pmul(d, b.d);
      }
      return x.n < b0 ? { n: d, d: n } : { n, d };
    }
    default: {
      const p = toPoly(e);
      return p && { n: p, d: pconst(ONE) };
    }
  }
}
function sameDen(a: Poly, b: Poly) {
  if (a.size !== b.size) return false;
  for (const [k, c] of a) {
    const o = b.get(k);
    if (!o || !qeq(o, c)) return false;
  }
  return true;
}

// ------------------------------------------------------------------ 6. form checks (relative to the key)

/** Non-constant factors with multiplicity: (x+1)^2*3x -> [x+1, x+1, x]. Numeric factors are ignored. */
function factorsOf(e: Expr): Expr[] | null {
  if (e.t === "neg") return factorsOf(e.arg);
  if (e.t === "mul") {
    const out: Expr[] = [];
    for (const f of e.factors) {
      const sub = factorsOf(f);
      if (!sub) return null;
      out.push(...sub);
    }
    return out;
  }
  if (e.t === "div") return factorsOf(e.num); // a denominator's factors are not the question
  if (e.t === "pow") {
    const x = constValue(e.exp);
    if (x && qint(x) && x.n > b0 && varsOf(e.base).size) {
      const sub = factorsOf(e.base);
      if (!sub) return null;
      return Array.from({ length: Number(x.n) }, () => sub).flat();
    }
    return varsOf(e).size ? [e] : [];
  }
  if (e.t === "num" || e.t === "const") return [];
  if (e.t === "add") return varsOf(e).size ? [e] : [];
  return [e];
}

function isFactorised(ans: Expr, key: Expr): boolean {
  const fa = factorsOf(ans);
  const fk = factorsOf(key);
  if (!fa || !fk) return false;
  if (fa.length < fk.length) return false;
  // every bracket is primitive: no common factor left inside (2x+2)(x-1). Measured against the key's own.
  const nonPrimitive = (fs: Expr[]) =>
    fs.filter((f) => {
      const p = toPoly(f);
      const c = p && content(p);
      return c !== null && c !== undefined && c > b1 && p!.size > 1;
    }).length;
  return nonPrimitive(fa) <= nonPrimitive(fk);
}

/** A sum of monomials with like terms collected. */
function isExpanded(e: Expr): boolean {
  const terms = e.t === "add" ? e.terms : [e];
  const sigs = new Set<string>();
  for (let t of terms) {
    while (t.t === "neg" || t.t === "pm") t = t.arg;
    if (containsSumInProduct(t)) return false;
    const r = toRat(t);
    if (!r) return true; // not polynomial-like (exponentials, roots): no expansion question to ask
    if (r.n.size !== 1 || r.d.size !== 1) return false;
    const sig = [...r.n.keys()][0] + "/" + [...r.d.keys()][0];
    if (sigs.has(sig)) return false;
    sigs.add(sig);
  }
  return true;
}
function containsSumInProduct(e: Expr): boolean {
  if (e.t === "add") return varsOf(e).size > 0;
  if (e.t === "mul") return e.factors.some(containsSumInProduct);
  if (e.t === "div") return containsSumInProduct(e.num) || containsSumInProduct(e.den);
  if (e.t === "pow") {
    const x = constValue(e.exp);
    return !!x && qint(x) && x.n > b1 && e.base.t === "add";
  }
  if (e.t === "neg") return containsSumInProduct(e.arg);
  return false;
}

function occurrences(e: Expr, acc = new Map<string, number>()): Map<string, number> {
  if (e.t === "var") acc.set(e.name, (acc.get(e.name) ?? 0) + 1);
  else if (e.t === "add") e.terms.forEach((t) => occurrences(t, acc));
  else if (e.t === "mul") e.factors.forEach((t) => occurrences(t, acc));
  else if (e.t === "div") {
    occurrences(e.num, acc);
    occurrences(e.den, acc);
  } else if (e.t === "pow") {
    occurrences(e.base, acc);
    occurrences(e.exp, acc);
  } else if (e.t === "neg" || e.t === "pm" || e.t === "fn") occurrences(e.arg, acc);
  return acc;
}
function hasNumericPower(e: Expr): boolean {
  if (e.t === "pow") return (!varsOf(e.base).size && !varsOf(e.exp).size && e.base.t !== "const") || hasNumericPower(e.base) || hasNumericPower(e.exp);
  if (e.t === "add") return e.terms.some(hasNumericPower);
  if (e.t === "mul") return e.factors.some(hasNumericPower);
  if (e.t === "div") return hasNumericPower(e.num) || hasNumericPower(e.den);
  if (e.t === "neg" || e.t === "fn" || e.t === "pm") return hasNumericPower(e.arg);
  return false;
}
const isSum = (e: Expr): boolean => e.t === "add" || (e.t === "neg" && isSum(e.arg));
const containsSum = (e: Expr): boolean =>
  e.t === "add" ||
  (e.t === "mul" && e.factors.some(containsSum)) ||
  (e.t === "div" && (containsSum(e.num) || containsSum(e.den))) ||
  (e.t === "pow" && (containsSum(e.base) || containsSum(e.exp))) ||
  ((e.t === "neg" || e.t === "fn" || e.t === "pm") && containsSum(e.arg));

/**
 * "Simplest", relative to the key (the book's own printed answer is not always in lowest terms, and it must
 * still be accepted as typed): a one-term key needs a one-term answer that names each variable at most as
 * often as the key does; otherwise the answer, as one fraction, may not have a larger total degree.
 */
function isSimplest(ans: Expr, key: Expr): boolean {
  // a surd in simplest form: no square factor left under a root (√50 for 5√2), no root of a fraction, and no
  // root left in a denominator — each measured against the key, like every other form
  if (unsimplifiedRoots(ans) > unsimplifiedRoots(key)) return false;
  if (rootsInDenominator(ans) > rootsInDenominator(key)) return false;
  if (hasNumericPower(ans) && !hasNumericPower(key)) return false;
  if (hasLikeFactors(ans) && !hasLikeFactors(key)) return false;
  if (!isSum(key) && !containsSum(key)) {
    if (isSum(ans)) return false;
    const oa = occurrences(ans);
    const ok = occurrences(key);
    for (const [v, n] of oa) if (n > (ok.get(v) ?? 0) && (ok.get(v) ?? 0) <= 1) return false;
    const da = ratDegree(ans);
    const dk = ratDegree(key);
    return da === null || dk === null || da <= dk;
  }
  const da = ratDegree(ans);
  const dk = ratDegree(key);
  if (da === null || dk === null) {
    const oa = occurrences(ans);
    const ok = occurrences(key);
    for (const [v, n] of oa) if (n > (ok.get(v) ?? 0)) return false;
    return true;
  }
  return da <= dk;
}

/** Children of a node, for the counting walks below. */
function childrenOf(e: Expr): Expr[] {
  switch (e.t) {
    case "add":
      return e.terms;
    case "mul":
      return e.factors;
    case "div":
      return [e.num, e.den];
    case "pow":
      return [e.base, e.exp];
    case "neg":
    case "pm":
    case "fn":
      return [e.arg];
    default:
      return [];
  }
}
/** √ of a constant with a square factor (√50, √12) or of a fraction (√(1/2)). */
function unsimplifiedRoots(e: Expr): number {
  let n = childrenOf(e).reduce((s, c) => s + unsimplifiedRoots(c), 0);
  if (e.t === "fn" && e.name === "sqrt" && !varsOf(e.arg).size) {
    const v = constValue(e.arg);
    if (v && v.n > b0 && (!qint(v) || hasSquareFactor(v.n))) n++;
  }
  return n;
}
function hasSquareFactor(n: bigint): boolean {
  for (let k = b2, steps = 0; k * k <= n && steps < 100000; k++, steps++) if (n % (k * k) === b0) return true;
  return false;
}
/** Roots left in a denominator: 1/√2 rather than √2/2. */
function rootsInDenominator(e: Expr): number {
  const roots = (x: Expr): number =>
    (x.t === "fn" && x.name === "sqrt" ? 1 : 0) + childrenOf(x).reduce((s, c) => s + roots(c), 0);
  return (e.t === "div" ? roots(e.den) : 0) + childrenOf(e).reduce((s, c) => s + rootsInDenominator(c), 0);
}

/** A product naming the same variable twice as separate factors: a*a, a^2*a^3. */
function hasLikeFactors(e: Expr): boolean {
  if (e.t === "mul") {
    const bases = new Set<string>();
    for (const f of e.factors) {
      const b = f.t === "var" ? f.name : f.t === "pow" && f.base.t === "var" ? f.base.name : null;
      if (b) {
        if (bases.has(b)) return true;
        bases.add(b);
      }
    }
    return e.factors.some(hasLikeFactors);
  }
  if (e.t === "add") return e.terms.some(hasLikeFactors);
  if (e.t === "div") return hasLikeFactors(e.num) || hasLikeFactors(e.den);
  if (e.t === "pow") return hasLikeFactors(e.base);
  if (e.t === "neg" || e.t === "fn" || e.t === "pm") return hasLikeFactors(e.arg);
  return false;
}

/**
 * A numeral typed as a terminating decimal (0.866, 3,5): the only kind of number that can be an approximation.
 * A recurring decimal (0.(3), 0,3̇, 0.333...) is exact, and a fraction or an integer is not a decimal.
 */
function isTerminatingDecimalText(text: string | undefined): boolean {
  return !!text && /\d[.,]\d/.test(text) && !/['(]|\.\.\./.test(text);
}
function hasTerminatingDecimal(e: Expr): boolean {
  if (e.t === "num") return isTerminatingDecimalText(e.text) && !qint(e.v);
  if (e.t === "add") return e.terms.some(hasTerminatingDecimal);
  if (e.t === "mul") return e.factors.some(hasTerminatingDecimal);
  if (e.t === "div") return hasTerminatingDecimal(e.num) || hasTerminatingDecimal(e.den);
  if (e.t === "pow") return hasTerminatingDecimal(e.base) || hasTerminatingDecimal(e.exp);
  if (e.t === "neg" || e.t === "fn" || e.t === "pm") return hasTerminatingDecimal(e.arg);
  return false;
}
/** The most decimal places any terminating decimal in the answer was typed with. */
function decimalPlaces(e: Expr): number {
  if (e.t === "num") return isTerminatingDecimalText(e.text) ? (/[.,](\d+)/.exec(e.text!)?.[1].length ?? 0) : 0;
  if (e.t === "add") return Math.max(0, ...e.terms.map(decimalPlaces));
  if (e.t === "mul") return Math.max(0, ...e.factors.map(decimalPlaces));
  if (e.t === "div") return Math.max(decimalPlaces(e.num), decimalPlaces(e.den));
  if (e.t === "pow") return Math.max(decimalPlaces(e.base), decimalPlaces(e.exp));
  if (e.t === "neg" || e.t === "fn" || e.t === "pm") return decimalPlaces(e.arg);
  return 0;
}

/** A rational whose decimal expansion stops (its denominator has no prime but 2 and 5). */
function terminates(v: Q): boolean {
  let d = v.d;
  while (d % b2 === b0) d /= b2;
  while (d % b5 === b0) d /= b5;
  return d === b1;
}
/** A constant part of the key whose value no terminating decimal can write: 1/3, x/7. */
function hasNonTerminatingConstant(e: Expr): boolean {
  if (!varsOf(e).size) {
    const v = constValue(e);
    return v !== null && !terminates(v);
  }
  switch (e.t) {
    case "add":
      return e.terms.some(hasNonTerminatingConstant);
    case "mul":
      return e.factors.some(hasNonTerminatingConstant);
    case "div": {
      const d = varsOf(e.den).size ? null : constValue(e.den);
      if (d && d.n !== b0 && !terminates(qdiv(ONE, d))) return true;
      return hasNonTerminatingConstant(e.num) || hasNonTerminatingConstant(e.den);
    }
    case "pow":
      return hasNonTerminatingConstant(e.base);
    case "neg":
    case "pm":
    case "fn":
      return hasNonTerminatingConstant(e.arg);
    default:
      return false;
  }
}
/**
 * A key only an exact answer can match: it holds an irrational (√3, π) or a fraction with no terminating
 * decimal (1/3). A terminating decimal for such a key is an approximation: `wrong_form: exact` (Samuel, T413).
 */
function exactOnly(key: Expr): boolean {
  return !hasTerminatingDecimal(key) && (hasIrrational(key) || hasNonTerminatingConstant(key));
}
/** Whether the key's value is irrational (evaluated at a sample point where it is defined). */
function valueIsIrrational(key: Expr, vars: string[]): boolean {
  for (const env of samplePoints([...new Set([...vars, ...varsOf(key)])], 8)) {
    let v: Val;
    try {
      v = evaluate(key, env);
    } catch {
      continue;
    }
    if (isQ(v)) return false;
    if (Number.isFinite(v)) return true;
  }
  return false;
}
/**
 * The answer is the key rounded: within 1%, or within half a unit of the last decimal place the student
 * typed, at every sample point where both are defined.
 */
function approximately(ans: Expr, key: Expr, vars: string[]): boolean {
  const all = [...new Set([...vars, ...varsOf(ans), ...varsOf(key)])];
  const halfUnit = 0.5 * Math.pow(10, -decimalPlaces(ans));
  let ok = 0;
  for (const env of samplePoints(all, 16)) {
    let x: number, y: number;
    try {
      x = toF(evaluate(ans, env));
      y = toF(evaluate(key, env));
    } catch {
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(x - y) > Math.max(0.01 * Math.abs(y), halfUnit)) return false;
    ok++;
  }
  return ok >= 4;
}
/** Written as a decimal numeral (0.375, 0.(21), 0,2̇1̇, 3): the `decimal` form. Not a fraction, not 8 4/5. */
function isDecimalNumeral(e: Expr): boolean {
  if (e.t === "neg") return isDecimalNumeral(e.arg);
  return e.t === "num" && !e.mixed;
}

function hasIrrational(e: Expr): boolean {
  if (e.t === "fn" || e.t === "const") return true;
  if (e.t === "pow") {
    const x = constValue(e.exp);
    return !x || !qint(x) || hasIrrational(e.base);
  }
  if (e.t === "add") return e.terms.some(hasIrrational);
  if (e.t === "mul") return e.factors.some(hasIrrational);
  if (e.t === "div") return hasIrrational(e.num) || hasIrrational(e.den);
  if (e.t === "neg" || e.t === "pm") return hasIrrational(e.arg);
  return false;
}

// ------------------------------------------------------------------ 7. kinds

const CORRECT: MarkResult = { result: "correct" };
const INCORRECT: MarkResult = { result: "incorrect" };
const wrongForm = (form: string): MarkResult => ({ result: "wrong_form", form });
const isExact = (spec: MarkerSpec) => spec.tolerance === null || spec.tolerance === undefined;

function sameExpr(a: Expr, b: Expr, vars: string[], engine: MarkerEngine): boolean {
  const A = branches(a);
  const B = branches(b);
  if (A.length !== B.length) return false;
  return sameMultiset(A, B, (x, y) => engine.equivalent(x, y, vars));
}

function sameMultiset<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
  if (a.length !== b.length) return false;
  const rest = [...b];
  for (const x of a) {
    const k = rest.findIndex((y) => eq(x, y));
    if (k < 0) return false;
    rest.splice(k, 1);
  }
  return true;
}

function markExpression(answer: string, spec: MarkerSpec, engine: MarkerEngine): MarkResult {
  const vars = spec.variables ?? [];
  const key = parseExpression(spec.key, vars);
  let ans: Expr;
  try {
    ans = parseExpression(answer, vars);
  } catch (err) {
    // a named answer: "sin a = 4/5" typed for the key 4/5 — read the value
    const m = /^[^=]+=([^=]+)$/.exec(normalise(answer));
    if (!m) throw err;
    ans = parseExpression(m[1], vars);
  }
  const exact = isExact(spec);
  const decimalAnswer = hasTerminatingDecimal(ans);
  if (!sameExpr(ans, key, vars, engine)) {
    // a rounded decimal of an exact key (0,866 for √3/2; 0.33 for 1/3): the form is wrong, not the value
    if (exact && decimalAnswer && exactOnly(key) && sameBranches(ans, key, (a, b) => approximately(a, b, vars))) {
      return wrongForm("exact");
    }
    if (!exact && spec.tolerance) {
      const x = toF(evaluate(ans, {}));
      const y = toF(evaluate(key, {}));
      if (Math.abs(x - y) <= spec.tolerance.abs) return CORRECT;
    }
    return INCORRECT;
  }
  // equal to within float precision, but a decimal cannot be an irrational value exactly (0,8660254037844)
  if (exact && decimalAnswer && !hasTerminatingDecimal(key) && valueIsIrrational(key, vars)) return wrongForm("exact");
  const form = spec.form ?? null;
  if (form === "factorised" && !isFactorised(ans, key)) return wrongForm("factorised");
  if (form === "expanded" && isExpanded(key) && !isExpanded(ans)) return wrongForm("expanded");
  if (form === "simplest" && !isSimplest(ans, key)) return wrongForm("simplest");
  if (form === "decimal" && !isDecimalNumeral(ans)) return wrongForm("decimal");
  return CORRECT;
}

/** The two expressions' ± branches pair up under `eq`. */
function sameBranches(a: Expr, b: Expr, eq: (x: Expr, y: Expr) => boolean): boolean {
  return sameMultiset(branches(a), branches(b), eq);
}

// --- top-level splitting (outside brackets) ---
function splitTop(toks: Tok[], isSep: (t: Tok) => boolean): Tok[][] {
  const out: Tok[][] = [[]];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "op" && "([{".includes(t.v)) depth++;
    if (t.k === "op" && ")]}".includes(t.v)) depth--;
    if (depth === 0 && isSep(t)) out.push([]);
    else out[out.length - 1].push(t);
  }
  if (depth !== 0) throw new Unreadable("unbalanced brackets");
  return out;
}
function exprOf(toks: Tok[]): Expr {
  if (!toks.length) throw new Unreadable("an empty part");
  const p = new Parser(toks);
  const e = p.expr();
  if (!p.done()) throw new Unreadable("unexpected input");
  return e;
}
const isOpTok = (t: Tok, v: string) => t.k === "op" && t.v === v;

/** A value element: an expression, a named one (x = 2), a pair ((1, 2), A(1; 2)). */
type Elem = { name: string | null; v: Expr[] };

function parseElements(text: string, vars: string[]): Elem[] {
  let toks = tokenize(normalise(text), vars);
  // a set's braces are dropped: {1; 2; 3}
  if (toks.length >= 2 && isOpTok(toks[0], "{") && isOpTok(toks[toks.length - 1], "}")) toks = toks.slice(1, -1);
  const semi = splitTop(toks, (t) => isOpTok(t, ";")).length > 1;
  const parts = splitTop(toks, (t) => (t.k === "word" && (t.v === "or" || t.v === "and")) || isOpTok(t, ";") || (!semi && isOpTok(t, ",")));
  const out: Elem[] = [];
  for (let p of parts) {
    if (!p.length) continue;
    let name: string | null = null;
    if (p.length > 2 && p[0].k === "id" && isOpTok(p[1], "=")) {
      name = p[0].v;
      p = p.slice(2);
    } else if (p.length > 2 && p[0].k === "id" && isOpTok(p[1], "(") && isOpTok(p[p.length - 1], ")") && /^[A-Z]/.test(p[0].v)) {
      p = p.slice(1); // A(1; 2): the point's name is not marked
    }
    if (isOpTok(p[0], "(") && isOpTok(p[p.length - 1], ")")) {
      const inner = splitTop(p.slice(1, -1), (t) => isOpTok(t, ";") || isOpTok(t, ","));
      if (inner.length === 2) {
        out.push({ name, v: [exprOf(inner[0]), exprOf(inner[1])] });
        continue;
      }
    }
    const e = exprOf(p);
    for (const b of branches(e)) out.push({ name, v: [b] });
  }
  return out;
}

function markValues(answer: string, spec: MarkerSpec, engine: MarkerEngine): MarkResult {
  const vars = spec.variables ?? [];
  const key = parseElements(spec.key, vars);
  let ans = parseElements(answer, vars);
  // decimal comma ambiguity: "2,3" with no ';' is one decimal or two values; take the reading whose shape
  // matches the key (the comma-as-separator reading is tried when the decimal reading has the wrong count)
  if (ans.length !== key.length && !/;/.test(answer) && /\d,\d/.test(answer)) {
    const alt = parseElements(answer.replace(/(\d),(\d)/g, "$1, $2"), vars);
    if (alt.length === key.length) ans = alt;
  }
  const keyNames = new Set(key.map((e) => e.name).filter(Boolean));
  const pairs = (same: (x: Expr, y: Expr) => boolean): [Expr, Expr][] | null => {
    const eq = (a: Elem, b: Elem) =>
      (a.name === null || b.name === null || a.name === b.name || keyNames.size <= 1) &&
      a.v.length === b.v.length &&
      a.v.every((x, k) => same(x, b.v[k]));
    // bare values for a multi-variable key are read in the key's order
    const matched =
      keyNames.size > 1 && ans.every((e) => e.name === null) && ans.length === key.length
        ? ans.every((a, k) => eq(a, key[k]))
          ? ans.map((a, k) => [a, key[k]] as [Elem, Elem])
          : null
        : matchPairs(ans, key, eq);
    return matched && matched.flatMap(([a, b]) => a.v.map((x, k) => [x, b.v[k]] as [Expr, Expr]));
  };
  return partsVerdict(pairs, spec, vars, engine);
}

/** Pair each of `a` with a distinct one of `b` under `eq` (greedy, like `sameMultiset`), or null. */
function matchPairs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [T, T][] | null {
  if (a.length !== b.length) return null;
  const rest = [...b];
  const out: [T, T][] = [];
  for (const x of a) {
    const k = rest.findIndex((y) => eq(x, y));
    if (k < 0) return null;
    out.push([x, rest[k]]);
    rest.splice(k, 1);
  }
  return out;
}

/**
 * The verdict for an answer made of parts (several values, a coordinate pair), given a way to pair its parts
 * with the key's under an equality. Shared so the two kinds cannot drift:
 *  1. paired exactly: correct, unless a decimal stands for an irrational part (0,8660254037844 for √3/2),
 *     which is `wrong_form: exact`, or the question asks for decimals and a part is a fraction;
 *  2. paired only once rounded decimals may stand for exact parts (1.41 for √2, 0.33 for 1/3):
 *     `wrong_form: exact` (Samuel, T413);
 *  3. otherwise incorrect.
 */
function partsVerdict(
  pairs: (same: (x: Expr, y: Expr) => boolean) => [Expr, Expr][] | null,
  spec: MarkerSpec,
  vars: string[],
  engine: MarkerEngine
): MarkResult {
  const exact = isExact(spec);
  const rounded = (x: Expr, y: Expr) => exact && hasTerminatingDecimal(x) && exactOnly(y) && approximately(x, y, vars);
  const equal = pairs((x, y) => engine.equivalent(x, y, vars));
  if (equal) {
    if (exact && equal.some(([x, y]) => hasTerminatingDecimal(x) && !hasTerminatingDecimal(y) && valueIsIrrational(y, vars))) {
      return wrongForm("exact");
    }
    if (spec.form === "decimal" && !equal.every(([x]) => isDecimalNumeral(x))) return wrongForm("decimal");
    return CORRECT;
  }
  const near = exact ? pairs((x, y) => engine.equivalent(x, y, vars) || rounded(x, y)) : null;
  return near && near.some(([x, y]) => !engine.equivalent(x, y, vars)) ? wrongForm("exact") : INCORRECT;
}

function markCoordinates(answer: string, spec: MarkerSpec, engine: MarkerEngine): MarkResult {
  const key = parseElements(spec.key, spec.variables ?? []);
  let ans = parseElements(answer, spec.variables ?? []);
  if (ans.length === 2 && ans.every((e) => e.v.length === 1)) {
    // "2, 3" without brackets
    ans = [{ name: null, v: [ans[0].v[0], ans[1].v[0]] }];
  }
  if (ans.length !== 1 || ans[0].v.length !== 2) {
    // "(2,3)" with a decimal-comma reading: try the pair reading
    const alt = parseElements(answer.replace(/(\d),(\d)/g, "$1, $2"), spec.variables ?? []);
    // anything else is not a pair: one number, or three. The wrong shape goes back for re-entry (T413).
    if (alt.length === 1 && alt[0].v.length === 2) ans = alt;
    else throw new Unreadable("not a coordinate pair");
  }
  const [k] = key;
  const pair = ans[0].v;
  return partsVerdict(
    (same) => (pair.every((x, i) => same(x, k.v[i])) ? pair.map((x, i) => [x, k.v[i]] as [Expr, Expr]) : null),
    spec,
    [],
    engine
  );
}

function markRecurring(answer: string, spec: MarkerSpec, engine: MarkerEngine): MarkResult {
  const key = parseExpression(spec.key);
  const ans = parseExpression(answer);
  if (!engine.equivalent(ans, key, [])) return INCORRECT;
  // the fraction (7/33 for 0,2̇1̇) is correct, unless the question asks for a decimal (T413)
  if (spec.form === "decimal" && !isDecimalNumeral(ans)) return wrongForm("decimal");
  return CORRECT;
}

// --- equations ---
function splitEquation(text: string, vars: string[]): [Expr, Expr] {
  const toks = tokenize(normalise(text), vars);
  const sides = splitTop(toks, (t) => isOpTok(t, "="));
  if (sides.length !== 2) throw new Unreadable(sides.length === 1 ? "not an equation" : "more than one '='");
  return [exprOf(fnName(sides[0])), exprOf(fnName(sides[1]))];
}
/** f(x) on one side of an equation names the dependent variable, as y does. */
function fnName(toks: Tok[]): Tok[] {
  if (toks.length === 4 && toks[0].k === "id" && isOpTok(toks[1], "(") && toks[2].k === "id" && isOpTok(toks[3], ")"))
    return [{ k: "id", v: "y" }];
  return toks;
}
const isVar = (e: Expr, name?: string): e is { t: "var"; name: string } => e.t === "var" && (!name || e.name === name);

function markEquation(answer: string, spec: MarkerSpec, engine: MarkerEngine): MarkResult {
  const vars = spec.variables ?? [];
  const [kl, kr] = splitEquation(spec.key, vars);
  const [al, ar] = splitEquation(answer, vars);
  // the key's explicit form: v = R (or R = v), v not in R
  let v: string | null = null;
  let R: Expr | null = null;
  if (isVar(kl) && !varsOf(kr).has(kl.name)) [v, R] = [kl.name, kr];
  else if (isVar(kr) && !varsOf(kl).has(kr.name)) [v, R] = [kr.name, kl];
  const form = spec.form;
  if (form && typeof form === "object") {
    const s = form.subject;
    let side: Expr | null = null;
    if (isVar(al, s) && !varsOf(ar).has(s)) side = ar;
    else if (isVar(ar, s) && !varsOf(al).has(s)) side = al;
    if (side && R && v === s) return sameExpr(side, R, vars, engine) ? CORRECT : INCORRECT;
    // not solved for the subject: equivalent (wrong form) or not
    return equationEquivalent(al, ar, kl, kr, v, R, vars) ? { result: "wrong_form", form: `subject:${s}` } : INCORRECT;
  }
  return equationEquivalent(al, ar, kl, kr, v, R, vars) ? CORRECT : INCORRECT;
}

/**
 * Same solution set. For an explicit key v = R (each ± branch): the answer holds on v = R and fails just off
 * it. Otherwise: the residuals are proportional (a constant, non-zero ratio).
 */
function equationEquivalent(al: Expr, ar: Expr, kl: Expr, kr: Expr, v: string | null, R: Expr | null, vars: string[]): boolean {
  const fa: Expr = { t: "add", terms: [al, { t: "neg", arg: ar }] };
  const all = [...new Set([...vars, ...varsOf(fa), ...varsOf(kl), ...varsOf(kr)])];
  const brA = branches(fa);
  if (v && R) {
    const others = all.filter((x) => x !== v);
    const RB = branches(R);
    let on = 0;
    let off = 0;
    for (const env of samplePoints(others, 64, 424242)) {
      for (const rb of RB) {
        let val: Val;
        try {
          val = evaluate(rb, env);
        } catch {
          continue;
        }
        if (!finite(val) || Number.isNaN(toF(val))) continue;
        const at = (x: Val) => brA.map((b) => toF(evaluate(b, { ...env, [v]: x })));
        const r0 = at(val);
        const shifted = isQ(val) ? qadd(val, q(b37, b100)) : toF(val) + 0.37;
        const r1 = at(shifted);
        if (r0.some(Number.isNaN)) continue;
        const scale = Math.max(1, Math.abs(toF(val)));
        if (!r0.some((r) => Math.abs(r) <= 1e-8 * scale * Math.max(1, ...r1.map(Math.abs)))) return false;
        on++;
        if (r1.every((r) => Math.abs(r) > 1e-8 * scale)) off++;
      }
      if (on >= 12) break;
    }
    // and nothing extra: an explicit answer has as many branches as the key
    return on >= 4 && off >= Math.ceil(on * 0.75) && extraBranchesOk(fa, v, RB);
  }
  const fk: Expr = { t: "add", terms: [kl, { t: "neg", arg: kr }] };
  let ratio: number | null = null;
  let n = 0;
  for (const env of samplePoints(all, 64, 424242)) {
    const x = toF(evaluate(fa, env));
    const y = toF(evaluate(fk, env));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (Math.abs(y) < 1e-12) {
      if (Math.abs(x) > 1e-9) return false;
      continue;
    }
    const r = x / y;
    if (ratio === null) ratio = r;
    else if (Math.abs(r - ratio) > 1e-9 * Math.max(1, Math.abs(ratio))) return false;
    n++;
  }
  return n >= 4 && ratio !== null && Math.abs(ratio) > 1e-12;
}

/** An explicit answer (v = S) must have exactly as many ± branches as the key: "b = √(c²−a²)" holds on one
 *  branch of "b = ±√(c²−a²)" but is a different solution set. */
function extraBranchesOk(fa: Expr, v: string, RB: Expr[]): boolean {
  if (fa.t === "add" && fa.terms.length === 2 && isVar(fa.terms[0], v)) {
    const S = (fa.terms[1] as { arg: Expr }).arg;
    if (S && !varsOf(S).has(v)) return branches(S).length === RB.length;
  }
  return true;
}

// --- intervals ---
type Bound = { v: number; q: Q | null };
type Part = { lo: Bound | null; hi: Bound | null; loOpen: boolean; hiOpen: boolean };
type RealSet = { parts: Part[]; domain: "R" | "Z" | "N" };

const bnum = (e: Expr): Bound => {
  const v = evaluate(e, {});
  return { v: toF(v), q: isQ(v) ? v : null };
};
const bcmp = (a: Bound, b: Bound) => (a.q && b.q ? (qeq(a.q, b.q) ? 0 : qnum(a.q) < qnum(b.q) ? -1 : 1) : Math.abs(a.v - b.v) <= 1e-9 * Math.max(1, Math.abs(a.v)) ? 0 : a.v < b.v ? -1 : 1);

const FULL: Part = { lo: null, hi: null, loOpen: true, hiOpen: true };

function intersect(a: Part[], b: Part[]): Part[] {
  const out: Part[] = [];
  for (const x of a)
    for (const y of b) {
      let lo = x.lo, loOpen = x.loOpen, hi = x.hi, hiOpen = x.hiOpen;
      if (y.lo && (!lo || bcmp(y.lo, lo) > 0 || (bcmp(y.lo, lo) === 0 && y.loOpen))) {
        lo = y.lo;
        loOpen = !lo ? true : bcmp(y.lo, x.lo ?? y.lo) === 0 && x.lo ? x.loOpen || y.loOpen : y.loOpen;
      }
      if (y.hi && (!hi || bcmp(y.hi, hi) < 0 || (bcmp(y.hi, hi) === 0 && y.hiOpen))) {
        hi = y.hi;
        hiOpen = x.hi && bcmp(y.hi, x.hi) === 0 ? x.hiOpen || y.hiOpen : y.hiOpen;
      }
      if (lo && hi && (bcmp(lo, hi) > 0 || (bcmp(lo, hi) === 0 && (loOpen || hiOpen)))) continue;
      out.push({ lo, hi, loOpen, hiOpen });
    }
  return normaliseParts(out);
}
function complementPoint(p: Bound): Part[] {
  return [
    { lo: null, hi: p, loOpen: true, hiOpen: true },
    { lo: p, hi: null, loOpen: true, hiOpen: true },
  ];
}
function normaliseParts(ps: Part[]): Part[] {
  const s = [...ps].sort((a, b) => (!a.lo ? -1 : !b.lo ? 1 : bcmp(a.lo, b.lo) || (a.loOpen === b.loOpen ? 0 : a.loOpen ? 1 : -1)));
  const out: Part[] = [];
  for (const p of s) {
    const last = out[out.length - 1];
    if (last && (!last.hi || (p.lo && (bcmp(p.lo, last.hi) < 0 || (bcmp(p.lo, last.hi) === 0 && !(last.hiOpen && p.loOpen)))) || !p.lo)) {
      if (!last.hi) continue;
      if (!p.hi || bcmp(p.hi, last.hi) > 0) {
        last.hi = p.hi;
        last.hiOpen = p.hiOpen;
      } else if (bcmp(p.hi, last.hi) === 0) last.hiOpen = last.hiOpen && p.hiOpen;
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

function parseSet(text: string, vars: string[]): RealSet {
  let toks = tokenize(normalise(text), vars);
  // set-builder: { x : ... } or { x | ... }
  if (toks.length > 3 && isOpTok(toks[0], "{") && isOpTok(toks[toks.length - 1], "}") && toks[1].k === "id" && (isOpTok(toks[2], ":") || isOpTok(toks[2], "|")))
    toks = toks.slice(3, -1);
  let domain: RealSet["domain"] = "R";
  let parts: Part[] = [FULL];
  const conj = splitTop(toks, (t) => isOpTok(t, ";") || isOpTok(t, ","));
  for (const c of conj) {
    if (!c.length) continue;
    if (c.length === 3 && c[0].k === "id" && c[1].k === "word" && c[1].v === "in" && c[2].k === "set") {
      domain = c[2].v;
      continue;
    }
    parts = intersect(parts, parseUnion(c));
  }
  return { parts, domain };
}

function parseUnion(toks: Tok[]): Part[] {
  const pieces = splitTop(toks, (t) => t.k === "word" && (t.v === "or" || t.v === "U" || t.v === "and"));
  const sets = pieces.map(parsePiece);
  // "x != 2 and x != -1" is a conjunction; ranges joined by and/or/U are a union (the book's own usage)
  const allNe = pieces.every((p) => p.some((t) => isOpTok(t, "!=")));
  if (allNe) return sets.reduce((a, b) => intersect(a, b), [FULL]);
  return normaliseParts(sets.flat());
}

function parsePiece(toks: Tok[]): Part[] {
  // x in <interval>
  if (toks.length > 2 && toks[0].k === "id" && toks[1].k === "word" && toks[1].v === "in") toks = toks.slice(2);
  // interval notation
  const first = toks[0];
  const last = toks[toks.length - 1];
  if (first && last && (isOpTok(first, "(") || isOpTok(first, "[")) && (isOpTok(last, ")") || isOpTok(last, "]"))) {
    const inner = splitTop(toks.slice(1, -1), (t) => isOpTok(t, ";") || isOpTok(t, ","));
    if (inner.length === 2) {
      const lo = inner[0];
      const hi = inner[1];
      const isInf = (ts: Tok[], sign: number) =>
        (ts.length === 1 && ts[0].k === "id" && ts[0].v === "inf" && sign > 0) ||
        (ts.length === 2 && isOpTok(ts[0], sign > 0 ? "+" : "-") && ts[1].k === "id" && ts[1].v === "inf");
      return [
        {
          lo: isInf(lo, -1) ? null : bnum(exprOf(lo)),
          hi: isInf(hi, 1) ? null : bnum(exprOf(hi)),
          loOpen: isOpTok(first, "(") || isInf(lo, -1),
          hiOpen: isOpTok(last, ")") || isInf(hi, 1),
        },
      ];
    }
  }
  // an inequality chain: a < x <= b, x > 3, 3 < x, x != 2
  const segs: Tok[][] = [[]];
  const ops: string[] = [];
  let depth = 0;
  for (const t of toks) {
    if (t.k === "op" && "([".includes(t.v)) depth++;
    if (t.k === "op" && ")]".includes(t.v)) depth--;
    if (depth === 0 && t.k === "op" && ["<", ">", "<=", ">=", "!="].includes(t.v)) {
      ops.push(t.v);
      segs.push([]);
    } else segs[segs.length - 1].push(t);
  }
  if (!ops.length) throw new Unreadable("not an inequality or an interval");
  const isV = (s: Tok[]) => s.length === 1 && s[0].k === "id" && s[0].v !== "inf";
  let parts: Part[] = [FULL];
  for (let k = 0; k < ops.length; k++) {
    const L = segs[k];
    const R = segs[k + 1];
    let op = ops[k];
    let bound: Tok[];
    if (isV(L)) bound = R;
    else if (isV(R)) {
      bound = L;
      op = { "<": ">", ">": "<", "<=": ">=", ">=": "<=", "!=": "!=" }[op]!;
    } else throw new Unreadable("an inequality with no variable");
    if (op === "!=") {
      const e = exprOf(bound);
      for (const b of branches(e)) parts = intersect(parts, complementPoint(bnum(b)));
      continue;
    }
    if (bound.length === 1 && bound[0].k === "id" && bound[0].v === "inf") continue;
    const b = bnum(exprOf(bound));
    const p: Part =
      op === "<" ? { lo: null, hi: b, loOpen: true, hiOpen: true }
      : op === "<=" ? { lo: null, hi: b, loOpen: true, hiOpen: false }
      : op === ">" ? { lo: b, hi: null, loOpen: true, hiOpen: true }
      : { lo: b, hi: null, loOpen: false, hiOpen: true };
    parts = intersect(parts, [p]);
  }
  return parts;
}

function integerise(s: RealSet): Part[] {
  if (s.domain === "R") return s.parts;
  const out: Part[] = [];
  const minN = s.domain === "N" ? 1 : -Infinity;
  for (const p of s.parts) {
    let lo = p.lo ? (p.loOpen ? Math.floor(p.lo.v + 1e-9) + 1 : Math.ceil(p.lo.v - 1e-9)) : -Infinity;
    const hi = p.hi ? (p.hiOpen ? Math.ceil(p.hi.v - 1e-9) - 1 : Math.floor(p.hi.v + 1e-9)) : Infinity;
    lo = Math.max(lo, minN);
    if (lo > hi) continue;
    out.push({
      lo: Number.isFinite(lo) ? { v: lo, q: q(BigInt(lo)) } : null,
      hi: Number.isFinite(hi) ? { v: hi, q: q(BigInt(hi)) } : null,
      loOpen: !Number.isFinite(lo),
      hiOpen: !Number.isFinite(hi),
    });
  }
  return out;
}

/** "x != 2 and x != b": only restrictions. -> the excluded values, or null if the answer is anything else. */
function restrictionsOnly(text: string, vars: string[]): Expr[] | null {
  const toks = tokenize(normalise(text), vars);
  const pieces = splitTop(toks, (t) => (t.k === "word" && (t.v === "and" || t.v === "or")) || isOpTok(t, ";") || isOpTok(t, ","));
  const out: Expr[] = [];
  for (const p of pieces) {
    if (!p.length) continue;
    if (p.length === 3 && p[1].k === "word" && p[1].v === "in" && p[2].k === "set") continue;
    if (p.length < 3 || p[0].k !== "id" || !isOpTok(p[1], "!=")) return null;
    out.push(...branches(exprOf(p.slice(2))));
  }
  return out.length ? out : null;
}

function markInterval(answer: string, spec: MarkerSpec, engine: MarkerEngine = numericEngine): MarkResult {
  const vars = spec.variables ?? [];
  const keyR = restrictionsOnly(spec.key, vars);
  if (keyR && keyR.some((e) => varsOf(e).size)) {
    // restrictions that name other letters (a != b): compared as values, not as a set of reals
    const ansR = restrictionsOnly(answer, vars);
    if (!ansR) return INCORRECT;
    return sameMultiset(ansR, keyR, (x, y) => engine.equivalent(x, y, vars)) ? CORRECT : INCORRECT;
  }
  const key = parseSet(spec.key, vars);
  const ans = parseSet(answer, vars);
  if (key.domain !== ans.domain && ans.domain !== "R") return INCORRECT;
  const kb = key.domain === "R" ? key.parts : integerise(key);
  const ab = key.domain === "R" ? ans.parts : integeriseAs(ans, key.domain);
  if (ab.length !== kb.length) return INCORRECT;
  const compare = (eq: (x: Bound, y: Bound) => boolean) => {
    const same = (x: Bound | null, y: Bound | null) => (x === null ? y === null : y !== null && eq(x, y));
    for (let k = 0; k < ab.length; k++) {
      const x = ab[k];
      const y = kb[k];
      if (!same(x.lo, y.lo) || !same(x.hi, y.hi)) return false;
      if (x.lo && x.loOpen !== y.loOpen) return false;
      if (x.hi && x.hiOpen !== y.hiOpen) return false;
    }
    return true;
  };
  if (compare((x, y) => bcmp(x, y) === 0)) return CORRECT;
  // a rounded decimal for an exact endpoint (x > 1.41 for x > √2): the form is wrong, not the set (T413)
  const bounds = kb.flatMap((p) => [p.lo, p.hi]).filter((b): b is Bound => b !== null);
  const decimals = /\d[.,]\d/.test(normalise(answer)) && !/\d[.,]\d/.test(normalise(spec.key));
  const exactEndpoint = bounds.some((b) => b.q === null || !terminates(b.q));
  const places = Math.max(0, ...[...normalise(answer).matchAll(/\d[.,](\d+)/g)].map((m) => m[1].length));
  const rounded = (x: Bound, y: Bound) => Math.abs(x.v - y.v) <= Math.max(0.01 * Math.abs(y.v), 0.5 * Math.pow(10, -places));
  if (isExact(spec) && decimals && exactEndpoint && compare(rounded)) return wrongForm("exact");
  return INCORRECT;
}
function integeriseAs(s: RealSet, domain: RealSet["domain"]): Part[] {
  return integerise({ parts: s.parts, domain });
}

// ------------------------------------------------------------------ 8. the entry point

const keyChecked = new Map<string, string | null>();

/**
 * A key must be readable, and must mark itself correct. Checked once per key and remembered; the loader
 * (T337) should run it over every key before a course goes live. Returns the problem, or null.
 */
export function validateKey(spec: MarkerSpec, engine: MarkerEngine = numericEngine): string | null {
  const id = JSON.stringify([spec.kind, spec.key, spec.form ?? null, spec.variables ?? []]) + engine.name;
  if (keyChecked.has(id)) return keyChecked.get(id)!;
  keyChecked.set(id, null); // re-entrancy: markInner below marks the key against itself
  let problem: string | null = null;
  try {
    const r = markInner(spec.key, spec, engine);
    if (r.result !== "correct") problem = r.result === "unreadable" ? `unreadable (${r.reason})` : `marks itself ${r.result}`;
  } catch (err) {
    problem = String(err);
  }
  keyChecked.set(id, problem);
  return problem;
}

/**
 * Mark a typed answer against its spec. Anything the marker cannot read in the ANSWER comes back as
 * `unreadable`, for re-entry — it is never recorded as wrong (FR-4320). A key that cannot be read, or that
 * does not mark itself correct, throws `MarkerKeyError`: that is a content defect, not the student's.
 */
export function mark(answer: string, spec: MarkerSpec, engine: MarkerEngine = numericEngine): MarkResult {
  const self = validateKey(spec, engine);
  if (self) throw new MarkerKeyError(`marker key ${JSON.stringify(spec.key)}: ${self}`);
  if (typeof answer !== "string" || !answer.trim()) return { result: "unreadable", reason: "empty answer" };
  if (answer.length > 500) return { result: "unreadable", reason: "too long" };
  return markInner(answer, spec, engine);
}

/** Units a measurement answer may carry, longest first so "min" is never read as "m". */
const UNIT_NAMES = [
  "degrees", "degree", "units", "unit", "hrs", "sec", "min", "rad", "deg",
  "mm", "cm", "dm", "km", "mg", "kg", "ml", "mL", "cl", "ms", "hr", "ha", "m", "g", "L", "s", "h",
];
const UNIT_RE = new RegExp(
  `(\\d|\\)|\\bpi)\\s*(${UNIT_NAMES.join("|")})(?:\\s*\\^\\s*\\(?\\s*[23]\\s*\\)?)?(?![A-Za-z(])(?=\\s*(?:$|[;,)\\]}]|or\\b|and\\b))`,
  "g"
);

/**
 * A unit after a number is notation, like the degree sign: "3√2 cm" is 3√2 (T413). Only where it cannot be
 * a variable: never in an equation, never in an expression that has variables, and never when every letter
 * of the unit is a variable the question declares ("5m" is 5·m when m is one).
 */
export function stripUnits(text: string, spec: Pick<MarkerSpec, "kind" | "variables">): string {
  const declared = spec.variables ?? [];
  if (spec.kind === "equation") return text;
  if ((spec.kind === "expression" || spec.kind === "surd") && declared.length) return text;
  return normalise(text).replace(UNIT_RE, (m, lead: string, unit: string) =>
    [...unit].every((ch) => declared.includes(ch)) ? m : lead
  );
}

/** ± multiplies the branches the marker compares; more than this many is not an answer anyone types. */
const MAX_PLUS_MINUS = 8;

function markInner(answer: string, raw: MarkerSpec, engine: MarkerEngine): MarkResult {
  try {
    answer = stripUnits(answer, raw);
    if ((normalise(answer).match(/\+-|-\+/g) ?? []).length > MAX_PLUS_MINUS) throw new Unreadable("too many ± signs");
    const spec: MarkerSpec = { ...raw, key: stripUnits(raw.key, raw) };
    switch (spec.kind) {
      case "expression":
      case "surd":
        return markExpression(answer, spec, engine);
      case "recurring":
        return markRecurring(answer, spec, engine);
      case "values":
        return markValues(answer, spec, engine);
      case "coordinates":
        return markCoordinates(answer, spec, engine);
      case "equation":
        return markEquation(answer, spec, engine);
      case "interval":
        return markInterval(answer, spec, engine);
    }
  } catch (err) {
    if (err instanceof Unreadable) return { result: "unreadable", reason: err.reason };
    if (err instanceof RangeError) return { result: "unreadable", reason: err.message };
    throw err;
  }
  return { result: "unreadable", reason: "unknown kind" };
}

// ------------------------------------------------------------------ 9. the question's spec

const FORM_NAMES = ["factorised", "expanded", "simplest", "decimal"] as const;

/**
 * The marker spec a question carries in `choices.marker` (contract, "Where the answer spec lives"), or null
 * when it carries none: then today's `grade()` marks it, unchanged (FR-C03). A spec that is present but
 * malformed is a content defect, like an unreadable key: it throws `MarkerKeyError`, never "re-enter".
 */
export function readMarkerSpec(choices: unknown): MarkerSpec | null {
  if (!choices || typeof choices !== "object" || Array.isArray(choices)) return null;
  const m = (choices as { marker?: unknown }).marker;
  if (m === undefined || m === null) return null;
  const bad = (why: string) => new MarkerKeyError(`marker spec: ${why}`);
  if (typeof m !== "object" || Array.isArray(m)) throw bad("not an object");
  const { kind, key, form = null, variables = [], tolerance = null } = m as Record<string, unknown>;
  if (!MARKER_KINDS.includes(kind as MarkerKind)) throw bad(`unknown kind ${JSON.stringify(kind)}`);
  if (typeof key !== "string" || !key.trim()) throw bad("no key");
  if (!Array.isArray(variables) || !variables.every((v) => typeof v === "string" && v.length > 0)) throw bad("bad variables");
  if (form !== null) {
    const subject = typeof form === "object" && !Array.isArray(form) ? (form as { subject?: unknown }).subject : undefined;
    if (typeof form === "string" ? !(FORM_NAMES as readonly string[]).includes(form) : typeof subject !== "string" || !subject) {
      throw bad(`unknown form ${JSON.stringify(form)}`);
    }
    if (subject !== undefined && kind !== "equation") throw bad("a subject form needs an equation");
  }
  if (tolerance !== null) {
    const abs = typeof tolerance === "object" ? (tolerance as { abs?: unknown }).abs : undefined;
    if (typeof abs !== "number" || !Number.isFinite(abs) || abs < 0) throw bad("bad tolerance");
  }
  return {
    kind: kind as MarkerKind,
    key,
    form: form as MarkerForm,
    variables: variables as string[],
    tolerance: tolerance as MarkerSpec["tolerance"],
  };
}

/** What the student's input control needs to know about a marked question. Never the key. */
export interface MarkerInput {
  kind: MarkerKind;
  form: MarkerForm;
  variables: string[];
}

/**
 * The input side of a question's marker spec, or null when the question is not marked by the marker (a
 * number, a choice, a widget). Never throws: a malformed spec shows the plain input, and the route refuses it.
 */
export function markerInputOf(q: { questionType: string; choices: unknown }): MarkerInput | null {
  if (q.questionType === "widget" || q.questionType === "mcq") return null;
  try {
    const spec = readMarkerSpec(q.choices);
    return spec && { kind: spec.kind, form: spec.form ?? null, variables: spec.variables ?? [] };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ 10. re-entry messages (student copy)

/** The form's name, as the student is told it (FR-4320: "the student is told which form is asked"). */
export function formLabel(form: string): string {
  if (form.startsWith("subject:")) return `with ${form.slice(8)} as the subject`;
  return (
    { factorised: "factorised", expanded: "expanded", simplest: "in simplest form", exact: "exact", decimal: "as a decimal" }[form] ??
    form
  );
}

/**
 * What the student reads when an answer goes back for re-entry. English, and addressed to "you" so it is
 * gender-neutral (Principle V). A wrong form names the form asked; an unreadable answer says what to fix.
 */
export function reentryMessage(r: { result: "wrong_form"; form: string } | { result: "unreadable"; reason: string }): string {
  if (r.result === "wrong_form") {
    const f = r.form;
    if (f.startsWith("subject:")) {
      const v = f.slice(8);
      return `That's equivalent, but ${v} isn't the subject yet. Rearrange it so it starts "${v} =".`;
    }
    switch (f) {
      case "factorised":
        return "That's equivalent, but the question asks for it factorised. Write it as a product of factors.";
      case "expanded":
        return "That's equivalent, but the question asks for it expanded. Multiply out the brackets and collect like terms.";
      case "simplest":
        return "That's equivalent, but it isn't in its simplest form yet. Simplify it fully.";
      case "exact":
        return "That's a rounded decimal. The question asks for the exact value: keep the √, π or fraction.";
      case "decimal":
        return "That's the right value, but the question asks for it as a decimal.";
      default:
        return `That's equivalent, but the question asks for it ${formLabel(f)}.`;
    }
  }
  const reason = r.reason;
  if (reason === "empty answer") return "Type your answer first.";
  if (reason.startsWith("ambiguous division")) return "Add brackets to show what you're dividing by, like 1/(2x) or (1/2)x.";
  if (reason === "not an equation") return "The answer should be an equation, with an = sign.";
  if (reason === "not an inequality or an interval") return "The answer should be an inequality or an interval, like x > 3 or [-3; 2).";
  if (reason === "not a coordinate pair") return "The answer should be a point, like (2; -1).";
  if (reason === "too long") return "That's too long to be the answer. Check it and try again.";
  return "That can't be read as maths yet. Check the brackets and symbols, then try again.";
}

// ------------------------------------------------------------------ 11. the live preview (LaTeX)

export interface Preview {
  /** KaTeX-ready LaTeX of the answer exactly as the marker reads it, or null while it cannot be read. */
  latex: string | null;
  /** Why it cannot be read yet, in the marker's words (`reentryMessage` turns it into copy). */
  reason: string | null;
}

/**
 * The student's typing as the marker reads it, rendered as LaTeX for the input's live preview: `4xy` shows
 * as 4xy, `x^2+1` as x²+1, `sqrt(3)/2` as a fraction, and `1/2x` as unreadable ("add brackets"). It uses the
 * marker's own reader, so the preview cannot show one thing while the marker reads another. It marks
 * nothing. The output is built from tokens, never from the raw text, so nothing typed reaches KaTeX as-is.
 */
export function previewLatex(text: string, spec: Pick<MarkerSpec, "kind" | "variables">): Preview {
  if (typeof text !== "string" || !text.trim()) return { latex: null, reason: null };
  if (text.length > 500) return { latex: null, reason: "too long" };
  try {
    const toks = tokenize(normalise(stripUnits(text, spec)), spec.variables ?? []);
    return { latex: tokensLatex(toks), reason: null };
  } catch (err) {
    if (err instanceof Unreadable) return { latex: null, reason: err.reason };
    if (err instanceof RangeError) return { latex: null, reason: err.message };
    throw err;
  }
}

const REL_LATEX: Record<string, string> = {
  "=": "=", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge", "!=": "\\ne", ";": ";\\;", ",": ",\\;", ":": ":", "|": "\\mid", "{": "\\{", "}": "\\}",
};
const WORD_LATEX: Record<string, string> = { or: "\\ \\text{or}\\ ", and: "\\ \\text{and}\\ ", U: "\\cup", in: "\\in" };

function isTopSeparator(t: Tok): boolean {
  return t.k === "word" || t.k === "set" || (t.k === "op" && t.v in REL_LATEX);
}
function separatorLatex(t: Tok): string {
  if (t.k === "word") return WORD_LATEX[t.v];
  if (t.k === "set") return `\\mathbb{${t.v}}`;
  return REL_LATEX[(t as { v: string }).v];
}

/** The whole answer: segments between relations and separators, each read as an expression. */
function tokensLatex(toks: Tok[]): string {
  const out: string[] = [];
  let seg: Tok[] = [];
  let depth = 0;
  const flush = () => {
    if (seg.length) out.push(segmentLatex(seg));
    seg = [];
  };
  for (const t of toks) {
    if (t.k === "op" && (t.v === "(" || t.v === "[")) depth++;
    if (t.k === "op" && (t.v === ")" || t.v === "]")) depth--;
    if (depth < 0) throw new Unreadable("unbalanced brackets");
    if (depth === 0 && isTopSeparator(t)) {
      flush();
      out.push(separatorLatex(t));
      continue;
    }
    seg.push(t);
  }
  if (depth !== 0) throw new Unreadable("unbalanced brackets");
  flush();
  return out.join(" ");
}

/** An interval or a pair ((a; b), [a, b), A(1; 2)), or one expression. */
function segmentLatex(seg: Tok[]): string {
  let name = "";
  let body = seg;
  if (body.length > 2 && body[0].k === "id" && /^[A-Z]/.test(body[0].v) && isOpTok(body[1], "(")) {
    name = varLatex(body[0].v);
    body = body.slice(1);
  }
  const first = body[0];
  const last = body[body.length - 1];
  if (body.length > 2 && (isOpTok(first, "(") || isOpTok(first, "[")) && (isOpTok(last, ")") || isOpTok(last, "]"))) {
    const inner = body.slice(1, -1);
    const parts = splitTop(inner, (t) => isOpTok(t, ";") || isOpTok(t, ","));
    if (parts.length >= 2 && closesAtEnd(body)) {
      const sep = inner.some((t) => isOpTok(t, ";")) ? ";\\;" : ",\\;";
      return `${name}${(first as { v: string }).v === "[" ? "[" : "("}${parts.map(partLatex).join(sep)}${
        (last as { v: string }).v === "]" ? "]" : ")"
      }`;
    }
  }
  return name ? name + partLatex(body) : partLatex(seg);
}
/** The opening bracket's match is the last token (so "(a)(b)" is a product, not a pair). */
function closesAtEnd(body: Tok[]): boolean {
  let depth = 0;
  for (let k = 0; k < body.length; k++) {
    const t = body[k];
    if (t.k === "op" && (t.v === "(" || t.v === "[")) depth++;
    if (t.k === "op" && (t.v === ")" || t.v === "]")) depth--;
    if (depth === 0) return k === body.length - 1;
  }
  return false;
}
function partLatex(toks: Tok[]): string {
  if (!toks.length) throw new Unreadable("an empty part");
  const inf = toks[toks.length - 1];
  if (inf.k === "id" && inf.v === "inf") {
    if (toks.length === 1) return "\\infty";
    if (toks.length === 2 && (isOpTok(toks[0], "-") || isOpTok(toks[0], "+"))) return `${(toks[0] as { v: string }).v}\\infty`;
  }
  const p = new Parser(toks);
  const e = p.expr();
  if (!p.done()) throw new Unreadable("unexpected input");
  return toLatex(e);
}

const GREEK = new Set(["theta", "alpha", "beta", "lambda"]);
function varLatex(name: string): string {
  const [base, sub] = name.split("_");
  const b = GREEK.has(base) ? `\\${base} ` : base.length > 1 ? `\\mathit{${base}}` : base;
  return sub ? `${b}_{${sub}}` : b;
}
function numLatex(e: { v: Q; text?: string; mixed?: boolean }): string {
  if (e.mixed && e.text) {
    const m = /^(\d+) (\d+)\/(\d+)$/.exec(e.text.replace(/^-/, ""));
    if (m) return `${e.text.startsWith("-") ? "-" : ""}${m[1]}\\tfrac{${m[2]}}{${m[3]}}`;
  }
  const t = (e.text ?? qnumText(e.v)).replace(",", ".");
  return t
    .replace(/(\d)'/g, "\\dot{$1}")
    .replace(/\.\.\.$/, "\\ldots")
    .replace(/(\d) (?=\d{3})/g, "$1\\,");
}
const atomic = (e: Expr) => e.t === "var" || e.t === "const" || (e.t === "num" && !e.mixed) || (e.t === "fn" && e.name === "sqrt");
const paren = (s: string) => `\\left(${s}\\right)`;

/** The AST as LaTeX. Brackets the parser dropped come back wherever precedence needs them. */
export function toLatex(e: Expr): string {
  switch (e.t) {
    case "num":
      return numLatex(e);
    case "var":
      return varLatex(e.name);
    case "const":
      return "\\pi ";
    case "add":
      return e.terms
        .map((t, i) => {
          if (t.t === "neg") return `${i ? " - " : "-"}${t.arg.t === "add" || t.arg.t === "neg" || t.arg.t === "pm" ? paren(toLatex(t.arg)) : toLatex(t.arg)}`;
          if (t.t === "pm") return `${i ? " \\pm " : "\\pm "}${t.arg.t === "add" ? paren(toLatex(t.arg)) : toLatex(t.arg)}`;
          return `${i ? " + " : ""}${toLatex(t)}`;
        })
        .join("");
    case "mul": {
      const parts = e.factors.map((f) => (f.t === "add" || f.t === "neg" || f.t === "pm" ? paren(toLatex(f)) : toLatex(f)));
      // juxtaposition (2x, 4πr²), with a dot only where a number would run into what precedes it: 2·3, x·2
      const startsWithNumber = (f: Expr): boolean => f.t === "num" || (f.t === "pow" && startsWithNumber(f.base));
      return parts.reduce((s, p, k) => (k && startsWithNumber(e.factors[k]) ? `${s} \\cdot ${p}` : `${s}${k ? " " : ""}${p}`), "");
    }
    case "div":
      return `\\frac{${toLatex(e.num)}}{${toLatex(e.den)}}`;
    case "pow": {
      const x = e.exp;
      if (x.t === "div" && x.num.t === "num" && qeq(x.num.v, ONE) && x.den.t === "num" && qint(x.den.v)) {
        return qeq(x.den.v, q(b2)) ? `\\sqrt{${toLatex(e.base)}}` : `\\sqrt[${qnumText(x.den.v)}]{${toLatex(e.base)}}`;
      }
      const base = atomic(e.base) && !(e.base.t === "fn") ? toLatex(e.base) : paren(toLatex(e.base));
      return `${base}^{${toLatex(x)}}`;
    }
    case "neg":
      return `-${e.arg.t === "add" || e.arg.t === "neg" || e.arg.t === "pm" ? paren(toLatex(e.arg)) : toLatex(e.arg)}`;
    case "pm":
      return `\\pm ${e.arg.t === "add" ? paren(toLatex(e.arg)) : toLatex(e.arg)}`;
    case "fn":
      if (e.name === "sqrt") return `\\sqrt{${toLatex(e.arg)}}`;
      return `\\${e.name}${atomic(e.arg) ? ` ${toLatex(e.arg)}` : paren(toLatex(e.arg))}`;
  }
}

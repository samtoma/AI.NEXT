/**
 * A deterministic arithmetic evaluator for grading numeric answers.
 *
 * Students type steps, not just the final value — "3x4" or "3*4" for a
 * question whose correct_answer is "12". This exists so that grading can
 * recognise the expression evaluates to the right number without a model
 * call on every attempt (cost/latency; see `grade()` in api/attempts/route.ts).
 *
 * Deliberately not `eval`/`Function`: input is whitelisted to arithmetic
 * characters before anything is parsed, and the parser below is the only
 * thing that ever runs on it.
 */

const MULTIPLY_X = /(?<=[0-9)])\s*[xX]\s*(?=[0-9(])/g;

/** Returns the expression's value, or null if `raw` isn't a parseable arithmetic expression. */
export function evaluateArithmeticExpression(raw: string): number | null {
  const normalized = raw
    .trim()
    .replace(/[×✕⋅]/g, "*")
    .replace(/÷/g, "/")
    .replace(MULTIPLY_X, "*");

  // No operator at all: this isn't "steps", it's a bare token — let the
  // caller's own plain-number handling deal with it instead.
  if (!/[+\-*/^]/.test(normalized)) return null;
  if (!/^[0-9+\-*/^().\s]+$/.test(normalized)) return null;

  let i = 0;
  const peek = (): string | undefined => normalized[i];
  const isDigit = (c: string | undefined): boolean => !!c && c >= "0" && c <= "9";
  const skipSpace = () => {
    while (peek() === " ") i++;
  };

  function parseNumber(): number {
    const start = i;
    while (isDigit(peek()) || peek() === ".") i++;
    if (i === start) throw new Error("expected number");
    return parseFloat(normalized.slice(start, i));
  }

  function parsePrimary(): number {
    skipSpace();
    if (peek() === "(") {
      i++;
      const value = parseExpr();
      skipSpace();
      if (peek() !== ")") throw new Error("expected )");
      i++;
      return value;
    }
    return parseNumber();
  }

  function parseUnary(): number {
    skipSpace();
    if (peek() === "-") {
      i++;
      return -parseUnary();
    }
    if (peek() === "+") {
      i++;
      return parseUnary();
    }
    return parsePower();
  }

  function parsePower(): number {
    const base = parsePrimary();
    skipSpace();
    if (peek() === "^") {
      i++;
      return Math.pow(base, parseUnary());
    }
    return base;
  }

  function parseTerm(): number {
    let value = parseUnary();
    skipSpace();
    while (peek() === "*" || peek() === "/") {
      const op = peek();
      i++;
      const rhs = parseUnary();
      value = op === "*" ? value * rhs : value / rhs;
      skipSpace();
    }
    return value;
  }

  function parseExpr(): number {
    let value = parseTerm();
    skipSpace();
    while (peek() === "+" || peek() === "-") {
      const op = peek();
      i++;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
      skipSpace();
    }
    return value;
  }

  try {
    const result = parseExpr();
    skipSpace();
    if (i !== normalized.length) return null;
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

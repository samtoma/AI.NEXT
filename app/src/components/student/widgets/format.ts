/**
 * Number formatting for the widget readouts.
 *
 * A slope of three quarters is "3/4" in this book and on this exam paper, and
 * a live readout that says "0.75" is quietly teaching a different notation
 * from the one the student will be marked in. The readouts are the teaching
 * surface of these widgets — the number under the figure is what the student
 * watches while they drag — so it has to be written the way the syllabus
 * writes it.
 *
 * Decimals are not banned, they are the FALLBACK: a value that is not a small
 * fraction (an irrational hypotenuse, a mean of 6.4) reads better as a
 * decimal, and forcing 271/1250 on it would be worse than useless.
 */

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Unicode minus, so a negative sign is not mistaken for a hyphen mid-line. */
const sign = (s: string) => s.replace("-", "−");

/** Exact fraction for num/den in lowest terms; a bare integer when it divides. */
export function ratioText(num: number, den: number): string {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den === 0)
    return sign(String(Math.round((num / den) * 1000) / 1000));
  const g = gcd(Math.abs(num), Math.abs(den)) || 1;
  const n = num / g;
  const d = den / g;
  // Keep the sign on the numerator; a fraction with a negative denominator is
  // correct arithmetic and bad notation.
  return d === 1 ? sign(String(n)) : d < 0 ? sign(`${-n}/${-d}`) : sign(`${n}/${d}`);
}

/**
 * A number as the syllabus would write it: whole, else a fraction with a
 * denominator up to `maxDen`, else three decimal places.
 */
export function numText(v: number, maxDen = 12): string {
  if (!Number.isFinite(v)) return "—";
  if (Number.isInteger(v)) return sign(String(v));
  for (let d = 2; d <= maxDen; d++) {
    const n = v * d;
    if (Math.abs(n - Math.round(n)) < 1e-9) return ratioText(Math.round(n), d);
  }
  return sign(String(Math.round(v * 1000) / 1000));
}

/**
 * `y = mx + c` with the conventions a marker expects: no "1x", no "+ −3",
 * no "+ 0", and a vertical line written as x = k rather than as a slope of
 * infinity.
 */
export function lineText(m: number | null, c: number, atX?: number): string {
  if (m === null) return `x = ${numText(atX ?? 0)}`;
  if (m === 0) return `y = ${numText(c)}`;
  const mPart = m === 1 ? "x" : m === -1 ? "−x" : `${numText(m)}x`;
  if (c === 0) return `y = ${mPart}`;
  return `y = ${mPart} ${c > 0 ? "+" : "−"} ${numText(Math.abs(c))}`;
}

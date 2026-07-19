/** Mastery color scale: burnt sienna → ochre → viridian, tuned to the ledger palette. */

const LOW: [number, number, number] = [184, 71, 42]; // #b8472a
const MID: [number, number, number] = [207, 146, 39]; // #cf9227
const HIGH: [number, number, number] = [44, 122, 86]; // #2c7a56

function lerp(a: [number, number, number], b: [number, number, number], t: number) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [
    number,
    number,
    number,
  ];
}

export function masteryRgb(score: number): [number, number, number] {
  const s = Math.max(0, Math.min(1, score));
  return s < 0.5 ? lerp(LOW, MID, s / 0.5) : lerp(MID, HIGH, (s - 0.5) / 0.5);
}

export function masteryColor(score: number, alpha = 1): string {
  const [r, g, b] = masteryRgb(score);
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

export function masteryLabel(score: number): string {
  if (score >= 0.75) return "strong";
  if (score >= 0.5) return "developing";
  if (score >= 0.3) return "emerging";
  return "weak";
}

export const pct = (score: number) => `${Math.round(score * 100)}%`;

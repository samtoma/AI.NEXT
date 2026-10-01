/**
 * Short display titles per lesson slug; fallback = the lesson's first objective
 * label. Moved out of `lib/lesson.ts` (2026-10-01) so the skill map can use the
 * same names without importing the lesson module's server dependencies.
 */
export const LESSON_TITLES: Record<string, string> = {
  "u1-1": "Cartesian product",
  "u1-2": "Relations",
  "u1-3": "Functions",
  "u1-4": "Polynomial functions",
  "u2-1": "Ratio",
  "u2-2": "Proportion",
  "u2-3": "Direct and inverse variation",
  "u3-1": "Collecting data and samples",
  "u3-2": "Dispersion and standard deviation",
  "u4-1": "Trigonometric ratios",
  "u4-2": "Special angles and applications",
  "u5-1": "The distance between two points",
  "u5-2": "The midpoint of a segment",
  "u5-3": "The slope of a straight line",
  "u5-4": "The equation of a straight line",
  "geo1-1": "The circle: definitions and chords",
  "geo1-2": "Point, line and circle positions — tangents",
  "geo1-3": "The circumcircle",
  "geo1-4": "Chords and distance from the center",
};

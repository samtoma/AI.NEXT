/**
 * Geometry and grading for `solid_scaler`.
 *
 * Pure, so it is tested without rendering (FR-1208) —
 * `widget-solid-scaler-grade.test.mts`. `SolidScaler.tsx` calls these and
 * writes the words; `widget-emission.test.mts` reads this file as part of
 * that widget.
 *
 * THE QUESTION IS ALWAYS A RATIO, NEVER AN ABSOLUTE NUMBER. The prompt names a
 * multiplier — "make the volume 8 times as large" — and the student drags a
 * SCALE FACTOR k until the live readout hits it. That is deliberate: it makes
 * grading solid-independent (a box's k and a sphere's k answer the same
 * question the same way) and it is what puts the misconception in reach —
 * `volume-scaled-by-k` fires exactly when a student sets k equal to the
 * RATIO itself, the answer that is correct for length but not for volume.
 *
 *   volume   V(k) = V0 · k³.  Set k = ratio (linear) instead of k = ∛ratio.
 *   area     A(k) = A0 · k².  Same mistake, k = ratio instead of k = √ratio —
 *            plus a second failure mode with no cube-vs-linear shape at all:
 *            the k is right but a base face was left out of the reading
 *            (`wrong-formula-part`), which the k alone can never catch, so
 *            the component also reports which faces the student counted.
 *
 * Every one of these solids but the sphere has at least one flat face that a
 * "surface area" reading can leave out — that omission is the single
 * commonest slip in this topic (a cylinder's curved surface with no
 * circles, a cone or pyramid with no base), so `basesIncluded` is a
 * plain boolean the component derives from its own face toggles, not a
 * per-solid enumeration: the geometry differs, the mistake does not.
 */

import { OK } from "@/lib/widget-predicates";

export type SolidKind = "box" | "cylinder" | "cone" | "pyramid" | "sphere";

export interface BoxDims { l: number; w: number; h: number }
export interface CylinderDims { r: number; h: number }
export interface ConeDims { r: number; h: number }
export interface PyramidDims { s: number; h: number } // square base, side s
export interface SphereDims { r: number }

export type SolidDims =
  | BoxDims | CylinderDims | ConeDims | PyramidDims | SphereDims;

/** Every base-solid geometry fact the component reads for its live readout. */
export interface SolidGeometry {
  volume: number;
  /** Full surface area, every face counted. */
  areaTotal: number;
  /** Surface area with exactly the base face(s) left out — the sphere has
   *  none, so its `areaPartial` equals `areaTotal` and the omission simply
   *  cannot happen (`hasBase` says so). */
  areaPartial: number;
  hasBase: boolean;
}

/**
 * `dims` is typed as a plain numeric record, not the `SolidDims` union above:
 * the caller (the payload validator, `parseSolidDims`) already picked the
 * right field set for `solid` and this function reads it by name per branch,
 * so a bag of named numbers is what actually flows from validation through
 * to the component — narrowing it to the union here would only ask every
 * caller to re-assert what the switch below already establishes.
 */
export function solidGeometry(solid: SolidKind, dims: Record<string, number>): SolidGeometry {
  switch (solid) {
    case "box": {
      const { l, w, h } = dims;
      const volume = l * w * h;
      const bases = 2 * l * w; // the two l×w faces
      const sides = 2 * l * h + 2 * w * h;
      return { volume, areaTotal: bases + sides, areaPartial: l * w + sides, hasBase: true };
    }
    case "cylinder": {
      const { r, h } = dims;
      const volume = Math.PI * r * r * h;
      const bases = 2 * Math.PI * r * r;
      const side = 2 * Math.PI * r * h;
      return { volume, areaTotal: bases + side, areaPartial: Math.PI * r * r + side, hasBase: true };
    }
    case "cone": {
      const { r, h } = dims;
      const slant = Math.sqrt(r * r + h * h);
      const volume = (Math.PI * r * r * h) / 3;
      const base = Math.PI * r * r;
      const lateral = Math.PI * r * slant;
      return { volume, areaTotal: base + lateral, areaPartial: lateral, hasBase: true };
    }
    case "pyramid": {
      const { s, h } = dims;
      const slant = Math.sqrt(h * h + (s / 2) ** 2);
      const volume = (s * s * h) / 3;
      const base = s * s;
      const lateral = 2 * s * slant; // four congruent triangular faces
      return { volume, areaTotal: base + lateral, areaPartial: lateral, hasBase: true };
    }
    case "sphere": {
      const { r } = dims;
      const volume = (4 / 3) * Math.PI * r ** 3;
      const area = 4 * Math.PI * r * r;
      return { volume, areaTotal: area, areaPartial: area, hasBase: false };
    }
  }
}

/** The scale slider's own grid — a snap step of 0.5 across a sensible range. */
export const K_MIN = 0.5;
export const K_MAX = 4;
export const K_STEP = 0.5;

/** Is `k` one of the slider's own reachable stops? */
export function isReachableK(k: number): boolean {
  if (k < K_MIN - 1e-9 || k > K_MAX + 1e-9) return false;
  const steps = (k - K_MIN) / K_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** The k the volume-linear misconception would produce for this ratio —
 *  `Number.NaN` reachability is checked by the caller via `isReachableK`. */
export const linearK = (ratio: number): number => ratio;
export const cubeRootK = (ratio: number): number => Math.cbrt(ratio);
export const sqrtK = (ratio: number): number => Math.sqrt(ratio);

export interface ScaleGrade {
  ok: boolean;
  /** `ok`, or one of `solid_scaler`'s predicates. */
  predicate: string;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

/** ask=volume — V(k) = V0·k³, checked against the target RATIO (not an
 *  absolute volume, so this needs no dims at all). */
export function gradeVolumeScale(ratio: number, k: number): ScaleGrade {
  if (near(k ** 3, ratio)) return { ok: true, predicate: OK };
  let pred = "off-target";
  if (near(k, ratio)) pred = "volume-scaled-by-k";
  return { ok: false, predicate: pred };
}

/**
 * ask=area — A(k) = A0·k², AND every face the true total counts must be
 * switched on. `basesIncluded` is the component's own toggle state; a solid
 * with no base at all (`hasBase: false`, the sphere) always passes it.
 */
export function gradeAreaScale(ratio: number, k: number, basesIncluded: boolean): ScaleGrade {
  const kOnTarget = near(k ** 2, ratio);
  if (kOnTarget && basesIncluded) return { ok: true, predicate: OK };
  let pred = "off-target";
  if (near(k, ratio)) pred = "area-scaled-by-k";
  else if (kOnTarget && !basesIncluded) pred = "wrong-formula-part";
  return { ok: false, predicate: pred };
}

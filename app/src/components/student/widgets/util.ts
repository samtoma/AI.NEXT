"use client";

import { useRef } from "react";

/**
 * Shared bits for the social-studies lesson widgets (ADR-0004 Wave 0).
 * Same contract as PairPlotter/ProductBuilder: deterministic client-side
 * grading, `onResult(note)` fired exactly once, notes in English (they feed
 * the AI stream), student-facing copy in Arabic.
 */

/** Deterministic string hash (stable across SSR/CSR — no Math.random). */
export function hashOf(s: string): number {
  let x = 7;
  for (const ch of s) x = (x * 31 + (ch.codePointAt(0) ?? 0)) % 100003;
  return x;
}

/**
 * Deterministic pseudo-shuffle keyed on item content, guaranteed not to be
 * the identity order when there are ≥2 distinct items (a builder widget must
 * never start pre-solved).
 */
export function stableShuffle<T>(items: T[], keyOf: (t: T, i: number) => string): T[] {
  const out = items
    .map((t, i) => ({ t, i, h: hashOf(keyOf(t, i) + ":" + i) }))
    .sort((a, b) => a.h - b.h || a.i - b.i)
    .map((x) => x.t);
  const identity = out.every((t, i) => t === items[i]);
  if (identity && out.length > 1) out.push(out.shift()!);
  return out;
}

/**
 * What a widget reports when it closes: the note for the tutor stream, and
 * whether the student got it right with no wrong step on the way. These
 * widgets let a student self-correct until done, so only a clean run is a
 * right answer for mastery — the first wrong tap is the answer that counts
 * (Tamer, 2026-10-28).
 */
export type WidgetResult = (note: string, firstTry: boolean) => void;

/** onResult must reach the stream exactly once per widget instance. */
export function useFireOnce(onResult: WidgetResult): WidgetResult {
  const fired = useRef(false);
  return (note: string, firstTry: boolean) => {
    if (fired.current) return;
    fired.current = true;
    onResult(note, firstTry);
  };
}

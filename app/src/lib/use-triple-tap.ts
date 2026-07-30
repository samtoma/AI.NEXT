"use client";

import { useCallback, useRef } from "react";

/**
 * The founders' easter egg, extracted so there is ONE of it.
 *
 * Three taps within `windowMs` fire `onTrigger`; a slower tap sequence resets.
 * This is the same interaction that reveals the debug receipts inside a lesson
 * (`LessonSession.tsx`) — deliberately reused rather than re-invented, so the
 * team has a single "hidden demo control" gesture to remember and a student
 * never stumbles onto one by accident.
 *
 * (LessonSession still carries its own inline copy from before this hook
 * existed; it should adopt this once the in-flight subject refactor lands.)
 */
export function useTripleTap(
  onTrigger: () => void,
  windowMs = 900
): () => void {
  const count = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return useCallback(() => {
    count.current += 1;
    if (timer.current) clearTimeout(timer.current);
    if (count.current >= 3) {
      count.current = 0;
      onTrigger();
      return;
    }
    timer.current = setTimeout(() => {
      count.current = 0;
    }, windowMs);
  }, [onTrigger, windowMs]);
}

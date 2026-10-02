"use client";

import { STROKE_WIDTH_SM, VERDICT_INK, cx } from "@/components/sticker";

/**
 * The server sent an answer back for re-entry and recorded nothing (`AttemptRetryError`,
 * `lib/attempts-client.ts`): a choice question's TRUE but less precise option (Samuel's G2 answer 20),
 * or a typed answer the maths marker could not accept (FR-4320). Not a wrong answer — the "partial"
 * verdict ink, never the wrong one — and announced, so a screen reader hears why nothing happened.
 *
 * A typed maths answer shows the same words inside `MathAnswerInput`; this is the note for every other
 * input: the lettered options and a plain typed number.
 */
export function ReentryNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className={cx(
        STROKE_WIDTH_SM,
        VERDICT_INK.partial,
        "mt-2.5 rounded-[var(--play-radius-sm)] px-3 py-2 text-[0.95rem] font-bold"
      )}
    >
      {message}
    </p>
  );
}

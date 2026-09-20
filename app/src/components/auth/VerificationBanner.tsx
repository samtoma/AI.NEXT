"use client";

import { SessionResend } from "./SessionResend";

/**
 * The one thing still outstanding, on every page, until it isn't.
 *
 * Verification gates **learning, not signing in** (Samuel's accepted default,
 * FR-2004): the student is in, can look around, and cannot start a lesson. A
 * banner that persists is the honest way to carry that — the alternative is a
 * modal that has to be dismissed, which either blocks the browsing we just
 * allowed or gets dismissed and forgotten.
 *
 * Honey fill, ink text, ink rule underneath. It is not a warning and must not
 * look like one; there is no red in this palette and this is exactly the state
 * that would otherwise attract it (constitution XII, FR-1002/FR-1005).
 *
 * The resend is **one button and no field**. The endpoint resolves the address
 * from the access cookie, so the banner never asks a student to retype an
 * email the server already holds — and the address still never crosses the
 * wire, which is why `/api/auth/me` can go on not returning it.
 */
export function VerificationBanner() {
  return (
    <div
      className="border-ink"
      style={{
        background: "var(--card-warm)",
        borderBlockEndWidth: "3px",
        borderBlockEndStyle: "solid",
      }}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 px-6 py-3">
        <p className="text-[0.95rem] font-semibold text-ink">
          One thing left: confirm your email and lessons open up.
        </p>

        <SessionResend />
      </div>
    </div>
  );
}

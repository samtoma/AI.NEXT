/**
 * Where to land after signing in — and why this is its own module.
 *
 * Both a Server Component (`/signin` validating `?next=` before it redirects
 * an already-signed-in student) and a client form (validating the same value
 * before `location.assign`) need this rule. A function exported from a
 * `"use client"` module and imported by a Server Component is not a function
 * there — it is a client reference, and calling it fails at runtime. So the
 * rule lives in a module with no directive, which each side bundles or runs on
 * its own terms.
 *
 * The rule itself: `?next=` sits in a link anyone can send, so only same-origin
 * absolute paths are honoured. `//evil.example` and `https://evil.example` are
 * both valid `Location` values that leave this origin, and an open redirect on
 * a **sign-in page** is a credential-phishing primitive, not a cosmetic bug.
 * The backslash form is rejected too: some browsers normalise `/\evil.example`
 * into a protocol-relative URL.
 */
export function safeNext(
  raw: string | null | undefined,
  fallback = "/student"
): string {
  if (!raw) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

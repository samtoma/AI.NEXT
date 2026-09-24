/**
 * Where to land after signing in — and why this is its own module.
 *
 * Both a Server Component (`/signin` and `/signup` validating `?next=` before
 * they redirect an already-signed-in visitor) and a client form (validating the
 * same value before `location.assign`) need this rule. A function exported from
 * a `"use client"` module and imported by a Server Component is not a function
 * there — it is a client reference, and calling it fails at runtime. So the
 * rule lives in a module with no directive, which each side bundles or runs on
 * its own terms.
 *
 * The rule itself (FR-2015): `?next=` sits in a link anyone can send, so only a
 * path on THIS origin is honoured, and anything else lands on `fallback`. An
 * open redirect on a **sign-in page** is a credential-phishing primitive, not
 * a cosmetic bug.
 *
 * **Why it is not a prefix check any more** (security fix, 2026-09-24). The
 * old rule — starts with `/`, not `//`, not `/\` — let `?next=/%09/evil.example`
 * through: the query string decodes it to `/<TAB>/evil.example`, which is none
 * of those, and the browser then STRIPS the tab (the URL standard removes every
 * ASCII tab and newline) and navigates to `//evil.example` — another site. So:
 *
 *   1. refuse anything that is not a single leading `/`;
 *   2. refuse every C0 control, DEL and backslash outright — they are the
 *      characters a browser silently removes or rewrites into `/`, so no
 *      honest in-app path contains one;
 *   3. PARSE it against a placeholder origin and keep only the parsed path,
 *      query and fragment — if the parser says it left the origin, fall back;
 *   4. re-check the parsed RESULT for `//`. Parsing resolves dot segments, so
 *      `/.//evil.example` and `/a/..//evil.example` both come out as
 *      `//evil.example`: a protocol-relative URL that step 1 saw no sign of.
 *      Checking the input alone is how the first draft of this fix still
 *      redirected off-site.
 *
 * The answer is always either `fallback` or a string that starts with exactly
 * one `/`, and `safeNext(safeNext(x)) === safeNext(x)` — the client form
 * re-applies it to what the page already cleaned.
 */
const PLACEHOLDER_ORIGIN = "http://n.invalid";

export function safeNext(
  raw: string | null | undefined,
  fallback = "/student"
): string {
  if (!raw || raw[0] !== "/" || raw.startsWith("//")) return fallback;
  if (/[\u0000-\u001F\u007F\\]/.test(raw)) return fallback;
  let u: URL;
  try {
    u = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (u.origin !== PLACEHOLDER_ORIGIN) return fallback;
  const out = u.pathname + u.search + u.hash;
  if (out[0] !== "/" || out.startsWith("//")) return fallback;
  return out;
}

/**
 * Environment identity for the side-by-side comparison (ADR-0007, FR-901).
 *
 * Two stacks run the same codebase against the same curriculum: the frozen
 * `baseline` (ainext.reletix.com) and the `mvp1` comparison build. Every
 * analytics event and every AI cost row is stamped with which one produced it,
 * because constitution v2.0.0 Principle XI forbids pooling metrics across them.
 *
 * This is read from CONFIGURATION ONLY — never inferred from the request host,
 * a header, or anything a client can influence. A misconfigured stack must
 * produce obviously-wrong data (everything attributed to the wrong environment)
 * rather than quietly-plausible data, because quietly-plausible pooled data is
 * how a comparison silently stops meaning anything.
 */

export type Environment = "baseline" | "mvp1";

const VALID: readonly Environment[] = ["baseline", "mvp1"] as const;

function resolve(): Environment {
  const raw = (process.env.AINEXT_ENVIRONMENT ?? "").trim().toLowerCase();
  if (!raw) return "baseline"; // the frozen stack is the safe default
  if ((VALID as readonly string[]).includes(raw)) return raw as Environment;
  throw new Error(
    `AINEXT_ENVIRONMENT="${raw}" is not one of ${VALID.join(" | ")}. ` +
      `Refusing to start rather than mis-attribute comparison data.`
  );
}

export const ENVIRONMENT: Environment = resolve();

/** True on the comparison build. Use for env-gated behaviour, never for data attribution. */
export const IS_MVP1 = ENVIRONMENT === "mvp1";

/**
 * Whether the INTERNAL surfaces are reachable: `/pipeline`, `/admin/*`,
 * `/gallery` and `/dev/*`.
 *
 * Feedback #10, #11 and #12: a student opening the comparison build was given
 * "Pipeline", "Content" and "Evidence Walk" in the same navigation bar as
 * "Study". Those are an extraction pipeline, a content review queue and a
 * graph explorer — tools for us, listed to a fourteen-year-old.
 *
 * This is NOT a permission system and must not be mistaken for one. Roles need
 * accounts (#7, #8, FR-106, DEFERRED), and until those exist the honest thing
 * is a build-time switch rather than a login-shaped thing that checks nothing.
 * What it does guarantee is that the build a student is handed does not carry
 * the routes at all — they 404, rather than being merely unlinked and one
 * guessed URL away.
 *
 * Default: ON everywhere EXCEPT the comparison build, where it is off unless
 * explicitly enabled. That keeps the existing demo stacks exactly as they are
 * and makes the student-facing build the one that has to opt in — the safe
 * direction for a flag whose failure mode is showing a child the admin tools.
 *
 * `/spine` is deliberately NOT gated here: the lesson report sends students to
 * it ("See it on the graph →") and #15 asks for more of it, not less. What #12
 * actually reported is the *tab*, and the tab is gone.
 */
function resolveInternalSurfaces(): boolean {
  const raw = (process.env.AINEXT_INTERNAL_SURFACES ?? "").trim().toLowerCase();
  if (raw === "on" || raw === "true" || raw === "1") return true;
  if (raw === "off" || raw === "false" || raw === "0") return false;
  return !IS_MVP1;
}

export const INTERNAL_SURFACES: boolean = resolveInternalSurfaces();

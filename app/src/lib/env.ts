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

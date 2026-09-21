import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { OperatorSessions } from "@/components/console/OperatorSessions";
import { currentClaims } from "@/lib/auth/principal";
import { listSessions, withAuthTx } from "@/lib/auth/session";
import { consoleAccess } from "@/lib/console-auth";
import { getOperatorCard } from "@/lib/console-queries";
import { ALL_ROLES, consoleRoute } from "@/lib/console-routes";

/**
 * The operator's own account: who they are, what they hold, where they are
 * signed in, and the way out.
 *
 * Open to **any** operator (contracts/authorization.md's first row), which is
 * what an empty `roles` list in `console-routes.ts` encodes. It reads only the
 * principal's own record — there is no cross-student read on this page and it
 * needs none.
 *
 * **The roles are listed in full, held and not held.** An operator who sees
 * only what they hold cannot tell "this surface does not exist" from "this
 * surface is not mine", and the difference is the one thing they need in order
 * to ask for the right thing. FR-2107 again, from the other side: a hidden link
 * is not a refusal and should not read as one.
 *
 * **There is no control here that grants a role.** No role grants roles this
 * release (ADR-0014): a screen that hands out roles before anyone holds one is
 * a screen that hands out roles to anyone.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "My account — Noor Console" };

const PATH = "/profile";

/** What each role admits, in the product's own words rather than the table's. */
const ROLE_NOTE: Record<string, string> = {
  "content-review":
    "Decides what unreviewed, pipeline-generated content reaches a student. A safety control, not an administrative convenience.",
  "evidence-access": "Extraction provenance, the evidence walk and the rendering harnesses. Reads content, not students.",
  "student-data":
    "A student's record and, from P3, their conversations. The highest privilege here — every read is recorded.",
  "cost-billing": "Spend and commercial status. Reads no student content.",
};

export default async function ConsoleProfilePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const card = await getOperatorCard(access.operatorId);

  // The same read `GET /api/auth/sessions` performs, in the same transaction
  // helper — one query and one rule, rather than a console copy of either. The
  // claims give `sid`, which is what marks the row the operator is using now.
  const claims = await currentClaims();
  const sessions = await withAuthTx((db) =>
    listSessions(db, { operatorId: access.operatorId }, claims?.sid ?? null)
  );

  return (
    <main className="mx-auto w-full max-w-[900px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">My account</p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        {card?.displayName || "Operator"}
      </h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        {card?.email ?? "address unavailable"} ·{" "}
        <span className="font-mono">operator #{access.operatorId}</span>
      </p>

      <section className="mt-6">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          Roles
        </h2>
        <ul className="mt-2 divide-y divide-line-soft rounded-lg border border-line bg-card">
          {ALL_ROLES.map((role) => {
            const held = access.roles.includes(role);
            return (
              <li key={role} className="px-4 py-3">
                <p className="flex items-center gap-2 text-[13px]">
                  <span className="font-mono font-semibold text-ink">{role}</span>
                  <span
                    className={`font-mono text-[10px] uppercase tracking-[0.1em] ${
                      held ? "text-ink" : "text-ink-faint"
                    }`}
                  >
                    {held ? "held" : "not held"}
                  </span>
                </p>
                <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-soft">
                  {ROLE_NOTE[role]}
                </p>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-faint">
          Roles are granted and revoked by hand, and every grant and revocation is recorded. No
          role in this release grants roles.
        </p>
      </section>

      <section className="mt-7">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          Where you are signed in
        </h2>
        <p className="mb-2 mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink-soft">
          Revoking ends that sign-in immediately — within one request, not at the next token
          expiry.
        </p>
        <OperatorSessions sessions={sessions} />
      </section>
    </main>
  );
}

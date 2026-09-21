import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { Chip, Empty, Figure, Panel, Td, Th, stamp } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { getSecurityView, type SecurityView } from "@/lib/security-queries";

/**
 * Security — who tried to get in, and what was refused (contracts/admin.md §7,
 * research A5, ADR-0016 §6, FR-2502, SC-105).
 *
 * `student-data` and nothing else. Six tiles over `auth_events`, a recent-events
 * table, and **the operator-read audit, shown here** — operators see who read
 * whose record, including their own, because an audit nobody can see is an
 * audit nobody checks.
 *
 * **`force-dynamic`, and it is a requirement rather than a preference.** SC-105
 * says a sign-in attempt is visible within sixty seconds of happening. A cached
 * render of this page is a security view showing a past that has already stopped
 * being true, and sixty seconds is shorter than any revalidation window worth
 * configuring — so there is no cache to be wrong.
 *
 * **What is not here.** No message, no transcript, no attempt, no mastery
 * figure: this is the security surface and a child's learning has nothing to do
 * with it. No password material of any kind, which is a property of
 * `auth_events` itself (migration 016) rather than a thing this page avoids
 * printing. And no control that clears a lock, revokes a session or deletes a
 * row — reading is the whole permission, and `ainext_operator` holds no grant
 * that would let this page do otherwise.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Security — Noor Console" };

const PATH = "/security";

export default async function SecurityConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const raw = (await searchParams).event;
  const filter = typeof raw === "string" && raw !== "" ? raw : null;
  const view = await getSecurityView(access.operatorId, filter);
  return <SecurityPage view={view} filter={filter} />;
}

/* --------------------------------------------------------------- format */

const int = (v: number) => Math.round(v).toLocaleString("en-US");

/** `auth_events.event` is a machine name; a column heading is not (FR-2211). */
const EVENT_LABEL: Record<string, string> = {
  successful_login: "Signed in",
  failed_login: "Sign-in failed",
  account_locked: "Account locked",
  lockout_cleared: "Lockout cleared",
  password_changed: "Password changed",
  password_reset_requested: "Password reset asked for",
  password_reset_completed: "Password reset completed",
  email_verification_sent: "Verification mail sent",
  email_verification_succeeded: "Email confirmed",
  session_revoked: "Sign-in session revoked",
  permission_denied: "Refused a surface",
  cross_student_access_denied: "Cross-student access denied",
  operator_login: "Operator signed in",
  admin_transcript_viewed: "Operator read a record",
  suspicious_activity: "Suspicious activity (shadow)",
  oauth_login: "Signed in with Google",
  role_granted: "Role granted",
  role_revoked: "Role revoked",
  failed_signup: "Sign-up refused",
};

const eventLabel = (e: string) => EVENT_LABEL[e] ?? e;

const SURFACE_LABEL: Record<string, string> = {
  student_360: "opened the record",
  session_timeline: "read a session timeline",
  session_replay: "replayed a session",
};

const RULE_LABEL: Record<string, string> = {
  account_lock_burst: "Failures against one account",
  ip_failure_burst: "Failures from one address",
  operator_permission_denied: "An operator refused repeatedly",
  cross_student_access_denied: "Cross-student access denied",
  impossible_travel_shadow: "Suspicious activity (shadow)",
};

/* ----------------------------------------------------------------- page */

function SecurityPage({ view, filter }: { view: SecurityView; filter: string | null }) {
  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {view.environment} environment · live, not cached
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">Security</h1>
      <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-ink-soft">
        Every figure below is read from the sign-in record at the moment you loaded this page, so an
        attempt appears here within a minute of happening. Scoped to this environment only — a count
        that blended the two stacks would describe neither.
      </p>

      <CrossStudentBanner view={view} />

      <Panel
        title="Sign-ins"
        note="Successful and failed attempts on this environment, from the security record."
      >
        <div className="grid gap-5 sm:grid-cols-4">
          <Figure
            label="Signed in"
            value={int(view.signIns.successful24h)}
            unit="attempts"
            period="last 24 hours"
          />
          <Figure
            label="Failed"
            value={int(view.signIns.failed24h)}
            unit="attempts"
            period="last 24 hours"
          />
          <Figure
            label="Signed in"
            value={int(view.signIns.successful7d)}
            unit="attempts"
            period="last 7 days"
          />
          <Figure
            label="Failed"
            value={int(view.signIns.failed7d)}
            unit="attempts"
            period="last 7 days"
          />
        </div>
      </Panel>

      <Panel
        title="Accounts locked right now"
        note={
          <>
            The sign-in path locks an account after {view.thresholds.lock} failures in 15 minutes and
            emits <code className="font-mono text-[12px]">account_locked</code>. This tile reports
            the lock; it does not clear it, and nothing on this page can.
          </>
        }
      >
        {view.locked.length === 0 ? (
          <Empty>No account is locked. That is the ordinary state.</Empty>
        ) : (
          <Table head={["Account", "Status", "Failures", "Locked until", "Reason"]}>
            {view.locked.map((a) => (
              <tr key={a.accountId} className="border-b border-line-soft last:border-0">
                <Td>
                  {a.studentName ?? "no student row"}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">
                    {a.email} #{a.accountId}
                  </span>
                </Td>
                <Td>
                  <Chip tone="attention">{a.accountStatus}</Chip>
                </Td>
                <Td right>{int(a.failedAttempts)}</Td>
                <Td mono>{a.lockedUntil ? stamp(a.lockedUntil) : "—"}</Td>
                <Td mono>{a.reason ?? "not recorded"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Source addresses by failed sign-ins"
        note={
          <>
            Last hour. The throttle refuses an address after {view.thresholds.ip} failures in 15
            minutes; &ldquo;accounts&rdquo; is what separates one student forgetting a password from
            somebody working through a list.
          </>
        }
      >
        {view.topIps.length === 0 ? (
          <Empty>No failed sign-in from any address in the last hour.</Empty>
        ) : (
          <Table head={["Address", "Failures", "Accounts", "Last seen"]}>
            {view.topIps.map((r) => (
              <tr key={r.ip} className="border-b border-line-soft last:border-0">
                <Td mono>{r.ip}</Td>
                <Td right>
                  {int(r.failures)}
                  {r.failures >= view.thresholds.ip ? (
                    <>
                      {" "}
                      <Chip tone="attention">over the throttle</Chip>
                    </>
                  ) : null}
                </Td>
                <Td right>{int(r.distinctAccounts)}</Td>
                <Td mono>{stamp(r.lastAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Sign-in sessions"
        note="Sessions that have neither expired nor been revoked, counted separately for students and operators; revocations include sign-outs, sign-out-everywhere and refresh-token reuse."
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Figure
            label="Students signed in"
            value={int(view.sessions.activeStudentSessions)}
            unit="sessions"
            period="right now"
          />
          <Figure
            label="Operators signed in"
            value={int(view.sessions.activeOperatorSessions)}
            unit="sessions"
            period="right now"
          />
          <Figure
            label="Revoked"
            value={int(view.sessions.revoked7d)}
            unit="sessions"
            period="last 7 days"
          />
        </div>
      </Panel>

      <Panel
        title="Operators refused a surface"
        note={
          <>
            An operator refused {view.thresholds.operator} times in one hour raises an email. Three
            refusals is usually somebody reaching for a surface they were not granted — which is a
            conversation, not an incident.
          </>
        }
      >
        {view.operatorDenials.length === 0 ? (
          <Empty>No operator has been refused a console surface in the last 7 days.</Empty>
        ) : (
          <Table head={["Operator", "Last hour", "Last 7 days", "Most recent", "What they asked for"]}>
            {view.operatorDenials.map((d) => (
              <tr key={d.operatorId} className="border-b border-line-soft last:border-0">
                <Td>
                  {d.operatorName}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">{d.operatorEmail}</span>
                </Td>
                <Td right>
                  {int(d.denials1h)}
                  {d.denials1h >= view.thresholds.operator ? (
                    <>
                      {" "}
                      <Chip tone="attention">alerting</Chip>
                    </>
                  ) : null}
                </Td>
                <Td right>{int(d.denials7d)}</Td>
                <Td mono>{stamp(d.lastAt)}</Td>
                <Td mono>{d.routes.join(" · ")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <RecentEvents view={view} filter={filter} />

      <Panel
        title="Who read whose record"
        note="Every operator read of a student's record, transcript or replay — including your own. Nothing in the console can edit or remove a row here."
      >
        {view.audit.length === 0 ? (
          <Empty>
            No operator has opened a student&rsquo;s record on this environment yet. Your own read is
            written in the same transaction as the page you read, so it appears on the next load.
          </Empty>
        ) : (
          <Table head={["Who", "What they opened", "Whose record", "When"]}>
            {view.audit.map((r, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <Td>
                  {r.operatorName}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">{r.operatorEmail}</span>
                </Td>
                <Td>
                  {SURFACE_LABEL[r.surface] ?? r.surface}
                  {r.sessionId !== null ? (
                    <span className="font-mono text-[11px] text-ink-faint"> session #{r.sessionId}</span>
                  ) : null}
                </Td>
                <Td>
                  <Link
                    href={`/students/${r.studentId}`}
                    className="text-ink underline underline-offset-2"
                  >
                    {r.studentName}
                  </Link>{" "}
                  <span className="font-mono text-[11px] text-ink-faint">#{r.studentId}</span>
                </Td>
                <Td mono>{stamp(r.occurredAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title="Alerts the sweep has sent"
        note="A rule fires once per window, so silence here means nothing new fired — not that nothing is wrong. Written by the sweep and readable but not editable from the console."
      >
        {view.alerts.length === 0 ? (
          <Empty>
            No rule has fired on this environment. The sweep runs from cron every five minutes;
            locally it runs once at the end of <code className="font-mono text-[12px]">local-dev.sh</code>.
          </Empty>
        ) : (
          <Table head={["Rule", "About", "Window", "Delivered", "Sent"]}>
            {view.alerts.map((a, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <Td>{RULE_LABEL[a.rule] ?? a.rule}</Td>
                <Td mono>{a.key}</Td>
                <Td mono>{stamp(a.windowStart)}</Td>
                <Td>
                  <Chip tone={a.delivered === "email" ? "good" : "neutral"}>
                    {a.delivered === "email" ? "emailed" : "logged only"}
                  </Chip>
                </Td>
                <Td mono>{stamp(a.sentAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </main>
  );
}

/* ------------------------------------------------------------ the zero tile */

/**
 * The one threshold at zero (ADR-0016 §6).
 *
 * Rendered as a banner rather than as a figure among the others, because the
 * number it shows should always be nought and a nought in a row of tiles is
 * something a reader's eye slides over. When it is not nought it is either an
 * attack or an application bug that RLS caught, and neither is a tile.
 */
function CrossStudentBanner({ view }: { view: SecurityView }) {
  const n = view.crossStudent.length;
  if (n === 0) {
    return (
      <section className="mt-5 rounded-lg border border-line bg-card px-4 py-3">
        <p className="text-[13px] leading-relaxed text-ink">
          <strong>No cross-student access has been denied</strong> in the last 30 days — which is
          what the row-level policies existing means. Any occurrence at all raises an email
          immediately: the threshold is zero because under RLS the database returns nothing rather
          than another student&rsquo;s rows, so the event can only be an attack or a bug the database
          caught. This line staying as it is <em>is</em> the running proof that the policies work.
        </p>
      </section>
    );
  }
  return (
    <section className="mt-5 rounded-lg border border-gold bg-gold-wash px-4 py-3">
      <p className="text-[13px] font-semibold leading-relaxed text-ink">
        {int(n)} cross-student access {n === 1 ? "denial" : "denials"} in the last 30 days. This
        should be structurally impossible.
      </p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
        Each one is either an attempt or an application bug that the database refused. Each raises an
        email on its own, within the {view.thresholds.crossStudentWindowHours}-hour window it fell
        in.
      </p>
      <ul className="mt-2 space-y-1">
        {view.crossStudent.map((c) => (
          <li key={c.authEventId} className="font-mono text-[11.5px] text-ink-soft">
            #{c.authEventId} · {stamp(c.occurredAt)} · {c.actorKind ?? "unknown"}
            {c.actorId !== null ? ` #${c.actorId}` : ""} · {c.reason ?? "no reason recorded"}
            {c.ip ? ` · ${c.ip}` : ""}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------- recent + filter */

function RecentEvents({ view, filter }: { view: SecurityView; filter: string | null }) {
  return (
    <Panel
      title="The security record"
      note={`The most recent ${view.recent.length} event${
        view.recent.length === 1 ? "" : "s"
      } on this environment${filter ? `, filtered to one kind` : ""}. The reason column is a short machine code by design — it never carries text somebody typed into a form, and never anything about a password.`}
      right={<EventFilter view={view} filter={filter} />}
    >
      {view.recent.length === 0 ? (
        <Empty>
          {filter
            ? "No event of that kind on this environment."
            : "The security record is empty on this environment."}
        </Empty>
      ) : (
        <Table head={["What happened", "Outcome", "Who", "About", "Reason", "Address", "When"]}>
          {view.recent.map((e) => (
            <tr key={e.id} className="border-b border-line-soft last:border-0">
              <Td>{eventLabel(e.event)}</Td>
              <Td>
                {e.outcome ? (
                  <Chip tone={e.outcome === "success" ? "good" : "attention"}>{e.outcome}</Chip>
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {e.actorLabel ?? (e.actorKind ?? "anonymous")}
                {e.actorId !== null ? (
                  <span className="font-mono text-[11px] text-ink-faint"> #{e.actorId}</span>
                ) : null}
              </Td>
              <Td mono>
                {e.subjectKind ?? "—"}
                {e.subjectId !== null ? ` #${e.subjectId}` : ""}
              </Td>
              <Td mono>{e.reason ?? "—"}</Td>
              <Td mono>{e.ip ?? "—"}</Td>
              <Td mono>{stamp(e.occurredAt)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

/**
 * Links, not a `<select>`. The page is a server component with no client
 * JavaScript of its own, and a filter that is a URL is a filter an operator can
 * paste into a message — which is what somebody looking at an incident actually
 * does with it.
 */
function EventFilter({ view, filter }: { view: SecurityView; filter: string | null }) {
  if (view.eventNames.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <FilterLink href="/security" active={filter === null}>
        everything
      </FilterLink>
      {view.eventNames.map((name) => (
        <FilterLink
          key={name}
          href={`/security?event=${encodeURIComponent(name)}`}
          active={filter === name}
        >
          {eventLabel(name)}
        </FilterLink>
      ))}
    </div>
  );
}

function FilterLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`rounded px-2 py-0.5 text-[11.5px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- table */

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-ink-soft">
            {head.map((h) => (
              <Th key={h}>{h}</Th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

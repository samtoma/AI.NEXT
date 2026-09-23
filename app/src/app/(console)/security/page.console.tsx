import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { RuntimeHealthTile } from "@/components/console/RuntimeHealthTile";
import { Chip, Empty, Figure, Panel, Td, Th, stamp } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import {
  AUDIT_LIMIT,
  DEFAULT_WINDOW,
  OUTCOME_FILTER_LABEL,
  OUTCOMES,
  TIME_WINDOWS,
  WINDOW_LABEL,
  getSecurityView,
  parseSecurityFilters,
  type SecurityFilters,
  type SecurityView,
} from "@/lib/security-queries";

/**
 * Security — who tried to get in, and what was refused (contracts/admin.md §7,
 * research A5, ADR-0016 §6, FR-2502, SC-105).
 *
 * `student-data` and nothing else. Six tiles over `auth_events`, **an explorable
 * list**, **the sign-in story**, and **the operator-read audit** — operators
 * see who read whose record, including their own, because an audit nobody can
 * see is an audit nobody checks.
 *
 * **Made explorable on Samuel's own words** ("you need to make the long list
 * easier to use and explore, maybe also add a filter for the who has opened
 * this student's record, and sign in history"). What changed: the list took
 * one filter (event kind); it now takes six (kind, sign-in-story mode, student,
 * operator, outcome, time window) plus real pages instead of a 200-row cliff,
 * the audit gained the same student/operator pair, and the Student 360 links
 * into both — see `parseSecurityFilters` and `getSecurityView` in
 * `lib/security-queries.ts` for the filter vocabulary and why it is a fixed,
 * always-run set of thirteen queries rather than a count that grows with what
 * was clicked.
 *
 * **Every one of those is a URL, never client state** — `FilterLink` below is
 * a `<Link>`, not a `<button onClick>`, because a filter an operator cannot
 * paste into an incident report is a filter that did not happen as far as
 * anyone reading the report later is concerned. This page has no `"use
 * client"` anywhere in its tree for exactly that reason.
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
  const filters = parseSecurityFilters(await searchParams);
  const view = await getSecurityView(access.operatorId, filters);
  return <SecurityPage view={view} />;
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
  tutor_unreachable: "The tutor could not teach",
};

/* ----------------------------------------------------------------- page */

function SecurityPage({ view }: { view: SecurityView }) {
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

      <RuntimeHealthTile
        runtime={view.runtime}
        thresholds={view.runtimeThresholds}
      />

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
            <strong>
              {view.locked.length} account{view.locked.length === 1 ? "" : "s"} locked.
            </strong>{" "}
            The sign-in path locks an account after {view.thresholds.lock} failures in 15 minutes and
            emits <code className="font-mono text-[12px]">account_locked</code>. This tile reports
            the lock; it does not clear it, and nothing on this page can.
          </>
        }
      >
        {view.locked.length === 0 ? (
          <Empty>No account is locked. That is the ordinary state.</Empty>
        ) : (
          <Table
            label="Accounts locked right now"
            head={["Account", "Status", "Failures", "Locked until", "Reason"]}
          >
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
            <strong>
              {view.topIps.length} address{view.topIps.length === 1 ? "" : "es"} in the last hour.
            </strong>{" "}
            The throttle refuses an address after {view.thresholds.ip} failures in 15 minutes;
            &ldquo;accounts&rdquo; is what separates one student forgetting a password from somebody
            working through a list.
          </>
        }
      >
        {view.topIps.length === 0 ? (
          <Empty>No failed sign-in from any address in the last hour.</Empty>
        ) : (
          <Table
            label="Source addresses by failed sign-ins"
            head={["Address", "Failures", "Accounts", "Last seen"]}
          >
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
            <strong>
              {view.operatorDenials.length} operator{view.operatorDenials.length === 1 ? "" : "s"} in
              the last 7 days.
            </strong>{" "}
            An operator refused {view.thresholds.operator} times in one hour raises an email. Three
            refusals is usually somebody reaching for a surface they were not granted — which is a
            conversation, not an incident.
          </>
        }
      >
        {view.operatorDenials.length === 0 ? (
          <Empty>No operator has been refused a console surface in the last 7 days.</Empty>
        ) : (
          <Table
            label="Operators refused a surface"
            head={["Operator", "Last hour", "Last 7 days", "Most recent", "What they asked for"]}
          >
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

      <FiltersBar view={view} />

      <RecentEvents view={view} />

      <Panel title="Who read whose record" note={auditNote(view)}>
        {view.audit.length === 0 ? (
          <Empty>
            {view.filters.student != null || view.filters.operator != null
              ? `No read matches ${[
                  view.filters.student != null ? `student ${view.studentFilterLabel}` : null,
                  view.filters.operator != null ? `operator ${view.operatorFilterLabel}` : null,
                ]
                  .filter(Boolean)
                  .join(" and ")} on this environment. Clear the "Who" filters above to see every read again.`
              : "No operator has opened a student’s record on this environment yet. Your own read is written in the same transaction as the page you read, so it appears on the next load."}
          </Empty>
        ) : (
          <Table
            label="Who read whose record"
            head={["Who", "What they opened", "Whose record", "When"]}
          >
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
        note={`${view.alerts.length} alert${
          view.alerts.length === 1 ? "" : "s"
        } on record. A rule fires once per window, so silence here means nothing new fired — not that nothing is wrong. Written by the sweep and readable but not editable from the console.`}
      >
        {view.alerts.length === 0 ? (
          <Empty>
            No rule has fired on this environment. The sweep runs from cron every five minutes;
            locally it runs once at the end of <code className="font-mono text-[12px]">local-dev.sh</code>.
          </Empty>
        ) : (
          <Table label="Alerts the sweep has sent" head={["Rule", "About", "Window", "Delivered", "Sent"]}>
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

/* ---------------------------------------------------------------- filters */

/**
 * Every link on this page is built here and only here, from the same
 * `SecurityFilters` shape `parseSecurityFilters` reads back — one function
 * turning "the filters in effect, with these changed" into a URL. The
 * alternative — each filter group building its own query string inline — is
 * how a page ends up with one link that forgot to carry the window a reader
 * had chosen and nobody notices until an incident report links to the wrong
 * hour.
 *
 * Changing any filter dimension resets `page` to 1 unless the patch is
 * setting the page itself (`Pager`'s own Prev/Next): a result set that just
 * changed shape has no business assuming page 4 of it still exists, and the
 * one caller that DOES want to keep the current page is the one specifying it.
 */
function hrefFor(filters: SecurityFilters, patch: Partial<SecurityFilters>): string {
  const settingPage = Object.prototype.hasOwnProperty.call(patch, "page");
  const next: SecurityFilters = {
    ...filters,
    ...patch,
    page: settingPage ? (patch.page as number) : 1,
  };

  const params = new URLSearchParams();
  if (next.signins) {
    params.set("signins", "1");
  } else if (next.event) {
    params.set("event", next.event);
  }
  if (next.student != null) params.set("student", String(next.student));
  if (next.operator != null) params.set("operator", String(next.operator));
  if (next.outcome != null) params.set("outcome", next.outcome);
  if (next.window !== DEFAULT_WINDOW) params.set("window", next.window);
  if (next.page > 1) params.set("page", String(next.page));

  const qs = params.toString();
  return qs ? `/security?${qs}` : "/security";
}

/**
 * Plain English for every filter presently narrowing the page — the empty
 * state's "which filters produced it" (deliverable 1) and the audit panel's
 * note both read from this rather than keeping their own account of what is
 * active. The window is always included: it is always narrowing something,
 * even at the default, so leaving it out here would make a reader wonder
 * where last week's events went without being told why.
 */
function describeFilters(view: SecurityView): string[] {
  const f = view.filters;
  const out: string[] = [];
  if (f.signins) out.push("the sign-in story");
  else if (f.event) out.push(`kind “${eventLabel(f.event)}”`);
  if (f.student != null) out.push(`student ${view.studentFilterLabel ?? `#${f.student}`}`);
  if (f.operator != null) out.push(`operator ${view.operatorFilterLabel ?? `#${f.operator}`}`);
  if (f.outcome != null) out.push(`outcome “${OUTCOME_FILTER_LABEL[f.outcome]}”`);
  out.push(WINDOW_LABEL[f.window]);
  return out;
}

/** The audit panel's note, filter-aware without repeating `describeFilters`'s English twice. */
function auditNote({
  filters,
  studentFilterLabel,
  operatorFilterLabel,
  audit,
}: SecurityView): React.ReactNode {
  // The same "true count vs. the cap" distinction `AuditPanel.tsx` draws on
  // the Student 360: at the limit, say so as a cap rather than a fact.
  const countPhrase =
    audit.length === AUDIT_LIMIT
      ? `the most recent ${AUDIT_LIMIT} reads`
      : `${audit.length} read${audit.length === 1 ? "" : "s"}`;
  if (filters.student == null && filters.operator == null) {
    return (
      <>
        <strong>{countPhrase}.</strong> Every operator read of a student&rsquo;s record, transcript or
        replay — including your own. Nothing in the console can edit or remove a row here.
      </>
    );
  }
  return (
    <>
      <strong>{countPhrase}, narrowed</strong> by the &ldquo;Who&rdquo; filters above
      {filters.student != null ? (
        <>
          {" "}
          to <strong>{studentFilterLabel}</strong>&rsquo;s record
        </>
      ) : null}
      {filters.operator != null ? (
        <>
          {" "}
          {filters.student != null ? "and to" : "to"} reads by <strong>{operatorFilterLabel}</strong>
        </>
      ) : null}
      . Nothing in the console can edit or remove a row here.
    </>
  );
}

/**
 * The filter controls (deliverable 1's five dimensions, deliverable 2's
 * "who", deliverable 3's sign-in-story toggle), all in one place because
 * they all narrow the same two views below: the explorable list and the
 * operator-read audit. The six tiles above keep their own fixed windows
 * (contracts/admin.md §7's alert-rule table) and are deliberately untouched
 * by anything here.
 *
 * **Links, not a `<select>` or a form.** The page is a server component with
 * no client JavaScript in its tree, and a filter that is a URL is a filter an
 * operator can paste into an incident, a Slack message or a report — which is
 * what "explore" turns out to mean in practice. At pilot volume (n ≤ 200
 * students, a handful of operators) listing every "who" option as a link is
 * the same call the students list itself makes rather than building a search
 * input; a volume that outgrows it is a plain `method="GET"` form with a text
 * field next, which is still zero client JavaScript, not a rewrite.
 */
function FiltersBar({ view }: { view: SecurityView }) {
  const f = view.filters;
  return (
    <Panel
      title="Filters"
      note="Every combination below is a URL — bookmark one, paste it into an incident, or hand it to someone else exactly as it is. Narrows the list and the read audit together."
    >
      <ActiveFilterChips view={view} />

      <FilterGroup label="When">
        {TIME_WINDOWS.map((w) => (
          <FilterLink key={w} href={hrefFor(f, { window: w })} active={f.window === w}>
            {WINDOW_LABEL[w]}
          </FilterLink>
        ))}
      </FilterGroup>

      <FilterGroup label="Outcome">
        <FilterLink href={hrefFor(f, { outcome: null })} active={f.outcome === null}>
          everything
        </FilterLink>
        {OUTCOMES.map((o) => (
          <FilterLink key={o} href={hrefFor(f, { outcome: o })} active={f.outcome === o}>
            {OUTCOME_FILTER_LABEL[o]}
          </FilterLink>
        ))}
      </FilterGroup>

      <FilterGroup label="Kind">
        <FilterLink
          href={hrefFor(f, { event: null, signins: false })}
          active={!f.signins && f.event === null}
        >
          everything
        </FilterLink>
        <FilterLink href={hrefFor(f, { event: null, signins: true })} active={f.signins}>
          sign-in story
        </FilterLink>
        {view.eventNames.map((name) => (
          <FilterLink
            key={name}
            href={hrefFor(f, { event: name, signins: false })}
            active={!f.signins && f.event === name}
          >
            {eventLabel(name)}
          </FilterLink>
        ))}
      </FilterGroup>

      {view.studentOptions.length > 0 ? (
        <FilterGroup label="Who — student">
          <FilterLink href={hrefFor(f, { student: null })} active={f.student === null}>
            everyone
          </FilterLink>
          {view.studentOptions.map((s) => (
            <FilterLink key={s.id} href={hrefFor(f, { student: s.id })} active={f.student === s.id}>
              {s.name}
            </FilterLink>
          ))}
        </FilterGroup>
      ) : null}

      {view.operatorOptions.length > 0 ? (
        <FilterGroup label="Who — operator">
          <FilterLink href={hrefFor(f, { operator: null })} active={f.operator === null}>
            everyone
          </FilterLink>
          {view.operatorOptions.map((o) => (
            <FilterLink key={o.id} href={hrefFor(f, { operator: o.id })} active={f.operator === o.id}>
              {o.name}
            </FilterLink>
          ))}
        </FilterGroup>
      ) : null}
    </Panel>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

/**
 * One removable chip per active filter, plus one link that clears all of
 * them (deliverable 1). Each chip's own link sets exactly that dimension
 * back to its "off" value and leaves every other filter as it was — removing
 * the student filter must not also forget the time window a reader chose.
 *
 * The window chip is never absent: some window is always narrowing the list,
 * even the default, so it always gets a chip, and its own "remove" sets
 * `window: "all"` rather than deleting the param — a param that isn't there
 * already means the default, so "removing" it would be a link back to itself.
 */
function ActiveFilterChips({ view }: { view: SecurityView }) {
  const f = view.filters;
  const chips: { key: string; label: string; href: string }[] = [
    { key: "window", label: WINDOW_LABEL[f.window], href: hrefFor(f, { window: "all" }) },
  ];
  if (f.signins) {
    chips.push({ key: "kind", label: "sign-in story", href: hrefFor(f, { signins: false }) });
  } else if (f.event) {
    chips.push({ key: "kind", label: eventLabel(f.event), href: hrefFor(f, { event: null }) });
  }
  if (f.outcome != null) {
    chips.push({
      key: "outcome",
      label: OUTCOME_FILTER_LABEL[f.outcome],
      href: hrefFor(f, { outcome: null }),
    });
  }
  if (f.student != null) {
    chips.push({
      key: "student",
      label: `student: ${view.studentFilterLabel}`,
      href: hrefFor(f, { student: null }),
    });
  }
  if (f.operator != null) {
    chips.push({
      key: "operator",
      label: `operator: ${view.operatorFilterLabel}`,
      href: hrefFor(f, { operator: null }),
    });
  }

  const somethingBesidesTheDefaultWindow =
    f.signins || f.event !== null || f.outcome !== null || f.student != null || f.operator != null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="ds-control play-pressable inline-flex items-center gap-1 rounded border border-line bg-paper-deep px-1.5 py-[1px] font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-soft hover:border-ink hover:text-ink"
        >
          {c.label} <span aria-hidden="true">×</span>
          <span className="sr-only">, remove this filter</span>
        </Link>
      ))}
      {somethingBesidesTheDefaultWindow ? (
        <Link
          href="/security"
          className="text-[11.5px] font-medium text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          clear all filters
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Links, not a `<select>`. The page is a server component with no client
 * JavaScript of its own, and a filter that is a URL is a filter an operator can
 * paste into a message — which is what somebody looking at an incident actually
 * does with it.
 */
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
      className={`ds-control-quiet rounded px-2 py-0.5 text-[11.5px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/* --------------------------------------------------------------- the list */

function RecentEvents({ view }: { view: SecurityView }) {
  const { page, pageSize, total, totalPages } = view.pagination;
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <Panel
      title="The security record"
      note={
        total === 0
          ? "No event matches the filters above."
          : `Showing ${from}–${to} of ${total.toLocaleString(
              "en-US"
            )} events — page ${page} of ${totalPages}. The reason column is a short machine code by design — it never carries text somebody typed into a form, and never anything about a password.`
      }
    >
      {view.recent.length === 0 ? (
        <Empty>
          No event matches {describeFilters(view).join(", ")}. Remove a filter above — each chip
          clears just itself, or &ldquo;clear all filters&rdquo; resets the whole list.
        </Empty>
      ) : (
        <>
          <Table
            label="The security record"
            head={["What happened", "Outcome", "Who", "About", "Reason", "Address", "When"]}
          >
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
          <Pager view={view} />
        </>
      )}
    </Panel>
  );
}

/**
 * Next/previous, carrying every other filter along (`hrefFor` with only
 * `page` patched). Absent below one page of results rather than rendered
 * disabled — a pager with both arrows permanently grey is furniture on the
 * common case (an unfiltered environment this small rarely exceeds a page).
 */
function Pager({ view }: { view: SecurityView }) {
  const { page, totalPages } = view.pagination;
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-soft pt-3">
      {page > 1 ? (
        <Link
          href={hrefFor(view.filters, { page: page - 1 })}
          className="text-[12.5px] font-medium text-ink underline underline-offset-2"
        >
          ← Previous
        </Link>
      ) : (
        <span className="text-[12.5px] text-ink-faint">← Previous</span>
      )}
      <span className="font-mono text-[11px] text-ink-faint">
        page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <Link
          href={hrefFor(view.filters, { page: page + 1 })}
          className="text-[12.5px] font-medium text-ink underline underline-offset-2"
        >
          Next →
        </Link>
      ) : (
        <span className="text-[12.5px] text-ink-faint">Next →</span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- table */

/**
 * One table shape for every panel on this page — and, on Samuel's follow-up
 * to the explorability work, one SCROLL shape too. Every panel that wraps a
 * `Table` is a record that can outgrow a screen (a locked-accounts list, a
 * security record, an audit trail), and this page is where an operator needs
 * to keep the six tiles and the next panel in view while reading a long one,
 * not scroll the whole page past them. Bounding it here, once, is what stops
 * six call sites from independently deciding six slightly different scroll
 * boxes — the same reasoning `components/console/ui.tsx`'s own header gives
 * for `<Figure>` and `<Th>`.
 *
 * **The bound is `max-height`, not `height`.** "Accounts locked right now" is
 * three rows on an ordinary day; wrapped in a fixed-height box it would sit
 * in a half-empty frame for no reason. `max-height` only engages once a panel
 * actually has more rows than fit, which is the only time scrolling is the
 * right behaviour — short panels are never touched by it.
 *
 * **`max(320px, 42vh)` adapts to the viewport with a floor**, rather than a
 * hard pixel count: a tall monitor shows more rows before a reader has to
 * scroll at all; a cramped laptop window still gets a floor of 320px rather
 * than shrinking to something three rows can't fit in.
 *
 * **The header row is `position: sticky`, with an opaque background** — a
 * reader forty rows into "the security record" can still see which column is
 * "Outcome" and which is "Reason" without scrolling back up. `bg-card`
 * because that is the Panel's own background (`ui.tsx`); a transparent
 * sticky header would let scrolled-past rows show through it.
 *
 * **One scroll container, not two nested ones.** `overflow-x-auto` (wide
 * tables on a narrow viewport) and `overflow-y-auto` (this bound) are both
 * set on the SAME div — one element scrolling on two axes, never a box
 * wrapped in another box. `tabIndex={0}` and `role="region"` make that div a
 * keyboard stop with a name: focus it and arrow keys / Page Down scroll it,
 * which is the only way to reach row 60 of a filtered list without a mouse.
 */
function Table({
  head,
  children,
  label,
}: {
  head: string[];
  children: React.ReactNode;
  /** The panel's own title, so the scroll region has an accessible name distinct from the next one. */
  label: string;
}) {
  return (
    <div
      className="max-h-[max(320px,42vh)] overflow-auto overscroll-contain rounded border border-line"
      tabIndex={0}
      role="region"
      aria-label={`${label}, scrollable`}
    >
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 z-10 bg-card">
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

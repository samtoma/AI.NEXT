import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { consoleAccess } from "@/lib/console-auth";
import { getStudentList, type StudentListRow } from "@/lib/console-queries";
import { consoleRoute } from "@/lib/console-routes";

/**
 * View 1 — Students, the list (contracts/admin.md §1). The console's landing.
 *
 * **Two roles reach it and they see different rows.** `student-data` sees the
 * whole record; `cost-billing` sees the commercial subset and cannot open a
 * student (FR-2406). Neither projection carries a content column — no message,
 * no transcript, no preview, not even a turn count of a conversation — and the
 * page says so in as many words, because "there is no content here" is a claim
 * about a permission boundary and should be readable rather than inferred.
 *
 * **FR-2211 is why this page is so wordy.** Every figure carries its unit and
 * its period; no column heading is a field name; every cost says *imputed at
 * list price*, never *spent*. A console view is readable without reading code.
 *
 * Sorting and filtering are deliberately absent in P2 rather than half-built:
 * at n ≤ 200 the list fits on a screen and a sort control that only sorts the
 * page you can already see is furniture. The order is most-recently-seen first,
 * which is the question this list answers on a Tuesday morning.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Students — Noor Console" };

const PATH = "/";

export default async function ConsoleStudentsPage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  // The full projection needs `student-data`. An operator who holds only
  // `cost-billing` gets the commercial one — the same page, fewer columns, and
  // no link into a record they may not open.
  const full = access.roles.includes("student-data");
  const list = await getStudentList(access.operatorId, full ? "full" : "cost");

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-7">
      <header className="mb-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
          Students · {list.environment} environment
        </p>
        <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
          Everyone with a record in this environment
        </h1>
        <p className="mt-1.5 max-w-[78ch] text-[13.5px] leading-relaxed text-ink-soft">
          {list.rows.length} student{list.rows.length === 1 ? "" : "s"}. Sessions and cost cover
          the <strong>last {list.periodDays} days</strong>; everything else is current. Cost is{" "}
          <strong>imputed at list price</strong> — the tutor runs on a Claude subscription, so no
          money left an account per turn.
        </p>
        <p className="mt-2 max-w-[78ch] text-[13px] leading-relaxed text-ink-faint">
          {full ? (
            <>
              Full view (<code className="font-mono text-[12px]">student-data</code>). This list
              carries no student content in any projection: no message, no transcript, no preview.
              Opening a student is a separate, recorded act.
            </>
          ) : (
            <>
              Commercial view (<code className="font-mono text-[12px]">cost-billing</code>). No
              student content, and no link into a student&apos;s record — that needs{" "}
              <code className="font-mono text-[12px]">student-data</code>.
            </>
          )}
        </p>
      </header>

      {list.rows.length === 0 ? (
        <p className="rounded-lg border border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
          No students in the <strong>{list.environment}</strong> environment. That is an empty
          register, not a failed query — rows appear as accounts are created.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-start text-ink-soft">
                <Th>Name</Th>
                <Th>Year group</Th>
                {full && <Th>Gender</Th>}
                <Th>Account</Th>
                {full && <Th>Email confirmed</Th>}
                <Th>Subscription</Th>
                <Th>Last seen</Th>
                <Th right>Sessions ({list.periodDays}d)</Th>
                <Th right>Cost, imputed ({list.periodDays}d)</Th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((s) => (
                <Row key={s.id} s={s} full={full} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
        A student marked <strong>retired</strong> is a picker-era row kept for its history: it has
        no account, so no one can sign in as it and no student surface can reach it (A10, FR-2014).
      </p>
    </main>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap px-3 py-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] ${
        right ? "text-end" : "text-start"
      }`}
    >
      {children}
    </th>
  );
}

function Row({ s, full }: { s: StudentListRow; full: boolean }) {
  return (
    <tr className="border-b border-line-soft last:border-b-0">
      <td className="px-3 py-2">
        {full ? (
          <Link href={`/students/${s.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
            {s.displayName}
          </Link>
        ) : (
          <span className="font-semibold text-ink">{s.displayName}</span>
        )}
        {/* FR-2211: an identifier is shown beside the name it belongs to. */}
        <span className="ms-2 font-mono text-[11px] text-ink-faint">#{s.id}</span>
        {s.studentStatus === "legacy" && (
          <span className="ms-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
            retired
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-ink-soft">{s.grade}</td>
      {full && <td className="px-3 py-2 text-ink-soft">{s.gender ?? "not set"}</td>}
      <td className="px-3 py-2 text-ink-soft">{s.accountStatus ?? "no account"}</td>
      {full && (
        <td className="px-3 py-2 text-ink-soft">
          {s.accountStatus === null ? "—" : s.emailVerified ? "yes" : "not yet"}
        </td>
      )}
      <td className="px-3 py-2 text-ink-soft">{s.subscriptionStatus}</td>
      <td className="px-3 py-2 text-ink-soft">{formatSeen(s.lastSeenAt)}</td>
      <td className="px-3 py-2 text-end tabular-nums text-ink-soft">{s.sessionsInPeriod}</td>
      <td className="px-3 py-2 text-end tabular-nums text-ink-soft">{usd(s.costUsdInPeriod)}</td>
    </tr>
  );
}

/** Never "$0.00" for a real spend of $0.0004 — the small numbers are the point. */
function usd(v: number): string {
  if (v === 0) return "$0";
  return v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
}

function formatSeen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  // A date and a time, in one readable string. No "3 days ago": an operator
  // comparing two rows needs the value, not a relative phrase they then have to
  // convert back.
  return d.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

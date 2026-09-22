import Link from "next/link";
import { notFound } from "next/navigation";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { Chip, Td, Th, stamp } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { getStudentSessions } from "@/lib/console-queries";
import { consoleRoute } from "@/lib/console-routes";
import { ENVIRONMENT } from "@/lib/env";
import { humanDuration } from "@/lib/timeline-rules";

/**
 * The session list (contracts/admin.md §3, research A6).
 *
 * **This page writes NO `operator_reads` row, and that is a decision rather
 * than an omission.** Opening a list of sittings is not reading a child's
 * conversation: there is no message here, no preview, no first line, not one
 * word the student or the tutor wrote. If browsing this list were recorded,
 * every row in `operator_reads` would mean "somebody looked at a list", and the
 * rows that mean "somebody read a fourteen-year-old's conversation" would be
 * lost among them — which would cost the audit the only thing that makes
 * ADR-0014's highest-privilege role grantable at all.
 *
 * That guarantee holds only while there is nothing here to read. **Adding a
 * content column to this view is not a UI change**: it is a change to what the
 * audit means, and it needs the audit row added in the same commit. The read
 * model (`getStudentSessions`) carries the same warning for the same reason.
 *
 * Opening a timeline or a replay from here IS recorded, by those pages.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Sessions — Noor Console" };

const PATH = "/students/[id]/sessions";

/** How a closed session ended, in the words an operator would use. */
const CLOSE_REASON: Record<string, string> = {
  completed: "finished it",
  inactivity: "went quiet for 30 minutes",
  superseded: "started another one",
  abandoned: "left it stranded; swept closed",
};

export default async function ConsoleSessionListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const studentId = Number((await params).id);
  if (!Number.isInteger(studentId) || studentId <= 0) notFound();

  const data = await getStudentSessions(access.operatorId, studentId);
  if (!data) notFound();

  return (
    <main className="mx-auto w-full max-w-[1200px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          Students
        </Link>{" "}
        /{" "}
        <Link href={`/students/${studentId}`} className="underline-offset-2 hover:underline">
          {data.student.displayName} #{data.student.id}
        </Link>{" "}
        / Sessions
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        Study sittings, most recent first
      </h1>
      <p className="mt-1.5 max-w-[80ch] text-[13.5px] leading-relaxed text-ink-soft">
        {data.rows.length} session{data.rows.length === 1 ? "" : "s"} in the {ENVIRONMENT}{" "}
        environment. <strong>Metadata only</strong> — when it happened, how long it lasted, what
        kind it was, what it touched, and how it ended. Cost is{" "}
        <strong>imputed at list price</strong> in US dollars.
      </p>
      <p className="mt-2 max-w-[80ch] text-[13px] leading-relaxed text-ink-faint">
        Opening this list is not a transcript read and is not recorded against your account.
        Opening a timeline or a replay from it is.
      </p>

      {data.rows.length === 0 ? (
        <p className="mt-5 rounded-lg border border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
          This student has never opened a session. That is an empty history, not a failed query.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <Th>Started</Th>
                <Th>How long</Th>
                <Th>Kind of sitting</Th>
                <Th>Objective it was about</Th>
                <Th right>Tutor turns</Th>
                <Th right>Answers</Th>
                <Th right>Objectives touched</Th>
                <Th right>Cost, imputed</Th>
                <Th>How it ended</Th>
                <Th>Read it</Th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-b border-line-soft last:border-0">
                  <Td mono>{stamp(r.openedAt)}</Td>
                  <Td mono>
                    {r.wallClockMs == null ? (
                      <span className="text-ink-faint">still open</span>
                    ) : (
                      humanDuration(r.wallClockMs)
                    )}
                  </Td>
                  <Td>{r.kind.replace(/_/g, " ")}</Td>
                  <Td>
                    {r.loId == null ? (
                      <span className="text-ink-faint">none — open chat</span>
                    ) : (
                      <>
                        {r.loLabel ?? "unlabelled objective"}{" "}
                        <span className="font-mono text-[11px] text-ink-faint">{r.loId}</span>
                      </>
                    )}
                  </Td>
                  <Td right mono>
                    {r.turns}
                  </Td>
                  <Td right mono>
                    {r.attempts}
                  </Td>
                  <Td right mono>
                    {r.objectivesTouched}
                  </Td>
                  <Td right mono>
                    ${r.costUsd.toFixed(4)}
                  </Td>
                  <Td>
                    {r.closedAt == null ? (
                      <Chip tone="attention">open</Chip>
                    ) : (
                      <span className="text-[12.5px] text-ink-soft">
                        {CLOSE_REASON[r.closeReason ?? ""] ?? r.closeReason ?? "closed"}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span className="flex flex-col gap-0.5">
                      <Link
                        href={`/students/${studentId}/sessions/${r.id}`}
                        className="whitespace-nowrap text-accent underline-offset-2 hover:underline"
                      >
                        Timeline →
                      </Link>
                      <Link
                        href={`/students/${studentId}/sessions/${r.id}/replay`}
                        className="whitespace-nowrap text-accent underline-offset-2 hover:underline"
                      >
                        Replay →
                      </Link>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.rows.length > 0 && (
        <p className="mt-4 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-faint">
          A sitting closed after thirty minutes of silence is shown as such rather than as a
          finished one: the two mean opposite things about whether the student got what they came
          for.
        </p>
      )}
    </main>
  );
}

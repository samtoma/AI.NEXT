import Link from "next/link";
import { notFound } from "next/navigation";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { TimelineView } from "@/components/console/TimelineView";
import { Chip, Figure, SessionSnapshotChips, stamp } from "@/components/console/ui";
import { recordOperatorRead } from "@/lib/auth/events";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import { GAP_THRESHOLD_MS, getSessionTimeline, humanDuration } from "@/lib/timeline";

/**
 * The session timeline (contracts/admin.md §4, ADR-0015 §2, FR-2303).
 *
 * **Opening it writes `operator_reads(surface='session_timeline')` and emits
 * `admin_transcript_viewed`** — `recordOperatorRead` does both in one call, so
 * the two cannot come apart, and it runs inside the same transaction as the
 * seven reads that build the timeline.
 *
 * **One time order, not six lists.** Tutor turns, answers, widget outcomes,
 * understanding checks, uploads, mastery movements and explanations are merged
 * by `lib/timeline.ts` into a single ordered sequence. Six panels the reader
 * merges by eye is the thing FR-2303 rules out: it looks like a transcript and
 * it is a reading exercise, and the reader is trying to answer "did the tutor
 * teach this child well", which is a question about order.
 *
 * **Elapsed gaps are rendered.** A nine-minute pause before an answer is a
 * signal, and closing it up would assert that the student answered
 * immediately.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Session timeline — Noor Console" };

const PATH = "/students/[id]/sessions/[sid]";

export default async function ConsoleSessionTimelinePage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const { id, sid } = await params;
  const studentId = Number(id);
  const sessionId = Number(sid);
  if (!Number.isInteger(studentId) || studentId <= 0) notFound();
  if (!Number.isInteger(sessionId) || sessionId <= 0) notFound();

  const data = await getSessionTimeline(access.operatorId, studentId, sessionId, (db) =>
    recordOperatorRead(db, {
      operatorId: access.operatorId,
      studentId,
      sessionId,
      surface: "session_timeline",
      environment: ENVIRONMENT,
    })
  );
  // Not this student's session, not this environment, or not there at all —
  // one answer for all three. Distinguishing them would leak the distinction.
  if (!data) notFound();

  const { session, build } = data;
  const c = build.counts;

  return (
    <main className="mx-auto w-full max-w-[1000px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          Students
        </Link>{" "}
        /{" "}
        <Link href={`/students/${studentId}`} className="underline-offset-2 hover:underline">
          {session.studentName} #{session.studentId}
        </Link>{" "}
        /{" "}
        <Link
          href={`/students/${studentId}/sessions`}
          className="underline-offset-2 hover:underline"
        >
          Sessions
        </Link>{" "}
        / #{session.id}
      </p>

      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="font-display text-[24px] font-bold text-ink">
          What happened, in one order
        </h1>
        <Link
          href={`/students/${studentId}/sessions/${session.id}/replay`}
          className="ds-control play-pressable rounded-md border border-line px-3 py-1.5 text-[12.5px] font-medium text-accent hover:bg-accent-wash"
        >
          See it as the student saw it (reconstructed) →
        </Link>
      </div>

      <p className="mt-1.5 max-w-[80ch] text-[13.5px] leading-relaxed text-ink-soft">
        Session <span className="font-mono">#{session.id}</span> ·{" "}
        {session.kind.replace(/_/g, " ")} ·{" "}
        {session.loId ? (
          <>
            {session.loLabel ?? "unlabelled objective"}{" "}
            <span className="font-mono text-[12px] text-ink-faint">{session.loId}</span>
          </>
        ) : (
          "no objective — open chat"
        )}{" "}
        · opened {stamp(session.openedAt)} ·{" "}
        {session.closedAt ? (
          <>
            closed {stamp(session.closedAt)} ({session.closeReason ?? "no reason recorded"})
          </>
        ) : (
          <Chip tone="attention">still open</Chip>
        )}
      </p>
      {/* ADR-0021: what the session recorded when it opened, fixed for its life. */}
      <p className="mt-1.5 text-[12.5px] text-ink-soft">
        Opened on <SessionSnapshotChips releaseTag={session.releaseTag} probing={session.probing} />
      </p>

      <section className="mt-4 grid gap-5 rounded-lg border border-line bg-card px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="Sitting, wall clock"
          value={humanDuration(session.wallClockMs) ?? "still running"}
          unit="opened to closed"
          period="this session"
        />
        <Figure
          label="Inside questions"
          value={humanDuration(data.attemptTimeMs) ?? "0 s"}
          unit="summed from each answer"
          period="this session"
          hint="Never added to the wall clock beside it: one is the sitting, the other is the answering."
        />
        <Figure
          label="Tutor turns"
          value={c.turn}
          unit="turns"
          period="this session"
        />
        <Figure
          label="Answers"
          value={c.attempt + c.widget}
          unit={`attempts (${c.widget} by construction)`}
          period="this session"
        />
      </section>

      <p className="mt-3 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-faint">
        {c.understanding} understanding check{c.understanding === 1 ? "" : "s"} · {c.upload} upload
        {c.upload === 1 ? "" : "s"} · {c.mastery} mastery movement
        {c.mastery === 1 ? "" : "s"} · {c.explanation} explanation
        {c.explanation === 1 ? "" : "s"}. A pause longer than{" "}
        {humanDuration(GAP_THRESHOLD_MS)} is drawn as a row of its own.
        {build.unreachableExplanations > 0 && (
          <>
            {" "}
            {build.unreachableExplanations} explanation
            {build.unreachableExplanations === 1 ? " was" : "s were"} left out:{" "}
            <code className="font-mono text-[12px]">explanation_log</code> has no student, only an
            attempt, so one whose attempt is missing cannot be attributed to anybody.
          </>
        )}
      </p>

      <div className="mt-5">
        {build.items.length === 0 ? (
          <p className="rounded-lg border border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
            This session has no recorded interactions. It was opened and nothing was written
            against it — an empty sitting, not a failed query.
          </p>
        ) : (
          <TimelineView items={build.items} currentRelease={RELEASE_TAG} />
        )}
      </div>

      <p className="mt-5 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-faint">
        Opening this timeline was recorded against your account in{" "}
        <code className="font-mono text-[12px]">operator_reads</code>, with this student and this
        session, and emitted <code className="font-mono text-[12px]">admin_transcript_viewed</code>.
        Neither can be edited or deleted from the console, including by you.
      </p>
    </main>
  );
}

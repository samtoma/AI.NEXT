import Link from "next/link";
import { notFound } from "next/navigation";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { ReplayTranscript } from "@/components/console/ReplayTranscript";
import { Chip, SessionSnapshotChips, SessionSnapshotNote, TURN_LIMIT_NOTE, TurnLimitChip, stamp } from "@/components/console/ui";
import { recordOperatorRead } from "@/lib/auth/events";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { ENVIRONMENT, RELEASE_TAG } from "@/lib/env";
import { getSessionTimeline } from "@/lib/timeline";

/**
 * The replay (contracts/admin.md §5, ADR-0015 §3, FR-2304, FR-2305).
 *
 * **Reconstructed from stored records.** ADR-0015 rejected storing a rendered
 * snapshot of every turn and chose to re-render the stored payload with the
 * components the student's browser ran. That is cheap, it does not duplicate
 * the highest-volume student table, and it does not freeze a rendering bug into
 * the record as though it were the truth of what a child was taught. What it
 * costs is certainty, so the page says so **persistently and visibly**: a
 * sticky banner that does not dismiss, a per-turn "reconstructed" mark, and
 * each turn's `renderer_version` beside its time and its model — with a
 * "differs from current renderer" mark when this build is not the one that drew
 * it. An operator reading a transcript to judge whether the tutor taught well
 * needs to know which parts are evidence and which are re-staging.
 *
 * **Read-only is a contract, not an intention** (FR-2305). This page opens no
 * path that writes an attempt, moves a mastery estimate, calls the AI runtime,
 * or emits an event attributed to the student. `lib/replay-guard.test.mts`
 * walks the transitive import graph of this file and fails the build if
 * `/api/ask`, `/api/attempts`, `/api/understanding`, `/api/uploads`,
 * `lib/analytics` or `lib/sessions` appears anywhere in it — so the guarantee
 * survives a convenient import somebody adds later, which is the only way it
 * was ever going to be broken.
 *
 * The one write it causes is the `operator_reads` row, attributed to the
 * operator (`surface='session_replay'`), in the same transaction as the read.
 *
 * **No redaction toggle** (D7, research A6): full fidelity is the decision, and
 * an operator-side mask on a surface whose purpose is reading what the student
 * wrote is theatre.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Session replay — Noor Console" };

const PATH = "/students/[id]/sessions/[sid]/replay";

export default async function ConsoleSessionReplayPage({
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
      surface: "session_replay",
      environment: ENVIRONMENT,
    })
  );
  if (!data) notFound();

  const { session, build } = data;
  const turns = build.items.filter((i) => i.kind === "turn");
  const drifted = turns.filter((i) => i.kind === "turn" && i.rendererVersion !== RELEASE_TAG).length;
  const unrecorded = turns.filter((i) => i.kind === "turn" && i.rendererVersion == null).length;

  return (
    <main className="mx-auto w-full max-w-[860px] px-5 py-7">
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
        /{" "}
        <Link
          href={`/students/${studentId}/sessions/${session.id}`}
          className="underline-offset-2 hover:underline"
        >
          #{session.id}
        </Link>{" "}
        / Replay
      </p>

      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        Session #{session.id}, as {session.studentName} saw it
      </h1>
      <p className="mt-1.5 max-w-[78ch] text-[13.5px] leading-relaxed text-ink-soft">
        {session.kind.replace(/_/g, " ")} · opened {stamp(session.openedAt)} ·{" "}
        {session.closedAt ? (
          <>closed {stamp(session.closedAt)}</>
        ) : (
          <Chip tone="attention">still open</Chip>
        )}
      </p>
      {/* ADR-0021: what the session recorded when it opened. Probing changes
          what the cards below showed after a wrong answer, so a reader needs
          it before reading them. */}
      <p className="mt-1.5 text-[12.5px] text-ink-soft">
        Opened on <SessionSnapshotChips releaseTag={session.releaseTag} probing={session.probing} />{" "}
        <SessionSnapshotNote />
      </p>
      {/* ADR-0023, FR-3405: the reply threshold that used to stop this conversation. */}
      {data.turnLimit ? (
        <p className="mt-1.5 text-[12.5px] text-ink-soft">
          Turn threshold <TurnLimitChip limit={data.turnLimit} />{" "}
          <span className="text-[11.5px] text-ink-faint">{TURN_LIMIT_NOTE}</span>
        </p>
      ) : null}

      {/*
        The label FR-2304 requires: persistent, visible, and impossible to
        scroll away from. `sticky` rather than a one-line note at the top,
        because a reader forty turns into a transcript has long since lost the
        note — and the whole claim this page makes about itself is in it.
      */}
      <div className="sticky top-0 z-10 -mx-5 mt-4 border-y border-gold/50 bg-gold-wash px-5 py-2.5 backdrop-blur">
        <p className="text-[13px] font-semibold leading-snug text-gold">
          Reconstructed from stored records — not a recording of the screen.
        </p>
        <p className="mt-0.5 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-soft">
          Every line below is the stored message, answer or construction, re-rendered now by the
          components the student&apos;s browser ran. Each turn shows when it happened, which model
          produced it, and which build drew it. This build is{" "}
          <code className="font-mono text-[12px]">{RELEASE_TAG}</code>.
          {drifted > 0 && (
            <>
              {" "}
              <strong>
                {drifted} of {turns.length} turns
              </strong>{" "}
              {drifted === 1 ? "was" : "were"} drawn by a different build
              {unrecorded > 0 && ` (${unrecorded} recorded no version at all)`} and {drifted === 1 ? "is" : "are"} marked
              where {drifted === 1 ? "it appears" : "they appear"}.
            </>
          )}
        </p>
      </div>

      <div className="mt-5">
        {build.items.length === 0 ? (
          <p className="rounded-lg border border-line bg-card px-4 py-3 text-[13.5px] text-ink-soft">
            There is nothing to reconstruct: this session recorded no interactions.
          </p>
        ) : (
          <ReplayTranscript
            items={build.items}
            currentRelease={RELEASE_TAG}
            studentName={session.studentName}
          />
        )}
      </div>

      <div className="mt-6 space-y-2 border-t border-line-soft pt-4 text-[12.5px] leading-relaxed text-ink-faint">
        <p className="max-w-[78ch]">
          Mastery movements and explanation-log rows are deliberately absent from this page: they
          were never on the student&apos;s screen. They are in the{" "}
          <Link
            href={`/students/${studentId}/sessions/${session.id}`}
            className="text-accent underline-offset-2 hover:underline"
          >
            timeline
          </Link>
          , which is the record rather than the re-staging.
        </p>
        <p className="max-w-[78ch]">
          Nothing on this page can be answered, submitted or replied to. Widgets render with
          interaction disabled, the report card&apos;s next-step buttons are dropped, and no
          control here reaches the tutor, the attempt path or the student&apos;s analytics.
        </p>
        <p className="max-w-[78ch]">
          Opening this replay was recorded against your account in{" "}
          <code className="font-mono text-[12px]">operator_reads</code>, with this student and this
          session. It cannot be edited or deleted from the console, including by you.
        </p>
      </div>
    </main>
  );
}

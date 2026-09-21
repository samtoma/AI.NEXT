import Link from "next/link";
import { notFound } from "next/navigation";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { recordOperatorRead } from "@/lib/auth/events";
import { consoleAccess } from "@/lib/console-auth";
import { getStudentProfileCard } from "@/lib/console-queries";
import { consoleRoute } from "@/lib/console-routes";
import { ENVIRONMENT } from "@/lib/env";

/**
 * Student 360 — **P3 builds this page**. What is here in P2 is the profile
 * header, an honest label saying so, and the thing that must not wait: the
 * audit row.
 *
 * **Opening this page writes an `operator_reads` row** (`surface='student_360'`)
 * and emits `admin_transcript_viewed`, in the same transaction as the read it
 * records (FR-2306, contracts/admin.md §2). That is the whole reason this page
 * exists in P2 at all rather than being a link to nothing: the audit has to
 * exist from the first day a student's record can be opened, not from the day
 * the page becomes worth opening. An audit that starts late has a gap nobody
 * can reconstruct, and the gap is exactly the period when the tooling was new
 * and being poked at.
 *
 * `ainext_operator` holds SELECT and INSERT on `operator_reads` and no UPDATE
 * or DELETE (migration 017), so this row cannot be edited or removed by the
 * role that writes it.
 *
 * **No placeholder that looks done.** Mastery, sessions, the timeline, the
 * replay, the cost series and the subscription control are named as absent and
 * attributed to their phase rather than stubbed — a disabled control reads as
 * "broken", and an empty panel reads as "no data".
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Student — Noor Console" };

const PATH = "/students/[id]";

export default async function ConsoleStudentPage({
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

  const student = await getStudentProfileCard(access.operatorId, studentId, (db) =>
    recordOperatorRead(db, {
      operatorId: access.operatorId,
      studentId,
      surface: "student_360",
      environment: ENVIRONMENT,
    })
  );

  // A student who is not in this environment is not here. No audit row is
  // written for a record that was not read — the callback runs only after a row
  // comes back.
  if (!student) notFound();

  return (
    <main className="mx-auto w-full max-w-[1000px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          Students
        </Link>{" "}
        / #{student.id}
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">{student.displayName}</h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        Student <span className="font-mono">#{student.id}</span> · {ENVIRONMENT} environment
      </p>

      <section className="mt-5 rounded-lg border border-line bg-card">
        <h2 className="border-b border-line px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          Profile
        </h2>
        <dl className="grid gap-x-8 gap-y-3 px-4 py-4 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Fact k="Year group" v={student.grade} />
          <Fact k="Gender" v={student.gender ?? "not set"} />
          <Fact k="Interests" v={student.interests.length ? student.interests.join(", ") : "none recorded"} />
          <Fact k="Language preference" v={student.languagePref} />
          <Fact k="Curriculum" v={student.curriculumSystem} />
          <Fact
            k="Record status"
            v={student.studentStatus === "legacy" ? "retired (picker-era, no account)" : "active"}
          />
          <Fact k="Account" v={student.accountStatus ?? "no account"} />
          <Fact
            k="Email confirmed"
            v={student.accountStatus === null ? "—" : student.emailVerified ? "yes" : "not yet"}
          />
          <Fact k="Subscription" v={student.subscriptionStatus} />
          <Fact k="Record created" v={stamp(student.createdAt)} />
          <Fact k="Last seen" v={student.lastSeenAt ? stamp(student.lastSeenAt) : "never"} />
        </dl>
      </section>

      <section className="mt-5 rounded-lg border border-dashed border-line px-4 py-4">
        <h2 className="font-display text-[16px] font-bold text-ink">Student 360 — coming in P3</h2>
        <p className="mt-1.5 max-w-[72ch] text-[13px] leading-relaxed text-ink-soft">
          Mastery by objective with its trajectory, attempts and accuracy, time on task as two
          separate numbers, the session list, the interaction timeline and the reconstructed
          replay, help-seeking, misconception frequency, sign-in history and safety flags all land
          in the next phase. They are named here rather than stubbed: an empty panel reads as
          &ldquo;no data&rdquo;, which is a different and wrong claim.
        </p>
        <p className="mt-2 max-w-[72ch] text-[13px] leading-relaxed text-ink-soft">
          The per-student cost series and the subscription control follow in P4.
        </p>
      </section>

      <p className="mt-4 max-w-[72ch] text-[12.5px] leading-relaxed text-ink-faint">
        Opening this page was recorded against your account in{" "}
        <code className="font-mono text-[12px]">operator_reads</code>, with the time and this
        student. The record cannot be edited or deleted from the console, including by you.
      </p>
    </main>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">{k}</dt>
      <dd className="mt-0.5 text-ink">{v}</dd>
    </div>
  );
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

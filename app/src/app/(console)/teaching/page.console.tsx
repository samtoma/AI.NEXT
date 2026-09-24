import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { TeachingSwitch } from "@/components/console/TeachingSwitch";
import { Chip, Empty, Panel, Td, Th, stamp } from "@/components/console/ui";
import { crossStudentReadAllowed } from "@/lib/auth/authorize";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import {
  PROBING_COURSE_ID,
  PROBING_EVERYONE_LOCK_NOTE,
  type ProbingSetting,
} from "@/lib/socratic-probing";
import { getTeachingPage } from "@/lib/teaching-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Teaching — Noor Console" };

/**
 * `/teaching` — the console's teaching switches (ADR-0021, FR-3101…).
 *
 * Today there is one: Socratic probing, Off / Test accounts only / Everyone.
 * v0.6.0 merged it behind a compile-time constant, switched off; this page is
 * the runtime replacement Samuel approved on 2026-09-24.
 *
 * **Any operator holding at least one role may read this page** (not one
 * whose every role was revoked — fix pass, 2026-09-24); **only
 * `teaching-controls` may move the switch** (`/api/console/teaching`). Nothing here names a student unless the
 * reader already holds `student-data`, the role that lists students: the
 * position, who moved it and when, its history, the deployed release, and a
 * COUNT of test accounts are facts about the product, and "is the tutor
 * probing right now, and since when?" is a question every operator should be
 * able to answer when a lesson behaved oddly.
 *
 * **What the page must never let an operator believe.** That flipping the
 * switch changes a lesson in progress. It does not: each learning session
 * resolves probing once, when it opens, and keeps that answer to its end
 * (`lib/sessions.ts`). The page says so beside the control.
 */
const PATH = "/teaching";

const LABEL: Record<ProbingSetting, string> = {
  off: "Off",
  testers: "Test accounts only",
  everyone: "Everyone",
};

export default async function TeachingConsolePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }

  const canEdit = access.roles.includes("teaching-controls");
  const listTesters = crossStudentReadAllowed("student_list", access.roles);
  const page = await getTeachingPage(access.operatorId, listTesters);
  const { state } = page;
  const lockedEveryoneStored = state.stored === "everyone" && state.effective !== "everyone";

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 py-7">
      <header>
        <p className="rule-label">Teaching</p>
        <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
          How the tutor teaches, and who it is trying things on
        </h1>
        <p className="mt-1.5 max-w-[78ch] text-[13.5px] leading-relaxed text-ink-soft">
          The {state.environment} environment is running{" "}
          <code className="font-mono text-[12.5px]">{state.releaseTag}</code>. Socratic probing is{" "}
          <strong>{LABEL[state.effective].toLowerCase()}</strong>
          {state.updatedAt ? (
            <>
              {" "}
              — changed by <strong>{state.updatedBy ?? "an operator no longer on record"}</strong>{" "}
              at {stamp(state.updatedAt)}.
            </>
          ) : (
            <> — the default. Nobody has changed it.</>
          )}
        </p>
      </header>

      <Panel
        title="Socratic probing"
        note={
          <>
            When a student answers a maths question wrongly in a lesson, probing makes the tutor ask a
            guiding question first instead of showing the worked solution straight away. It applies
            to <strong>maths lessons in learn mode only</strong> (
            <code className="font-mono text-[11.5px]">{PROBING_COURSE_ID}</code>) — review mode,
            practice and the other two subjects never probe, because nothing in the probing
            instructions is translated yet (issue #53).
          </>
        }
        right={
          <Chip tone={state.effective === "off" ? "neutral" : "attention"}>
            {LABEL[state.effective]}
          </Chip>
        }
      >
        {lockedEveryoneStored && (
          <div className="mb-4 rounded-lg border border-gold bg-gold-wash px-4 py-3">
            <p className="text-[13.5px] font-semibold leading-relaxed text-ink">
              The stored position is Everyone, and Everyone is locked.
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              {PROBING_EVERYONE_LOCK_NOTE}. Until it is unlocked the product treats it as{" "}
              <strong>Test accounts only</strong>: only students marked as test accounts get probing.
            </p>
          </div>
        )}

        <TeachingSwitch
          stored={state.stored}
          canEdit={canEdit}
          everyoneUnlocked={state.everyoneUnlocked}
          lockNote={PROBING_EVERYONE_LOCK_NOTE}
        />

        <p className="mt-4 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          <strong>A change reaches lessons that start after it, never a lesson in progress.</strong>{" "}
          Each lesson decides once, when it opens, whether it probes, and records that decision
          with the release that served it — you can see both on every session in a student&rsquo;s
          session list. A lesson left open for thirty minutes ends, and the next one decides again.
        </p>
      </Panel>

      <Panel
        title="Test accounts"
        note={
          <>
            {page.testerCount === 0
              ? "No student is marked as a test account in this environment."
              : `${page.testerCount} student account${page.testerCount === 1 ? " is" : "s are"} marked as test accounts in this environment.`}{" "}
            A student is marked, or unmarked, from their own page. With probing on{" "}
            <strong>Test accounts only</strong>, these are the only students it reaches.
          </>
        }
      >
        {page.testers === null ? (
          <p className="max-w-[78ch] text-[12.5px] leading-relaxed text-ink-soft">
            Their names are shown to operators holding{" "}
            <code className="font-mono text-[12px]">student-data</code>, the role that lists
            students.
          </p>
        ) : page.testers.length === 0 ? (
          <Empty>Nobody is marked. Open a student from the student list to mark one.</Empty>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {page.testers.map((t) => (
              <li key={t.studentId} className="flex flex-wrap items-baseline justify-between gap-x-4">
                <Link
                  href={`/students/${t.studentId}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {t.displayName} #{t.studentId}
                </Link>
                <span className="font-mono text-[12px] text-ink-soft">
                  marked by {t.markedBy ?? "an operator no longer on record"} · {stamp(t.markedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Every change to the switch"
        note="Newest first. Each row is written in the same transaction as the change it records, and nothing in the console can edit or remove one."
      >
        {page.history.length === 0 ? (
          <Empty>
            The switch has never been moved in this environment. It has been Off since the feature
            shipped.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>When</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>Changed by</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {page.history.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <Td mono>{stamp(c.changedAt)}</Td>
                    <Td>{c.fromValue == null ? "Off (default)" : LABEL[c.fromValue]}</Td>
                    <Td>
                      <Chip tone={c.toValue === "off" ? "neutral" : "attention"}>
                        {LABEL[c.toValue]}
                      </Chip>
                    </Td>
                    <Td>{c.changedBy ?? "an operator no longer on record"}</Td>
                    <Td>{c.note ?? <span className="text-ink-faint">no note</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}

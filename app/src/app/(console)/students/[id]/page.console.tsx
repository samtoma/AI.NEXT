import Link from "next/link";
import { notFound } from "next/navigation";

import { AuditPanel } from "@/components/console/AuditPanel";
import { CourseAccessEditor } from "@/components/console/CourseAccessEditor";
import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { CurriculumEditor } from "@/components/console/CurriculumEditor";
import { Sparkline } from "@/components/console/Sparkline";
import { SubscriptionEditor } from "@/components/console/SubscriptionEditor";
import { TesterMarkEditor } from "@/components/console/TesterMarkEditor";
import {
  Chip,
  Cost,
  Empty,
  Figure,
  Panel,
  Td,
  Th,
  share,
  stamp,
} from "@/components/console/ui";
import { recordOperatorRead } from "@/lib/auth/events";
import { canonicalGrade, gradeDisplayLabel } from "@/lib/catalog";
import { studentAccess, type StudentAccessRow } from "@/lib/catalog-queries";
import { consoleAccess } from "@/lib/console-auth";
import { courseName, coursesByCurriculum } from "@/lib/console-course-names";
import { curriculumProjection, getStudent360 } from "@/lib/console-queries";
import { consoleRoute } from "@/lib/console-routes";
import { CURRICULA, CURRICULUM_IDS, asCurriculumId, curriculumLabel } from "@/lib/curricula";
import { offeredCurriculaByGrade, studentCurriculum } from "@/lib/curriculum-queries";
import { ENVIRONMENT } from "@/lib/env";
import { humanDuration } from "@/lib/timeline-rules";
import { getTeachingStateOrNull, studentTesterMarksOrNull } from "@/lib/teaching-queries";

/**
 * Student 360 (contracts/admin.md §2, FR-2211, FR-2306, FR-2508).
 *
 * Everything known about one student on one page, and **one audit row**
 * recording that somebody read it (`surface='student_360'`, written by
 * `recordOperatorRead`, which also emits `admin_transcript_viewed`). The row
 * goes in the same transaction as the eleven reads behind the page — see
 * `getStudent360` — so a commit that served a child's record without recording
 * who saw it is not a thing this page can do.
 *
 * **Time on task is two numbers and they are never added.** Summed
 * `attempts.time_ms` is time inside questions; session wall clock is how long
 * the sittings lasted. Their difference is reading, thinking, being called for
 * dinner. A single blended "time on task" would be neither figure, and it is
 * the number a founder would quote to a parent.
 *
 * **Safety flags carry type and time, and nothing else** (FR-2508). The table
 * deliberately holds nothing else, and the console must not become somewhere a
 * flag is triaged — the immediate human channel stays the path that matters,
 * and a queue somebody checks on Monday would quietly replace it.
 *
 * **Her own words are the one thing on this page she wrote** (FR-2809,
 * migration 025). Everything else here is derived — estimates, counts,
 * durations, verdicts the tutor wrote about her — and the feedback panel is a
 * sentence she typed about the product. Nothing scans, scores or classifies
 * it, and no safety flag is ever raised from one; this page is the human path,
 * which is why the panel sits directly beneath the flags and why nothing on it
 * can edit or remove a note (`ainext_operator` holds SELECT on that table and
 * nothing else).
 *
 * **The commercial status is read by everyone who reaches this page and changed
 * by almost nobody.** It is a fact about the student, so `student-data` sees it
 * with who last set it and when; changing it needs `cost-billing` (FR-2405), so
 * the editor renders only for an operator holding both roles. An operator
 * holding `cost-billing` alone never reaches this page at all — FR-2406 keeps
 * the whole record away from the commercial role — which is why the control
 * lives here rather than the status living on the cost page's table.
 *
 * P4 owns the per-student cost SERIES; it is on `/cost`, where the reconciliation
 * that makes it trustworthy is. What is here is this student's running total.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Student — Noor Console" };

const PATH = "/students/[id]";
const ALL_TIME = "all time, since the record was created";

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

  const data = await getStudent360(access.operatorId, studentId, (db) =>
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
  if (!data) notFound();

  // Course availability (migration 023). No `onRead` here and none is missing:
  // `studentAccess`'s own docblock is explicit that a caller sharing this
  // page's render does not owe it a second `operator_reads` row — the one
  // `getStudent360` just wrote above, for `surface: 'student_360'`, already
  // covers "an operator opened this student's record". A second row would
  // record the same read twice under two names for the same click.
  const courseAccess = await studentAccess(access.operatorId, studentId);

  // Her curriculum (feature 003, FR-4105): the value, how it was set, its
  // history, what her grade offers, and what she would see under each
  // curriculum — the last for the editor's in-page question (FR-4010). The
  // same audit argument as `studentAccess`: the `student_360` row above
  // already records that this operator opened this record. Side facts, so a
  // failed read renders "could not be read" in the panel instead of a 500 for
  // the whole record (the `...OrNull` pattern below).
  const curriculum = await studentCurriculum(access.operatorId, studentId).catch((err) => {
    console.error("[console] curriculum record read failed:", err);
    return null;
  });
  const offeredByGrade = await offeredCurriculaByGrade(access.operatorId).catch((err) => {
    console.error("[console] offered-curricula read failed:", err);
    return null;
  });
  const projection = await curriculumProjection(access.operatorId, studentId).catch((err) => {
    console.error("[console] curriculum projection read failed:", err);
    return null;
  });

  // The tester mark (ADR-0021), and the switch that gives it meaning. The
  // same audit argument as `studentAccess` above: the one `student_360` row
  // already records that this operator opened this record. Both are side
  // facts on this page, so a failed read shows "unknown" in the panel instead
  // of a 500 for the whole record (`...OrNull`).
  const testerMarks = await studentTesterMarksOrNull(access.operatorId, studentId);
  const teaching = await getTeachingStateOrNull(access.operatorId);
  // Marking needs BOTH roles (fix pass, 2026-09-24): the endpoint refuses
  // either alone, so the page offers the control only when it would work.
  const canMarkTester =
    access.roles.includes("student-data") && access.roles.includes("teaching-controls");

  const s = data.profile;
  const t = data.timeOnTask;
  const canEditSubscription = access.roles.includes("cost-billing");
  const attemptsTotal = data.accuracy.reduce((n, a) => n + a.attempts, 0);
  const correctTotal = data.accuracy.reduce((n, a) => n + a.correct, 0);

  // Her year in her own curriculum's words (FR-4013), and the two flags
  // FR-4105 asks for: a value the registry does not know, and a curriculum
  // her grade does not offer (FR-4008 — a chosen one is kept and flagged; an
  // implied one is flagged too, which is how an operator finds a grade-10
  // student still stored as National before the launch, quickstart.md).
  const grade = canonicalGrade(s.grade);
  const gradeInWords = gradeDisplayLabel(s.grade, s.curriculumSystem);
  const ownCurriculum = asCurriculumId(s.curriculumSystem);
  const offered =
    grade !== null && offeredByGrade !== null
      ? (offeredByGrade.find((g) => g.grade === grade)?.curricula ?? [])
      : null;
  const notOffered = ownCurriculum !== null && offered !== null && !offered.includes(ownCurriculum);
  const seesNothing = projection !== null && projection.current.length === 0;
  const curriculumWords = ownCurriculum
    ? `${CURRICULA[ownCurriculum].label} (${ownCurriculum})`
    : `not one the product knows: “${s.curriculumSystem}”`;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        <Link href="/" className="underline-offset-2 hover:underline">
          Students
        </Link>{" "}
        / #{s.id}
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">
        {s.displayName}{" "}
        <span className="font-mono text-[14px] font-normal text-ink-faint">#{s.id}</span>
      </h1>
      <p className="mt-1 text-[13px] text-ink-soft">
        Year group {gradeInWords} ·{" "}
        {ownCurriculum ? `${CURRICULA[ownCurriculum].label} curriculum` : "curriculum not known"} ·{" "}
        {data.environment} environment · every figure below covers <strong>{ALL_TIME}</strong>{" "}
        unless it says otherwise.
      </p>

      {/* ------------------------------------------------------------ profile */}
      <Panel title="Profile">
        <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Fact k="Year group" v={`${gradeInWords} · stored as ${s.grade || "—"}`} />
          <Fact k="Gender" v={s.gender ?? "not set"} />
          <Fact k="Interests" v={s.interests.length ? s.interests.join(", ") : "none recorded"} />
          <Fact k="Language preference" v={s.languagePref} />
          <Fact
            k="Curriculum"
            v={`${curriculumWords}${curriculum ? ` · ${curriculum.source}` : ""}`}
          />
          <Fact
            k="Record status"
            v={s.studentStatus === "legacy" ? "retired (picker-era, no account)" : "active"}
          />
          <Fact k="Account" v={s.accountStatus ?? "no account"} />
          <Fact
            k="Email confirmed"
            v={s.accountStatus === null ? "—" : s.emailVerified ? "yes" : "not yet"}
          />
          <Fact
            k="Commercial status"
            v={
              s.subscriptionUpdatedAt
                ? `${s.subscriptionStatus} · set ${stamp(s.subscriptionUpdatedAt)} by ${s.subscriptionUpdatedBy ?? "an operator no longer on record"}`
                : `${s.subscriptionStatus} · never changed`
            }
          />
          {s.subscriptionNote && <Fact k="Note on the arrangement" v={s.subscriptionNote} />}
          <Fact k="Record created" v={stamp(s.createdAt)} />
          <Fact k="Last seen" v={s.lastSeenAt ? stamp(s.lastSeenAt) : "never"} />
        </dl>
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          Commercial status is shown because it is a fact about this student, and{" "}
          <strong>it gates nothing</strong>: no student surface reads it, the student is never shown
          a plan, and it records no payment. Changing it needs the cost and billing role.
        </p>
        {/* FR-2405: the editor appears only for an operator who also holds
            `cost-billing`. Hiding it is not the authorisation — the endpoint
            refuses any other role (FR-2107) — it is what stops the shell
            offering a control that would be refused. An operator holding only
            `student-data` sees the facts above and no control; one holding only
            `cost-billing` never reaches this page at all. */}
        {canEditSubscription && (
          <SubscriptionEditor
            studentId={s.id}
            current={s.subscriptionStatus}
            note={s.subscriptionNote}
          />
        )}
      </Panel>

      {/* --------------------------------------------------------- curriculum */}
      {/*
        Feature 003, FR-4105 and FR-4010…FR-4012 (contracts/console.md,
        "Student 360 — curriculum"). Her curriculum, how it was set, the two
        flags an operator must see — a value the product does not know, and a
        curriculum her grade does not offer — every change after sign-up,
        newest first, and the one control that changes it. All student data,
        on a `student-data` page, under the read this page already recorded:
        `cost-billing` never reaches it (FR-2406, privacy review F7).
      */}
      <Panel
        title="Curriculum"
        tone={curriculum === null || !curriculum.known || notOffered || seesNothing ? "attention" : "neutral"}
        right={
          <span className="flex flex-wrap items-center gap-1">
            {curriculum === null ? (
              <Chip tone="attention">could not be read</Chip>
            ) : (
              <>
                <Chip>{curriculum.source}</Chip>
                {!curriculum.known && <Chip tone="attention">unknown value</Chip>}
                {notOffered && (
                  <Chip tone="attention">
                    {curriculum.source === "chosen" ? "kept — grade no longer offers it" : "grade does not offer it"}
                  </Chip>
                )}
                {seesNothing && <Chip tone="attention">sees no course</Chip>}
                {curriculum.onboardingPending && <Chip tone="attention">Google step not finished</Chip>}
              </>
            )}
          </span>
        }
        note={
          <>
            The track of study she follows, which decides which courses the grade rules can show her
            (FR-4006). <strong>Chosen</strong> means she answered the sign-up question or the
            first-Google-sign-in step, or an operator set it; <strong>implied</strong> means it was
            stored without asking, because her grade offered one curriculum or none.
          </>
        }
      >
        <dl className="grid gap-x-8 gap-y-3 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Fact k="Curriculum" v={curriculumWords} />
          <Fact
            k="How it was set"
            v={
              curriculum === null
                ? "could not be read just now"
                : curriculum.source === "chosen"
                  ? "chosen — asked, or set by an operator"
                  : "implied — stored without asking"
            }
          />
          <Fact
            k={`What ${gradeInWords} offers at sign-up today`}
            v={
              offered === null
                ? grade === null
                  ? "no grade recorded"
                  : "could not be read just now"
                : offered.length === 0
                  ? "no curriculum — nothing is live for this grade"
                  : offered.map((c) => CURRICULA[c].label).join(" and ")
            }
          />
          <Fact
            k="Courses she can see"
            v={
              projection === null
                ? "could not be read just now"
                : projection.current.length === 0
                  ? "none — she sees the “nothing to study yet” page"
                  : projection.current.map(courseName).join(", ")
            }
          />
        </dl>

        {curriculum !== null && !curriculum.known && (
          <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink">
            The stored value <code className="font-mono text-[12px]">{curriculum.stored}</code> is not
            a curriculum the product knows, so no grade rule reaches her: she sees only what an
            exception grants (FR-4003). Set a known curriculum below.
          </p>
        )}
        {notOffered && curriculum !== null && (
          <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink">
            {curriculum.source === "chosen"
              ? `${gradeInWords} no longer offers the ${curriculumLabel(s.curriculumSystem)} curriculum. A chosen curriculum is kept when that happens and only an operator changes it (FR-4008).`
              : `${gradeInWords} does not offer the ${curriculumLabel(s.curriculumSystem)} curriculum today. If she is a real student, check which curriculum her school follows and set it below.`}
          </p>
        )}

        <h3 className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
          Every change after sign-up, newest first
        </h3>
        {curriculum === null ? (
          <p className="mt-1.5 text-[13px] text-ink-soft">
            The history could not be read just now. Nothing has been changed; reload to try again.
          </p>
        ) : curriculum.history.length === 0 ? (
          <p className="mt-1.5 text-[13px] text-ink-soft">
            Never changed. The value set at sign-up is recorded with the account&rsquo;s creation,
            not here.
          </p>
        ) : (
          <div className="mt-1.5 overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>When</Th>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th>How</Th>
                  <Th>Changed by</Th>
                  <Th>Why</Th>
                </tr>
              </thead>
              <tbody>
                {curriculum.history.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <Td mono>{stamp(c.changedAt)}</Td>
                    <Td>{curriculumLabel(c.fromCurriculum)}</Td>
                    <Td>{curriculumLabel(c.toCurriculum)}</Td>
                    <Td>
                      <Chip>{c.toSource}</Chip>
                    </Td>
                    <Td>
                      {c.reason === "grade_change_reresolved"
                        ? "re-resolved by the product on a grade change"
                        : (c.changedBy ?? "an operator no longer on record")}
                    </Td>
                    <Td>{c.note ?? <span className="text-ink-faint">no note</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* FR-4010: `student-data` is the only role that reaches this page,
            and the endpoint refuses every other role on its own (FR-2107).
            The courses each choice would show her are decided server-side by
            the gate's own rule; without them the question cannot be asked
            honestly, so the control is withheld rather than guessed. */}
        {projection === null ? (
          <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-ink-soft">
            The curriculum cannot be changed right now: what each choice would show her could not be
            read, and the change is only offered with that answer. Reload to try again.
          </p>
        ) : (
          <CurriculumEditor
            studentId={s.id}
            stored={s.curriculumSystem}
            storedLabel={ownCurriculum ? CURRICULA[ownCurriculum].label : `“${s.curriculumSystem}”`}
            currentSees={projection.current.map(courseName)}
            options={CURRICULUM_IDS.map((id) => ({
              id,
              label: CURRICULA[id].label,
              gradeLabel: gradeDisplayLabel(s.grade, id),
              sees: projection.byCurriculum[id].map(courseName),
            }))}
          />
        )}
      </Panel>

      {/* ------------------------------------------------------ course access */}
      {/*
        Migration 023 and FR-2701…FR-2711 (the course gate), per curriculum
        since 003 (FR-4105; privacy review F18). Every registry course, grouped
        under its curriculum, with the step of the gate that decided it. An
        exception for a course OUTSIDE her curriculum is labelled as exactly
        that and never folded into her own curriculum's list — it is the one
        sanctioned way across (FR-4009), and an operator must be able to tell
        it from the rule. The per-student exception is editable only here:
        `content-review`, which owns the grade rule on `/courses`, cannot reach
        this page and so cannot learn this student's name from this feature.
      */}
      <Panel
        title="Course access"
        note={
          <>
            What this student can actually see, course by course, and why. Her curriculum comes
            first: a grade rule reaches only students of that course&rsquo;s curriculum. An{" "}
            <strong>exception wins over the grade rule in both directions</strong>, and across
            curricula — it is what lets one test student see another curriculum&rsquo;s course, and
            what holds one student back from a course the rest of her grade has.
          </>
        }
      >
        {accessGroups(courseAccess, ownCurriculum).map((group) => (
          <div key={group.curriculum} className="mt-4 first:mt-0">
            <h3 className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
              {group.label} ·{" "}
              {group.own ? "her curriculum" : "not her curriculum"}
            </h3>
            <div className="overflow-x-auto rounded border border-line">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line text-ink-soft">
                    <Th>Course</Th>
                    <Th>Grade rule</Th>
                    <Th>Exception</Th>
                    <Th>Effective</Th>
                    <Th>Why</Th>
                    <Th right>Change</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr key={row.courseId} className="border-b border-line-soft last:border-0">
                      <Td>
                        <span className="block font-semibold text-ink">{courseName(row.courseId)}</span>
                        <span dir={row.dir} className="block text-[12.5px] text-ink-soft">
                          {row.labelAr}
                        </span>
                      </Td>
                      <Td>
                        <Chip tone={row.gradeState === "live" ? "good" : "neutral"}>
                          {row.gradeState === "live" ? "live" : row.gradeExplicit ? "hidden" : "not set"}
                        </Chip>
                        <span className="ms-1.5 text-[11.5px] text-ink-faint">
                          for {gradeDisplayLabel(s.grade, row.curriculum)}
                        </span>
                      </Td>
                      <Td>
                        {row.override ? (
                          <>
                            <Chip tone={row.override === "live" ? "good" : "attention"}>
                              forced {row.override}
                            </Chip>
                            {row.overrideAt && (
                              <span className="mt-1 block font-mono text-[10.5px] text-ink-faint">
                                {row.overrideBy ?? "an operator no longer on record"} ·{" "}
                                {stamp(row.overrideAt)}
                              </span>
                            )}
                            {row.overrideNote && (
                              <span className="mt-0.5 block max-w-[22ch] text-[11.5px] text-ink-soft">
                                {row.overrideNote}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-ink-faint">none</span>
                        )}
                      </Td>
                      <Td>
                        <Chip tone={row.effectiveState === "live" ? "good" : "neutral"}>
                          {row.effectiveState}
                        </Chip>
                      </Td>
                      <Td>
                        <Chip tone={row.reason === "exception-outside-curriculum" ? "attention" : "neutral"}>
                          {accessReason(row)}
                        </Chip>
                      </Td>
                      <Td right>
                        <CourseAccessEditor
                          studentId={s.id}
                          courseId={row.courseId}
                          current={row.override}
                          note={row.overrideNote}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          The grade rule column is the broad decision on{" "}
          <Link href="/courses" className="underline">
            the course availability page
          </Link>
          , for her grade ({s.grade || "none recorded"}) in each curriculum&rsquo;s words. A course
          with no rule reads &ldquo;not set&rdquo; and defaults to hidden, exactly as it does there.
        </p>
      </Panel>

      {/* ------------------------------------------------------ test account */}
      {/*
        ADR-0021. Whether this student is a TEST account, who said so and
        when, and one click to undo it. The mark changes nothing on its own:
        it matters only while the teaching switch reads "Test accounts only",
        and the panel says where that switch stands so the reader never has
        to guess what a mark is doing right now. Marking needs `student-data`
        AND `teaching-controls` — the endpoint refuses either alone.
      */}
      <Panel
        title="Test account"
        right={
          <Chip tone={testerMarks?.current ? "attention" : "neutral"}>
            {testerMarks === null
              ? "unknown"
              : testerMarks.current
                ? "test account"
                : "not a test account"}
          </Chip>
        }
        note={
          teaching === null ? (
            <>
              Socratic probing: <strong>unknown</strong> — the{" "}
              <Link href="/teaching" className="underline">
                teaching switch
              </Link>{" "}
              could not be read just now.
            </>
          ) : (
            <>
              Socratic probing is currently{" "}
              <Link href="/teaching" className="underline">
                {teaching.effective === "off"
                  ? "off for everyone"
                  : teaching.effective === "testers"
                    ? "on for test accounts only"
                    : "on for everyone"}
              </Link>
              .{" "}
              {teaching.effective === "testers"
                ? testerMarks?.current
                  ? "So this student's maths lessons probe — from their next sitting. Removing the mark stops it from their next message, for the rest of that sitting."
                  : "This student is not marked, so their lessons do not probe."
                : teaching.effective === "off"
                  ? "So a mark here changes nothing this student sees until it is switched on."
                  : "A mark here makes no difference while it is on for everyone."}
            </>
          )
        }
      >
        {testerMarks === null ? (
          <p className="text-[13px] text-ink-soft">
            This student&rsquo;s test-account marks could not be read just now. Nothing has been
            changed; reload to try again.
          </p>
        ) : (
          <>
            {testerMarks.current ? (
              <p className="text-[13px] text-ink">
                Marked by{" "}
                <strong>{testerMarks.current.markedBy ?? "an operator no longer on record"}</strong>{" "}
                at {stamp(testerMarks.current.markedAt)}
                {testerMarks.current.note ? (
                  <>
                    {" "}
                    — <span className="text-ink-soft">{testerMarks.current.note}</span>
                  </>
                ) : null}
                .
              </p>
            ) : (
              <p className="text-[13px] text-ink-soft">
                This student is taught exactly as every other student is.
              </p>
            )}
            {testerMarks.history.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px] text-ink-soft">
                {testerMarks.history.map((m) => (
                  <li key={m.id} className="font-mono">
                    marked by {m.markedBy ?? "an operator no longer on record"} {stamp(m.markedAt)}{" "}
                    · removed by {m.unmarkedBy ?? "an operator no longer on record"}{" "}
                    {m.unmarkedAt ? stamp(m.unmarkedAt) : ""}
                    {m.note ? ` · ${m.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
            {canMarkTester ? (
              <TesterMarkEditor studentId={s.id} isTester={testerMarks.current != null} />
            ) : (
              <p className="mt-3 border-t border-line-soft pt-3 text-[12.5px] leading-relaxed text-ink-soft">
                Marking or unmarking a test account needs both the{" "}
                <code className="font-mono text-[12px]">student-data</code> and the{" "}
                <code className="font-mono text-[12px]">teaching-controls</code> roles.
              </p>
            )}
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------- time on task */}
      <Panel
        title="Time on task — two numbers"
        note={
          <>
            These are <strong>never added together and never averaged into one figure</strong>. The
            first is time spent inside questions; the second is how long the sittings lasted. The
            difference between them is reading, thinking, and walking away from the screen.
          </>
        }
      >
        <div className="grid gap-6 sm:grid-cols-2">
          <Figure
            label="Inside questions"
            value={humanDuration(t.attemptMs) ?? "0 s"}
            unit="summed from each answer"
            period={ALL_TIME}
            hint={`${t.attemptsWithTime} of ${t.attemptsTotal} attempts recorded a duration; the rest contribute nothing rather than zero.`}
          />
          <Figure
            label="Sittings, wall clock"
            value={humanDuration(t.sessionWallClockMs) ?? "0 s"}
            unit="opened to closed"
            period={`${t.closedSessions} closed session${t.closedSessions === 1 ? "" : "s"}, ${ALL_TIME}`}
            hint={
              t.openSessions > 0
                ? `${t.openSessions} session${t.openSessions === 1 ? " is" : "s are"} still open and contribute${t.openSessions === 1 ? "s" : ""} nothing to this total — a running sitting has no length yet.`
                : "No session is currently open."
            }
          />
        </div>
      </Panel>

      {/* ---------------------------------------------------------- sessions */}
      <Panel
        title="Sessions"
        right={
          <Link
            href={`/students/${s.id}/sessions`}
            className="text-[12.5px] text-accent underline-offset-2 hover:underline"
          >
            Open the session list →
          </Link>
        }
      >
        <Figure
          label="Study sittings"
          value={data.sessionCount}
          unit={`sessions (${t.closedSessions} closed, ${t.openSessions} open)`}
          period={ALL_TIME}
          hint="The list is metadata only — when, how long, what kind, what it touched. Opening it is not a transcript read and is not recorded."
        />
      </Panel>

      {/* ----------------------------------------------------------- mastery */}
      <Panel
        title="Mastery by objective"
        note={
          <>
            Probability of mastery from 0 to 1, as the BKT model currently estimates it. Each
            trajectory is every estimate the objective has ever had, plotted on a fixed 0–1 axis —
            not auto-scaled, so two students&apos; lines mean the same thing. Most-revised
            objectives first.
          </>
        }
      >
        {data.mastery.length === 0 ? (
          <Empty>
            No mastery estimate exists yet. That is an untouched model, not a score of zero.
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>Objective</Th>
                  <Th>Trajectory, 0–1</Th>
                  <Th right>First estimate</Th>
                  <Th right>Current estimate</Th>
                  <Th right>Revisions</Th>
                  <Th right>Last moved</Th>
                </tr>
              </thead>
              <tbody>
                {data.mastery.map((m) => (
                  <tr key={m.loId} className="border-b border-line-soft last:border-0">
                    <Td>
                      {m.loLabel ?? "unlabelled objective"}{" "}
                      <span className="font-mono text-[11px] text-ink-faint">{m.loId}</span>
                    </Td>
                    <Td>
                      <Sparkline
                        points={m.points}
                        label={`${m.points.length} estimates, from ${m.first.toFixed(2)} to ${m.current.toFixed(2)}`}
                      />
                    </Td>
                    <Td right mono>
                      {m.first.toFixed(2)}
                    </Td>
                    <Td right mono>
                      {m.current.toFixed(2)}
                    </Td>
                    <Td right mono>
                      {m.points.length}
                    </Td>
                    <Td right mono>
                      {stamp(m.lastMovedAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* --------------------------------------------------------- accuracy */}
      <Panel
        title="Attempts and accuracy, per objective"
        note={
          <>
            {attemptsTotal} attempt{attemptsTotal === 1 ? "" : "s"} in total,{" "}
            {share(correctTotal, attemptsTotal)} correct, {ALL_TIME}. A widget answer counts as an
            attempt: a construction is a question.
          </>
        }
      >
        {data.accuracy.length === 0 ? (
          <Empty>No attempts recorded. Nothing has been answered yet.</Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>Objective</Th>
                  <Th right>Attempts</Th>
                  <Th right>Answered correctly</Th>
                  <Th right>By construction</Th>
                  <Th right>Time inside questions</Th>
                  <Th right>Last attempt</Th>
                </tr>
              </thead>
              <tbody>
                {data.accuracy.map((a, i) => (
                  <tr key={a.loId ?? `none-${i}`} className="border-b border-line-soft last:border-0">
                    <Td>
                      {a.loId == null ? (
                        <em className="text-ink-soft">
                          question no longer in the bank — the attempt survives it
                        </em>
                      ) : (
                        <>
                          {a.loLabel ?? "unlabelled objective"}{" "}
                          <span className="font-mono text-[11px] text-ink-faint">{a.loId}</span>
                        </>
                      )}
                    </Td>
                    <Td right mono>
                      {a.attempts}
                    </Td>
                    <Td right mono>
                      {share(a.correct, a.attempts)}
                    </Td>
                    <Td right mono>
                      {a.widgetAttempts}
                    </Td>
                    <Td right mono>
                      {humanDuration(a.timeMs) ?? "not recorded"}
                    </Td>
                    <Td right mono>
                      {a.lastAttemptAt ? stamp(a.lastAttemptAt) : "—"}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ----------------------------------------------------- help-seeking */}
      <Panel
        title="Help-seeking"
        note="Tutor turns grouped by the objective the sitting was about, plus photos sent in for help."
      >
        <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
          {data.helpSeeking.byObjective.length === 0 ? (
            <Empty>No tutor turns recorded against a session yet.</Empty>
          ) : (
            <ul className="space-y-1.5 text-[13px]">
              {data.helpSeeking.byObjective.map((h, i) => (
                <li key={h.loId ?? `none-${i}`} className="flex justify-between gap-4">
                  <span>
                    {h.loId == null ? (
                      <em className="text-ink-soft">sittings with no objective (open chat)</em>
                    ) : (
                      <>
                        {h.loLabel ?? "unlabelled objective"}{" "}
                        <span className="font-mono text-[11px] text-ink-faint">{h.loId}</span>
                      </>
                    )}
                  </span>
                  <span className="font-mono text-[12px] text-ink-soft">
                    {h.turns} turn{h.turns === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-4">
            <Figure
              label="Photos sent"
              value={data.helpSeeking.uploads}
              unit={`uploads (${data.helpSeeking.uploadsParsed} readable)`}
              period={ALL_TIME}
            />
            {data.helpSeeking.turnsWithNoSession > 0 && (
              <Figure
                label="Turns belonging to no session"
                value={data.helpSeeking.turnsWithNoSession}
                unit="tutor turns"
                period={ALL_TIME}
                hint="Recorded as belonging to no session rather than attached to the nearest one — a guess by timestamp would be a fabricated correlation."
              />
            )}
          </div>
        </div>
      </Panel>

      {/* -------------------------------------------------- misconceptions */}
      <Panel
        title="Misconceptions, by how often they were diagnosed"
        note="Read from the attempts the tutor diagnosed, most frequent first."
      >
        {data.misconceptions.length === 0 ? (
          <Empty>No misconception has been diagnosed for this student.</Empty>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {data.misconceptions.map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span>
                  {m.label ?? "unlabelled misconception"}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">{m.id}</span>
                </span>
                <span className="font-mono text-[12px] text-ink-soft">
                  {m.count} time{m.count === 1 ? "" : "s"} · last {stamp(m.lastSeenAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* ------------------------------------------------ understanding */}
      <Panel
        title="Understanding checks"
        note="The tutor's own rating of a session, scored 0–100, most recent first."
      >
        {data.checks.length === 0 ? (
          <Empty>No understanding check has been run for this student.</Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>When</Th>
                  <Th>Objective</Th>
                  <Th>Kind of session</Th>
                  <Th right>Score, 0–100</Th>
                  <Th>Verdict</Th>
                  <Th>Session</Th>
                </tr>
              </thead>
              <tbody>
                {data.checks.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <Td mono>{stamp(c.createdAt)}</Td>
                    <Td>
                      {c.loLabel ?? "unlabelled objective"}{" "}
                      <span className="font-mono text-[11px] text-ink-faint">{c.loId}</span>
                    </Td>
                    <Td>{c.mode}</Td>
                    <Td right mono>
                      {c.score}
                    </Td>
                    <Td>
                      <Chip tone={c.verdict === "got_it" ? "good" : "attention"}>
                        {c.verdict.replace(/_/g, " ")}
                      </Chip>
                    </Td>
                    <Td>
                      {c.sessionId == null ? (
                        <span className="text-ink-faint">no session</span>
                      ) : (
                        <Link
                          href={`/students/${s.id}/sessions/${c.sessionId}`}
                          className="font-mono text-[12px] text-accent underline-offset-2 hover:underline"
                        >
                          #{c.sessionId}
                        </Link>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------- cost */}
      <Panel title="Cost to date">
        <div className="grid gap-6 sm:grid-cols-2">
          <Cost usd={data.cost.usd} period={ALL_TIME} />
          <Figure
            label="Tutor turns"
            value={data.cost.turns}
            unit="recorded turns"
            period={
              data.cost.firstTurnAt && data.cost.lastTurnAt
                ? `${stamp(data.cost.firstTurnAt)} to ${stamp(data.cost.lastTurnAt)}`
                : ALL_TIME
            }
          />
        </div>
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          The running total for this student, imputed at list price. The cost{" "}
          <strong>over time</strong>, split between teaching and photo/OCR and reconciled against
          the period total, is on the cost and billing surface — which is where the reconciliation
          that makes those figures trustworthy is computed.
        </p>
      </Panel>

      {/* -------------------------------------------------- safety flags */}
      <Panel
        title="Safety flags"
        note="Type and time. Nothing else is stored and nothing else is shown."
      >
        {data.safetyFlags.length === 0 ? (
          <Empty>No safety flag has been raised for this student.</Empty>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {data.safetyFlags.map((f, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3">
                <Chip tone="attention">{f.flagType}</Chip>
                <span className="font-mono text-[12px] text-ink-soft">{stamp(f.occurredAt)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          A flag reaches a human channel immediately, on a path separate from this console. This
          list is a record that it happened, not a queue: there is deliberately nothing here to
          acknowledge, assign or close, because a queue somebody checks on Monday would quietly
          replace the channel that matters.
        </p>
      </Panel>

      {/* --------------------------------------------------- feedback */}
      {/* Placed immediately after the safety flags, and the adjacency is the
          point rather than an accident of ordering. Those two panels are the
          only places on this page where something might need a person to DO
          something, and they are deliberately different in kind: a flag is a
          machine's guess that reached a human channel already, while a note is
          a child's own sentence that has reached nobody until somebody reads
          it here.

          Everything above this line is derived — estimates, counts, durations,
          verdicts the tutor wrote about her. This is the one panel on the
          Student 360 carrying words SHE wrote. */}
      <Panel
        title="What this student told us"
        note={
          data.feedback.length === 0
            ? "Nothing yet."
            : `The most recent ${data.feedback.length} answer${
                data.feedback.length === 1 ? "" : "s"
              }, newest first. Notes are printed in full.`
        }
        right={
          <Link
            href={`/feedback?notes=all&student=${s.id}`}
            className="font-mono text-[11.5px] text-accent underline-offset-2 hover:underline"
          >
            Everyone&rsquo;s feedback →
          </Link>
        }
      >
        {data.feedback.length === 0 ? (
          <Empty>
            This student has not been asked yet, or has not answered. She is asked at the end of
            a lesson or a practice plan, at most once a fortnight, and never before her third
            finished sitting.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {data.feedback.map((f) => (
              <li key={f.id} className="border-b border-line-soft pb-3 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Chip
                    tone={
                      f.rating === "up" ? "good" : f.rating === "down" ? "attention" : "neutral"
                    }
                  >
                    {f.rating === "up"
                      ? "Thumbs up"
                      : f.rating === "down"
                        ? "Thumbs down"
                        : "Closed without answering"}
                  </Chip>
                  <span className="font-mono text-[12px] text-ink-soft">
                    {stamp(f.createdAt)}
                  </span>
                  <span className="text-[12.5px] text-ink-soft">
                    {f.lessonSlug ? `after lesson ${f.lessonSlug}` : "after a practice plan"}
                    {f.trigger === "long_session" ? " · a long sitting" : ""}
                  </span>
                  {f.sessionRef != null ? (
                    <Link
                      href={`/students/${s.id}/sessions/${f.sessionRef}`}
                      className="text-[12.5px] text-accent underline-offset-2 hover:underline"
                    >
                      the session it followed →
                    </Link>
                  ) : null}
                </div>
                {f.note ? (
                  // `dir="auto"` — the one place on this console where the
                  // CONTENT decides direction. A child on an Arabic course
                  // writes Arabic into this box, and rendering her sentence
                  // left-to-right would put its punctuation in the wrong place.
                  <p
                    dir="auto"
                    className="mt-1.5 whitespace-pre-wrap rounded border border-line bg-paper-deep px-3 py-2 text-[13.5px] leading-relaxed text-ink"
                  >
                    {f.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
          A note is free text written by a student about the product. Nothing scans, scores or
          classifies it, and no safety flag is ever raised from one — deliberately (migration
          025). Nothing in this console can edit or remove what she wrote.
        </p>
      </Panel>

      {/* ----------------------------------------------------- sign-ins */}
      <Panel
        title="Sign-in history"
        note={`The most recent ${data.signIns.length} security events for this student's account.`}
        right={
          <Link
            href={`/security?signins=1&student=${s.id}`}
            className="font-mono text-[11.5px] text-accent underline-offset-2 hover:underline"
          >
            Full sign-in story on Security →
          </Link>
        }
      >
        {data.signIns.length === 0 ? (
          <Empty>
            {s.accountStatus === null
              ? "This record has no account, so there is nothing to sign in to and nothing to show."
              : "No sign-in has been recorded for this account."}
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-ink-soft">
                  <Th>What happened</Th>
                  <Th>How it ended</Th>
                  <Th>From</Th>
                  <Th right>When</Th>
                </tr>
              </thead>
              <tbody>
                {data.signIns.map((e, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <Td>{e.event.replace(/_/g, " ")}</Td>
                    <Td>
                      <Chip tone={e.outcome === "success" ? "good" : "attention"}>
                        {e.outcome ?? "not recorded"}
                      </Chip>
                    </Td>
                    <Td mono>{e.ip ?? "address not recorded"}</Td>
                    <Td right mono>
                      {stamp(e.occurredAt)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* -------------------------------------------------------- audit */}
      <Panel
        title="Who has opened this student's record"
        note="Operators see their own reads here too. An audit nobody can see is an audit nobody checks."
        right={
          <Link
            href={`/security?student=${s.id}`}
            className="font-mono text-[11.5px] text-accent underline-offset-2 hover:underline"
          >
            Full read history on Security →
          </Link>
        }
      >
        <AuditPanel rows={data.audit} limit={25} />
      </Panel>

      <p className="mt-4 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
        Opening this page was recorded against your account in{" "}
        <code className="font-mono text-[12px]">operator_reads</code>, with the time and this
        student. The record cannot be edited or deleted from the console, including by you.
      </p>
    </main>
  );
}

/**
 * The access rows, grouped under their curriculum — hers first, then the
 * others in registry order (FR-4105). A course the registry lists always has
 * a curriculum, so every row lands in exactly one group.
 */
function accessGroups(rows: StudentAccessRow[], own: string | null) {
  const groups = coursesByCurriculum().map((g) => ({
    curriculum: g.curriculum,
    label: g.label,
    own: g.curriculum === own,
    rows: rows.filter((r) => r.curriculum === g.curriculum),
  }));
  return [...groups.filter((g) => g.own), ...groups.filter((g) => !g.own)].filter(
    (g) => g.rows.length > 0
  );
}

/**
 * WHY, in the words contracts/console.md gives — the step of the gate that
 * decided it (`StudentAccessRow.reason`). An exception outside her
 * curriculum says so in as many words (privacy review F18).
 */
function accessReason(row: StudentAccessRow): string {
  switch (row.reason) {
    case "exception-outside-curriculum":
      return `exception — outside her curriculum (${row.override ?? "set"})`;
    case "exception":
      return row.override === "live" ? "exception — shown" : "exception — held back";
    case "other-curriculum":
      return "not her curriculum";
    case "switch-off":
      return row.effectiveState === "live"
        ? "her curriculum; gate off, and loaded"
        : "her curriculum; gate off, not loaded";
    case "rule":
      return row.gradeState === "live"
        ? `her curriculum and live for ${row.gradeLabel}`
        : "hidden by rule";
    case "no-rule":
      return "no rule";
  }
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">{k}</dt>
      <dd className="mt-0.5 text-ink">{v}</dd>
    </div>
  );
}

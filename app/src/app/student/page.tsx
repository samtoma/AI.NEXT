import type { ReactNode } from "react";
import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getLessonContent } from "@/lib/lesson-content";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { courseIdOfSpineKey } from "@/lib/subjects";
import { resolveStudentContext } from "@/lib/student-context";
import { getCurrentLesson, isCourseComplete } from "@/lib/progression-db";
import { previousCompletedSlug, untriedObjectives } from "@/lib/progression";
import {
  deriveMasteryStage,
  deriveRecommendation,
  deriveWeakestSubskill,
  estimateMinutes,
  buildRecommendationReason,
} from "@/lib/checkin";
import { DemoStudentSwitcher } from "@/components/DemoStudentSwitcher";
import { StudentLoop } from "@/components/student/StudentLoop";
import { LessonCheckIn } from "@/components/student/LessonCheckIn";
import { LessonSession } from "@/components/student/LessonSession";
import { LessonContentView } from "@/components/student/LessonContentView";
import { SubjectHome } from "@/components/student/SubjectHome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Student — AI.Next Tutor PoC",
};

/**
 * /student — the after-school check-in.
 *   ?mode=learn    → AI-led interactive lesson (he understood nothing)
 *   ?mode=review   → quick 3-minute lock-it-in (he understood everything)
 *   ?mode=practice → the original Today's Plan loop
 *   (no mode)      → the check-in choice screen
 */
export default async function StudentPage({
  searchParams,
}: {
  searchParams: Promise<{
    mode?: string | string[];
    lesson?: string | string[];
    subject?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const mode = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const lessonSlug = Array.isArray(sp.lesson) ? sp.lesson[0] : sp.lesson;
  const subject = Array.isArray(sp.subject) ? sp.subject[0] : sp.subject;

  // Whose journey are we showing? Cookie-selected, validated against the
  // students table, default = Omar. A DEMO AFFORDANCE, NOT AUTH — auth is a
  // PRD §3 non-goal for the MVP (see lib/demo-student.ts).
  const { studentId, studentName, students } = await resolveStudentContext();

  /** The hidden switcher rides along on the browsable surfaces (triple-tap the
   *  bottom-right corner). Deliberately NOT inside a running lesson: that
   *  surface is immersive and already owns the triple-tap gesture. */
  const withSwitcher = (node: ReactNode) => (
    <>
      {node}
      <DemoStudentSwitcher students={students} currentId={studentId} />
    </>
  );

  if (mode === "practice") {
    const plan = await getStudentPlan(studentId);
    return withSwitcher(
      <StudentLoop plan={plan.items} studentName={plan.studentName} />
    );
  }

  if (mode === "learn" || mode === "review") {
    const lesson = await getLessonData(lessonSlug, studentId);
    // sealed passages (Arabic vertical): server-resolved from verified seed
    // data and pinned onto السبورة — the tutor teaches ON the text and must
    // never reference a card the student cannot see
    const content = await getLessonContent(lesson.slug);
    return (
      <LessonSession
        mode={mode}
        lesson={lesson}
        passages={content?.passages ?? []}
      />
    );
  }

  // «شرح الدرس» — the readable rich-content surface (exposition, glossary,
  // enrichment, misconceptions, interactive beats). Falls through to the
  // check-in when the lesson has no content bundle yet.
  if (mode === "read") {
    const content = await getLessonContent(lessonSlug ?? "");
    if (content) return withSwitcher(<LessonContentView content={content} />);
  }

  // No subject chosen yet → the per-subject home (never a blended score).
  // A ?lesson= link IS a choice though: the picker's chips land here, and
  // bouncing them to the home silently discarded the selection (field
  // report, 2026-07-30: "picking another lesson brings me back").
  if (!subject && !lessonSlug) {
    const summaries = await getSubjectSummaries(studentId);
    // Only show the home when more than one subject is loaded; otherwise the
    // single-subject check-in is the natural landing (math-only stays as-is).
    if (summaries.length > 1)
      return withSwitcher(
        <>
          {/* PoC (Samuel, 2026-07-30): a VISIBLE "who's studying?" dropdown
              on the home — pick a profile or create a new demo student.
              The hidden triple-tap variants stay on the other surfaces. */}
          {/* English LTR shell (constitution v2.0.0 Principle V): the picker sits
              at the inline END. Direction is NOT forced at page level — <html> has
              no dir attribute — so the Arabic verticals stay reintroducible. */}
          <div className="mx-auto flex max-w-5xl items-center justify-end px-6 pt-5">
            <DemoStudentSwitcher
              students={students}
              currentId={studentId}
              visible
            />
          </div>
          <SubjectHome summaries={summaries} studentName={studentName} />
        </>
      );
  }

  // A subject is chosen (or only one exists) → its lessons in the check-in.
  // ?subject → course by EXACT registry lookup: an unknown value yields no
  // course (and therefore the whole catalogue), never silently the maths one.
  const courseId = courseIdOfSpineKey(subject) ?? undefined;
  const allLessons = await getLessonCatalog(studentId);
  const lessons = courseId
    ? allLessons.filter((l) => l.courseId === courseId)
    : allLessons;
  // The assigned-lesson card must belong to the CHOSEN subject — otherwise it
  // falls back to the global default (a math lesson) and the whole check-in
  // renders as math even though the picker is social.
  //
  // ADR-0012: the assignment is the student's PERSISTED POINTER, not a
  // constant. This used to be `lessons[0]?.slug` — the catalogue's first row —
  // falling through to the hardcoded DEFAULT_LESSON_SLUG, which is why every
  // student saw lesson 1-1 forever however much they had mastered.
  //
  // An explicit ?lesson= still wins, and that ordering is load-bearing: the
  // picker's chips land here, and auto-advance overriding a deliberate
  // selection is the 2026-07-30 field report ("picking another lesson brings
  // me back") all over again.
  //
  // With no ?subject= and a single-course tree (the math-only case) the course
  // is unambiguous, so the pointer still applies — deriving it here is what
  // keeps the math-only default off the constant.
  const courses = [...new Set(allLessons.map((l) => l.courseId).filter(Boolean))];
  const pointerCourse = courseId ?? (courses.length === 1 ? courses[0]! : null);
  const effectiveSlug =
    lessonSlug ??
    (pointerCourse
      ? ((await getCurrentLesson(studentId, pointerCourse, allLessons)) ??
        undefined)
      : undefined);
  const lesson = await getLessonData(effectiveSlug, studentId);
  // Offer the readable «شرح الدرس» door only when this lesson has a bundle.
  const hasContent = (await getLessonContent(lesson.slug)) !== null;

  // The lesson just finished, kept visible as a collapsed row above the card
  // so a completed lesson does not simply vanish when the pointer moves on.
  //
  // Free: `allLessons` already carries this student's mastery on every
  // objective (getLessonCatalog attaches it), so the whole thing is a walk
  // over data the page has already fetched — no extra query.
  //
  // Suppressed when the student arrived via an explicit ?lesson=. That link is
  // a deliberate choice of what to look at, and decorating it with "here is
  // what you finished before this" would be answering a question nobody asked.
  const justFinished =
    !lessonSlug && pointerCourse
      ? (() => {
          const inCourse = allLessons.filter(
            (l) => l.courseId === pointerCourse
          );
          const slug = previousCompletedSlug(inCourse, lesson.slug);
          return slug ? (inCourse.find((l) => l.slug === slug) ?? null) : null;
        })()
      : null;

  // ADR-0012 terminal state — mastered AND nothing left to advance to.
  const courseComplete = await isCourseComplete(
    studentId,
    lesson.slug,
    lesson.courseId
  );

  // Check-in card derivation (Noor Play brief). recommendationReason is
  // logged here and stops here — it must never become a prop, so a client
  // component can never render it (docs/design/handoffs/noor-play).
  const masteryStage = deriveMasteryStage(lesson.los);
  const weakestSubskill = deriveWeakestSubskill(lesson.los);
  // Why a clean review can leave a lesson unfinished: review mode scripts
  // its questions from the first three objectives only, so a fourth never
  // gets an attempt and the gate cannot cross. Naming it beats leaving the
  // student to infer it from a card that did not move.
  const untried = untriedObjectives(lesson.los);
  const recommendation = deriveRecommendation(masteryStage);
  const estimates = estimateMinutes(lesson.los, lesson.questions.length);
  console.info(
    "[checkin] %s: %s",
    lesson.slug,
    buildRecommendationReason(masteryStage, weakestSubskill, recommendation)
  );

  return withSwitcher(
    <LessonCheckIn
      lesson={lesson}
      lessons={lessons}
      hasContent={hasContent}
      masteryStage={masteryStage}
      weakestSubskill={weakestSubskill?.label ?? null}
      recommendation={recommendation}
      estimates={estimates}
      completedToday={false /* no real "attempted today" signal yet — never inferred from time of day */}
      courseComplete={courseComplete}
      untriedSubskills={untried}
      justFinished={
        justFinished
          ? {
              slug: justFinished.slug,
              ref: justFinished.ref,
              title: justFinished.title,
            }
          : null
      }
      trial={null /* no trial/subscription model in this MVP — chip stays hidden */}
    />
  );
}

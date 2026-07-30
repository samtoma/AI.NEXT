import type { ReactNode } from "react";
import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getLessonContent } from "@/lib/lesson-content";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { courseIdOfSpineKey } from "@/lib/subjects";
import { resolveStudentContext } from "@/lib/student-context";
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
  if (!subject) {
    const summaries = await getSubjectSummaries(studentId);
    // Only show the home when more than one subject is loaded; otherwise the
    // single-subject check-in is the natural landing (math-only stays as-is).
    if (summaries.length > 1)
      return withSwitcher(
        <SubjectHome summaries={summaries} studentName={studentName} />
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
  const effectiveSlug = lessonSlug ?? (courseId ? lessons[0]?.slug : undefined);
  const lesson = await getLessonData(effectiveSlug, studentId);
  // Offer the readable «شرح الدرس» door only when this lesson has a bundle.
  const hasContent = (await getLessonContent(lesson.slug)) !== null;
  return withSwitcher(
    <LessonCheckIn lesson={lesson} lessons={lessons} hasContent={hasContent} />
  );
}

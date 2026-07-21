import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { StudentLoop } from "@/components/student/StudentLoop";
import { LessonCheckIn } from "@/components/student/LessonCheckIn";
import { LessonSession } from "@/components/student/LessonSession";
import { SubjectHome } from "@/components/student/SubjectHome";

/** ?subject → which course's lessons the check-in should show. */
const COURSE_OF: Record<string, string> = {
  math: "course:prep3-math-en",
  social: "course:prep3-social-ar",
};

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

  if (mode === "practice") {
    const plan = await getStudentPlan();
    return <StudentLoop plan={plan.items} studentName={plan.studentName} />;
  }

  if (mode === "learn" || mode === "review") {
    const lesson = await getLessonData(lessonSlug);
    return <LessonSession mode={mode} lesson={lesson} />;
  }

  // No subject chosen yet → the per-subject home (never a blended score).
  if (!subject) {
    const summaries = await getSubjectSummaries();
    // Only show the home when more than one subject is loaded; otherwise the
    // single-subject check-in is the natural landing (math-only stays as-is).
    if (summaries.length > 1) return <SubjectHome summaries={summaries} />;
  }

  // A subject is chosen (or only one exists) → its lessons in the check-in.
  const courseId = subject ? COURSE_OF[subject] : undefined;
  const allLessons = await getLessonCatalog();
  const lessons = courseId
    ? allLessons.filter((l) => l.courseId === courseId)
    : allLessons;
  // The assigned-lesson card must belong to the CHOSEN subject — otherwise it
  // falls back to the global default (a math lesson) and the whole check-in
  // renders as math even though the picker is social.
  const effectiveSlug = lessonSlug ?? (courseId ? lessons[0]?.slug : undefined);
  const lesson = await getLessonData(effectiveSlug);
  return <LessonCheckIn lesson={lesson} lessons={lessons} />;
}

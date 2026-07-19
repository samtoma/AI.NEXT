import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { StudentLoop } from "@/components/student/StudentLoop";
import { LessonCheckIn } from "@/components/student/LessonCheckIn";
import { LessonSession } from "@/components/student/LessonSession";

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
  searchParams: Promise<{ mode?: string | string[]; lesson?: string | string[] }>;
}) {
  const sp = await searchParams;
  const mode = Array.isArray(sp.mode) ? sp.mode[0] : sp.mode;
  const lessonSlug = Array.isArray(sp.lesson) ? sp.lesson[0] : sp.lesson;

  if (mode === "practice") {
    const plan = await getStudentPlan();
    return <StudentLoop plan={plan.items} studentName={plan.studentName} />;
  }

  if (mode === "learn" || mode === "review") {
    const lesson = await getLessonData(lessonSlug);
    return <LessonSession mode={mode} lesson={lesson} />;
  }

  const [lesson, lessons] = await Promise.all([
    getLessonData(lessonSlug),
    getLessonCatalog(),
  ]);
  return <LessonCheckIn lesson={lesson} lessons={lessons} />;
}

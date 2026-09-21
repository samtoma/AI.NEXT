import { redirect } from "next/navigation";
import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getLessonContent } from "@/lib/lesson-content";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { courseIdOfSpineKey } from "@/lib/subjects";
import { resolveStudentContext } from "@/lib/student-context";
import {
  deriveMasteryStage,
  deriveRecommendation,
  deriveWeakestSubskill,
  estimateMinutes,
  buildRecommendationReason,
} from "@/lib/checkin";
import { OutstandingScreen } from "@/components/auth/OutstandingScreen";
import { StudentLoop } from "@/components/student/StudentLoop";
import { LessonCheckIn } from "@/components/student/LessonCheckIn";
import { LessonSession } from "@/components/student/LessonSession";
import { LessonContentView } from "@/components/student/LessonContentView";
import { SubjectHome } from "@/components/student/SubjectHome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Study — Noor",
};

/**
 * /student — the after-school check-in.
 *   ?mode=learn    → AI-led interactive lesson (he understood nothing)
 *   ?mode=review   → quick 3-minute lock-it-in (he understood everything)
 *   ?mode=practice → the original Today's Plan loop
 *   (no mode)      → the check-in choice screen
 *
 * **Two gates, in this order.** Anonymous is sent to `/signin` carrying where
 * it was going, so the student lands back here rather than on a home page
 * wondering what she clicked. Unverified renders the outstanding screen
 * instead of the lesson: verification gates learning, not signing in
 * (FR-2004), and this is the surface where "learning" starts.
 *
 * The gate is here and not only in `proxy.ts`. The proxy redirects on cookie
 * *presence*, which is not authorisation and does not pretend to be — delete
 * that file and this page still refuses. Every `?mode=` branch below is
 * downstream of both checks, so no branch can be reached by a URL that skips
 * the check-in.
 *
 * The demo-student switcher that used to ride along on these surfaces is gone
 * with the cast it switched between: the student comes from the session now,
 * never from a client-writable cookie.
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

  const me = await resolveStudentContext();
  if (!me) redirect("/signin?next=/student");
  if (!me.emailVerified) {
    return <OutstandingScreen studentName={me.studentName} />;
  }
  const { studentId, studentName } = me;

  if (mode === "practice") {
    const plan = await getStudentPlan(studentId);
    return <StudentLoop plan={plan.items} studentName={plan.studentName} />;
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
    if (content) return <LessonContentView content={content} />;
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
      return <SubjectHome summaries={summaries} studentName={studentName} />;
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

  // Check-in card derivation (Noor Play brief). recommendationReason is
  // logged here and stops here — it must never become a prop, so a client
  // component can never render it (docs/design/handoffs/noor-play).
  const masteryStage = deriveMasteryStage(lesson.los);
  const weakestSubskill = deriveWeakestSubskill(lesson.los);
  const recommendation = deriveRecommendation(masteryStage);
  const estimates = estimateMinutes(lesson.los, lesson.questions.length);
  console.info(
    "[checkin] %s: %s",
    lesson.slug,
    buildRecommendationReason(masteryStage, weakestSubskill, recommendation)
  );

  return (
    <LessonCheckIn
      lesson={lesson}
      lessons={lessons}
      hasContent={hasContent}
      masteryStage={masteryStage}
      weakestSubskill={weakestSubskill?.label ?? null}
      recommendation={recommendation}
      estimates={estimates}
      completedToday={false /* no real "attempted today" signal yet — never inferred from time of day */}
      trial={null /* no trial/subscription model in this MVP — chip stays hidden */}
    />
  );
}

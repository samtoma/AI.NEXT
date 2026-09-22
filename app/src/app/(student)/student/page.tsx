import { notFound, redirect } from "next/navigation";
import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getLessonContent } from "@/lib/lesson-content";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { decideLanding } from "@/lib/student-landing";
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
 *
 * **Three gates, then — the third is the course gate** (migration 023,
 * `lib/catalog.ts`). It is NOT applied here. `getLessonData` returns `null` for
 * a course this student may not see and `getLessonCatalog` omits its lessons,
 * so this page's job is to turn a `null` into `notFound()` and nothing else.
 * Filtering here as well would put a second copy of the rule on the surface
 * most likely to grow a new `?mode=` branch — and a branch that forgot to
 * filter would serve the course, whereas a branch that forgets to handle
 * `null` fails to compile.
 *
 * **Which screen the bare `/student` address shows is `lib/student-landing.ts`**
 * and not this file. That module's header records the bug that moved it there:
 * a page that chose its lesson from a module-level default rather than from the
 * catalogue it had just fetched for this student, and therefore answered 404 to
 * every student who may not see maths. The decision is now one pure function
 * with a test per branch; what stays here is the I/O and the refusals.
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
    // Hidden course, or no such lesson — one answer for both, so a guessed
    // slug cannot be used to find out which courses exist but are off.
    if (!lesson) notFound();
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

  // ?subject → course by EXACT registry lookup: an unknown value yields no
  // course, never silently the maths one.
  const courseId = courseIdOfSpineKey(subject) ?? null;
  const allLessons = await getLessonCatalog(studentId);

  // **Which screen this is, decided in one place** (`lib/student-landing.ts`).
  //
  // The catalogue is now fetched BEFORE the decision rather than after it, and
  // that ordering is the fix rather than a tidy-up. The page used to choose the
  // home from `getSubjectSummaries`, then fall through to a lesson slug that
  // — with no `?subject=` in the URL — it never actually set, leaving
  // `getLessonData` to apply its own `DEFAULT_LESSON_SLUG` default of `"u1-1"`,
  // a MATHS lesson. Every student who may not see maths was therefore asking
  // the gate for maths on her own home page and getting `null`, and `null` is
  // `notFound()`. A student with one subject 404'd on it; a student in a grade
  // nobody has configured yet — the ordinary state of a new grade under
  // explicit allow — 404'd on everything, immediately after signing in
  // correctly. The slug can no longer come from anywhere but this student's own
  // gated list.
  //
  // `getSubjectSummaries` is now read only when the home is actually rendered,
  // so the other branches lost a query rather than gained one.
  const landing = decideLanding({ subject, courseId, lessonSlug, lessons: allLessons });

  if (landing.screen === "refused") notFound();

  if (landing.screen === "subject-home") {
    const summaries = await getSubjectSummaries(studentId);
    return <SubjectHome summaries={summaries} studentName={studentName} />;
  }

  // Nothing is available to this student yet. The SAME component as the home,
  // with an empty list: it is her home page, not an error, and rendering a 404
  // there told her nothing, told us nothing distinguishable from a mistyped
  // URL, and read as her fault.
  if (landing.screen === "nothing-yet") {
    return <SubjectHome summaries={[]} studentName={studentName} />;
  }

  // The lessons offered by the picker on the check-in: the chosen subject's,
  // or the whole gated catalogue when no subject was named.
  const lessons = courseId
    ? allLessons.filter((l) => l.courseId === courseId)
    : allLessons;
  const lesson = await getLessonData(landing.slug, studentId);
  // `allLessons` is already gated, so a null here means the ?lesson= in the URL
  // named a course this student may not see (or nothing at all). Unchanged, and
  // deliberately indistinguishable from a slug that does not exist.
  if (!lesson) notFound();
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

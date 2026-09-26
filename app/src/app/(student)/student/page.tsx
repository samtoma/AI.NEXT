import { notFound, redirect } from "next/navigation";
import { getStudentPlan } from "@/lib/queries";
import { getLessonCatalog, getLessonData } from "@/lib/lesson";
import { getLessonContent } from "@/lib/lesson-content";
import { getSubjectSummaries } from "@/lib/subject-queries";
import { decideLanding } from "@/lib/student-landing";
import { resolveStudentScope, visibleCoursesFor } from "@/lib/catalog-queries";
import { courseDef } from "@/lib/courses";
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
    // How a [[page:N]] receipt names the book (backlog #36): the one citation
    // every course she may see shares — "Ministry textbook" for a National
    // student, the Grade 10 book's own name for a Grade 10 student — or none
    // when her courses cite different books, so a page is never attributed
    // to the wrong one.
    const cites = [...(await visibleCoursesFor(studentId))]
      .map((id) => courseDef(id)?.cite)
      .filter((c) => c != null);
    const bookCite =
      cites.length > 0 && cites.every((c) => c.name === cites[0]!.name && c.edition === cites[0]!.edition)
        ? cites[0]!
        : null;
    return <StudentLoop plan={plan.items} studentName={plan.studentName} bookCite={bookCite} />;
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
  //
  // Through the course gate first (003). The bundle is read from disk by slug,
  // and this door used to open it for ANY slug — a hidden course's teaching
  // script, or another curriculum's, one hand-typed `?mode=read&lesson=` away.
  // `getLessonData` is the gate every other `?lesson=` door already goes
  // through; a refused or unknown lesson falls through to the check-in, which
  // refuses it the way it always has (404).
  if (mode === "read") {
    const gated = lessonSlug ? await getLessonData(lessonSlug, studentId) : null;
    const content =
      gated && gated.slug === lessonSlug ? await getLessonContent(gated.slug) : null;
    if (content) return <LessonContentView content={content} />;
  }

  // ?subject → course, within THIS student's scope (003). `?subject=` names a
  // subject, and a subject can now have more than one course (Prep-3 and
  // Grade-10 maths); which one she means depends on her curriculum and what
  // she may see — `courseForSubject` (lib/catalog.ts), the only subject →
  // course lookup outside the registries. An unknown value yields no course,
  // never silently the maths one; a known subject she may not see yields its
  // course, which her gated catalogue does not hold, so the landing refuses
  // it (404) exactly as before.
  const courseId =
    subject == null ? null : (await resolveStudentScope(studentId)).courseForSubject(subject);
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
  //
  // THE PERSISTED POINTER (Tamer's mastery-gated progression, ADR-0020). The
  // check-in's lesson used to be the course's first catalogue row, which is
  // why every student saw the same first lesson however much she had
  // mastered. It is now her stored pointer for the course — read from the
  // GATED catalogue, so a pointer into a course she may not see is never
  // offered — and `decideLanding` still makes the decision: an explicit
  // ?lesson= wins over the pointer (the 2026-07-30 field report, "picking
  // another lesson brings me back"), and a pointer that is not in her list
  // falls back to the first lesson exactly as before.
  //
  // The course is unambiguous when ?subject= names one, or when her gated
  // catalogue holds exactly one course. With several courses and no subject
  // the landing is the subject home and no pointer is read.
  //
  // No fallback for a database without `student_progress` (migration 028),
  // deliberately: production applies every migration before the app starts
  // (deploy/apply-migrations.sh), so a missing table fails the deploy rather
  // than reaching this read.
  const courses = [
    ...new Set(allLessons.map((l) => l.courseId).filter((c): c is string => !!c)),
  ];
  const pointerCourse = courseId ?? (courses.length === 1 ? courses[0] : null);
  const pointer =
    !lessonSlug && pointerCourse
      ? await getCurrentLesson(studentId, pointerCourse, allLessons)
      : null;
  const landing = decideLanding({
    subject,
    courseId,
    lessonSlug,
    lessons: allLessons,
    pointer,
  });

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

  // The lesson just finished, kept visible as a collapsed row above the card
  // so a completed lesson does not simply vanish when the pointer moves on.
  // Free: `allLessons` already carries this student's mastery on every
  // objective. Suppressed when she arrived via an explicit ?lesson= — that
  // link is a deliberate choice of what to look at.
  const justFinished =
    !lessonSlug && pointerCourse
      ? (() => {
          const inCourse = allLessons.filter((l) => l.courseId === pointerCourse);
          const slug = previousCompletedSlug(inCourse, lesson.slug);
          return slug ? (inCourse.find((l) => l.slug === slug) ?? null) : null;
        })()
      : null;

  // Terminal state — this is the course's last lesson and every lesson in the
  // course passes the gate (`courseComplete`, lib/progression.ts). NOT "no
  // later lesson is ready": that is also true of a student parked mid-course.
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

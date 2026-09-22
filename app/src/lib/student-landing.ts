/**
 * WHICH SCREEN `/student` SHOWS — the decision, with no database near it.
 *
 * ⚠ NO REQUIREMENT COVERS THIS MODULE. It is the landing rule of a page whose
 * course gate has eleven requirements behind it (FR-2701…FR-2711) and whose
 * *landing* has none; no FR has been invented for it and `traceability.md` was
 * not touched. Same posture as `lib/catalog.ts`, for the same reason.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS MODULE EXISTS TO MAKE IMPOSSIBLE
 * ---------------------------------------------------------------------------
 * `(student)/student/page.tsx` used to pick its lesson like this:
 *
 *     const effectiveSlug = lessonSlug ?? (courseId ? lessons[0]?.slug : undefined);
 *     const lesson = await getLessonData(effectiveSlug, studentId);
 *     if (!lesson) notFound();
 *
 * With no `?subject=` in the URL, `courseId` is undefined, so `effectiveSlug`
 * stayed `undefined` — and `getLessonData`'s own default parameter is
 * `DEFAULT_LESSON_SLUG`, which is `"u1-1"`, which is a MATHS lesson. The page
 * therefore asked for maths whenever the student had not named a subject, and
 * the course gate (migration 023) answered `null` for every student who may not
 * see maths. `null` became `notFound()`.
 *
 * Two students hit that, and the second one matters far more than the first:
 *
 *   · a student with exactly ONE visible subject, because the home screen is
 *     only rendered above two, so she fell through to this line and 404'd on
 *     her own subject;
 *   · a student with NO visible subject, i.e. **every student in a grade
 *     nobody has configured yet** — which under explicit allow is the normal
 *     state of a new grade, not an exotic one. Signing in correctly and
 *     landing on 404 is the "locked out of her own product" failure the
 *     gate's kill switch was written to prevent, happening with the gate ON.
 *
 * The cause is not the arithmetic; it is that the page took a default from a
 * module-level constant instead of from the list it had just fetched FOR this
 * student. So the rule moved here, where the student's own gated catalogue is
 * the only source of a slug and there is no constant to fall back to. There is
 * no path through `decideLanding` that can name a lesson this student's
 * catalogue does not contain — except the one the student typed herself, which
 * is deliberate and is refused downstream.
 *
 * ---------------------------------------------------------------------------
 * WHY PURE, AND WHY IT IS WORTH A FILE
 * ---------------------------------------------------------------------------
 * The same argument `lib/catalog.ts` makes about the gate. Every branch below
 * is reachable in a test in milliseconds — including "this student can see
 * nothing at all", which in a running system needs a grade with no rules, a
 * signed-in account and a browser, and which is exactly the branch that was
 * wrong. A decision that can only be observed is a decision that gets observed
 * once.
 *
 * The page keeps the I/O and the refusals: it fetches the catalogue, calls this
 * function, and turns `refused` into `notFound()`. It holds no rule of its own.
 */

/**
 * One entry of the student's GATED lesson catalogue, reduced to what the
 * decision needs. Structurally a subset of `LessonInfo` (`lib/lesson.ts`), so
 * the real catalogue is passed straight in with no mapping — a mapping step is
 * somewhere a filter can be forgotten.
 */
export type LandingLesson = {
  slug: string;
  courseId: string | null;
  /** registry subject, or `null` for a course `lib/subjects.ts` does not know */
  subject: string | null;
};

export type Landing =
  /** the per-subject home: more than one subject, so there is a choice to show */
  | { screen: "subject-home" }
  /** nothing is available to this student yet, and the home says so honestly */
  | { screen: "nothing-yet" }
  /** the check-in for one named lesson */
  | { screen: "check-in"; slug: string }
  /** the URL named something this student may not see — 404, like any other */
  | { screen: "refused" };

/**
 * How many subjects this catalogue covers.
 *
 * Counted over the REGISTRY subject rather than over `courseId`, so it matches
 * `getSubjectSummaries` exactly: a course `lib/subjects.ts` does not know rolls
 * up into no subject there, and must not be counted as one here either — or the
 * home would be shown with a card missing from it.
 */
function subjectCount(lessons: readonly LandingLesson[]): number {
  const subjects = new Set<string>();
  for (const l of lessons) if (l.subject != null) subjects.add(l.subject);
  return subjects.size;
}

export function decideLanding(input: {
  /** the raw `?subject=` value, or `undefined` when the URL carried none */
  subject: string | undefined;
  /**
   * `?subject=` resolved through the registry's EXACT lookup, or `null` for
   * "no subject named" AND for "a value the registry does not know". The two
   * are the same thing here on purpose: an unrecognised subject is not a
   * choice, so it is treated as no choice — never, ever as maths.
   */
  courseId: string | null;
  /** the raw `?lesson=` slug, or `undefined` */
  lessonSlug: string | undefined;
  /** this student's gated catalogue, in teaching order */
  lessons: readonly LandingLesson[];
}): Landing {
  const { courseId, lessonSlug, lessons } = input;

  // The student's own catalogue, narrowed to the subject they named.
  const mine = courseId ? lessons.filter((l) => l.courseId === courseId) : lessons;

  // 1. A URL that NAMES a subject gets one of two answers: the subject, or the
  //    same 404 a subject that does not exist gets. This is the non-disclosure
  //    rule and it is not softened by anything below — a guessed `?subject=`
  //    must not be usable to find out which courses exist but are switched off,
  //    so "hidden from you" and "never existed" are one answer.
  //
  //    A course that is live but has nothing loaded lands here too, and also
  //    404s. That is the same answer for a different reason, and it is the
  //    right one: there is no lesson to show either way.
  if (courseId && mine.length === 0) return { screen: "refused" };

  // 2. A URL that NAMES a lesson is carried through verbatim, including a slug
  //    for a course this student may not see. The gate that refuses it lives in
  //    `getLessonData` — one place, reached by every caller — and filtering it
  //    out here would put a second copy of the rule on the surface most likely
  //    to grow a new branch.
  if (lessonSlug) return { screen: "check-in", slug: lessonSlug };

  // 3. Nothing named. From here the answer comes only from what this student
  //    can actually see.

  //    Nothing at all — and that is a screen, not an error. It is reached by a
  //    student whose grade nobody has configured yet, which is the ordinary
  //    state of a new grade under explicit allow rather than a fault of hers.
  if (mine.length === 0) return { screen: "nothing-yet" };

  //    More than one subject and no subject chosen → the home, which is the
  //    only screen in the product that asks the student to choose anything.
  //
  //    **The threshold stays at "more than one."** With exactly one subject the
  //    home would be a menu of one: a screen whose single action is to reveal
  //    the screen underneath it. The product's rule is one clear next action
  //    per screen and a UI that assigns rather than asks, so a student with one
  //    subject goes straight to that subject's check-in — the same landing she
  //    had before any of this existed.
  if (!courseId && subjectCount(mine) > 1) return { screen: "subject-home" };

  //    One subject, or a subject the student named: the first lesson in
  //    teaching order, taken from HER list. This is the line the old bug was
  //    on, and the slug can no longer come from anywhere else.
  return { screen: "check-in", slug: mine[0].slug };
}

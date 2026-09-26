/**
 * Mastery-gated lesson progression (ADR-0020).
 *
 * Before this module, `/student` opened on a constant: the check-in derived
 * its lesson as `?lesson=` ?? the catalogue's first row ?? the hardcoded
 * `DEFAULT_LESSON_SLUG`. Mastery was computed per learning objective on every
 * attempt and then consumed only AFTER the lesson was already fixed, to pick
 * which door to recommend. It never selected the lesson.
 *
 * THE FOURTH "NEXT". This codebase already held three notions of what a
 * student should do next, and they disagree: `getStudentPlan`'s
 * weakest-eligible frontier (lib/queries.ts), the prose rule handed to the
 * Noor agent (lib/ask.ts), and plain catalogue order. ADR-0020 adds this one
 * and does not unify them. Keeping the whole rule in one module is the least
 * this can do about that — when someone does unify them, there is exactly one
 * place here to delete. `PREREQ_GATE` is DEFINED here and imported BY
 * lib/queries.ts, rather than the other way round: queries.ts opens a
 * connection pool, so importing the constant from there would drag server code
 * into a module the client can reach. One definition, no server import — the
 * same reasoning lib/lesson-slug.ts and lib/checkin.ts are already split on.
 *
 * PURE. No database, no clock. `getCurrentLesson`, `advanceIfMastered` and
 * `isCourseComplete` in lib/progression-db.ts own persistence and call the
 * decisions below (`resolvePointer`, `advanceTarget`, `courseComplete`);
 * everything here is a function of its arguments, which is what makes the
 * branching graph testable without a database.
 *
 * BOOK SECTIONS (feature 003, decision 18; FR-4313, FR-4317; the ADR-0020
 * note of 2026-09-25). A book section split into parts is ONE unit for the
 * walk: the place never moves past it until every part passes the gate, and
 * inside it the place moves to the first part not yet passed. The section
 * rules live in lib/book-sections.ts; the walk takes them as an optional
 * `SectionIndex` argument. Without one — or with one that holds no split
 * section, which is every National course — `nextLessonSlug` runs the pre-003
 * code path verbatim, so nothing a National student is walked through can
 * change (`progression-sections.test.mts` proves it on the real catalogue).
 * Only a TYPE is imported from lib/book-sections.ts: that module imports the
 * gate from here, and the index object carries the rules this walk applies.
 */
import type { SectionIndex } from "./book-sections";

/**
 * The rules need four fields, not the whole `LessonInfo`: a slug, its course,
 * and each objective's id and score. Declaring that narrowly keeps this module
 * usable from the attempt path, where building a full catalogue row (titles,
 * page ranges, subjects) would be work thrown away — and `LessonInfo`
 * satisfies these structurally, so callers holding one just pass it.
 */
export interface ProgressionLo {
  id: string;
  mastery: number;
}

export interface ProgressionLesson {
  slug: string;
  courseId: string | null;
  los: readonly ProgressionLo[];
}

/**
 * The gate: EVERY learning objective in the lesson at or above this score.
 *
 * 0.75 is the existing `mastered` band cut in lib/mastery.ts, not a new
 * number — the gate and the ramp the student is looking at must never
 * disagree about the word "mastered".
 *
 * It is `every`, not the average, and that is the whole point. The ramp
 * averages (`deriveMasteryStage`), which means 0.98 / 0.98 / 0.29 renders as
 * mastered — tolerable for a progress bar, not as the rule that decides a
 * student is done with an objective they are still at 0.29 on.
 */
export const MASTERED_GATE = 0.75;

/**
 * Prerequisite readiness threshold — a prerequisite objective counts as met at
 * or above this score. 0.5 is `getStudentPlan`'s existing gate, moved here
 * rather than copied, so the plan builder and the progression walk can never
 * disagree about what "ready" means.
 *
 * Note it sits BELOW `MASTERED_GATE`: readiness to start something is a lower
 * bar than being done with it, and with the advance rule gating on 0.75 the
 * prerequisite check rarely binds within a course anyway. It binds across
 * units, where the graph's 71 cross-lesson edges actually live.
 */
export const PREREQ_GATE = 0.5;

/** Every LO at or above the gate. An empty lesson never passes: there is no
 *  evidence of mastery in the absence of anything to have mastered. */
export function lessonGatePassed(los: readonly ProgressionLo[]): boolean {
  if (los.length === 0) return false;
  return los.every((l) => l.mastery >= MASTERED_GATE);
}

/**
 * Prerequisite readiness for a whole lesson.
 *
 * `prereqs` maps an LO to the LOs that must come before it — the same
 * `prerequisite_of` edges `getStudentPlan` reads, in the same direction
 * (src is the prerequisite, dst is the dependant). A lesson is ready when
 * every prerequisite of every one of its LOs, EXCLUDING the lesson's own LOs,
 * is at or above `gate`.
 *
 * Intra-lesson prerequisites are excluded deliberately: 131 of the 202 seeded
 * prerequisite edges are within a single lesson, and a lesson that had to be
 * partly mastered before it could be started would never become reachable.
 */
export function lessonPrereqsMet(
  lesson: ProgressionLesson,
  mastery: ReadonlyMap<string, number>,
  prereqs: ReadonlyMap<string, readonly string[]>
): boolean {
  const own = new Set(lesson.los.map((l) => l.id));
  return lesson.los.every((lo) =>
    (prereqs.get(lo.id) ?? []).every(
      (p) => own.has(p) || (mastery.get(p) ?? 0) >= PREREQ_GATE
    )
  );
}

/**
 * The next lesson after `currentSlug`, in catalogue order, skipping any whose
 * prerequisites are not met. Returns null when NO later lesson is ready — the
 * caller parks the pointer rather than wrapping or falling back.
 *
 * NULL IS NOT "END OF COURSE". It is returned both at the course's last lesson
 * and mid-course when every remaining lesson is still waiting on a
 * prerequisite. Only `courseComplete` decides the terminal state; treating
 * this null as completion once told a student parked mid-course that she had
 * finished the whole course.
 *
 * CATALOGUE ORDER, NOT THE GRAPH. "The next lesson on the graph" is not a
 * value the graph can return: `prerequisite_of` edges are LO-to-LO and there
 * is no lesson node, and collapsed to lesson level the graph branches —
 * `u1-1` alone unlocks u1-2, u1-4, u5-1 and t2u1-1, and maths has four roots
 * with no prerequisites at all. Something has to break the tie, and the
 * student's own textbook is the tie-break they can actually follow (ADR-0020).
 * The graph is still consulted, as a filter: it can veto a lesson the student
 * is not ready for, it just does not get to choose among the ready ones.
 *
 * `catalog` must already be filtered to ONE course — a pointer is per course,
 * so walking off the end of maths into geometry's neighbour course would be a
 * bug, not a feature.
 *
 * `sections` (FR-4313): the course's book sections. When it holds a split
 * section the walk is `nextPlaceBySection` below; otherwise this is the
 * pre-003 loop, unchanged.
 */
export function nextLessonSlug(
  catalog: readonly ProgressionLesson[],
  currentSlug: string,
  mastery: ReadonlyMap<string, number>,
  prereqs: ReadonlyMap<string, readonly string[]>,
  sections?: SectionIndex
): string | null {
  if (sections?.hasSplits) {
    return nextPlaceBySection(catalog, currentSlug, mastery, prereqs, sections);
  }
  const i = catalog.findIndex((l) => l.slug === currentSlug);
  if (i < 0) return null;
  for (let j = i + 1; j < catalog.length; j++) {
    if (lessonPrereqsMet(catalog[j], mastery, prereqs)) {
      return catalog[j].slug;
    }
  }
  return null;
}

/**
 * The walk when the course has a split section (FR-4313, FR-4317; the
 * ADR-0020 note of 2026-09-25). The same rule as `nextLessonSlug`, with a
 * split section as one unit:
 *
 *   1. INSIDE A SECTION. If the current lesson is a part and some OTHER part
 *      has not passed the gate, the place moves to the first such part, in
 *      part order — and nowhere else. When that part's prerequisites are not
 *      met the pointer PARKS (null) rather than leave the section. "First
 *      part not yet passed" can be an EARLIER part: a student on part 2 whose
 *      part 1 has since fallen below the gate is sent back to part 1, inside
 *      the same section, before she may leave it. The pointer never walks back
 *      across a section boundary; ADR-0020's monotonic rule holds between
 *      units.
 *   2. LEAVING. Otherwise the walk continues in catalogue order after the
 *      current unit. A lesson that is not a part is taken when ready and
 *      skipped when not — exactly today's rule. A split section is ENTERED at
 *      its first part not yet passed, when that part is ready; when it is not,
 *      the pointer PARKS: a split section with a part not passed is never
 *      skipped (SC-211: zero students moved past one). A section whose every
 *      part has passed is landed on at part 1 when ready, as a passed lesson is
 *      landed on today, and skipped when not — moving past a mastered section
 *      is allowed.
 *
 * The catalogue is first put in section order (`sections.order`, FR-4312: a
 * section's parts together, in part order) and the prerequisites get the
 * derived part n-1 → n edges (`sections.prereqsFor`, FR-4317). Both are the
 * identity for a course whose catalogue is already in that shape and has no
 * split section.
 */
function nextPlaceBySection(
  catalog: readonly ProgressionLesson[],
  currentSlug: string,
  mastery: ReadonlyMap<string, number>,
  bookPrereqs: ReadonlyMap<string, readonly string[]>,
  sections: SectionIndex
): string | null {
  const order = sections.order(catalog);
  const prereqs = sections.prereqsFor(bookPrereqs, order);
  const i = order.findIndex((l) => l.slug === currentSlug);
  if (i < 0) return null;

  const bySlug = new Map(order.map((l) => [l.slug, l] as const));
  const partsOf = (slugs: readonly string[]) =>
    slugs.map((s) => bySlug.get(s)).filter((l): l is ProgressionLesson => l !== undefined);
  const ready = (l: ProgressionLesson) => lessonPrereqsMet(l, mastery, prereqs);
  const passed = (l: ProgressionLesson) => lessonGatePassed(l.los);

  // 1. Inside a section: the first OTHER part not yet passed, or park.
  const own = sections.groupOf(currentSlug);
  if (own.split) {
    const pending = partsOf(own.slugs).find((l) => l.slug !== currentSlug && !passed(l));
    if (pending) return ready(pending) ? pending.slug : null;
  }

  // 2. Leaving: continue after the current unit.
  const visited = new Set<string>(own.split ? own.slugs : [currentSlug]);
  for (let j = i + 1; j < order.length; j++) {
    const l = order[j];
    if (visited.has(l.slug)) continue;
    const g = sections.groupOf(l.slug);
    if (!g.split) {
      if (ready(l)) return l.slug;
      continue;
    }
    for (const s of g.slugs) visited.add(s);
    const parts = partsOf(g.slugs);
    const entry = parts.find((p) => !passed(p));
    if (entry) return ready(entry) ? entry.slug : null; // never skipped
    if (parts.length > 0 && ready(parts[0])) return parts[0].slug;
  }
  return null;
}

/**
 * The lesson the pointer is on in ONE course: the stored slug while it is
 * still in that course's catalogue, otherwise the course's first lesson. Null
 * only when the course has no lessons at all.
 *
 * A stored slug can fall out of the catalogue — a content reload that renamed
 * or re-cut a lesson. Treating it as the first lesson is what keeps such a
 * student movable: the read side has always shown her the first lesson, and
 * the advance side must agree, or her attempts on the lesson she is SHOWN
 * would never match the lesson the pointer is ON, and she would be stuck.
 */
export function resolvePointer(
  inCourse: readonly { slug: string }[],
  stored: string | null | undefined
): string | null {
  if (inCourse.length === 0) return null;
  if (stored && inCourse.some((l) => l.slug === stored)) return stored;
  return inCourse[0].slug;
}

/**
 * Where the pointer moves after an attempt on `attemptedSlug`, or null when
 * it stays exactly where it is.
 *
 * It moves only when (1) the attempt was on the lesson the pointer is ON —
 * re-drilling an old lesson or answering ahead through the picker must not
 * skip a student past lessons she has not done — (2) that lesson now passes
 * the gate, and (3) some later lesson is ready. When (3) fails the pointer
 * PARKS: at the course's last lesson that is the terminal state, and mid-course
 * it simply waits for a prerequisite; neither is reported as anything here.
 *
 * With `sections` holding a split section (FR-4313), (3) is the section-aware
 * walk: a part moves to its section's first part not yet passed, and the
 * pointer never moves past a split section with a part not passed. Condition
 * (1) is unchanged — an attempt on part 3 through a direct link (FR-3206) does
 * not move a pointer that is on part 1.
 *
 * `inCourse` must be ONE course's lessons in catalogue order.
 */
export function advanceTarget(
  inCourse: readonly ProgressionLesson[],
  storedSlug: string | null | undefined,
  attemptedSlug: string,
  mastery: ReadonlyMap<string, number>,
  prereqs: ReadonlyMap<string, readonly string[]>,
  sections?: SectionIndex
): string | null {
  const current = resolvePointer(inCourse, storedSlug);
  if (current === null || current !== attemptedSlug) return null;
  const lesson = inCourse.find((l) => l.slug === current);
  if (!lesson || !lessonGatePassed(lesson.los)) return null;
  return nextLessonSlug(inCourse, current, mastery, prereqs, sections);
}

/**
 * The terminal state (ADR-0020): the card for `slug` renders "that's the whole
 * course" only when `slug` is the course's LAST catalogue lesson — where the
 * pointer parks — AND every lesson in the course passes the gate.
 *
 * The stricter of the two readings, on purpose. "The last lesson is mastered"
 * alone would still celebrate a student whose pointer reached the end by
 * skipping lessons that were not ready, and the banner tells her she has been
 * through every topic. Requiring the last lesson keeps the celebration where
 * ADR-0020 puts it — on the lesson the pointer parks on — rather than on
 * whichever lesson she happens to be viewing.
 *
 * `inCourse` must be ONE course's lessons in catalogue order.
 */
export function courseComplete(
  inCourse: readonly ProgressionLesson[],
  slug: string
): boolean {
  const last = inCourse[inCourse.length - 1];
  if (!last || last.slug !== slug) return false;
  return inCourse.every((l) => lessonGatePassed(l.los));
}

/**
 * The lesson the student most recently completed, for the collapsed "done"
 * row above the check-in card — the one that keeps a finished lesson visible
 * and one tap away instead of letting it vanish when the pointer moves on.
 *
 * NEAREST EARLIER IN CATALOGUE ORDER, not latest in time, and the difference
 * is worth stating because it is a deliberate limit. Nothing stores which
 * lesson a pointer advanced FROM (`advanced_at` records when it moved, not
 * what was left behind), so this reconstructs it from the order plus the gate.
 *
 * Walking back to the nearest PASSING lesson rather than taking the immediate
 * predecessor is what makes it correct when the walk skipped something: a
 * pointer that jumped u1-1 -> u2-1 because u1-2..u1-4 were not ready has u1-4
 * as its immediate predecessor and u1-1 as the lesson actually finished.
 *
 * For an ordinary front-to-back run the two readings coincide. They diverge
 * only for a student who completed lessons out of order through the picker,
 * where "the most recent one you finished" is genuinely ambiguous without
 * stored history — and showing the nearest completed lesson behind the
 * current one is the honest answer to a question the data cannot fully answer.
 */
export function previousCompletedSlug(
  catalog: readonly ProgressionLesson[],
  currentSlug: string
): string | null {
  const i = catalog.findIndex((l) => l.slug === currentSlug);
  if (i < 0) return null;
  for (let j = i - 1; j >= 0; j--) {
    if (lessonGatePassed(catalog[j].los)) return catalog[j].slug;
  }
  return null;
}

/**
 * The objectives keeping this lesson from passing the gate for want of any
 * evidence at all — the ones that have never been attempted.
 *
 * It lives beside the gate rather than with the check-in card's other
 * derivations because it answers a question about the gate: why has this
 * lesson not completed? A lesson completes only when EVERY objective reaches
 * `MASTERED_GATE`, but review mode scripts its questions from the first three
 * objectives alone, so on a four-objective lesson (u1-1 among them, the course
 * opener) a student can pick "Quiz me on it", answer everything correctly,
 * score `got_it` on the report, and come back to the very same card. This is
 * what lets the card say why instead of leaving them to infer it.
 *
 * `mastery === 0` means no mastery row exists, which is exactly "never
 * attempted": every BKT update clamps to MIN_SCORE (0.02), so an objective
 * answered even once — and answered wrongly every time — can never read as 0.
 * A struggling student is therefore never told their worst objective "hasn't
 * come up yet".
 *
 * RETURNS NOTHING FOR AN UNTOUCHED LESSON. Where nobody has started, every
 * objective is untried and saying so is noise: the ramp already reads "not
 * started" and the doors already say what to do. It is only ever worth saying
 * once a lesson is part-done, which is the confusing case.
 */
export function untriedObjectives(
  los: readonly { label: string; mastery: number }[]
): string[] {
  const started = los.some((l) => l.mastery > 0);
  if (!started) return [];
  return los.filter((l) => l.mastery === 0).map((l) => l.label);
}

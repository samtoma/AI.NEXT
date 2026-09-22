/**
 * Mastery-gated lesson progression (ADR-0012).
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
 * Noor agent (lib/ask.ts), and plain catalogue order. ADR-0012 adds this one
 * and does not unify them. Keeping the whole rule in one module is the least
 * this can do about that — when someone does unify them, there is exactly one
 * place here to delete. `PREREQ_GATE` is DEFINED here and imported BY
 * lib/queries.ts, rather than the other way round: queries.ts opens a
 * connection pool, so importing the constant from there would drag server code
 * into a module the client can reach. One definition, no server import — the
 * same reasoning lib/lesson-slug.ts and lib/checkin.ts are already split on.
 *
 * PURE. No database, no clock. `resolveCurrentLesson` and `advanceIfMastered`
 * in lib/progression-db.ts own persistence; everything here is a function of
 * its arguments, which is what makes the branching graph testable without a
 * database.
 */
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
 * prerequisites are not met. Returns null at the end of the course — the
 * caller parks the pointer rather than wrapping or falling back.
 *
 * CATALOGUE ORDER, NOT THE GRAPH. "The next lesson on the graph" is not a
 * value the graph can return: `prerequisite_of` edges are LO-to-LO and there
 * is no lesson node, and collapsed to lesson level the graph branches —
 * `u1-1` alone unlocks u1-2, u1-4, u5-1 and t2u1-1, and maths has four roots
 * with no prerequisites at all. Something has to break the tie, and the
 * student's own textbook is the tie-break they can actually follow (ADR-0012).
 * The graph is still consulted, as a filter: it can veto a lesson the student
 * is not ready for, it just does not get to choose among the ready ones.
 *
 * `catalog` must already be filtered to ONE course — a pointer is per course,
 * so walking off the end of maths into geometry's neighbour course would be a
 * bug, not a feature.
 */
export function nextLessonSlug(
  catalog: readonly ProgressionLesson[],
  currentSlug: string,
  mastery: ReadonlyMap<string, number>,
  prereqs: ReadonlyMap<string, readonly string[]>
): string | null {
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

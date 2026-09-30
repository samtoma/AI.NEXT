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
 */
import { masteryStage } from "@/lib/mastery";

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
 * The MASTERED cut: every learning objective at or above this score.
 *
 * 0.75 is the existing `mastered` band cut in lib/mastery.ts, not a new
 * number — this cut and the ramp the student is looking at must never
 * disagree about the word "mastered".
 *
 * **Since 2026-09-30 this is no longer the gate that moves a student on.** It
 * is the bar for `lessonMastered`, which only "the whole course" (`courseComplete`)
 * still asks for. See `lessonGatePassed` for what moves the pointer and why.
 *
 * It is `every`, not the average, and that is the whole point of keeping it for
 * the banner. The ramp averages (`deriveMasteryStage`), which means
 * 0.98 / 0.98 / 0.29 renders as mastered — tolerable for a progress bar, not as
 * the rule that tells a student they have been through every topic.
 */
export const MASTERED_GATE = 0.75;

/**
 * The lowest ramp stage that lets a lesson count as done: 2, "Getting there".
 * Read off the same banding the card shows (`masteryStage`), so the gate and
 * the word on the card cannot disagree about where "Getting there" starts.
 */
export const GATE_MIN_STAGE = 2;

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

/**
 * THE GATE — what moves the pointer, and what makes a lesson "finished".
 *
 * Amended 2026-09-30 (ADR-0020, "The gate is the ramp's second stage"). It used
 * to be every objective at 0.75, which almost nobody reached: "Quick review"
 * asks about the first three objectives only, so a four-objective lesson could
 * never pass through it, and a student could score well on everything they were
 * asked and still watch the saved place and the "Revisit" row not move.
 *
 * It now takes BOTH of:
 *
 *  1. **Every objective has been attempted.** A score of 0 means no mastery row
 *     exists (every BKT update clamps to `MIN_SCORE`, so an attempted objective
 *     never reads 0 — see `untriedObjectives`). This is the floor under the
 *     average, and it is what stops a lesson counting as done with half of it
 *     never touched: the average counts an untried objective as zero, but two
 *     well-answered objectives out of four still average high enough to reach
 *     "Getting there" on their own.
 *  2. **The lesson's average reaches "Getting there"** (`GATE_MIN_STAGE`, 0.35),
 *     the same average `deriveMasteryStage` puts on the ramp.
 *
 * What it does NOT do is check the weakest objective: 0.98 / 0.98 / 0.10 passes.
 * ADR-0020 rejected the average as a gate for that reason, and the amendment
 * accepts it knowingly, with the floor above as the mitigation. `PREREQ_GATE`
 * still guards entry into later lessons, per objective, so a hole a later lesson
 * builds on parks the pointer rather than being walked past.
 *
 * An empty lesson never passes: there is no evidence in the absence of anything
 * to have learned.
 */
export function lessonGatePassed(los: readonly ProgressionLo[]): boolean {
  if (los.length === 0) return false;
  if (los.some((l) => !(l.mastery > 0))) return false;
  const average = los.reduce((sum, l) => sum + l.mastery, 0) / los.length;
  return masteryStage(average) >= GATE_MIN_STAGE;
}

/**
 * Can this attempt have crossed the gate — is it worth the (not cheap) catalogue
 * read that decides whether the pointer moves?
 *
 * Used by /api/attempts. It used to be `isCorrect` alone, which was right while
 * the gate was "every objective at 0.75": a wrong answer only ever lowers a
 * score, so only a correct one could newly pass a lesson. The gate now also
 * needs every objective ATTEMPTED (`lessonGatePassed`), and the FIRST attempt on
 * an objective satisfies that even when it is wrong — a student whose last
 * untouched objective got a wrong answer has just met the gate and would sit on
 * the same lesson until some later correct answer happened to re-check it.
 *
 * A wrong answer on an objective that already has a score cannot newly pass:
 * it lowers one score, and the gate needs the average up and every objective
 * already attempted.
 */
export function attemptCanCrossGate(isCorrect: boolean, hadScore: boolean): boolean {
  return isCorrect || !hadScore;
}

/** Every LO at or above `MASTERED_GATE` — the strict reading, kept for the
 *  "whole course" banner, which tells her she has been through every topic.
 *  An empty lesson is never mastered. */
export function lessonMastered(los: readonly ProgressionLo[]): boolean {
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
 * `inCourse` must be ONE course's lessons in catalogue order.
 */
export function advanceTarget(
  inCourse: readonly ProgressionLesson[],
  storedSlug: string | null | undefined,
  attemptedSlug: string,
  mastery: ReadonlyMap<string, number>,
  prereqs: ReadonlyMap<string, readonly string[]>
): string | null {
  const current = resolvePointer(inCourse, storedSlug);
  if (current === null || current !== attemptedSlug) return null;
  const lesson = inCourse.find((l) => l.slug === current);
  if (!lesson || !lessonGatePassed(lesson.los)) return null;
  return nextLessonSlug(inCourse, current, mastery, prereqs);
}

/**
 * The terminal state (ADR-0020): the card for `slug` renders "that's the whole
 * course" only when `slug` is the course's LAST catalogue lesson — where the
 * pointer parks — AND every lesson in the course is MASTERED (`lessonMastered`,
 * the strict every-objective-at-0.75 reading — not the looser gate that moves
 * the pointer).
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
  return inCourse.every((l) => lessonMastered(l.los));
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
 * lesson not completed? A lesson completes only when EVERY objective has been
 * attempted (and the average reaches "Getting there"), but review mode scripts
 * its questions from the first three objectives alone, so on a four-objective
 * lesson (u1-1 among them, the course opener) a student can pick "Quiz me on
 * it", answer everything correctly, score `got_it` on the report, and come back
 * to the very same card. This is what lets the card say why instead of leaving
 * them to infer it.
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

import Link from "next/link";
import type { LessonData, LessonInfo } from "@/lib/types";
import { isRtlSubject, spineKeyOf, subjectDef } from "@/lib/subjects";
import {
  masteryColor,
  MASTERY_LEGEND,
  masteryPhrase,
  pct,
} from "@/lib/mastery";
import { MasteryFill } from "@/components/MasteryFill";
import { NoorMark } from "@/components/NoorMark";
import { deriveMasteryStage, type Recommendation } from "@/lib/checkin";
import {
  moduleHeading,
  termOfModule,
  termOfSlug,
  withoutTerm,
} from "@/lib/module-term";
import {
  BUTTON_LABEL,
  BUTTON_TERTIARY,
  HEADING,
  HONEY_BAND,
  STICKER_CARD,
  STICKER_PANEL,
  STROKE,
  STROKE_SM,
  STROKE_WIDTH_SM,
  cx,
} from "@/components/sticker";

type CheckInProps = {
  lesson: LessonData;
  lessons: LessonInfo[];
  /** true when this lesson has a rich «شرح الدرس» content bundle to read */
  hasContent?: boolean;
  masteryStage: 0 | 1 | 2 | 3 | 4;
  weakestSubskill: string | null;
  recommendation: Recommendation;
  estimates: { reteach: number; refresh: number };
  completedToday: boolean;
  /** ADR-0020 terminal state: this lesson is mastered AND it is the last one
   *  in the course, so the pointer has nowhere to advance to. Shown as a
   *  banner ABOVE the doors, never instead of them — a student who has
   *  finished everything must still be able to reopen the last lesson, or
   *  "complete" becomes a dead end. */
  courseComplete: boolean;
  /** Objective labels in THIS lesson with no attempt yet, empty when the
   *  lesson is untouched (see lib/checkin.ts). Rendered because a lesson
   *  completes only when every objective is mastered, while review mode can
   *  only ever ask about the first three — so a student can do everything
   *  right and still watch the card not move. Naming what has not come up
   *  makes that rule visible instead of mysterious. */
  untriedSubskills: string[];
  /** The lesson completed just before the current one, or null. Rendered as a
   *  quiet collapsed row ABOVE the card: the pointer moving on should not make
   *  the lesson the student just worked through disappear, and the gate can
   *  cross before they even tap Finish — so without this, a student can come
   *  back from a report card about 1-1 to a screen with no 1-1 on it. Null
   *  when they arrived via an explicit ?lesson= (page.tsx decides that). */
  justFinished: { slug: string; ref: string; title: string } | null;
  /** days remaining, or null when there is nothing to show (subscribed, or
   *  no trial model at all) — the chip must not exist in the DOM when null */
  trial: number | null;
};

/**
 * /student landing — the after-school check-in.
 *
 * DOORS FIRST (the UI assigns, it never asks the student to browse): the
 * selected lesson + the two doors are the screen; the full lesson picker
 * collapses behind a quiet "another topic?" row. Selection travels via
 * ?lesson=<slug> and re-renders THIS page only — no AI turn is ever spent
 * until a door mounts the lesson session (doors carry prefetch={false} so
 * even production route prefetching stays off this path).
 *
 * Term-1 algebra and Term-2 geometry both contain a "Unit 4" — geometry rows
 * and chips are prefixed (هندسة) to disambiguate.
 *
 * English/math renders the Noor Play check-in anatomy below (rail, sticker
 * card, mastery ramp, two instruction-to-Nour action rows — see
 * docs/design/handoffs/noor-play). The Arabic/social verticals are NOT part
 * of this brief ("English ships, Arabic stays cheap") and keep their own
 * bilingual layout below, per constitution Principle V — no Arabic-capable
 * surface is removed to ship English first.
 *
 * TRIAL MERGE (2026-09-23): the maths card is Tamer's after-school home
 * redesign (`d8a659b`, `bba9edc`, `d23417a`) with main's Principle XII token
 * rules re-applied — every stroke, radius, shadow and divider below is a Play
 * token or a `components/sticker.ts` class, and targets hold the 52px
 * `--noor-touch-min` floor. The Arabic/Social layout is main's, byte for byte
 * (review 2026-09-23 F17): the branch still carried the pre-fix Ledger card.
 */
export function LessonCheckIn(props: CheckInProps) {
  const { lesson, lessons, hasContent = false } = props;
  const social = isRtlSubject(lesson.subject);
  if (social)
    return (
      <SocialCheckIn
        lesson={lesson}
        lessons={lessons}
        hasContent={hasContent}
      />
    );
  return <PlayCheckIn {...props} />;
}

/* =============================================================================
   ENGLISH / MATH — Noor Play check-in anatomy
   ========================================================================= */

function PlayCheckIn({
  lesson,
  lessons,
  masteryStage,
  weakestSubskill,
  recommendation,
  estimates,
  completedToday,
  courseComplete,
  untriedSubskills,
  justFinished,
  trial,
}: CheckInProps) {
  const first = lesson.studentName.split(" ")[0];
  const pages = lesson.los
    .map((l) => l.sourcePage)
    .filter((p): p is number => p != null);
  const pageRange = pages.length
    ? `P.${Math.min(...pages)}–${Math.max(...pages)}`
    : null;
  // Term-2 geometry and Term-1 algebra both contain a "Unit 4", so the term
  // has to be said out loud or the subtitle is ambiguous half the year.
  const term = termOfSlug(lesson.slug);

  const modules = groupByModule(lessons);
  const q = (slug: string, subject?: LessonInfo["subject"]) =>
    `/student?${subject ? `subject=${spineKeyOf(subject)}&` : ""}lesson=${encodeURIComponent(slug)}`;

  return (
    <div className="flex min-h-full flex-col bg-paper">
      {/* Topbar. The greeting moved OFF the h1 and into here, which is what
          frees the h1 to ask a question instead of saying hello. It used to
          read "AFTER SCHOOL · OMAR" — an assumption that the student is on
          their school's track AND studying right after school, both wrong
          for someone working ahead, catching up, or revising at 11pm. */}
      <div className={cx(HONEY_BAND, "flex shrink-0 flex-wrap items-center gap-3 px-6 py-3.5")}>
        <p className="font-display text-[1.15rem] font-extrabold leading-none text-ink">
          Hi {first}
        </p>
        {/* Absent entirely when null — never "subscribed", never a zero. */}
        {trial != null && (
          <span
            className={cx(
              STROKE_SM,
              "ms-auto rounded-[var(--play-radius-pill)] bg-card px-3 py-1.5 font-mono text-[0.7rem] uppercase leading-none text-ink sticker-shadow-sm"
            )}
          >
            Trial · <span dir="ltr">{trial}</span>{" "}
            {trial === 1 ? "day" : "days"}
          </span>
        )}
      </div>

      <main className="mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-6 min-[900px]:px-8 min-[900px]:py-7 min-[1280px]:max-w-[860px]">
        <div className="flex items-center gap-3.5">
          {/* The companion is present, and carried by motion alone — bob is
              idle and the only infinite loop the system permits. 44px, the
              handoff's header/panel badge size (28 inline, 96 celebrating),
              with the mark at NoorPanel's 28 inside it. */}
          <span className={cx(STROKE, "anim-bob flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card-warm sticker-shadow")}>
            <NoorMark className="h-7 w-7" />
          </span>
          <h1 className={cx(HEADING, "text-[1.75rem] min-[1024px]:text-[2rem] min-[1280px]:text-[2.4rem]")}>
            What do you want to work on today?
          </h1>
        </div>

        {/* The lesson just finished — collapsed, still reachable.

            Quiet by construction: no sticker shadow, a soft border and smaller
            type, so it reads as context BEHIND the live card rather than a
            second thing to choose. It is still a link — staying referenceable
            is the whole point — and carries prefetch={false} like the doors,
            so hovering never spends a server render on a lesson nobody opened.

            It exists because the pointer can advance BEFORE the student taps
            Finish: the gate needs only the last objective's check question
            answered, with the closing recap still to come. Without this row a
            student returns from a report card about 1-1 to a screen with no
            1-1 anywhere on it.

            The tick takes the ramp's own `mastered` colour rather than a new
            green, so "finished" means the same thing here as in the segments
            below. No red here either: a completed lesson has no failure state.

            Restyled into the Play language after it arrived in the ledger one:
            a 1.5px hairline on a soft-grey border with no shadow, its label in
            mono uppercase, and a 44px target. On this page that reads as a
            fragment of a different product sitting above the card. It is a
            control — you press it and go somewhere — so it takes the sticker
            treatment and the press the system gives controls, at one clear
            tier below the card: a 2.5px stroke and a 3px shadow against the
            card's 3px and 4px. `checkin-press` would NOT have given it that
            — that class carries a 5px shadow, which is bigger than the card
            it sits above.

            The tick's glyph is INK on the teal, never paper. White on
            #2F9E8F measures 3.28:1 and the design system forbids it by name;
            ink on the same fill is 4.79:1. */}
        {justFinished && (
          <Link
            href={`/student?lesson=${encodeURIComponent(justFinished.slug)}`}
            prefetch={false}
            // `play-pressable-sm` (globals.css, PLAY FIXES): the base hover
            // lifts every pressable to a 5px shadow, which put this row a
            // pixel ABOVE the 4px card it is meant to sit a tier below.
            className={cx(
              STROKE_SM,
              "play-pressable play-pressable-sm sticker-shadow-sm flex min-h-[var(--noor-touch-min)] shrink-0 items-center gap-3 rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-2"
            )}
          >
            <span
              aria-hidden
              // the progress pair: teal with its on- ink (4.79:1), never paper
              className={cx(
                STROKE_SM,
                "grid h-6 w-6 shrink-0 place-items-center rounded-[var(--play-radius-pill)] bg-progress text-[0.72rem] font-extrabold text-on-progress"
              )}
            >
              ✓
            </span>
            <span className="min-w-0 flex-1 truncate font-display text-[0.92rem] font-bold text-ink">
              {justFinished.ref}
              {" — "}
              <span className="font-semibold text-ink-soft">
                {justFinished.title}
              </span>
            </span>
            <span className="shrink-0 font-display text-[0.8rem] font-bold text-[color:var(--play-text-muted)]">
              Revisit
            </span>
          </Link>
        )}

        {/* The topic card. One card, read top to bottom as context — topic,
            how far along, the one shaky part — ending in the two actions, so
            the decision sits directly under the reason for it rather than in
            separate boxes below it.

            overflow-clip, not -hidden: pure decorative corner-clipping with
            no scroll need, and it sidesteps a WebKit/Chromium bug class where
            overflow:hidden + border-radius loses the clip on relayout — the
            "corner went square after I resized" symptom, on a hard device
            target. */}
        <section className={cx(STICKER_CARD, "shrink-0 overflow-clip")}>
          <div className={cx(HONEY_BAND, "flex flex-wrap items-center gap-3 px-5 py-3")}>
            <span className="font-display text-[0.9rem] font-bold leading-none text-[var(--play-text-amber-warm)]">
              Up next
            </span>
            {/* The citation stays mono: it is a citation, and the one thing
                on the page proving Noor follows the real curriculum. Omitted
                when the topic has no textbook anchor rather than printed
                empty. Latin-only by construction, which is what mono
                requires. */}
            {pageRange && (
              <span
                dir="ltr"
                className="ms-auto font-mono text-[0.7rem] uppercase leading-none text-[var(--play-text-amber-warm)]"
              >
                Ministry textbook · {pageRange}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4 px-5 py-6 min-[900px]:px-6">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-[1.45rem] font-extrabold leading-[1.3] text-ink min-[1280px]:text-[1.7rem]">
                {lesson.title}
              </h2>
              <p className="font-read text-[0.95rem] leading-[1.6] text-ink-soft">
                Term <span dir="ltr">{term}</span> ·{" "}
                {withoutTerm(lesson.moduleLabel)}
              </p>
            </div>

            {/* The fill and its band, in words — FR-1003: "named bands
                alongside the value, never colour alone". No digit, grade or
                percentage is printed anywhere on this page (feedback #42),
                but the band word is not one of those: it is the one
                number-free way to say where she is, and the trial merge had
                dropped it. It is the skill map's own phrase for the stage
                (`masteryPhrase`), so this card and the map name a stage the
                same way. Every segment keeps its ink outline, so lit-vs-unlit
                also survives greyscale as fill-vs-empty. The printed word is
                aria-hidden because the fill's own `aria-label` already says
                it — once is enough for a screen reader. */}
            <div className="flex items-center gap-3">
              <MasteryFill
                stage={masteryStage}
                height={13}
                gap={5}
                className="min-w-0 flex-1"
              />
              <span
                aria-hidden
                className="shrink-0 whitespace-nowrap font-display text-[0.85rem] font-bold leading-none text-[color:var(--play-text-muted)]"
              >
                {masteryPhrase(masteryStage)}
              </span>
            </div>

            {/* The one gap. Naming a single sub-skill is the actionable part;
                the closing clause is what stops the sentence reading as bad
                news. Omitted entirely when there is nothing to name — an
                empty panel is worse than no panel. */}
            {weakestSubskill && (
              <p className="font-read text-[0.95rem] leading-[1.7] text-ink-soft">
                Still a bit shaky on{" "}
                <strong className="font-semibold text-ink">
                  {weakestSubskill}
                </strong>
                . Everything else is solid.
              </p>
            )}

            {/* What has not come up yet.

                This exists to answer a question the card was otherwise
                leaving unanswered. A lesson completes only when EVERY
                objective reaches the mastered band, but review mode scripts
                its questions from the first three objectives alone — so on a
                four-objective lesson (u1-1 among them, the course opener) a
                student can pick "Quiz me on it", get everything right, score
                got_it on the report, and come back to the very same card.
                Without this line there is nothing on screen to explain it.

                Counted in words, not digits: no number, grade or percentage
                is printed anywhere near the ramp. Phrased as "hasn't come up
                yet" rather than anything the student failed to do — the part
                that did not come up is the SESSION's doing, not theirs — and
                it points at the door that actually covers it. */}
            {untriedSubskills.length > 0 && (
              <p className="font-read text-[0.95rem] leading-[1.7] text-ink-soft">
                {untriedSubskills.length === 1 ? (
                  <>
                    <strong className="font-semibold text-ink">
                      {untriedSubskills[0]}
                    </strong>{" "}
                    hasn&apos;t come up yet.
                  </>
                ) : (
                  <>
                    {untriedSubskills.length === 2 ? "Two parts" : "A few parts"}{" "}
                    haven&apos;t come up yet.
                  </>
                )}{" "}
                The walk-through goes through all of it.
              </p>
            )}

            {/* ADR-0020 terminal state: every lesson in the course is mastered
                and the pointer has parked. A banner, never a replacement for
                the doors — a student who has finished everything must still
                be able to reopen the last lesson. */}
            {courseComplete && (
              <div className="rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-3.5">
                <p className="font-display text-[1.05rem] font-bold text-ink">
                  That&apos;s the whole course 🎉
                </p>
                <p className="font-read mt-1 text-[0.95rem] leading-[1.7] text-ink-soft">
                  You&apos;ve been through every topic here. Go over any of them
                  again whenever you like.
                </p>
              </div>
            )}
          </div>

          <div
            className="flex flex-col gap-2.5 bg-paper px-5 pb-5 pt-4 min-[900px]:px-[22px]"
            style={{
              borderBlockStartWidth: "var(--play-stroke)",
              borderBlockStartStyle: "solid",
              borderBlockStartColor: "var(--ink)",
            }}
          >
            {completedToday ? (
              <p className="font-read text-[0.95rem] leading-[1.7] text-ink-soft">
                Done here for today ✓
              </p>
            ) : (
              <>
                <ActionRow
                  href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
                  label="Walk me through it, step by step"
                  minutes={estimates.reteach}
                  active={recommendation === "reteach"}
                />
                <ActionRow
                  href={`/student?mode=review&lesson=${encodeURIComponent(lesson.slug)}`}
                  label="Quick review"
                  minutes={estimates.refresh}
                  active={recommendation === "refresh"}
                />
              </>
            )}
          </div>
        </section>

        {/* Change-of-mind controls, pinned to the bottom of the column.
            Bordered secondary buttons rather than the quiet text links they
            were: "Pick something else" is how a student who is NOT on their
            school's pace navigates the whole product, and a dotted underline
            at the bottom of the page was too small a door for that. Still a
            clear tier below the two rows above: the thin 2.5px stroke
            against their 3px, the small 3px sticker shadow against their
            5px, and never the amber fill. They wear the Revisit row's
            anatomy (`sticker-shadow-sm play-pressable`), not `checkin-press`
            — that class carries the rows' own 5px shadow, which is what
            made the old "smaller shadow" here untrue, and it outranked the
            amber focus ring. */}
        <div className="mt-auto flex flex-wrap items-start gap-3 pt-1.5">
          {/* `w-fit` closed so the trigger stays a button beside its
              neighbour; `open:w-full` so the panel underneath gets the whole
              column rather than being squeezed into the trigger's width.
              Without the pair, opening the picker stretched the trigger to
              full width and shoved "Just practise" onto its own line for no
              reason. */}
          <details className="group w-fit open:w-full">
            <summary className={cx(STROKE_SM, "play-pressable play-pressable-sm sticker-shadow-sm flex min-h-[var(--noor-touch-min)] w-fit cursor-pointer list-none items-center gap-2 rounded-[var(--play-radius-sm)] bg-card px-4 font-display text-[0.92rem] font-bold text-ink [&::-webkit-details-marker]:hidden")}>
              Pick something else
              <span
                aria-hidden
                className="text-[0.7rem] transition-transform duration-200 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>

            {/* Open, this is a map of the course, not a list of links. Every
                row carries how solid the student is on it — a unit ramp with
                its stage in words, and a dot per lesson — because the whole
                question being answered here is "what should I do instead?"
                and bare lesson numbers cannot answer it. The dots and the
                ramp read off the SAME banding the card above uses, so the
                picker can never disagree with the topic it opens. */}
            <div className={cx(STICKER_PANEL, "mt-3 w-full overflow-clip")}>
              <div className={cx(HONEY_BAND, "flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5")}>
                <span className="font-display text-[0.9rem] font-bold leading-none text-[var(--play-text-amber-warm)]">
                  Everything in the book
                </span>
                {/* The legend earns its place: a coloured dot with nothing
                    explaining it is decoration. */}
                <span className="ms-auto flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={cx(STROKE_SM, "size-3 rounded-[var(--play-radius-pill)]")}
                    style={{ background: MASTERY_LEGEND[3].color }}
                  />
                  <span className="font-read text-[0.78rem] leading-none text-[color:var(--play-text-muted)]">
                    = how solid you are on it
                  </span>
                </span>
              </div>

              <div className="px-4 py-1">
                {modules.map((m, mi) => {
                  const geo = m.id.startsWith("module:geo");
                  const term = termOfModule(m.id);
                  // "Unit 1 — Relations and Functions" arrives as one string;
                  // the design wants the number as a mono eyebrow and the
                  // name as the row title, so split on the em dash and fall
                  // back to the whole label when there isn't one.
                  const plain = withoutTerm(m.label);
                  const [unitRef, ...rest] = plain.split(" — ");
                  const unitName = rest.join(" — ") || plain;
                  return (
                    <div
                      key={m.id}
                      className="flex flex-col gap-2.5 py-3.5"
                      style={
                        mi < modules.length - 1
                          ? {
                              // a divider inside a panel: the line-soft token
                              borderBlockEndWidth: "var(--play-stroke-sm)",
                              borderBlockEndStyle: "solid",
                              borderBlockEndColor: "var(--line-soft)",
                            }
                          : undefined
                      }
                    >
                      {/* No unit-level ramp. It aggregated the very lessons
                          listed directly underneath it, so the row said the
                          same thing twice and the louder copy was the vaguer
                          one — a unit average cannot tell you WHICH lesson is
                          weak, which is the only question this list exists to
                          answer. The dots do, one per lesson. */}
                      <div className="flex flex-col gap-0.5">
                        <span className="font-mono text-[0.7rem] uppercase leading-[1.4] tracking-[0.06em] text-[var(--play-text-amber-warm)]">
                          Term <span dir="ltr">{term}</span>
                          {unitRef !== unitName && ` · ${unitRef}`}
                        </span>
                        <span className="font-display text-[1.05rem] font-bold leading-[1.35] text-ink">
                          {unitName}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {m.lessons.map((l) => {
                          const selected = l.slug === lesson.slug;
                          const stage = deriveMasteryStage(l.los);
                          // What the chip SHOWS, so the accessible name
                          // starts with the visible label (WCAG 2.5.3) — it
                          // used to drop "Geo", and "Unit 4" exists in both
                          // terms.
                          const visible = `${geo ? "Geo " : ""}${l.ref.replace(/^Lesson /, "")}`;
                          return (
                            <Link
                              key={l.slug}
                              href={q(l.slug, m.subject)}
                              scroll={false}
                              prefetch={false}
                              aria-current={selected ? "true" : undefined}
                              aria-label={`${visible} — ${masteryPhrase(stage)}`}
                              title={`${l.title} — ${masteryPhrase(stage)}`}
                              className={cx(
                                "flex min-h-[var(--noor-touch-min)] items-center gap-2 rounded-[var(--play-radius-pill)] border-[length:var(--play-stroke-sm)] border-solid px-3.5 font-display text-[0.85rem] leading-none transition-colors",
                                selected
                                  ? "border-ink bg-ink font-bold text-paper"
                                  : "border-[color:var(--play-inactive-border)] bg-card font-semibold text-ink hover:border-ink"
                              )}
                            >
                              {/* The legend swatch's anatomy: the thin
                                  stroke round the ramp colour. Unoutlined, the
                                  dot was colour-only and under 3:1 against
                                  white on four of five stages; outlined, it
                                  reads as filled-vs-empty like the fill
                                  segments do, and not-started can be the
                                  ramp's own step 0 instead of a borrowed
                                  grey. The band is also in the chip's name
                                  and `title`. Paper outline on the selected
                                  (ink) chip, where an ink one would vanish. */}
                              <span
                                aria-hidden
                                className={cx(
                                  STROKE_WIDTH_SM,
                                  "size-3 shrink-0 rounded-[var(--play-radius-pill)]",
                                  selected ? "border-paper" : "border-ink"
                                )}
                                style={{
                                  background: MASTERY_LEGEND[stage].color,
                                }}
                              />
                              {geo && <span>Geo</span>}
                              <span dir="ltr">
                                {l.ref.replace(/^Lesson /, "")}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </details>

          <Link
            href="/student?mode=practice"
            prefetch={false}
            className={cx(STROKE_SM, "play-pressable play-pressable-sm sticker-shadow-sm flex min-h-[var(--noor-touch-min)] items-center rounded-[var(--play-radius-sm)] bg-card px-4 font-display text-[0.92rem] font-bold text-ink")}
          >
            Just practise — today&apos;s plan
          </Link>
        </div>
      </main>
    </div>
  );
}

/**
 * One of the two action rows.
 *
 * EQUAL in every dimension that can be measured — height, target, border,
 * shadow, type. Only the fill differs, and only on the recommended one.
 * Shrinking or reordering the other would turn a default into a verdict,
 * which is the same reason no badge explains the amber: the fill is the
 * whole signal, and naming it says Noor has formed a view about the student.
 * With no recommendation both are white and the page carries no accent at
 * all.
 *
 * Both labels are INSTRUCTIONS TO NOOR — "walk me through it", "quick
 * review". Neither asks the student to describe their own state. The pair
 * this replaced was "I'm lost" against "I got it": a confession set against
 * a claim, which made the two incomparable and put the anxious answer first.
 *
 * Minutes, not turns: "≤5 AI turns" is engineering language, and time is
 * both the only thing this student weighs and the named brand promise. The
 * estimate comes from real content length — a wrong one costs more trust
 * than none. The arrow glyph is swapped for RTL, never mirrored by a
 * transform.
 */
function ActionRow({
  href,
  label,
  minutes,
  active,
}: {
  href: string;
  label: string;
  minutes: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cx(
        STROKE,
        "checkin-press flex min-h-[60px] items-center gap-3.5 rounded-[var(--play-radius)] px-5 py-3 text-start",
        active ? "bg-[var(--noor-action)] text-[color:var(--noor-on-action)]" : "bg-card text-ink"
      )}
    >
      <span className="flex-1 font-display text-[1.1rem] font-extrabold leading-[1.3] text-ink min-[900px]:text-[1.2rem]">
        {label}
      </span>
      <span
        className={`whitespace-nowrap font-display text-[0.85rem] font-bold leading-none ${
          active
            ? "text-[var(--play-text-on-amber-s)]"
            : "text-[color:var(--play-text-muted)]"
        }`}
      >
        <span dir="ltr">{minutes}</span> min
      </span>
      <span
        aria-hidden
        className="font-display text-[1.1rem] font-extrabold leading-none text-ink"
      >
        →
      </span>
    </Link>
  );
}

/* Every target on this page holds the Play floor: 52px, `--noor-touch-min`
   ("not 44 — fast, imprecise taps, holds on desktop too"), which main's Play
   pass applied everywhere else. The branch this card came from used the
   build spec's 48px floor, and its mockup drew less still — the two
   change-of-mind buttons at 46 and the picker's lesson chips at 40. A
   tap-target minimum is a floor rather than a taste call, so the design
   system's number wins over both the spec and the drawing; 37 of the 40
   targets on this page were under 48 before it. */

/* Which term a module belongs to, and its label without the term: the
   helpers live in lib/module-term.ts (FR-3218). Every Term 2 label names its
   term and no Term 1 label does, so this page prints the term itself and
   strips it from the label first — it never prefixes a stored label as-is. */

function groupByModule(lessons: LessonInfo[]) {
  const modules: {
    id: string;
    label: string;
    subject: LessonInfo["subject"];
    lessons: LessonInfo[];
  }[] = [];
  for (const l of lessons) {
    const m = modules.find((x) => x.id === l.moduleId);
    if (m) m.lessons.push(l);
    else
      modules.push({
        id: l.moduleId,
        label: l.moduleLabel,
        subject: l.subject,
        lessons: [l],
      });
  }
  return modules;
}

/**
 * One lesson in the "different topic" picker, in both layouts. A real 52px
 * target (the handoff's floor holds on desktop too), a thin ink sticker that
 * presses; the current lesson is the filled ink one and carries no shadow,
 * because it is where she already is. Hover lives in `.play-pressable`,
 * behind `(hover: hover)`, so an iPad tap leaves no sticky state.
 */
function lessonChip(selected: boolean, mono: boolean) {
  return cx(
    STROKE_SM,
    "inline-flex min-h-[var(--noor-touch-min)] min-w-[var(--noor-touch-min)] items-center justify-center rounded-[var(--play-radius-pill)] px-3 text-[0.85rem] leading-none",
    // Latin lesson refs take the data face; an Arabic one never does.
    mono ? "font-mono font-medium" : "font-display font-bold",
    selected ? "bg-ink text-paper" : "bg-card text-ink sticker-shadow-sm play-pressable"
  );
}

/** A door card on the Arabic/Social check-in: a big sticker that presses. */
const DOOR = cx(
  STROKE,
  "group block h-full rounded-[var(--play-radius-lg)] bg-card px-6 pb-5 pt-6 sticker-shadow play-pressable"
);
/** The button-shaped label inside a door — the whole card is the link. */
const DOOR_BUTTON = cx(BUTTON_LABEL, "mt-4");

/* =============================================================================
   ARABIC / SOCIAL — its own bilingual layout (kept reintroducible,
   constitution Principle V). Not part of the Noor Play check-in brief.
   ========================================================================= */

function SocialCheckIn({
  lesson,
  lessons,
  hasContent: _hasContent,
}: {
  lesson: LessonData;
  lessons: LessonInfo[];
  hasContent: boolean;
}) {
  const ar = (s: string | number) =>
    String(s).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  const pages = lesson.los
    .map((l) => l.sourcePage)
    .filter((p): p is number => p != null);
  const pageSpan = pages.length
    ? `ص${ar(Math.min(...pages))}–${ar(Math.max(...pages))}`
    : "";

  const modules = groupByModule(lessons);
  const isGeoModule = (id: string) => id.startsWith("module:geo");
  const q = (slug: string, subject?: LessonInfo["subject"]) =>
    `/student?${subject ? `subject=${spineKeyOf(subject)}&` : ""}lesson=${encodeURIComponent(slug)}`;
  const selectedIsGeo = lesson.slug.startsWith("geo");

  return (
    <main className="mx-auto max-w-3xl px-6 pb-16">
      <section className="anim-rise pb-6 pt-10">
        <p className="rule-label mb-4">After school · {lesson.studentName.split(" ")[0]}</p>
        <h1 className={cx(HEADING, "flex flex-wrap items-baseline gap-x-3 text-[1.9rem] md:text-[2.4rem]")}>
          <span dir="rtl" className="text-accent-deep">
            إزاي كان درس النهاردة؟
          </span>
          <span className="text-ink-faint">/</span>
          <span>How did today&apos;s lesson go?</span>
        </h1>
      </section>

      <section className={cx(STICKER_CARD, "anim-rise overflow-hidden")} style={{ animationDelay: "100ms" }}>
        <div dir="rtl" className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-5 py-2.5")}>
          <span className="text-[0.85rem] font-bold text-ink">
            النهاردة في المدرسة
          </span>
          <span className="text-[0.85rem] font-bold text-ink-faint">كتاب الوزارة · {pageSpan}</span>
        </div>

        <div dir="rtl" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
          <div>
            <p className="font-display text-[1.5rem] font-extrabold leading-[1.3] text-ink">
              {selectedIsGeo && (
                <span dir="rtl" className="me-2 text-[1rem] text-gold">
                  هندسة
                </span>
              )}
              <span className="ms-0 me-2 text-[1rem] text-gold">
                {subjectDef(lesson.subject).labelArShort}
              </span>
              {lesson.lessonRef} — {lesson.title}
            </p>
            <p className="mt-0.5 text-[0.85rem] font-bold text-ink-faint">
              {subjectDef(lesson.subject).labelAr} · {lesson.moduleLabel}
            </p>
          </div>
          <div className="space-y-1">
            {lesson.los.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                {/* Outlined, so the not-started step (the inactive fill) is
                    still a visible dot on the white card. */}
                <span
                  className={cx(STROKE_SM, "h-3.5 w-3.5 shrink-0 rounded-[var(--play-radius-pill)]")}
                  style={{ backgroundColor: masteryColor(l.mastery, 1, l.mastery > 0) }}
                />
                <span className="text-[0.9rem] text-ink-soft">{l.label}</span>
                <span className="font-mono text-[0.72rem] font-medium text-ink-faint">{pct(l.mastery)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        {/* The two doors are ONE anatomy (F17): same stroke, radius, shadow
            and press, told apart by their words and by the fill of the
            button inside — amber on the recommended "teach me" (the one
            amber on this screen), white on the other. */}
        {/* `anim-rise` sits on a wrapper, never on the door itself: an
            animation that fills `both` keeps its last transform, which
            outranks the press's `translate` and freezes the control. */}
        <div className="anim-rise" style={{ animationDelay: "180ms" }}>
        <Link
          href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className={DOOR}
        >
          <p dir="rtl" className="font-display text-[1.5rem] font-extrabold leading-[1.3] text-ink">
            مش فاهم حاجة
          </p>
          <p dir="rtl" className="mt-1.5 text-[1rem] font-bold text-ink">
            اشرحهولي من الأول خالص.
          </p>
          <p dir="rtl" className="mt-3 text-[0.85rem] font-bold text-ink-faint">
            درس تفاعلي · خرايط ورسومات · تقرير فهم بأمانة
          </p>
          <span
            dir="rtl"
            className={cx(DOOR_BUTTON, "bg-[var(--noor-action)] text-[color:var(--noor-on-action)]")}
          >
            علّمني ←
          </span>
        </Link>
        </div>

        <div className="anim-rise" style={{ animationDelay: "260ms" }}>
        <Link
          href={`/student?mode=review&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className={DOOR}
        >
          <p dir="rtl" className="font-display text-[1.5rem] font-extrabold leading-[1.3] text-ink">
            فهمت كله ✓
          </p>
          <p dir="rtl" className="mt-1.5 text-[1rem] font-bold text-ink">
            فاهمه — مراجعة سريعة في ٣ دقايق.
          </p>
          <p dir="rtl" className="mt-3 text-[0.85rem] font-bold text-ink-faint">
            ٣ أسئلة سريعة · تحدي واحد · وخلصنا
          </p>
          <span dir="rtl" className={cx(DOOR_BUTTON, "bg-card text-ink")}>
            ثبّته ←
          </span>
        </Link>
        </div>
      </section>

      <details className="anim-rise group mt-5" style={{ animationDelay: "340ms" }}>
        <summary className={cx(STICKER_PANEL, "play-pressable flex min-h-[var(--noor-touch-min)] cursor-pointer list-none items-center justify-between px-5 py-3 [&::-webkit-details-marker]:hidden")}>
          <span className="flex items-baseline gap-2.5">
            <span dir="rtl" className="font-display text-[1.05rem] font-bold text-ink">
              درس تاني؟
            </span>
            <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
              pick a different school lesson
            </span>
          </span>
          <span aria-hidden className="text-[0.85rem] text-ink-faint transition-transform duration-200 group-open:rotate-180">
            ▾
          </span>
        </summary>

        <div className={cx(STICKER_PANEL, "mt-2 space-y-2.5 px-5 pb-4 pt-3.5")}>
          {modules.map((m) => (
            <div key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              {isRtlSubject(m.subject) ? (
                <span dir="rtl" className="w-full text-[0.85rem] font-bold text-ink-faint sm:w-56 sm:shrink-0">
                  {subjectDef(m.subject!).labelArShort} · {m.label}
                </span>
              ) : (
                <span className="w-full font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint sm:w-56 sm:shrink-0">
                  {moduleHeading(m.id, m.label)}
                </span>
              )}
              <span className="flex flex-wrap gap-1.5">
                {m.lessons.map((l) => {
                  const selected = l.slug === lesson.slug;
                  const geo = isGeoModule(m.id);
                  const soc = isRtlSubject(m.subject);
                  return (
                    <Link
                      key={l.slug}
                      href={q(l.slug, m.subject)}
                      scroll={false}
                      prefetch={false}
                      dir={soc ? "rtl" : undefined}
                      title={`${geo ? "Geometry · " : soc ? `${subjectDef(m.subject!).labelArShort} · ` : ""}${l.ref} — ${l.title}`}
                      aria-current={selected ? "true" : undefined}
                      className={lessonChip(selected, !soc)}
                    >
                      {geo && (
                        <span dir="rtl" className="me-1">
                          هندسة
                        </span>
                      )}
                      {l.ref.replace(/^Lesson /, "")}
                    </Link>
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      </details>

      <p className="anim-rise mt-6 text-center" style={{ animationDelay: "420ms" }}>
        <Link
          href="/student?mode=practice"
          prefetch={false}
          className={BUTTON_TERTIARY}
        >
          just practice — today&apos;s plan →
        </Link>
      </p>
    </main>
  );
}

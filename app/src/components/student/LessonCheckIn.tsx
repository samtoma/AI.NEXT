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
  /** ADR-0012 terminal state: this lesson is mastered AND it is the last one
   *  in the course, so the pointer has nowhere to advance to. Shown as a
   *  banner ABOVE the doors, never instead of them — a student who has
   *  finished everything must still be able to reopen the last lesson, or
   *  "complete" becomes a dead end. */
  courseComplete: boolean;
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
 * of this brief ("English ships, Arabic stays cheap") and keep the prior
 * bilingual rendering untouched below, per constitution Principle V — no
 * Arabic-capable surface is removed to ship English first.
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
      <div
        className="flex shrink-0 flex-wrap items-center gap-3 bg-card-warm px-6 py-3.5"
        style={{
          borderBlockEndWidth: 3,
          borderBlockEndStyle: "solid",
          borderBlockEndColor: "var(--ink)",
        }}
      >
        <p className="font-display text-[1.15rem] font-extrabold leading-none text-ink">
          Hi {first}
        </p>
        {/* Absent entirely when null — never "subscribed", never a zero. */}
        {trial != null && (
          <span
            className="ms-auto rounded-full border-[2.5px] border-ink bg-card px-3 py-1.5 font-mono text-[0.7rem] uppercase leading-none text-ink"
            style={{ boxShadow: "2px 2px 0 var(--ink)" }}
          >
            Trial · <span dir="ltr">{trial}</span>{" "}
            {trial === 1 ? "day" : "days"}
          </span>
        )}
      </div>

      <main className="mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-6 min-[900px]:px-8 min-[900px]:py-7 min-[1280px]:max-w-[860px]">
        <div className="flex items-center gap-3.5">
          {/* The companion is present, and carried by motion alone — bob is
              idle and the only infinite loop the system permits. */}
          <span className="anim-bob flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-card-warm sticker-shadow">
            <NoorMark className="h-[34px] w-[34px]" />
          </span>
          <h1 className="font-display text-[1.75rem] font-extrabold leading-[1.2] text-ink min-[1024px]:text-[2rem] min-[1280px]:text-[2.4rem]">
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
            below. No red here either: a completed lesson has no failure state. */}
        {justFinished && (
          <Link
            href={`/student?lesson=${encodeURIComponent(justFinished.slug)}`}
            prefetch={false}
            className="flex shrink-0 items-center gap-2.5 rounded-[16px] border-[1.5px] border-line-soft bg-card-warm px-4 py-2.5 transition-colors hover:border-ink"
          >
            <span
              aria-hidden
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-paper"
              style={{ background: MASTERY_LEGEND[4].hex }}
            >
              ✓
            </span>
            <span className="font-read min-w-0 flex-1 truncate text-[0.9rem] text-ink-soft">
              <span className="font-medium text-ink">{justFinished.ref}</span>
              {" — "}
              {justFinished.title}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
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
        <section className="shrink-0 overflow-clip rounded-[24px] border-[3px] border-ink bg-card sticker-shadow">
          <div
            className="flex flex-wrap items-center gap-3 bg-card-warm px-5 py-3"
            style={{
              borderBlockEndWidth: 3,
              borderBlockEndStyle: "solid",
              borderBlockEndColor: "var(--ink)",
            }}
          >
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

            {/* Fill only. The band name that used to sit under this ("FAMILIAR")
                is gone: the ramp plus the one named sub-skill below is the
                whole progress story, and no digit, grade or stage name is
                printed anywhere on this page. Colour is still not the only
                carrier — every segment keeps its ink outline, so lit-vs-unlit
                survives greyscale as fill-vs-empty, and the component's
                aria-label states the stage in words for the screen reader. */}
            <MasteryFill stage={masteryStage} height={13} stroke={2} gap={5} />

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

            {/* ADR-0012 terminal state: every lesson in the course is mastered
                and the pointer has parked. A banner, never a replacement for
                the doors — a student who has finished everything must still
                be able to reopen the last lesson. */}
            {courseComplete && (
              <div className="rounded-[16px] bg-card-warm px-4 py-3.5">
                <p className="font-display text-[1.05rem] font-bold text-ink">
                  That&apos;s the whole course ð
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
              borderBlockStartWidth: 3,
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
            clear tier below the two rows above — thinner stroke, smaller
            shadow, no fill. */}
        <div className="mt-auto flex flex-wrap items-start gap-3 pt-1.5">
          {/* `w-fit` closed so the trigger stays a button beside its
              neighbour; `open:w-full` so the panel underneath gets the whole
              column rather than being squeezed into the trigger's width.
              Without the pair, opening the picker stretched the trigger to
              full width and shoved "Just practise" onto its own line for no
              reason. */}
          <details className="group w-fit open:w-full">
            <summary className="checkin-press flex min-h-[46px] w-fit cursor-pointer list-none items-center gap-2 rounded-[16px] border-[2.5px] border-ink bg-card px-4 font-display text-[0.92rem] font-bold text-ink [&::-webkit-details-marker]:hidden">
              Pick something else
              <span
                aria-hidden
                className="text-[0.7rem] transition-transform duration-200 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>

            {/* Open, this is a map of the course, not a list of links. Every
                row carries how solid the student is on it â a unit ramp with
                its stage in words, and a dot per lesson â because the whole
                question being answered here is "what should I do instead?"
                and bare lesson numbers cannot answer it. The dots and the
                ramp read off the SAME banding the card above uses, so the
                picker can never disagree with the topic it opens. */}
            <div className="mt-3 w-full overflow-clip rounded-[20px] border-[3px] border-ink bg-card sticker-shadow">
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-card-warm px-4 py-2.5"
                style={{
                  borderBlockEndWidth: 3,
                  borderBlockEndStyle: "solid",
                  borderBlockEndColor: "var(--ink)",
                }}
              >
                <span className="font-display text-[0.9rem] font-bold leading-none text-[var(--play-text-amber-warm)]">
                  Everything in the book
                </span>
                {/* The legend earns its place: a coloured dot with nothing
                    explaining it is decoration. */}
                <span className="ms-auto flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full border-[1.5px] border-ink"
                    style={{ background: MASTERY_LEGEND[3].hex }}
                  />
                  <span className="font-read text-[0.78rem] leading-none text-ink-soft">
                    = how solid you are on it
                  </span>
                </span>
              </div>

              <div className="px-4 py-1">
                {modules.map((m, mi) => {
                  const geo = m.id.startsWith("module:geo");
                  const term = termOfModule(m.id);
                  // "Unit 1 â Relations and Functions" arrives as one string;
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
                              borderBlockEndWidth: 2,
                              borderBlockEndStyle: "solid",
                              borderBlockEndColor: "#EDE4CE",
                            }
                          : undefined
                      }
                    >
                      {/* No unit-level ramp. It aggregated the very lessons
                          listed directly underneath it, so the row said the
                          same thing twice and the louder copy was the vaguer
                          one â a unit average cannot tell you WHICH lesson is
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
                          return (
                            <Link
                              key={l.slug}
                              href={q(l.slug, m.subject)}
                              scroll={false}
                              prefetch={false}
                              aria-current={selected ? "true" : undefined}
                              aria-label={`${l.ref} — ${masteryPhrase(stage)}`}
                              className={`flex min-h-[40px] items-center gap-2 rounded-full px-3.5 font-display text-[0.85rem] leading-none transition-colors ${
                                selected
                                  ? "border-[2.5px] border-ink bg-ink font-bold text-card-warm"
                                  : "border-2 border-[#C9C2E0] bg-card font-semibold text-ink hover:border-ink"
                              }`}
                            >
                              <span
                                aria-hidden
                                className="h-[9px] w-[9px] shrink-0 rounded-full"
                                style={{
                                  // Not-started takes the disabled border
                                  // colour, not the ramp's own #EFEEF6: at
                                  // 9px on white that grey is invisible, and
                                  // "no dot" is not one of the states.
                                  background:
                                    stage === 0
                                      ? "var(--play-disabled-border)"
                                      : MASTERY_LEGEND[stage].hex,
                                  border: selected
                                    ? "1.5px solid var(--card-warm)"
                                    : undefined,
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
            className="checkin-press flex min-h-[46px] items-center rounded-[16px] border-[2.5px] border-ink bg-card px-4 font-display text-[0.92rem] font-bold text-ink"
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
      className={`checkin-press flex min-h-[60px] items-center gap-3.5 rounded-[20px] border-[3px] border-ink px-5 py-3 text-start ${
        active ? "bg-[var(--noor-action)]" : "bg-card"
      }`}
    >
      <span className="flex-1 font-display text-[1.1rem] font-extrabold leading-[1.3] text-ink min-[900px]:text-[1.2rem]">
        {label}
      </span>
      <span
        className={`whitespace-nowrap font-display text-[0.85rem] font-bold leading-none ${
          active ? "text-[var(--play-text-on-amber-s)]" : "text-ink-soft"
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

/**
 * Which term a module belongs to, and its label without the term in it.
 *
 * The stored labels disagree with each other: `module:t2-u1` is "Term 2 ·
 * Unit 1 — Equations" and `module:geo-u2` is "Term 2 · Unit 5 — …", while
 * `module:u1` is plain "Unit 1 — Relations and Functions" and
 * `module:geo-u1` is plain "Unit 4 — The Circle" despite being Term 2. Any
 * code that prefixes the term onto the label as-is therefore prints "Term 1
 * · Term 2 · Unit 1" for the five that already carry it — which the picker
 * did, before and after this redesign, and the topic card did too.
 *
 * The ID is the one thing that is consistent, so the term comes from there
 * and the label is normalised rather than trusted.
 */
const termOfModule = (moduleId: string): 1 | 2 =>
  moduleId.startsWith("module:geo") || moduleId.startsWith("module:t2-")
    ? 2
    : 1;

/** Same question, from a lesson slug ("t2u1-1", "geo1-2", "u1-1"). */
const termOfSlug = (slug: string): 1 | 2 =>
  slug.startsWith("geo") || slug.startsWith("t2") ? 2 : 1;

/** "Term 2 · Unit 1 — Equations" → "Unit 1 — Equations" */
const withoutTerm = (label: string) =>
  label.replace(/^\s*Term\s*\d+\s*\u00b7\s*/u, "");

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

/* =============================================================================
   ARABIC / SOCIAL — unchanged prior bilingual rendering (kept reintroducible,
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
        <p className="rule-label mb-4">
          After school · {lesson.studentName.split(" ")[0]}
        </p>
        <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          <span dir="rtl" className="text-accent-deep">
            إزاي كان درس النهاردة؟
          </span>
          <span className="text-ink-faint">/</span>
          <span>How did today&apos;s lesson go?</span>
        </h1>
      </section>

      <section
        className="ledger-card anim-rise overflow-hidden"
        style={{ animationDelay: "100ms" }}
      >
        <div
          dir="rtl"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-5 py-2.5"
        >
          <span className="text-[10.5px] font-semibold tracking-wide text-ink-faint">
            النهاردة في المدرسة
          </span>
          <span className="text-[10.5px] text-ink-faint">
            كتاب الوزارة · {pageSpan}
          </span>
        </div>

        <div
          dir="rtl"
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
        >
          <div>
            <p className="font-display text-xl font-medium text-ink">
              {selectedIsGeo && (
                <span dir="rtl" className="me-2 text-[15px] text-gold">
                  هندسة
                </span>
              )}
              <span className="ms-0 me-2 text-[15px] text-gold">
                {subjectDef(lesson.subject).labelArShort}
              </span>
              {lesson.lessonRef} — {lesson.title}
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink-faint">
              {subjectDef(lesson.subject).labelAr} · {lesson.moduleLabel}
            </p>
          </div>
          <div className="space-y-1">
            {lesson.los.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor: masteryColor(l.mastery, 1, l.mastery > 0),
                  }}
                />
                <span className="text-[12px] text-ink-soft">{l.label}</span>
                <span className="font-mono text-[9.5px] text-ink-faint">
                  {pct(l.mastery)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <Link
          href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className="anim-rise group relative overflow-hidden rounded-xl border border-line bg-card px-6 pb-5 pt-6 shadow-[0_2px_8px_rgba(30,36,80,0.08)] transition-all duration-200 hover:-translate-y-1 hover:border-[var(--noor-action)] hover:shadow-[0_12px_32px_rgba(30,36,80,0.16)] play-pressable sticker-shadow"
          style={{ animationDelay: "180ms" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 110% 90% at 85% -10%, var(--gold-wash), transparent 60%)",
            }}
          />
          <p
            dir="rtl"
            className="relative font-display text-[26px] font-medium leading-tight text-ink"
          >
            مش فاهم حاجة
          </p>
          <p
            dir="rtl"
            className="relative mt-1.5 text-[14.5px] font-semibold text-ink"
          >
            اشرحهولي من الأول خالص.
          </p>
          <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
            درس تفاعلي · خرايط ورسومات · تقرير فهم بأمانة
          </p>
          <span
            dir="rtl"
            className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-transform duration-200 group-hover:-translate-x-1"
            style={{
              background: "var(--noor-action)",
              color: "var(--noor-on-action)",
            }}
          >
            علّمني ←
          </span>
        </Link>

        <Link
          href={`/student?mode=review&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className="anim-rise group relative overflow-hidden rounded-xl border border-accent/40 bg-card px-6 pb-5 pt-6 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_12px_32px_-18px_rgba(13,74,66,0.4)] transition-all duration-200 hover:-translate-y-1 hover:border-accent/70 hover:shadow-[0_22px_44px_-20px_rgba(13,74,66,0.55)] play-pressable sticker-shadow"
          style={{ animationDelay: "260ms" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 110% 90% at 85% -10%, var(--accent-wash), transparent 60%)",
            }}
          />
          <p
            dir="rtl"
            className="relative font-display text-[26px] font-medium leading-tight text-ink"
          >
            فهمت كله ✓
          </p>
          <p
            dir="rtl"
            className="relative mt-1.5 text-[14.5px] font-semibold text-ink"
          >
            فاهمه — مراجعة سريعة في ٣ دقايق.
          </p>
          <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
            ٣ أسئلة سريعة · تحدي واحد · وخلصنا
          </p>
          <span
            dir="rtl"
            className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-deep px-4 text-[13px] font-semibold text-paper transition-transform duration-200 group-hover:-translate-x-1"
          >
            ثبّته ←
          </span>
        </Link>
      </section>

      <details
        className="anim-rise group mt-5"
        style={{ animationDelay: "340ms" }}
      >
        <summary className="ledger-card play-pressable flex cursor-pointer list-none items-center justify-between px-5 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline gap-2.5">
            <span
              dir="rtl"
              className="font-display text-[16px] font-medium text-ink"
            >
              درس تاني؟
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
              pick a different school lesson
            </span>
          </span>
          <span
            aria-hidden
            className="text-[11px] text-ink-faint transition-transform duration-200 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>

        <div className="ledger-card mt-2 space-y-2.5 px-5 pb-4 pt-3.5">
          {modules.map((m) => (
            <div
              key={m.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5"
            >
              {isRtlSubject(m.subject) ? (
                <span
                  dir="rtl"
                  className="w-full text-[10.5px] font-semibold text-ink-faint sm:w-56 sm:shrink-0"
                >
                  {subjectDef(m.subject!).labelArShort} · {m.label}
                </span>
              ) : (
                <span className="w-full font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint sm:w-56 sm:shrink-0">
                  {isGeoModule(m.id) ? "Term 2 · " : "Term 1 · "}
                  {m.label}
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
                      className={`rounded-full border px-2.5 py-1 play-pressable sticker-shadow-sm ${soc ? "" : "font-mono "}text-[10px] leading-none transition-all duration-150 ${
                        selected
                          ? "border-accent bg-accent text-paper shadow-sm"
                          : "border-line bg-card text-ink-soft hover:-translate-y-px hover:border-accent/50 hover:text-accent-deep"
                      }`}
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

      <p
        className="anim-rise mt-6 text-center"
        style={{ animationDelay: "420ms" }}
      >
        <Link
          href="/student?mode=practice"
          prefetch={false}
          className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint underline decoration-dotted underline-offset-4 transition-colors hover:text-accent-deep"
        >
          just practice — today&apos;s plan →
        </Link>
      </p>
    </main>
  );
}

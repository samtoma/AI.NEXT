import Link from "next/link";
import type { LessonData, LessonInfo } from "@/lib/types";
import { isRtlSubject, spineKeyOf, subjectDef } from "@/lib/subjects";
import { masteryColor, MASTERY_LEGEND, pct } from "@/lib/mastery";
import type { Recommendation } from "@/lib/checkin";
import {
  BADGE,
  BUTTON_LABEL,
  BUTTON_TERTIARY,
  HEADING,
  HONEY_BAND,
  STICKER_CARD,
  STICKER_PANEL,
  STROKE,
  STROKE_SM,
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
 * Both layouts wear the same Play anatomy from `components/sticker.ts`. The
 * Arabic one used to mix it with the Ledger's: one door card had a sticker
 * shadow and the other a soft viridian glow, a colour Play does not have
 * (review 2026-09-23, F17), and the file carried ~16 literal strokes, radii
 * and shadows. Every value is a token now; the recommended row keeps its
 * amber (`--noor-action` / `--noor-on-action`), the one amber on the screen.
 */
export function LessonCheckIn(props: CheckInProps) {
  const { lesson, lessons, hasContent = false } = props;
  const social = isRtlSubject(lesson.subject);
  if (social) return <SocialCheckIn lesson={lesson} lessons={lessons} hasContent={hasContent} />;
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
  trial,
}: CheckInProps) {
  const first = lesson.studentName.split(" ")[0];
  const pages = lesson.los
    .map((l) => l.sourcePage)
    .filter((p): p is number => p != null);
  const pageRange = pages.length
    ? `p.${Math.min(...pages)}–${Math.max(...pages)}`
    : null;

  const modules = groupByModule(lessons);
  const q = (slug: string, subject?: LessonInfo["subject"]) =>
    `/student?${subject ? `subject=${spineKeyOf(subject)}&` : ""}lesson=${encodeURIComponent(slug)}`;

  return (
    <div className="min-h-screen bg-paper">
      {/* Rail/bottom-bar (companion mark) removed for now — top bar only.
          Re-add per docs/design/handoffs/noor-play if it comes back. */}
      <div>
        <main className="mx-auto w-full px-6 py-10 min-[900px]:py-14 min-[1280px]:max-w-[860px]">
          <div className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
            <h1 className={cx(HEADING, "text-[1.75rem] min-[900px]:text-[2rem] min-[1280px]:text-[2.4rem]")}>
              Hey, {first}
            </h1>
            {trial != null && (
              <span className={cx(BADGE, "bg-card text-ink")}>
                {trial} {trial === 1 ? "day" : "days"} left
              </span>
            )}
          </div>

          {/* the topic card — sticker treatment, flex-shrink:0 so content can
              never compress it below what it needs. overflow-clip (not
              -hidden): pure decorative corner-clipping with no scroll need,
              and it sidesteps a real WebKit/Chromium bug class where
              overflow:hidden + border-radius loses the clip on relayout —
              exactly the "corner went square after I resized" symptom this
              was written to prevent (iPad Safari is a hard device target). */}
          <section className={cx(STICKER_CARD, "shrink-0 overflow-clip")}>
            <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-5 py-2.5")}>
              <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
                {lesson.moduleLabel}
              </span>
              {pageRange && (
                <span dir="ltr" className="font-mono text-[0.72rem] font-medium text-ink-faint">
                  Textbook · {pageRange}
                </span>
              )}
            </div>

            <div className="px-6 py-6">
              <h2 className="font-display text-[1.5rem] font-extrabold leading-[1.25] text-ink min-[1280px]:text-[1.7rem]">
                {lesson.lessonRef} — {lesson.title}
              </h2>

              {/* the mastery ramp — 4 segments, filled left to right from the
                  shared 5-stage ramp. Segment 0 lit is amber, never grey;
                  grey is only ever "not yet". Never a number, percent or
                  grade anywhere near it (feedback #42).

                  FR-1003 is what shapes the rest of this block. Dropping the
                  percentage is fine; dropping every non-colour signal is not,
                  and the first cut of this card did both. Measured, lit
                  against unlit ran 1.84:1 to 2.84:1 — all under the 3:1 floor
                  for graphical objects — and adjacent lit bands are 1.02:1
                  apart, so in greyscale or with low vision you cannot count
                  which segments are lit. The aria-label covered the screen
                  reader and nothing covered the other two channels the
                  requirement names.

                  So the ramp carries the value three ways now, not one: the
                  ink outline makes lit-vs-unlit a fill-vs-empty difference
                  that survives greyscale, the band name states it in words,
                  and the aria-label keeps the screen-reader path. */}
              <div
                role="img"
                aria-label={`Progress: ${MASTERY_LEGEND[masteryStage].band}, ${masteryStage} of 4 steps`}
                className="mt-4 flex gap-1.5"
              >
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cx(STROKE_SM, "h-4 flex-1 rounded-[var(--play-radius-pill)]")}
                    style={{
                      background:
                        i < masteryStage
                          ? MASTERY_LEGEND[i + 1].color
                          : "transparent",
                    }}
                  />
                ))}
              </div>
              {/* The named band — the non-colour signal FR-1003 requires,
                  and the one number-free way to say where she is. */}
              <p className="mt-2 font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
                {MASTERY_LEGEND[masteryStage].band}
              </p>

              {/* the one gap — the single named sub-skill, or nothing at all */}
              {weakestSubskill && (
                <div className="mt-4 rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-2.5">
                  <p className="font-read text-[1rem] leading-[1.7] text-ink-soft">
                    Worth another look:{" "}
                    <span className="font-bold text-ink">{weakestSubskill}</span>
                  </p>
                </div>
              )}

              {completedToday ? (
                <p className="font-read mt-6 text-[1rem] leading-[1.7] text-ink-soft">
                  Done here for today ✓
                </p>
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
                  <ActionRow
                    href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
                    label="Walk me through it"
                    minutes={estimates.reteach}
                    active={recommendation === "reteach"}
                  />
                  <ActionRow
                    href={`/student?mode=review&lesson=${encodeURIComponent(lesson.slug)}`}
                    label="Quiz me on it"
                    minutes={estimates.refresh}
                    active={recommendation === "refresh"}
                  />
                </div>
              )}
            </div>
          </section>

          {/* quiet, change-of-mind controls — deliberately no border, radius
              or shadow. They are not actions. */}
          <details className="mt-6 group">
            <summary className="flex min-h-[var(--noor-touch-min)] cursor-pointer list-none items-center justify-between font-display text-[1rem] font-bold text-ink-soft [&::-webkit-details-marker]:hidden">
              <span>Pick a different topic</span>
              <span
                aria-hidden
                className="text-[0.85rem] transition-transform duration-200 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="mt-3 space-y-2.5">
              {modules.map((m) => (
                <div key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                  <span className="w-full font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint min-[640px]:w-56 min-[640px]:shrink-0">
                    {m.id.startsWith("module:geo") ? "Term 2 · " : "Term 1 · "}
                    {m.label}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {m.lessons.map((l) => {
                      const selected = l.slug === lesson.slug;
                      const geo = m.id.startsWith("module:geo");
                      return (
                        <Link
                          key={l.slug}
                          href={q(l.slug, m.subject)}
                          scroll={false}
                          prefetch={false}
                          aria-current={selected ? "true" : undefined}
                          className={lessonChip(selected, true)}
                        >
                          {geo && <span className="me-1">Geo</span>}
                          {l.ref.replace(/^Lesson /, "")}
                        </Link>
                      );
                    })}
                  </span>
                </div>
              ))}
            </div>
          </details>

          <p className="mt-3">
            <Link
              href="/student?mode=practice"
              prefetch={false}
              className={BUTTON_TERTIARY}
            >
              Just practice today&apos;s plan
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}

/** One of the two equal action rows. Only the fill differs — never the
 *  size, the target, the border or the shadow. Both are instructions to
 *  Nour ("walk me through it" / "quiz me"), never a statement about the
 *  student. The arrow glyph is swapped, never mirrored, for a future RTL
 *  pass (→ becomes ←, same span, no transform). */
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
        "checkin-press flex min-h-[58px] items-center justify-between rounded-[var(--play-radius)] px-5 font-display text-[1.15rem] font-bold transition-colors",
        active
          ? "bg-[var(--noor-action)] text-[color:var(--noor-on-action)]"
          : "bg-card text-ink"
      )}
    >
      <span>{label}</span>
      {/* Small mono on amber takes the handoff's darkened amber-brown, not a
          faded ink: opacity on text is contrast nobody measured. */}
      <span
        className={cx(
          "flex items-center gap-2 font-mono text-[0.75rem] font-medium",
          active
            ? "text-[color:var(--play-text-on-amber-s)]"
            : "text-[color:var(--play-text-muted)]"
        )}
      >
        <span dir="ltr">~{minutes} min</span>
        <span aria-hidden>→</span>
      </span>
    </Link>
  );
}

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
    else modules.push({ id: l.moduleId, label: l.moduleLabel, subject: l.subject, lessons: [l] });
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

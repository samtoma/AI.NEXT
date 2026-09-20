import Link from "next/link";
import type { LessonData, LessonInfo } from "@/lib/types";
import { isRtlSubject, spineKeyOf, subjectDef } from "@/lib/subjects";
import { masteryColor, MASTERY_LEGEND, pct } from "@/lib/mastery";
import type { Recommendation } from "@/lib/checkin";

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
 * of this brief ("English ships, Arabic stays cheap") and keep the prior
 * bilingual rendering untouched below, per constitution Principle V — no
 * Arabic-capable surface is removed to ship English first.
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
            <h1 className="font-display text-[1.75rem] font-semibold tracking-tight text-ink min-[900px]:text-[2rem] min-[1280px]:text-[2.4rem]">
              Hey, {first}
            </h1>
            {trial != null && (
              <span className="chip font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft">
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
          <section className="shrink-0 overflow-clip rounded-[22px] border-[3px] border-ink bg-card sticker-shadow">
            <div className="flex flex-wrap items-center justify-between gap-2 border-ink bg-card-warm px-5 py-2.5" style={{ borderBlockEndWidth: "3px", borderBlockEndStyle: "solid" }}>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                {lesson.moduleLabel}
              </span>
              {pageRange && (
                <span dir="ltr" className="font-mono text-[10px] text-ink-soft">
                  Textbook · {pageRange}
                </span>
              )}
            </div>

            <div className="px-6 py-6">
              <h2 className="font-display text-[1.45rem] font-semibold text-ink min-[1280px]:text-[1.7rem]">
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
                    className="h-2.5 flex-1 rounded-full border-[1.5px] border-ink"
                    style={{
                      background:
                        i < masteryStage
                          ? MASTERY_LEGEND[i + 1].hex
                          : "transparent",
                    }}
                  />
                ))}
              </div>
              {/* The named band — the non-colour signal FR-1003 requires,
                  and the one number-free way to say where she is. */}
              <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-soft">
                {MASTERY_LEGEND[masteryStage].band}
              </p>

              {/* the one gap — the single named sub-skill, or nothing at all */}
              {weakestSubskill && (
                <div className="mt-4 rounded-[14px] bg-card-warm px-4 py-2.5">
                  <p className="font-read text-[0.95rem] leading-[1.7] text-ink-soft">
                    Worth another look:{" "}
                    <span className="font-medium text-ink">{weakestSubskill}</span>
                  </p>
                </div>
              )}

              {completedToday ? (
                <p className="font-read mt-6 text-[0.95rem] leading-[1.7] text-ink-soft">
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
            <summary className="flex cursor-pointer list-none items-center justify-between font-read text-[0.95rem] text-ink-soft [&::-webkit-details-marker]:hidden">
              <span>Pick a different topic</span>
              <span
                aria-hidden
                className="text-[11px] transition-transform duration-200 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            <div className="mt-3 space-y-2.5">
              {modules.map((m) => (
                <div key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
                  <span className="w-full font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint min-[640px]:w-56 min-[640px]:shrink-0">
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
                          className={`rounded-full border-[2.5px] px-2.5 py-1 font-mono text-[10px] leading-none transition-colors ${
                            selected
                              ? "border-ink bg-ink text-paper"
                              : "border-ink/40 bg-card text-ink-soft hover:border-ink"
                          }`}
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
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint underline decoration-dotted underline-offset-4 transition-colors hover:text-ink"
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
      className={`checkin-press flex min-h-[58px] items-center justify-between rounded-[20px] border-[3px] border-ink px-5 font-display text-[1.05rem] font-semibold transition-colors ${
        active ? "bg-[var(--noor-action)] text-[var(--noor-on-action)]" : "bg-card text-ink"
      }`}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2 font-mono text-[0.75rem] opacity-80">
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
        <p className="rule-label mb-4">After school · {lesson.studentName.split(" ")[0]}</p>
        <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          <span dir="rtl" className="text-accent-deep">
            إزاي كان درس النهاردة؟
          </span>
          <span className="text-ink-faint">/</span>
          <span>How did today&apos;s lesson go?</span>
        </h1>
      </section>

      <section className="ledger-card anim-rise overflow-hidden" style={{ animationDelay: "100ms" }}>
        <div dir="rtl" className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-5 py-2.5">
          <span className="text-[10.5px] font-semibold tracking-wide text-ink-faint">
            النهاردة في المدرسة
          </span>
          <span className="text-[10.5px] text-ink-faint">كتاب الوزارة · {pageSpan}</span>
        </div>

        <div dir="rtl" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
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
                  style={{ backgroundColor: masteryColor(l.mastery, 1, l.mastery > 0) }}
                />
                <span className="text-[12px] text-ink-soft">{l.label}</span>
                <span className="font-mono text-[9.5px] text-ink-faint">{pct(l.mastery)}</span>
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
            style={{ background: "radial-gradient(ellipse 110% 90% at 85% -10%, var(--gold-wash), transparent 60%)" }}
          />
          <p dir="rtl" className="relative font-display text-[26px] font-medium leading-tight text-ink">
            مش فاهم حاجة
          </p>
          <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
            اشرحهولي من الأول خالص.
          </p>
          <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
            درس تفاعلي · خرايط ورسومات · تقرير فهم بأمانة
          </p>
          <span
            dir="rtl"
            className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-transform duration-200 group-hover:-translate-x-1"
            style={{ background: "var(--noor-action)", color: "var(--noor-on-action)" }}
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
            style={{ background: "radial-gradient(ellipse 110% 90% at 85% -10%, var(--accent-wash), transparent 60%)" }}
          />
          <p dir="rtl" className="relative font-display text-[26px] font-medium leading-tight text-ink">
            فهمت كله ✓
          </p>
          <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
            فاهمه — مراجعة سريعة في ٣ دقايق.
          </p>
          <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
            ٣ أسئلة سريعة · تحدي واحد · وخلصنا
          </p>
          <span dir="rtl" className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-accent-deep px-4 text-[13px] font-semibold text-paper transition-transform duration-200 group-hover:-translate-x-1">
            ثبّته ←
          </span>
        </Link>
      </section>

      <details className="anim-rise group mt-5" style={{ animationDelay: "340ms" }}>
        <summary className="ledger-card play-pressable flex cursor-pointer list-none items-center justify-between px-5 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-baseline gap-2.5">
            <span dir="rtl" className="font-display text-[16px] font-medium text-ink">
              درس تاني؟
            </span>
            <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
              pick a different school lesson
            </span>
          </span>
          <span aria-hidden className="text-[11px] text-ink-faint transition-transform duration-200 group-open:rotate-180">
            ▾
          </span>
        </summary>

        <div className="ledger-card mt-2 space-y-2.5 px-5 pb-4 pt-3.5">
          {modules.map((m) => (
            <div key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              {isRtlSubject(m.subject) ? (
                <span dir="rtl" className="w-full text-[10.5px] font-semibold text-ink-faint sm:w-56 sm:shrink-0">
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

      <p className="anim-rise mt-6 text-center" style={{ animationDelay: "420ms" }}>
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

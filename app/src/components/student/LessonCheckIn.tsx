import Link from "next/link";
import type { LessonData, LessonInfo } from "@/lib/types";
import { isRtlSubject, spineKeyOf, subjectDef } from "@/lib/subjects";
import { masteryColor, pct } from "@/lib/mastery";

/**
 * /student landing — the after-school check-in.
 *
 * DOORS FIRST (the UI assigns, it never asks the student to browse): the
 * selected lesson + the two doors are the screen; the full lesson picker
 * collapses behind a quiet "درس تاني؟" <details> row. Selection travels via
 * ?lesson=<slug> and re-renders THIS page only — no AI turn is ever spent
 * until a door mounts the lesson session (doors carry prefetch={false} so
 * even production route prefetching stays off this path).
 *
 * Term-1 algebra and Term-2 geometry both contain a "Unit 4" — geometry rows
 * and chips are prefixed (هندسة) to disambiguate.
 */
export function LessonCheckIn({
  lesson,
  lessons,
  hasContent = false,
}: {
  lesson: LessonData;
  lessons: LessonInfo[];
  /** true when this lesson has a rich «شرح الدرس» content bundle to read */
  hasContent?: boolean;
}) {
  const first = lesson.studentName.split(" ")[0];
  // RTL subjects render the assigned-lesson card + doors Arabic-first
  // (ADR-0004 Wave 1); the LTR (maths) check-in stays pixel-identical. The
  // test is the subject's own direction from the registry, not "is it social".
  const social = isRtlSubject(lesson.subject);
  const ar = (s: string | number) =>
    String(s).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
  const pages = lesson.los
    .map((l) => l.sourcePage)
    .filter((p): p is number => p != null);
  const pageSpan = pages.length
    ? social
      ? `ص${ar(Math.min(...pages))}–${ar(Math.max(...pages))}`
      : `p.${Math.min(...pages)}–${Math.max(...pages)}`
    : "";

  // group the catalog by module, preserving order
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

  const isGeoModule = (id: string) => id.startsWith("module:geo");
  // Each chip carries ITS OWN lesson's subject, so the check-in it lands on
  // filters the picker to the right course and the URL stays shareable.
  const q = (slug: string, subject?: LessonInfo["subject"]) =>
    `/student?${subject ? `subject=${spineKeyOf(subject)}&` : ""}lesson=${encodeURIComponent(slug)}`;
  const selectedIsGeo = lesson.slug.startsWith("geo");

  return (
    <main className="mx-auto max-w-3xl px-6 pb-16">
      <section className="anim-rise pb-6 pt-10">
        <p className="rule-label mb-4">After school · {first}</p>
        {/* Bilingual parity, not a translation footnote: both scripts at the
            same size and the same weight, each carrying its own dir. What the
            direction of the SHELL decides is only which one leads — English
            for MVP 1.0 (decisions.md Q6), Arabic on the RTL verticals — and
            that is a default, not a hard-coded direction. */}
        <h1 className="flex flex-wrap items-baseline gap-x-3 font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          {social ? (
            <>
              <span dir="rtl" className="text-accent-deep">
                إزاي كان درس النهاردة؟
              </span>
              <span className="text-ink-faint">/</span>
              <span>How did today&apos;s lesson go?</span>
            </>
          ) : (
            <>
              <span>How did today&apos;s lesson go?</span>
              <span className="text-ink-faint">/</span>
              <span dir="rtl" className="text-accent-deep">
                إزاي كان درس النهاردة؟
              </span>
            </>
          )}
        </h1>
      </section>

      {/* today's assigned lesson */}
      <section
        className="ledger-card anim-rise overflow-hidden"
        style={{ animationDelay: "100ms" }}
      >
        <div
          dir={social ? "rtl" : undefined}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-5 py-2.5"
        >
          {social ? (
            <>
              <span className="text-[10.5px] font-semibold tracking-wide text-ink-faint">
                النهاردة في المدرسة
              </span>
              <span className="text-[10.5px] text-ink-faint">
                كتاب الوزارة · {pageSpan}
              </span>
            </>
          ) : (
            <>
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-ink-faint">
                Today at school
              </span>
              <span className="font-mono text-[9.5px] text-ink-faint">
                Ministry textbook · {pageSpan}
              </span>
            </>
          )}
        </div>

        <div
          dir={social ? "rtl" : undefined}
          className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
        >
          <div>
            <p className="font-display text-xl font-medium text-ink">
              {selectedIsGeo && (
                <span dir="rtl" className="me-2 text-[15px] text-gold">
                  هندسة
                </span>
              )}
              {social && (
                <span className="ms-0 me-2 text-[15px] text-gold">
                  {subjectDef(lesson.subject).labelArShort}
                </span>
              )}
              {lesson.lessonRef} — {lesson.title}
            </p>
            <p
              className={
                social
                  ? "mt-0.5 text-[11.5px] text-ink-faint"
                  : "mt-0.5 font-mono text-[10.5px] text-ink-faint"
              }
            >
              {social
                ? `${subjectDef(lesson.subject).labelAr} · `
                : selectedIsGeo
                  ? "Term 2 · "
                  : "Term 1 · "}
              {lesson.moduleLabel}
            </p>
          </div>
          <div className="space-y-1">
            {lesson.los.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                {/* A learning objective at 0 has no evidence behind it, so it
                    takes the not-started step. Handing it the lowest LIT step
                    paints a whole untouched lesson amber, which reads as "you
                    are doing badly at four things you have never seen". */}
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

      {/* The two doors.

          "I didn't get it" is the one that must feel easiest to walk through,
          so it carries the single dominant accent on this screen and the
          revision door is the quieter of the pair. It used to be rust — a
          red-family warning drawn around admitting you are lost, which is
          exactly the framing the design system forbids, and exactly the
          framing that makes a student pick the door that flatters her
          instead of the one she needs. */}
      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <Link
          href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className="anim-rise group relative overflow-hidden rounded-xl border border-line bg-card px-6 pb-5 pt-6 shadow-[0_2px_8px_rgba(30,36,80,0.08)] transition-all duration-200 hover:-translate-y-1 hover:border-[var(--nour-action)] hover:shadow-[0_12px_32px_rgba(30,36,80,0.16)]"
          style={{ animationDelay: "180ms" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 110% 90% at 85% -10%, var(--gold-wash), transparent 60%)",
            }}
          />
          {/* The gap has to come from the LAYOUT, not from a margin on the
              Arabic span: margin-inline-start on a dir="rtl" element resolves
              to its RIGHT edge, so the two scripts render flush against each
              other ("I'm lostمش فاهم حاجة"). A flex row with a gap is
              direction-agnostic, which is the whole point. */}
          <p className="relative flex flex-wrap items-baseline gap-x-3 font-display text-[26px] font-medium leading-tight text-ink">
            {social ? (
              <span dir="rtl">مش فاهم حاجة</span>
            ) : (
              <>
                <span>I&apos;m lost</span>
                <span dir="rtl" className="text-ink-soft">
                  مش فاهم حاجة
                </span>
              </>
            )}
          </p>
          {social ? (
            <>
              <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                اشرحهولي من الأول خالص.
              </p>
              <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
                درس تفاعلي · خرايط ورسومات · تقرير فهم بأمانة
              </p>
              <span
                dir="rtl"
                className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-transform duration-200 group-hover:-translate-x-1"
                style={{
                  background: "var(--nour-action)",
                  color: "var(--nour-on-action)",
                }}
              >
                علّمني ←
              </span>
            </>
          ) : (
            <>
              <p className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                I didn&apos;t get it — teach me from zero.
              </p>
              <p className="relative mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                interactive lesson · figures · voice · honest score
              </p>
              {/* never white text on amber — the pairing token is ink, not paper */}
              <span
                className="relative mt-4 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-4 text-[13px] font-semibold transition-transform duration-200 group-hover:translate-x-1"
                style={{
                  background: "var(--nour-action)",
                  color: "var(--nour-on-action)",
                }}
              >
                Teach me →
              </span>
            </>
          )}
        </Link>

        <Link
          href={`/student?mode=review&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className="anim-rise group relative overflow-hidden rounded-xl border border-accent/40 bg-card px-6 pb-5 pt-6 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_12px_32px_-18px_rgba(13,74,66,0.4)] transition-all duration-200 hover:-translate-y-1 hover:border-accent/70 hover:shadow-[0_22px_44px_-20px_rgba(13,74,66,0.55)]"
          style={{ animationDelay: "260ms" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 110% 90% at 85% -10%, var(--accent-wash), transparent 60%)",
            }}
          />
          <p className="relative flex flex-wrap items-baseline gap-x-3 font-display text-[26px] font-medium leading-tight text-ink">
            {social ? (
              <span dir="rtl">فهمت كله ✓</span>
            ) : (
              <>
                <span>I got it</span>
                <span dir="rtl" className="text-ink-soft">
                  فهمت كله
                </span>
              </>
            )}
          </p>
          {social ? (
            <>
              <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                فاهمه — مراجعة سريعة في ٣ دقايق.
              </p>
              <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
                ٣ أسئلة سريعة · تحدي واحد · وخلصنا
              </p>
              <span dir="rtl" className="relative mt-4 inline-flex items-center gap-1.5 min-h-[44px] rounded-xl bg-accent-deep px-4 text-[13px] font-semibold text-paper transition-transform duration-200 group-hover:-translate-x-1">
                ثبّته ←
              </span>
            </>
          ) : (
            <>
              <p className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                I got it — quick revision, 3 minutes.
              </p>
              <p className="relative mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
                3 quick checks · 1 challenge · ≤ 5 AI turns
              </p>
              <span className="relative mt-4 inline-flex items-center gap-1.5 min-h-[44px] rounded-xl bg-accent-deep px-4 text-[13px] font-semibold text-paper transition-transform duration-200 group-hover:translate-x-1">
                Lock it in →
              </span>
            </>
          )}
        </Link>
      </section>

      {/* The rich lesson content now powers the AI-LED lesson ("علّمني" door):
          the tutor teaches from the reviewed teaching script, chunked into
          beats and adapted to the student — replacing the old static read page,
          which was a dead-end wall of text with no progression. */}

      {/* the picker — collapsed behind "درس تاني؟" (doors stay first) */}
      <details
        className="anim-rise group mt-5"
        style={{ animationDelay: "340ms" }}
      >
        <summary className="ledger-card flex cursor-pointer list-none items-center justify-between px-5 py-3 [&::-webkit-details-marker]:hidden">
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
                // the module's OWN subject names itself here — this row used to
                // be hardcoded «دراسات اجتماعية» for every non-maths module
                <span
                  dir="rtl"
                  className="w-full text-[10.5px] font-semibold text-ink-faint sm:w-56 sm:shrink-0"
                >
                  {subjectDef(m.subject!).labelArShort} · {m.label}
                </span>
              ) : (
                <span className="w-full font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint sm:w-56 sm:shrink-0">
                  {/* the two curricula both carry a "Unit 4" — keep them apart */}
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
                      className={`rounded-full border px-2.5 py-1 ${soc ? "" : "font-mono "}text-[10px] leading-none transition-all duration-150 ${
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

      {/* quiet third door */}
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

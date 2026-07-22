import Link from "next/link";
import type { LessonData, LessonInfo } from "@/lib/types";
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
  // social-ar lessons render the assigned-lesson card + doors RTL Arabic-first
  // (ADR-0004 Wave 1); math check-in stays pixel-identical.
  const social = lesson.subject === "social-ar";
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
  const q = (slug: string) => `/student?lesson=${encodeURIComponent(slug)}`;
  const selectedIsGeo = lesson.slug.startsWith("geo");

  return (
    <main className="mx-auto max-w-3xl px-6 pb-16">
      <section className="anim-rise pb-6 pt-10">
        <p className="rule-label mb-4">After school · {first}</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          <span dir="rtl" className="text-accent-deep">
            إزاي كان درس النهاردة؟
          </span>
          <span className="mx-3 text-ink-faint">/</span>
          How did today&apos;s lesson go?
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
                <span className="ms-0 me-2 text-[15px] text-gold">دراسات</span>
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
                ? "دراسات اجتماعية · "
                : selectedIsGeo
                  ? "Term 2 · "
                  : "Term 1 · "}
              {lesson.moduleLabel}
            </p>
          </div>
          <div className="space-y-1">
            {lesson.los.map((l) => (
              <div key={l.id} className="flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: masteryColor(l.mastery) }}
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

      {/* the two doors */}
      <section className="mt-5 grid gap-4 sm:grid-cols-2">
        <Link
          href={`/student?mode=learn&lesson=${encodeURIComponent(lesson.slug)}`}
          prefetch={false}
          className="anim-rise group relative overflow-hidden rounded-xl border border-rust/35 bg-card px-6 pb-5 pt-6 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_12px_32px_-18px_rgba(168,68,42,0.35)] transition-all duration-200 hover:-translate-y-1 hover:border-rust/60 hover:shadow-[0_22px_44px_-20px_rgba(168,68,42,0.5)]"
          style={{ animationDelay: "180ms" }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-70"
            style={{
              background:
                "radial-gradient(ellipse 110% 90% at 85% -10%, var(--rust-wash), transparent 60%)",
            }}
          />
          <p
            dir="rtl"
            className="relative font-display text-[26px] font-medium leading-tight text-rust"
          >
            مش فاهم حاجة
          </p>
          {social ? (
            <>
              <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                اشرحهولي من الأول خالص.
              </p>
              <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
                درس تفاعلي · خرايط ورسومات · تقرير فهم بأمانة
              </p>
              <span dir="rtl" className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-rust px-4 py-1.5 text-[12px] font-semibold text-paper transition-transform duration-200 group-hover:-translate-x-1">
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
              <span className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-rust px-4 py-1.5 text-[12px] font-semibold text-paper transition-transform duration-200 group-hover:translate-x-1">
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
          <p
            dir="rtl"
            className="relative font-display text-[26px] font-medium leading-tight text-accent-deep"
          >
            فهمت كله ✓
          </p>
          {social ? (
            <>
              <p dir="rtl" className="relative mt-1.5 text-[14.5px] font-semibold text-ink">
                فاهمه — مراجعة سريعة في ٣ دقايق.
              </p>
              <p dir="rtl" className="relative mt-3 text-[10.5px] text-ink-faint">
                ٣ أسئلة سريعة · تحدي واحد · وخلصنا
              </p>
              <span dir="rtl" className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-deep px-4 py-1.5 text-[12px] font-semibold text-paper transition-transform duration-200 group-hover:-translate-x-1">
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
              <span className="relative mt-4 inline-flex items-center gap-1.5 rounded-full bg-accent-deep px-4 py-1.5 text-[12px] font-semibold text-paper transition-transform duration-200 group-hover:translate-x-1">
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
              {m.subject === "social-ar" ? (
                <span
                  dir="rtl"
                  className="w-full text-[10.5px] font-semibold text-ink-faint sm:w-56 sm:shrink-0"
                >
                  دراسات اجتماعية · {m.label}
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
                  const soc = m.subject === "social-ar";
                  return (
                    <Link
                      key={l.slug}
                      href={q(l.slug)}
                      scroll={false}
                      prefetch={false}
                      dir={soc ? "rtl" : undefined}
                      title={`${geo ? "Geometry · " : soc ? "دراسات اجتماعية · " : ""}${l.ref} — ${l.title}`}
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

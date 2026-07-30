import Link from "next/link";
import type { SubjectSummary } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import { masteryColor, pct } from "@/lib/mastery";
import { arabicGreetingName, shortName } from "@/lib/demo-student";

/**
 * The student's home (Wave 1.5, multi-subject spine §4): one card PER SUBJECT,
 * each with its own accent, mastery, and weakest topic. Mastery is rolled up
 * ONLY within a subject — the product NEVER shows a single blended score.
 */
/** Card tokens + direction come from the subject's registry entry, so a new
 *  subject arrives styled instead of inheriting maths' card by default. */
const cardOf = (subject: SubjectSummary["subject"]) => {
  const def = spineSubjectDef(subject);
  return {
    wash: def?.accent.cardWash ?? "",
    border: def?.accent.cardBorder ?? "border-line",
    rtl: def?.dir === "rtl",
  };
};

const VERDICT_LABEL: Record<string, string> = {
  got_it: "فهمها ✓",
  nearly: "قريّب",
  needs_work: "محتاج شغل",
};

export function SubjectHome({
  summaries,
  studentName = "Omar (demo)",
}: {
  summaries: SubjectSummary[];
  /** the resolved demo student's row name — the greeting must never keep
   *  saying "عمر" after the demo switches to another student */
  studentName?: string;
}) {
  const first = shortName(studentName); // same convention as LessonCheckIn
  const ar = arabicGreetingName(studentName); // null when the row name is Latin
  return (
    <main className="mx-auto max-w-4xl px-6 pb-16">
      <section className="anim-rise pt-10">
        <p className="rule-label mb-4">After school · {first}</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          {ar ? `أهلاً يا ${ar} — ` : "أهلاً — "}تحب تذاكر إيه النهاردة؟
        </h1>
        <p className="mt-2.5 text-[15px] text-ink-soft">
          كل مادة لوحدها — تقدمك ودرجاتك محسوبة لكل مادة على حدة.
        </p>
      </section>

      <section
        className="anim-rise mt-8 grid gap-5 sm:grid-cols-2"
        style={{ animationDelay: "110ms" }}
      >
        {summaries.map((s) => {
          const a = cardOf(s.subject);
          return (
            <Link
              key={s.subject}
              href={`/student?subject=${s.subject}`}
              dir={a.rtl ? "rtl" : "ltr"}
              className={`ledger-card group block rounded-2xl border ${a.border} ${a.wash} p-5 transition-transform hover:-translate-y-0.5`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-xl font-medium text-ink">
                  {s.courseLabel}
                </h2>
                <span className="chip shrink-0">{s.lessonsCount} دروس</span>
              </div>

              {/* per-subject mastery — never blended across subjects */}
              <div className="mt-4 flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: pct(s.avgMastery),
                      backgroundColor: masteryColor(s.avgMastery),
                    }}
                  />
                </div>
                <span className="font-mono text-sm font-semibold text-ink">
                  {pct(s.avgMastery)}
                </span>
              </div>

              {s.weakestLo && (
                <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                  أضعف نقطة:{" "}
                  <span className="font-medium text-ink">
                    {s.weakestLo.label}
                  </span>{" "}
                  <span className="font-mono text-[11px] text-ink-faint">
                    ({pct(s.weakestLo.mastery)})
                  </span>
                </p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <span className="text-[12px] text-ink-faint">
                  {s.lastCheck
                    ? `آخر تقييم: ${VERDICT_LABEL[s.lastCheck.verdict] ?? s.lastCheck.verdict} · ${s.lastCheck.score}/100`
                    : "لسه مافيش تقييم"}
                </span>
                <span className="text-[13px] font-medium text-ink transition-transform group-hover:translate-x-0.5">
                  ابدأ ←
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}

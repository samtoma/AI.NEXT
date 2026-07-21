import Link from "next/link";
import type { SubjectSummary } from "@/lib/types";
import { masteryColor, pct } from "@/lib/mastery";

/**
 * The student's home (Wave 1.5, multi-subject spine §4): one card PER SUBJECT,
 * each with its own accent, mastery, and weakest topic. Mastery is rolled up
 * ONLY within a subject — the product NEVER shows a single blended score.
 */
const ACCENT: Record<string, { wash: string; border: string; rtl: boolean }> = {
  math: { wash: "bg-accent-wash", border: "border-accent/35", rtl: false },
  social: { wash: "bg-gold-wash", border: "border-gold/40", rtl: true },
};

const VERDICT_LABEL: Record<string, string> = {
  got_it: "فهمها ✓",
  nearly: "قريّب",
  needs_work: "محتاج شغل",
};

export function SubjectHome({ summaries }: { summaries: SubjectSummary[] }) {
  return (
    <main className="mx-auto max-w-4xl px-6 pb-16">
      <section className="anim-rise pt-10">
        <p className="rule-label mb-4">After school · Omar</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          أهلاً يا عمر — تحب تذاكر إيه النهاردة؟
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
          const a = ACCENT[s.subject] ?? ACCENT.math;
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

"use client";

import Link from "next/link";
import type { LessonMode, UnderstandingCheck, Verdict } from "@/lib/types";

/**
 * The honest comprehension report card — Ledger style.
 * Big score dial (SVG arc), verdict stamp (viridian / ochre / rust),
 * strengths & gaps columns, next step, and a warm non-punitive close.
 */

const VERDICT_META: Record<
  Verdict,
  {
    stamp: string;
    stampCls: string;
    color: string;
    headline: string;
    arabic: string;
  }
> = {
  got_it: {
    stamp: "Got it ✓",
    stampCls: "stamp-seal",
    color: "var(--m-high)",
    headline: "Confirmed. Go enjoy your evening 🎉",
    arabic: "فاهم الدرس — برافو عليك",
  },
  nearly: {
    stamp: "Nearly there",
    stampCls: "stamp-seal stamp-seal--gold",
    color: "var(--m-mid)",
    headline: "So close — we'll work on this together.",
    arabic: "النهاردة أحسن من امبارح",
  },
  needs_work: {
    stamp: "Needs work",
    stampCls: "stamp-seal stamp-seal--rust",
    color: "var(--m-low)",
    headline: "We'll work on this together — no stress.",
    arabic: "النهاردة أحسن من امبارح",
  },
};

/* 240° gauge geometry, normalized with pathLength=100 */
const CX = 100;
const CY = 96;
const RAD = 76;
const pt = (deg: number) => {
  const r = (deg * Math.PI) / 180;
  return `${(CX + RAD * Math.cos(r)).toFixed(1)} ${(CY - RAD * Math.sin(r)).toFixed(1)}`;
};
const ARC = `M ${pt(210)} A ${RAD} ${RAD} 0 1 1 ${pt(-30)}`;

/** Arabic verdict stamps for the RTL (social-ar) report. */
const AR_STAMP: Record<Verdict, string> = {
  got_it: "فاهمها ✓",
  nearly: "قرّبت خالص",
  needs_work: "محتاجة شغل",
};

export function ReportCard({
  check,
  mode,
  costUsd,
  studentName,
  rtl = false,
}: {
  check: UnderstandingCheck;
  mode: LessonMode;
  costUsd: number;
  studentName: string;
  /** social-ar lessons: RTL layout + Arabic-first labels (math unchanged) */
  rtl?: boolean;
}) {
  const v = VERDICT_META[check.verdict];

  return (
    <section
      dir={rtl ? "rtl" : undefined}
      className="anim-pop mx-auto w-full max-w-2xl"
    >
      <div className="ledger-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-6 py-3">
          {rtl ? (
            <span className="text-[11.5px] font-semibold text-ink-faint">
              تقرير الفهم · {mode === "learn" ? "درس متشرح" : "مراجعة"} ·{" "}
              {studentName.split(" ")[0]}
            </span>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
              Comprehension report · {mode === "learn" ? "taught lesson" : "revision"} ·{" "}
              {studentName.split(" ")[0]}
            </span>
          )}
          <span className="font-mono text-[9.5px] text-ink-faint">
            understanding_checks #{check.id} · {check.turns} AI turns
          </span>
        </div>

        <div className="px-6 pb-6 pt-5 sm:px-8">
          {/* dial + stamp */}
          <div className="relative mx-auto max-w-[300px]">
            <svg viewBox="0 0 200 150" className="block w-full" role="img" aria-label={`Score ${check.score} out of 100`}>
              <path
                d={ARC}
                fill="none"
                stroke="var(--line)"
                strokeWidth="9"
                strokeLinecap="round"
              />
              <path
                d={ARC}
                fill="none"
                stroke={v.color}
                strokeWidth="9"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="100"
                strokeDashoffset={100 - check.score}
                className="anim-dial"
              />
              <text
                x="100"
                y="94"
                textAnchor="middle"
                fontFamily="var(--stack-display)"
                fontSize="46"
                fontWeight="500"
                fill="var(--ink)"
              >
                {check.score}
              </text>
              <text
                x="100"
                y="112"
                textAnchor="middle"
                fontFamily="var(--stack-mono)"
                fontSize="8.5"
                letterSpacing="2"
                fill="var(--ink-faint)"
              >
                / 100 COMPREHENSION
              </text>
            </svg>
            <span
              className={`${v.stampCls} anim-stamp absolute -end-2 top-2 sm:-end-8`}
            >
              {rtl ? AR_STAMP[check.verdict] : v.stamp}
            </span>
          </div>

          {rtl ? (
            <p dir="rtl" className="mt-1 text-center font-display text-[22px] font-medium leading-snug text-ink">
              {v.arabic}
            </p>
          ) : (
            <>
              <p className="mt-1 text-center font-display text-[22px] font-medium leading-snug text-ink">
                {v.headline}
              </p>
              <p dir="rtl" className="mt-1 text-center text-[14px] text-ink-soft">
                {v.arabic}
              </p>
            </>
          )}

          {/* strengths / gaps */}
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="rule-label mb-2.5">{rtl ? "اللي ثبت معاك" : "What clicked"}</p>
              <ul className="space-y-1.5">
                {check.strengths.length === 0 && (
                  <li className="text-[12.5px] italic text-ink-faint">
                    {rtl
                      ? "— لسه مفيش حاجة ثابتة، وولا يهمك"
                      : "— nothing solid yet, and that's okay"}
                  </li>
                )}
                {check.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="anim-rise flex gap-2 text-[13px] leading-snug text-ink"
                    style={{ animationDelay: `${350 + i * 90}ms` }}
                  >
                    <span className="mt-px shrink-0 font-semibold text-accent-deep">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="rule-label mb-2.5">{rtl ? "اللي هنظبطه مع بعض" : "What we'll polish"}</p>
              <ul className="space-y-1.5">
                {check.gaps.length === 0 && (
                  <li className="text-[12.5px] italic text-ink-faint">
                    {rtl
                      ? "— مفيش ثغرات ظهرت في الجلسة دي"
                      : "— no gaps found in this session"}
                  </li>
                )}
                {check.gaps.map((g, i) => (
                  <li
                    key={i}
                    className="anim-rise flex gap-2 text-[13px] leading-snug text-ink"
                    style={{ animationDelay: `${350 + i * 90}ms` }}
                  >
                    <span className="mt-px shrink-0 font-semibold text-rust">✎</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* next step */}
          <div className="passport anim-rise mt-6 px-4 py-3" style={{ animationDelay: "550ms" }}>
            <p className="relative font-mono text-[8.5px] uppercase tracking-[0.2em] text-gold">
              {rtl ? "الخطوة الجاية · بكرة" : "Next step · بكرة"}
            </p>
            <p className="relative mt-1 text-[13.5px] leading-relaxed text-ink">
              {check.nextStep}
            </p>
          </div>

          <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
            rated by the tutor from the full session transcript · ${costUsd.toFixed(4)} · logged
          </p>
        </div>
      </div>

      <div className="anim-rise mt-4 flex flex-wrap gap-3" style={{ animationDelay: "650ms" }}>
        <Link
          href="/spine"
          className="flex-1 rounded-xl bg-ink px-6 py-3.5 text-center font-display text-lg font-medium text-paper transition-all duration-200 hover:-translate-y-0.5 hover:bg-accent-deep"
        >
          {rtl ? "شوفها على الشبكة ←" : "See it on the graph →"}
        </Link>
        <Link
          href="/student"
          className="rounded-xl border border-line bg-card px-6 py-3.5 font-display text-lg font-medium text-ink transition-all duration-200 hover:-translate-y-0.5"
        >
          {rtl ? "خلصنا النهاردة" : "Done for today"}
        </Link>
      </div>
    </section>
  );
}

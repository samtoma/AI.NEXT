"use client";

import Link from "next/link";
import type { LessonMode, UnderstandingCheck, Verdict } from "@/lib/types";
import { MASTERY_LEGEND } from "@/lib/mastery";
import {
  BADGE,
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  HONEY_BAND,
  STICKER_CARD,
  STROKE,
  cx,
} from "@/components/sticker";

/**
 * The honest comprehension report card — Noor Play anatomy.
 * Big score dial (SVG arc on the mastery ramp), a verdict BADGE (leaf /
 * Honey / inactive grey — never red), strengths & gaps columns, next step,
 * and a warm non-punitive close.
 *
 * It was the Ledger's: a dashed gold "passport" for the next step and a
 * rubber stamp rotated -8° for the verdict, beside sticker buttons (review
 * 2026-09-23, F14), and a button row in three border weights (F15). Every
 * surface below is now a sticker from `components/sticker.ts`, and the dial
 * paints with the same `--mastery-*` ramp as every other screen (F21) instead
 * of `--m-*`, which is red at the bottom under the Ledger palette.
 */

const VERDICT_META: Record<
  Verdict,
  {
    stamp: string;
    /** badge fill + its paired foreground — the border is the badge's ink */
    badgeInk: string;
    color: string;
    headline: string;
    arabic: string;
  }
> = {
  got_it: {
    stamp: "Got it ✓",
    // handoff: "Correct = leaf green"
    badgeInk: "bg-[var(--play-leaf)] text-[color:var(--play-on-leaf)]",
    color: MASTERY_LEGEND[4].color,
    headline: "Confirmed. Go enjoy your evening 🎉",
    arabic: "فاهم الدرس — برافو عليك",
  },
  nearly: {
    stamp: "Nearly there",
    badgeInk: "bg-card-warm text-[color:var(--play-text-amber-warm)]",
    color: MASTERY_LEGEND[2].color,
    headline: "So close — we'll work on this together.",
    arabic: "النهاردة أحسن من امبارح",
  },
  needs_work: {
    stamp: "Needs work",
    // the inactive grey, never a warning colour
    badgeInk: "bg-[var(--play-inactive-fill)] text-[color:var(--play-text-muted)]",
    color: MASTERY_LEGEND[1].color,
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

/** Arabic verdict stamps for the RTL report (the caller passes `rtl` from
 *  the lesson subject's registered direction — see LessonSession). */
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
  readOnly = false,
}: {
  check: UnderstandingCheck;
  mode: LessonMode;
  costUsd: number;
  studentName: string;
  /** RTL subjects: RTL layout + Arabic-first labels (LTR unchanged) */
  rtl?: boolean;
  /**
   * **Additive, and for the console's replay only** (ADR-0015 §3, FR-2305).
   *
   * The report card ends in three doors — the graph, practice, done — and they
   * are the student's next actions. In a reconstruction they are wrong twice
   * over: those routes do not exist in the console build at all (ADR-0014), so
   * they lead nowhere, and an operator clicking one would be taking a student's
   * action inside a surface whose contract is that it cannot. `readOnly` drops
   * the row and says why in its place. Everything above it — the score dial,
   * the verdict stamp, the strengths, the gaps, the next step — is what the
   * student was shown and is rendered unchanged.
   *
   * Default false: the student path is untouched.
   */
  readOnly?: boolean;
}) {
  const v = VERDICT_META[check.verdict];

  return (
    <section
      dir={rtl ? "rtl" : undefined}
      className="anim-pop mx-auto w-full max-w-2xl"
    >
      <div className={cx(STICKER_CARD, "overflow-hidden")}>
        <div className={cx(HONEY_BAND, "flex flex-wrap items-center justify-between gap-2 px-6 py-3")}>
          {rtl ? (
            <span className="text-[0.85rem] font-bold text-ink">
              تقرير الفهم · {mode === "learn" ? "درس متشرح" : "مراجعة"} ·{" "}
              {studentName.split(" ")[0]}
            </span>
          ) : (
            <span className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
              Comprehension report · {mode === "learn" ? "taught lesson" : "revision"} ·{" "}
              {studentName.split(" ")[0]}
            </span>
          )}
          <span className="font-mono text-[0.72rem] font-medium text-ink-faint">
            understanding_checks #{check.id} · {check.turns} AI turns
          </span>
        </div>

        <div className="px-6 pb-6 pt-5 sm:px-8">
          {/* dial + verdict badge */}
          <div className="relative mx-auto max-w-[300px]">
            <svg viewBox="0 0 200 150" className="block w-full" role="img" aria-label={`Score ${check.score} out of 100`}>
              {/* The quest-bar anatomy bent into an arc: an ink outline, a
                  white track inside it, and the ramp colour on top. Widths
                  are figure geometry in viewBox units, not sticker strokes. */}
              <path
                d={ARC}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="13"
                strokeLinecap="round"
              />
              <path
                d={ARC}
                fill="none"
                stroke="var(--card)"
                strokeWidth="8"
                strokeLinecap="round"
              />
              <path
                d={ARC}
                fill="none"
                style={{ stroke: v.color }}
                strokeWidth="8"
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
                fontWeight="800"
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
            {/* The badge lands with `pop` (the handoff's "badge landing").
                "Got it" also sends one ring out from behind it, after the pop
                rather than with it — one animation at a time. The ring sits
                on its own element: on the badge itself, `play-ring` ends at
                opacity 0 and took the verdict with it. */}
            <span className="anim-pop absolute -end-2 top-2 sm:-end-8">
              {check.verdict === "got_it" && (
                <span
                  aria-hidden
                  className="anim-ring-pulse pointer-events-none absolute inset-0 rounded-[var(--play-radius-pill)] border-[length:var(--play-stroke-sm)] border-solid border-[color:var(--noor-progress)]"
                  style={{ animationDelay: "380ms" }}
                />
              )}
              <span className={cx(BADGE, "relative", v.badgeInk)}>
                {rtl ? AR_STAMP[check.verdict] : v.stamp}
              </span>
            </span>
          </div>

          {rtl ? (
            <p dir="rtl" className="mt-1 text-center font-display text-[1.5rem] font-extrabold leading-[1.3] text-ink">
              {v.arabic}
            </p>
          ) : (
            <p className="mt-1 text-center font-display text-[1.5rem] font-extrabold leading-[1.3] text-ink">
              {v.headline}
            </p>
          )}

          {/* strengths / gaps */}
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="rule-label mb-2.5">{rtl ? "اللي ثبت معاك" : "What clicked"}</p>
              <ul className="space-y-1.5">
                {check.strengths.length === 0 && (
                  <li className="text-[0.9rem] text-ink-faint">
                    {rtl
                      ? "— لسه مفيش حاجة ثابتة، وولا يهمك"
                      : "— nothing solid yet, and that's okay"}
                  </li>
                )}
                {check.strengths.map((s, i) => (
                  <li
                    key={i}
                    className="anim-rise flex gap-2 font-read text-[1rem] leading-relaxed text-ink"
                    style={{ animationDelay: `${350 + i * 90}ms` }}
                  >
                    <span className="mt-px shrink-0 font-bold text-[color:var(--play-on-leaf-dim)]">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="rule-label mb-2.5">{rtl ? "اللي هنظبطه مع بعض" : "What we'll polish"}</p>
              <ul className="space-y-1.5">
                {check.gaps.length === 0 && (
                  <li className="text-[0.9rem] text-ink-faint">
                    {rtl
                      ? "— مفيش ثغرات ظهرت في الجلسة دي"
                      : "— no gaps found in this session"}
                  </li>
                )}
                {check.gaps.map((g, i) => (
                  <li
                    key={i}
                    className="anim-rise flex gap-2 font-read text-[1rem] leading-relaxed text-ink"
                    style={{ animationDelay: `${350 + i * 90}ms` }}
                  >
                    <span className="mt-px shrink-0 font-bold text-[color:var(--play-text-muted)]">✎</span>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* next step */}
          <div
            className={cx(STROKE, "anim-rise mt-6 rounded-[var(--play-radius)] bg-card-warm px-4 py-3 sticker-shadow-sm")}
            style={{ animationDelay: "550ms" }}
          >
            {/* Arabic is never set in mono and never letter-spaced (handoff,
                TYPE) — the eyebrow changes face with the language. */}
            {rtl ? (
              <p className="font-display text-[0.85rem] font-bold text-[color:var(--play-text-amber-warm)]">
                الخطوة الجاية · بكرة
              </p>
            ) : (
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-[color:var(--play-text-amber-warm)]">
                Next step · tomorrow
              </p>
            )}
            <p className="mt-1 font-read text-[1rem] leading-relaxed text-ink">
              {check.nextStep}
            </p>
          </div>

          <p className="mt-4 text-center font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
            rated by the tutor from the full session transcript · ${costUsd.toFixed(4)} · logged
          </p>
        </div>
      </div>

      {readOnly ? (
        <p className="mt-4 rounded-[var(--play-radius)] border-[length:var(--play-stroke)] border-dashed border-[color:var(--play-disabled-border)] px-4 py-2.5 text-center font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
          the student was offered three next steps here
        </p>
      ) : (
      <div className="anim-rise mt-4 flex flex-wrap gap-3" style={{ animationDelay: "650ms" }}>
        {/* One row, one anatomy (F15): the same stroke, radius, shadow and
            52px floor on all three doors; only the fill says which one is
            the primary. Amber on the graph — the ONE amber on this screen. */}
        <Link href="/spine" className={cx(BUTTON_PRIMARY, "flex-1 py-3")}>
          {rtl ? "شوفها على الشبكة ←" : "See it on the graph →"}
        </Link>
        {/* The third door (#29). Two options after a lesson meant a student
            who had just been shown her gaps could look at the graph or leave
            — nothing led to doing something about them.

            No new selection logic was needed: `mode=practice` is the plan
            loop, and the plan is already built weakest-first (three of its
            five items are the weakest objectives whose prerequisites are
            met). What was missing was a door into it from the one screen
            where a student has just been told what her weak spots are. */}
        <Link href="/student?mode=practice" className={cx(BUTTON_SECONDARY, "py-3")}>
          {rtl ? "ذاكر نقطة ضعفي" : "Practise my weak spots"}
        </Link>
        <Link href="/student" className={cx(BUTTON_SECONDARY, "py-3")}>
          {rtl ? "خلصنا النهاردة" : "Done for today"}
        </Link>
      </div>
      )}
    </section>
  );
}

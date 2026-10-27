"use client";

import { useState } from "react";
import Link from "next/link";
import type { LessonMode, UnderstandingCheck } from "@/lib/types";
import { MASTERY_PHRASE, masteryStage } from "@/lib/mastery";
import { stripInternalIds } from "@/lib/student-text";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, HEADING, STROKE, STROKE_WIDTH_SM, cx } from "@/components/sticker";

/**
 * The understanding report — "What you showed today" (design_handoff_guided_pages §4).
 *
 * No score, no verdict, nothing numeric reaches the student: the grader's 0–100 session score is
 * read through `masteryStage()` — the same bands the skill map uses — and shown as that stage's
 * phrase on a level pill and the 4-segment mastery ramp, in the skill map's own words
 * (`MASTERY_PHRASE`), so the two screens never name one level two ways. Then three short lists —
 * what you showed, what to work on, what's next — and the three doors.
 *
 * It was a 0–100 dial with a Got it / Nearly / Needs work stamp. The number and the stamp are
 * still what the grader wrote and what the console reads: the operator's replay (`readOnly`)
 * prints them in its receipts line, and nothing else changed about what is stored.
 *
 * Each list shows its first three items; the rest sit behind "Show N more". A display limit
 * only — the grader's output is not cut.
 */

const LIST_LIMIT = 3;

export function ReportCard({
  check,
  mode,
  costUsd,
  studentName,
  rtl = false,
  readOnly = false,
  lessonRef,
  skill,
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
   * the row and says why in its place, and adds the receipts an operator needs:
   * the record's id, its turn count, the grader's score and verdict, its cost.
   *
   * Default false: the student path is untouched.
   */
  readOnly?: boolean;
  /** "Lesson 1-1", for the eyebrow — absent in the replay, which shows the mode instead */
  lessonRef?: string;
  /** what the level is a level OF — the lesson's title */
  skill?: string;
}) {
  const stage = Math.max(1, masteryStage(check.score / 100)) as 1 | 2 | 3 | 4;
  const level = MASTERY_PHRASE[stage];

  const eyebrow = rtl
    ? ["الجلسة مشيت إزاي", lessonRef ?? (mode === "learn" ? "درس متشرح" : "مراجعة")].join(" · ")
    : ["How this session went", lessonRef ?? (mode === "learn" ? "Taught lesson" : "Quick revision")].join(" · ");

  return (
    <section dir={rtl ? "rtl" : undefined} className="mx-auto flex w-full max-w-[1040px] flex-col gap-3 sm:gap-[18px]">
      <p className="font-display text-[0.95rem] font-bold leading-none text-[color:var(--play-text-dim)]">
        {eyebrow}
        {readOnly && <> · {studentName.split(" ")[0]}</>}
      </p>
      <h1 className={cx(HEADING, "text-[1.4rem] leading-[1.12] sm:text-[2.2rem]")}>
        {rtl ? "اللي وريته النهاردة" : "What you showed today"}
      </h1>

      {/* the level card: where she is today, on the ramp */}
      <div className={cx(STROKE, "flex flex-col gap-3.5 rounded-[var(--chat-panel-radius)] bg-card p-3.5 sm:p-[22px]")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-display text-[0.9rem] font-bold leading-[1.2] text-[color:var(--play-text-dim)]">
            {skill
              ? rtl
                ? `${skill} · مكانك النهاردة`
                : `${skill} · where you are today`
              : rtl
                ? "مكانك النهاردة"
                : "Where you are today"}
          </span>
          <span
            className={cx(
              STROKE_WIDTH_SM,
              "anim-pop rounded-[var(--play-radius-pill)] border-ink bg-card-warm px-4 py-1.5 font-display text-[1.1rem] font-extrabold leading-none text-ink"
            )}
          >
            {level}
          </span>
        </div>
        {/* 4 segments, 5 stages: stage N lights N segments, segment k in --mastery-(k+1) */}
        <div className="flex gap-1.5" role="img" aria-label={level}>
          {[0, 1, 2, 3].map((k) => (
            <span
              key={k}
              className={cx(
                STROKE_WIDTH_SM,
                "relative h-4 flex-1 overflow-hidden rounded-[var(--play-radius-pill)] border-ink bg-[var(--mastery-0)]"
              )}
            >
              {k < stage && (
                <span
                  className="anim-fill-bar absolute inset-y-0 start-0"
                  style={
                    {
                      background: `var(--mastery-${k + 1})`,
                      "--play-fill-to": "100%",
                      animationDelay: `${k * 120}ms`,
                    } as React.CSSProperties
                  }
                />
              )}
            </span>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:gap-8 md:grid-cols-3">
        <ReportList
          title={rtl ? "اللي وريته" : "What you showed"}
          items={check.strengths.map(stripInternalIds)}
          empty={rtl ? "لسه مفيش حاجة ثابتة، وولا يهمك" : "Nothing solid yet, and that's okay"}
          dot="bg-[var(--noor-progress)]"
          rtl={rtl}
        />
        <ReportList
          title={rtl ? "نشتغل على إيه" : "What to work on"}
          items={check.gaps.map(stripInternalIds)}
          empty={rtl ? "مفيش ثغرات ظهرت في الجلسة دي" : "No gaps showed up this time"}
          dot="bg-[var(--play-text-dim)]"
          rtl={rtl}
        />
        <ReportList
          title={rtl ? "الخطوة الجاية" : "What's next"}
          items={[stripInternalIds(check.nextStep)].filter(Boolean)}
          empty=""
          dot="bg-ink"
          honey
          rtl={rtl}
        />
      </div>

      {readOnly ? (
        <>
          <p className="font-mono text-[0.72rem] font-medium text-ink-faint">
            understanding_checks #{check.id} · {check.turns} AI turns · score {check.score}/100 · verdict{" "}
            {check.verdict} · ${costUsd.toFixed(4)} · shown to the student as “{level}”, no number
          </p>
          <p className="rounded-[var(--play-radius)] border-[length:var(--play-stroke)] border-dashed border-[color:var(--play-disabled-border)] px-4 py-2.5 text-center font-mono text-[0.72rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
            the student was offered three next steps here
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {/* the ONE amber on this screen (the ramp's first segment aside) */}
          <Link href="/spine" className={BUTTON_PRIMARY}>
            {rtl ? "شوف تقدمك ←" : "See your progress →"}
          </Link>
          {/* The third door (#29): `mode=practice` is the plan loop, built weakest-first, so this
              is a door into working on what she was just told to work on. */}
          <Link href="/student?mode=practice" className={BUTTON_SECONDARY}>
            {rtl ? "ذاكر نقطة ضعفي" : "Practise my weak spots"}
          </Link>
          <Link
            href="/student"
            className="inline-flex min-h-11 items-center font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
          >
            {rtl ? "خلصنا النهاردة" : "Done for today"}
          </Link>
        </div>
      )}
    </section>
  );
}

/** One of the report's three lists: three items at most, the rest behind "Show N more". */
function ReportList({
  title,
  items,
  empty,
  dot,
  honey = false,
  rtl,
}: {
  title: string;
  items: string[];
  empty: string;
  /** the bullet's fill class */
  dot: string;
  /** "What's next": a flat Honey block */
  honey?: boolean;
  rtl: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, LIST_LIMIT);
  const more = items.length - shown.length;
  return (
    <div
      className={cx(
        "flex flex-col gap-2.5 text-ink",
        honey ? "rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-3.5" : "px-1"
      )}
    >
      <p className="font-display text-[1.1rem] font-extrabold leading-none">{title}</p>
      {items.length === 0 && empty && (
        <p className="font-read text-[1rem] leading-[1.5] text-[color:var(--play-text-dim)]">{empty}</p>
      )}
      {shown.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {shown.map((it, i) => (
            <li key={i} className="flex items-baseline gap-2.5">
              <span aria-hidden className={cx("size-2 shrink-0 -translate-y-px rounded-full", dot)} />
              <span className="font-read text-[1rem] leading-[1.5]">{it}</span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center self-start font-display text-[0.92rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
        >
          {rtl ? `اعرض ${more} كمان` : `Show ${more} more`}
        </button>
      )}
    </div>
  );
}

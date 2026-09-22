import Link from "next/link";
import type { SubjectSummary } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import { masteryColor, pct } from "@/lib/mastery";

/** "Omar Hassan" → "Omar" — the convention LessonCheckIn uses too. */
const shortName = (displayName: string) => displayName.split(" ")[0] || displayName;

/**
 * The name to drop INSIDE Arabic copy («أهلاً يا نور»), or null when the row
 * name is not Arabic — «أهلاً يا Omar» reads as a bug, so a Latin name is
 * omitted and the sentence greets without it.
 */
const arabicGreetingName = (displayName: string): string | null => {
  const first = shortName(displayName);
  return /^[؀-ۿݐ-ݿ]+$/.test(first) ? first : null;
};

/**
 * The student's home (Wave 1.5, multi-subject spine §4): one card PER SUBJECT,
 * each with its own accent, mastery, and weakest topic. Mastery is rolled up
 * ONLY within a subject — the product NEVER shows a single blended score.
 *
 * ---------------------------------------------------------------------------
 * WIDE ROWS, NOT A GRID (Samuel, 2026-09-22: "three wide cards")
 * ---------------------------------------------------------------------------
 * The cards used to sit in a two-column grid, which made three subjects render
 * as two-and-a-bit and made a fourth change the shape of the whole screen. They
 * are now one full-width row each, stacked: the subject and how many lessons it
 * holds, then how far along it is, then the way in. One row per subject scales
 * from one to six without the layout meaning anything different, which is the
 * property a grid of a variable number of items does not have.
 *
 * Each row is laid out with ordinary flex and LOGICAL spacing, and carries the
 * `dir` its registry entry declares (`lib/subjects.ts`). That is the whole RTL
 * story: `flex-row` follows `direction`, so an Arabic row mirrors itself — the
 * subject name starts at the right, the way-in ends at the left — with no
 * second stylesheet and no `dir`-shaped branch in this file. Two of the three
 * live subjects are Arabic, so this is the common case, not the exception.
 *
 * The one glyph that cannot mirror itself is the arrow. A `←` character is NOT
 * bidi-mirrored by any browser, so the old `ابدأ ←` was a hard-coded direction
 * dressed as text — correct for the Arabic subjects and backwards for
 * Mathematics. It is an inline SVG chevron now, flipped by `rtl:-scale-x-100`,
 * which is the same idiom `components/viz/FlowChain.tsx` already uses for its
 * connector. Nothing else in the row needs to know which way it is pointing.
 *
 * ---------------------------------------------------------------------------
 * COLOUR AND TOKENS (constitution XII)
 * ---------------------------------------------------------------------------
 * Every value here is a token: the card wash and border come from the subject's
 * registry accent, the type and rules from `ink`/`line`, and the only inline
 * style is the mastery fill, whose five steps live in `lib/mastery.ts` verbatim
 * from `tokens.css`. The bar is never the only carrier — the percentage sits
 * beside it and the bar itself carries a label for a screen reader.
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

  /**
   * **An empty list is a screen, not an error.** It is reached by a student in
   * a grade nobody has switched any subject on for — which under explicit
   * allow (`lib/catalog.ts`) is what a *new* grade looks like, not a fault. She
   * used to get a 404 here; see `lib/student-landing.ts` for how that happened.
   *
   * The copy says three things and nothing else: there is nothing yet, it is
   * not her doing, and it will appear on this page by itself. It names no rule,
   * no grade, no operator and no way to hurry it along, because there is no
   * such way and telling a fifteen-year-old to go and ask somebody would be
   * inventing one.
   */
  const empty = summaries.length === 0;

  return (
    <main className="mx-auto max-w-4xl px-6 pb-16">
      <section className="anim-rise pt-10">
        <p className="rule-label mb-4">After school · {first}</p>
        <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
          {ar ? `أهلاً يا ${ar} — ` : "أهلاً — "}
          {empty ? "لسه مافيش مادة جاهزة هنا" : "تحب تذاكر إيه النهاردة؟"}
        </h1>
        <p className="mt-2.5 text-[15px] text-ink-soft">
          {empty
            ? "مش حاجة عملتها إنت. أول ما تبقى فيه مادة جاهزة هتلاقيها في الصفحة دي."
            : "كل مادة لوحدها — تقدمك ودرجاتك محسوبة لكل مادة على حدة."}
        </p>
      </section>

      <section
        className="anim-rise mt-8 flex flex-col gap-4"
        style={{ animationDelay: "110ms" }}
      >
        {summaries.map((s) => {
          const a = cardOf(s.subject);
          return (
            <Link
              key={s.subject}
              href={`/student?subject=${s.subject}`}
              dir={a.rtl ? "rtl" : "ltr"}
              className={`ledger-card play-pressable group flex w-full flex-col gap-4 rounded-2xl border ${a.border} ${a.wash} p-5 transition-transform hover:-translate-y-0.5 sm:flex-row sm:items-center sm:gap-6`}
            >
              {/* 1. who this row is — the subject in its own script, and how
                     much of it there is to do */}
              <div className="min-w-0 sm:basis-[36%]">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h2 className="font-display text-xl font-medium text-ink">
                    {s.courseLabel}
                  </h2>
                  <span className="chip shrink-0">{s.lessonsCount} دروس</span>
                </div>
                <p className="mt-1 text-[12px] text-ink-faint">
                  {s.lastCheck
                    ? `آخر تقييم: ${VERDICT_LABEL[s.lastCheck.verdict] ?? s.lastCheck.verdict} · ${s.lastCheck.score}/100`
                    : "لسه مافيش تقييم"}
                </p>
              </div>

              {/* 2. per-subject mastery — never blended across subjects — and
                     the one topic worth naming */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div
                    role="img"
                    // The bar is a picture of a number. Sighted readers get the
                    // percentage beside it; this is the same fact for everyone
                    // else, in the card's own language.
                    aria-label={`تقدمك في ${s.courseLabel}: ${pct(s.avgMastery)}`}
                    className="h-2 flex-1 overflow-hidden rounded-full bg-ink/10"
                  >
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

                {s.weakestLo ? (
                  <p className="mt-2 truncate text-[13px] leading-relaxed text-ink-soft">
                    أضعف نقطة:{" "}
                    <span className="font-medium text-ink">
                      {s.weakestLo.label}
                    </span>{" "}
                    <span className="font-mono text-[11px] text-ink-faint">
                      ({pct(s.weakestLo.mastery)})
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
                    لسه بدري نقول أضعف نقطة
                  </p>
                )}
              </div>

              {/* 3. the way in. `shrink-0` so the label never wraps mid-phrase
                     on a narrow iPad column. */}
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-ink">
                ابدأ
                <ForwardChevron />
              </span>
            </Link>
          );
        })}

        <MoreSubjectsComing />
      </section>
    </main>
  );
}

/**
 * The way-in arrow, pointing along the reading order.
 *
 * `currentColor` rather than a stroke colour, so it is the row's own `text-ink`
 * and there is no literal in this file (constitution XII). `rtl:-scale-x-100`
 * is what makes it point the right way in both directions — see the header.
 */
function ForwardChevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className="h-3 w-3 shrink-0 rtl:-scale-x-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 2.5 L8 6 L4 9.5" />
    </svg>
  );
}

/**
 * «مواد تانية في الطريق» — the "+" Samuel asked for, and the reason it does
 * nothing.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A PROMISE, NOT A CONTROL
 * ---------------------------------------------------------------------------
 * There is no flow in this product by which a student can request, buy or
 * unlock a subject. None is planned in this release either: which subjects a
 * student sees is decided by an operator on the console, and `requires_plan`
 * (migration 023) is an inert column that gates nothing. So a "+" that looked
 * pressable would be an affordance for an action that does not exist — and the
 * people reading it are fifteen. A button that does nothing teaches a child
 * that she pressed it wrong.
 *
 * So it is **not a link, not a button, and not focusable**. It carries no
 * `href`, no `onClick`, no `tabIndex` and no `role`; it is a paragraph in a
 * frame, and a keyboard tab goes straight past it to the next real thing. The
 * copy is explicit about the absence — «مش محتاج تطلبها ولا تعمل أي حاجة» —
 * because "more coming" on its own invites the question "how do I get them?",
 * and the honest answer is that there is nothing to do.
 *
 * ---------------------------------------------------------------------------
 * AND IT MUST NOT LOOK LIKE A COURSE
 * ---------------------------------------------------------------------------
 * Every signal the real rows use to say "you can enter me" is deliberately
 * absent: no `ledger-card` (so no fill and no sticker shadow), no
 * `play-pressable` (so it does not move when pressed — "if it doesn't move, it
 * isn't a control", and the converse is what is being avoided here), no accent
 * wash, no progress, no chevron. What is left is a dashed outline on the page's
 * own paper, which in this design system already means *not ready yet*:
 * `globals.css` gives every disabled control a dashed border and no shadow for
 * exactly that reason (handoff, Buttons).
 *
 * The `+` glyph is `aria-hidden` decoration. The sentence carries the meaning
 * on its own, the same rule `Chip` and `WidgetShell` follow — a state that is
 * only a symbol is a state a screen reader does not have.
 *
 * **No `dir`.** This card belongs to the page's chrome rather than to any one
 * subject, so it inherits the document's direction like the heading above it,
 * instead of asserting one of its own (constitution V: direction is never
 * hard-coded).
 */
function MoreSubjectsComing() {
  return (
    <div className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-line px-5 py-4">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line font-display text-[20px] leading-none text-ink-faint"
      >
        +
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-medium text-ink-soft">مواد تانية في الطريق</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-faint">
          لما تتضاف مادة جديدة هتلاقيها هنا على طول — مش محتاج تطلبها ولا تعمل أي حاجة.
        </p>
      </div>
    </div>
  );
}

import Link from "next/link";
import type { SubjectSummary } from "@/lib/types";
import { spineSubjectDef } from "@/lib/subjects";
import { masteryColor, pct } from "@/lib/mastery";
import { rollupText, rollupTextAr } from "@/lib/section-label";
import { MathText } from "@/components/MathText";
import { BADGE, HEADING, STROKE, STROKE_SM, cx } from "@/components/sticker";

/** "Omar Hassan" → "Omar" — the convention LessonCheckIn uses too. */
const shortName = (displayName: string) => displayName.split(" ")[0] || displayName;

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
 * Every value here is a token. Each row is a Noor Play SUBJECT TILE: 3px ink,
 * 20px radius, hard shadow, and the subject's PLAYMATE fill with its paired
 * foreground (sky / leaf / berry, from the registry's `accent.tile`), because
 * the playmates exist for exactly this — recognition, not decoration.
 *
 * It used to be `.ledger-card` plus `bg-*-wash`/`border-*` utilities, and every
 * card rendered identical white (review 2026-09-23, F13): `.ledger-card` is an
 * unlayered rule in `globals.css`, Tailwind's utilities live in a cascade
 * layer, and an unlayered declaration beats a layered one whatever its
 * specificity. So the tile no longer wears `.ledger-card` at all — its fill,
 * outline, radius and shadow are all token utilities that nothing outranks.
 *
 * The only inline style is the mastery fill, `var(--mastery-N)` from
 * `lib/mastery.ts`. The bar is never the only carrier — the percentage sits
 * beside it and the bar itself carries a label for a screen reader.
 */

/**
 * Verdict labels, English first — this is the cross-subject default per
 * constitution v3.2.0 Principle V. The Arabic form is used only inside an
 * Arabic-subject row (`SubjectCard`'s own `rtl`, from the subject registry's
 * `dir`), the same split `ReportCard`'s `VERDICT_META`/`AR_STAMP` already
 * make for the same data.
 */
const VERDICT_LABEL: Record<string, string> = {
  got_it: "Got it ✓",
  nearly: "Nearly there",
  needs_work: "Needs work",
};
const VERDICT_LABEL_AR: Record<string, string> = {
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
      {/*
       * This page is the home for EVERY student regardless of which subject
       * they end up in — it is reached before any subject is chosen, and an
       * empty grade (no live course yet) lands here too. So its chrome is
       * English, unconditionally, per constitution v3.2.0 Principle V: English
       * is the MVP 1.0 default and this screen has no single subject whose
       * `dir`/language it could otherwise follow. Only the cards below, one
       * per subject, take on that subject's own language (`SubjectCard`).
       */}
      <section className="anim-rise pt-10">
        <p className="rule-label mb-4">After school · {first}</p>
        <h1 className={cx(HEADING, "text-[1.9rem] md:text-[2.4rem]")}>
          {empty ? `${first}, nothing's ready here yet` : `What do you want to study today, ${first}?`}
        </h1>
        <p className="mt-2.5 text-[1rem] text-ink-soft">
          {empty
            ? "This isn't anything you did — the moment a subject is ready, it'll show up on this page by itself."
            : "Every subject stands alone — your progress and scores are tracked separately for each one."}
        </p>
      </section>

      <section
        className="anim-rise mt-8 flex flex-col gap-4"
        style={{ animationDelay: "110ms" }}
      >
        {summaries.map((s) => (
          <SubjectCard key={s.subject} summary={s} />
        ))}

        <MoreSubjectsComing />
      </section>
    </main>
  );
}

/**
 * One subject, as a Play subject tile.
 *
 * Card tokens + direction come from the subject's registry entry, so a new
 * subject arrives styled instead of inheriting maths' tile by default. A
 * subject with no registry entry falls back to a plain white tile — ink on
 * card, still a correct pair — rather than borrowing another subject's colour.
 *
 * `rtl` — from the subject's own registry `dir`, the same source
 * `LessonSession` reads (`isRtlSubject`) — is this card's `arabicUi`: it is
 * the only thing in this file allowed to render Arabic copy, and only for an
 * Arabic-taught subject (Arabic, Social Studies). English (maths, and the
 * unknown-subject fallback) is not a translation of a Arabic default here —
 * it is the default, per constitution v3.2.0 Principle V.
 */
function SubjectCard({ summary: s }: { summary: SubjectSummary }) {
  const def = spineSubjectDef(s.subject);
  const tile = def?.accent.tile ?? "bg-card text-ink";
  const dim = def?.accent.tileDim ?? "text-ink-soft";
  const rtl = def?.dir === "rtl";
  // The book section she is in the middle of, rolled up (FR-4314): the first
  // split section, in the book's order, that she has started and not yet
  // mastered — "1.7 Factorisation · 2 of 3 parts mastered". One line, not a
  // list: this card answers "where am I?", and the check-in names the part.
  // A course with no split section (every National course) has no sections,
  // so the card is exactly what it was. An Arabic (RTL) card words it in
  // Arabic, «الأجزاء المتقنة: ٢ من ٣» (`rollupTextAr`) — provisional, for
  // product-designer's review (backlog #38); no Arabic-taught course has a
  // split section today, so no card shows it yet.
  const inSection = (s.sections ?? []).find((x) => x.started && !x.isMastered);

  return (
    <Link
      href={`/student?subject=${s.subject}`}
      dir={rtl ? "rtl" : "ltr"}
      className={cx(
        STROKE,
        tile,
        "sticker-shadow play-pressable group flex w-full flex-col gap-4 rounded-[var(--play-radius)] p-5 sm:flex-row sm:items-center sm:gap-6"
      )}
    >
      {/* 1. who this row is — the subject in its own script, and how
             much of it there is to do */}
      <div className="min-w-0 sm:basis-[36%]">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="font-display text-[1.5rem] font-extrabold leading-[1.2]">
            {s.courseLabel}
          </h2>
          <span className={cx(BADGE, "shrink-0 bg-card text-ink")}>
            {rtl ? `${s.lessonsCount} دروس` : `${s.lessonsCount} lessons`}
          </span>
        </div>
        <p className={cx("mt-1 text-[0.85rem] font-bold", dim)}>
          {s.lastCheck
            ? rtl
              ? `آخر تقييم: ${VERDICT_LABEL_AR[s.lastCheck.verdict] ?? s.lastCheck.verdict} · ${s.lastCheck.score}/100`
              : `Last check: ${VERDICT_LABEL[s.lastCheck.verdict] ?? s.lastCheck.verdict} · ${s.lastCheck.score}/100`
            : rtl
              ? "لسه مافيش تقييم"
              : "No check yet"}
        </p>
      </div>

      {/* 2. per-subject mastery — never blended across subjects — and
             the one topic worth naming */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          {/* The handoff's quest-bar anatomy: a white track in a thin ink
              outline, so the fill reads on any playmate behind it. */}
          <div
            role="img"
            // The bar is a picture of a number. Sighted readers get the
            // percentage beside it; this is the same fact for everyone
            // else, in the card's own language.
            aria-label={
              rtl
                ? `تقدمك في ${s.courseLabel}: ${pct(s.avgMastery)}`
                : `Your progress in ${s.courseLabel}: ${pct(s.avgMastery)}`
            }
            className={cx(
              STROKE_SM,
              "h-[18px] flex-1 overflow-hidden rounded-[var(--play-radius-pill)] bg-card p-0.5"
            )}
          >
            <div
              className="h-full rounded-[var(--play-radius-pill)] transition-all duration-700"
              style={{
                width: pct(s.avgMastery),
                backgroundColor: masteryColor(s.avgMastery),
              }}
            />
          </div>
          <span className="font-mono text-[0.95rem] font-medium">
            {pct(s.avgMastery)}
          </span>
        </div>

        {s.weakestLo ? (
          <p className={cx("mt-2 truncate text-[0.9rem] font-bold", dim)}>
            {rtl ? "أضعف نقطة:" : "Weakest point:"}{" "}
            {/* an objective label may carry maths (backlog #37) */}
            <MathText className="font-extrabold" text={s.weakestLo.label} />{" "}
            <span className="font-mono text-[0.8rem] font-medium">
              ({pct(s.weakestLo.mastery)})
            </span>
          </p>
        ) : (
          <p className={cx("mt-2 text-[0.9rem] font-bold", dim)}>
            {rtl ? "لسه بدري نقول أضعف نقطة" : "Too early to say a weakest point"}
          </p>
        )}

        {inSection && (
          <p className={cx("mt-1 truncate text-[0.9rem] font-bold", dim)}>
            <span className="font-extrabold">
              <span dir="ltr">{inSection.number}</span> {inSection.title}
            </span>
            {" · "}
            {rtl ? rollupTextAr(inSection) : rollupText(inSection)}
          </p>
        )}
      </div>

      {/* 3. the way in. `shrink-0` so the label never wraps mid-phrase
             on a narrow iPad column. */}
      <span className="inline-flex shrink-0 items-center gap-1.5 font-display text-[1.15rem] font-bold">
        {rtl ? "ابدأ" : "Start"}
        <ForwardChevron />
      </span>
    </Link>
  );
}

/**
 * The way-in arrow, pointing along the reading order.
 *
 * `currentColor` rather than a stroke colour, so it is the tile's own `on-` colour
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
 * "More subjects coming" — the "+" Samuel asked for, and the reason it does
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
 * copy is explicit about the absence — "you don't need to request it or do
 * anything" — because "more coming" on its own invites the question "how do
 * I get them?", and the honest answer is that there is nothing to do.
 *
 * ---------------------------------------------------------------------------
 * AND IT MUST NOT LOOK LIKE A COURSE
 * ---------------------------------------------------------------------------
 * Every signal the real rows use to say "you can enter me" is deliberately
 * absent: no playmate fill and no sticker shadow, no
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
    <div className="flex w-full items-center gap-4 rounded-[var(--play-radius)] border-[length:var(--play-stroke)] border-dashed border-[color:var(--play-disabled-border)] px-5 py-4">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] border-[length:var(--play-stroke-sm)] border-dashed border-[color:var(--play-disabled-border)] font-display text-[1.25rem] font-bold leading-none text-ink-faint"
      >
        +
      </span>
      <div className="min-w-0">
        <p className="font-display text-[1rem] font-bold text-ink-soft">More subjects coming</p>
        <p className="mt-0.5 text-[0.9rem] leading-relaxed text-ink-faint">
          When a new subject is added it&apos;ll show up here on its own — you don&apos;t need to request it or do anything.
        </p>
      </div>
    </div>
  );
}

"use client";

import type { LessonPassage } from "@/lib/lesson-content";
import { QuranPassage } from "@/components/QuranPassage";

/**
 * A SEALED passage, rendered verbatim from the verified store (ADR-0006).
 *
 * This component is the ONLY way sacred text reaches a student surface: the
 * bytes come from the pipeline's checksummed seed data, never from a model.
 * The tutor references it by id ({{show_passage:…}}) and by آية number; it is
 * rendered on the read surface AND on the lesson whiteboard — Samuel's field
 * finding: the tutor once said «افتح بطاقة النص» on a surface that had no
 * such card, quizzing the student on text they had never seen.
 *
 * Quran gets the Amiri Quran face (lazy-loaded by this import path only) and
 * per-آية rows with printed numbers; everything else reads in global Naskh.
 */
export function SealedPassageCard({
  passage,
  compact = false,
}: {
  passage: LessonPassage;
  /** board rendering: tighter type scale, no outer margins */
  compact?: boolean;
}) {
  const sacred = passage.sacred;
  const body = (
    <div className="space-y-2">
      {passage.units.map((u) => (
        <p
          key={u.n}
          className={
            sacred
              ? compact
                ? "text-[16.5px] leading-[2.1] text-ink"
                : "text-[19px] leading-[2.3] text-ink"
              : "text-[15px] leading-loose text-ink"
          }
        >
          {u.text_ar}
          {u.printed_n && (
            <span className="mx-1.5 text-[13px] text-gold">﴿{u.printed_n}﴾</span>
          )}
        </p>
      ))}
    </div>
  );
  return (
    <article
      dir="rtl"
      className={`ledger-card px-5 py-4 ${sacred ? "border-gold/45 bg-gold-wash/40" : ""} ${
        compact ? "" : "mt-3 first:mt-0"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[16px] font-medium text-ink">
          {passage.title_ar}
        </h2>
        {passage.attribution_ar && (
          <span className="text-[11px] text-ink-faint">{passage.attribution_ar}</span>
        )}
      </div>
      {sacred ? <QuranPassage>{body}</QuranPassage> : body}
      {sacred && (
        <p className="mt-2 text-[10px] text-ink-faint">
          نصٌّ موثَّق: تمت مطابقته آليًا مع مصدرين مستقلين للمصحف
          {passage.verification_verdict === "agree" ? " · مطابق" : " · قيد المراجعة"}
        </p>
      )}
    </article>
  );
}

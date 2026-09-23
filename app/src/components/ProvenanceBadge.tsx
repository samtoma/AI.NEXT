import { questionProvenance } from "@/lib/provenance";

/**
 * The provenance chip. One component so the three states look the same
 * wherever a question is listed.
 *
 * Colour is never the only signal — each chip carries its own words — because
 * this badge exists to be believed by someone scanning a long list, and a
 * reader who cannot distinguish amber from teal must still be able to tell an
 * unchecked item from a checked one.
 *
 * Amber means "look at this", not "something is wrong". An unreviewed question
 * is an authorised state under the standing exception, not a fault, and there
 * is no red anywhere in this palette to reach for anyway.
 *
 * **Paired colours, as utilities** (review 2026-09-23, F9). "Confirmed" used
 * to be teal text on a teal tint — 2.74:1 at 9.5px, with a literal hex
 * fallback. It is now ink on a 15% progress tint (`bg-progress/15`, from the
 * `@theme` block in globals.css), which clears AA at any size in every
 * variant; the teal is carried by the tint (and, outside Play, the edge),
 * the meaning by the word. Gold on the gold wash measures ≈5.1:1 on white
 * under Play and passes as it was. `ds-tag` says this is a label, not a
 * control, so Play draws it as a fill with no sticker outline (F10).
 */
export function ProvenanceBadge({
  question,
  size = "sm",
}: {
  question: { source: string | null; reviewedBy?: string | null };
  size?: "sm" | "md";
}) {
  const v = questionProvenance(question);

  const tone =
    v.tone === "attention"
      ? "border-gold bg-gold-wash text-gold"
      : v.tone === "confirmed"
        ? "border-progress bg-progress/15 text-ink"
        : "border-line bg-accent-wash text-ink-soft";

  return (
    <span
      title={v.detail}
      className={`ds-tag inline-flex shrink-0 items-center gap-1 rounded border font-mono uppercase tracking-[0.1em] ${tone} ${
        size === "md" ? "px-2 py-0.5 text-[10.5px]" : "px-1.5 py-px text-[9.5px]"
      }`}
    >
      {v.short}
    </span>
  );
}

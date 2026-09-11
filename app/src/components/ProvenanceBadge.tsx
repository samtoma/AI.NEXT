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
      ? { bg: "var(--gold-wash)", fg: "var(--gold)", br: "var(--gold)" }
      : v.tone === "confirmed"
        ? { bg: "rgb(47 158 143 / 0.14)", fg: "var(--nour-progress, #2F9E8F)", br: "var(--nour-progress, #2F9E8F)" }
        : { bg: "var(--accent-wash)", fg: "var(--ink-soft)", br: "var(--line)" };

  return (
    <span
      title={v.detail}
      className={`inline-flex shrink-0 items-center gap-1 rounded border font-mono uppercase tracking-[0.1em] ${
        size === "md" ? "px-2 py-0.5 text-[10.5px]" : "px-1.5 py-px text-[9.5px]"
      }`}
      style={{ background: tone.bg, color: tone.fg, borderColor: tone.br }}
    >
      {v.short}
    </span>
  );
}

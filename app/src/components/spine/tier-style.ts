import type { Tier } from "@/lib/types";

/**
 * Tier chip colours for the operator-facing surfaces — the question modal's
 * provenance header and the live-question card's debug strip.
 *
 * This used to live in `LoPanel`, which no longer renders a tier key at all:
 * the skill map names the three tiers in plain words ("To warm up", "The main
 * ones", "If you want a push"). Keeping the map here stops the two importers
 * reaching into a student-facing component for a style token.
 */
export const tierStyle: Record<Tier, string> = {
  basic: "bg-accent-wash text-accent-deep border-accent/30",
  standard: "bg-gold-wash text-gold border-gold/35",
  advanced: "bg-rust-wash text-rust border-rust/30",
};

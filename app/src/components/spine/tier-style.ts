import type { Tier } from "@/lib/types";
import { TIER_INK } from "@/components/sticker";

/**
 * Tier chip colours for the operator-facing surfaces — the question modal's
 * provenance header and the live-question card's debug strip.
 *
 * This used to live in `LoPanel`, which no longer renders a tier key at all:
 * the skill map names the three tiers in plain words ("To warm up", "The main
 * ones", "If you want a push"). Keeping the map here stops the importers
 * reaching into a student-facing component for a style token. The values are
 * main's Play tier inks (`components/sticker.ts`), not the Ledger washes the
 * branch carried.
 */
export const tierStyle: Record<Tier, string> = TIER_INK;

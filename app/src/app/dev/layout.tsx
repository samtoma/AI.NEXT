import { notFound } from "next/navigation";
import { INTERNAL_SURFACES } from "@/lib/env";

/**
 * Gate for every `/dev/*` harness (#10, #11, #12).
 *
 * A layout rather than a guard per page, for one practical reason: two of
 * these harnesses are `"use client"` pages, which cannot read a server-only
 * environment flag at all. A layout is a server component regardless of what
 * it wraps, so this covers the client pages and every route added under
 * `/dev` later — the failure mode of a per-page guard is the page somebody
 * forgets, and these are the pages a student should never reach.
 */
/**
 * Forced dynamic so the gate is a RUNTIME decision.
 *
 * Two of these harnesses are `"use client"` pages with no data fetch, so Next
 * prerenders them at build time — and a prerendered page evaluates this layout
 * once, during the build. Without this the flag would be baked in: a build made
 * with the surfaces off served a permanent 404 even when the deployed container
 * had `AINEXT_INTERNAL_SURFACES=on`. Caught by requesting them with the
 * override set and getting 404 anyway.
 */
export const dynamic = "force-dynamic";

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!INTERNAL_SURFACES) notFound();
  return <>{children}</>;
}

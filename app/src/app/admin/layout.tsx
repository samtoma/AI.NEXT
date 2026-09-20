import { notFound } from "next/navigation";
import { INTERNAL_SURFACES } from "@/lib/env";

/**
 * Gate for every `/admin/*` surface (#11).
 *
 * This is a build-time switch, not a permission check, and the distinction
 * matters: it makes the student build not carry these routes, but it cannot
 * tell one person from another. Real roles need accounts (#7, #8, FR-106,
 * DEFERRED). Until those land, nothing here should be described as protected.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!INTERNAL_SURFACES) notFound();
  return <>{children}</>;
}

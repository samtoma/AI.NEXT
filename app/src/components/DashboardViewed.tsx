"use client";

import { useEffect, useRef } from "react";

import { track } from "@/lib/ga";

/**
 * Emits `dashboard_viewed` once per mount (PRD §13).
 *
 * A ref guard rather than an empty dep array alone: React Strict Mode double-
 * invokes effects in development, and a metric that double-counts in dev is a
 * metric nobody trusts in production.
 *
 * **Two destinations, one moment** (ADR-0016): the first-party POST is the
 * record, and `track()` mirrors the same moment to GA4 with no identifier
 * attached. The GA call is deliberately second and deliberately unawaited — it
 * no-ops when no measurement id is configured and when the domain is blocked.
 */
export function DashboardViewed() {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "dashboard_viewed" }),
      keepalive: true,
    }).catch(() => {});
    track("dashboard_viewed", { surface: "dashboard" });
  }, []);
  return null;
}

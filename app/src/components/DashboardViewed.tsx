"use client";

import { useEffect, useRef } from "react";

/**
 * Emits `dashboard_viewed` once per mount (PRD §13).
 *
 * A ref guard rather than an empty dep array alone: React Strict Mode double-
 * invokes effects in development, and a metric that double-counts in dev is a
 * metric nobody trusts in production.
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
  }, []);
  return null;
}

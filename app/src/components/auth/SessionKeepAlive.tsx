"use client";

import { useEffect } from "react";
import { startSessionKeepAlive } from "@/lib/auth/client-session";

/**
 * Keeps a signed-in student signed in while they are actually on the page
 * (FR-2016, `lib/auth/client-session.ts`). Mounted once, by the root layout,
 * for a signed-in student on the student build only. Renders nothing: when
 * renewal fails, the one place that says so is the tutor chat, in the spot
 * its error message would otherwise take (product call, 2026-09-30).
 */
export function SessionKeepAlive() {
  useEffect(() => startSessionKeepAlive(), []);
  return null;
}

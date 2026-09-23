"use client";

import { useState } from "react";
import { Chip, Empty } from "@/components/console/ui";
import { ScrollList } from "@/components/console/ScrollList";

/**
 * Where this operator account is signed in, and the two ways out of it.
 *
 * **The list is read on the server and handed down; only the two actions are
 * client-side.** `/profile` calls the same `listSessions` the
 * `GET /api/auth/sessions` handler calls, in the same `withAuthTx`, so there is
 * one query and one revocation rule rather than a console copy of either — and
 * the page arrives with its content instead of rendering empty and filling in.
 * Revoking and signing out go through the endpoints, because those are writes
 * and the endpoints own the events they emit.
 *
 * **No token material is displayed and none is available to display**: the
 * session row carries a device string, an address, and two timestamps. Not a
 * hash, not a prefix, not a length.
 *
 * Both actions end in a **full navigation or reload** rather than a soft
 * refresh, for the reason the student shell states: the response changes or
 * clears cookies, and a soft navigation can render the next screen from a
 * payload produced while the old ones still existed.
 *
 * **Reading the list, not just fitting it on screen.** An operator opening
 * this section is asking one question — *is anything here not me?* — and a
 * flat, equal-weight list of ten rows makes them read all ten to answer it.
 * So the row order and the row itself do some of that reading for them: the
 * session they are using right now sits first and is marked, the rest follow
 * most-recently-used first (the order that answers "what have I actually
 * used lately" rather than "what does the database happen to return"), and a
 * row nobody has touched in a long while says so in words, not just by
 * sorting to the bottom where a skim can miss it. None of that changes what
 * revoking or signing out *do* — `revoke` and `signOut` below are untouched.
 */

export type OperatorSessionItem = {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
};

/**
 * A session idle past this many days is flagged. The number is not a guess:
 * `refreshExpiry` (lib/auth/session.ts) renews a session's expiry on a
 * rolling 7-day window every time it is used, capped at 30 days from issue.
 * A session that has gone 7 days without being used has therefore stopped
 * being kept alive by activity and is coasting on the hard cap instead — a
 * mechanical fact about the session, not a guess about the student's habits,
 * and the reason this threshold rather than an arbitrary "looks old" cutoff.
 */
const STALE_AFTER_DAYS = 7;

function daysSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Orders "this device" first (never buried, never mistaken for one of many)
 * and then the rest by most-recently-used. `listSessions` already sorts by
 * `last_used_at DESC`, but it has no way to know which row is "current" is
 * supposed to jump the queue — that is a presentation decision, made here,
 * over data the query already handed us. Nothing is re-fetched or re-ranked
 * by any field the server didn't already return.
 */
function orderForReading(sessions: OperatorSessionItem[]): OperatorSessionItem[] {
  return [...sessions].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
  });
}

/** The sticky header's column labels, styled to match `<Th>` (ui.tsx) without
 * being one — these rows are a `<ul>`, not a `<table>`, and a `<th>` with no
 * enclosing `<table>`/`<tr>` is invalid markup that a screen reader has no
 * good way to announce. Same look, right markup for what it is actually in. */
function ColumnLabel({ children, end = false }: { children: string; end?: boolean }) {
  return (
    <span
      className={`whitespace-nowrap font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-ink-faint ${
        end ? "text-end" : "text-start"
      }`}
    >
      {children}
    </span>
  );
}

export function OperatorSessions({ sessions }: { sessions: OperatorSessionItem[] }) {
  const [busy, setBusy] = useState<number | "all" | null>(null);
  // A fixed "now" for this render, not `Date.now()` re-read per row: every row's
  // staleness has to answer against the same instant or two rows a millisecond
  // apart in `lastUsedAt` could land on opposite sides of the threshold for no
  // reason a reader could see.
  const [now] = useState(() => Date.now());

  const ordered = orderForReading(sessions);

  async function revoke(id: number, current: boolean) {
    if (busy !== null) return;
    setBusy(id);
    try {
      await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" });
    } catch {
      /* 204 or unreachable — the reload below re-reads the truth either way */
    }
    // Revoking the session you are using IS signing out, and pretending
    // otherwise would leave a shell rendering against a session that no longer
    // resolves.
    window.location.assign(current ? "/signin" : "/profile");
  }

  async function signOut() {
    if (busy !== null) return;
    setBusy("all");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* 204 either way */
    }
    window.location.assign("/signin");
  }

  return (
    <div>
      {sessions.length === 0 ? (
        <Empty>No sign-ins are open.</Empty>
      ) : (
        <>
          {/* The count has to sit above the scroll area, not inside it — the
              one question this section answers first is "how many places",
              and an answer that scrolls out of view with row four stops
              answering it. */}
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-faint">
            {sessions.length === 1 ? "1 sign-in" : `${sessions.length} sign-ins`}
          </p>
          <ScrollList
            ariaLabel="Where you are signed in — scroll for more"
            header={
              <div className="flex items-center gap-x-4 px-4 py-2">
                <div className="min-w-[14rem] flex-1">
                  <ColumnLabel>Device</ColumnLabel>
                </div>
                <div className="w-[9rem] shrink-0">
                  <ColumnLabel end>Last used</ColumnLabel>
                </div>
                <div className="w-[5.5rem] shrink-0 text-end">
                  <ColumnLabel end>End it</ColumnLabel>
                </div>
              </div>
            }
          >
            <ul className="divide-y divide-line-soft">
              {ordered.map((s) => {
                const stale = !s.current && daysSince(s.lastUsedAt, now) >= STALE_AFTER_DAYS;
                return (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-[14rem] flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-ink">
                        {s.deviceName ?? "Unnamed device"}
                        {s.current ? <Chip tone="good">this device</Chip> : null}
                        {stale ? <Chip tone="attention">long idle</Chip> : null}
                      </p>
                      {/* Address is a machine fact — kept, but after the human
                          ones, and in the faint mono the rest of the console
                          reserves for exactly that register. */}
                      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {s.ipAddress ?? "address not recorded"} · started {stamp(s.createdAt)}
                      </p>
                    </div>
                    <div className="w-[9rem] shrink-0 text-end">
                      <p className="text-[12px] text-ink-soft">{stamp(s.lastUsedAt)}</p>
                    </div>
                    <div className="w-[5.5rem] shrink-0 text-end">
                      <button
                        type="button"
                        onClick={() => void revoke(s.id, s.current)}
                        disabled={busy !== null}
                        className="ds-control play-pressable rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-line-soft hover:text-ink disabled:opacity-50"
                      >
                        {busy === s.id ? "Revoking…" : s.current ? "Sign out here" : "Revoke"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollList>
        </>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy !== null}
        className="ds-control play-pressable mt-4 rounded-md border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
      >
        {busy === "all" ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

"use client";

import { useState } from "react";

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
 */

export type OperatorSessionItem = {
  id: number;
  deviceName: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  current: boolean;
};

export function OperatorSessions({ sessions }: { sessions: OperatorSessionItem[] }) {
  const [busy, setBusy] = useState<number | "all" | null>(null);

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
        <p className="text-[13px] text-ink-soft">No sign-ins are open.</p>
      ) : (
        <ul className="divide-y divide-line-soft rounded-lg border border-line bg-card">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <div className="min-w-[14rem] flex-1">
                <p className="text-[13px] font-semibold text-ink">
                  {s.deviceName ?? "Unnamed device"}
                  {s.current && (
                    <span className="ms-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                      this one
                    </span>
                  )}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                  {s.ipAddress ?? "address not recorded"} · last used {stamp(s.lastUsedAt)} ·
                  started {stamp(s.createdAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void revoke(s.id, s.current)}
                disabled={busy !== null}
                className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-line-soft hover:text-ink disabled:opacity-50"
              >
                {busy === s.id ? "Revoking…" : s.current ? "Sign out here" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void signOut()}
        disabled={busy !== null}
        className="mt-4 rounded-md border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
      >
        {busy === "all" ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}

function stamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

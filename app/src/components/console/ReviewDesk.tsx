"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ReviewItemView } from "@/components/console/ReviewItemView";
import {
  DECISION_LABEL,
  KIND_LABEL,
  MAX_CORRECTION,
  MAX_NOTE,
  canDecide,
  decisionEffect,
  type BacklogFilters,
  type Decision,
  type ReviewItemPayload,
} from "@/lib/review-gate";

/**
 * The one-by-one reviewer (`/review`; migration 036; Samuel's answer 37).
 *
 * Asks the server for the next item (which CLAIMS it, so nobody else is shown
 * it for ten minutes), shows it, and takes one of three decisions:
 *
 *   A  Approve      — a human signs it (on a question, the stamp every
 *                     existing reader already trusts)
 *   F  Needs fix    — a note (required) and an optional suggested correction;
 *                     nothing changes for students; it goes on the fix list
 *   R  Reject       — a note (required); a question is retired, a claim
 *                     switched off, a stand-in's question held
 *   S  Skip         — not now; the next item, and this one is left for others
 *
 * The decision carries the fingerprint of the content the reviewer saw; if the
 * item changed meanwhile the server refuses and says so, rather than signing
 * content nobody read. The decide response carries the next item, so a
 * reviewer goes from one item to the next in one round trip, and the page's
 * counts refresh behind them.
 *
 * Keyboard first, because a backlog of a thousand items is a keyboard job.
 * Shortcuts are ignored while typing in the note — except ⌘/Ctrl-Enter to
 * send it and Esc to put it away.
 */
type NextBody = {
  item: ReviewItemPayload | null;
  openMatching: number;
  othersReviewing: { operatorName: string; kind: string; ref: string }[];
  decided?: { decisionId: number; changes: Record<string, unknown> };
};

type Problem = { code: string; message: string };

const describeChanges = (c: Record<string, unknown>): string => {
  if (c.recorded_only) return "recorded";
  const parts: string[] = [];
  if (c.status && typeof c.status === "object") {
    const s = c.status as { from?: string; to?: string };
    parts.push(`status ${s.from} → ${s.to}`);
  }
  if (c.reviewed_by && typeof c.reviewed_by === "object") parts.push("signed");
  if (typeof c.still_held === "string") parts.push(`still held: ${c.still_held}`);
  if (typeof c.claim === "string") parts.push(c.claim);
  if (Array.isArray(c.refutations_marked_reviewed)) parts.push(`${c.refutations_marked_reviewed.length} refutation(s) marked reviewed`);
  if (Array.isArray(c.marked_reviewed)) parts.push("marked reviewed");
  if (Array.isArray(c.held_questions)) parts.push(`${c.held_questions.length} question(s) held`);
  return parts.join(" · ") || "recorded";
};

export function ReviewDesk({ filters }: { filters: BacklogFilters }) {
  const router = useRouter();
  const [item, setItem] = useState<ReviewItemPayload | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "empty">("loading");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [mode, setMode] = useState<Exclude<Decision, "approve"> | null>(null);
  const [note, setNote] = useState("");
  const [correction, setCorrection] = useState("");
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState<string[]>([]);
  const [tally, setTally] = useState({ approve: 0, fix_requested: 0, reject: 0, skipped: 0 });
  const [last, setLast] = useState<string | null>(null);
  const [openMatching, setOpenMatching] = useState<number | null>(null);
  const [others, setOthers] = useState<NextBody["othersReviewing"]>([]);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const accept = useCallback((body: NextBody) => {
    setItem(body.item);
    setPhase(body.item ? "ready" : "empty");
    setOpenMatching(body.openMatching);
    setOthers(body.othersReviewing ?? []);
    setMode(null);
    setNote("");
    setCorrection("");
  }, []);

  const post = useCallback(
    async (payload: Record<string, unknown>, skipList: string[]) => {
      const res = await fetch("/api/console/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, filters, skip: skipList }),
      });
      const body = (await res.json().catch(() => ({}))) as NextBody & { error?: string; message?: string };
      if (!res.ok) throw { code: body.error ?? String(res.status), message: body.message ?? `the server said ${res.status}` };
      return body;
    },
    [filters]
  );

  const next = useCallback(
    async (skipList: string[]) => {
      setBusy(true);
      setProblem(null);
      try {
        accept(await post({ action: "next" }, skipList));
      } catch (e) {
        setProblem(e as Problem);
        setPhase("ready");
      } finally {
        setBusy(false);
      }
    },
    [accept, post]
  );

  // The first item, on mount (and again when the filters change: the page
  // remounts the desk under a new key). State is set only once the answer is
  // back — `phase` already starts at "loading".
  useEffect(() => {
    let alive = true;
    post({ action: "next" }, [])
      .then((body) => {
        if (alive) accept(body);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setProblem(e as Problem);
        setPhase("ready");
      });
    return () => {
      alive = false;
    };
  }, [post, accept]);

  const decide = useCallback(
    async (decision: Decision) => {
      if (!item || busy) return;
      if (decision !== "approve" && !note.trim()) {
        setProblem({ code: "note_required", message: "Say what is wrong — the note is what the fix is made from." });
        noteRef.current?.focus();
        return;
      }
      setBusy(true);
      setProblem(null);
      const decided = item;
      try {
        const body = await post(
          {
            action: "decide",
            kind: decided.kind,
            ref: decided.ref,
            fingerprint: decided.fingerprint,
            decision,
            note: decision === "approve" ? (note.trim() || null) : note.trim(),
            suggestedCorrection: decision === "fix_requested" ? correction.trim() || null : null,
          },
          skip
        );
        setTally((t) => ({ ...t, [decision]: t[decision] + 1 }));
        setLast(
          `${DECISION_LABEL[decision]}: ${KIND_LABEL[decided.kind]} ${decided.ref} — ${describeChanges(body.decided?.changes ?? {})}`
        );
        accept(body);
        router.refresh();
      } catch (e) {
        setProblem(e as Problem);
      } finally {
        setBusy(false);
      }
    },
    [item, busy, note, correction, post, skip, accept, router]
  );

  const skipThis = useCallback(() => {
    if (!item || busy) return;
    const list = [...skip, `${item.kind}|${item.ref}`];
    setSkip(list);
    setTally((t) => ({ ...t, skipped: t.skipped + 1 }));
    setLast(`Skipped ${KIND_LABEL[item.kind]} ${item.ref}`);
    void next(list);
  }, [item, busy, skip, next]);

  const open = useCallback(
    (m: Exclude<Decision, "approve">) => {
      if (!item) return;
      setMode(m);
      setProblem(null);
      if (m === "fix_requested" && item.kind === "figure_stand_in" && !note) {
        setNote(`Needs a native figure${typeof item.figure?.spec.native_kind_needed === "string" ? ` (${item.figure.spec.native_kind_needed})` : ""}: `);
      }
      requestAnimationFrame(() => noteRef.current?.focus());
    },
    [item, note]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
      if (typing) {
        if (e.key === "Escape") {
          setMode(null);
          (e.target as HTMLElement).blur();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && mode) {
          e.preventDefault();
          void decide(mode);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || busy || !item) return;
      const k = e.key.toLowerCase();
      if (k === "a" && canDecide(item.kind, "approve").ok) {
        e.preventDefault();
        void decide("approve");
      } else if (k === "f" && !item.readOnly) {
        e.preventDefault();
        open("fix_requested");
      } else if (k === "r" && !item.readOnly) {
        e.preventDefault();
        open("reject");
      } else if (k === "s") {
        e.preventDefault();
        skipThis();
      } else if (e.key === "Escape") {
        setMode(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, busy, mode, decide, open, skipThis]);

  const readOnly = item?.readOnly === true;
  const approvable = !item
    ? { ok: false as const, why: "" }
    : readOnly
      ? { ok: false as const, why: "A gate decision is Samuel's to sign (answer 39). You can read it." }
      : canDecide(item.kind, "approve");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-soft">
        <span>
          This sitting: {tally.approve} approved · {tally.fix_requested} fix requested · {tally.reject} rejected ·{" "}
          {tally.skipped} skipped
        </span>
        {openMatching != null ? <span>{openMatching} open in this queue</span> : null}
        {item?.claimExpiresAt ? (
          <span>Held for you until {item.claimExpiresAt.slice(11, 16)} UTC</span>
        ) : null}
        {others.length > 0 ? (
          <span>
            Also reviewing: {[...new Set(others.map((o) => o.operatorName))].join(", ")}
          </span>
        ) : null}
      </div>
      {last ? (
        <p className="mb-3 rounded-md bg-paper-deep px-3 py-1.5 text-[12.5px] text-ink" role="status">
          {last}
        </p>
      ) : null}
      {problem ? (
        <div className="mb-3 rounded-md border border-gold/50 bg-gold-wash px-3 py-2 text-[13px] text-ink" role="alert">
          <span className="font-semibold">Not saved.</span> {problem.message}{" "}
          {problem.code === "changed" ||
          problem.code === "claimed_by_other" ||
          problem.code === "gone" ||
          problem.code === "owner_only" ? (
            <button type="button" className="ds-control-quiet underline" onClick={() => void next(skip)} disabled={busy}>
              {problem.code === "changed" ? "Open it again" : "Next item"}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === "loading" ? (
        <p className="text-[13px] text-ink-soft">Finding the next item…</p>
      ) : phase === "empty" ? (
        <div className="rounded-md bg-paper-deep px-4 py-6 text-center">
          <p className="font-display text-[18px] font-bold text-ink">Nothing open here</p>
          <p className="mt-1 text-[13px] text-ink-soft">
            {skip.length > 0
              ? "Every other open item in this queue is skipped or open with another reviewer."
              : "Every item in this queue is reviewed, waiting on a fix, or open with another reviewer."}
          </p>
          {skip.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSkip([]);
                void next([]);
              }}
              className="ds-control play-pressable mt-3 rounded border border-line bg-card px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft"
            >
              Show the skipped ones again
            </button>
          ) : null}
        </div>
      ) : item ? (
        <>
          <ReviewItemView item={item} />

          <div className="sticky bottom-0 z-10 mt-5 border-t border-line bg-card pb-3 pt-3">
            {mode ? (
              <div className="grid gap-2">
                <label className="text-[12.5px] text-ink-soft">
                  <span className="block font-semibold text-ink">
                    {mode === "fix_requested" ? "What needs fixing" : "Why reject it"} (required)
                  </span>
                  <textarea
                    ref={noteRef}
                    value={note}
                    maxLength={MAX_NOTE}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    disabled={busy}
                    className="ds-field mt-1 w-full rounded border border-line bg-card px-2 py-1.5 text-[13px] text-ink"
                  />
                </label>
                {mode === "fix_requested" ? (
                  <label className="text-[12.5px] text-ink-soft">
                    <span className="block font-semibold text-ink">Suggested correction (optional)</span>
                    <textarea
                      value={correction}
                      maxLength={MAX_CORRECTION}
                      onChange={(e) => setCorrection(e.target.value)}
                      rows={3}
                      disabled={busy}
                      placeholder="The corrected stem, answer key or step — LaTeX in $…$ as the book writes it"
                      className="ds-field mt-1 w-full rounded border border-line bg-card px-2 py-1.5 font-mono text-[12.5px] text-ink"
                    />
                  </label>
                ) : null}
                <p className="text-[12px] text-ink-soft">{decisionEffect(item.kind, mode)}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(mode)}
                    disabled={busy}
                    className="ds-control play-pressable rounded border border-line bg-ink px-3 py-1.5 text-[13px] font-semibold text-paper disabled:opacity-50"
                  >
                    {busy ? "Saving…" : mode === "fix_requested" ? "Request the fix (⌘↵)" : "Reject (⌘↵)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(null)}
                    disabled={busy}
                    className="ds-control-quiet rounded px-3 py-1.5 text-[13px] text-ink-soft hover:bg-line-soft"
                  >
                    Back (Esc)
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void decide("approve")}
                  disabled={busy || !approvable.ok}
                  title={approvable.ok ? decisionEffect(item.kind, "approve") : approvable.why}
                  className="ds-control play-pressable rounded border border-line bg-progress/15 px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
                >
                  Approve <kbd className="ms-1 font-mono text-[11px] text-ink-soft">A</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => open("fix_requested")}
                  disabled={busy || readOnly}
                  title={decisionEffect(item.kind, "fix_requested")}
                  className="ds-control play-pressable rounded border border-gold/50 bg-gold-wash px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
                >
                  {item.kind === "figure_stand_in" ? "Needs native figure" : "Needs fix"}{" "}
                  <kbd className="ms-1 font-mono text-[11px] text-ink-soft">F</kbd>
                </button>
                <button
                  type="button"
                  onClick={() => open("reject")}
                  disabled={busy || readOnly}
                  title={decisionEffect(item.kind, "reject")}
                  className="ds-control play-pressable rounded border border-line bg-card px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-line-soft disabled:opacity-50"
                >
                  Reject <kbd className="ms-1 font-mono text-[11px] text-ink-soft">R</kbd>
                </button>
                <button
                  type="button"
                  onClick={skipThis}
                  disabled={busy}
                  className="ds-control-quiet rounded px-3 py-1.5 text-[13px] text-ink-soft hover:bg-line-soft disabled:opacity-50"
                >
                  Skip <kbd className="ms-1 font-mono text-[11px]">S</kbd>
                </button>
                <span className="text-[12px] text-ink-soft">
                  {approvable.ok ? decisionEffect(item.kind, "approve") : approvable.why}
                </span>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

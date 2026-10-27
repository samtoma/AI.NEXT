"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { authFetch } from "@/lib/auth/client-session";
import type { HomeworkAsk, HomeworkItem } from "@/lib/homework";
import {
  GAP,
  afterDone,
  gapsComplete,
  pickerLine,
  type HomeworkMode,
} from "@/lib/homework-rules";
import { QUESTION_DONE, repairMarkers } from "@/lib/chat-parse";
import { ChatCore, type ChatCoreHandle, type ChatSuggestion } from "@/components/chat/ChatCore";
import { TutorBubble } from "@/components/chat/message-blocks";
import { NoorMark } from "@/components/NoorMark";
import { TeX } from "@/components/TeX";
import {
  BUTTON_SECONDARY,
  HEADING,
  HONEY_BAND,
  STROKE,
  STROKE_SM,
  STROKE_WIDTH,
  cx,
} from "@/components/sticker";

/**
 * "Your question" — one homework ask (spec 004; design handoff `home_ask`
 * screens 2 and 2b). One centred column, top to bottom: what Noor read, how
 * to work, then the chat underneath. No second pane.
 *
 * Several questions (FR-3608, not drawn in the handoff): Noor says how many it
 * found and asks which one to start with; each is a row. Picking one shows its
 * read-back and the two choices. One question is worked at a time; finishing
 * it (`{{question_done}}`, FR-3611) offers the next one or the way home.
 *
 * What persists is the ask, its questions, their text, gaps, mode and done
 * state. The chat transcript does not survive a reload this round (spec 004,
 * out of scope) — reopening a question starts its conversation afresh.
 */

const POLL_MS = 2000;

export function HomeworkSession({ initial }: { initial: HomeworkAsk }) {
  const [ask, setAsk] = useState<HomeworkAsk>(initial);
  const maths = ask.items.filter((i) => i.subject === "maths");
  const [selectedId, setSelectedId] = useState<number | null>(() => pickInitial(initial));
  const [justDone, setJustDone] = useState<number | null>(null);

  // Reading: poll until the split lands (or fails).
  useEffect(() => {
    if (ask.status !== "reading") return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const r = await authFetch(`/api/homework/${ask.id}`);
        if (!r.ok || !alive) return;
        const next = (await r.json()) as HomeworkAsk;
        setAsk(next);
        if (next.status === "ready") setSelectedId((s) => s ?? pickInitial(next));
      } catch {
        /* the next tick retries */
      }
    }, POLL_MS);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [ask]);

  const patch = useCallback(
    async (itemId: number, body: Record<string, unknown>): Promise<boolean> => {
      const r = await authFetch(`/api/homework/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return false;
      setAsk((await r.json()) as HomeworkAsk);
      return true;
    },
    []
  );

  // The Stop while Noor is reading the ask: the server kills the model work
  // (recorded `stopped`, never a failure) and answers with the stopped ask.
  // Shown as stopped at once — waiting on the round trip would make Stop feel
  // like it did nothing — and the poll above ends with the status change.
  const [stopping, setStopping] = useState(false);
  const stopReading = useCallback(async () => {
    setStopping(true);
    setAsk((a) => (a.status === "reading" ? { ...a, status: "stopped" } : a));
    try {
      const r = await authFetch(`/api/homework/${ask.id}`, { method: "DELETE" });
      // a Stop that lost the race to a finished reading: show what was read
      if (r.ok) {
        const next = (await r.json()) as HomeworkAsk;
        setAsk(next);
        if (next.status === "ready") setSelectedId((s) => s ?? pickInitial(next));
      }
    } catch {
      /* offline: the reading stops being polled for either way */
    } finally {
      setStopping(false);
    }
  }, [ask.id]);

  const selected = ask.items.find((i) => i.id === selectedId) ?? null;
  const several = ask.items.length > 1;

  return (
    <div className="flex min-h-full flex-col bg-paper">
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-[18px] px-4 pb-10 pt-4 min-[900px]:px-6">
        <Link
          href="/student"
          prefetch={false}
          className="inline-flex min-h-11 items-center self-start font-display text-[1rem] font-bold text-[color:var(--play-text-link)]"
        >
          ← Home
        </Link>
        <h1 className={cx(HEADING, "text-[2rem]")}>{several ? "Your questions" : "Your question"}</h1>

        {ask.status === "reading" && (
          <Reading upload={ask.source === "upload"} onStop={stopReading} stopping={stopping} />
        )}
        {ask.status === "stopped" && (
          <Notice>Stopped. Whenever you&apos;re ready, ask again from Home.</Notice>
        )}
        {ask.status === "unreadable" && (
          <Notice>
            I couldn&apos;t find a question I can read in that. Could you type it out, or take the
            photo again in better light?
          </Notice>
        )}
        {ask.status === "failed" && (
          <Notice>Something went wrong reading that. Want to try sending it again?</Notice>
        )}

        {ask.status === "ready" && several && (
          <QuestionPicker
            items={ask.items}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              setJustDone(null);
            }}
            mathsCount={maths.length}
          />
        )}

        {ask.status === "ready" && selected && (
          <QuestionWork
            key={selected.id}
            item={selected}
            fromUpload={ask.source === "upload"}
            patch={patch}
            justDone={justDone === selected.id}
            onDone={async () => {
              await patch(selected.id, { action: "done" });
              setJustDone(selected.id);
            }}
            onNext={
              afterDone(ask.items, selected.id).another
                ? () => {
                    const next = ask.items.find(
                      (i) => i.id !== selected.id && i.status !== "done" && i.subject === "maths"
                    );
                    if (next) {
                      setSelectedId(next.id);
                      setJustDone(null);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }
                  }
                : null
            }
          />
        )}
      </main>
    </div>
  );
}

/** The question to open on: the one being worked, else the only one. */
function pickInitial(ask: HomeworkAsk): number | null {
  const active = ask.items.find((i) => i.status === "active");
  if (active) return active.id;
  return ask.items.length === 1 ? ask.items[0].id : null;
}

/* ------------------------------------------------------------------ */

function Reading({
  upload,
  onStop,
  stopping,
}: {
  upload: boolean;
  /** The Stop: Noor is working in the background, so she can be stopped. */
  onStop: () => void;
  stopping: boolean;
}) {
  return (
    <div className={cx(STROKE, "flex flex-wrap items-center gap-3.5 rounded-[var(--play-radius-lg)] bg-card p-[22px]")}>
      <span className={cx(STROKE, "anim-bob flex size-11 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card-warm")}>
        <NoorMark className="size-7" />
      </span>
      <p role="status" className="min-w-0 flex-1 font-display text-[1.05rem] font-bold text-ink">
        {upload ? "Reading your file…" : "Reading your question…"}
      </p>
      {/* logical margins only: the button sits at the trailing edge in
          either direction, and its square needs no mirroring */}
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        aria-label={upload ? "Stop reading your file" : "Stop reading your question"}
        data-homework-stop=""
        className={cx(BUTTON_SECONDARY, "ms-auto gap-2 px-5")}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect width="10" height="10" fill="currentColor" />
        </svg>
        Stop
      </button>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className={cx(STROKE, "flex flex-col gap-3 rounded-[var(--play-radius-lg)] bg-card p-[22px]")}>
      <p className="font-read text-[1rem] leading-[1.7] text-ink">{children}</p>
      <Link
        href="/student"
        prefetch={false}
        className="min-h-11 self-start font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
      >
        Back to Home
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QuestionPicker({
  items,
  selectedId,
  onSelect,
  mathsCount,
}: {
  items: HomeworkItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  mathsCount: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5">
        <NoorMark aria-hidden className="mt-0.5 size-[34px] shrink-0" />
        <TutorBubble lesson>
          <p>{pickerLine(items.length)}</p>
          {mathsCount < items.length && (
            <p className="mt-2 text-ink-soft">I only cover Maths so far, so I can&apos;t help with the ones marked “Not Maths”.</p>
          )}
        </TutorBubble>
      </div>
      <ul className="flex flex-col gap-2.5" aria-label="Questions in your homework">
        {items.map((i, k) => {
          const on = i.id === selectedId;
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onSelect(i.id)}
                aria-current={on ? "true" : undefined}
                className={cx(
                  STROKE,
                  "play-pressable sticker-shadow-sm flex min-h-14 w-full items-center gap-3 rounded-[var(--play-radius)] px-4 py-2.5 text-start",
                  on ? "bg-card-warm" : "bg-card"
                )}
              >
                <span className="shrink-0 font-display text-[1rem] font-extrabold text-ink">
                  {displayLabel(i.label) ?? `Question ${k + 1}`}
                </span>
                {/* The same rendering as "What I read": maths through KaTeX and
                    a filled gap as the student's answer — never the raw $…$. */}
                <span className="min-w-0 flex-1 truncate font-read text-[0.95rem] text-ink-soft">
                  <QuestionText text={i.text} gaps={i.gaps} />
                </span>
                <span className="shrink-0 font-display text-[0.85rem] font-bold text-[color:var(--play-text-muted)]">
                  {i.subject === "other"
                    ? "Not Maths"
                    : i.status === "done"
                      ? "Done ✓"
                      : i.status === "active"
                        ? "Working on it"
                        : "→"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function QuestionWork({
  item,
  fromUpload,
  patch,
  justDone,
  onDone,
  onNext,
}: {
  item: HomeworkItem;
  fromUpload: boolean;
  patch: (itemId: number, body: Record<string, unknown>) => Promise<boolean>;
  justDone: boolean;
  onDone: () => Promise<void>;
  onNext: (() => void) | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [answers, setAnswers] = useState<string[]>(() => item.gaps.map((g) => g.answer ?? ""));
  // Which mode the chat on screen was started in, and a generation so a
  // fresh chat starts when the student restarts or edits the question.
  const [chat, setChat] = useState<{ mode: HomeworkMode; gen: number } | null>(null);
  /** the open teacher note, carrying Noor's working as it stood when opened */
  const [note, setNote] = useState<string | null>(null);
  const lastTutor = useRef("");
  const core = useRef<ChatCoreHandle | null>(null);
  const panel = useRef<HTMLElement | null>(null);

  // A started chat scrolls into view: on a phone the panel opens below the
  // fold, and the student just pressed a button that says "start".
  useEffect(() => {
    if (chat) panel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [chat]);

  const gapsDone = gapsComplete(item.gaps);
  const maths = item.subject === "maths";
  const canStart = maths && gapsDone && !editing;

  const start = async (mode: HomeworkMode) => {
    if (!canStart) return;
    if (await patch(item.id, { action: "select", mode })) {
      setChat((c) => ({ mode, gen: (c?.gen ?? 0) + 1 }));
    }
  };

  const flag = () => {
    void authFetch(`/api/homework/items/${item.id}/flag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tutorMessage: lastTutor.current || "(no message)" }),
    });
    core.current?.send("That doesn't look right.");
  };

  const links: ChatSuggestion[] = [
    { label: "That doesn't look right", onSelect: flag },
    { label: "Ask your teacher", onSelect: () => setNote(lastTutor.current) },
  ];

  return (
    <div className="flex flex-col gap-[18px]">
      {/* What I read (FR-3607) */}
      <section className={cx(STROKE, "flex flex-col gap-3 rounded-[var(--play-radius-lg)] bg-card p-[22px]")} aria-label="What I read">
        <p className="font-display text-[0.95rem] font-bold text-ink-soft">
          What I read{item.label ? ` · ${displayLabel(item.label)}` : ""}
        </p>

        {editing ? (
          <div className="flex flex-col gap-2.5">
            <label htmlFor={`edit-${item.id}`} className="sr-only">
              Edit the question
            </label>
            <textarea
              id={`edit-${item.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
              maxLength={2000}
              className={cx(STROKE_SM, "w-full rounded-[var(--play-radius-sm)] bg-card px-4 py-3 font-read text-[1rem] leading-[1.6] text-ink")}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={async () => {
                  if (await patch(item.id, { action: "text", text: draft })) {
                    setEditing(false);
                    setChat(null);
                  }
                }}
                className={cx(STROKE, "play-pressable sticker-shadow-sm min-h-11 rounded-[var(--play-radius)] bg-card px-4 font-display text-[0.95rem] font-bold text-ink")}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(item.text);
                  setEditing(false);
                }}
                className="min-h-11 font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-[var(--play-radius-sm)] bg-card-warm px-[17px] py-[15px] font-read text-[1.05rem] leading-[1.65] text-ink">
              <QuestionText text={item.text} gaps={item.gaps} />
            </div>
            <button
              type="button"
              onClick={() => {
                setDraft(item.text);
                setEditing(true);
              }}
              className="min-h-11 self-start font-display text-[0.9rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
            >
              Edit the text
            </button>
          </>
        )}

        {/* The unreadable parts, asked for one by one (FR-3606) */}
        {item.gaps.length > 0 && !gapsDone && !editing && (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={async (e) => {
              e.preventDefault();
              await patch(item.id, { action: "gaps", answers });
            }}
          >
            <p className="font-read text-[0.95rem] leading-[1.6] text-ink">
              I couldn&apos;t read {item.gaps.length === 1 ? "one part" : "some parts"} of this, marked{" "}
              <span aria-label="unreadable">{GAP}</span>. I won&apos;t guess — can you tell me?
            </p>
            {item.gaps.map((g, k) => (
              <label key={k} className="flex flex-wrap items-center gap-2.5">
                <span className="font-display text-[0.95rem] font-bold text-ink">{g.ask}</span>
                <input
                  value={answers[k] ?? ""}
                  onChange={(e) => setAnswers((a) => a.map((v, j) => (j === k ? e.target.value : v)))}
                  maxLength={80}
                  className={cx(STROKE_SM, "h-11 w-32 rounded-[var(--play-radius-sm)] bg-card px-3 font-read text-[1rem] text-ink")}
                />
              </label>
            ))}
            <button
              type="submit"
              disabled={answers.some((a) => !a.trim())}
              className={cx(
                STROKE,
                "min-h-11 self-start rounded-[var(--play-radius)] px-4 font-display text-[0.95rem] font-bold",
                answers.some((a) => !a.trim())
                  ? "border-[color:var(--play-disabled-border)] bg-card text-[color:var(--play-disabled-text)]"
                  : "play-pressable sticker-shadow-sm bg-card text-ink"
              )}
            >
              Use these
            </button>
          </form>
        )}

        {maths ? (
          <>
            <p className="font-display text-[0.95rem] font-bold text-ink">
              {item.objective ? (
                <>
                  {item.objective.label}
                  <span className="font-bold text-ink-soft"> · {sentenceCase(item.objective.mastery)}</span>
                </>
              ) : (
                "Matched to your Maths units"
              )}
            </p>
            <p className="font-read text-[0.95rem] leading-[1.6] text-ink-soft">
              Noor worked this out itself, so double-check the answer.
            </p>
          </>
        ) : (
          <p className="font-read text-[1rem] leading-[1.6] text-ink">
            This one isn&apos;t Maths. I only cover Maths so far, so I can&apos;t walk you through it.
          </p>
        )}
      </section>

      {/* Two modes, one decision (FR-3609). Amber only before a chat starts:
          once it does, the composer's Send is the one amber control. */}
      {maths && (
        <div className="flex flex-col gap-3">
          <ChoiceRow
            label="Walk me through it"
            hint="step by step →"
            primary={!chat}
            chosen={chat?.mode === "walk"}
            disabled={!canStart}
            onClick={() => start("walk")}
          />
          <ChoiceRow
            label="Check my work"
            hint="I'll show you my try →"
            primary={false}
            chosen={chat?.mode === "check"}
            disabled={!canStart}
            onClick={() => start("check")}
          />
          {!gapsDone && (
            <p className="font-read text-[0.9rem] text-ink-soft">Fill in the missing part above to start.</p>
          )}
        </div>
      )}

      {fromUpload && (
        <p className="font-read text-[0.9rem] text-ink-soft">Only the question is kept from your file.</p>
      )}

      {chat && (
        <>
          {/* The lesson chat's panel, as on Walk me through it (lesson chat
              handoff): the panel is the stage — 3px outline, no shadow, a honey
              header with Noor — and the shadow layer is the bubbles, input and
              Send inside it (`.lesson-chat` in globals.css). A fixed height so
              the conversation scrolls inside the panel, like the lesson's. */}
          <section
            ref={panel}
            aria-label="Ask Noor"
            className={cx(
              STROKE,
              "lesson-chat flex h-[min(80dvh,760px)] min-h-[480px] scroll-mt-4 flex-col overflow-hidden rounded-[var(--play-radius)] bg-card text-ink"
            )}
          >
            <div className={cx(HONEY_BAND, "flex items-center gap-3 px-5 py-3.5")}>
              <span
                aria-hidden
                className={cx(
                  STROKE,
                  "anim-bob flex size-11 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card"
                )}
              >
                <NoorMark className="size-7" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="font-display text-[1.3rem] font-extrabold leading-[1.1] text-ink">Ask Noor</span>
                <span className="truncate font-display text-[0.85rem] font-semibold leading-[1.2] text-[color:var(--play-text-dim)]">
                  {[displayLabel(item.label), item.objective?.label].filter(Boolean).join(" · ") ||
                    (chat.mode === "walk" ? "Walk me through it" : "Check my work")}
                </span>
              </span>
            </div>

            <ChatCore
              key={`${item.id}:${chat.mode}:${chat.gen}`}
              surface="homework"
              homeworkItemId={item.id}
              autoStart={chat.mode === "walk" ? "Walk me through it, step by step." : "Check my work — I'll show you my try."}
              placeholder={chat.mode === "walk" ? "Answer or ask anything…" : "Type your working, or attach a photo…"}
              debug={false}
              lessonChrome
              questionCards={false}
              mathKeys={{ context: [item.text] }}
              suggestions={links}
              handleRef={core}
              onAssistantDone={(text) => {
                lastTutor.current = text;
                if (repairMarkers(text).includes(QUESTION_DONE)) void onDone();
              }}
            />
          </section>

          {note != null && <TeacherNote item={item} working={note} onClose={() => setNote(null)} />}

          {(justDone || item.status === "done") && (
            <div className={cx(STROKE, "flex flex-col gap-3 rounded-[var(--play-radius-lg)] bg-card p-[22px]")}>
              <p className="font-display text-[1.15rem] font-extrabold text-ink">
                Nice work{item.label ? ` on ${displayLabel(item.label)}` : ""}. What next?
              </p>
              <div className="flex flex-wrap gap-3">
                {onNext && (
                  <button
                    type="button"
                    onClick={onNext}
                    className={cx(STROKE, "play-pressable sticker-shadow-sm min-h-[52px] rounded-[var(--play-radius)] bg-card px-5 font-display text-[1.05rem] font-bold text-ink")}
                  >
                    Pick another question
                  </button>
                )}
                <Link
                  href="/student"
                  prefetch={false}
                  className={cx(STROKE, "play-pressable sticker-shadow-sm inline-flex min-h-[52px] items-center rounded-[var(--play-radius)] bg-card px-5 font-display text-[1.05rem] font-bold text-ink")}
                >
                  I&apos;m done for now
                </Link>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The question text, maths rendered. Each unreadable span shows as ▒▒ until
 * the student fills it, then as their answer — marked, so it stays visible
 * which part came from them rather than from the file.
 */
function QuestionText({ text, gaps }: { text: string; gaps: HomeworkItem["gaps"] }) {
  const parts = text.split(GAP);
  return (
    <>
      {parts.map((p, k) => (
        <span key={k}>
          <TeX text={p} />
          {k < parts.length - 1 &&
            (gaps[k]?.answer ? (
              <span
                title="You filled this in"
                className="mx-0.5 rounded-[var(--play-radius-sm)] bg-card px-1 font-bold text-ink underline decoration-dotted underline-offset-4"
              >
                {gaps[k].answer}
              </span>
            ) : (
              <span
                aria-label="unreadable"
                className="mx-0.5 rounded-[var(--play-radius-sm)] bg-card px-1 font-bold text-ink"
              >
                {GAP}
              </span>
            ))}
        </span>
      ))}
    </>
  );
}

function ChoiceRow({
  label,
  hint,
  primary,
  chosen,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  primary: boolean;
  chosen: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={chosen}
      className={cx(
        STROKE_WIDTH,
        "flex items-center gap-3 rounded-[var(--play-radius)] px-5 text-start",
        primary ? "min-h-[62px]" : "min-h-[58px]",
        disabled
          ? "border-[color:var(--play-disabled-border)] bg-card text-[color:var(--play-disabled-text)]"
          : cx(
              "play-pressable sticker-shadow-sm border-ink",
              primary ? "bg-[var(--noor-action)] text-[color:var(--noor-on-action)]" : "bg-card text-ink"
            )
      )}
    >
      <span className="flex-1 font-display text-[1.15rem] font-extrabold leading-[1.3]">
        {chosen && <span aria-hidden>✓ </span>}
        {label}
      </span>
      <span className="whitespace-nowrap font-display text-[0.9rem] font-bold">{hint}</span>
    </button>
  );
}

/**
 * "Ask your teacher" (FR-3612): a pre-filled note. Nothing sends it this round
 * — there is no teacher on record yet — so Send is disabled and says so.
 */
function TeacherNote({
  item,
  working,
  onClose,
}: {
  item: HomeworkItem;
  working: string;
  onClose: () => void;
}) {
  const [unsure, setUnsure] = useState("");
  const brief = working
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return (
    <div className={cx(STROKE, "flex flex-col gap-3 rounded-[var(--play-radius-lg)] bg-card p-[22px]")} role="dialog" aria-label="Send a note to your teacher">
      <p className="font-display text-[1.1rem] font-extrabold text-ink">Send a note to your teacher</p>
      <div className="flex flex-col gap-1.5 rounded-[var(--play-radius-sm)] bg-card-warm px-[17px] py-[15px] font-read text-[0.95rem] leading-[1.6] text-ink">
        <p>
          <strong>Question:</strong> {item.label ? `${item.label}, ` : ""}
          {item.text.replace(/\$/g, "").slice(0, 160)}
        </p>
        {brief && (
          <p>
            <strong>Noor&apos;s working:</strong> {brief.replace(/\$/g, "")}
          </p>
        )}
        <label className="flex flex-wrap items-center gap-2">
          <strong>Not sure about:</strong>
          <input
            value={unsure}
            onChange={(e) => setUnsure(e.target.value)}
            maxLength={200}
            className={cx(STROKE_SM, "h-10 min-w-0 flex-1 rounded-[var(--play-radius-sm)] bg-card px-3 text-ink")}
          />
        </label>
      </div>
      <p className="font-read text-[0.9rem] text-ink-soft">Teacher notes are coming soon — this one can&apos;t be sent yet.</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled
          className={cx(STROKE, "min-h-[52px] rounded-[var(--play-radius)] border-[color:var(--play-disabled-border)] bg-card px-5 font-display text-[1.05rem] font-bold text-[color:var(--play-disabled-text)]")}
        >
          Send
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** A bare number as written ("1", "3)") reads as a question number: "Q1". */
const displayLabel = (label: string | null) =>
  label == null ? null : /^\d+[).]?$/.test(label) ? `Q${label.replace(/[).]$/, "")}` : label;

const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

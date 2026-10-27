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
import { GUIDED_CHAT_PANEL, GuidedChatHeader } from "@/components/chat/GuidedChatHeader";
import { TutorBubble } from "@/components/chat/message-blocks";
import { NoorMark } from "@/components/NoorMark";
import { TeX } from "@/components/TeX";
import {
  BUTTON_PRIMARY,
  BUTTON_SECONDARY,
  HEADING,
  STROKE,
  STROKE_WIDTH,
  STROKE_WIDTH_SM,
  cx,
} from "@/components/sticker";

/**
 * "Your question" — one homework ask (spec 004; design handoff `home_ask`
 * screens 2 and 2b, re-laid-out by design_handoff_guided_pages §5). Before a
 * chat starts: one centred column — what Noor read, then how to work. Once a
 * mode is chosen the chat is the page: "What I read" and the mode collapse
 * into a pinned side card (1280px and up) or a one-line strip above a
 * full-width chat, so the conversation never sits in a box under a long page.
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
  // a chat is running: the page becomes the side card (or strip) and the chat
  const [chatting, setChatting] = useState(false);

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
  const choose = (id: number) => {
    setSelectedId(id);
    setJustDone(null);
  };

  return (
    <div className={cx("guided-page flex flex-col bg-paper", chatting ? "h-dvh" : "min-h-full")}>
      <main
        className={
          chatting
            ? "mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col px-3 sm:px-6 sm:pb-6 min-[1280px]:px-7"
            : "mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-[18px] px-3 pb-10 sm:px-6"
        }
      >
        <div className={cx("flex shrink-0 items-center", chatting ? "pb-2 pt-2 sm:pb-3 sm:pt-3" : "pt-3 sm:pt-4")}>
          <Link
            href="/student"
            prefetch={false}
            className="inline-flex min-h-11 items-center font-display text-[0.95rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
          >
            ← Home
          </Link>
        </div>
        {!chatting && (
          <h1 className={cx(HEADING, "text-[1.4rem] leading-[1.1] sm:text-[2.2rem]")}>
            {several ? "Your questions" : "Your question"}
          </h1>
        )}

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

        {ask.status === "ready" && several && !chatting && (
          <QuestionPicker items={ask.items} selectedId={selectedId} onSelect={choose} mathsCount={maths.length} />
        )}

        {ask.status === "ready" && selected && (
          <QuestionWork
            key={selected.id}
            item={selected}
            fromUpload={ask.source === "upload"}
            patch={patch}
            justDone={justDone === selected.id}
            onChatting={setChatting}
            others={several ? ask.items.filter((i) => i.id !== selected.id) : []}
            onSelectOther={choose}
            onPickAnother={several ? () => window.scrollTo({ top: 0, behavior: "smooth" }) : null}
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
                      choose(next.id);
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

/** Nour's 56px badge beside a status line, bobbing at rest (the one loop). */
function StatusAvatar() {
  return (
    <span
      aria-hidden
      className={cx(STROKE, "anim-bob flex size-14 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card")}
    >
      <NoorMark className="size-9" />
    </span>
  );
}

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
    <>
      <div className="flex items-center gap-3.5 py-1.5">
        <StatusAvatar />
        <p role="status" className="min-w-0 flex-1 font-read text-[1.15rem] font-semibold leading-[1.6] text-ink">
          {upload ? "Reading your file…" : "Reading your question…"}
        </p>
      </div>
      {/* logical margins only: the square needs no mirroring */}
      <button
        type="button"
        onClick={onStop}
        disabled={stopping}
        aria-label={upload ? "Stop reading your file" : "Stop reading your question"}
        data-homework-stop=""
        className={cx(BUTTON_SECONDARY, "gap-2 self-start px-6")}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect width="10" height="10" fill="currentColor" />
        </svg>
        Stop
      </button>
    </>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-3.5 py-1.5">
        <StatusAvatar />
        <p className="min-w-0 flex-1 font-read text-[1.15rem] font-semibold leading-[1.6] text-ink">{children}</p>
      </div>
      {/* the screen's one amber */}
      <Link href="/student" prefetch={false} className={cx(BUTTON_PRIMARY, "self-start px-6 text-[1.05rem]")}>
        Back to Home
      </Link>
    </>
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
            <p className="mt-2">I only cover Maths so far, so I can&apos;t help with the ones marked “Not Maths”.</p>
          )}
        </TutorBubble>
      </div>
      <QuestionRows items={items} selectedId={selectedId} onSelect={onSelect} />
    </div>
  );
}

/** One 60px row per question: the selected one Honey with the ink outline, the rest a quiet
 *  outline, Not Maths dimmed (guided pages handoff §5). */
function QuestionRows({
  items,
  selectedId,
  onSelect,
  compact = false,
}: {
  items: HomeworkItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  /** in the side card: the shorter row */
  compact?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-2.5" aria-label="Questions in your homework">
      {items.map((i, k) => {
        const on = i.id === selectedId;
        return (
          <li key={i.id} className={i.subject === "other" ? "opacity-60" : undefined}>
            <button
              type="button"
              onClick={() => onSelect(i.id)}
              aria-current={on ? "true" : undefined}
              className={cx(
                STROKE_WIDTH_SM,
                "play-pressable flex w-full items-center gap-4 rounded-[var(--play-radius-sm)] text-start",
                compact ? "min-h-[var(--noor-touch-min)] px-3.5" : "min-h-[60px] px-[18px]",
                on ? "border-ink bg-card-warm" : "border-[color:var(--play-disabled-border)] bg-transparent"
              )}
            >
              <span className="min-w-[34px] shrink-0 font-display text-[1rem] font-extrabold text-ink">
                {displayLabel(i.label) ?? `Question ${k + 1}`}
              </span>
              {/* The same rendering as "What I read": maths through KaTeX and
                  a filled gap as the student's answer — never the raw $…$. */}
              <span className="min-w-0 flex-1 truncate whitespace-nowrap font-read text-[1.05rem] text-ink">
                <QuestionText text={i.text} gaps={i.gaps} />
              </span>
              <span className="shrink-0 whitespace-nowrap font-display text-[0.92rem] font-bold text-[color:var(--play-text-dim)]">
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
  );
}

/* ------------------------------------------------------------------ */

const MODE_NAME: Record<HomeworkMode, string> = {
  walk: "Walk me through it",
  check: "Check my work",
};

function QuestionWork({
  item,
  fromUpload,
  patch,
  justDone,
  onChatting,
  others,
  onSelectOther,
  onPickAnother,
  onDone,
  onNext,
}: {
  item: HomeworkItem;
  fromUpload: boolean;
  patch: (itemId: number, body: Record<string, unknown>) => Promise<boolean>;
  justDone: boolean;
  /** whether a chat is running — the page lays itself out around it */
  onChatting: (chatting: boolean) => void;
  /** the ask's other questions, for switching mid-chat (none when it holds one) */
  others: HomeworkItem[];
  onSelectOther: (id: number) => void;
  /** a Not Maths question: back to the list (null when there is no list) */
  onPickAnother: (() => void) | null;
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
  const [thinking, setThinking] = useState(false);
  const lastTutor = useRef("");
  const core = useRef<ChatCoreHandle | null>(null);

  useEffect(() => {
    onChatting(chat != null);
  }, [chat, onChatting]);
  useEffect(() => () => onChatting(false), [onChatting]);

  const gapsDone = gapsComplete(item.gaps);
  const maths = item.subject === "maths";
  const canStart = maths && gapsDone && !editing;

  const start = async (mode: HomeworkMode) => {
    if (!canStart) return;
    if (await patch(item.id, { action: "select", mode })) {
      setChat((c) => ({ mode, gen: (c?.gen ?? 0) + 1 }));
    }
  };

  const saveText = async () => {
    if (await patch(item.id, { action: "text", text: draft })) {
      setEditing(false);
      setChat(null);
    }
  };
  const startEditing = () => {
    setDraft(item.text);
    setEditing(true);
  };
  const cancelEditing = () => {
    setDraft(item.text);
    setEditing(false);
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

  const label = displayLabel(item.label);

  if (!chat) {
    return (
      <div className="flex flex-col gap-[18px]">
        {/* What I read (FR-3607): outlined, no shadow */}
        <section
          className={cx(STROKE, "flex flex-col gap-3.5 rounded-[var(--chat-panel-radius)] bg-card p-[22px]")}
          aria-label="What I read"
        >
          <p className="font-display text-[1.1rem] font-extrabold leading-none text-ink">
            What I read{label ? ` · ${label}` : ""}
          </p>

          {editing ? (
            <EditText
              id={item.id}
              draft={draft}
              setDraft={setDraft}
              onSave={saveText}
              onCancel={cancelEditing}
            />
          ) : (
            <>
              <div className="rounded-[var(--play-radius-sm)] bg-card-warm px-[18px] py-4 font-read text-[1.15rem] leading-[1.5] text-ink">
                <QuestionText text={item.text} gaps={item.gaps} />
              </div>
              <TextLink onClick={startEditing}>Edit the text</TextLink>
            </>
          )}

          {/* The unreadable parts, asked for one by one (FR-3606) */}
          {item.gaps.length > 0 && !gapsDone && !editing && (
            <form
              className="flex flex-col gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await patch(item.id, { action: "gaps", answers });
              }}
            >
              <p className="font-read text-[1rem] font-semibold leading-[1.6] text-ink">
                I couldn&apos;t read {item.gaps.length === 1 ? "one part" : "some parts"} of this, marked{" "}
                <span aria-label="unreadable">{GAP}</span>. I won&apos;t guess — can you tell me?
              </p>
              {item.gaps.map((g, k) => (
                <label key={k} className="flex flex-col gap-1.5">
                  <span className="font-display text-[0.85rem] font-bold text-[color:var(--play-text-dim)]">{g.ask}</span>
                  <input
                    value={answers[k] ?? ""}
                    onChange={(e) => setAnswers((a) => a.map((v, j) => (j === k ? e.target.value : v)))}
                    maxLength={80}
                    className={cx(STROKE, "min-h-[var(--noor-touch-min)] w-full max-w-sm rounded-[var(--play-radius-sm)] bg-card px-3.5 font-read text-[1.02rem] text-ink")}
                  />
                </label>
              ))}
              <button
                type="submit"
                disabled={answers.some((a) => !a.trim())}
                className={cx(BUTTON_SECONDARY, "self-start px-[22px]")}
              >
                Use these
              </button>
            </form>
          )}

          {!editing &&
            (maths ? (
              <>
                <p className="font-display text-[0.98rem] font-bold leading-[1.5] text-[color:var(--play-text-dim)]">
                  {item.objective ? (
                    <>
                      {item.objective.label} · {sentenceCase(item.objective.mastery)}
                    </>
                  ) : (
                    "Matched to your Maths units"
                  )}
                </p>
                <p className="font-read text-[0.92rem] leading-[1.55] text-[color:var(--play-text-dim)]">
                  Noor worked this out itself, so double-check the answer.
                </p>
              </>
            ) : (
              <>
                <p className="font-read text-[1.05rem] font-semibold leading-[1.6] text-ink">
                  This one isn&apos;t Maths. I only cover Maths so far, so I can&apos;t walk you through it.
                </p>
                {onPickAnother && <TextLink onClick={onPickAnother}>Pick another question</TextLink>}
              </>
            ))}
        </section>

        {/* Two modes, one decision (FR-3609), side by side. Walk me through is
            the amber — only before a chat starts. Hidden while editing. */}
        {maths && !editing && (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <ChoiceCard
                label={MODE_NAME.walk}
                hint="step by step →"
                primary
                disabled={!canStart}
                onClick={() => start("walk")}
              />
              <ChoiceCard
                label={MODE_NAME.check}
                hint="I'll show you my try →"
                primary={false}
                disabled={!canStart}
                onClick={() => start("check")}
              />
            </div>
            {!gapsDone && (
              <p className="font-display text-[0.95rem] font-bold leading-[1.4] text-[color:var(--play-text-dim)]">
                Fill in the missing part above to start
              </p>
            )}
            {fromUpload && (
              <p className="font-read text-[0.85rem] leading-[1.5] text-[color:var(--play-text-dim)]">
                Only the question is kept from your file.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ---- the chat is running: side card (web) or strip (iPad, phone) + chat ---- */

  const sideCard = (
    <SideCard
      item={item}
      label={label}
      mode={chat.mode}
      fromUpload={fromUpload}
      editing={editing}
      draft={draft}
      setDraft={setDraft}
      onEdit={startEditing}
      onSave={saveText}
      onCancel={cancelEditing}
      onMode={(m) => void start(m)}
      others={others}
      onSelectOther={onSelectOther}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 min-[1280px]:flex-row min-[1280px]:gap-6">
      <aside className="thin-scroll hidden w-[340px] shrink-0 flex-col gap-3.5 overflow-y-auto min-[1280px]:flex">
        {sideCard}
      </aside>
      <QuestionStrip item={item} label={label} mode={chat.mode}>
        {sideCard}
      </QuestionStrip>

      {/* The chat is the page (guided pages handoff §1): it fills what is left */}
      <section aria-label="Ask Noor" className={GUIDED_CHAT_PANEL}>
        <GuidedChatHeader
          thinking={thinking}
          sub={[label, item.objective?.label].filter(Boolean).join(" · ") || MODE_NAME[chat.mode]}
        />
        <ChatCore
          key={`${item.id}:${chat.mode}:${chat.gen}`}
          surface="homework"
          homeworkItemId={item.id}
          autoStart={chat.mode === "walk" ? "Walk me through it, step by step." : "Check my work — I'll show you my try."}
          placeholder={chat.mode === "walk" ? "Answer or ask anything…" : "Type your working, or attach a photo…"}
          debug={false}
          lessonChrome
          onThinkingChange={setThinking}
          questionCards={false}
          mathKeys={{ context: [item.text] }}
          suggestions={links}
          handleRef={core}
          onAssistantDone={(text) => {
            lastTutor.current = text;
            if (repairMarkers(text).includes(QUESTION_DONE)) void onDone();
          }}
          trailing={
            <>
              {note != null && (
                <TeacherNote item={item} label={label} working={note} onClose={() => setNote(null)} />
              )}
              {(justDone || item.status === "done") && (
                <DoneCard label={label} onNext={onNext} />
              )}
            </>
          }
        />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TextLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center self-start font-display text-[0.9rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
    >
      {children}
    </button>
  );
}

/** Editing the question: a 3px-outlined box, Save (amber) and Cancel, and what saving does. */
function EditText({
  id,
  draft,
  setDraft,
  onSave,
  onCancel,
}: {
  id: number;
  draft: string;
  setDraft: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={`edit-${id}`} className="sr-only">
        Edit the question
      </label>
      <textarea
        id={`edit-${id}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={2000}
        className={cx(STROKE, "min-h-24 w-full rounded-[var(--play-radius-sm)] bg-card px-4 py-3.5 font-read text-[1.1rem] leading-[1.5] text-ink")}
      />
      <div className="flex items-center gap-4">
        <button type="button" onClick={onSave} className={cx(BUTTON_PRIMARY, "px-6 text-[1.05rem]")}>
          Save
        </button>
        <TextLink onClick={onCancel}>Cancel</TextLink>
      </div>
      <p className="font-read text-[0.9rem] leading-[1.5] text-[color:var(--play-text-dim)]">
        Saving changes what I teach from, and restarts any chat on this question.
      </p>
    </div>
  );
}

/** A mode choice before the chat: a sticker, amber for Walk me through it; flat when it can't start. */
function ChoiceCard({
  label,
  hint,
  primary,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  primary: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        STROKE_WIDTH,
        "flex flex-col items-start gap-[5px] rounded-[var(--play-radius)] px-5 py-4 text-start",
        disabled
          ? "border-[color:var(--play-disabled-border)]"
          : cx(
              "play-pressable sticker-shadow border-ink",
              primary ? "bg-[var(--noor-action)] text-[color:var(--noor-on-action)]" : "bg-card text-ink"
            )
      )}
    >
      <span className="font-display text-[1.15rem] font-extrabold leading-[1.2]">{label}</span>
      <span className="font-display text-[0.92rem] font-bold leading-[1.4]">{hint}</span>
    </button>
  );
}

/**
 * What I read, once the chat runs: the question, the way to edit it, the match, and how we are
 * working — the chosen mode a quiet ✓ line, the other a link that restarts the chat in it. With
 * several questions, "Other questions" opens the list so she can switch mid-chat.
 */
function SideCard({
  item,
  label,
  mode,
  fromUpload,
  editing,
  draft,
  setDraft,
  onEdit,
  onSave,
  onCancel,
  onMode,
  others,
  onSelectOther,
}: {
  item: HomeworkItem;
  label: string | null;
  mode: HomeworkMode;
  fromUpload: boolean;
  editing: boolean;
  draft: string;
  setDraft: (v: string) => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onMode: (m: HomeworkMode) => void;
  others: HomeworkItem[];
  onSelectOther: (id: number) => void;
}) {
  const [listOpen, setListOpen] = useState(false);
  const other: HomeworkMode = mode === "walk" ? "check" : "walk";
  return (
    <>
      <div className={cx(STROKE, "flex flex-col gap-3 rounded-[var(--chat-panel-radius)] bg-card p-[18px]")}>
        <p className="font-display text-[1.05rem] font-extrabold leading-none text-ink">
          What I read{label ? ` · ${label}` : ""}
        </p>
        {editing ? (
          <EditText id={item.id} draft={draft} setDraft={setDraft} onSave={onSave} onCancel={onCancel} />
        ) : (
          <>
            <div className="rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-3.5 font-read text-[1.1rem] leading-[1.45] text-ink">
              <QuestionText text={item.text} gaps={item.gaps} />
            </div>
            <TextLink onClick={onEdit}>Edit the text</TextLink>
          </>
        )}
        <p className="font-display text-[0.92rem] font-bold leading-[1.45] text-[color:var(--play-text-dim)]">
          {item.objective ? `${item.objective.label} · ${sentenceCase(item.objective.mastery)}` : "Matched to your Maths units"}
        </p>
        <p className="font-read text-[0.88rem] leading-[1.55] text-[color:var(--play-text-dim)]">
          Noor worked this out itself, so double-check the answer.
        </p>
      </div>

      {!editing && (
        <div className="flex flex-col gap-0.5 px-1.5">
          <p className="pb-1.5 font-display text-[0.82rem] font-bold leading-none text-[color:var(--play-text-dim)]">
            How we are working
          </p>
          <p className="flex min-h-11 items-center gap-2 font-display text-[1rem] font-extrabold leading-[1.2] text-ink">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--noor-progress)] text-[0.8rem] text-[color:var(--noor-on-progress)]"
            >
              ✓
            </span>
            {MODE_NAME[mode]}
          </p>
          <button
            type="button"
            onClick={() => onMode(other)}
            className="flex min-h-11 items-center gap-2 text-start font-display text-[1rem] font-bold leading-[1.2] text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
          >
            <span aria-hidden className="w-6 shrink-0" />
            {MODE_NAME[other]}
          </button>
        </div>
      )}

      {others.length > 0 && !editing && (
        <div className="flex flex-col gap-2.5 px-1.5">
          <TextLink onClick={() => setListOpen((o) => !o)}>
            {listOpen ? "Hide the other questions" : `Other questions (${others.length})`}
          </TextLink>
          {listOpen && <QuestionRows items={others} selectedId={null} onSelect={onSelectOther} compact />}
        </div>
      )}

      {fromUpload && (
        <p className="px-1.5 font-read text-[0.82rem] leading-[1.5] text-[color:var(--play-text-dim)]">
          Only the question is kept from your file.
        </p>
      )}
    </>
  );
}

/** Under 1280px: the question as one line above a full-width chat; "Show" opens the side card. */
function QuestionStrip({
  item,
  label,
  mode,
  children,
}: {
  item: HomeworkItem;
  label: string | null;
  mode: HomeworkMode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex shrink-0 flex-col gap-3 min-[1280px]:hidden">
      <div className={cx(STROKE, "flex items-center gap-3 rounded-[var(--play-radius-sm)] bg-card py-1 pe-1.5 ps-3.5")}>
        {label && (
          <span className="shrink-0 font-display text-[0.9rem] font-extrabold text-[color:var(--play-text-dim)]">{label}</span>
        )}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap font-read text-[1.05rem] text-ink">
          <QuestionText text={item.text} gaps={item.gaps} />
        </span>
        <span className="hidden shrink-0 whitespace-nowrap font-display text-[0.88rem] font-bold text-[color:var(--play-text-dim)] sm:inline">
          {mode === "walk" ? "Walk me through" : "Check my work"} ✓
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex min-h-11 shrink-0 items-center px-2 font-display text-[0.9rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
        >
          {open ? "Hide ⌃" : "Show ⌄"}
        </button>
      </div>
      {open && <div className="thin-scroll flex max-h-[45dvh] flex-col gap-3.5 overflow-y-auto">{children}</div>}
    </div>
  );
}

/**
 * "Ask your teacher" (FR-3612), in the chat: a pre-filled note. Nothing sends it this round
 * — there is no teacher on record yet — so Send is disabled and says so.
 */
function TeacherNote({
  item,
  label,
  working,
  onClose,
}: {
  item: HomeworkItem;
  label: string | null;
  working: string;
  onClose: () => void;
}) {
  const [unsure, setUnsure] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const brief = working
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/\[\[[^\]]*\]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Ask your teacher"
      className={cx(
        STROKE,
        "ms-[var(--chat-card-inset)] flex max-w-[var(--chat-bubble-max)] flex-col gap-[11px] rounded-[var(--play-radius)] bg-card px-[18px] py-4 sticker-shadow-sm"
      )}
    >
      <p className="font-display text-[1.05rem] font-extrabold leading-none text-ink">Ask your teacher</p>
      <div className="rounded-[var(--play-radius-sm)] bg-card-warm px-3.5 py-3 font-read text-[0.95rem] leading-[1.6] text-ink">
        <p>
          {label ? `${label}: ` : ""}
          {item.text.replace(/\$/g, "").slice(0, 160)}
        </p>
        {brief && <p>Last step from Noor: {brief.replace(/\$/g, "")}</p>}
      </div>
      <label className="flex flex-col gap-[5px]">
        <span className="font-display text-[0.85rem] font-bold leading-none text-[color:var(--play-text-dim)]">Not sure about:</span>
        <input
          value={unsure}
          onChange={(e) => setUnsure(e.target.value)}
          maxLength={200}
          className={cx(STROKE, "min-h-[var(--noor-touch-min)] w-full rounded-[var(--play-radius-sm)] bg-card px-3.5 font-read text-[1rem] text-ink")}
        />
      </label>
      <p className="font-read text-[0.9rem] font-semibold leading-[1.5] text-[color:var(--play-text-dim)]">
        Teacher notes are coming soon — this one can&apos;t be sent yet.
      </p>
      <div className="flex items-center gap-4">
        <button type="button" disabled className={cx(BUTTON_SECONDARY, "px-5")}>
          Send
        </button>
        <TextLink onClick={onClose}>Cancel</TextLink>
      </div>
    </div>
  );
}

/** The question is done (FR-3611): a leaf card in the chat, popping once, and what next. */
function DoneCard({ label, onNext }: { label: string | null; onNext: (() => void) | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <div
      ref={ref}
      className={cx(
        STROKE,
        "anim-pop ms-[var(--chat-card-inset)] flex max-w-[var(--chat-bubble-max)] flex-col gap-3.5 rounded-[var(--play-radius)] bg-[var(--play-leaf)] p-[18px] text-[color:var(--play-on-leaf)] sticker-shadow-sm"
      )}
    >
      <p className="font-display text-[1.25rem] font-extrabold leading-[1.2]">
        Nice work{label ? ` on ${label}` : ""}. What next?
      </p>
      <div className="flex flex-wrap items-center gap-[18px]">
        {onNext && (
          <button type="button" onClick={onNext} className={cx(BUTTON_PRIMARY, "px-[22px] text-[1.05rem]")}>
            Pick another question
          </button>
        )}
        <Link
          href="/student"
          prefetch={false}
          className="inline-flex min-h-11 items-center font-display text-[0.95rem] font-bold text-[color:var(--play-on-leaf)] underline underline-offset-[5px]"
        >
          I&apos;m done for now
        </Link>
      </div>
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

/** A bare number as written ("1", "3)") reads as a question number: "Q1". */
const displayLabel = (label: string | null) =>
  label == null ? null : /^\d+[).]?$/.test(label) ? `Q${label.replace(/[).]$/, "")}` : label;

const sentenceCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

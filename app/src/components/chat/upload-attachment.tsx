"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { track } from "@/lib/ga";
import { ICON_BUTTON, STROKE_WIDTH_SM, VERDICT_INK, cx } from "@/components/sticker";
import {
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_POLL_CEILING_MS,
  coerceUploadId,
  refuseUpload,
  typedUploadFile,
  uploadControlLabels,
  uploadFailureMessage,
  uploadFailureOf,
  uploadPhaseMessage,
  uploadPollDelayMs,
  uploadRefusalMessage,
  type UploadLang,
  type UploadPhase,
} from "@/lib/upload-contract";

/**
 * "Send me a photo of it" — the student half of the upload path (PRD B10,
 * FR-205).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HOOK AND NOT A COMPONENT
 * ---------------------------------------------------------------------------
 * The control is two things in two places: a pair of icon buttons INSIDE the
 * composer row, beside the mic and the send arrow, and a status strip ABOVE it
 * that has to be a block of its own so a long sentence about an unreadable
 * photograph does not squeeze the text input to nothing on a phone. They share
 * one piece of state — which file, which phase, which upload id — and splitting
 * them into two components would mean lifting that state into `ChatCore`, where
 * it does not belong and where the next person to touch the composer would have
 * to understand the poll loop to move a button.
 *
 * So the state lives here and the hook hands back two pieces of rendered UI
 * plus the id. `ChatCore` places them; it owns none of this.
 *
 * ---------------------------------------------------------------------------
 * WHY IT LIVES IN THE COMPOSER AT ALL
 * ---------------------------------------------------------------------------
 * FR-205's words are "from anywhere in the lesson". `ChatCore`'s composer is
 * the one input a student is ever looking at: `LessonSession` renders it for
 * `lesson_learn` / `lesson_review`, `StudentLoop` renders it for
 * `student_chat`. Putting the affordance on a page of its own would make
 * "upload" a place a student has to go, which is exactly the browsing menu this
 * product does not have — and it would leave the photograph disconnected from
 * the conversation it is about. Here, the next thing that happens after a photo
 * lands is the student typing a question about it, with the transcription
 * already in the turn's grounding.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 * ---------------------------------------------------------------------------
 * It does not check that an upload belongs to the student holding it, and it
 * must never start. Isolation is `uploads`' row-level-security policy (enabled
 * AND forced) plus `getParsedUpload(uploadId, studentId)` reading inside the
 * student's own unit of work. This surface holds an integer. A client-side
 * ownership notion could only ever drift from the one that actually holds.
 *
 * It also never blocks the composer. A parse takes up to ninety seconds, and a
 * student who has just photographed a question wants to type it out while they
 * wait — so nothing here disables the input or the send button, and a turn sent
 * mid-parse simply goes without the transcription (`retrieve()` grounds only on
 * a parse that finished).
 */

/* ------------------------------------------------------------------ */

/** One attachment, as this surface understands it. */
type Attachment = {
  phase: UploadPhase;
  /** The picked file's name — shown back so the student knows which one. */
  name: string;
  /** Its size, kept because the size refusal quotes it. */
  bytes: number;
  /** The server's id, once there is one. */
  uploadId?: number;
  /** The sentence under the filename. */
  message: string;
};

/**
 * Does this device plausibly have a camera worth a button of its own?
 *
 * A media query is an external store, not React state, so it is read with
 * `useSyncExternalStore`: the snapshot is the query's current answer, the
 * subscription is its own `change` event, and the SERVER snapshot is `false`,
 * which is what makes the server render and the first client render agree.
 * Written as a `useState` + `useEffect` pair this was a cascading render on
 * every mount of every chat surface, for a value that almost never changes.
 *
 * The question is "is there a finger and probably a rear camera here", which is
 * what `pointer: coarse` answers — not a user-agent string. iPad Safari, the
 * stated device target, is coarse; an iPad that later has a keyboard attached
 * stops being coarse and the button leaves, which is the right answer and is
 * only possible because this SUBSCRIBES rather than sampling once.
 *
 * Getting it wrong costs nothing either way: without the camera button the file
 * picker remains, and every mobile OS offers "Take Photo" in its own sheet; a
 * spurious one on a laptop opens an ordinary file dialog.
 */
const COARSE_QUERY = "(pointer: coarse)";

function subscribeToPointer(onChange: () => void): () => void {
  const mql = window.matchMedia?.(COARSE_QUERY);
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const pointerIsCoarse = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.(COARSE_QUERY).matches;

/** Phases in which the id is worth sending with a turn (see `uploadId`). */
const GROUNDING_PHASES: ReadonlySet<UploadPhase> = new Set<UploadPhase>([
  "pending",
  "parsed",
  "slow",
]);

/** Phases the student should read as "this went wrong", not "this is working". */
const ERROR_PHASES: ReadonlySet<UploadPhase> = new Set<UploadPhase>([
  "failed",
  "unreadable",
  "slow",
]);

export function useUploadAttachment({
  chatSession,
  surface,
  lang,
}: {
  /**
   * The chat session this upload belongs to — sent as `sessionId`, which is
   * what joins the photograph to the sitting the student took it in.
   */
  chatSession: string;
  /** For GA's `surface` property. Never the question, never who asked. */
  surface: string;
  /** The register the surrounding surface is speaking (`arabicUi`). */
  lang: UploadLang;
}): {
  /** The icon buttons, for the composer row. */
  controls: React.ReactNode;
  /** The status strip, for directly above the composer row. */
  banner: React.ReactNode;
  /**
   * The id to send with the next turn, or undefined.
   *
   * Present from the moment the route answers 202 — not only once the parse has
   * finished. A parse can complete between one poll and the next, and an id
   * whose parse has not finished costs the server one scoped read that returns
   * no text, which `retrieve()` already handles by grounding on nothing. Being
   * early is free; being late loses the student their grounding on the very
   * turn they uploaded for.
   */
  uploadId: number | undefined;
} {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const coarsePointer = useSyncExternalStore(
    subscribeToPointer,
    pointerIsCoarse,
    () => false
  );

  const fileInputId = useId();
  const cameraInputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  /** The live poll timer and the in-flight request, for unmount and removal. */
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
    inFlight.current?.abort();
    inFlight.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const labels = uploadControlLabels(lang);

  /**
   * Ask `GET /api/uploads/{id}` until it stops saying "pending".
   *
   * The interval and its ceiling are `lib/upload-contract.ts`'s, with the
   * reasoning for all three numbers. Two behaviours are worth reading here:
   *
   *  · A NETWORK ERROR IS NOT AN ANSWER. A dropped request keeps the loop
   *    running to the ceiling — a student in a stairwell has not had their
   *    upload fail, they have had one poll fail, and telling them otherwise
   *    throws away a parse that is still running on the server.
   *  · THE CEILING IS A STATE, NOT A STOP. When it is reached the phase becomes
   *    `slow`, which reads as "this is taking longer than usual, type your
   *    question and I'm with you" — never a spinner that spins forever.
   */
  const poll = useCallback(
    (uploadId: number) => {
      const startedAt = Date.now();
      let attempt = 0;

      const ask = async () => {
        if (Date.now() - startedAt > UPLOAD_POLL_CEILING_MS) {
          setAttachment((a) =>
            a?.uploadId === uploadId
              ? { ...a, phase: "slow", message: uploadPhaseMessage("slow", lang) }
              : a
          );
          return;
        }
        let phase: UploadPhase | null = null;
        try {
          const controller = new AbortController();
          inFlight.current = controller;
          const res = await fetch(`/api/uploads/${uploadId}`, {
            signal: controller.signal,
          });
          if (res.status === 404) {
            // "not yours" and "no such id" are one answer by design
            // (FR-2103). Either way there is nothing here to teach from.
            phase = "failed";
          } else if (res.ok) {
            const body = (await res.json()) as { parseStatus?: string };
            if (
              body.parseStatus === "parsed" ||
              body.parseStatus === "unreadable" ||
              body.parseStatus === "failed"
            ) {
              phase = body.parseStatus;
            }
          }
        } catch {
          // Aborted, offline, or a blip. Fall through and try again.
        } finally {
          inFlight.current = null;
        }

        if (phase) {
          const settled = phase;
          setAttachment((a) =>
            a?.uploadId === uploadId
              ? { ...a, phase: settled, message: uploadPhaseMessage(settled, lang) }
              : a
          );
          return;
        }
        pollTimer.current = setTimeout(ask, uploadPollDelayMs(attempt++));
      };

      pollTimer.current = setTimeout(ask, uploadPollDelayMs(attempt++));
    },
    [lang]
  );

  /** Post one file and hand the poll loop its id. */
  const upload = useCallback(
    async (file: File) => {
      const name = file.name;
      const bytes = file.size;
      setAttachment({
        phase: "uploading",
        name,
        bytes,
        message: uploadPhaseMessage("uploading", lang),
      });

      const form = new FormData();
      form.append("file", typedUploadFile(file));
      // The legacy client session string the route already understands: it is
      // what joins this photograph to the sitting the student took it in
      // (ADR-0015, `currentSessionOrNull(… adoptOpen: true)`).
      form.append("sessionId", chatSession);

      try {
        const controller = new AbortController();
        inFlight.current = controller;
        const res = await fetch("/api/uploads", {
          method: "POST",
          body: form,
          signal: controller.signal,
        });
        if (!res.ok) {
          const failure = uploadFailureOf(res.status);
          setAttachment({
            phase: "failed",
            name,
            bytes,
            message: uploadFailureMessage(failure, bytes, lang),
          });
          return;
        }
        const body = (await res.json()) as { uploadId?: unknown };
        const uploadId = coerceUploadId(body.uploadId);
        if (!uploadId) {
          setAttachment({
            phase: "failed",
            name,
            bytes,
            message: uploadFailureMessage("server", bytes, lang),
          });
          return;
        }
        // GA's audience layer sees that an upload happened and on which
        // surface — never the file, never whose it is (lib/ga.ts). The
        // FIRST-PARTY row is the record and is written server-side by the
        // route itself, inside the request that created the upload; this is
        // the audience half of the same event, and there is deliberately no
        // second `emit` from here.
        track("upload_submitted", { surface });
        setAttachment({
          phase: "pending",
          name,
          bytes,
          uploadId,
          message: uploadPhaseMessage("pending", lang),
        });
        poll(uploadId);
      } catch {
        setAttachment({
          phase: "failed",
          name,
          bytes,
          message: uploadFailureMessage("offline", bytes, lang),
        });
      } finally {
        inFlight.current = null;
      }
    },
    [chatSession, lang, poll, surface]
  );

  /**
   * A file came back from a picker.
   *
   * The input is reset first, unconditionally: without it, picking the same
   * photograph twice in a row fires no `change` event at all, and a student
   * whose first attempt failed taps the same file and watches nothing happen.
   */
  const pick = useCallback(
    (input: HTMLInputElement | null) => {
      const file = input?.files?.[0] ?? null;
      if (input) input.value = "";
      if (!file) return;
      stop();
      const refusal = refuseUpload({
        type: file.type,
        name: file.name,
        size: file.size,
      });
      if (refusal) {
        setAttachment({
          phase: "failed",
          name: file.name,
          bytes: file.size,
          message: uploadRefusalMessage(refusal, file.size, lang),
        });
        return;
      }
      void upload(file);
    },
    [lang, stop, upload]
  );

  const clear = useCallback(() => {
    stop();
    setAttachment(null);
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
  }, [stop]);

  /**
   * One attachment at a time — but the pickers close only while one is
   * actually IN FLIGHT.
   *
   * They used to close for any attachment at all, which made the commonest
   * moment in this whole flow worse: a student picks the wrong file, reads
   * "I can't open that kind of file", and then has to find and press × before
   * they are allowed to pick the right one. Two taps to undo a mistake, on the
   * surface whose audience is already anxious. Picking again simply replaces
   * what is held (`pick` stops the old poll first), so the only state worth
   * closing them for is one where a replacement would race a request that is
   * still running. They go quiet rather than disappearing: a control that
   * vanishes mid-task reads as a bug.
   */
  const busy =
    attachment?.phase === "uploading" || attachment?.phase === "pending";

  const controls = (
    <>
      <PickerButton
        id={fileInputId}
        inputRef={fileRef}
        label={labels.attach}
        disabled={busy}
        onPick={pick}
      >
        <PaperclipIcon />
      </PickerButton>
      {coarsePointer && (
        <PickerButton
          id={cameraInputId}
          inputRef={cameraRef}
          label={labels.camera}
          disabled={busy}
          onPick={pick}
          capture="environment"
        >
          <CameraIcon />
        </PickerButton>
      )}
    </>
  );

  const banner = attachment ? (
    <UploadStrip
      attachment={attachment}
      lang={lang}
      removeLabel={labels.remove}
      regionLabel={labels.region}
      onRemove={clear}
    />
  ) : null;

  return {
    controls,
    banner,
    uploadId:
      attachment && GROUNDING_PHASES.has(attachment.phase)
        ? attachment.uploadId
        : undefined,
  };
}

/* ------------------------------------------------------------------ */

/**
 * One file picker, as an accessible icon button.
 *
 * The `<input type="file">` is the real control and it is `sr-only` — CLIPPED,
 * not `display: none`, so it keeps its place in the tab order and Enter on it
 * opens the picker with no JavaScript at all. The `<label>` is the thing you
 * see; its visually-hidden text is what gives the input its accessible name,
 * which is why the label is not also `aria-label`led (that would name the
 * label, and leave the focused input anonymous).
 *
 * A clipped input shows no focus ring of its own, so the ring is drawn on the
 * label through `peer-focus-visible:` — the same amber ring every other
 * interactive surface in the product uses, stacked on the sticker shadow.
 * Both peer states carry `!`: `.sticker-shadow-sm` is an unlayered rule, so a
 * layered utility only outranks it as an important one. Disabled follows the
 * handoff's Buttons spec — dashed outline, disabled text, no shadow — rather
 * than an opacity, which read as broken (review 2026-09-23, F22).
 */
function PickerButton({
  id,
  inputRef,
  label,
  disabled,
  onPick,
  capture,
  children,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  label: string;
  disabled: boolean;
  onPick: (input: HTMLInputElement | null) => void;
  /** `environment` = the rear camera, for photographing a page on a desk. */
  capture?: "environment";
  children: React.ReactNode;
}) {
  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={UPLOAD_ACCEPT_ATTR}
        capture={capture}
        disabled={disabled}
        onChange={(e) => onPick(e.currentTarget)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        title={label}
        className={cx(
          ICON_BUTTON,
          "cursor-pointer",
          "peer-focus-visible:[box-shadow:var(--play-shadow-sm),var(--noor-focus-ring)]!",
          "peer-disabled:cursor-not-allowed peer-disabled:border-dashed peer-disabled:border-[color:var(--play-disabled-border)] peer-disabled:text-[color:var(--play-disabled-text)] peer-disabled:[box-shadow:none]!"
        )}
      >
        {children}
        <span className="sr-only">{label}</span>
      </label>
    </>
  );
}

/**
 * The strip above the composer: which file, what is happening to it, and the
 * one way out.
 *
 * Direction is never hard-coded. The strip takes the surrounding surface's
 * register, and the filename — which is the student's own data and may be
 * Arabic, Latin, or a mixture — is `dir="auto"` so the browser resolves it from
 * its first strong character instead of inheriting a direction that would tear
 * it in half. Every offset is logical (`text-start`, `gap`), so the remove
 * button sits at the trailing edge in both directions without a second rule.
 *
 * `role` is the accessibility half of "a parse that fails must not look like a
 * hang": progress is a polite `status`, a refusal or an unreadable photograph
 * is an assertive `alert`. Neither is announced by colour alone — the sentence
 * says what happened and what to do next.
 */
function UploadStrip({
  attachment,
  lang,
  removeLabel,
  regionLabel,
  onRemove,
}: {
  attachment: Attachment;
  lang: UploadLang;
  removeLabel: string;
  regionLabel: string;
  onRemove: () => void;
}) {
  const bad = ERROR_PHASES.has(attachment.phase);
  const working =
    attachment.phase === "uploading" || attachment.phase === "pending";
  return (
    <div className="px-4 pt-2">
      <div
        dir={lang === "ar" ? "rtl" : "ltr"}
        role={bad ? "alert" : "status"}
        aria-live={bad ? "assertive" : "polite"}
        aria-label={regionLabel}
        // A refusal greys out like a wrong answer — inactive fill, muted AA
        // text, no shadow — and is never red; the sentence carries the news.
        // Progress sits on the Honey band.
        className={cx(
          STROKE_WIDTH_SM,
          "anim-pop flex items-start gap-2 rounded-[var(--play-radius-sm)] px-3 py-2",
          bad ? VERDICT_INK.wrong : "border-ink bg-card-warm text-ink sticker-shadow-sm"
        )}
      >
        <span className="mt-0.5 shrink-0" aria-hidden>
          {working ? (
            <span className="block size-2 animate-pulse rounded-full bg-[var(--noor-action)]" />
          ) : (
            <PaperclipIcon />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            dir="auto"
            className="truncate text-start font-display text-[0.85rem] font-bold leading-snug"
          >
            {attachment.name}
          </span>
          {/* No colour of its own: the sentence takes the strip's tone, so a
              refusal READS as a refusal instead of being the one grey line on
              a red card. Hierarchy comes from weight, which is the axis that
              survives every theme the design system defines. */}
          <span dir="auto" className="text-start text-[0.85rem] leading-relaxed">
            {attachment.message}
          </span>
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          title={removeLabel}
          // a borderless icon control that still holds the 52px floor; the
          // negative margins keep it from inflating the strip
          className="-my-2.5 -me-2.5 flex size-[var(--noor-touch-min)] shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] text-ink-soft play-pressable"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

/* --- icons: same 14×14 grid and stroke idiom as the composer's own --- */

function PaperclipIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M11.2 6.6 6.9 10.9a2.55 2.55 0 0 1-3.6-3.6l4.6-4.6a1.7 1.7 0 0 1 2.4 2.4L5.7 9.7a.85.85 0 0 1-1.2-1.2l4-4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M1.6 4.7h2.1l1-1.5h4.6l1 1.5h2.1v6.6H1.6z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="7.9" r="2.1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M3.6 3.6l6.8 6.8M10.4 3.6l-6.8 6.8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

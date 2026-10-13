"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authFetch } from "@/lib/auth/client-session";
import { track } from "@/lib/ga";
import { HEADING, STROKE, STROKE_SM, STROKE_WIDTH, cx } from "@/components/sticker";
import {
  UPLOAD_ACCEPT_ATTR,
  refuseUpload,
  typedUploadFile,
  uploadFailureMessage,
  uploadFailureOf,
  uploadRefusalMessage,
} from "@/lib/upload-contract";

/**
 * "Got a question? Ask Noor" — the first block on the student home
 * (spec 004, FR-3601…FR-3603; design handoff `home_ask` §3).
 *
 * Typed text, or a file (photo or PDF) with an optional note. Sending creates
 * a homework ask and goes straight to its page; reading the file and splitting
 * it into questions happens there, so a student is never left watching this
 * card spin.
 *
 * **One amber (FR-3602).** This card does not colour anything outside itself.
 * It sets `data-ask-ready` on its root, and the Up next row reads that through
 * a `group-has-*` selector on the page (`LessonCheckIn`), so "Send turns amber,
 * Walk me through it turns white" is one CSS rule rather than state lifted
 * through a server component.
 *
 * No camera control (handoff §9). The row leaves room for one at the start.
 */

const EXAMPLE =
  "Q7. A rectangular garden is 3 m longer than it is wide. Its area is 40 m². Find its dimensions.";

export function HomeAskCard() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const ready = text.trim() !== "" || file != null;

  const pick = (f: File | null) => {
    setError(null);
    if (!f) return;
    const typed = typedUploadFile(f);
    const refusal = refuseUpload(typed);
    if (refusal) {
      setError(uploadRefusalMessage(refusal, typed.size, "en"));
      return;
    }
    setFile(typed);
  };

  const send = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    track("question_asked", { surface: "homework" });
    try {
      let uploadId: number | undefined;
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const up = await authFetch("/api/uploads", { method: "POST", body: form });
        if (!up.ok) {
          setError(uploadFailureMessage(uploadFailureOf(up.status), file.size, "en"));
          setBusy(false);
          return;
        }
        uploadId = (await up.json()).uploadId;
      }
      const res = await authFetch("/api/homework", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim(), uploadId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { askId } = await res.json();
      router.push(`/student/ask/${askId}`);
    } catch {
      setError("Something went wrong sending that. Want to try again?");
      setBusy(false);
    }
  };

  return (
    <section
      data-ask-ready={ready ? "true" : "false"}
      aria-labelledby="ask-noor-title"
      className={cx(STROKE, "flex shrink-0 flex-col gap-3.5 rounded-[var(--play-radius-lg)] bg-card p-[22px]")}
    >
      <h2 id="ask-noor-title" className={cx(HEADING, "text-[1.5rem]")}>
        Got a question? Ask Noor
      </h2>

      <form
        className="flex items-center gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={UPLOAD_ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0] ?? null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          title="Attach a file"
          aria-label="Attach a file"
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className={cx(
            STROKE,
            "play-pressable sticker-shadow-sm inline-flex size-12 shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] bg-card text-ink"
          )}
        >
          <PaperclipIcon />
        </button>
        <label htmlFor="ask-noor-input" className="sr-only">
          Type your question
        </label>
        <input
          id="ask-noor-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={file ? "Add a note (optional)…" : "Type your question…"}
          maxLength={4000}
          disabled={busy}
          autoComplete="off"
          className={cx(
            STROKE,
            "sticker-shadow-sm h-[54px] min-w-0 flex-1 rounded-[var(--play-radius-sm)] bg-card px-4 font-read text-[1rem] text-ink placeholder:text-[color:var(--play-text-muted)]"
          )}
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!ready || busy}
          className={cx(
            STROKE_WIDTH,
            "inline-flex size-[54px] shrink-0 items-center justify-center rounded-[var(--play-radius-pill)] font-display text-[1.3rem] font-extrabold",
            ready
              ? "play-pressable sticker-shadow-sm border-ink bg-[var(--noor-action)] text-[color:var(--noor-on-action)]"
              : "border-[color:var(--play-disabled-border)] bg-card text-[color:var(--play-disabled-text)]"
          )}
        >
          {busy ? "…" : "↑"}
        </button>
      </form>

      {file && (
        <div className={cx(STROKE_SM, "flex items-center gap-2 self-start rounded-[var(--play-radius-pill)] bg-card-warm py-1 ps-3 pe-1")}>
          <PaperclipIcon />
          <span className="max-w-[16rem] truncate font-display text-[0.9rem] font-bold text-ink">{file.name}</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            aria-label={`Remove ${file.name}`}
            disabled={busy}
            className="inline-flex size-9 items-center justify-center rounded-[var(--play-radius-pill)] font-display text-[1rem] font-bold text-ink"
          >
            ×
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="font-read text-[0.95rem] leading-[1.6] text-ink">
          {error}
        </p>
      )}

      <p className="font-read text-[0.95rem] leading-[1.6] text-ink-soft">
        I won&apos;t give you the answer directly. I&apos;ll walk you through it step by step, so
        you can solve it yourself.
      </p>
      {/* Demo only (handoff §3): remove before production. */}
      <button
        type="button"
        onClick={() => setText(EXAMPLE)}
        className="min-h-11 self-start font-display text-[0.9rem] font-bold text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
      >
        Try an example question
      </button>
    </section>
  );
}

function PaperclipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" fill="none" aria-hidden>
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

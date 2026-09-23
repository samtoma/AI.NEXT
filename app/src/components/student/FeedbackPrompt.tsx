"use client";

import { useEffect, useRef, useState } from "react";

import { FEEDBACK_NOTE_MAX, type FeedbackMoment } from "@/lib/feedback-rules";
import {
  BUTTON_SECONDARY,
  BUTTON_TERTIARY,
  STROKE,
  cx,
} from "@/components/sticker";

/**
 * "How did that go?" — the one place the product asks a student about itself
 * (FR-2801…FR-2807, migration 025).
 *
 * ---------------------------------------------------------------------------
 * IT NEVER BLOCKS ANYTHING, AND THAT IS STRUCTURAL RATHER THAN CAREFUL
 * ---------------------------------------------------------------------------
 * There is no modal, no overlay, no backdrop, no focus trap, no `autoFocus`,
 * no `beforeunload`, and nothing in the flow waits on this component. It is a
 * block in ordinary document flow, rendered AFTER the report card's three
 * doors and after the practice summary's own close — so a student who wants to
 * leave has already passed every control she needs before she meets it, and
 * the page behaves identically whether she answers, dismisses or scrolls past.
 *
 * It also renders **nothing at all** until the server has said to ask, which
 * is why there is no layout shift to notice and no skeleton to look at: the
 * absent case is the overwhelmingly common one (`lib/feedback-rules.ts` —
 * at most once a fortnight), and the absent case is literally `null`.
 *
 * ---------------------------------------------------------------------------
 * THE THUMB IS A COMPLETE ANSWER
 * ---------------------------------------------------------------------------
 * One tap sends the rating, on its own, immediately. The note box appears
 * afterwards and is optional in the strongest sense available: the answer is
 * already recorded by the time she sees it, the copy says so, and closing the
 * card at that point loses nothing. Nothing here ever asks twice, insists,
 * or dims a control until text is typed.
 *
 * The box is not focused when it appears, deliberately. Moving a child's
 * keyboard caret into a text field she did not ask for is the same
 * interruption as a modal, wearing a smaller hat — and on an iPad it throws
 * the on-screen keyboard over half the report she is still reading.
 *
 * ---------------------------------------------------------------------------
 * DISMISSAL GOES TO THE SERVER, NOT TO `localStorage`
 * ---------------------------------------------------------------------------
 * "Not now" is a POST. ADR-0017 made this argument for the design variant and
 * it is the same argument: a preference about a person belongs to the person,
 * not to the browser. A dismissal in browser storage is lost on the school
 * computer, on a borrowed tablet and the first time site data is cleared, and
 * a child who said "not now" and is asked again the next evening has been told
 * that "not now" does not really exist. **This component reads and writes no
 * browser storage of any kind.**
 *
 * ---------------------------------------------------------------------------
 * BILINGUAL BY CONSTRUCTION, AND GENDER-FREE BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * `rtl` comes from the caller, which derives it from the subject's REGISTERED
 * direction (`isRtlSubject`) exactly as `ReportCard` does — two of the three
 * live courses are Arabic, and no direction is written down anywhere in this
 * file. Every offset below is logical (`ms-`/`me-`, `text-start`), so the
 * layout follows `dir` rather than a copy of the rule.
 *
 * The Arabic copy is written to need **no gender agreement at all**: no
 * imperative verb («إرسال», a verbal noun, rather than «ابعت»/«ابعتي»), no
 * second-person verb, and the one object pronoun it uses («عجبك») is
 * identical in both registers once unvowelled. That is FR-2605's "a form
 * correct for either" arrived at by writing rather than by branching, and it
 * means this component never needs to be told a student's gender — which is
 * constitution VII's minimum-collection rule getting something for free.
 *
 * ---------------------------------------------------------------------------
 * CONSTITUTION XII
 * ---------------------------------------------------------------------------
 * Every colour is a token-backed utility, and the anatomy is Noor Play's from
 * `components/sticker.ts`: the card is a Honey sticker (3px ink, 20px radius,
 * hard shadow — not a control, so it does not press), the thumbs and "Send"
 * are sticker SECONDARY buttons that press, and "Not now" is the TERTIARY
 * text button. The send button used to be a flat ink slab with no shadow and
 * no press (review 2026-09-23, F14) — "if it doesn't move, it isn't a
 * control". There is deliberately no amber here: this block sits under the
 * report card's doors, and the amber one belongs to them. No literal colour,
 * stroke width, radius or shadow anywhere below. The up and down choices are
 * told apart by their WORDS first — the glyph is the second signal, never the
 * only one (WCAG 1.4.1, the same rule `Chip` and `WidgetShell` enforce).
 */

type Phase = "checking" | "asking" | "note" | "done" | "gone";

type Copy = {
  dir: "rtl" | "ltr" | undefined;
  heading: string;
  up: string;
  down: string;
  notNow: string;
  noteInvite: string;
  recorded: string;
  placeholder: string;
  send: string;
  sending: string;
  thanks: string;
  failed: string;
};

/**
 * Two voices, one shape. The English is the product's default (constitution V:
 * English LTR is the MVP 1.0 default); the Arabic is Egyptian and plain,
 * pitched at a fourteen-year-old rather than at a survey respondent — it asks
 * about the session, not about "your experience".
 */
const EN: Copy = {
  dir: undefined,
  heading: "How was that?",
  up: "Good",
  down: "Not good",
  notNow: "Not now",
  noteInvite: "Want to tell us anything?",
  recorded: "Thanks — that is all we needed.",
  placeholder: "What worked, what didn't (optional)",
  send: "Send",
  sending: "Sending…",
  thanks: "Got it. Thank you.",
  failed: "That did not send. It is not important — carry on.",
};

const AR: Copy = {
  dir: "rtl",
  heading: "الجلسة دي كانت إزاي؟",
  up: "حلوة",
  down: "مش حلوة",
  notNow: "مش دلوقتي",
  noteInvite: "في حاجة تانية؟",
  recorded: "شكراً — كده تمام.",
  placeholder: "إيه اللي عجبك، وإيه اللي لأ؟ (اختياري)",
  send: "إرسال",
  sending: "جاري الإرسال…",
  thanks: "وصلت. شكراً!",
  failed: "مانفعش يتبعت. مش مهم — كمّل عادي.",
};

export function FeedbackPrompt({
  moment,
  rtl = false,
}: {
  /**
   * Which of the two natural ends is asking. It is the only thing this client
   * tells the server about the row — the sitting, the lesson and the course
   * are all resolved server-side from the student's own session
   * (`lib/feedback-queries.ts`), so nothing here can file feedback against
   * somebody else's lesson.
   */
  moment: FeedbackMoment;
  /** The subject's registered direction, passed down exactly as `ReportCard` takes it. */
  rtl?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);
  /**
   * The thumb she pressed, kept so the note's POST can carry it again.
   *
   * A ref rather than state because nothing renders from it, and carrying it
   * on the second request rather than relying on the first is what makes that
   * request complete on its own: the endpoint upserts on the sitting, so a
   * note that arrives after a rating POST that never landed still records both.
   */
  const ratingRef = useRef<"up" | "down" | null>(null);

  const c = rtl ? AR : EN;

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    // The cadence decision is the server's, asked at the instant the prompt
    // would appear rather than at whatever earlier instant the page rendered.
    // Any failure — offline, 500, a database that cannot answer — lands in the
    // `catch` and the prompt simply never exists, which is the correct
    // behaviour for the least important element on the screen.
    fetch(`/api/feedback?moment=${encodeURIComponent(moment)}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : { ask: false }))
      .then((j: { ask?: boolean }) => {
        if (alive.current) setPhase(j.ask === true ? "asking" : "gone");
      })
      .catch(() => {
        if (alive.current) setPhase("gone");
      });
    return () => {
      alive.current = false;
      controller.abort();
    };
  }, [moment]);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moment, ...body }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * The thumb goes to the server the moment it is pressed, and the note box
   * opens WITHOUT waiting for the response. The answer is already hers; making
   * her watch a spinner to find out whether we heard it would turn a one-tap
   * interaction into a two-step one.
   */
  function rate(rating: "up" | "down") {
    ratingRef.current = rating;
    setPhase("note");
    void post({ rating }).then((ok) => {
      if (alive.current && !ok) setFailed(true);
    });
  }

  async function sendNote() {
    if (busy) return;
    const text = note.trim();
    if (text === "") {
      // Nothing typed is not an error and not a second question: her rating
      // stands and the card closes itself.
      setPhase("done");
      return;
    }
    setBusy(true);
    const ok = await post({ rating: ratingRef.current, note: text });
    if (!alive.current) return;
    setBusy(false);
    setFailed(!ok);
    setPhase("done");
  }

  function dismiss() {
    setPhase("gone");
    // Fire and forget: she has already gone, and nothing about this screen
    // depends on the answer. The row is what stops her being asked again.
    void post({ dismiss: true });
  }

  if (phase === "checking" || phase === "gone") return null;

  return (
    <section
      dir={c.dir}
      aria-label={c.heading}
      className={cx(STROKE, "mt-6 rounded-[var(--play-radius)] bg-card-warm px-5 py-4 sticker-shadow-sm")}
    >
      {phase === "asking" ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <p className="font-display text-[1.15rem] font-bold text-ink">{c.heading}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Thumb glyph="👍" label={c.up} onPress={() => rate("up")} />
            <Thumb glyph="👎" label={c.down} onPress={() => rate("down")} />
            {/* Quiet on purpose — the tertiary button: no border, no fill.
                It is not an action she is being encouraged to take, it is
                the way out. Still a full 52px target. */}
            <button type="button" onClick={dismiss} className={BUTTON_TERTIARY}>
              {c.notNow}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "note" ? (
        <div>
          {/* Said before the box, not after it: the interaction is already
              finished and she is being told so before being offered more. */}
          <p className="text-[1rem] leading-relaxed text-ink-soft">
            <span className="font-bold text-ink">{c.recorded}</span> {c.noteInvite}
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={FEEDBACK_NOTE_MAX}
            rows={2}
            placeholder={c.placeholder}
            className={cx(STROKE, "mt-2 block w-full rounded-[var(--play-radius-sm)] bg-card px-3 py-2 font-read text-[1rem] leading-relaxed text-ink placeholder:text-ink-faint")}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void sendNote()}
              disabled={busy}
              className={BUTTON_SECONDARY}
            >
              {busy ? c.sending : c.send}
            </button>
            <button type="button" onClick={() => setPhase("done")} className={BUTTON_TERTIARY}>
              {c.notNow}
            </button>
          </div>
        </div>
      ) : null}

      {phase === "done" ? (
        // `aria-live` so a screen-reader user learns the card changed under
        // them without the focus having been moved to tell them.
        <p aria-live="polite" className="text-[1rem] leading-relaxed text-ink-soft">
          {failed ? c.failed : c.thanks}
        </p>
      ) : null}
    </section>
  );
}

/**
 * One of the two choices. They are identical in size, shape, border and
 * target — only the word and the glyph differ, so neither is the "right"
 * answer visually. Nothing about them is coloured: a green thumb and a red
 * thumb would tell a child which one we would like, which is how you get a
 * rating that measures politeness.
 */
function Thumb({
  glyph,
  label,
  onPress,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <button type="button" onClick={onPress} className={BUTTON_SECONDARY}>
      <span aria-hidden>{glyph}</span>
      <span>{label}</span>
    </button>
  );
}

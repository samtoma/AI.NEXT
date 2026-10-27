/**
 * The tutor message body, rendered — extracted from `ChatCore`'s `MessageRow`
 * so the console's replay can use **the student's own renderer** rather than a
 * second one that looks like it (ADR-0015 §3, FR-2304).
 *
 * **Why this is an extraction and not a copy.** A replay's whole claim is that
 * it shows what the student was shown. A parallel renderer in the console would
 * make that claim false the first time one of the two was edited, and it would
 * be false silently: the text would still be the student's text, laid out by
 * code the student never ran. So the paragraph, list, TeX and citation-chip
 * rendering lives here once, `MessageRow` calls it, the replay calls it, and
 * there is nothing to keep in sync.
 *
 * **Why the interactive blocks are slots.** A transcript block can be a
 * question card, a drawing widget, a check-in or a sealed passage — things that
 * are answered, not just read. Those are the student surface's, and they arrive
 * here as optional `slots` callbacks instead of imports, for two reasons:
 *
 *  1. it keeps this module free of `ChatQuestionCard` and the widget bundle, so
 *     importing it does not drag the answering machinery into a page whose
 *     contract is that it cannot write (FR-2305); and
 *  2. a slot left out renders a **descriptor** — "a question card was shown
 *     here" — rather than nothing. An interactive card silently vanishing from
 *     a replay would be a transcript with a hole in it that reads as a
 *     complete transcript, which is worse than an honest placeholder.
 *
 * This file deliberately has no `"use client"` directive and no hooks. Imported
 * from `ChatCore` it is part of the client graph; called from the console's
 * server-rendered replay it stays on the server and hands back `<TeX>` and
 * `<CitationChip>` elements, which are client components and cross the boundary
 * on their own. A server caller must pass no `resolveCite`/`onCiteClick` —
 * functions do not cross that boundary — and the chips then render as the
 * friendly labels with no hover card, which is exactly what a reconstruction
 * should offer.
 */

import type { ReactNode } from "react";

import { TeX } from "@/components/TeX";
import { STROKE, STROKE_SM, STROKE_WIDTH_SM, VERDICT_INK, cx } from "@/components/sticker";
import type { Block, Cite, Inline } from "@/lib/chat-parse";

import { CitationChip, type CiteInfo } from "./CitationChip";

/* --------------------------------------------------------------- bubbles */

/**
 * The bubble frame both speakers share (handoff, Chat bubbles): a 2.5px ink
 * outline, the 20px radius with ONE corner cut to the notch, and body copy at
 * the read scale in the reading face — a chat message is a passage, not a
 * label, so it is Cairo at 1rem rather than Baloo at 13px (review 2026-09-23,
 * F27). Leading is not set here: under Play the body carries the Latin 1.75.
 *
 * The notch is written with LOGICAL corner utilities so it mirrors with the
 * direction on its own: Nour's sits at the top-start corner, toward the
 * speaker; the student's at the bottom-start corner — the corner facing back
 * into the conversation from the end-aligned bubble ("the bottom far corner",
 * `18px 18px 18px 6px` LTR / `18px 18px 6px 18px` RTL in the published
 * ChatBubble spec). Token arbitrary values rather than `rounded-xl`: the Play
 * stylesheet re-rounds `.rounded-xl` on all four corners from an unlayered
 * rule, which is how the tail had gone missing.
 *
 * **The frame and the text take their direction from different places.** The
 * frame has no `dir`, so it inherits the conversation's and its notch mirrors
 * with the page. The text sits in an inner `dir="auto"` wrapper, so a message
 * still resolves its own direction from its first strong character, exactly as
 * it did when the attribute sat on the bubble itself. Both on one element was
 * wrong in RTL: `dir="auto"` skips descendants that carry their own `dir`, and
 * every paragraph the block renderer emits does, so Nour's bubble resolved to
 * LTR inside an Arabic lesson and cut its notch on the far corner.
 */
const BUBBLE_SHAPE = "px-4 py-3 text-[1rem] font-read";

/** Nour's frame, minus the fill — the say-row in `ChatCore` wears it too. */
export const TUTOR_BUBBLE_FRAME = cx(
  STROKE_WIDTH_SM,
  "rounded-[var(--play-radius)] rounded-ss-[var(--play-radius-notch)]",
  BUBBLE_SHAPE
);

/** Nour on white, resting on the small hard shadow. */
export const TUTOR_BUBBLE_FILL = "border-ink bg-card sticker-shadow-sm noor-bubble-tutor";

/**
 * The two bubbles a transcript is made of, extracted for the same reason the
 * block renderer was: the console's replay must be able to render the
 * student's chrome, not chrome that resembles it. These are the only bubbles
 * `MessageRow` renders — including `anim-pop`, which is part of how the
 * message arrived and therefore part of what is being reconstructed.
 */
export function StudentBubble({ children, lesson = false }: { children: ReactNode; lesson?: boolean }) {
  return (
    <div className="anim-pop flex justify-end">
      <div
        className={cx(
          lesson
            ? // guided pages handoff §2: the full 3px outline, 16px with a 4px notch at the
              // bottom-end, 11px 15px, Cairo 600 at 1.02rem, as wide as Nour's (64ch)
              cx(
                STROKE,
                "max-w-[var(--chat-bubble-max)] rounded-[var(--chat-radius-student)] rounded-ee-[var(--chat-notch-student)] px-[15px] py-[11px] font-read text-[1.02rem] font-semibold leading-[1.5]"
              )
            : cx(STROKE_SM, "max-w-[85%] rounded-[var(--play-radius)] rounded-es-[var(--play-radius-notch)]", BUBBLE_SHAPE),
          // the student's own turn is the sky playmate with its paired ink —
          // never ink: their own words are not the darkest thing on screen
          "bg-[var(--play-sky)] text-[color:var(--play-on-sky)] sticker-shadow-sm noor-bubble-student"
        )}
      >
        <div dir="auto" style={{ textAlign: "start" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

export function TutorBubble({
  children,
  error = false,
  style,
  lesson = false,
}: {
  children: ReactNode;
  error?: boolean;
  style?: React.CSSProperties;
  /**
   * The guided pages' bubble (handoff §2): the full 3px outline, 18px with the 6px notch at
   * top-start, 15px 18px padding, Cairo 1.05rem/1.7, 64ch wide, and `lesson-bubble`, under which
   * anything nested goes flat (globals.css: one shadow layer).
   */
  lesson?: boolean;
}) {
  return (
    <div className={cx("anim-pop flex justify-start", lesson && "min-w-0")} style={style}>
      <div
        className={cx(
          lesson
            ? cx(
                STROKE,
                "lesson-bubble min-w-0 max-w-[var(--chat-bubble-max)] rounded-[var(--chat-radius-bubble)] rounded-ss-[var(--play-radius-notch)] px-[18px] py-[15px] font-read text-[1.05rem] leading-[1.7]"
              )
            : cx("max-w-[94%]", TUTOR_BUBBLE_FRAME),
          // A failed turn greys out like a wrong answer does — the inactive
          // fill and border, muted AA text, no shadow — and is never red.
          error ? VERDICT_INK.wrong : cx(TUTOR_BUBBLE_FILL, "text-ink")
        )}
      >
        <div dir="auto" style={{ textAlign: "start" }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The interactive block types, each rendered by the surface that owns it. */
export type BlockSlots = {
  checkIn?: (key: number) => ReactNode;
  widget?: (b: Extract<Block, { t: "widget" }>, key: number) => ReactNode;
  question?: (b: Extract<Block, { t: "question" }>, key: number) => ReactNode;
  switchSubject?: (b: Extract<Block, { t: "switch_subject" }>, key: number) => ReactNode;
  passageRef?: (b: Extract<Block, { t: "passage_ref" }>, key: number) => ReactNode;
};

export type BlockRenderOptions = {
  /** Raw ids on citation chips instead of friendly labels. */
  debug?: boolean;
  /**
   * The lesson chat handoff: citations are not drawn mid-sentence (the surface prints them as a
   * plain source line under the bubble), and a closing question gets the flat Honey block.
   */
  lesson?: boolean;
  /** RTL/Arabic-script subject — friendly citation labels render in Arabic. */
  arabicUi?: boolean;
  resolveCite?: (c: Cite) => CiteInfo | null;
  onCiteClick?: (c: Cite) => void;
  slots?: BlockSlots;
};

/** Text and citation chips in one run, the only shape an inline can take. */
export function renderInlines(inlines: Inline[], o: BlockRenderOptions): ReactNode[] {
  return inlines.map((seg, s) =>
    seg.t === "text" ? (
      <TeX key={s} text={seg.v} />
    ) : o.lesson ? null : (
      <CitationChip
        key={s}
        cite={seg}
        friendly={!o.debug}
        arabic={!!o.arabicUi}
        resolve={o.resolveCite}
        onActivate={o.onCiteClick}
      />
    )
  );
}

/**
 * One parsed message, as a list of nodes.
 *
 * `highlight`, `finish` and `beat` render nothing here and always did: the
 * first two are side effects the surface consumes and the third is a pacing
 * marker that becomes time rather than ink.
 */
export function renderChatBlocks(blocks: Block[], o: BlockRenderOptions = {}): ReactNode[] {
  const out: ReactNode[] = [];
  // the last block that draws anything, if it is a paragraph — a candidate closing question
  const drawn = blocks.map((b, k) => [b, k] as const).filter(([b]) => !["highlight", "finish", "beat", "answer_submitted", "reveal_answer"].includes(b.t));
  const lastDrawn = drawn[drawn.length - 1];
  const lastPara = lastDrawn && lastDrawn[0].t === "para" ? lastDrawn[1] : -1;
  blocks.forEach((b, i) => {
    if (b.t === "highlight" || b.t === "finish" || b.t === "beat") return;
    // Socratic-probing directives (`507bb31`): never rendered — a replay
    // shows nothing where the student saw nothing. `answer_submitted` is
    // consumed once per completed message by ChatCore's send();
    // `reveal_answer` is no longer acted on at all (FR-3112) and is still
    // swallowed here so a model that emits it shows no protocol text.
    if (b.t === "answer_submitted" || b.t === "reveal_answer") return;

    // Each of these asks "is there a slot" and NOT "did the slot return
    // something". A surface that owns a block type owns its empty answer too:
    // `renderWidget` returning null is the student surface deliberately
    // rendering nothing for an unparseable payload (render-math-widget.tsx),
    // and falling back to a descriptor there would put a label on the screen
    // where the student correctly saw a gap.
    const s = o.slots;
    if (b.t === "check_in") {
      out.push(s?.checkIn ? s.checkIn(i) : <Descriptor key={i} what="a check-in was offered here" />);
      return;
    }
    if (b.t === "widget") {
      out.push(
        s?.widget ? s.widget(b, i) : <Descriptor key={i} what={`an interactive ${b.name} was shown here`} />
      );
      return;
    }
    if (b.t === "question") {
      out.push(
        s?.question ? s.question(b, i) : <Descriptor key={i} what={`question ${b.qid} was asked here`} />
      );
      return;
    }
    if (b.t === "switch_subject") {
      out.push(
        s?.switchSubject
          ? s.switchSubject(b, i)
          : <Descriptor key={i} what={`a handoff to ${b.subject} was offered here`} />
      );
      return;
    }
    if (b.t === "passage_ref") {
      out.push(
        s?.passageRef ? s.passageRef(b, i) : <Descriptor key={i} what={`passage ${b.id} was pinned here`} />
      );
      return;
    }
    if (b.t === "ask") {
      // FR-3502: the closing question, a Honey fill with its paired ink inside
      // the same bubble — never a second bubble, never a box with its own
      // border (one container level). 16px above it separates it from the
      // explanation.
      out.push(
        <div
          key={i}
          data-chunk-ask=""
          className={cx(
            "rounded-[var(--play-radius-sm)] bg-card-warm text-ink",
            // guided pages: the last chunk, 11px under the one before it, 13px 16px
            o.lesson ? "mt-[11px] px-4 py-[13px]" : "mt-4 mb-0.5 px-3 py-2.5"
          )}
        >
          {b.paras.map((inlines, k) => (
            <p key={k} dir="auto" className="tex-block my-1 first:mt-0 last:mb-0" style={{ textAlign: "start" }}>
              {renderInlines(inlines, o)}
            </p>
          ))}
        </div>
      );
      return;
    }
    if (b.t === "list") {
      out.push(
        <ul key={i} className="my-1.5 space-y-1 ps-1">
          {b.items.map((item, k) => (
            <li key={k} className="flex gap-1.5" dir="auto">
              <span className="mt-[1px] shrink-0 text-accent">·</span>
              <span className="tex-block min-w-0" style={{ textAlign: "start" }}>
                {renderInlines(item, o)}
              </span>
            </li>
          ))}
        </ul>
      );
      return;
    }
    // Lesson chat: the turn's closing question sits in the flat Honey block (handoff §3). Read
    // from the text — a final paragraph that ends in "?" — not marked by the tutor.
    const closingQuestion = o.lesson && i === lastPara && endsInQuestion(b.inlines);
    out.push(
      <p
        key={i}
        dir="auto"
        className={cx(
          "tex-block",
          // guided pages: 11px between chunks
          o.lesson ? "my-[11px] first:mt-0 last:mb-0" : "my-1.5 first:mt-0 last:mb-0",
          closingQuestion && "rounded-[var(--play-radius-sm)] bg-card-warm px-4 py-[13px]"
        )}
        style={{ textAlign: "start" }}
      >
        {renderInlines(b.inlines, o)}
      </p>
    );
  });
  return out;
}

/** The text of a paragraph's inlines ends in a question mark (citations aside). */
function endsInQuestion(inlines: Inline[]): boolean {
  const text = inlines
    .filter((x): x is Extract<Inline, { t: "text" }> => x.t === "text")
    .map((x) => x.v)
    .join("")
    .trim();
  return /[?؟]$/.test(text);
}

/**
 * What a reader sees where an interactive card stood and no slot filled it.
 *
 * Neutral, unmistakably not the card, and it says what was there. The colour is
 * a token (`ink-faint` on the ambient background) and carries no state: this is
 * a note about the transcript, not a warning about it.
 */
function Descriptor({ what }: { what: string; key?: number }) {
  return (
    <p className="my-1.5 rounded-[var(--play-radius-sm)] border-[length:var(--play-stroke-sm)] border-dashed border-[color:var(--play-inactive-border)] px-2 py-1 font-mono text-[0.72rem] uppercase tracking-[0.1em] text-ink-faint">
      {what}
    </p>
  );
}

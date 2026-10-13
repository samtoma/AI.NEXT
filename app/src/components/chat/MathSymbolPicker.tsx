"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  MATH_KEY_GROUPS,
  mathKey,
  pickerKeyIds,
  type MathKey,
} from "@/lib/math-keys";
import { STROKE, cx } from "@/components/sticker";

/**
 * The maths symbol picker (prototype, `feat/proto-math-symbol-keys`), built to the "Math symbol picker"
 * design handoff: a "∑ Symbols" pill inside the answer box's inline end (the handoff draws a bare ∑;
 * the pill and its label were asked for on top of it), and a card floating above it.
 *
 * At rest the pill is the only thing added to the answer row. The card sits OVER the chat (fixed to
 * the viewport: nothing resizes or moves): twelve keys — the student's two most recent, then the lesson's —
 * and "All symbols ›", which swaps in every key by group. A key inserts plain Unicode at the caret,
 * replaces a selection, and never takes focus, so the iPad keyboard stays up; the card stays open for
 * the next symbol and closes on an outside tap or Esc. Nothing is ever sent.
 *
 * Render it inside a `relative` wrapper around the input (the card anchors to that wrapper, and is
 * portalled to <body> so a clipping frame cannot cut it off); give the input `pe-32` while it shows, so
 * typed text never runs under the pill.
 * Maths reads left to right in any direction (Principle V): the card is `dir="ltr"`. Play tokens only
 * (Principle XII): white card with the ink stroke and `--play-shadow`, the pill in Honey (`card-warm`),
 * Honey key hover, the link blue for "All symbols"/"Back", `--play-text-dim` for names. No amber.
 */
export function MathSymbolPicker({
  lessonKeyIds,
  recents,
  onUse,
  field,
  value,
  onChange,
  disabled = false,
}: {
  /** the lesson's keys, most relevant first (`lessonKeyIds` in `lib/math-keys.ts`) */
  lessonKeyIds: readonly string[];
  /** the student's recent keys this session, most recent first */
  recents: readonly string[];
  /** a key was used: the caller moves it to the front of `recents` */
  onUse: (id: string) => void;
  field: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  /** the name of the key under the pointer, focus or finger */
  const [hint, setHint] = useState(NO_HINT);
  const pill = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  /** where the card sits: fixed to the viewport, so no `overflow: hidden` frame (a question card,
   *  the chat's scroll area) can clip it */
  const [place, setPlace] = useState<React.CSSProperties | null>(null);

  // Anchored ~12px above the field, aligned to its inline end; follows scrolling and resizing.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = pill.current?.parentElement; // the `relative` wrapper around the input
    if (!anchor) return;
    const update = () => {
      const r = anchor.getBoundingClientRect();
      const rtl = getComputedStyle(anchor).direction === "rtl";
      setPlace({
        bottom: window.innerHeight - r.top + 12,
        ...(rtl ? { left: r.left } : { right: window.innerWidth - r.right }),
      });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Closes on a tap outside the card and the pill, or on Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pill.current?.contains(t) && !card.current?.contains(t))
        setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    setAll(false); // reopening always starts on the default view
    setHint(NO_HINT);
  };

  /** Insert at the caret (replacing a selection), then put the caret `back` steps before the end. */
  const insert = (key: MathKey) => {
    const el = field.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + key.ins + value.slice(end));
    onUse(key.id);
    const caret = start + key.ins.length - key.back;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  const twelve = pickerKeyIds(recents, lessonKeyIds)
    .map(mathKey)
    .filter((k): k is MathKey => !!k);

  const key = (k: MathKey, height: string) => (
    <button
      key={k.id}
      type="button"
      aria-label={k.name}
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={() => insert(k)}
      // the name shows on hover and focus, and on press-and-hold where there is no hover (iPad)
      onPointerEnter={() => setHint(k.name)}
      onPointerDown={() => setHint(k.name)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHint(NO_HINT)}
      onFocus={() => setHint(k.name)}
      className={cx(
        height,
        // lesson chat handoff §4: flat Honey keys inside the popover, no outline, in a math serif
        "math-glyph min-w-10 rounded-[var(--play-radius-sm)] bg-card-warm text-[1.15rem] font-bold leading-none text-ink",
        "disabled:text-[color:var(--play-disabled-text)]",
      )}
    >
      {k.t}
    </button>
  );

  return (
    <>
      <button
        ref={pill}
        type="button"
        aria-label="Math symbols"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={toggle}
        className={cx(
          // Honey at rest, so the one new control in the answer row is findable
          "absolute end-2 top-1/2 flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-[var(--play-radius-pill)] bg-card-warm px-3.5 font-display text-[0.9rem] font-bold leading-none text-ink",
        )}
      >
        <span aria-hidden="true" className="text-[1.05rem]">
          ∑
        </span>
        <span aria-hidden="true">Symbols</span>
      </button>

      {open &&
        place &&
        createPortal(
          <div
            ref={card}
            dir="ltr"
            role="dialog"
            aria-label="Math symbols"
            style={place}
            className={cx(
              STROKE,
              // above the chat, below a modal (QuestionModal is z-50)
              // lesson chat handoff §4: 340px, 12px padding, the panel's one shared 3px shadow
              "math-picker-in fixed z-40 flex w-[340px] max-w-[calc(100vw-32px)] flex-col gap-2.5",
              "rounded-[var(--play-radius)] bg-card p-3 shadow-[var(--play-shadow-sm)]",
            )}
          >
            {all ? (
              <>
                <Footer
                  action="‹ Back"
                  onAction={() => setAll(false)}
                  hint={hint}
                />
                <div className="flex max-h-[196px] flex-col gap-2 overflow-y-auto">
                  {MATH_KEY_GROUPS.map((g) => (
                    <div key={g.id} role="group" aria-label={g.label}>
                      <div className="pb-1 font-mono text-[0.64rem] font-medium uppercase tracking-[0.1em] text-[color:var(--play-text-dim)]">
                        {g.label}
                      </div>
                      <div className="grid grid-cols-6 gap-1.5">
                        {g.keys
                          .map((id) => mathKey(id))
                          .filter((k): k is MathKey => !!k)
                          .map((k) => key(k, "h-11"))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div
                  role="group"
                  aria-label="Symbols for this lesson"
                  className="grid grid-cols-6 gap-1.5"
                >
                  {twelve.map((k) => key(k, "h-12"))}
                </div>
                <Footer
                  action="All symbols ›"
                  onAction={() => setAll(true)}
                  hint={hint}
                />
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** What the footer says until a key is pointed at or tapped (lesson chat handoff §4). */
const NO_HINT = "Tap a symbol";

/** Never take focus from the input: the iPad keyboard stays open and the selection survives. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** The card's footer (or, in "All symbols", its top row): a text action, and the hovered key's name. */
function Footer({
  action,
  onAction,
  hint,
}: {
  action: string;
  onAction: () => void;
  hint: string;
}) {
  return (
    <div className="flex h-10 items-center justify-between gap-2 px-1">
      <button
        type="button"
        onMouseDown={keepFocus}
        onClick={onAction}
        className="h-10 bg-transparent font-display text-[0.88rem] font-bold leading-none text-[color:var(--play-text-link)] underline decoration-[color:var(--play-disabled-border)] underline-offset-[5px]"
      >
        {action}
      </button>
      <span
        aria-hidden="true"
        className="truncate font-display text-[0.85rem] font-semibold text-[color:var(--play-text-dim)]"
      >
        {hint}
      </span>
    </div>
  );
}

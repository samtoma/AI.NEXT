/**
 * THE HANDOFF FILTER — no `{{switch_subject:…}}` card to a subject the student
 * may not open ever reaches her (Samuel's answer 17, decision 38, 2026-09-26;
 * spec 003 FR-4006).
 *
 * The lesson prompt already offers a handoff only to a subject with a course
 * she may see (`crossSubjectRule`, `lib/lesson.ts`). That is an instruction,
 * and a model can ignore an instruction: an American student's tutor that
 * still wrote `{{switch_subject:social}}` would hand her a card that opens a
 * 404. This is the server-side half — defence in depth, not the rule. The
 * `/api/ask` route runs the model's text through it before a byte reaches the
 * client, and the ledger records the filtered text, so the replay shows what
 * she was shown.
 *
 * STREAMING. The reply arrives in arbitrary chunks, and a directive can be
 * split across any of them. The filter holds back only a tail that could still
 * become a handoff directive — from a trailing `{{` whose text so far is a
 * prefix of `{{switch_subject:<key>}}`, with the line break before it — and
 * releases everything else at once, so ordinary text and every other directive
 * stream exactly as before. A handoff to an open subject passes through
 * untouched; one to a closed subject is removed with the line break it stood
 * on, so no empty line is left where the card would have been.
 *
 * Pure, and the same function over the whole text (`stripClosedHandoffs`) and
 * over its chunks (`makeHandoffFilter`), so the stream and the ledger agree.
 */

const OPEN = "{{switch_subject:";
/**
 * A complete handoff directive, with the line break in front of it (the
 * directive stands alone on its line) and any blank space after it — so a
 * removed card leaves no empty line where it stood.
 */
const DIRECTIVE = /(?:\r?\n[ \t]*)?\{\{switch_subject:([A-Za-z0-9_-]{1,40})\}\}[ \t]*/g;
/** The longest held-back tail: `{{switch_subject:` + a 40-character key + `}`. */
const MAX_HELD = OPEN.length + 41;

/** Remove every handoff to a subject not in `open` from a complete text. */
export function stripClosedHandoffs(text: string, open: ReadonlySet<string>): string {
  return text.replace(DIRECTIVE, (whole: string, key: string) => (open.has(key) ? whole : ""));
}

/**
 * Could `tail` (which starts with `{`) still grow into a handoff directive?
 * `{`, `{{`, `{{swi`, `{{switch_subject:soc`, `{{switch_subject:social}` — yes;
 * `{{show_question:` or `{{beat}}` — no, and they are released at once.
 */
function couldBecomeHandoff(tail: string): boolean {
  if (tail.length > MAX_HELD) return false;
  if (OPEN.startsWith(tail)) return true;
  return new RegExp(`^\\{\\{switch_subject:[A-Za-z0-9_-]{0,40}\\}?$`).test(tail);
}

/**
 * The streaming form. `push(chunk)` returns the text safe to send now; `end()`
 * returns whatever was held back when the reply is complete.
 */
export function makeHandoffFilter(open: ReadonlySet<string>): {
  push(chunk: string): string;
  end(): string;
  /** how many handoff directives were removed so far (for an operator log line) */
  readonly removed: number;
} {
  let pending = "";
  let removed = 0;
  const strip = (s: string) =>
    s.replace(DIRECTIVE, (whole: string, key: string) => {
      if (open.has(key)) return whole;
      removed += 1;
      return "";
    });
  return {
    push(chunk: string): string {
      pending = strip(pending + chunk);
      // hold back from the last `{` that could still open a handoff directive
      let cut = pending.length;
      for (let i = pending.lastIndexOf("{"); i >= 0; i = pending.lastIndexOf("{", i - 1)) {
        if (pending.length - i > MAX_HELD) break;
        if (couldBecomeHandoff(pending.slice(i))) cut = i;
        if (i === 0) break;
      }
      // …and the line break in front of it, which goes with it if it is
      // removed. A text that simply ENDS in a line break holds that break too:
      // the next chunk may open a handoff on the new line.
      let back = cut;
      while (back > 0 && (pending[back - 1] === " " || pending[back - 1] === "\t")) back -= 1;
      if (back > 0 && pending[back - 1] === "\n") {
        back -= 1;
        if (back > 0 && pending[back - 1] === "\r") back -= 1;
        cut = back;
      }
      const out = pending.slice(0, cut);
      pending = pending.slice(cut);
      return out;
    },
    end(): string {
      const out = strip(pending);
      pending = "";
      return out;
    },
    get removed() {
      return removed;
    },
  };
}

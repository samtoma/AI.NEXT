/**
 * Homework ask — the DECIDABLE half (spec 004, ADR-0025 — Proposed).
 *
 * No imports, on purpose, like `session-rules.ts`: these are the rules the
 * routes and the page apply, and every one of them is something a test should
 * pin rather than something to watch in production — above all the gap rule
 * (FR-3606), because a confidently-filled unreadable digit is the one failure
 * this feature exists to never produce.
 */

/** The literal token an unreadable span is stored and shown as (FR-3606). */
export const GAP = "▒▒";

/** What Noor asks for a gap the reader gave no wording for. */
export const DEFAULT_GAP_ASK = "What is that part?";

/** More than this in one upload is a textbook page, not homework. */
export const MAX_QUESTIONS = 12;
export const MAX_QUESTION_CHARS = 2000;
export const MAX_TYPED_CHARS = 4000;

export type HomeworkSubject = "maths" | "other";
export type HomeworkMode = "walk" | "check";
export type ItemStatus = "open" | "active" | "done";

export type Gap = { ask: string; answer: string | null };

/** One question as the split step returns it, after validation. */
export type SplitQuestion = {
  label: string | null;
  text: string;
  subject: HomeworkSubject;
  objective: string | null;
  gaps: Gap[];
};

export type SplitResult =
  | { kind: "questions"; questions: SplitQuestion[] }
  | { kind: "unreadable" };

const countGaps = (text: string) => text.split(GAP).length - 1;

/**
 * The split reply, validated. `null` means the reply was not usable at all —
 * the caller records a failed read, never a guess.
 *
 * What it enforces, each because the model is not trusted to:
 *  - the objective must be one this student can SEE (`visibleLoIds`, the
 *    course gate's answer) — anything else is dropped, never shown (FR-3605);
 *  - every ▒▒ in the text has exactly one gap entry, in order: a missing entry
 *    gets the default ask, a surplus entry is discarded, so the input count on
 *    the page always equals the marks in the text;
 *  - a question classified `other` keeps no objective;
 *  - caps on count and length, so a pasted chapter cannot become a prompt.
 */
export function parseSplitReply(
  raw: string,
  visibleLoIds: ReadonlySet<string>
): SplitResult | null {
  const json = extractJsonObject(raw);
  if (!json) return null;
  let j: unknown;
  try {
    j = JSON.parse(json);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (o.unreadable === true) return { kind: "unreadable" };
  if (!Array.isArray(o.questions)) return null;

  const questions: SplitQuestion[] = [];
  for (const q of o.questions.slice(0, MAX_QUESTIONS)) {
    if (!q || typeof q !== "object") continue;
    const r = q as Record<string, unknown>;
    const text = typeof r.text === "string" ? r.text.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!text) continue;
    const subject: HomeworkSubject = r.subject === "other" ? "other" : "maths";
    const objective =
      subject === "maths" && typeof r.objective === "string" && visibleLoIds.has(r.objective)
        ? r.objective
        : null;
    const label =
      typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 24) : null;
    const asks = Array.isArray(r.gaps) ? r.gaps : [];
    const gaps: Gap[] = Array.from({ length: countGaps(text) }, (_, k) => {
      const a = asks[k];
      const ask =
        typeof a === "string" && a.trim()
          ? a.trim().slice(0, 120)
          : a && typeof a === "object" && typeof (a as { ask?: unknown }).ask === "string"
            ? String((a as { ask: string }).ask).trim().slice(0, 120) || DEFAULT_GAP_ASK
            : DEFAULT_GAP_ASK;
      return { ask, answer: null };
    });
    questions.push({ label, text, subject, objective, gaps });
  }
  if (questions.length === 0) return { kind: "unreadable" };
  return { kind: "questions", questions };
}

/** The first balanced `{…}` in a reply that may be fenced or prefixed. */
export function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return raw.slice(start, i + 1);
  }
  return null;
}

/** Every gap has a non-empty answer — the two choices unlock on this (FR-3606). */
export function gapsComplete(gaps: readonly Gap[]): boolean {
  return gaps.every((g) => g.answer != null && g.answer.trim() !== "");
}

/**
 * The question as Noor teaches from it: each ▒▒ replaced by the student's
 * answer for it, in order. An unanswered gap stays ▒▒ — the tutor is told
 * what that token means and never fills it.
 */
export function fillGaps(text: string, gaps: readonly Gap[]): string {
  let k = 0;
  return text.replace(/▒▒/g, () => {
    const a = gaps[k++]?.answer?.trim();
    return a ? a : GAP;
  });
}

/**
 * Accept new gap answers from a request: same count as the stored gaps,
 * strings only, trimmed and capped. Anything else is refused (null).
 */
export function applyGapAnswers(gaps: readonly Gap[], answers: unknown): Gap[] | null {
  if (!Array.isArray(answers) || answers.length !== gaps.length) return null;
  const out: Gap[] = [];
  for (let k = 0; k < gaps.length; k++) {
    const a = answers[k];
    if (a != null && typeof a !== "string") return null;
    const v = typeof a === "string" ? a.trim().slice(0, 80) : "";
    out.push({ ask: gaps[k].ask, answer: v || null });
  }
  return out;
}

/**
 * The student edited the question text ("Edit the text", FR-3607). Gaps are
 * re-derived from the edited text: answers are kept, by position, for the
 * marks that remain; a mark the student typed over is simply gone.
 */
export function regapEditedText(
  text: string,
  gaps: readonly Gap[]
): { text: string; gaps: Gap[] } | null {
  const t = text.trim().slice(0, MAX_QUESTION_CHARS);
  if (!t) return null;
  const n = countGaps(t);
  return {
    text: t,
    gaps: Array.from({ length: n }, (_, k) => gaps[k] ?? { ask: DEFAULT_GAP_ASK, answer: null }),
  };
}

/** What the page offers once a question is done (FR-3611). */
export function afterDone(
  items: readonly { id: number; status: ItemStatus; subject: HomeworkSubject }[],
  doneId: number
): { another: boolean } {
  return {
    another: items.some((i) => i.id !== doneId && i.status !== "done" && i.subject === "maths"),
  };
}

/** Noor's opening line for an ask holding several questions (FR-3608). */
export function pickerLine(count: number): string {
  return `I found ${count} questions. Which one do you want to start with?`;
}

export function coerceMode(raw: unknown): HomeworkMode | null {
  return raw === "walk" || raw === "check" ? raw : null;
}

export function coerceId(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

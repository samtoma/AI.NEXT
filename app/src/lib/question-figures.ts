/**
 * A QUESTION'S OWN FIGURE, ON ITS CARD (consistency review 2026-09-27, A3).
 *
 * The Grade 10 book's questions refer to their figures, and the pipeline
 * stores a figure for a question as a `visuals` row carrying `question_id`.
 * The question cards used to show none of them — only the tutor's drawings
 * reached a student — and 73 live stems still read "[figure]" where the
 * book's picture stood. Two rules, both here so every card applies the same:
 *
 *  - the card shows the question's own figures (the readers attach their
 *    ids as `figures`; the card renders each through the gated
 *    `/api/visuals?id=` like any stored figure);
 *  - the literal "[figure]" is never printed. Where the figure exists it is
 *    shown on the card instead; where it does not, the placeholder renders as
 *    nothing and the server logs the question (`noteFigureless`) — the
 *    pipeline holds such questions back from going live, and this is the
 *    backstop for any that got through.
 *
 * Pure, apart from the log line.
 */

/** "[figure]" in a stem, with the space around it. */
const PLACEHOLDER = /\s*\[figure\]\s*/gi;

/** Does this stem still carry the book's "[figure]" placeholder? */
export function hasFigurePlaceholder(stem: string): boolean {
  return /\[figure\]/i.test(stem);
}

/** The stem a student sees: the placeholder removed, the words around it kept apart. */
export function displayStem(stem: string): string {
  if (!hasFigurePlaceholder(stem)) return stem;
  return stem.replace(PLACEHOLDER, " ").replace(/ {2,}/g, " ").trim();
}

const noted = new Set<string>();

/**
 * Log, once per process and question, a question whose stem says "[figure]"
 * and that has no figure to show. Called by the readers that hand questions
 * to a card; the id only — never a student.
 */
export function noteFigureless(q: { id: string; stem: string; figures?: readonly string[] }): void {
  if (!hasFigurePlaceholder(q.stem) || (q.figures?.length ?? 0) > 0 || noted.has(q.id)) return;
  noted.add(q.id);
  console.warn(`[figures] ${q.id} says "[figure]" and has no figure — shown without it`);
}

/** Visual rows → each question's own figure ids, in the order given. */
export function figuresByQuestion(
  rows: readonly { id: string; question_id?: string | null; questionId?: string | null }[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const q = r.question_id ?? r.questionId ?? null;
    if (!q) continue;
    out.set(q, [...(out.get(q) ?? []), r.id]);
  }
  return out;
}

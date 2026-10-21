/**
 * BOOK WIDGETS' METHOD HINTS (services/extraction/book_widgets.py, Tamer
 * 2026-10-21). A widget question built from one of the book's own exercises
 * may carry `choices.hints` — [{predicate, step, text}] — for the predicates
 * no misconception names: one or two sentences taken from step `step` of the
 * canonical solution, which point at the method and never give the answer.
 * The blind verifier confirmed each one; an unconfirmed hint is held under
 * `choices.pending_hints`, which nothing here reads.
 *
 * A misconception's refutation always wins: the hint is only for the wrong
 * answer the question cannot otherwise explain.
 */
export interface WidgetHint {
  predicate: string;
  step: number;
  text: string;
}

export function widgetHint(
  choices: unknown,
  predicate: string | null | undefined,
  misconceptionId: string | null
): WidgetHint | null {
  if (misconceptionId || !predicate || !choices || typeof choices !== "object") return null;
  const hints = (choices as { hints?: unknown }).hints;
  if (!Array.isArray(hints)) return null;
  const h = hints.find(
    (x): x is WidgetHint =>
      !!x &&
      typeof x === "object" &&
      (x as WidgetHint).predicate === predicate &&
      typeof (x as WidgetHint).text === "string" &&
      (x as WidgetHint).text.trim() !== ""
  );
  return h ? { predicate: h.predicate, step: Number(h.step) || 0, text: h.text } : null;
}

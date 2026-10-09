/**
 * Inline text with $…$ maths and minimal markdown (**bold**, *emphasis*) →
 * HTML. Pure, so it can be tested without KaTeX or a DOM.
 *
 * The maths is lifted out to placeholders FIRST and the markdown runs over the
 * whole string, so a bold run may contain maths: "**What do you get for $a$?**"
 * renders as one bold run. Splitting on the maths first — what this replaced —
 * left one "**" in each half, and the student saw both as literal asterisks.
 */

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Private-use delimiters: never in model text, never touched by escaping. */
const OPEN = "";
const CLOSE = "";

export function renderInlineMarkdown(
  text: string,
  renderMath: (tex: string) => string
): string {
  // Defensive: never crash on a missing/non-string field (e.g. a social
  // claim-step has no text_md). Render nothing rather than throw.
  if (typeof text !== "string" || text.length === 0) return "";
  const maths: string[] = [];
  // $...$ non-greedy, no escaped-dollar handling needed for this corpus
  const lifted = text.replace(/\$[^$]+\$/g, (m) => {
    maths.push(m);
    return `${OPEN}${maths.length - 1}${CLOSE}`;
  });
  // Emphasis requires the asterisks to hug non-space text (common markdown
  // rule), so multiplication like "3 * 4" stays literal.
  const html = escapeHtml(lifted)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/g, "<em>$1</em>");
  return html.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (_, i) => {
    const m = maths[Number(i)];
    return renderMath(m.slice(1, -1));
  });
}

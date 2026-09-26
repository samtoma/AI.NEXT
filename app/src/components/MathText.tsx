import { TeX } from "@/components/TeX";
import { hasMath } from "@/lib/math-text";

/**
 * A label that may carry inline `$...$` maths — an objective label on the
 * check-in, the subject home, the progress page or the skill map (backlog
 * #37). With maths, it goes through the app's one renderer (`<TeX>`, lazily
 * loaded, so a surface whose labels have none — every Prep-3 surface — never
 * fetches KaTeX). Without, it is the plain text it always was: the same
 * node, byte for byte, as `{text}` rendered before.
 *
 * Not a client component itself, so a server component can use it; `<TeX>`
 * is the client boundary.
 *
 * Maths reads left to right in any direction (constitution V): `globals.css`
 * sets `direction: ltr` on every `.katex` node under the Play design, so the
 * formula runs left to right and the words around it keep the surface's
 * direction.
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  if (!hasMath(text)) return className ? <span className={className}>{text}</span> : <>{text}</>;
  return <TeX text={text} className={className} />;
}

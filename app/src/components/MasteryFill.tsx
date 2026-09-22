import { MASTERY_LEGEND, masteryPhrase } from "@/lib/mastery";

/**
 * The 4-segment fill — the skill map's ONLY progress vocabulary.
 *
 * FOUR segments off a FIVE-step ramp. Stage 0 lights none; stage n lights n,
 * and segment i takes `MASTERY_LEGEND[i + 1]`. The off-by-one is the bug this
 * component exists to stop recurring: indexing the fill by the stage makes
 * "just started" wear "familiar"'s colour, and rendering five segments makes
 * an untouched topic look one step ahead of itself.
 *
 * Shared by the skill map's cards and the check-in card, deliberately: the
 * check-in used to carry its own copy of this loop, and the design review
 * caught that copy drawing FIVE segments coloured by stage index — so stage
 * 0\u2019s not-started grey painted the first "filled" segment and the unfilled
 * tail painted the same grey. Two greys, two meanings, and stage 3 of 4 read
 * as half done. One component is how that stops recurring.
 *
 * Every segment carries an ink outline, lit or not, so lit-vs-unlit survives
 * greyscale and low vision as a fill-vs-empty difference rather than a hue
 * one — the lit bands sit ~1.02:1 apart from each other, well under the 3:1
 * floor for graphical objects, and colour alone cannot be the carrier. The
 * `aria-label` states the stage in words for the screen-reader path. It never
 * states a percentage: the build spec's ramp is "fill plus one plain word",
 * and there is deliberately nowhere in this component to put a number.
 */
export function MasteryFill({
  stage,
  height = 6,
  stroke = 1.5,
  gap = 3,
  className = "",
}: {
  stage: 0 | 1 | 2 | 3 | 4;
  height?: number;
  /** outline weight — scales with the bar, never with the viewport */
  stroke?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <div
      role="img"
      aria-label={masteryPhrase(stage)}
      className={`flex ${className}`}
      style={{ gap }}
    >
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="flex-1 rounded-full"
          style={{
            height,
            border: `${stroke}px solid var(--ink)`,
            background:
              i < stage ? MASTERY_LEGEND[i + 1].hex : "var(--mastery-0)",
          }}
        />
      ))}
    </div>
  );
}

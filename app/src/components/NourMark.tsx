/**
 * The Nour friend mark (design handoff: reference/nour-friend.svg).
 *
 * An amber head rotated -13° over an indigo body. Three rules from the handoff
 * are not negotiable and are enforced by this component existing at all rather
 * than by an inline SVG copied around the tree:
 *
 *   · never a facial expression — the mark is a presence, not a character;
 *   · never recoloured — no subject tinting, no state colouring, no gradients;
 *   · never a drop shadow.
 *
 * The body colour is the one thing that varies, and only between the two
 * grounds it is allowed to sit on: ink on light, paper on the indigo contrast
 * surface. That is a legibility swap, not a recolour.
 */
export function NourMark({
  className = "h-8 w-8",
  onDark = false,
}: {
  className?: string;
  onDark?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Nour"
      focusable="false"
    >
      <path
        d="M37.5 8 C42 8 45 12 45 17.5 C45 23 42 26.5 37.5 26.5 C33 26.5 30 23 30 17.5 C30 12 33 8 37.5 8 Z"
        fill="#F0A22F"
        transform="rotate(-13 37.5 17.5)"
      />
      <path
        d="M19 55.5 C18 45 21 35.5 28 32.5 C34 30.3 41 31 45 34.5 C49 38 50 44.5 49 50 Z"
        fill={onDark ? "#F2F1F7" : "#1E2450"}
      />
    </svg>
  );
}

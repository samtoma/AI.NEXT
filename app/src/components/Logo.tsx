/**
 * AI.Next brand mark — an ascending path of connected nodes on a teal badge:
 * the curriculum "data spine" (ADR-0001) rendered as a learning journey through
 * a knowledge graph, with a gold "goal/next" node. Pairs with the AI.Next wordmark.
 * Same artwork lives in app/src/app/icon.svg (favicon) and public/logo.svg (lockup).
 */
export function Logo({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      role="img"
      aria-label="AI.Next"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="7.5" fill="#16665c" />
      <path
        d="M9.5 22.5 16 16l7-6.2"
        stroke="#f3eee1"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M16 16l5.8 5.2"
        stroke="#f3eee1"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="9.5" cy="22.5" r="2.2" fill="#f3eee1" />
      <circle cx="16" cy="16" r="2.6" fill="#f3eee1" />
      <circle cx="21.8" cy="21.2" r="1.8" fill="#f3eee1" opacity="0.8" />
      <circle cx="23" cy="9.5" r="3" fill="#e8c063" />
    </svg>
  );
}

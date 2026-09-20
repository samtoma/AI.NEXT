"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/spine", label: "Evidence Walk" },
  { href: "/student", label: "Student Loop" },
  { href: "/gallery", label: "Gallery" },
  { href: "/pipeline", label: "Pipeline" },
];

/**
 * On the comparison build the student is the audience, not an investor: the
 * two surfaces she actually uses come first and are named in her words, and
 * "Where you stand" has to be reachable — it was built in Phase 8 with no way
 * in from the shell, which is the same as not having been built.
 */
/**
 * On the comparison build the student is the audience, and the nav is the two
 * surfaces she actually uses.
 *
 * It used to carry "Evidence Walk", "Content" and "Pipeline" beside "Study" —
 * a graph explorer, a content review queue and an extraction pipeline, offered
 * to a fourteen-year-old in the same row as her lesson (#10, #11, #12). They
 * are ours, not hers, and they are gone from here.
 *
 * `/spine` is still reachable — the lesson report ends with "See it on the
 * graph →" and #15 asks for more of it. What was wrong was the tab, and its
 * investor-facing name.
 */
const MVP1_LINKS = [
  { href: "/student", label: "Study" },
  { href: "/dashboard", label: "Where you stand" },
];

/** Appended only where the internal surfaces are switched on (lib/env.ts). */
const INTERNAL_LINKS = [
  { href: "/spine", label: "Evidence Walk" },
  { href: "/admin/content", label: "Content" },
  { href: "/pipeline", label: "Pipeline" },
];

export function NavLinks({
  mvp1 = false,
  internal = true,
}: {
  mvp1?: boolean;
  internal?: boolean;
}) {
  const pathname = usePathname();
  const links = mvp1
    ? internal
      ? [...MVP1_LINKS, ...INTERNAL_LINKS]
      : MVP1_LINKS
    : LINKS;
  return (
    <nav className="flex items-center gap-1">
      {links.map(({ href, label }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-3.5 text-[13px] font-medium transition-colors duration-200 ${
              mvp1
                ? "flex min-h-[44px] items-center py-0"
                : "py-1.5"
            } ${
              active
                ? "bg-ink text-paper"
                : "text-ink-soft hover:bg-line-soft hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

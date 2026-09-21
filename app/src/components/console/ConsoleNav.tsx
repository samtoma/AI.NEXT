"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console's one row of links.
 *
 * It is handed the links the server already decided this operator holds roles
 * for (`navFor(roles)` in `layout.console.tsx`). **That is not the
 * authorisation** (FR-2107) — every page re-checks through the seam and would
 * refuse a typed URL with this component deleted. What it buys is a shell that
 * does not lie: offering "Cost" to somebody who will be refused it is a claim
 * about their access that the next click contradicts.
 *
 * Client-only for `usePathname`, which is the whole reason it is separate from
 * the layout.
 */
export function ConsoleNav({
  links,
}: {
  links: readonly { href: string; label: string }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 ${
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

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
 *
 * **Groups are a label, not a menu.** A link carrying `group` gets that word
 * printed once, before the first link that carries it — so "Monitor" appears
 * ahead of Security and Overviews and nothing collapses, hides or nests. A
 * dropdown would put a console surface one interaction further away for no
 * gain, and the polish budget belongs to the student PWA.
 */
export function ConsoleNav({
  links,
}: {
  links: readonly { href: string; label: string; group?: string | null }[];
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap items-center gap-1">
      {links.map(({ href, label, group }, i) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        // Derived from the PREVIOUS link rather than from a cursor mutated as
        // the list is mapped: reassigning across a render is what
        // react-hooks/immutability forbids, and the same answer is one lookup
        // away. The heading prints once, before the first link of its group.
        const mine = group ?? null;
        const previous = i > 0 ? links[i - 1]!.group ?? null : null;
        const heading = mine !== null && mine !== previous ? mine : null;
        return (
          <span key={href} className="flex items-center gap-1">
            {heading ? (
              <span className="ms-2 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                {heading}
              </span>
            ) : null}
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={`ds-control-quiet rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 ${
                active
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-line-soft hover:text-ink"
              }`}
            >
              {label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

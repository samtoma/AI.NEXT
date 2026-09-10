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
const MVP1_LINKS = [
  { href: "/student", label: "Study" },
  { href: "/dashboard", label: "Where you stand" },
  { href: "/spine", label: "Evidence Walk" },
  { href: "/pipeline", label: "Pipeline" },
];

export function NavLinks({ mvp1 = false }: { mvp1?: boolean }) {
  const pathname = usePathname();
  const links = mvp1 ? MVP1_LINKS : LINKS;
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

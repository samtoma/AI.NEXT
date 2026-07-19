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

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {LINKS.map(({ href, label }) => {
        const active =
          href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-200 ${
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

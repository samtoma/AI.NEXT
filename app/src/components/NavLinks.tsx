"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The investor-preview nav. "Gallery" and "Pipeline" are no longer here
 * because those routes are no longer in this build at all (ADR-0014): they are
 * console surfaces now, reached on the console's own port and behind
 * `evidence-access`. A link that 404s is worse than a link that is missing.
 */
const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/spine", label: "Evidence Walk" },
  { href: "/student", label: "Student Loop" },
];

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

/**
 * The internal links are GONE from this build, not hidden in it (ADR-0014).
 *
 * "Evidence Walk", "Content" and "Pipeline" used to be appended here wherever
 * `AINEXT_INTERNAL_SURFACES` was on. Two of those routes no longer exist in
 * this build at all — they are `page.console.tsx` files that only the console
 * build compiles — so a link to them would be a link to a 404. `/spine` stays a
 * student surface (FR-2206) and is still reachable from the lesson report; what
 * #12 reported was the tab, and the tab is still gone.
 */

/**
 * The shell's one row — and, since P1, the place the sign-in state is visible.
 *
 * **Anonymous hides the student links.** Not because hiding is a security
 * boundary (it is not, and `proxy.ts` says so at length — every page and route
 * re-checks the principal server-side), but because offering "Study" to
 * somebody who will be bounced to `/signin` the moment they tap it is a lie
 * the shell tells about its own state. A signed-out visitor gets the two doors
 * that work.
 */
export function NavLinks({
  mvp1 = false,
  signedIn = false,
  studentName = null,
}: {
  mvp1?: boolean;
  signedIn?: boolean;
  studentName?: string | null;
}) {
  const pathname = usePathname();

  // Signed out: nothing that needs a principal. `/spine` drops out with the
  // student links, because it colours the graph by ONE student's mastery and
  // redirects a signed-out visitor straight back to `/signin`.
  const links = signedIn ? (mvp1 ? MVP1_LINKS : LINKS) : [];

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
              mvp1 ? "flex min-h-[44px] items-center py-0" : "py-1.5"
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

      {signedIn ? (
        <AccountMenu name={studentName ?? "You"} />
      ) : (
        <SignedOutActions pathname={pathname} />
      )}
    </nav>
  );
}

/** The two doors a signed-out visitor has, and no third one. */
function SignedOutActions({ pathname }: { pathname: string }) {
  // Already on an auth screen? Then the shell offers nothing: the page itself
  // is the action, and a second "Sign in" in the header is noise.
  if (
    pathname.startsWith("/signin") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password")
  ) {
    return null;
  }

  return (
    <div className="ms-2 flex items-center gap-2">
      <Link
        href="/signin"
        className="flex min-h-[44px] items-center rounded-full px-3.5 text-[13px] font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
      >
        Sign in
      </Link>
      <Link
        href="/signup"
        className="play-pressable flex min-h-[44px] items-center rounded-full border-[3px] border-ink px-4 text-[13px] font-bold sticker-shadow-sm"
        style={{
          background: "var(--noor-action, #f0a22f)",
          color: "var(--noor-on-action, #241f3d)",
        }}
      >
        Create account
      </Link>
    </div>
  );
}

/**
 * Name, and the way out.
 *
 * Sign-out posts to `/api/auth/logout` and then does a **full navigation**:
 * the response clears both cookies, and a soft navigation can render the next
 * screen from a payload produced while they still existed — a student who
 * signed out and still sees her name would be right not to trust it again.
 * The endpoint always answers 204, so there is no failure branch to show; a
 * transport error still lands on `/signin`, which is where "signed out" looks
 * the same either way.
 */
function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* 204 either way — the cookies are cleared or the session is unreachable */
    }
    window.location.assign("/signin");
  }

  const first = name.split(" ")[0] || name;

  return (
    <div className="relative ms-2" ref={wrap}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[44px] items-center gap-1.5 rounded-full border-[3px] border-ink bg-card px-3.5 text-[13px] font-bold text-ink"
      >
        {first}
        <span aria-hidden className="text-[10px]">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 top-[calc(100%+8px)] z-30 w-56 rounded-[20px] border-[3px] border-ink bg-card p-2 sticker-shadow"
        >
          <p className="px-3 py-2 text-[13px] text-ink-soft">
            Signed in as{" "}
            <strong className="font-semibold text-ink">{name}</strong>
          </p>
          {/* The account menu is the only door to `/settings`, and there is no
              tab for it on purpose: settings are somewhere you go once, not a
              destination competing with "Study" in a fourteen-year-old's nav
              (#10/#11/#12 — the tabs that were removed for exactly that). A
              plain link, not a client-side fetch: the page is a server
              component and the setting on it changes the document element. */}
          <Link
            href="/settings"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="play-pressable mt-1 flex min-h-[52px] w-full items-center rounded-[14px] border-[3px] border-ink bg-card px-3 text-start font-display text-[1rem] font-bold text-ink"
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={busy}
            className="play-pressable mt-1 flex min-h-[52px] w-full items-center rounded-[14px] border-[3px] border-ink bg-card px-3 text-start font-display text-[1rem] font-bold text-ink"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

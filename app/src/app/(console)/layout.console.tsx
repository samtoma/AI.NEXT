import Link from "next/link";
import { redirect } from "next/navigation";

import { NoorMark } from "@/components/NoorMark";
import { ConsoleNav } from "@/components/console/ConsoleNav";
import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { consoleShellAccess } from "@/lib/console-auth";
import { getOperatorCard } from "@/lib/console-queries";
import { navFor } from "@/lib/console-routes";
import { ENVIRONMENT } from "@/lib/env";

/**
 * The console shell — the one layout every operator surface sits inside.
 *
 * **It guards before it renders anything** (FR-2106, FR-2202). The shell's own
 * requirement is "an operator, any role", which is the row
 * contracts/authorization.md gives the shell, the profile and the own-sessions
 * list. Each page then re-checks its own role through the same seam, because
 * this layout cannot know which page it is wrapping and a layout that guessed
 * would be a second authorisation rule.
 *
 * **401 redirects, 403 renders.** An unauthenticated visitor is sent to
 * `/signin` before any console data is fetched, let alone rendered
 * (contracts/authorization.md's last row). A signed-in non-operator gets a 403
 * page *instead of* the shell — not the shell with an error in the middle of
 * it: the header would otherwise announce the console's existence and its
 * navigation to somebody who has just been refused it.
 *
 * **The chrome is denser than the student product and uses the same tokens**
 * (constitution XII, FR-2209). No literal colours, every coloured background
 * with its paired foreground. An internal tool may lag the design system; it
 * may not diverge from it on purpose. The Noor mark is the product's on every
 * surface — only the word beside it says which build this is.
 *
 * `force-dynamic` because everything here depends on who is asking, and a
 * prerendered console shell is a shell that names the wrong operator.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Noor Console" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const access = await consoleShellAccess();

  if (!access.ok) {
    // The redirect is deliberately not `next=`-aware: this layout cannot read
    // the current path, and `proxy.ts` already attaches `next` for the ordinary
    // case (no cookie at all). Landing on a bare /signin is the right answer
    // for the remaining case — a cookie that no longer resolves to anybody.
    if (access.status === 401) redirect("/signin");
    return <ConsoleRefusal status={403} />;
  }

  const card = await getOperatorCard(access.operatorId);
  const links = navFor(access.roles).map((r) => ({ href: r.path, label: r.nav! }));

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <NoorMark className="h-6 w-6 shrink-0" />
            <span className="font-display text-[15px] font-bold tracking-tight text-ink">
              Noor
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Console · {ENVIRONMENT}
            </span>
          </Link>

          <ConsoleNav links={links} />

          {/* Name AND roles, together. An operator who cannot see which roles
              they hold cannot tell a missing surface from a missing link. */}
          <div className="ms-auto flex items-center gap-3 text-end">
            <div>
              <p className="text-[13px] font-semibold leading-tight text-ink">
                {card?.displayName || "Operator"}
              </p>
              <p className="font-mono text-[10px] leading-tight text-ink-faint">
                {access.roles.length > 0 ? access.roles.join(" · ") : "no roles granted"}
              </p>
            </div>
            <Link
              href="/profile"
              className="rounded-md border border-line px-2.5 py-1 text-[12px] font-medium text-ink-soft hover:bg-line-soft hover:text-ink"
            >
              My account
            </Link>
          </div>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-line-soft">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-5 py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          <span>Noor Console · {ENVIRONMENT} environment · operator reads are recorded</span>
          <span>Prep-3 Mathematics · MOETE 2025–2026</span>
        </div>
      </footer>
    </div>
  );
}

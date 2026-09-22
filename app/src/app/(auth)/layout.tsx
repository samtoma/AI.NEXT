import type { ReactNode } from "react";

import { NoorMark } from "@/components/NoorMark";

/**
 * The five auth screens, in one card, with nothing else on the page.
 *
 * No nav, no stats, no second action. A student arriving here is doing one
 * thing, and the surface says which thing — the audience is an anxious
 * fourteen-year-old and every extra door on this screen is a decision she did
 * not ask to make (PRD §8: one clear next action per screen).
 *
 * The mark sits in a circular outlined badge, which is the only way this
 * variant is allowed to present it (noor-play handoff, Assets). It carries no
 * expression and is never recoloured, so it reads as a presence rather than as
 * a character reacting to a failed sign-in.
 *
 * Measure is capped at 26rem rather than the workspace's 820px: these are
 * forms, and a 60-character-wide input invites the eye to lose the label.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[26rem] flex-col px-6 py-10 min-[900px]:py-16">
      <div className="mb-6 flex justify-center">
        <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-[3px] border-ink bg-card sticker-shadow-sm">
          <NoorMark className="h-11 w-11" />
        </span>
      </div>
      {children}
    </main>
  );
}

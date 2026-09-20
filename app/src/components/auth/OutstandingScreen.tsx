import Link from "next/link";

import { NoorMark } from "@/components/NoorMark";

import { SessionResend } from "./SessionResend";

/**
 * What stands between this student and a lesson — said once, kindly, with the
 * fix on the same screen.
 *
 * This replaces the lesson on `/student` while the email is unconfirmed
 * (FR-2004). It deliberately does not replace the *product*: the two things
 * that are still open are named and linked, because "come back when you've
 * checked your email" is a dead end for a fourteen-year-old who opened the app
 * to do something.
 *
 * Nothing here is styled as a failure. Honey and ink, the companion mark, and
 * one action — the palette has no red and this screen is precisely where a
 * lesser system would reach for it (constitution XII).
 */
export function OutstandingScreen({ studentName }: { studentName: string }) {
  const first = studentName.split(" ")[0] || studentName;

  return (
    <main className="mx-auto w-full max-w-[42rem] px-6 py-10 min-[900px]:py-14">
      <h1 className="font-display text-[1.75rem] font-extrabold text-ink min-[900px]:text-[2rem]">
        Hey, {first}
      </h1>

      <section className="mt-6 overflow-clip rounded-[28px] border-[3px] border-ink bg-card sticker-shadow-lg">
        <div
          className="flex items-center gap-3 border-ink px-5 py-4"
          style={{
            background: "var(--card-warm)",
            borderBlockEndWidth: "3px",
            borderBlockEndStyle: "solid",
          }}
        >
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border-[3px] border-ink bg-card">
            <NoorMark className="h-8 w-8" />
          </span>
          <p className="font-display text-[1.15rem] font-bold text-ink">
            One thing before we start
          </p>
        </div>

        <div className="px-6 py-6">
          <p className="font-read text-[1rem] leading-relaxed text-ink">
            There&apos;s a link sitting in your email. Open it and your lessons
            unlock — it takes a few seconds, and then Noor knows the account is
            really yours.
          </p>

          <div className="mt-6">
            <SessionResend variant="primary" />
          </div>
        </div>
      </section>

      <div className="mt-7">
        <p className="rule-label mb-2">Open right now</p>
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/spine"
              className="play-pressable flex min-h-[52px] items-center rounded-[20px] border-[3px] border-ink bg-card px-4 font-display text-[1rem] font-bold text-ink sticker-shadow-sm"
            >
              Have a look at the map
            </Link>
          </li>
          <li>
            <Link
              href="/dashboard"
              className="play-pressable flex min-h-[52px] items-center rounded-[20px] border-[3px] border-ink bg-card px-4 font-display text-[1rem] font-bold text-ink sticker-shadow-sm"
            >
              Where you stand
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}

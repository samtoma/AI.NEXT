import Link from "next/link";
import { getHomeStats } from "@/lib/queries";
import { resolveStudentContext } from "@/lib/student-context";
import { NoorMark } from "@/components/NoorMark";
import { masteryColor } from "@/lib/mastery";
import {
  BADGE,
  BUTTON_LABEL,
  BUTTON_PRIMARY,
  HEADING,
  STICKER_CARD,
  STROKE,
  cx,
} from "@/components/sticker";

export const dynamic = "force-dynamic";

/**
 * `/` — the front door, and the only page that answers for both states.
 *
 * It is **not** redirected to `/signin`. Sign-in and signup have to be
 * reachable from somewhere, and a product whose root bounces a first-time
 * visitor to a form gives them nothing to decide with. So: signed out gets a
 * welcome with the two doors, signed in gets the ledger it always had.
 *
 * The signed-in page was the Ledger's "Investor preview" wholesale — a dashed
 * gold passport, a rotated stamp, red and green graph dots, and hover glows
 * that never fire under Play (review 2026-09-23, F20). Whether the page stays
 * is a product call and is not made here; what changed is that it is drawn in
 * Noor Play: sticker cards, a leaf badge where the stamp was, the mastery ramp
 * on the graph dots, Baloo at Play's weights, and one amber — on "Run today's
 * plan", the thing a signed-in student came here to do.
 *
 * The stats are not fetched at all when nobody is signed in. Every counter on
 * this page except the corpus totals is *a* student's ledger — attempts, AI
 * turns, the name under them — and with RLS in place an unprincipled read
 * returns zeros, which would render as a real page full of honest-looking
 * noughts. Not asking is clearer than asking and disbelieving the answer.
 */
export default async function Home() {
  const me = await resolveStudentContext();
  if (!me) return <SignedOutLanding />;

  const stats = await getHomeStats(me.studentId);

  return (
    <main className="mx-auto max-w-[1400px] px-6">
      {/* hero */}
      <section className="grid gap-10 pb-16 pt-20 lg:grid-cols-[1.25fr_1fr] lg:gap-16">
        <div className="anim-rise">
          <p className="rule-label mb-7">Investor preview · July 2026</p>
          {/* Display is 2.4rem at every width — type never scales with the
              viewport under Play — and Baloo needs ~1.2 leading or its two
              lines collide (F28). */}
          <h1 className={cx(HEADING, "text-[2rem] md:text-[2.4rem]")}>
            Every answer,
            <br />
            traced to the{" "}
            <em className="not-italic underline decoration-[length:var(--play-stroke)] underline-offset-[7px]">
              official syllabus
            </em>
            .
          </h1>
          <p className="mt-6 max-w-xl font-read text-[1.05rem] leading-relaxed text-ink-soft">
            Noor is a curriculum-grounded adaptive tutor built on an{" "}
            <strong className="font-bold text-ink">
              agent-native data spine
            </strong>{" "}
            — a knowledge graph extracted from the Egyptian Ministry textbook,
            with full provenance, temporal mastery tracking, and explanations
            grounded in worked solutions.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {/* Badges, not `.chip`: the chip's ink-soft text is under the
                0.9rem floor that colour is allowed at (handoff, COLOR). */}
            <span className={cx(BADGE, "bg-card text-ink")}>postgres · bitemporal mastery</span>
            <span className={cx(BADGE, "bg-card text-ink")}>provenance on every question</span>
            <span className={cx(BADGE, "bg-card text-ink")}>prerequisite DAG</span>
          </div>
        </div>

        {/* source-document plate — the book of her first visible course
            (lib/queries.ts `sourceBookFor`), and none at all when she may see
            no course yet: a plate naming a book she cannot open is the leak
            003 closed. */}
        {stats.doc && (
          <div
            className={cx(
              STROKE,
              "anim-rise self-center rounded-[var(--play-radius-lg)] bg-card-warm p-6 sticker-shadow"
            )}
            style={{ animationDelay: "120ms" }}
          >
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-[color:var(--play-text-amber-warm)]">
                  Source of truth
                </p>
                {/* Where the rubber stamp was: a leaf badge, which is what
                    "done, and correct" looks like in this palette. */}
                <span
                  className={cx(
                    BADGE,
                    "anim-pop shrink-0 bg-[var(--play-leaf)] text-[color:var(--play-on-leaf)]"
                  )}
                >
                  Ingested ✓
                </span>
              </div>
              <h2 className="mt-3 font-display text-[1.5rem] font-extrabold leading-[1.25] text-ink">
                {stats.doc.title}
              </h2>
              <p className="mt-2 text-[0.95rem] leading-relaxed text-ink-soft">
                {stats.doc.publisher}
              </p>
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[0.72rem] font-medium text-ink-faint">
                <span>edition {stats.doc.edition}</span>
                <span>grade {stats.doc.grade}</span>
                <span>{stats.doc.subject}</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* stat ledger row */}
      <section
        className={cx(
          STICKER_CARD,
          "anim-rise grid grid-cols-2 divide-line-soft md:grid-cols-5 md:divide-x-2"
        )}
        style={{ animationDelay: "200ms" }}
      >
        {[
          { n: stats.los, label: "learning objectives", sub: "Unit 1 · prerequisite DAG" },
          { n: stats.questions, label: "live questions", sub: "each with a worked solution" },
          { n: stats.attempts, label: "attempts logged", sub: `by ${stats.studentName}` },
          { n: stats.prereqs, label: "prerequisite edges", sub: "syllabus 2025–2026" },
          { n: stats.aiTurns, label: "AI turns logged", sub: "grounded · cost-metered" },
        ].map((s) => (
          <div key={s.label} className="px-6 py-5">
            <p className="font-display text-[2.4rem] font-extrabold leading-[1.2] text-ink">{s.n}</p>
            <p className="mt-1 text-[0.9rem] font-bold text-ink-soft">{s.label}</p>
            <p className="mt-0.5 font-mono text-[0.72rem] font-medium text-ink-faint">
              {s.sub}
            </p>
          </div>
        ))}
      </section>

      {/* the two demos */}
      <section className="grid gap-6 py-14 md:grid-cols-2">
        {/* Each door is a sticker card that presses. The entrance
            animation sits on a wrapper: `anim-rise` fills `both`, keeps its
            last transform, and would otherwise freeze the press. */}
        <div className="anim-rise" style={{ animationDelay: "280ms" }}>
          <Link href="/spine" className={DEMO_CARD}>
            <MiniDag />
            <p className="relative font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
              01 · The centerpiece
            </p>
            <h3 className={cx(HEADING, "relative mt-3 text-[1.9rem]")}>
              The Evidence Walk
            </h3>
            <p className="relative mt-3 max-w-md font-read text-[1rem] leading-relaxed text-ink-soft">
              Walk the curriculum graph — then{" "}
              <strong className="font-bold text-ink">Ask the Spine</strong>:
              chat with the curriculum itself, every answer with receipts. Watch
              the AI walk the graph live, click a citation to follow the
              evidence, and let it push a question straight into the chat.
            </p>
            <span className={cx(BUTTON_LABEL, "relative mt-6 bg-card text-ink")}>
              Explore the spine
              <span aria-hidden>→</span>
            </span>
          </Link>
        </div>

        <div className="anim-rise" style={{ animationDelay: "360ms" }}>
          <Link href="/student" className={DEMO_CARD}>
            <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.14em] text-ink-faint">
              02 · The loop
            </p>
            <h3 className={cx(HEADING, "mt-3 text-[1.9rem]")}>
              Student Loop
            </h3>
            <p className="mt-3 max-w-md font-read text-[1rem] leading-relaxed text-ink-soft">
              Today&apos;s plan for {stats.studentName}: five questions chosen
              from the graph — weakest topics first, spaced review, one stretch.
              Wrong answers get explanations grounded in the worked solution.
            </p>
            {/* The one amber on this page: today's plan is the action. */}
            <span
              className={cx(
                BUTTON_LABEL,
                "mt-6 bg-[var(--noor-action)] text-[color:var(--noor-on-action)]"
              )}
            >
              Run today&apos;s plan
              <span aria-hidden>→</span>
            </span>
          </Link>
        </div>

        {/* The making-of card is GONE, with the route it pointed at.
            `/pipeline` is a console surface now (ADR-0014) — a different build,
            a different port, and `evidence-access` in front of it — so a card
            here could only ever be a link to a 404. It was already wrong for
            this audience (#10): the first thing a student sees should not be a
            walk through an extraction pipeline. The walk still exists; it is
            ours, on the console. */}
      </section>
    </main>
  );
}

/** A demo door on the signed-in page: a big sticker card that presses. */
const DEMO_CARD = cx(
  STICKER_CARD,
  "play-pressable group relative block h-full overflow-hidden p-8"
);

/**
 * What a signed-out visitor sees: what this is, and the two doors.
 *
 * One dominant action — "Start with Noor" — and a quieter way back in for
 * somebody who already has an account. No stats, no graph, no pipeline: none
 * of it means anything to a fourteen-year-old who has not signed up, and the
 * numbers on the signed-in page belong to a student who is not here yet.
 */
function SignedOutLanding() {
  return (
    <main className="mx-auto flex w-full max-w-[36rem] flex-col items-center px-6 py-14 text-center min-[900px]:py-20">
      <span
        className={cx(
          STROKE,
          "mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-[var(--play-radius-pill)] bg-card sticker-shadow"
        )}
      >
        <NoorMark className="h-14 w-14" />
      </span>

      <h1 className={cx(HEADING, "text-[2rem] min-[900px]:text-[2.4rem]")}>
        Stuck on maths? Noor sits with you.
      </h1>
      <p className="mt-4 max-w-[34ch] font-read text-[1.05rem] leading-relaxed text-ink-soft">
        One lesson at a time, from your own syllabus — and a nudge instead of a
        red cross when you get it wrong.
      </p>

      <Link href="/signup" className={cx(BUTTON_PRIMARY, "mt-9 w-full")}>
        Start with Noor
      </Link>

      <p className="mt-6 text-[1rem] text-ink-soft">
        Already have an account?{" "}
        <Link
          href="/signin"
          className="font-display font-bold text-[color:var(--play-text-link)] underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}

/**
 * Decorative mini-DAG in the Evidence Walk card corner. Its dots are the
 * mastery ramp — the same five steps as every other screen — where they used
 * to be literal red and green. Placed with `end`, so it follows the page's
 * direction; no hover state (it could only ever fire on a mouse).
 */
function MiniDag() {
  return (
    <svg
      className="pointer-events-none absolute -end-4 -top-6 h-40 w-64 opacity-60"
      viewBox="0 0 260 160"
      fill="none"
      aria-hidden
    >
      <path
        d="M30 80 C 60 80 60 40 90 40 M30 80 C 60 80 60 120 90 120 M90 40 C 125 40 125 80 160 80 M90 120 C 125 120 125 80 160 80 M160 80 C 195 80 195 60 230 60"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeDasharray="3 4"
      />
      {[
        [30, 80, 0.85],
        [90, 40, 0.55],
        [90, 120, 0.35],
        [160, 80, 0.62],
        [230, 60, 0.2],
      ].map(([x, y, s]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r="9"
          fill="var(--card)"
          style={{ stroke: masteryColor(s), strokeWidth: "var(--play-stroke-sm)" }}
        />
      ))}
    </svg>
  );
}

import Link from "next/link";
import { getHomeStats } from "@/lib/queries";
import { resolveStudentContext } from "@/lib/student-context";
import { NoorMark } from "@/components/NoorMark";

export const dynamic = "force-dynamic";

/**
 * `/` — the front door, and the only page that answers for both states.
 *
 * It is **not** redirected to `/signin`. Sign-in and signup have to be
 * reachable from somewhere, and a product whose root bounces a first-time
 * visitor to a form gives them nothing to decide with. So: signed out gets a
 * welcome with the two doors, signed in gets the ledger it always had.
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
          <h1 className="font-display text-[clamp(2.6rem,5vw,4.2rem)] font-medium leading-[1.04] tracking-tight text-ink">
            Every answer,
            <br />
            traced to the{" "}
            <em className="text-accent-deep not-italic underline decoration-gold/60 decoration-[3px] underline-offset-[7px]">
              official syllabus
            </em>
            .
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-soft">
            Noor is a curriculum-grounded adaptive tutor built on an{" "}
            <strong className="font-semibold text-ink">
              agent-native data spine
            </strong>{" "}
            — a knowledge graph extracted from the Egyptian Ministry textbook,
            with full provenance, temporal mastery tracking, and explanations
            grounded in reviewed canonical solutions.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            <span className="chip">postgres · bitemporal mastery</span>
            <span className="chip">provenance on every question</span>
            <span className="chip">prerequisite DAG</span>
          </div>
        </div>

        {/* source-document plate */}
        <div
          className="passport anim-rise self-center p-6"
          style={{ animationDelay: "120ms" }}
        >
          <div className="relative">
            <div className="flex items-start justify-between gap-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                Source of truth
              </p>
              <span className="stamp-seal anim-stamp">Ingested ✓</span>
            </div>
            <h2 className="mt-3 font-display text-xl font-medium leading-snug text-ink">
              {stats.doc.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {stats.doc.publisher}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-ink-soft">
              <span>edition {stats.doc.edition}</span>
              <span>grade {stats.doc.grade}</span>
              <span>{stats.doc.subject}</span>
            </div>
          </div>
        </div>
      </section>

      {/* stat ledger row */}
      <section
        className="ledger-card anim-rise grid grid-cols-2 divide-line-soft md:grid-cols-5 md:divide-x"
        style={{ animationDelay: "200ms" }}
      >
        {[
          { n: stats.los, label: "learning objectives", sub: "Unit 1 · prerequisite DAG" },
          { n: stats.questions, label: "live questions", sub: "reviewed, with canonical solutions" },
          { n: stats.attempts, label: "attempts logged", sub: `by ${stats.studentName}` },
          { n: stats.prereqs, label: "prerequisite edges", sub: "syllabus 2025–2026" },
          { n: stats.aiTurns, label: "AI turns logged", sub: "grounded · cost-metered" },
        ].map((s) => (
          <div key={s.label} className="px-6 py-5">
            <p className="font-display text-4xl font-medium text-ink">{s.n}</p>
            <p className="mt-1 text-[13px] font-medium text-ink-soft">{s.label}</p>
            <p className="mt-0.5 font-mono text-[10px] tracking-wide text-ink-faint">
              {s.sub}
            </p>
          </div>
        ))}
      </section>

      {/* the two demos */}
      <section className="grid gap-6 py-14 md:grid-cols-2">
        <Link
          href="/spine"
          className="ledger-card anim-rise group relative overflow-hidden p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(13,74,66,0.45)]"
          style={{ animationDelay: "280ms" }}
        >
          <MiniDag />
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-accent">
            01 · The centerpiece
          </p>
          <h3 className="mt-3 font-display text-3xl font-medium text-ink">
            The Evidence Walk
          </h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Walk the curriculum graph — then{" "}
            <strong className="font-semibold text-ink">Ask the Spine</strong>:
            chat with the curriculum itself, every answer with receipts. Watch
            the AI walk the graph live, click a citation to follow the
            evidence, and let it push a question straight into the chat.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-accent-deep">
            Explore the spine
            <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
          </p>
        </Link>

        <Link
          href="/student"
          className="ledger-card anim-rise group relative overflow-hidden p-8 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgba(168,68,42,0.4)]"
          style={{ animationDelay: "360ms" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
            02 · The loop
          </p>
          <h3 className="mt-3 font-display text-3xl font-medium text-ink">
            Student Loop
          </h3>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-ink-soft">
            Today&apos;s plan for {stats.studentName}: five questions chosen
            from the graph — weakest topics first, spaced review, one stretch.
            Wrong answers get explanations grounded in the reviewed solution.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-rust">
            Run today&apos;s plan
            <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
          </p>
        </Link>

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
      <span className="mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-full border-[3px] border-ink bg-card sticker-shadow">
        <NoorMark className="h-14 w-14" />
      </span>

      <h1 className="font-display text-[2rem] font-extrabold leading-tight text-ink min-[900px]:text-[2.4rem]">
        Stuck on maths? Noor sits with you.
      </h1>
      <p className="mt-4 max-w-[34ch] font-read text-[1.05rem] leading-relaxed text-ink-soft">
        One lesson at a time, from your own syllabus — and a nudge instead of a
        red cross when you get it wrong.
      </p>

      <Link
        href="/signup"
        className="play-pressable mt-9 flex w-full min-h-[56px] items-center justify-center rounded-[20px] border-[3px] border-ink px-6 font-display text-[1.15rem] font-bold sticker-shadow"
        style={{
          background: "var(--noor-action, #f0a22f)",
          color: "var(--noor-on-action, #241f3d)",
        }}
      >
        Start with Noor
      </Link>

      <p className="mt-6 text-[1rem] text-ink-soft">
        Already have an account?{" "}
        <Link
          href="/signin"
          className="font-display font-bold underline underline-offset-4"
          style={{ color: "var(--play-text-link, #136386)" }}
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}

/** decorative mini-DAG in the Evidence Walk card corner */
function MiniDag() {
  return (
    <svg
      className="pointer-events-none absolute -right-4 -top-6 h-40 w-64 opacity-50 transition-opacity duration-300 group-hover:opacity-90"
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
          stroke={`rgb(${s < 0.5 ? "184 71 42" : "44 122 86"})`}
          strokeWidth="2.5"
        />
      ))}
    </svg>
  );
}

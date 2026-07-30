import Link from "next/link";
import { getHomeStats } from "@/lib/queries";
import { resolveStudentId } from "@/lib/student-context";

export const dynamic = "force-dynamic";

export default async function Home() {
  // the demo student selected by the (validated) cookie — see the switcher on
  // /spine and /student; a demo affordance, never auth (PRD §3).
  const stats = await getHomeStats(await resolveStudentId());

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
            AI.Next is a curriculum-grounded adaptive tutor built on an{" "}
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

        <Link
          href="/pipeline"
          className="ledger-card anim-rise group relative overflow-hidden p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-24px_rgba(169,126,34,0.45)] md:col-span-2"
          style={{ animationDelay: "440ms" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                03 · The making-of
              </p>
              <h3 className="mt-1.5 font-display text-2xl font-medium text-ink">
                The Digestion
              </h3>
              <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-soft">
                How the ministry textbook became data an AI can digest — real
                page scans, the schema-first extraction contract, the human
                review gate, and the ~5k-token context the agent actually
                reads.
              </p>
            </div>
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-gold">
              Walk the pipeline
              <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
            </p>
          </div>
        </Link>
      </section>
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

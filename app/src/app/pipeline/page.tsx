import { getPipelineData } from "@/lib/pipeline-queries";
import { SourceStage } from "@/components/pipeline/SourceStage";
import { SchemaStage } from "@/components/pipeline/SchemaStage";
import { ReviewStage } from "@/components/pipeline/ReviewStage";
import { GraphStage } from "@/components/pipeline/GraphStage";
import { ContextStage } from "@/components/pipeline/ContextStage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Extraction Engine — AI.Next Tutor PoC",
  description:
    "The agentic pipeline that turns a ministry textbook into an adaptive, coverage-audited, human-reviewed AI tutor — a book in, a taught curriculum out.",
};

/* ------------------------------------------------------------------ */
/* The agentic line — the concept, presented                          */
/* ------------------------------------------------------------------ */

type Model = "Haiku" | "Sonnet" | "Sonnet + Haiku" | "Deterministic" | "Human";

const MODEL_STYLE: Record<Model, string> = {
  Haiku: "border-line bg-card text-ink-soft",
  Sonnet: "border-accent/40 bg-accent-wash text-accent-deep",
  "Sonnet + Haiku": "border-accent/40 bg-accent-wash text-accent-deep",
  Deterministic: "border-line bg-card-warm text-ink-faint",
  Human: "border-gold/50 bg-gold-wash text-gold",
};

const STAGES: {
  no: string;
  name: string;
  model: Model;
  what: string;
  guard: string;
  star?: boolean;
}[] = [
  {
    no: "0",
    name: "Segment",
    model: "Haiku",
    what: "Auto-reads the book's own headings to map every unit → lesson → sub-topic, and reconciles the printed page numbers against the PDF.",
    guard: "Fixes each lesson's full span up front — the firewall against half-covered lessons.",
  },
  {
    no: "1",
    name: "Outline + Exposition",
    model: "Sonnet",
    what: "Pulls the objectives verbatim from the ministry «أهداف الدرس» panel, then writes a teaching narrative, key terms, enrichment boxes, and the misconceptions students fall for.",
    guard: "Objectives are never invented — they are the book's own list.",
  },
  {
    no: "2",
    name: "Claims",
    model: "Sonnet",
    what: "Every atomic fact, each tied to its exact page and evidence type. This is the only ground the tutor is ever allowed to stand on.",
    guard: "Faithful to the book — no fact without a cited page.",
  },
  {
    no: "3",
    name: "Questions",
    model: "Sonnet",
    what: "A dense, style-varied bank — بم تفسر · قارن · النتائج المترتبة · رتّب · locate — grounded only in the claims, across three difficulty tiers.",
    guard: "Never solved from scratch — every solution traces back to a claim.",
  },
  {
    no: "4",
    name: "Visuals & interactives",
    model: "Sonnet",
    what: "Animated maps, timelines, cause→effect chains, and tap-to-answer challenges — parametric data the app draws, not clip art.",
    guard: "Validated against the base-map gazetteer and the renderer contract; broken specs are dropped.",
  },
  {
    no: "5",
    name: "Independent verify",
    model: "Sonnet + Haiku",
    what: "A DIFFERENT model re-solves every question from the claims — without seeing the proposed answer — and a provenance pass re-reads the page for each claim.",
    guard: "Grader ≠ author. 0 answer errors across 754 questions.",
  },
  {
    no: "6",
    name: "Coverage oracle",
    model: "Sonnet",
    what: "Compares the sub-topics the book demands against what the agents actually produced, one by one. Turns GREEN only when every single one is covered.",
    guard: "The load-bearing idea — makes shipping “one continent of six” structurally impossible.",
    star: true,
  },
  {
    no: "7",
    name: "Human gate",
    model: "Human",
    what: "The whole bundle is a draft. A person approves it before anything flips from review → live.",
    guard: "Nothing unreviewed ever reaches a student.",
  },
  {
    no: "8",
    name: "Load",
    model: "Deterministic",
    what: "A scoped, idempotent load into the Postgres curriculum graph — other subjects untouched, cross-subject links preserved.",
    guard: "Re-runnable and versioned — the same command, every book.",
  },
];

const GUARANTEES: { title: string; body: string; stat: string }[] = [
  {
    title: "Coverage oracle",
    stat: "0 silent gaps",
    body: "The checklist of what the book teaches vs. what the agents produced. On its very first run it caught a page-boundary bug and refused to ship until it was fixed.",
  },
  {
    title: "Independent re-solve",
    stat: "0 answer errors",
    body: "A second model re-solves every question blind. Across 754 questions, it disagreed on zero answers — grader and author are never the same instance.",
  },
  {
    title: "Provenance audit",
    stat: "4 defects caught",
    body: "A stronger model re-reads the page for every flagged claim. Book-wide it confirmed 87% and found four genuine errors — a wrong date, two over-claims — all dropped before load.",
  },
  {
    title: "Human review gate",
    stat: "279 held back",
    body: "Machine-verified is not the same as human-approved. Short-answer and unverified questions stay in a review queue, invisible to students, until a person clears them.",
  },
];

function StageCard({ s }: { s: (typeof STAGES)[number] }) {
  return (
    <article
      className={`ledger-card relative overflow-hidden p-4 ${
        s.star ? "border-gold/60 bg-gold-wash/40" : ""
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-mono text-[12px] font-semibold ${
            s.star
              ? "border-gold/60 bg-card text-gold"
              : "border-gold/45 bg-card text-gold"
          }`}
        >
          {s.no}
        </span>
        <h3 className="font-display text-[16px] font-medium text-ink">
          {s.name}
        </h3>
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] ${MODEL_STYLE[s.model]}`}
        >
          {s.model}
        </span>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-ink-soft">{s.what}</p>
      <p
        className={`mt-2.5 flex items-start gap-1.5 text-[11.5px] leading-relaxed ${
          s.star ? "text-gold" : "text-ink-faint"
        }`}
      >
        <span aria-hidden className="mt-[1px] shrink-0">
          {s.star ? "★" : "→"}
        </span>
        <span>{s.guard}</span>
      </p>
    </article>
  );
}

/* ------------------------------------------------------------------ */

function Stage({
  no,
  name,
  headline,
  caption,
  delay,
  children,
}: {
  no: string;
  name: string;
  headline: React.ReactNode;
  caption: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <section
      className="anim-rise relative pb-16 md:pl-24"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="absolute left-0 top-1 hidden md:block">
        <div className="flex h-14 w-14 -rotate-6 items-center justify-center rounded-full border-2 border-gold/55 bg-card font-mono text-[13px] font-semibold tracking-wider text-gold shadow-[0_2px_8px_rgba(32,41,58,0.08)]">
          {no}
        </div>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
        <span className="md:hidden">{no} · </span>
        {name}
      </p>
      <h2 className="mt-2 max-w-3xl font-display text-[1.9rem] font-medium leading-tight tracking-tight text-ink">
        {headline}
      </h2>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
        {caption}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default async function PipelinePage() {
  const data = await getPipelineData();
  const {
    doc,
    run,
    los,
    prereqEdges,
    nodesByKind,
    edgesByType,
    syllabusVersion,
    questionStats,
    reviewQuestion,
    aiTurn,
  } = data;

  return (
    <main className="mx-auto max-w-[1160px] px-6">
      {/* hero */}
      <section className="anim-rise pb-12 pt-16">
        <p className="rule-label mb-6">
          The extraction engine · a book in, a taught curriculum out
        </p>
        <h1 className="max-w-4xl font-display text-[clamp(2.3rem,4.6vw,3.6rem)] font-medium leading-[1.06] tracking-tight text-ink">
          How we turn a ministry textbook into a{" "}
          <em className="not-italic text-accent-deep underline decoration-gold/60 decoration-[3px] underline-offset-[7px]">
            tutor
          </em>
          — automatically.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Not a person typing questions into a spreadsheet. A fleet of AI agents
          reads each lesson, extracts and cross-checks every fact, writes the
          teaching and the practice, draws the figures — and a{" "}
          <strong className="font-semibold text-ink">coverage oracle</strong>{" "}
          refuses to ship a lesson until every sub-topic the book teaches is
          actually there. Nothing unreviewed reaches a student.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-soft">
          <span className="chip">in · the ministry PDF</span>
          <span className="text-gold">→</span>
          <span className="chip">~40 agents / lesson · tiered models</span>
          <span className="text-gold">→</span>
          <span className="chip">
            out · taught, verified, coverage-audited curriculum
          </span>
        </div>
      </section>

      {/* the problem it solves */}
      <section
        className="anim-rise mb-14 grid gap-4 md:grid-cols-[1fr_1fr]"
        style={{ animationDelay: "80ms" }}
      >
        <div className="rounded-xl border border-rust/30 bg-rust-wash/40 px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-rust">
            The old way — hand-authoring
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            A human reads the book and types JSON. It doesn&apos;t scale, and
            nothing checks it: a six-continent geography lesson shipped with{" "}
            <strong className="font-semibold text-ink">one continent</strong> —
            and no alarm ever went off.
          </p>
        </div>
        <div className="rounded-xl border border-accent/30 bg-accent-wash px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
            The new way — the agentic line
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            Every lesson rides the same conveyor of specialized agents, and the{" "}
            <strong className="font-semibold text-ink">coverage oracle</strong>{" "}
            makes “one continent of six” structurally impossible to reship. A
            whole term-1 book was ingested and reviewed in an afternoon.
          </p>
        </div>
      </section>

      {/* THE LINE — the 9 stages */}
      <section
        className="anim-rise mb-6"
        style={{ animationDelay: "120ms" }}
      >
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[1.6rem] font-medium tracking-tight text-ink">
            The line · one lesson, nine stops
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            per-lesson conveyor
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-ink-soft">
          Lessons fan out in parallel; inside each, sub-topics fan out again —
          dozens of agents at once. Cheap models do the mechanical reading, the
          strong model does the reasoning, and the grader is never the same
          instance as the author.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s) => (
            <StageCard key={s.no} s={s} />
          ))}
        </div>
      </section>

      {/* guarantees */}
      <section
        className="anim-rise mb-16 mt-14"
        style={{ animationDelay: "160ms" }}
      >
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[1.6rem] font-medium tracking-tight text-ink">
            Why you can trust what it ships
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            four gates, every lesson
          </span>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {GUARANTEES.map((g) => (
            <div key={g.title} className="ledger-card p-4">
              <p className="font-display text-[15px] font-medium text-ink">
                {g.title}
              </p>
              <p className="mt-1 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-deep">
                {g.stat}
              </p>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-soft">
                {g.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* what it produced */}
      <section
        className="anim-rise mb-16 overflow-hidden rounded-xl border border-line bg-card-warm"
        style={{ animationDelay: "200ms" }}
      >
        <div className="border-b border-line-soft px-6 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            Run of record · the full Social Studies term-1 book
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
          {[
            ["14", "lessons · 4 units"],
            ["84", "objectives, book-verbatim"],
            ["762", "questions · 483 live"],
            ["≈880", "page-cited claims"],
            ["6+", "figure & widget types"],
            ["0", "answer errors (754 re-solved)"],
            ["4", "real defects caught & dropped"],
            ["1 afternoon", "ingested + reviewed"],
          ].map(([big, small]) => (
            <div key={small} className="bg-card-warm px-5 py-4">
              <p className="font-display text-[1.7rem] font-medium leading-none text-ink">
                {big}
              </p>
              <p className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">
                {small}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-line-soft bg-card px-6 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent-deep">
            It catches its own mistakes
          </p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
            On the first run the coverage oracle went{" "}
            <span className="font-semibold text-rust">RED</span> — a page had
            been mis-assigned — and it refused to ship until the gap was closed.
            When a mid-run usage limit killed one lesson&apos;s agents, a
            targeted re-run recovered it, and the completeness check confirmed
            all fourteen lessons before anything loaded. The pipeline
            doesn&apos;t just extract — it audits itself.
          </p>
        </div>
      </section>

      {/* live proof — the deterministic backbone the agents feed */}
      <section className="anim-rise mb-4" style={{ animationDelay: "240ms" }}>
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[1.6rem] font-medium tracking-tight text-ink">
            And here it is, running for real
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
            live from the database
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-ink-soft">
          The agents feed a deterministic backbone — a content-addressed source,
          a typed schema, a review stamp, a versioned graph, and the exact
          context the tutor was handed on its last turn. Everything below is
          pulled live, not mocked.
        </p>
      </section>

      <div className="relative">
        <div
          className="absolute bottom-8 left-[27px] top-2 hidden w-px border-l border-dashed border-line md:block"
          aria-hidden
        />

        <Stage
          no="01"
          name="Source"
          headline="One book, one hash."
          caption="The official Ministry textbook is ingested exactly once and addressed by its content — the anchor every downstream fact points back to."
          delay={280}
        >
          <SourceStage doc={doc} />
        </Stage>

        <Stage
          no="02"
          name="Schema-first"
          headline="The model doesn't get to freestyle — it must fill this shape."
          caption="Every agent's output is forced into typed models and validated before it enters the spine. Broken references and prerequisite cycles are rejected at the door."
          delay={330}
        >
          <SchemaStage run={run} />
        </Stage>

        {reviewQuestion && (
          <Stage
            no="03"
            name="Review gate"
            headline="Nothing unreviewed reaches a student."
            caption="Every question and its canonical solution passes a human before going live. Here is a real row from the spine, mid-pipeline, with its stamp."
            delay={380}
          >
            <ReviewStage
              q={reviewQuestion}
              liveCount={questionStats.live}
              reviewedCount={questionStats.reviewed}
            />
          </Stage>
        )}

        <Stage
          no="04"
          name="Graph load"
          headline="The book is now a map."
          caption="The validated bundle lands in Postgres as a typed, versioned graph — small enough to audit by eye, rich enough for an agent to navigate."
          delay={430}
        >
          <GraphStage
            los={los}
            edges={prereqEdges}
            nodesByKind={nodesByKind}
            edgesByType={edgesByType}
            syllabusVersion={syllabusVersion}
          />
        </Stage>

        {aiTurn && (
          <Stage
            no="05"
            name="Context assembly · the payoff"
            headline={
              <>
                How the tutor reads the whole book in{" "}
                {aiTurn.inputTokens.toLocaleString("en-US")} tokens.
              </>
            }
            caption="Context is assembled per student, per session: mastery state selects the neighborhood; the graph selects the pages. Hundreds of pages, milliseconds, receipts."
            delay={480}
          >
            <ContextStage turn={aiTurn} los={los} />
          </Stage>
        )}
      </div>

      {/* scaling strip */}
      <section
        className="anim-rise mb-16 rounded-xl border-[1.5px] border-dashed border-gold/50 bg-card-warm px-6 py-5"
        style={{ animationDelay: "540ms" }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
            Same line · next books
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">Term 2 · same books</span>
            <span className="chip">Any ministry subject</span>
            <span className="chip">Arabic & English editions</span>
            <span className="chip">
              new syllabus year → new graph version, history intact
            </span>
          </div>
          <p className="ml-auto text-[13px] italic text-ink-soft">
            A book in, a taught curriculum out — a machine, not a one-off.
          </p>
        </div>
      </section>
    </main>
  );
}

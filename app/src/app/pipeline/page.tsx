import { getPipelineData } from "@/lib/pipeline-queries";
import { SourceStage } from "@/components/pipeline/SourceStage";
import { SchemaStage } from "@/components/pipeline/SchemaStage";
import { ReviewStage } from "@/components/pipeline/ReviewStage";
import { GraphStage } from "@/components/pipeline/GraphStage";
import { ContextStage } from "@/components/pipeline/ContextStage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Digestion — AI.Next Tutor PoC",
  description:
    "How a ministry textbook becomes data an AI can digest: source, schema, review gate, graph, context assembly.",
};

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
      {/* rail medallion */}
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
      <section className="anim-rise pb-14 pt-16">
        <p className="rule-label mb-6">The making-of · ingested once, queried forever</p>
        <h1 className="max-w-4xl font-display text-[clamp(2.3rem,4.6vw,3.6rem)] font-medium leading-[1.06] tracking-tight text-ink">
          How a ministry textbook becomes
          <br />
          something an AI can{" "}
          <em className="not-italic text-accent-deep underline decoration-gold/60 decoration-[3px] underline-offset-[7px]">
            digest
          </em>
          .
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
          Five stages, one direction: paper in, spine out. Everything below is
          live from the database — real scans, the real extraction contract,
          real review stamps, and the exact context the AI was given on its
          last turn.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-2 font-mono text-[11.5px] text-ink-soft">
          <span className="chip">in · 178 pages · 87 MB of PDF</span>
          <span className="text-gold">→</span>
          <span className="chip">
            out · {nodesByKind.reduce((a, k) => a + k.count, 0)} nodes ·{" "}
            {edgesByType.reduce((a, t) => a + t.count, 0)} edges ·{" "}
            {questionStats.live} reviewed questions
          </span>
          <span className="text-gold">→</span>
          <span className="chip">
            read by the agent · ~{aiTurn ? Math.round(aiTurn.inputTokens / 1000) : 5}k
            tokens / turn
          </span>
        </div>
      </section>

      {/* the stage rail */}
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
          delay={80}
        >
          <SourceStage doc={doc} />
        </Stage>

        <Stage
          no="02"
          name="Decompose"
          headline="The model doesn't get to freestyle — it must fill this shape."
          caption="Schema-first extraction: the LLM's output is forced into typed models and validated before anything enters the spine. Broken references and prerequisite cycles are rejected at the door."
          delay={160}
        >
          <SchemaStage run={run} />
        </Stage>

        {reviewQuestion && (
          <Stage
            no="03"
            name="Review gate"
            headline="Nothing unreviewed reaches a student."
            caption="Every question and its canonical solution passes a human before going live. Here is a real row from the spine, mid-pipeline, with its stamp."
            delay={240}
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
          delay={320}
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
                How an agent reads 178 pages in{" "}
                {aiTurn.inputTokens.toLocaleString("en-US")} tokens.
              </>
            }
            caption="Context is assembled per student, per session: mastery state selects the neighborhood; the graph selects the pages. Hundreds of pages, milliseconds, receipts."
            delay={400}
          >
            <ContextStage turn={aiTurn} los={los} />
          </Stage>
        )}
      </div>

      {/* scaling strip */}
      <section
        className="anim-rise mb-16 rounded-xl border-[1.5px] border-dashed border-gold/50 bg-card-warm px-6 py-5"
        style={{ animationDelay: "480ms" }}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold">
            Same pipeline · next inputs
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">Units 2–5 · same book</span>
            <span className="chip">Grade 10 · Bakaloreya math</span>
            <span className="chip">Arabic edition</span>
            <span className="chip">syllabus 2026–2027 → new graph version, history intact</span>
          </div>
          <p className="ml-auto text-[13px] italic text-ink-soft">
            The digestion is a machine, not a one-off.
          </p>
        </div>
      </section>
    </main>
  );
}

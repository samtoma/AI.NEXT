import { masteryColor, pct } from "@/lib/mastery";
import type { AiTurn, PipelineLo } from "@/lib/pipeline-queries";

const PAPER = "#f3eee1";
const PAPER_SOFT = "rgba(243, 238, 225, 0.68)";
const PAPER_FAINT = "rgba(243, 238, 225, 0.42)";
const LINE_DARK = "rgba(243, 238, 225, 0.14)";

export function ContextStage({ turn, los }: { turn: AiTurn; los: PipelineLo[] }) {
  const byId = new Map(los.map((l) => [l.id, l]));
  const slice = turn.grounding.loIds
    .map((id) => byId.get(id))
    .filter((l): l is PipelineLo => Boolean(l));

  const fmt = (n: number) => n.toLocaleString("en-US");

  return (
    <div
      className="overflow-hidden rounded-xl border shadow-[0_24px_56px_-24px_rgba(32,41,58,0.6)]"
      style={{
        borderColor: "rgba(32, 41, 58, 0.55)",
        background:
          "radial-gradient(ellipse 110% 80% at 15% -10%, rgba(22, 102, 92, 0.22), transparent 55%), radial-gradient(ellipse 90% 70% at 100% 110%, rgba(169, 126, 34, 0.14), transparent 60%), #20293a",
        color: PAPER,
      }}
    >
      {/* window chrome */}
      <div
        className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3.5"
        style={{ borderColor: LINE_DARK }}
      >
        <p className="font-mono text-[10px] uppercase tracking-[0.22em]" style={{ color: PAPER_FAINT }}>
          Context window · assembled for ai_interactions #{turn.id}
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10.5px]" style={{ color: PAPER_SOFT }}>
          <span>surface {turn.surface}</span>
          <span>model {turn.model}</span>
          <span>logged {turn.createdAt.slice(0, 10)}</span>
        </div>
      </div>

      <div className="px-6 py-6 sm:px-8">
        <h3 className="max-w-2xl font-display text-2xl font-medium leading-snug sm:text-[1.7rem]">
          The agent never opens the PDF at runtime.
          <br />
          <span style={{ color: "#8ecab9" }}>The graph is the index.</span>
        </h3>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed" style={{ color: PAPER_SOFT }}>
          Below is the actual grounding slice handed to the model for this turn
          — pulled verbatim from the <span className="font-mono text-[12.5px]">grounding</span> JSONB
          logged in the database. Not a mock.
        </p>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
          {/* LOs with mastery */}
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#d9b25f" }}>
              grounding.lo_ids · {slice.length} objectives + live mastery
            </p>
            <div className="mt-3 space-y-[7px]">
              {slice.map((lo) => (
                <div key={lo.id} className="flex items-center gap-3">
                  <span className="w-[4.6rem] shrink-0 font-mono text-[10.5px]" style={{ color: PAPER_SOFT }}>
                    {lo.id.replace("lo:", "")}
                  </span>
                  <div className="h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: "rgba(243,238,225,0.12)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: pct(lo.score), backgroundColor: masteryColor(lo.score) }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono text-[10.5px]" style={{ color: PAPER_FAINT }}>
                    {pct(lo.score)}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-[11.5px] italic leading-snug" style={{ color: PAPER_FAINT }}>
              mastery selects the neighborhood — weak nodes pull in their prerequisites
            </p>
          </div>

          <div className="space-y-5">
            {/* pages */}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#d9b25f" }}>
                grounding.pages · {turn.grounding.pages.length} of 178 book pages selected
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {turn.grounding.pages.map((p) => (
                  <span
                    key={p}
                    className="rounded border px-1.5 py-0.5 font-mono text-[10.5px]"
                    style={{ borderColor: LINE_DARK, color: PAPER_SOFT }}
                  >
                    p.{p}
                  </span>
                ))}
              </div>
            </div>

            {/* question ids */}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: "#d9b25f" }}>
                grounding.question_ids · {turn.grounding.questionIds.length} reviewed questions in scope
              </p>
              <p className="mt-2.5 break-words font-mono text-[9.5px] leading-[1.7]" style={{ color: PAPER_FAINT }}>
                {turn.grounding.questionIds.join("  ")}
              </p>
            </div>
          </div>
        </div>

        {/* the receipt */}
        <div
          className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 md:grid-cols-4"
          style={{ borderColor: LINE_DARK }}
        >
          {[
            { n: fmt(turn.inputTokens), unit: "tokens in", sub: "the whole textbook, distilled" },
            { n: fmt(turn.outputTokens), unit: "tokens out", sub: "cited answer" },
            { n: `$${turn.costUsd.toFixed(4)}`, unit: "cost this turn", sub: "metered per student" },
            { n: `${(turn.latencyMs / 1000).toFixed(1)} s`, unit: "latency", sub: "graph query + model" },
          ].map((s) => (
            <div key={s.unit}>
              <p className="font-display text-[1.9rem] font-medium leading-none">{s.n}</p>
              <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: "#8ecab9" }}>
                {s.unit}
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: PAPER_FAINT }}>
                {s.sub}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

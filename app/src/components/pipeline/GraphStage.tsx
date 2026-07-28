import Link from "next/link";
import type { PipelineLo } from "@/lib/pipeline-queries";

const KIND_LABEL: Record<string, string> = {
  program: "program",
  course: "course",
  module: "module",
  learning_objective: "learning objectives",
  topic: "topic",
};

export function GraphStage({
  los,
  edges,
  nodesByKind,
  edgesByType,
  syllabusVersion,
}: {
  los: PipelineLo[];
  edges: { src: string; dst: string }[];
  nodesByKind: { kind: string; count: number }[];
  edgesByType: { type: string; count: number }[];
  syllabusVersion: string;
}) {
  // static layered layout over the prerequisite DAG
  const byLayer = new Map<number, PipelineLo[]>();
  for (const lo of los) {
    const list = byLayer.get(lo.layer) ?? [];
    list.push(lo);
    byLayer.set(lo.layer, list);
  }
  const maxLayer = Math.max(...los.map((l) => l.layer), 1);
  const W = 640;
  const H = 190;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [layer, list] of byLayer) {
    const x = 38 + (layer * (W - 82)) / maxLayer;
    list.forEach((lo, i) => {
      const y = list.length === 1 ? 92 : 52 + (i * 84) / (list.length - 1);
      pos.set(lo.id, { x, y });
    });
  }

  const totalNodes = nodesByKind.reduce((a, k) => a + k.count, 0);
  const totalEdges = edgesByType.reduce((a, t) => a + t.count, 0);

  return (
    <div className="ledger-card grid overflow-hidden lg:grid-cols-[1fr_21rem]">
      {/* the DAG, as loaded */}
      <div className="flex flex-col justify-between p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Unit 1 prerequisite graph — 11 learning objectives">
          {edges.map((e) => {
            const a = pos.get(e.src);
            const b = pos.get(e.dst);
            if (!a || !b) return null;
            const mx = (a.x + b.x) / 2;
            return (
              <path
                key={`${e.src}-${e.dst}`}
                d={`M ${a.x + 10} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x - 10} ${b.y}`}
                stroke="var(--accent)"
                strokeWidth="1.3"
                strokeDasharray="3 4"
                fill="none"
                opacity="0.65"
              />
            );
          })}
          {los.map((lo) => {
            const p = pos.get(lo.id);
            if (!p) return null;
            return (
              <g key={lo.id}>
                <circle cx={p.x} cy={p.y} r="8" fill="var(--card)" stroke="var(--accent)" strokeWidth="2.2" />
                <circle cx={p.x} cy={p.y} r="2.6" fill="var(--accent)" opacity="0.8" />
                <text
                  x={p.x}
                  y={p.y + 22}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="var(--ink-faint)"
                  fontFamily="var(--stack-mono)"
                >
                  {lo.id.replace("lo:u", "")}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          ⇢ prerequisite_of · left to right = what must be learned first
        </p>
      </div>

      {/* the load receipt */}
      <div className="border-t border-line-soft bg-card-warm p-5 lg:border-l lg:border-t-0">
        <div className="grid grid-cols-2 gap-5">
          <div>
            <p className="rule-label mb-2">{totalNodes} nodes</p>
            <div className="space-y-1 font-mono text-[11.5px]">
              {nodesByKind.map((k) => (
                <div key={k.kind} className="flex justify-between gap-3">
                  <span className="text-ink-soft">{KIND_LABEL[k.kind] ?? k.kind}</span>
                  <span className="font-semibold text-ink">{k.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="rule-label mb-2">{totalEdges} edges</p>
            <div className="space-y-1 font-mono text-[11.5px]">
              {edgesByType.map((t) => (
                <div key={t.type} className="flex justify-between gap-3">
                  <span
                    className={
                      t.type === "prerequisite_of"
                        ? "font-semibold text-accent-deep"
                        : "text-ink-soft"
                    }
                  >
                    {t.type}
                  </span>
                  <span className="font-semibold text-ink">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <span className="chip">syllabus {syllabusVersion}</span>
          <span className="chip">bitemporal — old versions kept</span>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
          Every dot knows its book page; every arrow knows its syllabus year.
          This is the index the agent walks instead of the PDF.
        </p>

        <Link
          href="/spine"
          className="group mt-4 inline-flex items-center gap-2 text-sm font-semibold text-accent-deep"
        >
          Explore it live in the Evidence Walk
          <span className="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
        </Link>
      </div>
    </div>
  );
}

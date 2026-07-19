import type { PipelineRun } from "@/lib/pipeline-queries";

interface FieldRow {
  name: string;
  type: string;
  provenance?: boolean;
}

const MODELS: { name: string; doc: string; fields: FieldRow[] }[] = [
  {
    name: "Node",
    doc: "one box in the curriculum graph",
    fields: [
      { name: "id", type: "str" },
      { name: "kind", type: "NodeKind" },
      { name: "label", type: "str" },
      { name: "description", type: "str | None" },
      { name: "syllabus_ref", type: "str | None" },
      { name: "source_page", type: "int | None", provenance: true },
      { name: "order_in_parent", type: "int | None" },
    ],
  },
  {
    name: "Edge",
    doc: "one arrow between boxes",
    fields: [
      { name: "src", type: "str" },
      { name: "dst", type: "str" },
      { name: "type", type: "EdgeType" },
    ],
  },
  {
    name: "Question",
    doc: "one practice item, with its worked answer",
    fields: [
      { name: "id", type: "str" },
      { name: "lo", type: "str" },
      { name: "tier", type: "Tier" },
      { name: "type", type: "QuestionType" },
      { name: "stem", type: "str" },
      { name: "choices", type: "list[Choice] | None" },
      { name: "answer", type: "str" },
      { name: "solution", type: "list[str]  # min 1 step" },
      { name: "source_page", type: "int", provenance: true },
      { name: "source_note", type: "str", provenance: true },
    ],
  },
];

const LITERALS: { name: string; values: string[] }[] = [
  { name: "NodeKind", values: ["program", "course", "module", "learning_objective", "topic"] },
  { name: "EdgeType", values: ["part_of", "teaches", "prerequisite_of", "about"] },
  { name: "Tier", values: ["basic", "standard", "advanced"] },
  { name: "QuestionType", values: ["mcq", "numeric", "short"] },
];

export function SchemaStage({ run }: { run: PipelineRun | null }) {
  return (
    <div className="ledger-card overflow-hidden">
      {/* file-tab header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft bg-card-warm px-5 py-3">
        <p className="font-mono text-[11px] tracking-wide text-ink-soft">
          <span className="text-ink-faint">services/extraction/</span>
          <span className="font-semibold text-ink">schemas.py</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <span className="chip">pydantic</span>
          <span className="chip">schema_version {run?.schemaVersion ?? "1"}</span>
          <span className="chip">extractor {run?.extractorVersion ?? "poc-1"}</span>
        </div>
      </div>

      {/* model cards */}
      <div className="grid gap-px bg-line-soft md:grid-cols-3">
        {MODELS.map((m) => (
          <div key={m.name} className="bg-card px-5 py-4">
            <p className="font-mono text-[13px] font-semibold text-ink">
              class <span className="text-accent-deep">{m.name}</span>
              <span className="text-ink-faint">(BaseModel)</span>
            </p>
            <p className="mt-0.5 text-[12px] italic text-ink-faint">{m.doc}</p>
            <div className="mt-3 space-y-1">
              {m.fields.map((f) => (
                <div
                  key={f.name}
                  className={`flex items-baseline justify-between gap-3 rounded px-1.5 py-[3px] font-mono text-[11.5px] ${
                    f.provenance ? "bg-gold-wash" : ""
                  }`}
                >
                  <span className="text-ink">
                    {f.name}
                    {f.provenance && (
                      <span className="ml-1.5 text-[8.5px] uppercase tracking-[0.12em] text-gold">
                        provenance
                      </span>
                    )}
                  </span>
                  <span className="whitespace-nowrap text-ink-faint">{f.type}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* closed vocabularies */}
      <div className="border-t border-line-soft px-5 py-3.5">
        <div className="flex flex-wrap gap-x-7 gap-y-2">
          {LITERALS.map((l) => (
            <p key={l.name} className="font-mono text-[11px] leading-relaxed">
              <span className="font-semibold text-ink">{l.name}</span>
              <span className="text-ink-faint"> = </span>
              {l.values.map((v, i) => (
                <span key={v}>
                  {i > 0 && <span className="text-ink-faint"> | </span>}
                  <span className={v === "prerequisite_of" ? "font-semibold text-accent-deep" : "text-ink-soft"}>
                    &quot;{v}&quot;
                  </span>
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>

      {/* validator strip */}
      <div className="border-t border-dashed border-rust/35 bg-rust-wash px-5 py-3.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-rust">
          SeedBundle validators — runs before anything touches the database
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-[11.5px] text-ink-soft">
          <span>✗ edge to unknown node → <span className="text-rust">rejected</span></span>
          <span>✗ question with unknown LO → <span className="text-rust">rejected</span></span>
          <span>✗ prerequisite cycle → <span className="text-rust">rejected</span> (must be a DAG)</span>
          <span>✗ MCQ answer not among choices → <span className="text-rust">rejected</span></span>
        </div>
      </div>
    </div>
  );
}

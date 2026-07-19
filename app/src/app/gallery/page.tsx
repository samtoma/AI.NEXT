import { getGalleryData } from "@/lib/visuals";
import { Visual } from "@/components/viz/Visual";
import { kindMeta } from "@/components/viz/kind-meta";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Plate Gallery — AI.Next Tutor PoC",
};

/**
 * /gallery — every visual in the spine, rendered live from its {kind, spec}
 * row. One renderer library, hundreds of data specs: this page is the proof
 * that the producer→consumer contract (VIZ_SPEC.md) holds.
 */
export default async function GalleryPage() {
  const data = await getGalleryData();

  return (
    <main className="mx-auto max-w-[1400px] px-6 pb-16">
      {/* header strip */}
      <section className="anim-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-6 pt-9">
        <div className="max-w-2xl">
          <p className="rule-label mb-4">The Plate Gallery</p>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink md:text-4xl">
            Every figure is data.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">
            No image files anywhere in this gallery. Each plate is a{" "}
            <span className="font-mono text-[13px]">{"{kind, spec}"}</span> row
            in the spine, drawn live by one parametric renderer — the same
            primitives the AI tutor pushes into lessons.
          </p>
        </div>
        <div className="flex max-w-md flex-wrap gap-2">
          <span className="chip border-gold/50 text-gold">
            {data.total} plates
          </span>
          <span className="chip">{data.modules.length} modules</span>
          <span className="chip">{data.loCount} objectives illustrated</span>
          {data.kindCounts.map(({ kind, count }) => (
            <span key={kind} className="chip">
              <span aria-hidden>{kindMeta(kind).glyph}</span> {kind} ×{count}
            </span>
          ))}
        </div>
      </section>

      {data.total === 0 ? (
        <EmptyState />
      ) : (
        data.modules.map((mod, mi) => (
          <section
            key={mod.id}
            className="anim-rise pb-10"
            style={{ animationDelay: `${90 + mi * 70}ms` }}
          >
            <p className="rule-label mb-4">
              {mod.label} · {mod.visuals.length} plates
            </p>
            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {mod.visuals.map((v) => (
                <article key={v.id} className="ledger-card flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-line-soft bg-card-warm px-3.5 py-2">
                    <span className="truncate font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                      {v.id}
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-px font-mono text-[9px] tracking-[0.04em] ${kindMeta(v.kind).chip}`}
                    >
                      <span aria-hidden>{kindMeta(v.kind).glyph}</span>
                      {v.kind}
                    </span>
                  </div>

                  <div className="px-3.5 pt-3">
                    <Visual kind={v.kind} spec={v.spec} />
                  </div>

                  <div className="flex flex-1 flex-col px-3.5 pb-3.5 pt-2.5">
                    {v.caption && (
                      <p className="text-[12.5px] leading-relaxed text-ink">
                        {v.caption}
                      </p>
                    )}
                    <div className="mt-auto flex items-end justify-between gap-3 pt-3">
                      <span className="min-w-0">
                        <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                          {v.syllabusRef ?? v.loId}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] font-medium text-ink-soft">
                          {v.loLabel}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {v.questionId && (
                          <span className="chip px-1.5! py-px! text-[9px]!">
                            {v.questionId}
                          </span>
                        )}
                        <span
                          className="stamp-seal px-2! py-1! text-[9px]!"
                          style={{ transform: "rotate(-5deg)" }}
                        >
                          p.{v.sourcePage ?? "—"}
                        </span>
                      </span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
        visuals table · joined lo_id → graph_nodes → teaches edges · rendered by
        components/viz per VIZ_SPEC.md
      </p>
    </main>
  );
}

function EmptyState() {
  return (
    <section className="anim-pop mx-auto max-w-xl py-14">
      <div className="passport px-8 py-10 text-center">
        <span className="stamp-seal stamp-seal--gold inline-block">
          no plates filed
        </span>
        <h2 className="mt-5 font-display text-2xl font-medium text-ink">
          The gallery is waiting for its first figure.
        </h2>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-soft">
          Extraction agents attach animated visuals to learning objectives via
          the <span className="font-mono text-[12px]">visuals[]</span> array of
          a seed bundle. Load one and this wall fills itself.
        </p>
        <p className="mt-5 inline-block rounded-md border border-line-soft bg-card px-3.5 py-2 font-mono text-[11px] text-ink-soft">
          uv run load_seed.py seed/unit1.json --approve-all --demo-student
        </p>
      </div>
    </section>
  );
}

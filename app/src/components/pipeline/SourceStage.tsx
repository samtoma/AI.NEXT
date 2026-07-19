import type { PipelineDoc } from "@/lib/pipeline-queries";

const SCANS = [
  { src: "/book-pages/page-16.jpg", page: 16, note: "the function concept", rot: "-4deg", x: "0%", y: "6%", z: 1 },
  { src: "/book-pages/page-22.jpg", page: 22, note: "quadratic functions", rot: "3.5deg", x: "34%", y: "0%", z: 2 },
  { src: "/book-pages/page-07.jpg", page: 7, note: "Lesson 1-1 · Cartesian product", rot: "-1.5deg", x: "16%", y: "12%", z: 3 },
];

export function SourceStage({ doc }: { doc: PipelineDoc }) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,26rem)_1fr]">
      {/* stacked archive scans */}
      <div className="relative mx-auto aspect-[4/4.4] w-full max-w-[26rem]">
        {SCANS.map((s) => (
          <figure
            key={s.page}
            className="group absolute w-[62%] transition-transform duration-300 hover:-translate-y-1.5"
            style={{ left: s.x, top: s.y, zIndex: s.z, transform: `rotate(${s.rot})` }}
          >
            <div className="border border-line bg-white p-1.5 pb-6 shadow-[0_2px_4px_rgba(32,41,58,0.12),0_18px_36px_-16px_rgba(32,41,58,0.4)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={s.src}
                alt={`Scanned book page ${s.page} — ${s.note}`}
                width={955}
                height={1323}
                className="block w-full select-none"
              />
              <figcaption className="mt-1.5 px-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-faint">
                p.{s.page} · {s.note}
              </figcaption>
            </div>
          </figure>
        ))}
      </div>

      {/* provenance passport */}
      <div className="passport p-6 sm:p-7">
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
              Source of truth · one immutable input
            </p>
            <span className="stamp-seal anim-stamp shrink-0">Ingested ✓</span>
          </div>
          <h3 className="mt-3 font-display text-2xl font-medium leading-snug text-ink">
            {doc.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{doc.publisher}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="chip">edition {doc.edition}</span>
            <span className="chip">grade {doc.grade}</span>
            <span className="chip">{doc.subject}</span>
            <span className="chip">178 pages</span>
            <span className="chip">87 MB</span>
          </div>

          <div className="mt-5 border-t border-dashed border-gold/40 pt-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
              sha-256 · content address
            </p>
            <p className="mt-1.5 break-all font-mono text-[11.5px] leading-relaxed text-accent-deep">
              {doc.sha256}
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              The PDF is stored once and addressed by its hash. Every node,
              question and AI answer downstream carries this fingerprint — if
              the ministry ships a new edition, it gets a new hash and a new
              graph version. Nothing is ever silently overwritten.
            </p>
            <p className="mt-3 font-mono text-[10px] tracking-wide text-ink-faint">
              {doc.filePath} · ingested {doc.ingestedAt.slice(0, 10)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

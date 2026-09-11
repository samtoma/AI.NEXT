import Link from "next/link";
import { getContentAdminView } from "@/lib/content-admin";
import { questionProvenance } from "@/lib/provenance";
import { ProvenanceBadge } from "@/components/ProvenanceBadge";
import { TeX } from "@/components/TeX";
import { IS_MVP1 } from "@/lib/env";

export const dynamic = "force-dynamic";

export const metadata = { title: "Content provenance — admin" };

/**
 * /admin/content — where did every question come from, and has a human read it?
 *
 * This exists because the database has carried provenance since ADR-0008 while
 * nothing showed it. "We authorised unreviewed content" and "we can see which
 * content is unreviewed" are different claims, and only the second one is a
 * control. FR-1108 asks for the count to be reportable on demand; a number in
 * a parity-check log is reportable to whoever runs the parity check, which is
 * not the same as reportable to whoever is responsible.
 *
 * Operator surface, not a student one. It shows stems and answers-adjacent
 * metadata and is reachable only from the internal nav.
 */
export default async function ContentAdminPage() {
  const view = await getContentAdminView();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="rule-label">Content provenance</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          Where every question came from
        </h1>
        <p className="mt-1 max-w-[70ch] text-[14px] text-ink-soft">
          Three states, and the one that matters is whether a human has read the
          item — not whether a machine wrote it. Generated rows sort to the top,
          unchecked before checked.
        </p>
      </header>

      {!IS_MVP1 && (
        <div
          className="mb-6 rounded-xl border px-4 py-3 text-[14px]"
          style={{ borderColor: "var(--gold)", background: "var(--gold-wash)" }}
        >
          This is the <strong>baseline</strong> environment. It must carry no
          generated content at all — any row below tagged “generated” is a
          governance breach, not a content difference (constitution III).
        </div>
      )}

      <section className="mb-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          n={view.live.book}
          k="From the book"
          note="Extracted and gated normally"
        />
        <Tile
          n={view.live.generatedUnchecked}
          k="Generated · unchecked"
          note="Live and servable to students"
          tone="attention"
        />
        <Tile
          n={view.live.generatedChecked}
          k="Generated · checked"
          note="Accepted by a named human"
          tone="confirmed"
        />
        <Tile
          n={view.pendingPromotion}
          k="Waiting on promotion"
          note="Loaded, not yet servable"
        />
      </section>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-left">
              <Th>Question</Th>
              <Th>Provenance</Th>
              <Th>Objective</Th>
              <Th>Tier</Th>
              <Th>Status</Th>
              <Th>Derived from</Th>
              <Th className="text-right">Attempts</Th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((r) => {
              const prov = questionProvenance(r);
              return (
                <tr
                  key={r.id}
                  className="border-b border-line-soft align-top"
                  style={
                    prov.origin === "generated" && !prov.humanChecked
                      ? { background: "var(--gold-wash)" }
                      : undefined
                  }
                >
                  <td className="py-2.5 pr-3">
                    <span className="block font-mono text-[10.5px] text-ink-faint">
                      {r.id}
                    </span>
                    <span className="mt-0.5 block max-w-[32ch] text-ink">
                      <TeX text={r.stem} />
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <ProvenanceBadge question={r} size="md" />
                    {r.reviewedBy && (
                      <span className="mt-1 block font-mono text-[10px] text-ink-faint">
                        {r.reviewedBy}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-ink-soft">
                    <span className="block max-w-[26ch]">{r.loLabel}</span>
                    {r.sourcePage && (
                      <span className="font-mono text-[10px] text-ink-faint">
                        p.{r.sourcePage}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-ink-soft">
                    {r.tier}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[11px] text-ink-soft">
                    {r.status}
                  </td>
                  <td className="py-2.5 pr-3 font-mono text-[10.5px] text-ink-faint">
                    {r.parentQuestionId ?? "—"}
                  </td>
                  <td className="py-2.5 text-right font-mono text-[11px] text-ink-soft">
                    {r.attempts}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-6 max-w-[74ch] text-[13px] text-ink-soft">
        A generated item names the reviewed book question it was derived from,
        so a defect found in one can be traced to its family and that family
        retired together. What to do about a rejected family is still open —
        see{" "}
        <Link href="/spine" className="underline">
          the evidence walk
        </Link>{" "}
        for the per-question passport, and ADR-0008 for the decision that
        allowed any of this.
      </p>
    </main>
  );
}

function Th({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`pb-2 pr-3 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-faint ${className}`}
    >
      {children}
    </th>
  );
}

function Tile({
  n,
  k,
  note,
  tone,
}: {
  n: number;
  k: string;
  note: string;
  tone?: "attention" | "confirmed";
}) {
  const colour =
    tone === "attention"
      ? "var(--gold)"
      : tone === "confirmed"
        ? "var(--nour-progress, #2F9E8F)"
        : "var(--ink)";
  return (
    <div className="ledger-card px-4 py-3">
      <span
        className="block font-display text-[30px] font-bold leading-none"
        style={{ color: colour }}
      >
        {n}
      </span>
      <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
        {k}
      </span>
      <span className="mt-0.5 block text-[12.5px] text-ink-soft">{note}</span>
    </div>
  );
}

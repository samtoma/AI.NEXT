import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import { getCostView } from "@/lib/cost-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Cost — Noor Console" };

/**
 * Re-homed from `/admin/cost` (ADR-0014). The page body below is unchanged; the
 * door in front of it is new, and so is the connection behind it.
 *
 * `cost-billing` and nothing else. The role reads no student content by the
 * queries it is permitted (FR-2406) — every figure on this page is a turn
 * count, a token count or a dollar figure, and there is no message, transcript
 * or preview anywhere in it.
 */
const PATH = "/cost";

export default async function CostConsolePage() {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  return <CostPage operatorId={access.operatorId} />;
}

/**
 * /admin/cost — what the AI spent, and on what (feedback #39, FR-C04).
 *
 * Gated with the rest of `/admin` (#10, #11, #12): this is a business surface,
 * never a student one.
 *
 * Reports only. It sets no budget and enforces no ceiling, because no price
 * exists yet to derive one from — PRD §10 is unset and the EGP 40 figure came
 * from a withdrawn parent price band. What this does is make the per-function
 * question answerable, which is the precondition for setting a price rather
 * than guessing one.
 */
const usd = (v: number) =>
  v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`;
const int = (v: number) => v.toLocaleString("en-US");

/** Surfaces are stored as ids; a founder reading this page should not have to know them. */
const SURFACE_LABEL: Record<string, string> = {
  lesson_learn: "Taught lesson",
  lesson_review: "Quick revision",
  student_chat: "Question in a lesson",
  spine_chat: "Ask the Spine",
};

const KIND_LABEL: Record<string, string> = {
  chat: "Teaching turns",
  upload: "Photo / OCR",
  unattributed: "Before cost attribution existed",
};

async function CostPage({ operatorId }: { operatorId: number }) {
  const view = await getCostView(operatorId, 30);

  if (view.totalTurns === 0) {
    return (
      <main className="mx-auto max-w-[1100px] px-6 py-16">
        <h1 className="font-display text-3xl font-medium text-ink">
          AI cost by function
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
          No model calls recorded in the <strong>{view.environment}</strong>{" "}
          environment in the last {view.windowDays} days. That is an empty
          ledger, not a zero bill — the figures appear once this build serves
          real traffic.
        </p>
      </main>
    );
  }

  const perStudentMonth = (r: { costUsd: number; firstAt: string | null; lastAt: string | null }) => {
    if (!r.firstAt || !r.lastAt) return null;
    const days = Math.max(
      1,
      (new Date(r.lastAt).getTime() - new Date(r.firstAt).getTime()) / 86_400_000
    );
    return (r.costUsd / days) * 30;
  };

  return (
    <main className="mx-auto max-w-[1100px] px-6 py-14">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-faint">
        {view.environment} · last {view.windowDays} days
      </p>
      <h1 className="mt-2 font-display text-3xl font-medium text-ink">
        AI cost by function
      </h1>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
        {int(view.totalTurns)} model calls, {usd(view.totalCostUsd ?? 0)} total.
        Scoped to this environment only — a cost figure that blended the two
        solutions would be a plausible wrong number, and this one is meant to
        be priced against.
      </p>

      {/* by surface — which feature is expensive */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-medium text-ink">
          By function
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          Average per call is the comparable number; total depends on how often
          each one ran.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[46rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-card-warm text-start font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                <th className="px-4 py-2.5 text-start font-medium">Function</th>
                <th className="px-4 py-2.5 text-end font-medium">Calls</th>
                <th className="px-4 py-2.5 text-end font-medium">Avg / call</th>
                <th className="px-4 py-2.5 text-end font-medium">Total</th>
                <th className="px-4 py-2.5 text-end font-medium">In / out tokens</th>
                <th className="px-4 py-2.5 text-end font-medium">Cached in</th>
                <th className="px-4 py-2.5 text-end font-medium">Avg latency</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {view.bySurface.map((r) => (
                <tr key={r.surface} className="border-b border-line-soft last:border-0">
                  <td className="px-4 py-2.5 font-medium text-ink">
                    {SURFACE_LABEL[r.surface] ?? r.surface}
                    <span className="ms-2 font-mono text-[10px] text-ink-faint">
                      {r.surface}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-end">{int(r.turns)}</td>
                  <td className="px-4 py-2.5 text-end font-semibold text-ink">
                    {usd(r.avgCostUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-end">{usd(r.costUsd)}</td>
                  <td className="px-4 py-2.5 text-end text-ink-soft">
                    {int(r.inputTokens)} / {int(r.outputTokens)}
                  </td>
                  <td className="px-4 py-2.5 text-end text-ink-soft">
                    {int(r.cacheReadTokens)}
                  </td>
                  <td className="px-4 py-2.5 text-end text-ink-soft">
                    {Math.round(r.avgLatencyMs)} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* by kind — the OCR guard */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-medium text-ink">
          Teaching against uploads
        </h2>
        <p className="mt-1 max-w-2xl text-[13.5px] text-ink-soft">
          Image tokens are metered separately on purpose — an expensive OCR
          path must not be able to hide inside a blended teaching figure.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {view.byKind.map((k) => (
            <div key={k.kind} className="rounded-xl border border-line bg-card px-5 py-3.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                {KIND_LABEL[k.kind] ?? k.kind}
              </p>
              <p className="mt-1 font-display text-xl font-medium tabular-nums text-ink">
                {usd(k.costUsd)}
              </p>
              <p className="font-mono text-[11px] text-ink-faint">
                {int(k.turns)} calls
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* per student — the only basis a price can be built on */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-medium text-ink">
          Per student
        </h2>
        <p className="mt-1 max-w-2xl text-[13.5px] text-ink-soft">
          The projected month figure extrapolates from this student&apos;s own
          first and last call. With a handful of demo sessions it is a rough
          indication, not a forecast — it becomes meaningful once a real
          student uses the product across weeks.
        </p>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[34rem] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-card-warm font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                <th className="px-4 py-2.5 text-start font-medium">Student</th>
                <th className="px-4 py-2.5 text-end font-medium">Calls</th>
                <th className="px-4 py-2.5 text-end font-medium">Spent</th>
                <th className="px-4 py-2.5 text-end font-medium">Projected / month</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {view.perStudent.map((r) => {
                const proj = perStudentMonth(r);
                return (
                  <tr key={r.studentId} className="border-b border-line-soft last:border-0">
                    <td className="px-4 py-2.5 font-medium text-ink">
                      {r.displayName ?? `#${r.studentId}`}
                    </td>
                    <td className="px-4 py-2.5 text-end">{int(r.turns)}</td>
                    <td className="px-4 py-2.5 text-end">{usd(r.costUsd)}</td>
                    <td className="px-4 py-2.5 text-end text-ink-soft">
                      {proj == null ? "—" : usd(proj)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-10 max-w-3xl border-t border-line-soft pt-5 text-[13px] leading-relaxed text-ink-faint">
        This page reports; it does not enforce. Per-surface turn caps are what
        actually bound spend, and they live in{" "}
        <code className="font-mono">api/ask/route.ts</code>. No numeric cost
        ceiling binds until a price exists to derive one from.
      </p>
    </main>
  );
}

import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { CostSparkline } from "@/components/console/CostSparkline";
import { Chip, Empty, Figure, Panel, Td, Th } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { consoleRoute } from "@/lib/console-routes";
import {
  BUCKET_LABEL,
  PERIODS,
  denseSeries,
  periodLabel,
  periodOf,
  type PeriodDays,
} from "@/lib/cost-model";
import { getCostView, type CostView } from "@/lib/cost-queries";
import { OUTCOME_LABEL, PRICE_BASIS_LABEL, type Outcome } from "@/lib/pricing";

/**
 * Cost — what the product spends, per student, over time (contracts/admin.md
 * §6, FR-2401…FR-2407).
 *
 * `cost-billing` and nothing else. **There is no student content on this page**
 * (FR-2406): every cell is a name, an id, a count, a token figure, a dollar
 * figure, a date or a status word. No message, no transcript, no preview, and
 * no turn count of a conversation — and the role holds no grant that would let
 * one be read even if this page asked.
 *
 * **Every figure says "imputed at list price".** The runtime is a Claude
 * subscription, so no money left a bank account per turn (research A4.4); the
 * word "spent" appears nowhere on this page by design, and `price_basis` is
 * printed beside the figures so a reader can see HOW each was arrived at.
 *
 * **The reconciliation line is computed, not asserted.** It prints the
 * difference when it fails. A tick that cannot turn into a cross is decoration.
 *
 * Reports only. It sets no budget and enforces no ceiling, because no price
 * exists yet to derive one from — PRD §10 is unset and the EGP 40 figure came
 * from a withdrawn parent price band. Per-surface turn caps are what actually
 * bound spend, and they live in `api/ask/route.ts`.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "Cost — Noor Console" };

const PATH = "/cost";

export default async function CostConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const period = periodOf((await searchParams).period);
  return <CostPage operatorId={access.operatorId} period={period} />;
}

/* --------------------------------------------------------------- format */

const usd = (v: number) => (v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(4)}`);
const int = (v: number) => Math.round(v).toLocaleString("en-US");
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Surfaces are stored as ids; a founder reading this page should not have to know them. */
const SURFACE_LABEL: Record<string, string> = {
  lesson_learn: "Taught lesson",
  lesson_review: "Quick revision",
  student_chat: "Question in a lesson",
  spine_chat: "Ask the Spine",
  understanding_check: "End-of-lesson rating",
  upload_parse: "Reading a photo",
};

const KIND_LABEL: Record<string, string> = {
  chat: "Teaching turns",
  understanding: "End-of-lesson ratings",
  upload_parse: "Photo / OCR",
  unattributed: "Before cost attribution existed",
};

const IMPUTED = "US dollars, imputed at list price";

function basisNote(basis: string): string {
  return PRICE_BASIS_LABEL[basis] ?? (basis === "mixed" ? "several price bases" : basis);
}

/* ----------------------------------------------------------------- page */

async function CostPage({
  operatorId,
  period,
}: {
  operatorId: number;
  period: PeriodDays;
}) {
  const view = await getCostView(operatorId, period);
  const periodText = periodLabel(period);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-5 py-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
        {view.environment} environment · {periodText}
      </p>
      <h1 className="mt-1 font-display text-[24px] font-bold text-ink">Cost</h1>
      <p className="mt-1 max-w-[80ch] text-[13px] leading-relaxed text-ink-soft">
        Every figure on this page is <strong>imputed at list price</strong>: the tutor runs on a
        Claude subscription, so these are what the tokens would have cost at published rates, not
        money that left an account. Scoped to this environment only — a figure that blended the two
        solutions would be a plausible wrong number, and this one is meant to be priced against.
      </p>

      <PeriodSwitch current={period} />

      {view.totalTurns === 0 ? (
        <Panel title="Nothing recorded">
          <Empty>
            No model calls in the <strong>{view.environment}</strong> environment over the{" "}
            {periodText}. That is an empty ledger, not a zero bill — the figures appear once this
            build serves real traffic.
          </Empty>
        </Panel>
      ) : (
        <>
          <Headline view={view} periodText={periodText} />
          <PerStudent view={view} periodText={periodText} />
          <BySurface view={view} periodText={periodText} />
          <ByOutcome view={view} periodText={periodText} />
          <PriceBasisPanel view={view} periodText={periodText} />
        </>
      )}

      <p className="mt-5 max-w-[80ch] text-[12.5px] leading-relaxed text-ink-faint">
        This page reports; it does not enforce. No numeric cost ceiling binds until a price exists
        to derive one from (constitution VI, PRD §10). What actually bounds spend is the per-surface
        turn cap in <code className="font-mono text-[12px]">api/ask/route.ts</code>.
      </p>
    </main>
  );
}

/* ------------------------------------------------------- period switch */

function PeriodSwitch({ current }: { current: PeriodDays }) {
  return (
    <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Reporting period">
      <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint">
        Period
      </span>
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`/cost?period=${p}`}
          aria-current={p === current ? "page" : undefined}
          className={
            p === current
              ? "ds-control play-pressable rounded border border-accent/45 bg-accent-wash px-2.5 py-1 text-[12.5px] font-semibold text-accent-deep"
              : "ds-control play-pressable rounded border border-line bg-card px-2.5 py-1 text-[12.5px] text-ink-soft hover:bg-line-soft hover:text-ink"
          }
        >
          {p} days
        </Link>
      ))}
    </nav>
  );
}

/* ----------------------------------------------- headline + the split */

function Headline({ view, periodText }: { view: CostView; periodText: string }) {
  const total = view.totalCostUsd ?? 0;
  return (
    <Panel
      title="The period"
      note={
        <>
          Teaching and photo/OCR are <strong>two figures and are never added into one</strong>{" "}
          (FR-2402): image tokens cost materially more per call, and an expensive OCR path must not
          be able to hide inside a blended teaching number.
        </>
      }
    >
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Figure
          label="All model calls"
          value={usd(total)}
          unit={IMPUTED}
          period={periodText}
          hint={`${int(view.totalTurns)} calls across every surface.`}
        />
        <Figure
          label={BUCKET_LABEL.ai}
          value={usd(view.ai.costUsd)}
          unit={IMPUTED}
          period={periodText}
          hint={`${int(view.ai.turns)} calls · ${int(view.ai.tokens)} tokens · ${basisNote(view.ai.priceBasis)}.`}
        />
        <Figure
          label={BUCKET_LABEL.upload}
          value={usd(view.upload.costUsd)}
          unit={IMPUTED}
          period={periodText}
          hint={
            view.upload.turns === 0
              ? "No photograph was parsed in this period."
              : `${int(view.upload.turns)} photos · ${int(view.upload.tokens)} tokens · ${basisNote(view.upload.priceBasis)}.`
          }
        />
        <Figure
          label="Per student, mean"
          value={
            view.perStudent.length === 0 ? "—" : usd(total / view.perStudent.length)
          }
          unit={IMPUTED}
          period={periodText}
          hint={`${view.perStudent.length} student${view.perStudent.length === 1 ? "" : "s"} had at least one call. A mean over this few is an indication, not a forecast.`}
        />
      </div>

      {view.unattributed.turns > 0 && (
        <p className="mt-4 text-[12.5px] leading-relaxed text-ink-soft">
          A further {usd(view.unattributed.costUsd)} over {int(view.unattributed.turns)} call
          {view.unattributed.turns === 1 ? "" : "s"} is in neither figure:{" "}
          {BUCKET_LABEL.unattributed.toLowerCase()}. Those rows predate the column that says which
          function spent them, and attributing them to a guess would be worse than leaving them
          visible and separate.
        </p>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------- per student */

function PerStudent({ view, periodText }: { view: CostView; periodText: string }) {
  const today = new Date();
  const dense = view.perStudent.map((s) => ({
    student: s,
    points: denseSeries(s.series, view.periodDays, today),
  }));
  // One ceiling for the whole table, so two rows can be compared by eye.
  const ceiling = dense.reduce(
    (max, r) => r.points.reduce((m, p) => Math.max(m, p.costUsd), max),
    0
  );
  const r = view.reconciliation;

  return (
    <Panel
      title="Per student, over time"
      note={
        <>
          The only basis a price can be built on. Each line is that student&apos;s daily imputed
          cost over the {periodText}, drawn against <strong>one shared ceiling of {usd(ceiling)} a
          day</strong> — every row uses the same scale, so a flat line really is a quiet month.
          Closed days come from the nightly rollup; today is a live query and is drawn as a hollow
          marker.
        </>
      }
    >
      {view.perStudent.length === 0 ? (
        <Empty>No student had a model call in this period.</Empty>
      ) : (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <Th>Student</Th>
                <Th>Subscription</Th>
                <Th>Daily cost, shared scale</Th>
                <Th right>Teaching</Th>
                <Th right>Photo / OCR</Th>
                <Th right>Calls</Th>
                <Th right>Last call</Th>
              </tr>
            </thead>
            <tbody>
              {dense.map(({ student: s, points }) => (
                <tr key={s.studentId} className="border-b border-line-soft last:border-0">
                  <Td>
                    {s.displayName ?? "name not recorded"}{" "}
                    <span className="font-mono text-[11px] text-ink-faint">#{s.studentId}</span>
                  </Td>
                  <Td>
                    <Chip tone={s.subscriptionStatus === "active" ? "good" : "neutral"}>
                      {s.subscriptionStatus}
                    </Chip>
                  </Td>
                  <Td>
                    <CostSparkline
                      points={points}
                      ceilingUsd={ceiling}
                      label={`${s.displayName ?? `student ${s.studentId}`}: daily imputed cost over the ${periodText}, highest day ${usd(
                        points.reduce((m, p) => Math.max(m, p.costUsd), 0)
                      )}`}
                    />
                  </Td>
                  <Td right mono>
                    {usd(s.ai.costUsd)}
                  </Td>
                  <Td right mono>
                    {s.upload.turns === 0 ? "—" : usd(s.upload.costUsd)}
                  </Td>
                  <Td right mono>
                    {int(s.ai.turns + s.upload.turns + s.unattributed.turns)}
                  </Td>
                  <Td right mono>
                    {s.lastAt ? s.lastAt.slice(0, 10) : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SC-109, computed on every render rather than asserted once. */}
      <p className="mt-4 text-[12.5px] leading-relaxed text-ink">
        <Chip tone={r.matches ? "good" : "attention"}>
          {r.matches ? "reconciled" : "does not reconcile"}
        </Chip>{" "}
        <span className="ms-1">
          {r.studentsCounted} student{r.studentsCounted === 1 ? "" : "s"} summing to{" "}
          {usd(r.perStudentSumUsd)} against a period total of {usd(r.periodTotalUsd)}
          {r.matches ? (
            <> — the same figure grouped two ways.</>
          ) : (
            <>
              {" "}
              — <strong>a difference of {usd(Math.abs(r.differenceUsd))}</strong>. The per-student
              table is {r.differenceUsd > 0 ? "over" : "under"} the total, which means a row is
              double-counted or a student is missing. Do not price against either figure until this
              says reconciled.
            </>
          )}
        </span>
      </p>

      {!view.freshness.complete && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
          <Chip tone="attention">rollup behind</Chip>{" "}
          <span className="ms-1">
            The lines above account for {usd(view.freshness.seriesSumUsd)} of the{" "}
            {usd(view.freshness.ledgerSumUsd)} in the ledger — {usd(view.freshness.missingUsd)} sits
            on closed days nobody has rolled up yet
            {view.rolledThrough ? ` (stored through ${view.rolledThrough})` : " (the rollup has never run)"}.
            The totals in this table are the ledger&apos;s and are right; it is the daily lines that
            are short. Run <code className="font-mono text-[12px]">npm run rollup:cost -- --all</code>.
          </span>
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------ by surface */

function BySurface({ view, periodText }: { view: CostView; periodText: string }) {
  return (
    <Panel
      title="By function"
      note={
        <>
          Which feature is expensive. <strong>Average per call is the comparable number</strong>;
          the total depends on how often each one ran. Input tokens are uncached input only — the
          cache counters are their own columns, and are no longer also inside that one.
        </>
      }
    >
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>Function</Th>
              <Th right>Calls</Th>
              <Th right>Average per call</Th>
              <Th right>Total</Th>
              <Th right>Input / output tokens</Th>
              <Th right>Read from cache</Th>
              <Th right>Written to cache</Th>
              <Th right>Typical wait</Th>
            </tr>
          </thead>
          <tbody>
            {view.bySurface.map((s) => (
              <tr key={s.surface} className="border-b border-line-soft last:border-0">
                <Td>
                  {SURFACE_LABEL[s.surface] ?? s.surface}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">{s.surface}</span>
                </Td>
                <Td right mono>
                  {int(s.turns)}
                </Td>
                <Td right mono>
                  {usd(s.avgCostUsd)}
                </Td>
                <Td right mono>
                  {usd(s.costUsd)}
                </Td>
                <Td right mono>
                  {int(s.inputTokens)} / {int(s.outputTokens)}
                </Td>
                <Td right mono>
                  {int(s.cacheReadTokens)}
                </Td>
                <Td right mono>
                  {int(s.cacheCreationTokens)}
                </Td>
                <Td right mono>
                  {Math.round(s.avgLatencyMs / 1000)} s
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-faint">
        All figures {IMPUTED.toLowerCase()}, over the {periodText}.
      </p>

      <h3 className="mt-5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
        By kind — the OCR guard
      </h3>
      <div className="mt-2 flex flex-wrap gap-3">
        {view.byKind.map((k) => (
          <div key={k.kind} className="rounded border border-line bg-card px-4 py-2.5">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              {KIND_LABEL[k.kind] ?? k.kind}
            </p>
            <p className="mt-0.5 text-[17px] font-bold tabular-nums text-ink">{usd(k.costUsd)}</p>
            <p className="font-mono text-[11px] text-ink-faint">
              {int(k.turns)} call{k.turns === 1 ? "" : "s"} · {basisNote(k.priceBasis)}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ by outcome */

function ByOutcome({ view, periodText }: { view: CostView; periodText: string }) {
  const failed = view.byOutcome.filter((o) => o.outcome !== "ok");
  return (
    <Panel
      title="How the calls ended"
      note={
        <>
          A turn that was suppressed, failed or timed out <strong>burned tokens and is a cost
          line</strong>, not a missing row. Before this release the redaction path recorded zeros
          and a failed call recorded nothing at all, so a bad day looked cheap.
        </>
      }
    >
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>How it ended</Th>
              <Th right>Calls</Th>
              <Th right>Share of calls</Th>
              <Th right>Cost</Th>
            </tr>
          </thead>
          <tbody>
            {view.byOutcome.map((o) => (
              <tr key={o.outcome} className="border-b border-line-soft last:border-0">
                <Td>
                  {o.outcome === "unrecorded"
                    ? "Not recorded (written before this release)"
                    : OUTCOME_LABEL[o.outcome as Outcome]}
                </Td>
                <Td right mono>
                  {int(o.turns)}
                </Td>
                <Td right mono>
                  {pct(view.totalTurns === 0 ? 0 : o.turns / view.totalTurns)}
                </Td>
                <Td right mono>
                  {usd(o.costUsd)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11.5px] text-ink-faint">
        {failed.length === 0
          ? `Every call in the ${periodText} was answered.`
          : `${int(failed.reduce((n, o) => n + o.turns, 0))} call(s) in the ${periodText} produced no answer and still cost ${usd(
              failed.reduce((n, o) => n + o.costUsd, 0)
            )}, ${IMPUTED.toLowerCase()}.`}
      </p>
    </Panel>
  );
}

/* --------------------------------------------------------- the price check */

function PriceBasisPanel({ view, periodText }: { view: CostView; periodText: string }) {
  const c = view.priceCheck;
  return (
    <Panel
      title="How these figures were priced"
      note={
        <>
          The stored figure is the Claude CLI&apos;s own, which is itself an imputation at published
          list price. Recomputing it from the token counters is an independent check: agreement is
          evidence the counters are right, and a gap is what would have caught the input-token
          defect on the day it shipped.
        </>
      }
    >
      <div className="grid gap-6 sm:grid-cols-3">
        <Figure
          label="As recorded"
          value={usd(c.storedUsd)}
          unit={IMPUTED}
          period={periodText}
          hint="What the runtime reported, row by row."
        />
        <Figure
          label="Recomputed from tokens"
          value={c.recomputedUsd === null ? "—" : usd(c.recomputedUsd)}
          unit={IMPUTED}
          period={periodText}
          hint={
            c.recomputedUsd === null
              ? "No model in this period has a published price on file, so there is nothing to check against."
              : "Token counts times Anthropic's published rates, read 2026-09-21."
          }
        />
        <Figure
          label="Difference"
          value={c.drift === null ? "—" : pct(c.drift)}
          unit="of the larger figure"
          period={periodText}
          hint={
            c.drift === null
              ? "Not computable."
              : c.exceedsThreshold
                ? "Over a tenth apart — somebody should look at the counters."
                : c.legacyTurns > 0
                  ? "Not raised while calls from before this release are in the period — see below."
                  : "Within a tenth: the two agree."
          }
        />
      </div>

      <ul className="mt-4 space-y-1 text-[12.5px] leading-relaxed text-ink-soft">
        {c.legacyTurns > 0 && (
          <li>
            {int(c.legacyTurns)} call{c.legacyTurns === 1 ? "" : "s"} in this period{" "}
            {c.legacyTurns === 1 ? "was" : "were"} written before this release, when the input-token
            column also contained the cached tokens. The recomputation{" "}
            <strong>is expected to run high on those rows</strong>, so the difference above is not
            raised as a problem while any of them are in the period. They age out; the figures do
            not need repairing, because the tokens they describe are gone.
          </li>
        )}
        {c.unpricedTurns > 0 && (
          <li>
            {int(c.unpricedTurns)} call{c.unpricedTurns === 1 ? "" : "s"} could not be priced at all
            — tokens nobody counted. Their cost is <strong>absent, not zero</strong>, so neither
            figure above includes them.
          </li>
        )}
        {c.modelsWithoutPrice.length > 0 && (
          <li>
            No published price is on file for{" "}
            <span className="font-mono text-[12px]">{c.modelsWithoutPrice.join(", ")}</span>, so
            those calls are left out of the recomputation rather than counted as free. Add the rates
            to <code className="font-mono text-[12px]">lib/pricing.ts</code>.
          </li>
        )}
        <li>
          Not money that left an account. When PRD §10 sets a price, this is the number it will be
          compared against.
        </li>
      </ul>
    </Panel>
  );
}

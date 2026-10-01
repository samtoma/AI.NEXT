import Link from "next/link";

import { ConsoleRefusal } from "@/components/console/ConsoleRefusal";
import { ReviewDesk } from "@/components/console/ReviewDesk";
import { Chip, Empty, Figure, Panel, Td, Th, stamp } from "@/components/console/ui";
import { consoleAccess } from "@/lib/console-auth";
import { courseName } from "@/lib/console-course-names";
import { consoleRoute } from "@/lib/console-routes";
import {
  DECISION_LABEL,
  ITEM_KINDS,
  KIND_LABEL,
  REASON_CODES,
  REASON_LABEL,
  doneShare,
  parseFilters,
  type BacklogFilters,
  type Tally,
} from "@/lib/review-gate";
import { GATE_LABEL, type Gate } from "@/lib/review-gate-records";
import { getReviewOverview, type ReviewOverview } from "@/lib/review-gate-queries";

export const dynamic = "force-dynamic";

export const metadata = { title: "Review — Noor Console" };

/**
 * `/review` — the console review gate (migration 036; Samuel's answers 33 and
 * 37, 2026-09-27 and 2026-10-01).
 *
 *   "keep the student always full as if everything has been reviewed … the
 *    aim will be that the console has zero backlog, so I, Tamer and Kamil
 *    will be reviewing one by one"
 *
 * **Internal only.** Students of a maths course already see everything the
 * pipeline extracted (answer 37a); nothing on this page changes that except a
 * reviewer's own decision — a rejection retires a question, an approval can
 * switch a held widget claim on. Review status never reaches a student
 * (ADR-0019): the student build has none of this page's code or addresses.
 *
 * **What is on it**, top to bottom: how far from zero the backlog is; the
 * filters (links, so a filtered queue is a URL a reviewer can hand to
 * another); the one-by-one desk (`ReviewDesk` — the item as the student sees
 * it, its book source and the AI checks, then Approve / Needs fix / Reject);
 * the fix list the pipeline exports; and the breakdowns — by kind, by course
 * and chapter, by reason, and who reviewed what today.
 *
 * `content-review` (FR-2204): signing content as reviewed, retiring it or
 * switching a claim on is exactly the safety control that role is.
 */
const PATH = "/review";

export default async function ReviewConsolePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const access = await consoleAccess(PATH);
  if (!access.ok) {
    return <ConsoleRefusal status={access.status} roles={consoleRoute(PATH)?.roles} />;
  }
  const filters = parseFilters(await searchParams);
  const view = await getReviewOverview(access.operatorId, filters);
  const s = view.summary.all;
  const outstanding = s.open + s.fixRequested;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-6">
      <header className="mb-4">
        <p className="rule-label">Review gate · internal</p>
        <h1 className="mt-1 font-display text-[26px] font-bold text-ink">
          {outstanding === 0 ? "Zero backlog" : `${outstanding} item${outstanding === 1 ? "" : "s"} to zero`}
        </h1>
        <p className="mt-1 max-w-[80ch] text-[14px] text-ink-soft">
          Every maths item no human has signed — questions and their worked solutions, generated
          and widget questions, widget mappings, misconceptions, worked examples, objectives,
          prerequisite links and book-picture stand-ins. Students already see all of it as if it
          were reviewed; this is where we make that true, one item at a time. Only a human stamp
          counts: an AI check is shown as <em>AI-checked, awaiting human</em>.
        </p>
      </header>

      <ZeroBacklog all={s} />

      <ForSamuel view={view} />

      <Filters view={view} />

      <Panel
        title="One by one"
        note={
          <>
            The oldest open item that matches the filters and that nobody else has open. Keys:{" "}
            <kbd className="font-mono">A</kbd> approve · <kbd className="font-mono">F</kbd> needs fix ·{" "}
            <kbd className="font-mono">R</kbd> reject · <kbd className="font-mono">S</kbd> skip ·{" "}
            <kbd className="font-mono">⌘/Ctrl ↵</kbd> send the note · <kbd className="font-mono">Esc</kbd> back.
          </>
        }
        right={<span className="text-[12px] text-ink-soft">{view.openMatching} open match</span>}
      >
        <ReviewDesk key={filterKey(filters)} filters={filters} />
      </Panel>

      <FixList view={view} />

      <div className="grid gap-x-5 lg:grid-cols-2">
        <ByKind view={view} />
        <ByCourse view={view} />
      </div>
      <div className="grid gap-x-5 lg:grid-cols-2">
        <ByReason view={view} />
        <Reviewers view={view} />
      </div>
    </main>
  );
}

/* ------------------------------------------------------------ helpers */

function filterKey(f: BacklogFilters): string {
  return [f.kind ?? "", f.course ?? "", f.module ?? "", f.reason ?? "", f.assignee ?? ""].join("|");
}

function hrefFor(f: BacklogFilters, patch: Partial<Record<keyof BacklogFilters, string | null>>): string {
  const next: Record<string, string> = {};
  for (const k of ["kind", "course", "module", "reason"] as const) {
    const v = k in patch ? patch[k] : f[k];
    if (v) next[k] = v;
  }
  // "For Samuel" is `?for=samuel` in the address.
  const who = "assignee" in patch ? patch.assignee : f.assignee;
  if (who) next.for = who;
  // A chapter belongs to a course: changing the course drops the chapter.
  if ("course" in patch && patch.course !== f.course) delete next.module;
  const qs = new URLSearchParams(next).toString();
  return qs ? `${PATH}?${qs}` : PATH;
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`ds-control-quiet rounded px-2 py-0.5 text-[11.5px] font-medium ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:bg-line-soft hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

const reviewed = (t: Tally) => t.approved + t.rejected;

/* ---------------------------------------------------------- sections */

function ZeroBacklog({ all }: { all: Tally }) {
  const share = doneShare(all);
  return (
    <Panel
      title="Toward zero backlog"
      note="Reviewed = approved or rejected by a person. Waiting on a fix = a reviewer asked for a change; it comes back to the queue once the item has changed."
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Open" value={all.open} unit="items" period="now" />
        <Figure label="Waiting on a fix" value={all.fixRequested} unit="items" period="now" />
        <Figure label="Reviewed" value={reviewed(all)} unit="items" period="all time" />
        <Figure label="In scope" value={all.total} unit="items" period="maths courses, now" />
      </div>
      <div
        className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-line-soft"
        role="progressbar"
        aria-label="Share of items reviewed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div className="h-full rounded-full bg-progress" style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      <p className="mt-1.5 text-[12px] text-ink-soft">
        {Math.round(share * 100)}% reviewed ({reviewed(all)} of {all.total})
      </p>
    </Panel>
  );
}

/**
 * Answer 39: every auto-passed gate decision (G1–G5, per chapter or run) is
 * Samuel's to sign. Listed here for everybody; decided only from his account.
 */
function ForSamuel({ view }: { view: ReviewOverview }) {
  const open = view.forSamuel.filter((r) => r.state === "open" || r.state === "fix_requested");
  return (
    <Panel
      title="For Samuel — auto-passed gates"
      tone={open.length > 0 ? "attention" : "neutral"}
      note={
        <>
          The fan-out passes G1–G5 on the AI checks&rsquo; recommendation (answers 37c, 39); each pass is a decision
          Samuel signs here. An auto-pass is never a human stamp, and G5 moves nothing into production — that is
          still only his explicit go through CI.{" "}
          {view.viewerIsOwner
            ? "You are signed in as Samuel: these are in your queue."
            : view.gateOwnerConfigured
              ? "You can read them; only Samuel's account can decide them."
              : "No account is configured as Samuel's (AINEXT_GATE_OWNER_EMAIL or AINEXT_BOOTSTRAP_OPERATOR_EMAIL), so nobody can decide them yet."}
        </>
      }
      right={
        <Link href={hrefFor({}, { assignee: "samuel" })} className="text-[12px] font-semibold text-ink hover:underline">
          Review them one by one →
        </Link>
      }
    >
      {view.forSamuel.length === 0 ? (
        <Empty>No auto-passed gate decision is on record for a maths course.</Empty>
      ) : (
        <table className="w-full text-[13px] text-ink">
          <thead>
            <tr className="border-b border-line">
              <Th>Gate</Th>
              <Th>Chapter / run</Th>
              <Th>What was auto-decided</Th>
              <Th>When</Th>
              <Th>State</Th>
            </tr>
          </thead>
          <tbody>
            {view.forSamuel.map((r) => (
              <tr key={r.ref} className="border-b border-line-soft align-top">
                <Td>{GATE_LABEL[r.gate as Gate] ?? r.gate}</Td>
                <Td>
                  {r.chapter != null ? `chapter ${r.chapter}` : "whole book"}
                  {r.run ? <div className="font-mono text-[11px] text-ink-faint">{r.run}</div> : null}
                </Td>
                <Td>
                  {r.summary || "—"}
                  <div className="font-mono text-[11px] text-ink-faint">{r.ref}</div>
                </Td>
                <Td>{stamp(r.decidedAt)}</Td>
                <Td>
                  <Chip tone={r.state === "open" ? "attention" : r.state === "approved" ? "good" : "neutral"}>
                    {r.state.replace("_", " ")}
                  </Chip>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Filters({ view }: { view: ReviewOverview }) {
  const f = view.filters;
  const kinds = view.summary.byKind;
  const modules = view.options.modules.filter((m) => !f.course || m.courseId === f.course);
  return (
    <Panel title="Filters" note="Every combination is a URL. The queue below and its count follow them.">
      <FilterGroup label="Whose">
        <FilterLink href={hrefFor(f, { assignee: null })} active={!f.assignee}>
          {view.viewerIsOwner ? "everything" : "everything I can decide"}
        </FilterLink>
        <FilterLink href={hrefFor(f, { assignee: "samuel" })} active={f.assignee === "samuel"}>
          For Samuel · {view.forSamuel.filter((r) => r.state === "open").length}
        </FilterLink>
      </FilterGroup>
      <FilterGroup label="Kind">
        <FilterLink href={hrefFor(f, { kind: null })} active={!f.kind}>
          every kind
        </FilterLink>
        {ITEM_KINDS.filter((k) => kinds[k].total > 0).map((k) => (
          <FilterLink key={k} href={hrefFor(f, { kind: k })} active={f.kind === k}>
            {KIND_LABEL[k]} · {kinds[k].open}
          </FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup label="Course">
        <FilterLink href={hrefFor(f, { course: null })} active={!f.course}>
          every maths course
        </FilterLink>
        {view.options.courses.map((c) => (
          <FilterLink key={c.id} href={hrefFor(f, { course: c.id })} active={f.course === c.id}>
            {c.label}
          </FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup label="Chapter">
        <FilterLink href={hrefFor(f, { module: null })} active={!f.module}>
          every chapter
        </FilterLink>
        {modules.map((m) => (
          <FilterLink key={m.id} href={hrefFor(f, { module: m.id })} active={f.module === m.id}>
            {m.label}
          </FilterLink>
        ))}
      </FilterGroup>
      <FilterGroup label="Why it is open">
        <FilterLink href={hrefFor(f, { reason: null })} active={!f.reason}>
          any reason
        </FilterLink>
        {REASON_CODES.filter((r) => (view.summary.openByReason[r] ?? 0) > 0).map((r) => (
          <FilterLink key={r} href={hrefFor(f, { reason: r })} active={f.reason === r}>
            {REASON_LABEL[r]} · {view.summary.openByReason[r]}
          </FilterLink>
        ))}
      </FilterGroup>
    </Panel>
  );
}

function FixList({ view }: { view: ReviewOverview }) {
  return (
    <Panel
      title="Fix requested"
      note="What the pipeline has to change, with the reviewer's note and suggested correction. Rejections it has to carry out itself (a misconception, worked example, objective or link has no status to flip) are listed too. Students see these items unchanged meanwhile."
      right={
        <a
          href="/api/console/review/fix-requests"
          className="ds-control play-pressable rounded border border-line bg-card px-2.5 py-1 text-[12px] font-semibold text-ink hover:bg-line-soft"
        >
          Export JSON
        </a>
      }
    >
      {view.fixes.length === 0 ? (
        <Empty>Nothing is waiting on the pipeline.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] text-ink">
            <thead>
              <tr className="border-b border-line">
                <Th>Item</Th>
                <Th>Where</Th>
                <Th>What to do</Th>
                <Th>Who, when</Th>
              </tr>
            </thead>
            <tbody>
              {view.fixes.map((x) => (
                <tr key={x.decisionId} className="border-b border-line-soft align-top">
                  <Td>
                    <Chip tone={x.action === "fix" ? "attention" : "neutral"}>
                      {x.action === "fix" ? "fix" : "rejected"}
                    </Chip>{" "}
                    {KIND_LABEL[x.kind]}
                    <div className="font-mono text-[11px] text-ink-faint">{x.ref}</div>
                  </Td>
                  <Td>
                    {courseName(x.courseId)}
                    {x.moduleId ? <div className="text-[12px] text-ink-soft">{view.moduleLabels[x.moduleId] ?? x.moduleId}</div> : null}
                  </Td>
                  <Td>
                    <p className="whitespace-pre-wrap">{x.note}</p>
                    {x.suggestedCorrection ? (
                      <p className="mt-1 whitespace-pre-wrap text-[12px] text-ink-soft">
                        <span className="font-semibold">Suggested:</span> {x.suggestedCorrection}
                      </p>
                    ) : null}
                  </Td>
                  <Td>
                    {x.requestedBy}
                    <div className="text-[11.5px] text-ink-faint">{stamp(x.requestedAt)}</div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function TallyCells({ t }: { t: Tally }) {
  return (
    <>
      <Td right>{t.open}</Td>
      <Td right>{t.fixRequested}</Td>
      <Td right>{reviewed(t)}</Td>
      <Td right>{t.total}</Td>
    </>
  );
}

function TallyHead({ first }: { first: string }) {
  return (
    <thead>
      <tr className="border-b border-line">
        <Th>{first}</Th>
        <Th right>Open</Th>
        <Th right>Fix</Th>
        <Th right>Reviewed</Th>
        <Th right>Total</Th>
      </tr>
    </thead>
  );
}

function ByKind({ view }: { view: ReviewOverview }) {
  return (
    <Panel title="By kind" note="Items in scope now, every maths course.">
      <table className="w-full text-[13px] text-ink">
        <TallyHead first="Kind" />
        <tbody>
          {ITEM_KINDS.map((k) => (
            <tr key={k} className="border-b border-line-soft">
              <Td>
                <Link href={hrefFor(view.filters, { kind: k })} className="hover:underline">
                  {KIND_LABEL[k]}
                </Link>
              </Td>
              <TallyCells t={view.summary.byKind[k]} />
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ByCourse({ view }: { view: ReviewOverview }) {
  return (
    <Panel title="By course and chapter" note="Each course its own rows; two courses are never one figure.">
      {view.summary.byCourse.length === 0 ? (
        <Empty>No maths course is loaded.</Empty>
      ) : (
        <table className="w-full text-[13px] text-ink">
          <TallyHead first="Course · chapter" />
          <tbody>
            {view.summary.byCourse.map((c) => (
              <CourseRows key={c.courseId} view={view} course={c} />
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function CourseRows({
  view,
  course,
}: {
  view: ReviewOverview;
  course: ReviewOverview["summary"]["byCourse"][number];
}) {
  return (
    <>
      <tr className="border-b border-line">
        <Td>
          <Link href={hrefFor(view.filters, { course: course.courseId })} className="font-semibold hover:underline">
            {courseName(course.courseId)}
          </Link>
        </Td>
        <TallyCells t={course.tally} />
      </tr>
      {course.modules.map((m) => (
        <tr key={m.moduleId ?? "none"} className="border-b border-line-soft">
          <Td>
            {m.moduleId ? (
              <Link
                href={hrefFor({ ...view.filters, course: course.courseId }, { module: m.moduleId })}
                className="ps-3 text-ink-soft hover:underline"
              >
                {view.moduleLabels[m.moduleId] ?? m.moduleId}
              </Link>
            ) : (
              <span className="ps-3 text-ink-soft">no chapter</span>
            )}
          </Td>
          <TallyCells t={m.tally} />
        </tr>
      ))}
    </>
  );
}

function ByReason({ view }: { view: ReviewOverview }) {
  const rows = REASON_CODES.filter((r) => (view.summary.openByReason[r] ?? 0) > 0);
  return (
    <Panel title="Why items are open" note="Open items only; an item with two reasons counts under both.">
      {rows.length === 0 ? (
        <Empty>Nothing is open.</Empty>
      ) : (
        <table className="w-full text-[13px] text-ink">
          <thead>
            <tr className="border-b border-line">
              <Th>Reason</Th>
              <Th right>Open items</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r} className="border-b border-line-soft">
                <Td>
                  <Link href={hrefFor(view.filters, { reason: r })} className="hover:underline">
                    {REASON_LABEL[r]}
                  </Link>
                </Td>
                <Td right>{view.summary.openByReason[r]}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Reviewers({ view }: { view: ReviewOverview }) {
  return (
    <Panel title="Who reviewed what" note="Today is the Cairo day; all time is every decision in this environment.">
      {view.reviewingNow.length > 0 ? (
        <p className="mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-soft">
          Reviewing now:
          {view.reviewingNow.map((r) => (
            <Chip key={`${r.kind}|${r.ref}`}>
              {r.operatorName} · {KIND_LABEL[r.kind]}
            </Chip>
          ))}
        </p>
      ) : null}
      {view.reviewers.length === 0 ? (
        <Empty>No decision has been recorded yet.</Empty>
      ) : (
        <table className="w-full text-[13px] text-ink">
          <thead>
            <tr className="border-b border-line">
              <Th>Reviewer</Th>
              <Th right>Approved today</Th>
              <Th right>Fix today</Th>
              <Th right>Rejected today</Th>
              <Th right>All time</Th>
            </tr>
          </thead>
          <tbody>
            {view.reviewers.map((r) => (
              <tr key={r.operatorId} className="border-b border-line-soft">
                <Td>
                  {r.name} <span className="text-ink-faint">#{r.operatorId}</span>
                </Td>
                <Td right>{r.today.approve}</Td>
                <Td right>{r.today.fix_requested}</Td>
                <Td right>{r.today.reject}</Td>
                <Td right>{r.total}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {view.today.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-[12.5px] text-ink-soft">
          {view.today.map((d) => (
            <li key={d.id}>
              <span className="text-ink-faint">{stamp(d.decidedAt)}</span> · {d.operatorName} ·{" "}
              <Chip tone={d.decision === "approve" ? "good" : d.decision === "fix_requested" ? "attention" : "neutral"}>
                {DECISION_LABEL[d.decision]}
              </Chip>{" "}
              {KIND_LABEL[d.kind]} <span className="font-mono text-[11px] text-ink-faint">{d.ref}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

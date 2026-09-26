"use client";

import { Chip } from "@/components/console/ui";
import { SOLUTION_SOURCES, type CourseCompletenessView } from "@/lib/course-completeness";
import { plainMath } from "@/lib/math-text";

/**
 * A course's completeness, in its row of `/courses`, beside the switches that
 * make it visible (feature 003, FR-4309; contracts/console.md
 * `CourseCompleteness`; backlog #16).
 *
 * Three verdicts on one line, so a stocked course cannot be mistaken for a
 * thin one (FR-2701) before anybody opens the detail:
 *   · the pipeline's S8 COVERAGE audit on record for the book — GREEN, RED, or
 *     "no audit on record" for a book loaded before the audit existed;
 *   · the BOOK-SECTION checks — the store's consistency and the parts'
 *     catalogue order (FR-4311, FR-4312);
 *   · how many objectives sit under the TIER FLOOR (FR-4305).
 * The counts and the named rows sit behind a disclosure. Every count is a
 * fold over the rows it names (FR-3212; `summariseCompleteness`).
 *
 * Console surface: the grid's own token classes and `Chip` tones — no
 * literal colour, stroke or radius (constitution XII). "Attention" is the
 * console's gold "look here", never red.
 */
export function CompletenessPanel({ depth }: { depth: CourseCompletenessView }) {
  const d = depth;
  const cov = d.coverage;
  const empty = d.objectives === 0;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  return (
    <details className="mt-2 max-w-[30ch] text-[11.5px] leading-snug text-ink-soft">
      <summary className="flex min-h-[44px] cursor-pointer flex-wrap items-center gap-1.5 py-1">
        <span className="font-semibold text-ink">Completeness</span>
        {cov.state === "green" ? (
          <Chip tone="good">coverage green</Chip>
        ) : cov.state === "red" ? (
          <Chip tone="attention">coverage red</Chip>
        ) : cov.state === "unreadable" ? (
          <Chip tone="attention">coverage unreadable</Chip>
        ) : (
          <Chip>no coverage audit</Chip>
        )}
        {d.sectionChecks.length === 0 ? (
          <Chip tone={empty ? "neutral" : "good"}>sections ok</Chip>
        ) : (
          <Chip tone="attention">{plural(d.sectionChecks.length, "section problem")}</Chip>
        )}
        {!empty && (
          <Chip tone={d.underTierFloor.length === 0 ? "good" : "attention"}>
            {d.underTierFloor.length === 0
              ? "tier floor met"
              : `${d.underTierFloor.length} under tier floor`}
          </Chip>
        )}
      </summary>

      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
        <dt className="text-ink-faint">chapters</dt>
        <dd className="text-ink">
          {d.chapters}
          {d.sections != null && ` · ${plural(d.sections, "printed section")}`}
          {` · ${plural(d.lessons, "lesson")}`}
        </dd>
        <dt className="text-ink-faint">objectives</dt>
        <dd className="text-ink">{d.objectives}</dd>
        <dt className="text-ink-faint">book qs</dt>
        <dd className="text-ink">
          {d.bookQuestions.live} live · {d.bookQuestions.held} held
        </dd>
        <dt className="text-ink-faint">solutions</dt>
        <dd className="text-ink">
          {[...SOLUTION_SOURCES, "unrecorded"]
            .filter((k) => (d.bookQuestions.bySolution[k] ?? 0) > 0)
            .map((k) => `${k} ${d.bookQuestions.bySolution[k]}`)
            .join(" · ") || "—"}
        </dd>
        <dt className="text-ink-faint">worked only</dt>
        <dd className="text-ink">{d.workedExamplesOnly}</dd>
        <dt className="text-ink-faint">generated</dt>
        <dd className="text-ink">
          {d.generated.live} live · {d.generated.held} held · {plural(d.generated.families, "family", "families")}
        </dd>
        <dt className="text-ink-faint">widget qs</dt>
        <dd className="text-ink">
          {d.widget.live} live · {d.widget.held} held
        </dd>
        <dt className="text-ink-faint">misconceptions</dt>
        <dd className="text-ink">
          {d.misconceptions.total} · {d.misconceptions.withExplanation} explained ·{" "}
          {d.misconceptions.total - d.misconceptions.withExplanation} not
        </dd>
      </dl>

      <p className="mt-2 text-ink-soft">
        <span className="font-semibold text-ink">Coverage audit</span>{" "}
        <code className="font-mono text-[10.5px]">{cov.file}</code>
        {cov.state === "none" && " — none on record for this book."}
        {cov.state === "unreadable" && " — present, but it could not be read."}
        {cov.summary && (
          <>
            {" — "}
            {cov.state === "green" ? "GREEN" : "RED"}
            {cov.chapters && cov.chapters !== "all" && ` (chapters ${cov.chapters.join(", ")} only)`}
            {`: ${cov.summary.hold} hold, ${cov.summary.excepted} excepted, ${cov.summary.fail} fail`}
            {cov.missingInputs > 0 && `; ${plural(cov.missingInputs, "input")} missing`}
            {cov.failing.length > 0 && ` — failing: ${cov.failing.join(", ")}`}.
          </>
        )}
      </p>

      {d.sectionChecks.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold text-ink">Book-section checks</p>
          <ul className="mt-0.5 list-disc ps-4">
            {d.sectionChecks.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {d.underTierFloor.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold text-ink">
            Under the tier floor ({d.underTierFloor.length})
          </p>
          <ul className="mt-0.5 max-h-40 list-disc overflow-y-auto ps-4">
            {d.underTierFloor.map((o) => (
              <li key={o.loId}>
                <span className="font-mono text-[10.5px] text-ink-faint">{o.loId}</span>{" "}
                {plainMath(o.label)} — no live {o.missing.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!empty && d.chaptersWithoutWidget.length > 0 && (
        <div className="mt-2">
          <p className="font-semibold text-ink">
            Chapters without a widget question ({d.chaptersWithoutWidget.length})
          </p>
          <ul className="mt-0.5 list-disc ps-4">
            {d.chaptersWithoutWidget.map((m) => (
              <li key={m.moduleId}>{m.label}</li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}

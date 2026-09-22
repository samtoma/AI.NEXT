/**
 * "Who has opened this student's record" (ADR-0015 §4, admin.md §7, FR-2306).
 *
 * The full, filterable audit view lives on the Security surface
 * (`/security?student=<id>`, linked from the panel that wraps this one) —
 * this is the always-visible top 25 for THIS student, unfiltered, at the
 * bottom of every Student 360, because an audit that nobody can see is an
 * audit nobody checks and that has to be true here, on the page that opens
 * the record, not only on a surface an operator has to remember to visit.
 *
 * **Operators see their own reads.** That is the principle, not an oversight:
 * a log whose subject can be hidden from its own reader is a log with a
 * privileged class in it. The reader's own name appearing here is the panel
 * working.
 *
 * Nothing in the console can edit or remove a row: `ainext_operator` holds
 * SELECT and INSERT on `operator_reads` and no UPDATE or DELETE (migration
 * 017). The panel says so, because a reader who assumes otherwise reads it as a
 * list somebody curates.
 */

import { Chip, Td, Th, stamp } from "@/components/console/ui";
import type { OperatorReadRow } from "@/lib/console-queries";

const SURFACE_LABEL: Record<string, string> = {
  student_360: "opened the record",
  session_timeline: "read a session timeline",
  session_replay: "replayed a session",
};

export function AuditPanel({ rows, limit }: { rows: readonly OperatorReadRow[]; limit: number }) {
  if (rows.length === 0) {
    return (
      <p className="text-[13px] leading-relaxed text-ink-soft">
        Nobody has opened this record before — except you, just now. Your own read is written in
        the same transaction as the page you are reading, so it appears on the next open rather
        than in the list above it.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <Th>Who</Th>
              <Th>What they opened</Th>
              <Th>Which session</Th>
              <Th>When</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0">
                <Td>
                  {r.operatorName}{" "}
                  <span className="font-mono text-[11px] text-ink-faint">{r.operatorEmail}</span>
                </Td>
                <Td>
                  <Chip>{SURFACE_LABEL[r.surface] ?? r.surface}</Chip>
                  {r.reason ? (
                    <span className="ms-2 text-[12px] text-ink-soft">{r.reason}</span>
                  ) : null}
                </Td>
                <Td mono>{r.sessionId == null ? "—" : `#${r.sessionId}`}</Td>
                <Td mono>{stamp(r.occurredAt)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2.5 max-w-[78ch] text-[12.5px] leading-relaxed text-ink-faint">
        The {rows.length === limit ? `most recent ${limit}` : `${rows.length}`} recorded reads, most
        recent first. No row here can be edited or deleted from the console, by anyone, including
        the operator who caused it. The session list is deliberately absent from this log: browsing
        sessions is not reading a transcript, and if it were recorded, the rows that mean somebody
        read a child&apos;s conversation would be lost among rows that mean somebody looked at a
        list.
      </p>
    </>
  );
}

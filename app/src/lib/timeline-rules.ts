/**
 * The timeline's judgement, with no database in it (ADR-0015 §2, FR-2303).
 *
 * `lib/timeline.ts` fetches seven independent result sets and hands them here.
 * Everything that decides *what an operator sees* — what order the sources
 * interleave in, which explanation is reachable at all, where a pause is long
 * enough to be evidence — lives in this file, is pure, and is tested directly
 * under `node --test` against fixtures rather than against a seeded database.
 *
 * **Why the ordering rule is written down rather than left to `ORDER BY`.**
 * Seven sources with seven clocks land on the same second all the time: a turn
 * completes, its attempt is graded, the mastery estimate moves, and three rows
 * carry timestamps within a few milliseconds of each other — sometimes in the
 * wrong order, because they are written by different statements in different
 * transactions. A plain sort by time would shuffle them from one page load to
 * the next, and an operator judging whether the tutor taught well would be
 * reading a different story each refresh. So equal times fall back to a fixed
 * rank (cause before consequence: the upload and the turn before the attempt,
 * the attempt before its explanation, the mastery move last) and then to the
 * item's own id, which makes the order **total and stable**.
 *
 * **Why gaps are items.** admin.md §4: "a nine-minute pause before an answer is
 * a signal a playback would only re-enact". A transcript that silently closes
 * the space between 14:02 and 14:11 tells the reader the student answered
 * immediately. The gap is therefore rendered as a row of its own, above the
 * threshold below, rather than left to be computed by eye from two timestamps.
 *
 * This module imports NOTHING. `timeline-rules.test.mts` runs under
 * `node --test`, which has no `@/` alias and no database; a single import of
 * `lib/db` here would take the tests with it.
 */

/** Everything a timeline row has in common, whatever its source. */
export type TimelineBase = {
  /** Stable across renders and unique within a timeline: `kind:rowId`. */
  key: string;
  /** ISO-8601 UTC. The row's own clock — never the session's. */
  at: string;
};

export type TurnItem = TimelineBase & {
  kind: "turn";
  interactionId: number;
  surface: string;
  surfaceKind: string | null;
  turnIndex: number;
  userMessage: string;
  assistantMessage: string;
  citations: unknown[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** US dollars, imputed at list price — never money that left an account. */
  costUsd: number;
  latencyMs: number | null;
  /** `'ok'` when the ledger has no `outcome` column yet (P4 adds it). */
  outcome: string;
  /** The release that rendered it, or null for a turn written before 020. */
  rendererVersion: string | null;
};

export type AttemptItem = TimelineBase & {
  kind: "attempt" | "widget";
  attemptId: number;
  questionId: string;
  questionStem: string | null;
  questionType: string | null;
  /** The stored construction for a widget question (ADR-0009), else null. */
  widgetSpec: unknown;
  loId: string | null;
  loLabel: string | null;
  givenAnswer: string | null;
  correctAnswer: string | null;
  isCorrect: boolean;
  timeMs: number | null;
  modality: string;
  misconceptionId: string | null;
  misconceptionLabel: string | null;
};

export type UnderstandingItem = TimelineBase & {
  kind: "understanding";
  checkId: number;
  loId: string;
  loLabel: string | null;
  mode: string;
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  nextStep: string | null;
  turns: number;
};

export type UploadItem = TimelineBase & {
  kind: "upload";
  uploadId: number;
  fileType: string;
  storagePath: string;
  parseStatus: string;
  parsedText: string | null;
  linkedLoId: string | null;
};

export type MasteryItem = TimelineBase & {
  kind: "mastery";
  masteryId: number;
  loId: string;
  loLabel: string | null;
  /** Null when this is the first estimate the objective ever had. */
  priorScore: number | null;
  posteriorScore: number;
  evidence: unknown;
};

export type ExplanationItem = TimelineBase & {
  kind: "explanation";
  explanationId: number;
  /** Never null: an explanation reaches a timeline only through its attempt. */
  attemptId: number;
  questionId: string;
  model: string;
  promptVersion: string;
  groundedOk: boolean;
  cached: boolean;
};

/**
 * Elapsed time, rendered rather than implied. Synthesised by `insertGaps`;
 * nothing in the database corresponds to it, which is why it has no row id.
 */
export type GapItem = TimelineBase & {
  kind: "gap";
  ms: number;
  /** The item it sits after, for a caller that wants to explain the pause. */
  afterKey: string;
};

export type TimelineItem =
  | TurnItem
  | AttemptItem
  | UnderstandingItem
  | UploadItem
  | MasteryItem
  | ExplanationItem
  | GapItem;

/** A timeline item that came from a row — everything except a synthesised gap. */
export type SourceItem = Exclude<TimelineItem, GapItem>;

/**
 * Below this, a pause is the student reading the question; above it, it is
 * something an operator should see. One minute, stated here once and cited in
 * the interface, so "why is there a gap row here" has an answer that is not
 * "somebody picked a number" (FR-2302's documented-rather-than-discovered rule
 * applied to the same kind of threshold).
 */
export const GAP_THRESHOLD_MS = 60_000;

/**
 * Cause before consequence, for rows that share a timestamp.
 *
 * An upload and a tutor turn are what the student did; an attempt answers them;
 * an explanation answers the attempt; an understanding check summarises a
 * stretch; a mastery movement is the system's conclusion about all of it. Two
 * rows with identical clocks are therefore ordered by which one could have
 * caused the other, which is the order a reader is looking for anyway.
 */
const KIND_RANK: Record<TimelineItem["kind"], number> = {
  upload: 0,
  turn: 1,
  attempt: 2,
  // A widget outcome IS an attempt (ADR-0009) and shares its rank: the two are
  // one table and must not be separated by a tie-break into two blocks.
  widget: 2,
  explanation: 3,
  understanding: 4,
  mastery: 5,
  gap: 6,
};

/** Milliseconds since the epoch, or NaN for a value that is not a timestamp. */
function ms(at: string): number {
  return new Date(at).getTime();
}

/**
 * One total, stable order over every source (FR-2303).
 *
 * Time first, then cause-before-consequence, then the key — so the sort is a
 * function of the data alone and two renders of the same session cannot differ.
 * A row whose timestamp does not parse sorts to the END rather than to 1970:
 * an unreadable clock is a defect to notice at the bottom of the page, not a
 * row silently rewriting the beginning of a transcript.
 */
export function orderTimeline(items: readonly SourceItem[]): SourceItem[] {
  return [...items].sort((a, b) => {
    const ta = ms(a.at);
    const tb = ms(b.at);
    const aBad = Number.isNaN(ta);
    const bBad = Number.isNaN(tb);
    if (aBad || bBad) {
      if (aBad && bBad) return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
      return aBad ? 1 : -1;
    }
    if (ta !== tb) return ta - tb;
    const ra = KIND_RANK[a.kind];
    const rb = KIND_RANK[b.kind];
    if (ra !== rb) return ra - rb;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

/**
 * Insert a `gap` item wherever consecutive items are more than `threshold`
 * apart. Takes an ALREADY-ORDERED list; ordering and gap-finding are separate
 * so the first can be tested without the second having an opinion.
 *
 * Nothing is inserted before the first item: the distance from the session
 * opening to its first interaction is the session's own metadata, shown in the
 * header, and a leading gap row would double-count it.
 */
export function insertGaps(
  ordered: readonly SourceItem[],
  threshold: number = GAP_THRESHOLD_MS
): TimelineItem[] {
  const out: TimelineItem[] = [];
  let prev: SourceItem | null = null;
  for (const item of ordered) {
    if (prev) {
      const delta = ms(item.at) - ms(prev.at);
      if (Number.isFinite(delta) && delta > threshold) {
        out.push({
          kind: "gap",
          key: `gap:${prev.key}`,
          // The gap BEGINS when the previous item did not continue — so it is
          // stamped at the end of the pause, where the reader's eye is.
          at: item.at,
          ms: delta,
          afterKey: prev.key,
        });
      }
    }
    out.push(item);
    prev = item;
  }
  return out;
}

/**
 * `explanation_log` enters through the attempt or not at all
 * (ADR-0015 Consequences, admin.md §4).
 *
 * The table has no `student_id` — only a nullable `attempt_id` — so an
 * explanation whose attempt is missing cannot be attributed to a student, let
 * alone to a session. It is dropped here, and the count comes back with the
 * kept rows so the page can say how many were unreachable instead of letting
 * the absence be reported later as a bug in the merge.
 */
export function reachableExplanations(
  explanations: readonly ExplanationItem[],
  attemptIds: ReadonlySet<number>
): { kept: ExplanationItem[]; unreachable: number } {
  const kept = explanations.filter((e) => attemptIds.has(e.attemptId));
  return { kept, unreachable: explanations.length - kept.length };
}

/** What `buildTimeline` returns beside the items, for the page's header. */
export type TimelineBuild = {
  items: TimelineItem[];
  /** Explanations dropped for having no attempt in this session. */
  unreachableExplanations: number;
  counts: Record<SourceItem["kind"], number>;
};

/**
 * The whole rule, in one call: drop unreachable explanations, order, insert
 * gaps, count what came from where.
 *
 * The counts are per SOURCE kind and deliberately exclude gaps — a gap is a
 * rendering of elapsed time, not a thing that happened, and counting it among
 * the interactions would inflate "what did this student do" by the pauses.
 */
export function buildTimeline(
  items: readonly SourceItem[],
  opts: { gapThresholdMs?: number } = {}
): TimelineBuild {
  const attemptIds = new Set<number>();
  for (const i of items) {
    if (i.kind === "attempt" || i.kind === "widget") attemptIds.add(i.attemptId);
  }

  const explanations: ExplanationItem[] = [];
  const rest: SourceItem[] = [];
  for (const i of items) {
    if (i.kind === "explanation") explanations.push(i);
    else rest.push(i);
  }
  const { kept, unreachable } = reachableExplanations(explanations, attemptIds);

  const ordered = orderTimeline([...rest, ...kept]);
  const counts: Record<SourceItem["kind"], number> = {
    turn: 0,
    attempt: 0,
    widget: 0,
    understanding: 0,
    upload: 0,
    mastery: 0,
    explanation: 0,
  };
  for (const i of ordered) counts[i.kind] += 1;

  return {
    items: insertGaps(ordered, opts.gapThresholdMs ?? GAP_THRESHOLD_MS),
    unreachableExplanations: unreachable,
    counts,
  };
}

/**
 * A duration an operator can read, with its unit attached (FR-2211: every
 * figure carries its unit). `null` for a missing measurement, which callers
 * render as "not recorded" — never as 0, which is a claim.
 */
export function humanDuration(msValue: number | null | undefined): string | null {
  if (msValue == null || !Number.isFinite(msValue) || msValue < 0) return null;
  const s = Math.round(msValue / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs === 0 ? `${m} min` : `${m} min ${rs} s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h} h` : `${h} h ${rm} min`;
}

/**
 * Wall-clock span of a session, in milliseconds, or null while it is open.
 *
 * Kept here beside `humanDuration` because it is half of the pair of numbers
 * admin.md §2 refuses to blend: this one is how long the sitting lasted, the
 * other is how long the student spent on questions inside it. One is not an
 * approximation of the other and neither is derivable from the other.
 */
export function sessionWallClockMs(
  openedAt: string,
  closedAt: string | null
): number | null {
  if (!closedAt) return null;
  const d = ms(closedAt) - ms(openedAt);
  return Number.isFinite(d) && d >= 0 ? d : null;
}

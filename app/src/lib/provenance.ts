/**
 * Where a question came from, derived in one place (FR-1108).
 *
 * The database has carried this since ADR-0008 — `source`, `reviewed_by` and
 * `parent_question_id` — but carrying it is not the same as showing it. An
 * operator looking at a question had no way to tell whether a human had ever
 * read it, which is exactly the fact the review-gate suspension makes it
 * important to be able to see.
 *
 * Three states, and the distinction that matters is NOT book-versus-generated.
 * It is **has a human read this**:
 *
 *   · from the book      — extracted from the ministry textbook and reviewed
 *                          through the normal gate. `source` is 'seed' or
 *                          'authored'.
 *   · generated, checked  — machine-authored, then accepted by a named human
 *                          in the 10% sample. `reviewed_by` is set.
 *   · generated, unchecked — machine-authored, no human has read it. This is
 *                          the state the constitution's standing exception
 *                          exists to permit, and the one that has to be
 *                          countable on demand.
 *
 * Derivation lives here rather than in each component so that the three states
 * cannot drift apart between surfaces — a badge on one screen saying "book"
 * while another calls the same row generated is worse than no badge at all.
 */

export type Origin = "book" | "generated";

export type ProvenanceVerdict = {
  origin: Origin;
  /** true when a named human has accepted this item */
  humanChecked: boolean;
  /** short chip text, for a dense list */
  short: string;
  /** full label, for a detail panel */
  label: string;
  /** one sentence an operator can act on */
  detail: string;
  /**
   * Nour tokens. Amber marks "look at this", never alarm — there is no red in
   * this palette, and an unreviewed question is a known, authorised state
   * rather than a fault.
   */
  tone: "neutral" | "attention" | "confirmed";
};

/** The two `source` values the textbook extraction writes. */
const BOOK_SOURCES = new Set(["seed", "authored"]);

export function questionProvenance(row: {
  source: string | null;
  reviewedBy?: string | null;
  reviewed_by?: string | null;
}): ProvenanceVerdict {
  const reviewedBy = row.reviewedBy ?? row.reviewed_by ?? null;
  const source = (row.source ?? "").trim();

  // Anything not explicitly generated is treated as book content. An unknown
  // source is a data problem, but it is not a reason to label a row
  // "generated" — that would overstate what we know about it.
  if (BOOK_SOURCES.has(source) || source === "") {
    return {
      origin: "book",
      humanChecked: true,
      short: "Book",
      label: "From the textbook",
      detail:
        "Extracted from the ministry textbook and reviewed through the normal gate.",
      tone: "neutral",
    };
  }

  if (reviewedBy) {
    return {
      origin: "generated",
      humanChecked: true,
      short: "Generated ✓",
      label: "Generated, checked by a human",
      detail: `Machine-authored, then accepted by ${reviewedBy}.`,
      tone: "confirmed",
    };
  }

  return {
    origin: "generated",
    humanChecked: false,
    short: "Generated · unchecked",
    label: "Generated, not yet checked",
    detail:
      "Machine-authored. No human has read this item. Permitted in the comparison environment only (constitution III, ADR-0008).",
    tone: "attention",
  };
}

/** Aggregate counts for an operator screen — the shape of the FR-1108 answer. */
export type ProvenanceTally = {
  book: number;
  generatedChecked: number;
  generatedUnchecked: number;
  total: number;
};

export function tallyProvenance(
  rows: { source: string | null; reviewedBy?: string | null; reviewed_by?: string | null }[]
): ProvenanceTally {
  const tally: ProvenanceTally = {
    book: 0,
    generatedChecked: 0,
    generatedUnchecked: 0,
    total: rows.length,
  };
  for (const row of rows) {
    const v = questionProvenance(row);
    if (v.origin === "book") tally.book += 1;
    else if (v.humanChecked) tally.generatedChecked += 1;
    else tally.generatedUnchecked += 1;
  }
  return tally;
}

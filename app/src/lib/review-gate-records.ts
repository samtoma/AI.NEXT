/**
 * AUTO-PASSED GATE DECISIONS, as the review gate reads them (Samuel's answers
 * 37c and 39, 2026-10-01: the fan-out auto-passes G1–G5 on the AI checks'
 * recommendation, and every auto-passed gate decision is marked for SAMUEL's
 * review in the console). Pure: no file system, no database — the files are
 * read by `lib/review-gate-files.ts`.
 *
 * An auto-pass is never a human stamp (answer 33). Each record becomes one
 * backlog item of kind `gate_decision`, assigned to Samuel: any reviewer can
 * view it, only Samuel's account can approve, ask for a fix or reject it.
 *
 * ---------------------------------------------------------------------------
 * THE SHAPE THE CONSOLE RELIES ON — `ainext.gate-decision/1`
 * ---------------------------------------------------------------------------
 * One JSON file per gate decision, under
 * `services/extraction/runs/<book>/gates/<anything>.json`:
 *
 *   {
 *     "format": "ainext.gate-decision/1",
 *     "gate": "G1" | "G2" | "G3" | "G4" | "G5",
 *     "book": "g10-math",                       // a pipeline book (books/<book>.json)
 *     "id": "g1-ch09",                          // unique per book; the item is "<book>/<id>"
 *     "chapter": 9,                             // or null for a whole-book decision…
 *     "run": "fanout-2026-10-02",               // …and/or the run it belongs to (optional)
 *     "decided_at": "2026-10-02T09:14:00Z",
 *     "by": "auto-pass G1 (AI recommendation)", // never a person's name
 *     "auto": true,
 *     "outcome": "pass" | "pass_with_holds" | "blocked",
 *     "summary": "13 objectives approved on the evidence check; 1 link kept; 3 items outside the chapter",
 *     "decisions": [ {"key": "lo:g10m9s1-1-1", "decision": "approve", "detail": "…", "basis": "evidence check kept it"} ],
 *     "checks":    [ {"name": "coverage", "state": "green", "detail": "…"} ],
 *     "evidence":  [ {"label": "G1 check", "path": "services/extraction/objectives/g10-math/ch09.check.json"} ],
 *     "blocked":   [ "what did NOT auto-pass, if anything" ]
 *   }
 *
 * Paths in `evidence` are repository-relative. Unknown fields are ignored;
 * missing optional ones read as empty. The record's content is fingerprinted:
 * a re-run that rewrites a decision puts it back in front of Samuel.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE PIPELINE WRITES TODAY, READ TOO (`auto_pass_gates.py`)
 * ---------------------------------------------------------------------------
 * Until every gate writes the record above, the auto-pass files G1–G4 already
 * write are read as gate decisions as well — `"auto": true`, or signed
 * "auto-pass G<n> (AI recommendation)":
 *   runs/<book>/objectives/g1-chNN.auto.json   G1, chapter NN
 *   runs/<book>/g2.json                        G2, its auto items grouped by chapter
 *   runs/<book>/g3-chNN.auto.json              G3, chapter NN
 *   runs/<book>/g4-chNN.auto.json              G4, chapter NN
 * A record in `gates/` for the same gate and chapter replaces what is read
 * from these.
 */

export const GATES = ["G1", "G2", "G3", "G4", "G5"] as const;
export type Gate = (typeof GATES)[number];

export const GATE_LABEL: Record<Gate, string> = {
  G1: "G1 · objectives and links",
  G2: "G2 · the book's questions and solutions",
  G3: "G3 · generated sample and widget mappings",
  G4: "G4 · misconception catalogue",
  G5: "G5 · go / no-go (dry run, coverage, drift guard, cost)",
};

export const RECORD_FORMAT = "ainext.gate-decision/1";

export interface GateDecisionLine {
  key: string;
  decision: string;
  detail?: string;
  basis?: string;
}

export interface GateRecord {
  /** "<book>/<id>" — the backlog item's ref */
  ref: string;
  book: string;
  gate: Gate;
  chapter: number | null;
  run: string | null;
  decidedAt: string;
  by: string;
  auto: boolean;
  outcome: "pass" | "pass_with_holds" | "blocked" | "unknown";
  summary: string;
  decisions: GateDecisionLine[];
  checks: { name: string; state: string; detail?: string }[];
  evidence: { label: string; path: string }[];
  blocked: string[];
  /** the file it was read from, repository-relative */
  source: string;
  /** read from the record format, or adapted from an auto-pass file */
  origin: "record" | "auto-file";
}

const BOOK = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function gateOf(v: unknown): Gate | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  const m = s.match(/\bG([1-5])\b/);
  return m ? (`G${m[1]}` as Gate) : null;
}

/** Is a stamp an auto-pass ("auto-pass G<n> (AI recommendation)")? */
export const isAutoPassStamp = (s: unknown) => typeof s === "string" && /^auto-pass /i.test(s.trim());

const iso = (v: unknown, fallback: string): string => {
  const s = typeof v === "string" ? v : "";
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};

const chapterFromName = (file: string): number | null => {
  const m = file.match(/-ch(\d{1,2})\b/);
  return m ? Number(m[1]) : null;
};

const pad = (n: number) => String(n).padStart(2, "0");

/** The canonical record. Null when it is not one, or names no gate / book / id. */
export function parseRecord(raw: unknown, source: string, fallbackTime: string): GateRecord | null {
  if (!isObj(raw) || raw.format !== RECORD_FORMAT) return null;
  const gate = gateOf(raw.gate);
  const book = str(raw.book, 64);
  const id = str(raw.id, 100);
  if (!gate || !book || !BOOK.test(book) || !id || !ID.test(id)) return null;
  const outcome = raw.outcome === "pass" || raw.outcome === "pass_with_holds" || raw.outcome === "blocked" ? raw.outcome : "unknown";
  const lines = (v: unknown): GateDecisionLine[] =>
    Array.isArray(v)
      ? v.filter(isObj).slice(0, 2000).map((d) => ({
          key: str(d.key, 300) ?? "?",
          decision: str(d.decision, 80) ?? "?",
          ...(str(d.detail) ? { detail: str(d.detail)! } : {}),
          ...(str(d.basis) ? { basis: str(d.basis)! } : {}),
        }))
      : [];
  return {
    ref: `${book}/${id}`,
    book,
    gate,
    chapter: typeof raw.chapter === "number" && Number.isInteger(raw.chapter) ? raw.chapter : null,
    run: str(raw.run, 120),
    decidedAt: iso(raw.decided_at, fallbackTime),
    by: str(raw.by, 200) ?? "unsigned",
    auto: raw.auto === true,
    outcome,
    summary: str(raw.summary) ?? "",
    decisions: lines(raw.decisions),
    checks: Array.isArray(raw.checks)
      ? raw.checks.filter(isObj).slice(0, 200).map((c) => ({
          name: str(c.name, 120) ?? "?",
          state: str(c.state, 40) ?? "?",
          ...(str(c.detail) ? { detail: str(c.detail)! } : {}),
        }))
      : [],
    evidence: Array.isArray(raw.evidence)
      ? raw.evidence
          .filter(isObj)
          .slice(0, 50)
          .map((e) => ({ label: str(e.label, 120) ?? "evidence", path: str(e.path, 400) ?? "" }))
          .filter((e) => e.path && !e.path.includes(".."))
      : [],
    blocked: Array.isArray(raw.blocked) ? raw.blocked.filter((b): b is string => typeof b === "string").slice(0, 200) : [],
    source,
    origin: "record",
  };
}

/** Flatten an auto-pass file's containers into decision lines. */
function linesOf(doc: Record<string, unknown>): GateDecisionLine[] {
  const out: GateDecisionLine[] = [];
  const add = (key: string, decision: string, detail?: unknown) =>
    out.push({ key, decision, ...(str(detail) ? { detail: str(detail)! } : {}) });
  const objects: [string, string][] = [
    ["objectives", "objective"],
    ["terminology", "terminology"],
    ["move_items", "place item"],
    ["links", "link"],
    ["outside_items", "outside the chapter"],
    ["verdicts", "verdict"],
  ];
  for (const [field, label] of objects) {
    const o = doc[field];
    if (!isObj(o)) continue;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") add(k, `${label}: ${v}`);
      else if (isObj(v)) add(k, `${label}: ${str(v.action, 40) ?? str(v.verdict, 40) ?? "decided"}`, v.why ?? v.note);
      else add(k, label);
    }
  }
  for (const [field, label] of [
    ["acknowledged", "acknowledged"],
    ["kept", "kept"],
    ["dropped_by_verifier", "dropped by the verifier"],
  ] as const) {
    const a = doc[field];
    if (Array.isArray(a)) for (const k of a) if (typeof k === "string") add(k, label);
  }
  return out;
}

/**
 * The auto-pass files `auto_pass_gates.py` writes today, as gate records. A
 * file that is not an auto-pass (no `"auto": true`, no auto-pass stamp) is no
 * gate decision for Samuel — a human already signed it.
 */
export function parseAutoFile(raw: unknown, source: string, book: string, fallbackTime: string): GateRecord[] {
  if (!isObj(raw) || !BOOK.test(book)) return [];
  const name = source.split("/").pop() ?? source;

  // G2's file merges human and auto verdicts across chapters: its AUTO items, by chapter.
  if (/^g2\.json$/.test(name) || gateOf(raw.gate) === "G2") {
    if (!isObj(raw.items)) return [];
    const fileAuto = raw.auto === true || isAutoPassStamp(raw.by);
    const byChapter = new Map<number | null, GateDecisionLine[]>();
    for (const [key, v] of Object.entries(raw.items)) {
      if (!isObj(v) || !(v.auto === true || isAutoPassStamp(v.by) || (fileAuto && v.by === undefined))) continue;
      const m = key.match(/^[a-z0-9]*?m(\d{1,2})s\d/);
      const ch = m ? Number(m[1]) : null;
      const list = byChapter.get(ch) ?? [];
      list.push({ key, decision: str(v.verdict, 40) ?? "?", ...(str(v.note) ? { detail: str(v.note)! } : {}) });
      byChapter.set(ch, list);
    }
    return [...byChapter.entries()].map(([chapter, decisions]) => ({
      ref: `${book}/g2${chapter == null ? "" : `-ch${pad(chapter)}`}`,
      book,
      gate: "G2" as const,
      chapter,
      run: null,
      decidedAt: iso(raw.at ?? raw.date, fallbackTime),
      by: "auto-pass G2 (AI recommendation)",
      auto: true,
      outcome: "unknown" as const,
      summary: `${decisions.length} book item(s) decided on the AI recommendation`,
      decisions,
      checks: [],
      evidence: [{ label: "G2 verdicts", path: source }],
      blocked: [],
      source,
      origin: "auto-file" as const,
    }));
  }

  const stamp = str(raw.by, 200) ?? str(raw.reviewer, 200);
  if (!(raw.auto === true || isAutoPassStamp(stamp))) return [];
  const gate = gateOf(raw.gate) ?? gateOf(stamp) ?? gateOf(name.match(/^g(\d)/i)?.[0]);
  if (!gate) return [];
  const chapter = chapterFromName(name);
  const decisions = linesOf(raw);
  return [
    {
      ref: `${book}/${gate.toLowerCase()}${chapter == null ? `-${name.replace(/\.json$/, "")}` : `-ch${pad(chapter)}`}`,
      book,
      gate,
      chapter,
      run: null,
      decidedAt: iso(raw.at, fallbackTime),
      by: stamp ?? `auto-pass ${gate} (AI recommendation)`,
      auto: true,
      outcome: "unknown",
      summary: str(raw.rule) ?? `${decisions.length} decision(s) on the AI recommendation`,
      decisions,
      checks: [],
      evidence: [{ label: `${gate} auto-pass file`, path: source }],
      blocked: [],
      source,
      origin: "auto-file",
    },
  ];
}

/** Both sources together: a canonical record replaces an adapted one for the same gate and chapter. */
export function mergeRecords(records: readonly GateRecord[]): GateRecord[] {
  const key = (r: GateRecord) => `${r.book}|${r.gate}|${r.chapter ?? "-"}`;
  const canonical = new Set(records.filter((r) => r.origin === "record").map(key));
  const seen = new Set<string>();
  const out: GateRecord[] = [];
  for (const r of records) {
    if (r.origin === "auto-file" && canonical.has(key(r))) continue;
    if (seen.has(r.ref)) continue;
    seen.add(r.ref);
    out.push(r);
  }
  return out.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt) || a.ref.localeCompare(b.ref));
}

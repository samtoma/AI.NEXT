/**
 * THE CONSOLE REVIEW GATE against a REAL Postgres (migration 036; Samuel's
 * answers 33 and 37; `lib/review-gate-queries.ts`).
 *
 *   · **035 then 036, verbatim**, over a database holding every legacy stamp
 *     the pilot carries — so the backlog is derived from what 035's backfill
 *     actually leaves, not from what it is supposed to leave.
 *   · **Derivation per kind**: book, generated and widget questions, widget
 *     claims (active and held), misconceptions, worked examples, objectives,
 *     prerequisite links and a book-picture stand-in. Social Studies and
 *     retired questions are not in it; AI stamps are not reviews.
 *   · **Claim exclusivity**: two reviewers never get the same item — not in
 *     sequence, not racing for it, not by writing a claim in another's name;
 *     an expired claim can be taken over.
 *   · **Deciding**: approve writes the human stamp (and promotes a question
 *     loaded for review with no safety hold, but never past a hold); reject
 *     retires; a fix request lands on the fix list and leaves it when the item
 *     changes; a stale fingerprint, a missing note or another reviewer's claim
 *     writes nothing. Widget claims move in and out of `diagnostics`; a
 *     misconception's refutation is marked reviewed; a rejected stand-in holds
 *     its question.
 *   · **The record is append-only and in the operator's own name**, and the
 *     student role cannot read it.
 *
 * **Opt-in**, like `console-curriculum-db.test.mts`: it runs only when
 * `AINEXT_SCRATCH_PG` names a maintenance-database DSN for a SUPERUSER (it
 * creates a database and `SET ROLE`s to `ainext_operator` and `ainext_app`,
 * which must exist on the cluster — `scripts/local-dev.sh` creates them):
 *
 *   AINEXT_SCRATCH_PG=postgres://localhost:5432/postgres \
 *     node --import ./scripts/ts-resolver.mjs --test src/lib/review-gate-db.test.mts
 *
 * It creates ONE database, `ainext_review_gate_<pid>_<ms>`, builds only the
 * content tables the gate reads (their columns as production has them), runs
 * migrations 035 and 036 from `db/migrations/` unchanged, and drops that
 * database by its exact name afterwards.
 *
 * @covers FR-2204
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import pg from "pg";

// Samuel's account, for the gate decisions (answer 39): configuration, read per call.
process.env.AINEXT_GATE_OWNER_EMAIL = "samuel@example.invalid";

const { claimItem, decide, fixList, loadBacklog, nextFor } = await import("./review-gate-queries.ts");
const { parseRecord } = await import("./review-gate-records.ts");
const { itemKey } = await import("./review-gate.ts");

type Db = { query: pg.Client["query"] };

const DSN = process.env.AINEXT_SCRATCH_PG;
const skip = DSN
  ? false
  : "set AINEXT_SCRATCH_PG to a maintenance-database DSN to run against a scratch database";

const DB = `ainext_review_gate_${process.pid}_${Date.now()}`;
const ENV = "mvp1";
const SAMUEL = 1;
const TAMER = 2;

let admin: pg.Client | null = null;
let a: pg.Client | null = null; // reviewer A's connection
let b: pg.Client | null = null; // reviewer B's connection

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../db/migrations/${file}`, import.meta.url)), "utf8");

/** One unit of work as the console: `ainext_operator`, with the operator on the transaction. */
async function asOperator<T>(c: pg.Client, operatorId: number, fn: (db: Db) => Promise<T>): Promise<T> {
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL ROLE ainext_operator");
    await c.query("SELECT set_config('app.operator_id', $1, true)", [String(operatorId)]);
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

async function q1(sql: string, params: unknown[] = []) {
  return (await a!.query(sql, params)).rows[0];
}

const WIDGET = {
  kind: "number_line_marker",
  spec: { min: -10, max: 10, answer: [3, 9] },
  diagnostics: [{ predicate: "missed-values", misconception_id: "mc:b:stops-at-first-root" }],
  pending_review: [
    {
      predicate: "extra-values",
      misconception_id: "mc:b:keeps-both-roots",
      why: "no restriction in this question to ignore",
      verifier_runs: ["wf_0276c362-c6a", "wf_dbca7b50-327"],
    },
  ],
};

/** One auto-passed G1 for chapter 8 — injected, so the test never reads the worktree's real run files. */
const G1 = parseRecord(
  {
    format: "ainext.gate-decision/1",
    gate: "G1",
    book: "g10-math",
    id: "g1-ch08",
    chapter: 8,
    decided_at: "2026-10-02T09:14:00Z",
    by: "auto-pass G1 (AI recommendation)",
    auto: true,
    outcome: "pass",
    summary: "2 objectives approved on the evidence check; 1 link kept",
    decisions: [{ key: "lo:a", decision: "approve" }],
  },
  "services/extraction/runs/g10-math/gates/g1-ch08.json",
  "2026-10-02T09:14:00.000Z"
)!;
const GATES = async () => [{ ...G1, courseId: "course:us-g10-math-en", fingerprint: "9".repeat(32) }];

before(async () => {
  if (!DSN) return;
  assert.match(DB, /^ainext_review_gate_\d+_\d+$/);
  admin = new pg.Client({ connectionString: DSN });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${DB}" TEMPLATE template0`);
  const url = new URL(DSN);
  url.pathname = `/${DB}`;
  a = new pg.Client({ connectionString: url.toString() });
  b = new pg.Client({ connectionString: url.toString() });
  await a.connect();
  await b.connect();

  // The content tables the gate reads, with production's columns (\d on the pilot).
  await a.query(`
    CREATE TABLE operators (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, email text NOT NULL,
      display_name text NOT NULL, status text NOT NULL DEFAULT 'active', environment text NOT NULL
    );
    CREATE TABLE graph_nodes (
      id text PRIMARY KEY, kind text NOT NULL, label text NOT NULL, description text, syllabus_ref text,
      order_in_parent int, source_page int, subject text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE graph_edges (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, src_id text NOT NULL, dst_id text NOT NULL,
      edge_type text NOT NULL, syllabus_version text NOT NULL DEFAULT '2025-2026',
      system_from timestamptz NOT NULL DEFAULT now(), system_to timestamptz, rationale text
    );
    CREATE TABLE questions (
      id text PRIMARY KEY, lo_id text NOT NULL, tier text NOT NULL, question_type text NOT NULL,
      stem text NOT NULL, choices jsonb, correct_answer text NOT NULL, canonical_solution jsonb NOT NULL,
      solution_version int NOT NULL DEFAULT 1, status text NOT NULL, source text NOT NULL,
      parent_question_id text, source_page int, source_note text, reviewed_by text, reviewed_at timestamptz,
      materialised_from bigint, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE visuals (
      id text PRIMARY KEY, lo_id text NOT NULL, question_id text, kind text NOT NULL, spec jsonb NOT NULL,
      caption text, source_page int, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE misconceptions (
      id text PRIMARY KEY, lo_id text NOT NULL, label text NOT NULL, description text NOT NULL,
      signal text, generated_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE explanation_library (
      id text PRIMARY KEY, lo_id text NOT NULL, misconception_id text, entry_type text NOT NULL,
      content jsonb NOT NULL, source_page int, generated_by text NOT NULL,
      reviewed boolean NOT NULL DEFAULT false, reviewed_by text, reviewed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    -- Production's console and student grants on these tables (017/018).
    GRANT SELECT ON operators, graph_nodes, graph_edges, questions, visuals, misconceptions,
                    explanation_library TO ainext_operator;
    GRANT UPDATE ON questions, explanation_library TO ainext_operator;
    GRANT SELECT ON graph_nodes, graph_edges, questions, visuals, misconceptions,
                    explanation_library TO ainext_app;
  `);

  await a.query(
    `INSERT INTO operators (email, display_name, environment) VALUES
       ('samuel@example.invalid', 'samuel.s.toma', 'mvp1'),
       ('tamer@example.invalid', 'Tamer', 'mvp1')`
  );

  // Two courses: the maths one the gate covers, and a Social Studies one it does not.
  await a.query(`
    INSERT INTO graph_nodes (id, kind, label, subject, order_in_parent, created_at) VALUES
      ('course:us-g10-math-en', 'course', 'Everything Maths, Grade 10', 'math', NULL, '2026-09-26 16:00Z'),
      ('module:g10m-c08', 'module', 'Chapter 8 — Analytical geometry', NULL, 8, '2026-09-26 16:00Z'),
      ('lo:a', 'learning_objective', 'Plot a point', NULL, 1, '2026-09-26 16:00Z'),
      ('lo:b', 'learning_objective', 'Find a missing coordinate', NULL, 2, '2026-09-26 16:00Z'),
      ('course:prep3-social-ar', 'course', 'Social', 'social', NULL, '2026-09-26 16:00Z'),
      ('module:s1', 'module', 'Unit 1', NULL, 1, '2026-09-26 16:00Z'),
      ('lo:s', 'learning_objective', 'A social objective', NULL, 1, '2026-09-26 16:00Z');
    INSERT INTO graph_edges (src_id, dst_id, edge_type, rationale, system_from) VALUES
      ('module:g10m-c08', 'course:us-g10-math-en', 'part_of', NULL, '2026-09-26 16:00Z'),
      ('module:g10m-c08', 'lo:a', 'teaches', NULL, '2026-09-26 16:00Z'),
      ('module:g10m-c08', 'lo:b', 'teaches', NULL, '2026-09-26 16:00Z'),
      ('lo:a', 'lo:b', 'prerequisite_of', 'you plot before you solve for a coordinate', '2026-09-26 16:00Z'),
      ('module:s1', 'course:prep3-social-ar', 'part_of', NULL, '2026-09-26 16:00Z'),
      ('module:s1', 'lo:s', 'teaches', NULL, '2026-09-26 16:00Z');
  `);

  // Every legacy stamp shape the pilot carries, BEFORE 035 splits them.
  const sol = JSON.stringify([{ step: 1, text_md: "$m=-\\\\frac{1}{3}$" }]);
  const qs: [string, string, string, string, string, string | null, string | null][] = [
    // id, lo, type, status, source, reviewed_by, choices
    ["q:book1", "lo:a", "short", "live", "seed", "ai dual-check (pending Samuel)", null],
    ["q:book2", "lo:a", "short", "live", "seed", "Samuel Toma (G2 fix)", null],
    ["q:book3", "lo:a", "short", "live", "seed",
      "Samuel Toma (G2 accept); stem fixed by orchestrator (data-engineer agent), 2026-09-27 — not Samuel", null],
    ["q:held", "lo:b", "short", "review", "seed", "ai dual-check (pending Samuel) [held: figure missing]", null],
    ["q:gen1", "lo:b", "mcq", "review", "variant", null,
      JSON.stringify([{ key: "A", text: "ABCD" }, { key: "B", text: "DCBA", misconception_id: "mc:a:descending" }])],
    ["q:w1", "lo:b", "widget", "live", "variant", null, JSON.stringify(WIDGET)],
    ["q:fig", "lo:a", "short", "live", "seed", "local-dev (pilot scratch)", null],
    ["q:retired", "lo:a", "short", "retired", "seed", null, null],
    ["q:social", "lo:s", "mcq", "live", "authored", "ai dual-check (pending Samuel)", null],
  ];
  for (const [id, lo, type, status, source, rb, choices] of qs) {
    await a.query(
      `INSERT INTO questions (id, lo_id, tier, question_type, stem, choices, correct_answer, canonical_solution,
                              status, source, reviewed_by, reviewed_at, source_page, source_note, created_at)
       VALUES ($1, $2, 'standard', $3, $4, $5, 'A', $6, $7, $8, $9, CASE WHEN $9::text IS NULL THEN NULL ELSE now() END,
               305, 'Exercise 8-4 · p.305', '2026-09-26 16:14Z')`,
      [id, lo, type, `Stem of ${id} [figure]`, choices, sol, status, source, rb]
    );
  }
  await a.query(`
    INSERT INTO misconceptions (id, lo_id, label, description, generated_by, created_at) VALUES
      ('mc:b:keeps-both-roots', 'lo:b', 'Keeps both roots', 'Keeps a root a condition rules out.',
       'S5 runbook/misconceptions.workflow.js (Sonnet author) — pipeline-generated, UNREVIEWED', '2026-09-26 16:20Z'),
      ('mc:b:stops-at-first-root', 'lo:b', 'Stops at the first root', 'Finds one solution and stops.',
       'S5 runbook/misconceptions.workflow.js (Sonnet author) — pipeline-generated, UNREVIEWED', '2026-09-26 16:20Z');
    INSERT INTO explanation_library (id, lo_id, misconception_id, entry_type, content, generated_by, created_at) VALUES
      ('expl:mc:b:stops-at-first-root', 'lo:b', 'mc:b:stops-at-first-root', 'refutation',
       '[{"step": 1, "text_md": "There are two values."}]', 'S5', '2026-09-26 16:20Z'),
      ('we:b:1', 'lo:b', NULL, 'worked_example', '[{"step": 1, "text_md": "Worked."}]',
       'book (book_worked_epub)', '2026-09-26 16:20Z');
    INSERT INTO visuals (id, lo_id, question_id, kind, spec, created_at) VALUES
      ('v:fig1', 'lo:a', 'q:fig', 'book_image',
       '{"src": "/book-figures/g10-maths/fig-8-12.png", "alt": "A quadrilateral", "stand_in": true, "native_kind_needed": "geo_scene"}',
       '2026-09-26 16:30Z'),
      ('v:native', 'lo:a', 'q:book1', 'coordinate_plot', '{"points": [[1, 2]]}', '2026-09-26 16:30Z');
  `);

  await a.query(migration("035-human-review-stamps.sql"));
  await a.query(migration("036-review-gate.sql"));
});

after(async () => {
  for (const c of [a, b]) await c?.end().catch(() => {});
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin.end();
  }
});

const byKind = (items: { kind: string }[]) =>
  items.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});

/* ------------------------------------------------------------ derivation */

test("the backlog is every maths item without a human stamp — derived kind by kind", { skip }, async () => {
  const items = await asOperator(a!, SAMUEL, (db) => loadBacklog(db, ENV, null, GATES));
  assert.deepEqual(byKind(items), {
    book_question: 5, // book1, book2, book3, held, fig
    generated_question: 1,
    widget_question: 1,
    mapping_claim: 2,
    misconception: 2,
    worked_example: 1,
    objective: 2,
    prerequisite_link: 1,
    figure_stand_in: 1,
    gate_decision: 1,
  });
  const get = (ref: string) => items.find((i) => i.ref === ref)!;

  assert.equal(get("q:book1").state, "open");
  assert.deepEqual(get("q:book1").reasons.map((r) => r.code), ["ai_checked"], "035 moved the AI stamp; still not a review");
  assert.equal(get("q:book2").state, "approved", "a G2 stamp is a human review");
  assert.deepEqual(get("q:book3").reasons.map((r) => r.code), ["changed_after_review"]);
  assert.deepEqual(get("q:held").reasons, [
    { code: "ai_checked", detail: "ai dual-check" },
    { code: "blocked", detail: "figure_missing" },
  ]);
  assert.equal(get("q:fig").reasons[0]!.code, "promoted_without_review");
  assert.equal(get("q:w1").kind, "widget_question");
  assert.equal(get("q:w1|extra-values|mc:b:keeps-both-roots").exposure, "inactive");
  assert.equal(get("q:w1|missed-values|mc:b:stops-at-first-root").exposure, "active");
  assert.equal(get("v:fig1").reasons[0]!.code, "needs_native_figure");
  assert.equal(get("lo:a>lo:b").kind, "prerequisite_link");
  const gate = get("g10-math/g1-ch08");
  assert.equal(gate.assignee, "samuel");
  assert.equal(gate.moduleId, "module:g10m-c08", "a chapter's gate sits with its chapter");
  assert.equal(gate.state, "open");

  assert.equal(items.some((i) => i.ref === "q:social"), false, "Social Studies keeps its own queue");
  assert.equal(items.some((i) => i.ref === "q:retired"), false, "a retired question is not served, not reviewed");
  assert.equal(items.some((i) => i.ref === "v:native"), false, "a native figure is part of its question, not a stand-in");
});

test("the fingerprint follows the content, never the stamp or the status", { skip }, async () => {
  const fp = async () => (await asOperator(a!, SAMUEL, (db) => loadBacklog(db, ENV, { kind: "book_question", ref: "q:book1" }, GATES)))[0]!.fingerprint;
  const before1 = await fp();
  await a!.query(`UPDATE questions SET reviewed_by = 'x', status = 'review' WHERE id = 'q:book1'`);
  assert.equal(await fp(), before1);
  await a!.query(`UPDATE visuals SET spec = '{"points": [[1, 3]]}' WHERE id = 'v:native'`);
  const afterFigure = await fp();
  assert.notEqual(afterFigure, before1, "a changed figure is a changed question");
  await a!.query(`UPDATE questions SET reviewed_by = NULL, status = 'live' WHERE id = 'q:book1'`);
  await a!.query(`UPDATE visuals SET spec = '{"points": [[1, 2]]}' WHERE id = 'v:native'`);
  assert.equal(await fp(), before1);
});

/* ------------------------------------------------------------ claims */

test("two reviewers never get the same item", { skip }, async () => {
  const first = await asOperator(a!, SAMUEL, (db) => nextFor(db, ENV, SAMUEL, {}, new Set(), GATES));
  const second = await asOperator(b!, TAMER, (db) => nextFor(db, ENV, TAMER, {}, new Set(), GATES));
  assert.ok(first.item && second.item);
  assert.notEqual(itemKey(first.item.kind, first.item.ref), itemKey(second.item.kind, second.item.ref));
  assert.deepEqual(second.othersReviewing.map((o) => o.operatorName), ["samuel.s.toma"]);

  // Samuel asks again: his own claim comes back (a reload resumes), and he still holds one item.
  const again = await asOperator(a!, SAMUEL, (db) => nextFor(db, ENV, SAMUEL, {}, new Set(), GATES));
  assert.equal(again.item!.ref, first.item.ref);
  const held = await a!.query(`SELECT count(*)::int AS n FROM review_claims WHERE operator_id = $1`, [SAMUEL]);
  assert.equal(held.rows[0].n, 1, "one item at a time");

  // Tamer cannot take Samuel's live claim, by the queue or by hand.
  assert.equal(
    await asOperator(b!, TAMER, (db) => claimItem(db, ENV, TAMER, first.item!.kind, first.item!.ref)),
    null
  );
  await assert.rejects(
    asOperator(b!, TAMER, (db) =>
      db.query(`INSERT INTO review_claims (environment, item_kind, item_ref, operator_id, expires_at)
                VALUES ($1, 'objective', 'lo:zzz', $2, now() + interval '5 minutes')`, [ENV, SAMUEL])
    ),
    /row-level security/,
    "a claim in somebody else's name is refused"
  );
});

test("racing for one item: the second claim waits, then finds it taken", { skip }, async () => {
  await a!.query("BEGIN");
  await a!.query("SET LOCAL ROLE ainext_operator");
  await a!.query("SELECT set_config('app.operator_id', $1, true)", [String(SAMUEL)]);
  assert.ok(await claimItem(a!, ENV, SAMUEL, "objective", "lo:race"));
  const tamer = asOperator(b!, TAMER, (db) => claimItem(db, ENV, TAMER, "objective", "lo:race"));
  await new Promise((r) => setTimeout(r, 150)); // Tamer is now waiting on Samuel's row
  await a!.query("COMMIT");
  assert.equal(await tamer, null);

  // Expired, it is anybody's.
  await a!.query(`UPDATE review_claims SET claimed_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes'
                   WHERE item_ref = 'lo:race'`);
  assert.ok(await asOperator(b!, TAMER, (db) => claimItem(db, ENV, TAMER, "objective", "lo:race")));
  await a!.query(`DELETE FROM review_claims`);
});

/* ------------------------------------------------------------ deciding */

async function current(kind: string, ref: string) {
  return (await asOperator(a!, SAMUEL, (db) => loadBacklog(db, ENV, { kind: kind as never, ref }, GATES)))[0]!;
}

test("approve signs a question with the reviewer's name — and the record says exactly what changed", { skip }, async () => {
  const item = await current("book_question", "q:book1");
  const r = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "book_question", ref: "q:book1", fingerprint: item.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(r.ok);
  const row = await q1(`SELECT status, reviewed_by, reviewed_at, ai_checked_by FROM questions WHERE id = 'q:book1'`);
  assert.equal(row.reviewed_by, "samuel.s.toma", "the stamp every existing reader trusts");
  assert.ok(row.reviewed_at);
  assert.equal(row.ai_checked_by, "ai dual-check", "the AI check stays on record beside it");
  assert.equal(row.status, "live");
  const d = await q1(`SELECT * FROM review_decisions WHERE id = $1`, [r.ok && r.decisionId]);
  assert.equal(d.operator_id, String(SAMUEL));
  assert.equal(d.operator_name, "samuel.s.toma");
  assert.equal(d.course_id, "course:us-g10-math-en");
  assert.equal(d.module_id, "module:g10m-c08");
  assert.equal(d.changes.reviewed_by.to, "samuel.s.toma");
  assert.equal(d.snapshot.question.id, "q:book1");
  assert.equal((await current("book_question", "q:book1")).state, "approved");
});

test("approve promotes a question loaded for review with no hold — never one a safety check holds", { skip }, async () => {
  const gen = await current("generated_question", "q:gen1");
  const r1 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "generated_question", ref: "q:gen1", fingerprint: gen.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(r1.ok);
  assert.deepEqual(r1.ok && r1.changes.status, { from: "review", to: "live" });

  const held = await current("book_question", "q:held");
  const r2 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "book_question", ref: "q:held", fingerprint: held.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(r2.ok);
  const row = await q1(`SELECT status, hold_reason, reviewed_by FROM questions WHERE id = 'q:held'`);
  assert.deepEqual(row, { status: "review", hold_reason: "figure_missing", reviewed_by: "samuel.s.toma" });
  assert.equal(r2.ok && r2.changes.still_held, "figure_missing");
});

test("reject retires a question; students stop seeing it", { skip }, async () => {
  const item = await current("book_question", "q:book3");
  const noNote = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "book_question", ref: "q:book3", fingerprint: item.fingerprint, decision: "reject" }, GATES)
  );
  assert.equal(!noNote.ok && noNote.error, "note_required");
  const r = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, {
      kind: "book_question", ref: "q:book3", fingerprint: item.fingerprint, decision: "reject",
      note: "the orchestrator's stem no longer matches the book",
    }, GATES)
  );
  assert.ok(r.ok);
  assert.equal((await q1(`SELECT status FROM questions WHERE id = 'q:book3'`)).status, "retired");
  assert.equal(
    (await asOperator(a!, SAMUEL, (db) => loadBacklog(db, ENV, null, GATES))).some((i) => i.ref === "q:book3"),
    false
  );
});

test("a fix request leaves students unchanged, is exported, and comes back once fixed", { skip }, async () => {
  const item = await current("book_question", "q:fig");
  const r = await asOperator(a!, TAMER, (db) =>
    decide(db, ENV, TAMER, {
      kind: "book_question", ref: "q:fig", fingerprint: item.fingerprint, decision: "fix_requested",
      note: "the key should be -1/3", suggestedCorrection: "$-\\frac{1}{3}$",
    }, GATES)
  );
  assert.ok(r.ok);
  assert.equal((await q1(`SELECT status, reviewed_by FROM questions WHERE id = 'q:fig'`)).status, "live");
  const list = await asOperator(a!, SAMUEL, (db) => fixList(db, ENV, undefined, GATES));
  const entry = list.find((e) => e.ref === "q:fig")!;
  assert.equal(entry.action, "fix");
  assert.equal(entry.requestedBy, "Tamer");
  assert.equal(entry.suggestedCorrection, "$-\\frac{1}{3}$");
  assert.ok(entry.snapshot && typeof entry.snapshot === "object");

  await a!.query(`UPDATE questions SET correct_answer = '-\\frac{1}{3}' WHERE id = 'q:fig'`);
  const back = await current("book_question", "q:fig");
  assert.equal(back.state, "open");
  assert.equal(back.reasons[0]!.code, "changed_since_decision");
  assert.equal((await asOperator(a!, SAMUEL, (db) => fixList(db, ENV, undefined, GATES))).some((e) => e.ref === "q:fig"), false);
});

test("nothing is written on a stale fingerprint, or on an item another reviewer holds", { skip }, async () => {
  const item = await current("objective", "lo:a");
  const count = async () => Number((await q1(`SELECT count(*) AS n FROM review_decisions`)).n);
  const n0 = await count();
  const stale = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "objective", ref: "lo:a", fingerprint: "0".repeat(32), decision: "approve" }, GATES)
  );
  assert.equal(!stale.ok && stale.error, "changed");

  assert.ok(await asOperator(b!, TAMER, (db) => claimItem(db, ENV, TAMER, "objective", "lo:a")));
  const taken = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "objective", ref: "lo:a", fingerprint: item.fingerprint, decision: "approve" }, GATES)
  );
  assert.equal(!taken.ok && taken.error, "claimed_by_other");
  assert.equal(await count(), n0);

  // Tamer's own decision releases his claim.
  const mine = await asOperator(b!, TAMER, (db) =>
    decide(db, ENV, TAMER, { kind: "objective", ref: "lo:a", fingerprint: item.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(mine.ok);
  assert.deepEqual(mine.ok && mine.changes, { recorded_only: true });
  assert.equal(Number((await q1(`SELECT count(*) AS n FROM review_claims WHERE item_ref = 'lo:a'`)).n), 0);
});

test("widget claims: approving a held one switches it on; rejecting an active one switches it off", { skip }, async () => {
  const heldRef = "q:w1|extra-values|mc:b:keeps-both-roots";
  const activeRef = "q:w1|missed-values|mc:b:stops-at-first-root";
  const held = await current("mapping_claim", heldRef);
  const r1 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "mapping_claim", ref: heldRef, fingerprint: held.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(r1.ok);
  let choices = (await q1(`SELECT choices FROM questions WHERE id = 'q:w1'`)).choices;
  assert.deepEqual(
    choices.diagnostics.map((d: { predicate: string }) => d.predicate).sort(),
    ["extra-values", "missed-values"]
  );
  assert.equal(choices.pending_review, undefined);
  assert.equal(choices.kind, "number_line_marker");
  assert.equal((await current("mapping_claim", heldRef)).state, "approved", "activating it did not reopen it");
  assert.equal((await current("widget_question", "q:w1")).fingerprint.length, 32);

  const active = await current("mapping_claim", activeRef);
  const r2 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, {
      kind: "mapping_claim", ref: activeRef, fingerprint: active.fingerprint, decision: "reject",
      note: "a student who marks only one value has not shown this",
    }, GATES)
  );
  assert.ok(r2.ok);
  choices = (await q1(`SELECT choices FROM questions WHERE id = 'q:w1'`)).choices;
  assert.deepEqual(choices.diagnostics.map((d: { predicate: string }) => d.predicate), ["extra-values"]);
  assert.equal((await q1(`SELECT status FROM questions WHERE id = 'q:w1'`)).status, "live", "the widget stays");
});

test("a misconception's approval marks its refutation reviewed; a rejected stand-in holds its question", { skip }, async () => {
  const mc = await current("misconception", "mc:b:stops-at-first-root");
  const r1 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "misconception", ref: "mc:b:stops-at-first-root", fingerprint: mc.fingerprint, decision: "approve" }, GATES)
  );
  assert.ok(r1.ok);
  const lib = await q1(`SELECT reviewed, reviewed_by FROM explanation_library WHERE id = 'expl:mc:b:stops-at-first-root'`);
  assert.deepEqual(lib, { reviewed: true, reviewed_by: "samuel.s.toma" });

  const fig = await current("figure_stand_in", "v:fig1");
  const no = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "figure_stand_in", ref: "v:fig1", fingerprint: fig.fingerprint, decision: "approve" }, GATES)
  );
  assert.equal(!no.ok && no.error, "not_allowed", "a stand-in leaves the backlog when its native figure exists");
  // The fix request above changed q:fig, not its figure: the stand-in is still current.
  const r2 = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, {
      kind: "figure_stand_in", ref: "v:fig1", fingerprint: fig.fingerprint, decision: "reject",
      note: "the picture shows the answer",
    }, GATES)
  );
  assert.ok(r2.ok);
  assert.deepEqual(await q1(`SELECT status, hold_reason FROM questions WHERE id = 'q:fig'`), {
    status: "review",
    hold_reason: "human_hold",
  });
});

/* ------------------------------------------------------------ Samuel's gates */

test("a gate decision: anyone reads it, only Samuel's account decides it (answer 39)", { skip }, async () => {
  // Tamer's queue never hands it to him; "For Samuel" shows it, unclaimed and read-only.
  const plain = await asOperator(b!, TAMER, (db) => nextFor(db, ENV, TAMER, { kind: "gate_decision" }, new Set(), GATES));
  assert.equal(plain.item, null);
  const view = await asOperator(b!, TAMER, (db) =>
    nextFor(db, ENV, TAMER, { kind: "gate_decision", assignee: "samuel" }, new Set(), GATES)
  );
  assert.equal(view.item!.ref, "g10-math/g1-ch08");
  assert.equal(view.item!.readOnly, true);
  assert.equal(view.item!.claimExpiresAt, null, "reading it never keeps it from Samuel");
  assert.equal(view.item!.gate!.gate, "G1");

  const fp = view.item!.fingerprint;
  const refused = await asOperator(b!, TAMER, (db) =>
    decide(db, ENV, TAMER, { kind: "gate_decision", ref: "g10-math/g1-ch08", fingerprint: fp, decision: "approve" }, GATES)
  );
  assert.equal(!refused.ok && refused.error, "owner_only");
  assert.equal(!refused.ok && refused.status, 403);

  const mine = await asOperator(a!, SAMUEL, (db) =>
    nextFor(db, ENV, SAMUEL, { kind: "gate_decision" }, new Set(), GATES)
  );
  assert.equal(mine.item!.ref, "g10-math/g1-ch08", "it is in Samuel's own queue");
  assert.equal(mine.item!.readOnly, undefined);
  const signed = await asOperator(a!, SAMUEL, (db) =>
    decide(db, ENV, SAMUEL, { kind: "gate_decision", ref: "g10-math/g1-ch08", fingerprint: fp, decision: "approve" }, GATES)
  );
  assert.ok(signed.ok);
  assert.deepEqual(signed.ok && signed.changes, { recorded_only: true });
  assert.equal((await current("gate_decision", "g10-math/g1-ch08")).state, "approved");

  // Without an owner configured, nobody decides it (fail closed).
  const saved = process.env.AINEXT_GATE_OWNER_EMAIL;
  process.env.AINEXT_GATE_OWNER_EMAIL = "";
  try {
    const nobody = await asOperator(a!, SAMUEL, (db) =>
      decide(db, ENV, SAMUEL, { kind: "gate_decision", ref: "g10-math/g1-ch08", fingerprint: fp, decision: "reject", note: "x" }, GATES)
    );
    assert.equal(!nobody.ok && nobody.error, "owner_only");
  } finally {
    process.env.AINEXT_GATE_OWNER_EMAIL = saved;
  }
});

/* ------------------------------------------------------------ the record */

test("the record is append-only, written only in the operator's own name, and closed to students", { skip }, async () => {
  await assert.rejects(
    asOperator(a!, SAMUEL, (db) => db.query(`UPDATE review_decisions SET note = 'edited'`)),
    /permission denied/
  );
  await assert.rejects(a!.query(`DELETE FROM review_decisions`), /append-only/, "not even the owner");
  await assert.rejects(
    asOperator(a!, SAMUEL, (db) =>
      db.query(
        `INSERT INTO review_decisions (environment, item_kind, item_ref, course_id, item_fingerprint, decision,
                                       operator_id, operator_name)
         VALUES ($1, 'objective', 'lo:b', 'c', $2, 'approve', $3, 'Tamer')`,
        [ENV, "1".repeat(32), TAMER]
      )
    ),
    /row-level security/
  );

  for (const table of ["review_decisions", "review_claims"]) {
    await a!.query("BEGIN");
    await a!.query("SET LOCAL ROLE ainext_app");
    await assert.rejects(a!.query(`SELECT 1 FROM ${table}`), /permission denied/, `ainext_app reads ${table}`);
    await a!.query("ROLLBACK");
  }
  // …while the student role still reads the content exactly as before.
  await a!.query("BEGIN");
  await a!.query("SET LOCAL ROLE ainext_app");
  const live = await a!.query(`SELECT count(*)::int AS n FROM questions WHERE status = 'live'`);
  await a!.query("ROLLBACK");
  assert.ok(live.rows[0].n > 0);
});

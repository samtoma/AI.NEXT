/**
 * The console's turn-threshold reads (ADR-0023): what they count, where they
 * count it, and what they hand the pages.
 *
 * **No database.** The SQL is asserted by shape — the conversation key, the
 * delivered definition, the environment filter — and the two read functions
 * are driven with a fake client that records every query and its parameters,
 * so "the environment is always $1" and "the thresholds reach the SQL from
 * `TURN_THRESHOLDS`" are assertions rather than hopes. The SQL itself was run
 * against a scratch Postgres with seeded `ai_interactions` rows when this was
 * written; the shapes pinned here are what that run exercised.
 *
 * **FR-2406, by what is read.** A billing-only operator's view is built
 * without the per-conversation list and without the highest reply count: the
 * fake client proves the list's query is never sent and that `max(delivered)`
 * is not in the one that is.
 *
 * @covers FR-2406
 * @covers FR-3403
 * @covers FR-3404
 * @covers FR-3405
 * @covers FR-3406
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ENVIRONMENT } from "./env.ts";
import {
  CONVERSATION_KEY,
  DELIVERED,
  RECENT_LIMIT,
  RECENT_SQL,
  RUNNING_DELIVERED,
  SESSIONS_SQL,
  SURFACE_SUMMARY_SQL,
  costDetailAccess,
  readSessionTurnLimits,
  readTurnLimitsView,
  thresholdParams,
} from "./turn-threshold-queries.ts";

const squash = (sql: string) => sql.replace(/\s+/g, " ").trim();
const ALL_SQL = {
  "summary (aggregates)": SURFACE_SUMMARY_SQL(false),
  "summary (with highest)": SURFACE_SUMMARY_SQL(true),
  recent: RECENT_SQL,
  "sessions (all)": SESSIONS_SQL(false),
  "sessions (one)": SESSIONS_SQL(true),
};

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const code = (rel: string) =>
  src(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------------------------------------ the definitions */

test("a conversation is (surface, chat_session, student) and a reply is outcome = 'ok' — the old cap's", () => {
  assert.equal(CONVERSATION_KEY, "ai.surface, ai.grounding->>'chat_session', ai.student_id");
  assert.equal(DELIVERED, "ai.outcome = 'ok'");
  assert.equal(
    squash(RUNNING_DELIVERED),
    "count(*) FILTER (WHERE ai.outcome = 'ok') OVER (PARTITION BY ai.surface, ai.grounding->>'chat_session', ai.student_id ORDER BY ai.created_at, ai.id)"
  );
  // …and it is the key `/api/ask` writes by: the route's own turn-index count
  // groups by exactly these three columns.
  const ask = code("app/api/ask/route.ts");
  assert.match(ask, /WHERE surface = \$1 AND grounding->>'chat_session' = \$2 AND student_id = \$3/);
});

test("every read counts from the running reply count, and none reads a message", () => {
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    if (name.startsWith("summary")) {
      // the summary counts whole conversations directly, by the same definition
      assert.match(squash(sql), /count\(\*\) FILTER \(WHERE t\.outcome = 'ok'\) AS delivered/, name);
      assert.match(squash(sql), /GROUP BY t\.student_id, t\.surface, t\.chat_session/, name);
    } else {
      assert.ok(sql.includes(RUNNING_DELIVERED), `${name} must use RUNNING_DELIVERED`);
    }
    assert.doesNotMatch(sql, /user_message|assistant_message|citations/, `${name} reads content`);
  }
  const module = src("lib/turn-threshold-queries.ts");
  assert.doesNotMatch(module, /user_message|assistant_message/);
});

test("every read filters this environment first, as $1 (constitution XI)", () => {
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    assert.match(sql, /FROM ai_interactions ai\s+WHERE ai\.environment = \$1 AND /, name);
  }
});

test("only threshold surfaces, only rows with a conversation, only rows with a student", () => {
  for (const [name, sql] of Object.entries(ALL_SQL)) {
    assert.match(
      squash(sql),
      /ai\.surface = ANY\(\$3::text\[\]\) AND ai\.grounding->>'chat_session' IS NOT NULL AND ai\.student_id IS NOT NULL/,
      name
    );
  }
});

test("the period is the Cost page's: whole UTC days ending today, on the conversation's last turn", () => {
  for (const sql of [SURFACE_SUMMARY_SQL(false), RECENT_SQL]) {
    assert.match(sql, /\(ai\.created_at AT TIME ZONE 'UTC'\)::date\s+AS day/);
    assert.match(sql, /HAVING max\(t\.day\) > \(now\(\) AT TIME ZONE 'UTC'\)::date - \$2::int/);
  }
  // and the Cost page's own boundary is the same expression
  const cost = src("lib/cost-queries.ts");
  assert.match(cost, /export const UTC_DAY = `\(ai\.created_at AT TIME ZONE 'UTC'\)::date`;/);
  assert.match(cost, /export const TODAY_UTC = `\(now\(\) AT TIME ZONE 'UTC'\)::date`;/);
});

test("the list: reached conversations only, newest first by when they reached it, capped by $5", () => {
  const sql = squash(RECENT_SQL);
  assert.match(sql, /unnest\(\$3::text\[\], \$4::int\[\]\)/);
  assert.match(sql, /min\(t\.created_at\) FILTER \(WHERE t\.outcome = 'ok' AND t\.delivered_so_far = th\.threshold\) AS reached_at/);
  assert.match(sql, /WHERE c\.delivered >= c\.threshold/);
  assert.match(sql, /ORDER BY c\.reached_at DESC, c\.student_id LIMIT \$5$/);
  assert.match(sql, /coalesce\(c\.reached_session_id, c\.last_session_id\) AS session_id/);
});

test("a session's count is taken OUTSIDE the running count, so it sees the conversation's earlier sittings", () => {
  const one = squash(SESSIONS_SQL(true));
  const window = one.indexOf("OVER (");
  const filter = one.indexOf("c.session_id = $4");
  assert.ok(window > 0 && filter > window, "the session filter must come after the window");
  assert.match(one, /\) c WHERE c\.session_id IS NOT NULL AND c\.session_id = \$4 GROUP BY/);
  assert.match(one, /ai\.student_id = \$2/, "scoped to the one student");
  assert.doesNotMatch(squash(SESSIONS_SQL(false)), /\$4/);
});

/* ------------------------------------------------------- the reads */

type Call = { text: string; values: readonly unknown[] };

function fakeDb(answers: Record<string, unknown>[][]) {
  const calls: Call[] = [];
  let i = 0;
  return {
    calls,
    db: {
      query: async (text: string, values: readonly unknown[] = []) => {
        calls.push({ text, values });
        const rows = answers[i++] ?? [];
        return { rows, rowCount: rows.length };
      },
    },
  };
}

test("the thresholds reach the SQL from TURN_THRESHOLDS, as two aligned arrays", () => {
  const { surfaces, thresholds } = thresholdParams();
  assert.deepEqual(surfaces, ["lesson_learn", "lesson_review", "student_chat"]);
  assert.deepEqual(thresholds, [18, 5, 2]);
});

test("the summary counts with thresholdStatus's rule, every surface included, and the highest only on request", () => {
  for (const withHighest of [false, true]) {
    const sql = squash(SURFACE_SUMMARY_SQL(withHighest));
    assert.match(sql, /count\(\*\) FILTER \(WHERE c\.delivered >= th\.threshold\) AS reached/, "reached is >=");
    assert.match(sql, /count\(\*\) FILTER \(WHERE c\.delivered > th\.threshold\) AS past/, "past is >");
    assert.match(sql, /FROM th LEFT JOIN conversations c ON c\.surface = th\.surface/, "a quiet surface is a zero row");
  }
  assert.doesNotMatch(SURFACE_SUMMARY_SQL(false), /max\(c\.delivered\)|AS highest/, "no single conversation's count without student-data");
  assert.match(squash(SURFACE_SUMMARY_SQL(true)), /coalesce\(max\(c\.delivered\), 0\) AS highest/);
});

test("detail needs student-data AS WELL AS cost-billing (FR-2406)", () => {
  assert.deepEqual(costDetailAccess(["cost-billing"]), { studentDetail: false });
  assert.deepEqual(costDetailAccess(["student-data"]), { studentDetail: false });
  assert.deepEqual(costDetailAccess([]), { studentDetail: false });
  assert.deepEqual(costDetailAccess(["cost-billing", "content-review", "teaching-controls"]), { studentDetail: false });
  assert.deepEqual(costDetailAccess(["student-data", "cost-billing"]), { studentDetail: true });
});

const SUMMARY_ROWS = [
  { surface: "lesson_learn", threshold: 18, conversations: "6", reached: "3", past: "1", highest: "23" },
  { surface: "student_chat", threshold: 2, conversations: "11", reached: "4", past: "0", highest: "2" },
  { surface: "lesson_review", threshold: 5, conversations: "0", reached: "0", past: "0", highest: "0" },
];

test("readTurnLimitsView with student-data: the summary with its highest, then the list", async () => {
  const { db, calls } = fakeDb([
    SUMMARY_ROWS,
    [
      {
        student_id: "7",
        display_name: "Omar",
        surface: "lesson_learn",
        threshold: 18,
        delivered: "23",
        reached_at: "2026-09-24T10:00:00Z",
        last_at: "2026-09-24T10:09:00Z",
        lesson: "geo1-2",
        lo_id: "lo:geo1-2-1",
        session_id: "41",
        lo_label: "Angles in a circle",
        course_id: "course:prep3-math-en",
      },
    ],
  ]);
  const view = await readTurnLimitsView(db, 30, { studentDetail: true });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].text, SURFACE_SUMMARY_SQL(true));
  assert.deepEqual(calls[0].values, [ENVIRONMENT, "30", ["lesson_learn", "lesson_review", "student_chat"], [18, 5, 2]]);
  assert.equal(calls[1].text, RECENT_SQL);
  assert.deepEqual(calls[1].values, [
    ENVIRONMENT,
    "30",
    ["lesson_learn", "lesson_review", "student_chat"],
    [18, 5, 2],
    RECENT_LIMIT + 1,
  ]);

  // in THRESHOLD_SURFACES order, whatever order the rows came back in
  assert.deepEqual(view.surfaces, [
    { surface: "lesson_learn", threshold: 18, conversations: 6, reached: 3, past: 1, highest: 23 },
    { surface: "lesson_review", threshold: 5, conversations: 0, reached: 0, past: 0, highest: 0 },
    { surface: "student_chat", threshold: 2, conversations: 11, reached: 4, past: 0, highest: 2 },
  ]);
  assert.equal(view.detail?.recentCapped, false);
  assert.deepEqual(view.detail?.recent, [
    {
      studentId: 7,
      displayName: "Omar",
      surface: "lesson_learn",
      threshold: 18,
      delivered: 23,
      reachedAt: "2026-09-24T10:00:00.000Z",
      lastAt: "2026-09-24T10:09:00.000Z",
      sessionId: 41,
      lessonSlug: "geo1-2",
      loId: "lo:geo1-2-1",
      loLabel: "Angles in a circle",
      courseId: "course:prep3-math-en",
    },
  ]);
});

test("readTurnLimitsView without student-data: one aggregate query, no list, no highest (FR-2406)", async () => {
  // Even if a row came back carrying a highest, it would not be passed on.
  const { db, calls } = fakeDb([SUMMARY_ROWS]);
  const view = await readTurnLimitsView(db, 7, { studentDetail: false });
  assert.equal(calls.length, 1, "the per-conversation list's query is never sent");
  assert.equal(calls[0].text, SURFACE_SUMMARY_SQL(false));
  assert.ok(!calls.some((c) => c.text === RECENT_SQL));
  assert.equal(view.detail, null);
  assert.deepEqual(
    view.surfaces.map((r) => [r.surface, r.conversations, r.reached, r.past, r.highest]),
    [
      ["lesson_learn", 6, 3, 1, null],
      ["lesson_review", 0, 0, 0, null],
      ["student_chat", 11, 4, 0, null],
    ]
  );
  // nothing in what the page is handed names a student or a conversation
  assert.doesNotMatch(JSON.stringify(view), /studentId|displayName|sessionId|reachedAt|"delivered"/);
});

test("the list says when it was cut: one row more than the limit is asked for, and dropped", async () => {
  const row = {
    student_id: 1,
    display_name: null,
    surface: "student_chat",
    threshold: 2,
    delivered: 2,
    reached_at: "2026-09-20T08:00:00Z",
    last_at: "2026-09-20T08:01:00Z",
    lesson: null,
    lo_id: null,
    session_id: null,
    lo_label: null,
    course_id: null,
  };
  const all = { studentDetail: true };
  const { db } = fakeDb([[], Array.from({ length: RECENT_LIMIT + 1 }, () => row)]);
  const view = await readTurnLimitsView(db, 7, all);
  assert.equal(view.detail?.recent.length, RECENT_LIMIT);
  assert.equal(view.detail?.recentCapped, true);
  assert.equal(view.detail?.recent[0].sessionId, null, "no session recorded stays null, never 0");
  assert.equal(view.detail?.recent[0].displayName, null);

  const exact = fakeDb([[], Array.from({ length: RECENT_LIMIT }, () => row)]);
  assert.equal((await readTurnLimitsView(exact.db, 7, all)).detail?.recentCapped, false);
});

test("readSessionTurnLimits: chips per session from the conversations' counts, environment and student scoped", async () => {
  const { db, calls } = fakeDb([
    [
      { session_id: "11", surface: "lesson_learn", delivered: "12" },
      { session_id: "12", surface: "lesson_learn", delivered: "18" },
      { session_id: "13", surface: "student_chat", delivered: "1" },
      { session_id: "13", surface: "student_chat", delivered: "3" },
      { session_id: "13", surface: "student_chat", delivered: "2" },
    ],
  ]);
  const map = await readSessionTurnLimits(db, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, SESSIONS_SQL(false));
  assert.deepEqual(calls[0].values, [ENVIRONMENT, 7, ["lesson_learn", "lesson_review", "student_chat"]]);

  assert.equal(map.has(11), false, "below its threshold: no chip");
  assert.deepEqual(map.get(12), {
    surface: "lesson_learn",
    threshold: 18,
    delivered: 18,
    status: "reached",
    conversationsAtThreshold: 1,
  });
  assert.deepEqual(map.get(13), {
    surface: "student_chat",
    threshold: 2,
    delivered: 3,
    status: "past",
    conversationsAtThreshold: 2,
  });

  const one = fakeDb([[{ session_id: 12, surface: "lesson_review", delivered: 6 }]]);
  const single = await readSessionTurnLimits(one.db, 7, 12);
  assert.equal(one.calls[0].text, SESSIONS_SQL(true));
  assert.deepEqual(one.calls[0].values, [ENVIRONMENT, 7, ["lesson_learn", "lesson_review", "student_chat"], 12]);
  assert.equal(single.get(12)?.status, "past");
});

/* ------------------------------------------------- where it is wired */

test("the Cost view reads the thresholds on its own client, in its own period", () => {
  const cost = code("lib/cost-queries.ts");
  const reads = cost.slice(cost.indexOf("await withOperator(operatorId, (db) =>"), cost.indexOf("] as const)"));
  assert.match(reads, /\(\) => readTurnLimitsView\(db, periodDays, access\),/, "inside the page's one sequential read");
  assert.match(cost, /^\s*turnLimits,$/m);
});

test("the Cost page shows the panel right after the headline, in the attention treatment when reached", () => {
  const page = code("app/(console)/cost/page.console.tsx");
  assert.match(
    page,
    /<Headline view=\{view\} periodText=\{periodText\} \/>\s*\)\}[\s\S]*?<TurnLimits view=\{view\} periodText=\{periodText\} \/>\s*<PhotoUploads /,
    "the panels sit right after the headline"
  );
  // …and outside the empty-ledger branch: zero is an answer to "how often", and an upload
  // can exist in a period with no ledger row (FR-3403, FR-3409).
  const panels = page.indexOf("<TurnLimits view=");
  assert.ok(panels > page.indexOf('<Panel title="Nothing recorded">'), "after the empty state");
  assert.ok(panels < page.indexOf("{view.totalTurns === 0 ? null"), "not inside the empty-ledger branch");
  assert.match(page, /title="Turn limits — observed, not enforced"/);
  assert.match(page, /tone=\{reached \? "attention" : "neutral"\}/);
  assert.match(page, /anyThresholdReached\(t\.surfaces\)/);
  // no red, no rust, no literal colour (FR-1002, constitution XII)
  assert.doesNotMatch(page, /\b(red|rust|coral)\b|#[0-9a-fA-F]{3,8}\b|rgb\(/);
  // FR-2406: the read is told the operator's detail access, from the principal's roles
  assert.match(page, /detail=\{costDetailAccess\(access\.roles\)\}/);
  assert.match(page, /const view = await getCostView\(operatorId, period, detail\);/);
  assert.doesNotMatch(page, /roles\.includes\(/, "one rule, costDetailAccess — not a second copy on the page");
  // without detail: the note, and neither the list nor the highest column
  assert.match(page, /\{detail == null \? \(\s*<p[^>]*>\s*\{STUDENT_DATA_NOTE_TURNS\}/);
  assert.match(page, /"Which conversations, and their reply counts, need the student-data role \(FR-2406\)\."/);
  assert.match(page, /\{detail \? <Th right>Most replies in one<\/Th> : null\}/);
  assert.match(page, /href=\{`\/students\/\$\{c\.studentId\}\/sessions\/\$\{c\.sessionId\}`\}/);
  // the old footer's claim is gone
  assert.doesNotMatch(src("app/(console)/cost/page.console.tsx"), /What actually bounds spend is the per-surface/);
});

test("the attention treatment is the console's gold, not a new colour", () => {
  const ui = code("components/console/ui.tsx");
  assert.match(ui, /tone === "attention" \? "border-gold bg-gold-wash" : "border-line bg-card"/);
  assert.match(ui, /<Chip tone="attention">\{thresholdChipLabel\(limit\.surface, limit\.delivered\)\}<\/Chip>/);
});

test("the three session pages show the chip; the anonymous overview does not", () => {
  const list = code("app/(console)/students/[id]/sessions/page.console.tsx");
  assert.match(list, /<TurnLimitChip limit=\{r\.turnLimit\} \/>/);
  for (const rel of [
    "app/(console)/students/[id]/sessions/[sid]/page.console.tsx",
    "app/(console)/students/[id]/sessions/[sid]/replay/page.console.tsx",
  ]) {
    assert.match(code(rel), /<TurnLimitChip limit=\{data\.turnLimit\} \/>/, rel);
  }
  assert.match(code("lib/console-queries.ts"), /turnLimit: limits\.get\(Number\(r\.id\)\) \?\? null/);
  assert.match(code("lib/timeline.ts"), /\(\) => readSessionTurnLimits\(db, studentId, sessionId\)/);
  for (const rel of ["app/(console)/overview/page.console.tsx", "lib/overview-queries.ts"]) {
    assert.doesNotMatch(code(rel), /turn-threshold|TurnLimit|readSessionTurnLimits/, rel);
  }
});

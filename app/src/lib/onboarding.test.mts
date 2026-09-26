/**
 * Sign-up's curriculum question and the first-Google-sign-in step, without a
 * database (feature 003, WP-D; contracts/student-api.md).
 *
 * What this file proves, and what it leaves to `onboarding-db.test.mts`:
 *
 *   · the DECISIONS, exhaustively — when the question is asked, what is sent,
 *     how a refusal is answered (a second submission is a 409, never a 204),
 *     and what the first-party `account_created` event carries;
 *   · the Google upsert, against a fake connection — a created account is
 *     pending, a returning one is unaffected, and a returning one that left
 *     before finishing is sent back to the step;
 *   · the WIRING, from the source — pending blocks every student API (403
 *     through `requireStudent` or `onboardingRefusal`) and every student page
 *     (the `(student)` layout's redirect), the callback lands a pending
 *     account on `/welcome`, and `/welcome` is a student-build page.
 *
 * "Once" itself — the database refusing a second call at the point of
 * writing, and two racing submissions writing once — is proved against a
 * real Postgres by `onboarding-db.test.mts`, and the grants by
 * `scripts/ci-migrations.sh` (`proof_033`).
 *
 * @covers FR-4014, FR-4005, FR-4012
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ONBOARDING_PENDING,
  WELCOME_PATH,
  accountCreatedProperties,
  asksCurriculum,
  curriculumRefusal,
  curriculumToSend,
  isOnboardingPending,
  onboardingAnswer,
  welcomeRoute,
} from "./auth/onboarding.ts";
import { offeredCurricula, resolveInitialCurriculum, type AvailabilityRule } from "./catalog.ts";
import { PREP3_MATH_EN, US_G10_MATH_EN } from "./courses.ts";
import { upsertGoogleAccount, GOOGLE_DEFAULT_GRADE } from "./auth/google.ts";
import type { Queryable } from "./auth/throttle.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");
/** Source with comments removed, so a sentence in a header proves nothing. */
const code = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const NATIONAL = "eg-national-en" as const;
const AMERICAN = "us-american-en" as const;

/* ------------------------------------------------------------------ */
/* Pending                                                             */
/* ------------------------------------------------------------------ */

test("pending is a student fact, read from the principal — nobody else is ever pending", () => {
  const student = { kind: "student" as const, studentId: 7, accountId: 3, emailVerified: true };
  assert.equal(isOnboardingPending({ ...student, onboardingPending: true }), true);
  assert.equal(isOnboardingPending({ ...student, onboardingPending: false }), false);
  assert.equal(isOnboardingPending(student), false, "absent reads as not pending");
  assert.equal(isOnboardingPending({ kind: "operator", operatorId: 1, roles: [] }), false);
  assert.equal(isOnboardingPending({ kind: "anonymous" }), false);
  assert.equal(ONBOARDING_PENDING, "onboarding_pending");
  assert.equal(WELCOME_PATH, "/welcome");
});

test("/welcome: a visitor signs in, a finished student goes to her lessons, only a pending one sees the form", () => {
  assert.equal(welcomeRoute(null), "signin");
  assert.equal(welcomeRoute({ onboardingPending: true }), "form");
  // The step is never a way to change a curriculum (decision 4): done is done.
  assert.equal(welcomeRoute({ onboardingPending: false }), "done");
});

/* ------------------------------------------------------------------ */
/* Answers                                                             */
/* ------------------------------------------------------------------ */

test("a second submission is refused loudly — 409 onboarding_already_completed, never a silent 204", () => {
  const again = onboardingAnswer({ ok: false, reason: "already_completed" });
  assert.equal(again.status, 409);
  assert.deepEqual(again.body, { error: "onboarding_already_completed" });
  assert.notEqual(again.status, 204);

  const done = onboardingAnswer({
    ok: true,
    grade: "10",
    curriculum: AMERICAN,
    source: "implied",
    resolvedFrom: null,
  });
  assert.deepEqual(done, { status: 204, body: null });
});

test("the step's other refusals: grade and curriculum validated, and a required curriculum carries the offer", () => {
  assert.deepEqual(onboardingAnswer({ ok: false, reason: "invalid_grade" }), {
    status: 422,
    body: { error: "invalid_grade", field: "grade" },
  });
  assert.deepEqual(onboardingAnswer({ ok: false, reason: "invalid_curriculum", offered: [AMERICAN] }), {
    status: 422,
    body: { error: "invalid_curriculum", field: "curriculum" },
  });
  assert.deepEqual(
    onboardingAnswer({ ok: false, reason: "curriculum_required", offered: [NATIONAL, AMERICAN] }),
    { status: 409, body: { error: "curriculum_required", field: "curriculum", offered: [NATIONAL, AMERICAN] } }
  );
});

test("sign-up and the Google step refuse a curriculum in one shape", () => {
  assert.deepEqual(curriculumRefusal("invalid_curriculum", []), {
    status: 422,
    body: { error: "invalid_curriculum", field: "curriculum" },
  });
  const required = curriculumRefusal("curriculum_required", [NATIONAL, AMERICAN]);
  assert.equal(required.status, 409);
  assert.deepEqual(required.body?.offered, [NATIONAL, AMERICAN]);
});

test("account_created carries the curriculum and how it was set; resolved_from only when the server overrode a pick", () => {
  assert.deepEqual(
    accountCreatedProperties("password", "10", { curriculum: AMERICAN, source: "implied", resolvedFrom: null }),
    { method: "password", grade: "10", curriculum: AMERICAN, curriculum_source: "implied" }
  );
  assert.deepEqual(
    accountCreatedProperties("google", "10", { curriculum: AMERICAN, source: "implied", resolvedFrom: NATIONAL }),
    {
      method: "google",
      grade: "10",
      curriculum: AMERICAN,
      curriculum_source: "implied",
      curriculum_resolved_from: NATIONAL,
    }
  );
});

/* ------------------------------------------------------------------ */
/* The two flows: a grade that offers one, and one that offers two     */
/* ------------------------------------------------------------------ */

/** Launch: grade 9 offers National, grade 10 American (decision 6). */
const LAUNCH: AvailabilityRule[] = [
  { courseId: PREP3_MATH_EN, grade: "9", state: "live" },
  { courseId: US_G10_MATH_EN, grade: "10", state: "live" },
];
/** A fixture: an operator also switches a National course on for grade 10. */
const BOTH_IN_10: AvailabilityRule[] = [...LAUNCH, { courseId: PREP3_MATH_EN, grade: "10", state: "live" }];

/** What the form sends, then what the server decides — the whole round trip. */
function submit(rules: AvailabilityRule[], grade: string, picked: typeof NATIONAL | typeof AMERICAN | null) {
  const offer = offeredCurricula(grade, rules, [], true);
  const asked = asksCurriculum(offer);
  const sent = curriculumToSend(offer, picked);
  const resolved = resolveInitialCurriculum(sent, offeredCurricula(grade, rules, [], true));
  return { offer, asked, sent, resolved };
}

test("a grade offering ONE curriculum: no question, nothing sent, stored as implied", () => {
  const g10 = submit(LAUNCH, "10", null);
  assert.deepEqual(g10.offer, [AMERICAN]);
  assert.equal(g10.asked, false);
  assert.equal(g10.sent, null);
  assert.deepEqual(g10.resolved, { ok: true, curriculum: AMERICAN, source: "implied", resolvedFrom: null });

  const g9 = submit(LAUNCH, "9", null);
  assert.equal(g9.asked, false);
  assert.deepEqual(g9.resolved, { ok: true, curriculum: NATIONAL, source: "implied", resolvedFrom: null });

  // …and a grade that offers none is National, implied (the spec's edge case)
  const g7 = submit(LAUNCH, "7", null);
  assert.equal(g7.asked, false);
  assert.deepEqual(g7.resolved, { ok: true, curriculum: NATIONAL, source: "implied", resolvedFrom: null });
});

test("a grade offering TWO: the question, the pick stored as chosen; no pick is curriculum_required", () => {
  const picked = submit(BOTH_IN_10, "10", AMERICAN);
  assert.deepEqual(picked.offer, [NATIONAL, AMERICAN], "registry order, only what the grade offers");
  assert.equal(picked.asked, true);
  assert.equal(picked.sent, AMERICAN);
  assert.deepEqual(picked.resolved, { ok: true, curriculum: AMERICAN, source: "chosen", resolvedFrom: null });

  const none = submit(BOTH_IN_10, "10", null);
  assert.equal(none.asked, true);
  assert.deepEqual(none.resolved, {
    ok: false,
    error: "curriculum_required",
    offered: [NATIONAL, AMERICAN],
  });
});

test("an offer that changed after the page loaded is re-resolved by the server (FR-4005, F12)", () => {
  // The page showed two; an operator hid the American course before submit.
  const page = offeredCurricula("10", BOTH_IN_10, [], true);
  const sent = curriculumToSend(page, AMERICAN);
  assert.equal(sent, AMERICAN);
  const now = offeredCurricula("10", [...LAUNCH.filter((r) => r.courseId !== US_G10_MATH_EN), BOTH_IN_10[2]], [], true);
  assert.deepEqual(now, [NATIONAL]);
  // One offered now → stored implied, and the overridden pick is recorded.
  assert.deepEqual(resolveInitialCurriculum(sent, now), {
    ok: true,
    curriculum: NATIONAL,
    source: "implied",
    resolvedFrom: AMERICAN,
  });
  // The page showed one; an operator added a second before submit → ask again.
  const sentNothing = curriculumToSend(offeredCurricula("10", LAUNCH, [], true), null);
  const r = resolveInitialCurriculum(sentNothing, offeredCurricula("10", BOTH_IN_10, [], true));
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.error, "curriculum_required");
});

test("the form sends a pick only when the grade asks and offers it", () => {
  assert.equal(curriculumToSend([AMERICAN], AMERICAN), null, "one offered: the server decides");
  assert.equal(curriculumToSend([], NATIONAL), null);
  assert.equal(curriculumToSend([NATIONAL, AMERICAN], null), null);
  assert.equal(curriculumToSend([NATIONAL, AMERICAN], NATIONAL), NATIONAL);
  assert.equal(asksCurriculum(undefined), false);
  assert.equal(asksCurriculum([NATIONAL]), false);
  assert.equal(asksCurriculum([NATIONAL, AMERICAN]), true);
});

test("an unknown curriculum is always refused, even where none is needed", () => {
  for (const offer of [[], [AMERICAN], [NATIONAL, AMERICAN]] as const) {
    const r = resolveInitialCurriculum("british-igcse", offer);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, "invalid_curriculum");
  }
});

/* ------------------------------------------------------------------ */
/* The Google upsert, against a fake connection                        */
/* ------------------------------------------------------------------ */

type Call = { text: string; values: readonly unknown[] };

function fakeDb(existing: Record<string, unknown> | null): Queryable & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      if (/FROM accounts a LEFT JOIN students s/.test(text)) {
        return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
      }
      if (/INSERT INTO accounts/.test(text)) return { rows: [{ id: 41 }], rowCount: 1 };
      if (/INSERT INTO students/.test(text)) return { rows: [{ id: 77 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    },
  };
}

const PROFILE = { sub: "g-123", email: "New.Student@Example.com", emailVerified: true, name: "Nour Ali" };
const noRecord = async () => {};

test("a FIRST Google sign-in creates the account pending, with the placeholder grade", async () => {
  const db = fakeDb(null);
  const out = await upsertGoogleAccount(db, PROFILE, "mvp1", noRecord);
  assert.equal(out.kind, "ok");
  assert.ok(out.kind === "ok");
  assert.equal(out.created, true);
  assert.equal(out.onboardingPending, true);
  const insert = db.calls.find((c) => /INSERT INTO students/.test(c.text));
  assert.ok(insert, "a student row is created with the account (FR-2001)");
  assert.match(insert.text, /onboarding_pending\)\s*VALUES \(\$1, \$2, \$3, 'active', \$4, true\)/);
  assert.equal(insert.values[1], GOOGLE_DEFAULT_GRADE, "the placeholder, until /welcome replaces it");
  // Nothing the student surface may not write: no curriculum column in the INSERT.
  assert.doesNotMatch(insert.text, /curriculum/);
});

test("a RETURNING Google sign-in is unaffected; one that left before finishing is sent back to the step", async () => {
  const finished = fakeDb({ id: 5, google_sub: "g-123", student_id: 9, display_name: "Nour", onboarding_pending: false });
  const back = await upsertGoogleAccount(finished, PROFILE, "mvp1", noRecord);
  assert.ok(back.kind === "ok");
  assert.equal(back.created, false);
  assert.equal(back.onboardingPending, false);
  assert.equal(back.studentId, 9);
  assert.ok(!finished.calls.some((c) => /INSERT INTO students/.test(c.text)), "no second student");

  const unfinished = fakeDb({ id: 5, google_sub: "g-123", student_id: 9, display_name: "Nour", onboarding_pending: true });
  const again = await upsertGoogleAccount(unfinished, PROFILE, "mvp1", noRecord);
  assert.ok(again.kind === "ok");
  assert.equal(again.created, false);
  assert.equal(again.onboardingPending, true);

  // A password account linked by a first Google sign-in keeps its own grade and curriculum.
  const password = fakeDb({ id: 6, google_sub: null, student_id: 10, display_name: "Omar", onboarding_pending: false });
  const linked = await upsertGoogleAccount(password, PROFILE, "mvp1", noRecord);
  assert.ok(linked.kind === "ok");
  assert.equal(linked.onboardingPending, false);
});

/* ------------------------------------------------------------------ */
/* Wiring, from the source                                             */
/* ------------------------------------------------------------------ */

test("the principal reads the pending flag in its one indexed read, and requireStudent refuses it with 403", () => {
  const p = code("lib/auth/principal.ts");
  assert.match(p, /s\.onboarding_pending\s+FROM auth_sessions x/, "same read as revocation, not a second query");
  assert.match(p, /onboardingPending: row\.onboarding_pending === true/);
  const req = p.slice(p.indexOf("export async function requireStudent"));
  assert.match(
    req.slice(0, 400),
    /if \(isOnboardingPending\(me\)\) throw new AuthError\(403, ONBOARDING_PENDING\);/,
    "requireStudent refuses a pending student"
  );
  assert.match(p, /export function onboardingRefusal\(me: Principal\): Response \| null/);
});

function apiRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "route.ts") out.push(relative(SRC, full));
    }
  };
  walk(join(SRC, "app/api"));
  return out.sort();
}

test("pending blocks lessons: every student API outside /api/auth refuses a pending student", () => {
  const routes = apiRoutes().filter((r) => !r.startsWith("app/api/auth/"));
  assert.ok(routes.length >= 10, `the scan sees the student APIs (${routes.length})`);
  const unguarded = routes.filter((r) => {
    const c = code(r);
    return !/\brequireStudent\(\)/.test(c) && !/\bonboardingRefusal\(me\)/.test(c);
  });
  assert.deepEqual(unguarded, [], "a student API does not refuse a pending step (FR-4014)");
  // the two that resolve their own principal refuse on every handler that serves a student
  for (const r of ["app/api/feedback/route.ts", "app/api/settings/appearance/route.ts"]) {
    const c = code(r);
    const handlers = (c.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? []).length;
    const refusals = (c.match(/onboardingRefusal\(me\)/g) ?? []).length;
    assert.equal(refusals, handlers, `${r}: every handler refuses a pending student`);
  }
});

test("pending blocks lessons: every student page redirects to /welcome, from the group's layout", () => {
  const l = code("app/(student)/layout.tsx");
  assert.match(l, /if \(\(await resolveStudentContext\(\)\)\?\.onboardingPending\) redirect\(WELCOME_PATH\);/);
  // after the console refusal, so the console build still 404s
  assert.ok(l.indexOf("notFound()") < l.indexOf("redirect(WELCOME_PATH)"));
  // the context carries it from the principal, not from a second read
  assert.match(code("lib/student-context.ts"), /onboardingPending: me\.onboardingPending === true/);
});

test("the Google callback lands a pending account on /welcome, and no longer records a placeholder grade", () => {
  const c = code("app/api/auth/google/callback/route.ts");
  assert.match(c, /const landing = outcome\.onboardingPending \? WELCOME_PATH : "\/student";/);
  assert.match(c, /Location: `\$\{PUBLIC_URL\}\$\{landing\}`/);
  assert.doesNotMatch(c, /account_created/, "recorded when the step completes, with the grade she gave");
  assert.doesNotMatch(c, /GOOGLE_DEFAULT_GRADE/);
});

test("the step's route: signed-in student only, JSON only, pending checked first, the once-only function, 409 on repeat", () => {
  const c = code("app/api/auth/onboarding/route.ts");
  assert.doesNotMatch(c, /requireStudent/, "it must stay reachable while pending");
  const order = [
    c.indexOf('if (me.kind !== "student")'),
    c.indexOf("application\\/json"),
    c.indexOf("if (!isOnboardingPending(me))"),
    c.indexOf("completeOnboarding(me.studentId"),
  ];
  assert.ok(order.every((i) => i >= 0), `every step is present: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "401, 415, 409, then the write");
  assert.match(c, /\{ error: "onboarding_already_completed" \}, \{ status: 409 \}/);
  assert.match(c, /onboardingAnswer\(result\)/, "the definer function's refusal is mapped, not swallowed");
  // the write is the definer function, never an UPDATE of her own row
  assert.doesNotMatch(c, /UPDATE\s+students/i);
  assert.match(code("lib/curriculum-queries.ts"), /SELECT complete_student_onboarding\(\$1, \$2, \$3\)/);
  // first-party only
  assert.match(c, /event: "account_created"/);
  assert.doesNotMatch(c, /\btrack\(/);
});

test("/welcome is a student-build page that asks only grade and, when offered, curriculum", () => {
  const page = code("app/(auth)/welcome/page.student.tsx");
  assert.match(page, /welcomeRoute\(me\)/);
  assert.match(page, /if \(route === "done"\) redirect\("\/student"\);/);
  assert.match(page, /offeredCurriculaEveryGrade\(\)/);
  const form = code("components/auth/OnboardingForm.tsx");
  const fields = [
    ...form.matchAll(/<Field\s+id="([^"]+)"|<(CurriculumChoice|TextInput|GenderChoice|fieldset)\b/g),
  ].map((m) => m[1] ?? m[2]);
  assert.deepEqual(fields, ["grade", "CurriculumChoice"], "grade, and the curriculum question — nothing else");
  assert.match(form, /\{asking && \(\s*<CurriculumChoice/);
  assert.match(form, /<option value="" disabled>/, "no grade pre-selected: the placeholder is not an answer");
  // excluded from the console build, by filename and by the surface check
  assert.match(read("../scripts/check-surface-manifest.mts"), /const STUDENT_ONLY = \["\/signup", "\/welcome"\] as const;/);
});

test("sign-up asks the curriculum only after grade, only when offered two or more, with none pre-selected", () => {
  const form = code("components/auth/SignupForm.tsx");
  assert.match(form, /\{askingCurriculum && \(\s*<CurriculumChoice/);
  assert.ok(form.indexOf('id="grade"') < form.indexOf("<CurriculumChoice"), "the question follows grade");
  assert.match(form, /const \[picked, setPicked\] = useState<CurriculumId \| null>\(null\);/, "nothing pre-selected");
  assert.match(form, /\.\.\.\(curriculum \? \{ curriculum \} : \{\}\)/, "sent only when asked");
  const choice = code("components/auth/CurriculumChoice.tsx");
  assert.match(choice, /type="radio"/);
  assert.match(choice, /checked=\{value === o\.id\}/);
  // flat labels: the option shows the registry's label and nothing under it (FR-4016, F1)
  assert.doesNotMatch(choice, /description/);
  // tokens only (constitution XII)
  assert.doesNotMatch(choice, /#[0-9a-f]{3,8}\b/i, "no literal colour");
  assert.doesNotMatch(choice, /border-\[\d|rounded-\[\d/, "no literal stroke or radius");

  const route = code("app/api/auth/signup/route.ts");
  assert.match(route, /resolveInitialCurriculum\(body\.curriculum, await offeredCurriculaFor\(grade\)\)/);
  assert.match(route, /curriculum_system, curriculum_source\)/);
  assert.match(route, /properties: accountCreatedProperties\("password", grade, curriculum\)/);
});

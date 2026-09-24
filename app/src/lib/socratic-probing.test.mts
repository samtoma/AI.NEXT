/**
 * Socratic probing's rules (Tamer's `507bb31`; runtime since v0.7.0, ADR-0021).
 *
 * Two properties matter more than the rest:
 *
 *  1. **The resolver's truth table**, stated here by hand and NOT derived from
 *     the function it checks — position × tester × course × surface, with the
 *     "everyone" lock both engaged and lifted. A table computed from
 *     `resolveProbing` would pass for any `resolveProbing`.
 *  2. **Off is v0.6.0.** With `enabled = false` every helper returns exactly
 *     what the switched-off build returned: the card reveals, the prompt's
 *     wrong-answer lines are main's two, and a retry link in the request is
 *     dropped. (`probing-prompts.test.mts` holds the whole-prompt version.)
 *
 * @covers FR-3101
 * @covers FR-3103
 * @covers FR-3104
 * @covers FR-3105
 * @covers FR-3106
 * @covers FR-3112
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PROBING_COURSE_ID,
  PROBING_EVERYONE_LOCK_NOTE,
  PROBING_EVERYONE_UNLOCKED,
  PROBING_SETTINGS,
  PROBING_SURFACE,
  acceptedRetryOf,
  asProbingSetting,
  attemptProbingDeclaration,
  cardWithholdsAnswer,
  effectiveProbing,
  effectiveSetting,
  learnWrongAnswerRules,
  pendingAfterDeclaration,
  probingActive,
  probingCouldApply,
  probingDeclaredBy,
  resolveProbing,
  settingChangeRefusal,
  type ProbingSetting,
} from "./socratic-probing.ts";
import { learnPrompt } from "./lesson.ts";
import { addressForms, type Gender } from "./address.ts";
import type { LessonData } from "./types.ts";

const MASCULINE = /\b(he|him|his|himself)\b/i;

const MATHS = "course:prep3-math-en";
const COURSES = [MATHS, "course:prep3-social-ar", "course:prep3-arabic-ar", null] as const;
const SURFACES = ["lesson_learn", "lesson_review", "practice", "student_chat", "spine_chat", null] as const;

/**
 * THE TABLE, by hand. Read each line as the brief Samuel approved:
 *   off                    → never
 *   testers                → tester AND maths AND lesson_learn
 *   everyone, UNLOCKED     → maths AND lesson_learn
 *   everyone, LOCKED (#53) → as testers (the lock narrows what is stored)
 */
function expected(
  setting: ProbingSetting,
  unlocked: boolean,
  tester: boolean,
  course: string | null,
  surface: string | null
): boolean {
  const mathsLesson = course === MATHS && surface === "lesson_learn";
  switch (setting) {
    case "off":
      return false;
    case "testers":
      return tester && mathsLesson;
    case "everyone":
      return unlocked ? mathsLesson : tester && mathsLesson;
  }
}

test("the constants ship as approved: Everyone locked, maths only, learn mode only", () => {
  assert.equal(PROBING_EVERYONE_UNLOCKED, false, "Everyone stays locked until #53 is closed");
  assert.equal(PROBING_COURSE_ID, MATHS);
  assert.equal(PROBING_SURFACE, "lesson_learn");
  assert.deepEqual([...PROBING_SETTINGS], ["off", "testers", "everyone"]);
  assert.match(PROBING_EVERYONE_LOCK_NOTE, /#53/);
});

test("resolver truth table: 3 positions × lock × tester × 4 courses × 6 surfaces", () => {
  let cells = 0;
  let on = 0;
  for (const setting of PROBING_SETTINGS) {
    for (const unlocked of [false, true]) {
      for (const tester of [false, true]) {
        for (const course of COURSES) {
          for (const surface of SURFACES) {
            const got = resolveProbing(
              { setting, isTester: tester, courseId: course, surface },
              unlocked
            );
            const want = expected(setting, unlocked, tester, course, surface);
            assert.equal(
              got,
              want,
              `${setting}${setting === "everyone" ? (unlocked ? "/unlocked" : "/locked") : ""} ` +
                `tester=${tester} course=${course} surface=${surface}: expected ${want}`
            );
            cells++;
            if (got) on++;
          }
        }
      }
    }
  }
  assert.equal(cells, 3 * 2 * 2 * 4 * 6);
  // Exactly the cells that should be on: testers (1 per lock state = 2),
  // everyone locked (1), everyone unlocked (2: tester or not). Five in 288.
  assert.equal(on, 5, "probing is on in exactly five cells of the table");
});

test("the shipped default (the lock engaged) is the one the product runs on", () => {
  // `resolveProbing` without its second argument uses the constant.
  const base = { courseId: MATHS, surface: "lesson_learn" as const };
  assert.equal(resolveProbing({ ...base, setting: "off", isTester: true }), false);
  assert.equal(resolveProbing({ ...base, setting: "testers", isTester: true }), true);
  assert.equal(resolveProbing({ ...base, setting: "testers", isTester: false }), false);
  assert.equal(resolveProbing({ ...base, setting: "everyone", isTester: false }), false,
    "a stored Everyone must not reach a non-tester while #53 is open");
  assert.equal(resolveProbing({ ...base, setting: "everyone", isTester: true }), true);
});

test("the lock: Everyone is refused as a change, and read as Test accounts when stored", () => {
  assert.equal(settingChangeRefusal("everyone"), "everyone_locked");
  assert.equal(settingChangeRefusal("everyone", false), "everyone_locked");
  assert.equal(settingChangeRefusal("everyone", true), null);
  for (const s of ["off", "testers"] as const) {
    assert.equal(settingChangeRefusal(s), null, `${s} is always allowed`);
    assert.equal(settingChangeRefusal(s, true), null);
  }
  assert.equal(effectiveSetting("everyone"), "testers");
  assert.equal(effectiveSetting("everyone", true), "everyone");
  assert.equal(effectiveSetting("testers"), "testers");
  assert.equal(effectiveSetting("off"), "off");
});

test("a stored value is read closed: anything unrecognised is off", () => {
  assert.equal(asProbingSetting("testers"), "testers");
  assert.equal(asProbingSetting("everyone"), "everyone");
  for (const bad of [null, undefined, "", "on", "TESTERS", 1, true, {}]) {
    assert.equal(asProbingSetting(bad), "off", String(bad));
  }
});

test("probingCouldApply is the resolver with the course assumed maths", () => {
  for (const setting of PROBING_SETTINGS) {
    for (const tester of [false, true]) {
      for (const surface of SURFACES) {
        assert.equal(
          probingCouldApply({ setting, isTester: tester, surface }),
          resolveProbing({ setting, isTester: tester, courseId: MATHS, surface })
        );
      }
    }
  }
  // With the switch Off it is false for everyone, so no course is ever looked up.
  assert.equal(probingCouldApply({ setting: "off", isTester: true, surface: "lesson_learn" }), false);
});

test("the use-time rule only narrows: never turns a stored false (or NULL) on", () => {
  for (const course of COURSES) {
    for (const surface of SURFACES) {
      assert.equal(effectiveProbing(false, surface, course), false);
      assert.equal(effectiveProbing(null, surface, course), false, "pre-v0.7.0 session");
      assert.equal(effectiveProbing(undefined, surface, course), false);
      assert.equal(
        effectiveProbing(true, surface, course),
        course === MATHS && surface === "lesson_learn",
        `stored true on ${course}/${surface}`
      );
    }
  }
});

test("off: no chat surface probes, lesson_learn included", () => {
  for (const s of ["lesson_learn", "lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s, false), false, String(s));
  }
});

test("on: only lesson_learn probes", () => {
  assert.equal(probingActive("lesson_learn", true), true);
  for (const s of ["lesson_review", "student_chat", "spine_chat", undefined]) {
    assert.equal(probingActive(s, true), false, String(s));
  }
});

function lesson(gender: Gender): LessonData {
  return {
    slug: "u1-1",
    lessonRef: "1-1",
    title: "Cartesian product",
    moduleLabel: "Unit 1",
    courseId: MATHS,
    subject: "math-en",
    los: [
      {
        id: "lo:u1-1-1",
        label: "Ordered pairs",
        description: "The ordered pair (a, b).",
        sourcePage: 8,
        mastery: 0.4,
      },
    ],
    questions: [],
    visuals: [],
    mapBases: [],
    docTitle: null,
    studentName: "Nour Adel",
    studentId: 7,
    grade: "9",
    gender,
  } as LessonData;
}

test("off: the learn prompt carries main's wrong-answer rules and nothing of the prototype", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const p = learnPrompt(lesson(g), false);
    assert.ok(!p.includes("SOCRATIC"), `gender=${g}: SOCRATIC block leaked into the prompt`);
    assert.ok(!p.includes("answer_submitted"), `gender=${g}: answer_submitted leaked`);
    assert.ok(!p.includes("reveal_answer"), `gender=${g}: reveal_answer leaked`);
    assert.ok(
      p.includes("got it wrong: re-explain THAT exact point a different way"),
      `gender=${g}: main's re-explain rule is missing`
    );
  }
});

test("on: the learn prompt carries the probing block, voiced for the student", () => {
  for (const g of ["female", "male", "unspecified", null] as Gender[]) {
    const p = learnPrompt(lesson(g), true);
    assert.ok(p.includes("SOCRATIC PROBING"), `gender=${g}`);
    assert.ok(p.includes("{{answer_submitted:"), `gender=${g}`);
    // FR-3112: asking is not an attempt — the answer waits for REVEALED, and
    // the prompt no longer tells the model to emit {{reveal_answer}}
    // (the rule itself is pinned word for word in socratic-reveal.test.mts).
    assert.ok(p.includes('before the "SOCRATIC PROBE — REVEALED" event for this LO'), `gender=${g}`);
    assert.ok(!p.includes("reveal_answer"), `gender=${g}: the prompt still mentions reveal_answer`);
  }
});

test("off: the rules are main's two lines exactly", () => {
  const a = addressForms("female", "Nour Adel");
  assert.equal(
    learnWrongAnswerRules(a, "figure / tap", false),
    `- From the SECOND message on: open with one warm beat reacting to her latest [live event]. If she got it wrong: re-explain THAT exact point a different way (grounded in the canonical steps), walking her toward the correct answer, in the same upbeat tone — never open with the correct letter.
- After a "لسه مش فاهم" / still-confused signal: re-explain from a DIFFERENT angle, and the next check MUST be a basic-tier question or a tap widget (figure / tap) — never a harder question.`
  );
});

test("on: the probing block is voiced through the address seam (FR-2602)", () => {
  for (const g of ["unspecified", null] as Gender[]) {
    const on = learnWrongAnswerRules(addressForms(g, "Nour Adel"), "figure", true);
    assert.ok(on.includes("SOCRATIC PROBING"));
    assert.ok(!MASCULINE.test(on), `gender=${g}: a masculine form survived: ${on.match(MASCULINE)}`);
  }
  const her = learnWrongAnswerRules(addressForms("female", "Nour Adel"), "figure", true);
  assert.ok(/\bher own mistake\b/.test(her));
});

test("off: a retry link in the request body is ignored", () => {
  assert.equal(acceptedRetryOf(42, false), null);
  assert.equal(acceptedRetryOf("42", false), null);
});

test("on: only a positive integer id survives", () => {
  assert.equal(acceptedRetryOf(42, true), 42);
  for (const bad of ["42", -1, 0, 1.5, null, undefined, {}]) {
    assert.equal(acceptedRetryOf(bad, true), null, String(bad));
  }
});

// Above 2^53 a JSON number stops naming one integer: 2^53 + 1 parses as 2^53,
// so an id that large could link a retry to a NEIGHBOURING attempt. Only a
// safe integer is an id this route can trust.
test("on: an id beyond the safe-integer range is refused", () => {
  assert.equal(acceptedRetryOf(Number.MAX_SAFE_INTEGER, true), Number.MAX_SAFE_INTEGER);
  assert.equal(acceptedRetryOf(2 ** 53, true), null);
  assert.equal(acceptedRetryOf(Number.POSITIVE_INFINITY, true), null);
});

/* --------------------------------------------------------------------- */
/* Off mid-sitting, on the client (ADR-0021, option B)                    */
/* --------------------------------------------------------------------- */

test("a card holds back its answer only while probing applies and the reveal is not unlocked", () => {
  assert.equal(cardWithholdsAnswer(true, false), true);
  assert.equal(cardWithholdsAnswer(true, true), false, "the 2nd wrong attempt unlocks it (FR-3112: nothing else does)");
  assert.equal(cardWithholdsAnswer(false, false), false, "a lesson that does not probe never holds back");
  assert.equal(cardWithholdsAnswer(false, true), false);
});

test("the pending state survives a declared ON and is dropped by a declared OFF", () => {
  const pending = { loId: "lo:u1-1-1", lastAttemptId: 41, wrongCount: 1, questionId: "q:u1-1-1:001" };
  assert.equal(pendingAfterDeclaration(pending, true), pending);
  assert.equal(pendingAfterDeclaration(pending, false), null);
  assert.equal(pendingAfterDeclaration(null, true), null);
  assert.equal(pendingAfterDeclaration(null, false), null);
});

test("Off mid-probe, end to end on the client's rules: nothing stays stuck, the next wrong answer is v0.6.0's", () => {
  // A tester is mid-probe: one wrong answer on lo:u1-1-1, the card holding
  // back its answer and worked solution, the tutor asking a guiding question.
  const surface = PROBING_SURFACE;
  let declared = true;
  let pending: { loId: string; wrongCount: number } | null = { loId: "lo:u1-1-1", wrongCount: 1 };
  const revealUnlocked = () => pending !== null && pending.wrongCount >= 2;
  assert.equal(probingActive(surface, declared), true);
  assert.equal(cardWithholdsAnswer(probingActive(surface, declared), revealUnlocked()), true);

  // An operator switches Off. The student's next message comes back with the
  // stream's first frame declaring probing false; ChatCore adopts it.
  declared = false;
  pending = pendingAfterDeclaration(pending, declared);

  // The pending objective is gone, so "Got it" is no longer refused …
  assert.equal(pending, null);
  // … the card that was holding back now offers "Show the answer" and shows
  // the worked solution …
  assert.equal(cardWithholdsAnswer(probingActive(surface, declared), revealUnlocked()), false);
  // … and the next wrong answer takes v0.6.0's path: no probe note, no
  // pending state, revealed on the card — `handleAttempt` and the stream's
  // directive handling both gate on exactly this.
  assert.equal(probingActive(surface, declared), false);
  assert.equal(acceptedRetryOf(41, false), null, "and the server writes no retry link");
});

/* ------------------------------------------------------------------ */
/* What each response declares (fix pass 2)                            */
/* ------------------------------------------------------------------ */

test("an attempt declares probing only from inside a learn-mode lesson sitting", () => {
  assert.deepEqual(attemptProbingDeclaration("lesson_learn", true), { probing: true });
  assert.deepEqual(attemptProbingDeclaration("lesson_learn", false), { probing: false });
  // attempt-before-ask opens `practice`; an idle lesson sitting is replaced
  // by one; a session that could not be opened has no kind — none of them
  // knows anything about the lesson on screen, so the field is OMITTED
  for (const kind of ["practice", "lesson_review", "student_chat", "spine_chat", null, undefined]) {
    for (const probing of [true, false]) {
      const out = attemptProbingDeclaration(kind, probing);
      assert.deepEqual(out, {}, `${String(kind)}/${probing}`);
      assert.ok(!("probing" in { ...out }), "omitted, not undefined");
    }
  }
});

test("an omitted declaration keeps the pending probe; a declared false drops it", () => {
  // ChatCore's rule for an attempt result: adopt a boolean, keep otherwise.
  const pending = { loId: "lo:u1-1-1", lastAttemptId: 41, wrongCount: 1, questionId: "q:u1-1-1:001" };
  const afterResult = (current: boolean, result: { probing?: boolean }) =>
    typeof result.probing === "boolean"
      ? { probing: result.probing, pending: pendingAfterDeclaration(pending, result.probing) }
      : { probing: current, pending };
  const practice = afterResult(true, JSON.parse(JSON.stringify(attemptProbingDeclaration("practice", false))));
  assert.deepEqual(practice, { probing: true, pending }, "a practice attempt must not end the lesson's probe");
  const lesson = afterResult(true, JSON.parse(JSON.stringify(attemptProbingDeclaration("lesson_learn", false))));
  assert.deepEqual(lesson, { probing: false, pending: null }, "the lesson's own Off still reaches the client");
});

/** The server's frame encoder (`/api/ask`'s `sse`) and ChatCore's line parse, as shipped. */
const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const parseFrames = (body: string) =>
  body
    .split("\n\n")
    .map((ev) => ev.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; probing?: unknown });

test("which frames declare probing: the session frame always, nothing else", () => {
  assert.equal(probingDeclaredBy({ type: "session", probing: true }), true);
  assert.equal(probingDeclaredBy({ type: "session", probing: false }), false);
  assert.equal(probingDeclaredBy({ type: "session" }), false, "a session frame always declares");
  // v0.9.0 (ADR-0023): no turn is refused for count, so the `cap` frame that
  // carried a refused turn's answer is gone — one arriving declares nothing.
  assert.equal(probingDeclaredBy({ type: "cap", text: "…", probing: false } as never), null);
  assert.equal(probingDeclaredBy({ type: "cap", text: "…", probing: true } as never), null);
  for (const type of ["delta", "done", "error", "unknown"]) {
    assert.equal(probingDeclaredBy({ type, probing: true }), null, type);
  }
});

test("Off reaches the next message on a long lesson: the session frame's false is parsed, adopted, and un-sticks the card", () => {
  // A tester mid-probe, 18 replies into a lesson — where v0.8.0 would have
  // refused the turn — sends a message after the switch went Off. Every
  // request is served now, so the answer arrives the one way it always
  // arrives: the stream's first frame, before any text.
  const body =
    sse({ type: "session", probing: false }) +
    sse({ type: "delta", t: "Let's look at it together." }) +
    sse({ type: "done", meta: { turnIndex: 19 } });
  let declared = true;
  let pending: { loId: string; wrongCount: number } | null = { loId: "lo:u1-1-1", wrongCount: 1 };
  for (const frame of parseFrames(body)) {
    const d = probingDeclaredBy(frame);
    if (d !== null) {
      declared = d; // adoptProbing
      pending = pendingAfterDeclaration(pending, d);
    }
  }
  assert.equal(declared, false);
  assert.equal(pending, null);
  assert.equal(cardWithholdsAnswer(probingActive(PROBING_SURFACE, declared), false), false);

  // …and a session frame that says ON (switch untouched) leaves the probe running.
  declared = true;
  pending = { loId: "lo:u1-1-1", wrongCount: 1 };
  for (const frame of parseFrames(sse({ type: "session", probing: true }) + sse({ type: "delta", t: "…" }))) {
    const d = probingDeclaredBy(frame);
    if (d !== null) {
      declared = d;
      pending = pendingAfterDeclaration(pending, d);
    }
  }
  assert.equal(declared, true);
  assert.deepEqual(pending, { loId: "lo:u1-1-1", wrongCount: 1 });
});

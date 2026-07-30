import { strict as assert } from "node:assert";
import { test } from "node:test";

// The resolution rule is a pure function on purpose: the cookie is untrusted
// input on every request, so its fallback behaviour is unit-testable without a
// database. (qa-engineer strategy: test the decision, not the plumbing.)
import {
  DEFAULT_STUDENT_ID,
  arabicGreetingName,
  pickStudentId,
  shortName,
} from "./demo-student.ts";

const CAST = [1, 2, 3];

test("a valid cookie naming a seeded student is honoured", () => {
  assert.equal(pickStudentId("2", CAST), 2);
  assert.equal(pickStudentId("3", CAST), 3);
});

test("unset cookie falls back to the default student", () => {
  assert.equal(pickStudentId(null, CAST), DEFAULT_STUDENT_ID);
  assert.equal(pickStudentId(undefined, CAST), DEFAULT_STUDENT_ID);
  assert.equal(pickStudentId("", CAST), DEFAULT_STUDENT_ID);
});

test("garbage never reaches a query — it falls back, it does not throw", () => {
  for (const junk of [
    "abc",
    "1; DROP TABLE students",
    "1 OR 1=1",
    "-1",
    "1.5",
    "0x2",
    " 2 x",
    "NaN",
    "999999999999999999999999",
    "<script>alert(1)</script>",
    "١٢", // Arabic-Indic digits: not an id
  ]) {
    assert.equal(pickStudentId(junk, CAST), DEFAULT_STUDENT_ID, `junk: ${junk}`);
  }
});

test("an id that is well-formed but unknown falls back", () => {
  assert.equal(pickStudentId("999", CAST), DEFAULT_STUDENT_ID);
  assert.equal(pickStudentId("0", CAST), DEFAULT_STUDENT_ID);
});

test("whitespace around a real id is tolerated", () => {
  assert.equal(pickStudentId(" 2 ", CAST), 2);
});

test("a reseeded DB without id 1 falls back to the lowest known student", () => {
  assert.equal(pickStudentId("bogus", [7, 4, 9]), 4);
  assert.equal(pickStudentId(null, [7, 4, 9]), 4);
  // and a cookie naming a student that DOES exist there still wins
  assert.equal(pickStudentId("9", [7, 4, 9]), 9);
});

test("an empty students table still yields the default (no crash, no NaN)", () => {
  assert.equal(pickStudentId("2", []), DEFAULT_STUDENT_ID);
  assert.equal(pickStudentId(null, []), DEFAULT_STUDENT_ID);
});

test("shortName drops the demo qualifier for student-facing Arabic copy", () => {
  assert.equal(shortName("Omar (demo)"), "Omar");
  assert.equal(shortName("نور (جديدة)"), "نور");
  assert.equal(shortName("Youssef"), "Youssef");
  assert.equal(shortName(""), "");
});

test("Arabic copy greets by name only when the name IS Arabic", () => {
  // «أهلاً يا نور» — right. «أهلاً يا Omar» — a Latin name mid-sentence, so
  // the greeting drops the name instead of rendering mixed script.
  assert.equal(arabicGreetingName("نور (جديدة)"), "نور");
  assert.equal(arabicGreetingName("يوسف (متفوّق)"), "يوسف");
  assert.equal(arabicGreetingName("Omar (demo)"), null);
  assert.equal(arabicGreetingName(""), null);
});

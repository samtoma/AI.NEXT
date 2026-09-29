/**
 * The student build's header and its front door.
 *
 * @covers FR-3219
 * @covers FR-3220
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STUDENT_NAV_LINKS, rootDestination } from "./student-nav.ts";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("FR-3219: the header offers Study and Your Progress, and nothing else", () => {
  assert.deepEqual(
    STUDENT_NAV_LINKS.map((l) => [l.href, l.label]),
    [
      ["/student", "Study"],
      ["/spine", "Your Progress"],
    ]
  );
});

test("FR-3219: 'Where you stand' is off the header, and the page still exists", () => {
  assert.ok(!STUDENT_NAV_LINKS.some((l) => (l.href as string) === "/dashboard"));
  assert.match(read("../app/(student)/dashboard/page.tsx"), /export default/);
});

test("FR-3219: the nav renders the shared list, not a copy of it", () => {
  const nav = read("../components/NavLinks.tsx");
  assert.match(nav, /const MVP1_LINKS = STUDENT_NAV_LINKS;/);
  assert.doesNotMatch(nav, /"Where you stand"/);
});

test("FR-3219: the page is titled Your Progress and every button to it says 'See your progress'", () => {
  assert.match(read("../components/spine/SpineExplorer.tsx"), />\s*Your Progress\s*<\/h1>/);
  assert.match(read("../app/(student)/spine/page.tsx"), /title: "Your Progress — Noor"/);
  for (const f of ["../components/student/StudentLoop.tsx", "../components/student/ReportCard.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /See it on the graph/, f);
    assert.match(src, /See your progress →/, f);
  }
});

test("FR-3220: a signed-in student on the student build goes to /student", () => {
  assert.equal(rootDestination({ mvp1: true, signedIn: true }), "/student");
});

test("FR-3220: a signed-out visitor keeps the welcome page, on either build", () => {
  assert.equal(rootDestination({ mvp1: true, signedIn: false }), "welcome");
  assert.equal(rootDestination({ mvp1: false, signedIn: false }), "welcome");
});

test("FR-3220: the frozen baseline keeps its ledger", () => {
  assert.equal(rootDestination({ mvp1: false, signedIn: true }), "ledger");
});

test("FR-3220: the root page redirects before it fetches any stats", () => {
  const page = read("../app/(student)/page.student.tsx");
  const redirectAt = page.indexOf('redirect("/student")');
  const statsAt = page.indexOf("await getHomeStats(");
  assert.ok(redirectAt > 0 && statsAt > redirectAt);
});

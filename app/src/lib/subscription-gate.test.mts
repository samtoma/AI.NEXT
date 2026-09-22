/**
 * FR-2404, asserted against the source rather than promised in a comment:
 * **no student surface reads `subscription_status`.**
 *
 * The requirement is that the commercial status gates nothing — it must not
 * decide what a student may do, must not be shown to them as a plan, and must
 * not be described anywhere as a payment having happened. There is no payment
 * system behind it in this release (FR-2904 is deferred), so a surface that
 * started reading it would be enforcing an arrangement nobody can make.
 *
 * A grep is a weak test in general and the right one here. The column is a
 * fact about a student that lives one join away from every student query, and
 * the failure this guards against is somebody adding `AND subscription_status
 * = 'active'` to a selector in six months because it looked like the obvious
 * way to gate a feature. That is a textual event, and this catches it in the
 * second it takes to run.
 *
 * It also asserts the column IS read by the console — a test that would pass
 * if the feature were deleted outright is not a test.
 *
 * @covers FR-2404
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const APP = fileURLToPath(new URL("../app", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Every column and camelCase form the status could be reached by. */
const FORBIDDEN = [
  "subscription_status",
  "subscriptionStatus",
  "subscription_note",
  "subscriptionNote",
  "subscription_updated",
  "subscriptionUpdated",
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...filesUnder(full));
    } else if (/\.(ts|tsx|mts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The student's own surfaces, and the four API routes a student's client calls.
 *
 * `(student)` is every page a signed-in child sees. The four routes are the
 * ones the product calls during a lesson: a tutor turn, an answer, the
 * end-of-lesson rating, and a photograph.
 */
function studentSurfaceFiles(): string[] {
  return [
    ...filesUnder(join(APP, "(student)")),
    join(APP, "api/ask/route.ts"),
    join(APP, "api/attempts/route.ts"),
    join(APP, "api/understanding/route.ts"),
    join(APP, "api/uploads/route.ts"),
    join(APP, "api/uploads/[id]/route.ts"),
  ];
}

test("no student surface reads the commercial status (FR-2404)", () => {
  const files = studentSurfaceFiles();
  assert.ok(files.length >= 6, "the scan found almost nothing — the paths are wrong, not the code");

  const offenders: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const needle of FORBIDDEN) {
      if (src.includes(needle)) offenders.push(`${file.slice(SRC.length)} mentions ${needle}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "FR-2404: the commercial status gates nothing and no student surface may read it.\n" +
      "There is no payment system behind it — a surface reading it would be enforcing " +
      "an arrangement nobody can make."
  );
});

test("the console does read it, so this test cannot pass by the feature being gone", () => {
  const consoleQueries = readFileSync(join(SRC, "lib/console-queries.ts"), "utf8");
  assert.ok(
    consoleQueries.includes("subscription_status"),
    "the student list and the 360 show the status; if they stopped, the guard above is vacuous"
  );
  const route = readFileSync(
    join(APP, "api/console/students/[id]/subscription/route.console.ts"),
    "utf8"
  );
  for (const column of [
    "subscription_status",
    "subscription_note",
    "subscription_updated_at",
    "subscription_updated_by",
  ]) {
    assert.ok(route.includes(column), `FR-2405: the change must write ${column}`);
  }
});

test("the endpoint that changes it is a console file, absent from the student build", () => {
  // The suffix is the mechanism (next.config.ts `pageExtensions`): a handler
  // named `route.ts` here would be a student-build endpoint that writes a
  // student's commercial status.
  const files = filesUnder(join(APP, "api/console"));
  assert.ok(files.length > 0, "no console endpoint found at all");
  for (const f of files) {
    assert.ok(
      f.endsWith("/route.console.ts"),
      `${f.slice(SRC.length)} would resolve in the student build (FR-2201)`
    );
  }
});

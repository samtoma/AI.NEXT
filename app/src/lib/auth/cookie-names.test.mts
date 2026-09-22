/**
 * @covers FR-2205 (F-P2b)
 *
 * The pure lookup both `cookies.ts` and `proxy.ts` (via `proxy-rules.ts`)
 * build the surface split on. No environment, no I/O — the whole point is
 * that this file cannot get the answer wrong depending on how it is loaded.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { cookieNames } from "./cookie-names.ts";

test("student surface keeps the original names", () => {
  assert.deepEqual(cookieNames("student"), { access: "ainext_at", refresh: "ainext_rt" });
});

test("admin surface gets names of its own", () => {
  assert.deepEqual(cookieNames("admin"), { access: "ainext_cat", refresh: "ainext_crt" });
});

test("the two surfaces never share a name", () => {
  const student = cookieNames("student");
  const admin = cookieNames("admin");
  assert.notEqual(student.access, admin.access);
  assert.notEqual(student.refresh, admin.refresh);
});

/**
 * FR-2606 — a gender change takes effect on the tutor's NEXT turn.
 *
 * The grounding snapshot is replayed verbatim for three hours so the prompt
 * prefix stays cache-hot, and after P6 the address forms live inside that
 * replayed payload. The register is therefore part of the key: unchanged, it
 * costs nothing; changed, it misses exactly once and the next turn is built
 * with the new one. The decision and its alternative are recorded in
 * `lib/session-cache.ts`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { snapshotKey } from "./session-cache.ts";

const BASE = {
  surface: "lesson_learn",
  chatSession: "sess-1",
  studentId: 7,
  lesson: "u1-1",
} as const;

test("the same register is the same key — the prefix stays cache-hot", () => {
  assert.equal(
    snapshotKey({ ...BASE, gender: "female" }),
    snapshotKey({ ...BASE, gender: "female" })
  );
});

test("a changed register is a changed key (FR-2606)", () => {
  const keys = (["female", "male", null] as const).map((gender) =>
    snapshotKey({ ...BASE, gender })
  );
  assert.equal(new Set(keys).size, 3, "two registers shared one snapshot");
});

test("unspecified and null are one register, so one key", () => {
  assert.equal(
    snapshotKey({ ...BASE, gender: "unspecified" }),
    snapshotKey({ ...BASE, gender: null })
  );
});

test("the key carries the register, never the stored value", () => {
  for (const gender of ["female", "male", "unspecified", null] as const) {
    const k = snapshotKey({ ...BASE, gender });
    assert.equal(/female|male|unspecified/.test(k), false, k);
  }
});

test("an attached upload is a changed key (FR-205)", () => {
  // The transcription of a photographed worksheet lands inside the data block
  // this cache replays verbatim. Without the id in the key, a snapshot built
  // before the photograph arrived would be served for the next three hours and
  // the tutor would never see the student's own page — a grounding link that
  // is wired end to end and still dead.
  const none = snapshotKey({ ...BASE, gender: null });
  const first = snapshotKey({ ...BASE, uploadId: 41, gender: null });
  const second = snapshotKey({ ...BASE, uploadId: 42, gender: null });
  assert.equal(new Set([none, first, second]).size, 3);
  // …and re-asking about the SAME upload stays a hit, so the prefix that
  // carries the transcription is built once and then stays cache-hot.
  assert.equal(first, snapshotKey({ ...BASE, uploadId: 41, gender: null }));
});

test("students and sessions still never share a snapshot", () => {
  const a = snapshotKey({ ...BASE, gender: "female" });
  assert.notEqual(a, snapshotKey({ ...BASE, studentId: 8, gender: "female" }));
  assert.notEqual(a, snapshotKey({ ...BASE, chatSession: "sess-2", gender: "female" }));
  assert.notEqual(a, snapshotKey({ ...BASE, questionId: "q:u1-1-1:001", gender: "female" }));
  assert.notEqual(a, snapshotKey({ ...BASE, wrongAnswer: "12", gender: "female" }));
});

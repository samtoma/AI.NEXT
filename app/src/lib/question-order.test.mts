/**
 * The bank order for a sitting (lib/question-order.ts): the same questions in
 * every sitting is the defect, so the assertions that matter are that the
 * order changes between sittings, holds within one, puts this student's
 * unanswered questions first, and never breaks the objective/tier grouping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { orderQuestionsForSitting } from "./question-order.ts";

const bank = ["lo:a-1", "lo:a-2"].flatMap((loId) =>
  ["basic", "standard"].flatMap((tier) =>
    Array.from({ length: 8 }, (_, k) => ({ id: `q:${loId}-${tier}-${k}`, loId, tier }))
  )
);
const none = new Set<string>();
const groupKeys = (qs: typeof bank) => qs.map((q) => `${q.loId}|${q.tier}`);

test("same sitting, same order — a rebuild mid-sitting never reshuffles", () => {
  assert.deepEqual(
    orderQuestionsForSitting(bank, none, "chat-1"),
    orderQuestionsForSitting(bank, none, "chat-1")
  );
});

test("a new sitting gets a different order", () => {
  const firsts = new Set(
    Array.from({ length: 10 }, (_, s) => orderQuestionsForSitting(bank, none, `chat-${s}`)[0].id)
  );
  assert.ok(firsts.size > 1, "ten sittings all opened on the same question");
});

test("the objective/tier grouping the prompt relies on is unchanged", () => {
  assert.deepEqual(groupKeys(orderQuestionsForSitting(bank, none, "chat-9")), groupKeys(bank));
});

test("no question is lost or duplicated", () => {
  const out = orderQuestionsForSitting(bank, none, "chat-3");
  assert.deepEqual(out.map((q) => q.id).sort(), bank.map((q) => q.id).sort());
});

test("this student's unanswered questions come first in every group", () => {
  const answered = new Set(bank.filter((_, i) => i % 3 === 0).map((q) => q.id));
  for (const seed of ["chat-1", "chat-2", "chat-3"]) {
    const out = orderQuestionsForSitting(bank, answered, seed);
    for (const key of new Set(groupKeys(bank))) {
      const flags = out.filter((q) => `${q.loId}|${q.tier}` === key).map((q) => answered.has(q.id));
      assert.deepEqual(flags, [...flags].sort((x, y) => Number(x) - Number(y)), `${key} has an answered question before an unanswered one`);
    }
  }
});

test("everything answered still varies, rather than falling back to the book order", () => {
  const all = new Set(bank.map((q) => q.id));
  const firsts = new Set(
    Array.from({ length: 10 }, (_, s) => orderQuestionsForSitting(bank, all, `chat-${s}`)[0].id)
  );
  assert.ok(firsts.size > 1);
});

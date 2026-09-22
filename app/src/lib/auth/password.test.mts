/**
 * @covers FR-2003
 *
 * The password policy, and the wall.
 *
 * The important assertion in this file is the last one: **no function in
 * `password.ts` returns the password**, in any branch, under any name. That is
 * what makes "a password never appears in a log, an event, an error or a web
 * address" a property of the code rather than a promise about it — a caller
 * cannot forward what it was never handed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PARAMS,
  checkPolicy,
  hashPassword,
  verifyPassword,
} from "./password.ts";

test("the OWASP parameters are pinned, not defaulted", () => {
  assert.equal(PASSWORD_PARAMS.memoryCost, 19456, "19 MiB");
  assert.equal(PASSWORD_PARAMS.timeCost, 2);
  assert.equal(PASSWORD_PARAMS.parallelism, 1);
});

test("eight characters is the floor, stated", () => {
  assert.equal(MIN_PASSWORD_LENGTH, 8);
  assert.deepEqual(checkPolicy("1234567", "omar@example.com"), {
    ok: false,
    error: "password_too_short",
    field: "password",
  });
  assert.deepEqual(checkPolicy("12345678", "omar@example.com"), { ok: true });
});

test("a non-string password is short, not a crash", () => {
  assert.equal(checkPolicy(undefined, "a@b.co").ok, false);
  assert.equal(checkPolicy(12345678, "a@b.co").ok, false);
  assert.equal(checkPolicy(null, "a@b.co").ok, false);
});

test("the password may not be the email's local part, in any case", () => {
  assert.equal(checkPolicy("omarhassan", "omarhassan@example.com").ok, false);
  assert.equal(checkPolicy("OmarHassan", "omarhassan@example.com").ok, false);
  assert.equal(checkPolicy("  omarhassan  ", "OMARHASSAN@example.com").ok, false);
  assert.equal(checkPolicy("omarhassan1", "omarhassan@example.com").ok, true);
});

test("an unbounded password is refused rather than hashed", () => {
  assert.equal(checkPolicy("x".repeat(MAX_PASSWORD_LENGTH), "a@b.co").ok, true);
  assert.deepEqual(checkPolicy("x".repeat(MAX_PASSWORD_LENGTH + 1), "a@b.co"), {
    ok: false,
    error: "password_too_long",
    field: "password",
  });
});

test("a hash verifies its own password and nothing else", async () => {
  const hash = await hashPassword("a-real-password-9");
  assert.match(hash, /^\$argon2id\$/, "Argon2id, per D9");
  assert.equal(await verifyPassword(hash, "a-real-password-9"), true);
  assert.equal(await verifyPassword(hash, "a-real-password-8"), false);
  assert.equal(await verifyPassword(hash, ""), false);
});

test("the same password hashes differently every time (it is salted)", async () => {
  const a = await hashPassword("a-real-password-9");
  const b = await hashPassword("a-real-password-9");
  assert.notEqual(a, b);
});

test("a corrupt stored hash refuses rather than throwing", async () => {
  assert.equal(await verifyPassword("not-a-hash", "anything"), false);
  assert.equal(await verifyPassword("", "anything"), false);
});

// FR-2003 — the property, not the promise.
test("nothing this module returns contains the password", async () => {
  const password = "correct-horse-battery";
  const results: unknown[] = [
    checkPolicy(password, "omar@example.com"),
    checkPolicy("short", "omar@example.com"),
    checkPolicy(password, "correct-horse-battery@example.com"),
    await hashPassword(password),
    await verifyPassword(await hashPassword(password), password),
  ];
  for (const r of results) {
    assert.equal(
      JSON.stringify(r).includes(password),
      false,
      `a password reached a caller through ${JSON.stringify(r)}`
    );
  }
});

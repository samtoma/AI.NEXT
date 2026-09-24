/**
 * **No upload is refused for count** (ADR-0023, FR-3407), and the refusals
 * that are not about count still stand — asserted against the source.
 *
 * Until v0.9.0 `POST /api/uploads` counted the student's uploads in the last
 * 24 hours inside its unit of work and answered 429 at ten, and the composer
 * told the student "That's 10 uploads today — my limit". Samuel removed the
 * limit. This file makes putting it back a decision rather than an edit: the
 * count, the constant, the 429 and the sentence are all checked for.
 *
 * The counterweight matters as much: a scan that only looked for absences
 * would pass if somebody deleted the size and type checks along with the cap.
 * Those are not counts, and they stay.
 *
 * Comments are stripped before scanning — the route explains what was taken
 * out, and a sentence about a thing is not the thing.
 *
 * @covers FR-3407
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const code = (rel: string) => strip(readFileSync(join(SRC, rel), "utf8"));

function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && p !== SELF) out.push(p);
  }
  return out;
}

const ROUTE = "app/api/uploads/route.ts";

test("the upload route refuses nothing for count", () => {
  const route = code(ROUTE);
  assert.doesNotMatch(route, /DAILY_UPLOAD_CAP/);
  assert.doesNotMatch(route, /uploadsToday/);
  assert.doesNotMatch(route, /\bcapped\b/);
  assert.doesNotMatch(route, /status:\s*429/, "no 429 from this route");
  assert.doesNotMatch(route, /count\(\*\)/, "the route counts nothing");
  assert.doesNotMatch(route, /DAILY_UPLOAD_THRESHOLD|uploadThresholdStatus/, "the threshold is the console's, not the route's");
});

test("…and still refuses by type, by size and for an unconfirmed address", () => {
  const route = code(ROUTE);
  assert.match(route, /if \(!isAccepted\(fileType\)\) \{[\s\S]{0,200}status: 415/, "type → 415");
  assert.match(route, /if \(file\.size > MAX_UPLOAD_BYTES\) \{[\s\S]{0,200}status: 413/, "size → 413");
  assert.match(route, /if \(!me\.emailVerified\) \{[\s\S]{0,120}"email_unverified"[\s\S]{0,40}status: 403/, "FR-2004 → 403");
  // type is still checked before size, for the reason the route gives
  assert.ok(route.indexOf("isAccepted(fileType)") < route.indexOf("MAX_UPLOAD_BYTES)"));
  // and the limit it quotes is the shared one
  const contract = code("lib/upload-contract.ts");
  assert.match(contract, /export const MAX_UPLOAD_BYTES = 10 \* 1024 \* 1024;/);
});

test("the cap is gone from the contract, its copy and every client path", () => {
  const contract = code("lib/upload-contract.ts");
  assert.doesNotMatch(contract, /DAILY_UPLOAD_CAP/);
  assert.doesNotMatch(contract, /"cap"/, "no cap failure, no cap case");
  assert.doesNotMatch(contract, /429/);
  for (const file of sourceFiles()) {
    const text = strip(readFileSync(file, "utf8"));
    assert.doesNotMatch(text, /DAILY_UPLOAD_CAP/, file);
    assert.doesNotMatch(text, /\buploadsToday\b/, file);
    assert.doesNotMatch(text, /uploads today — my limit/, file);
  }
});

test("the old number lives on as the console's threshold, and nowhere else decides with it", () => {
  const thresholds = code("lib/turn-thresholds.ts");
  assert.match(thresholds, /export const DAILY_UPLOAD_THRESHOLD = 10;/);
  const users = sourceFiles()
    .filter((f) => !/\.test\.m?ts$/.test(f))
    .filter((f) => /DAILY_UPLOAD_THRESHOLD/.test(strip(readFileSync(f, "utf8"))))
    .map((f) => f.slice(SRC.length));
  // Only the module that defines it and the console read that counts against
  // it — never a route, never a component, never anything that could refuse.
  const allowed = new Set(["lib/turn-thresholds.ts", "lib/upload-threshold-queries.ts"]);
  assert.ok(users.includes("lib/turn-thresholds.ts"));
  for (const u of users) assert.ok(allowed.has(u), `${u} uses the upload threshold`);
});

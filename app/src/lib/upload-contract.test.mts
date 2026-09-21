/**
 * The upload contract, as the browser sees it (FR-205, PRD B10).
 *
 * Everything asserted here is pure on purpose. "Validate type and size
 * client-side before sending, and say plainly what is wrong, in the student's
 * own words, never a status code" is a product requirement, and a requirement
 * that only exists inside a `.tsx` cannot be checked under `node --test`, which
 * does not strip JSX. So the verdicts, the sentences, the poll schedule and the
 * id coercion live in a module with no imports and no DOM, and the component
 * around them holds no rules of its own.
 *
 * Two of these are worth more than the rest:
 *
 *  · **No sentence contains a status code**, in either register. It is the one
 *    property a reviewer would otherwise have to take on trust across a dozen
 *    strings, and it is the one that decays first — the next person to add a
 *    refusal reaches for `res.status` because it is right there.
 *  · **The poll ceiling is past the server's own parse timeout.** A client that
 *    gave up first would report failure on a parse that was still running, and
 *    the two numbers live in different files, so nothing but this notices when
 *    one of them moves.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ACCEPTED_UPLOAD_TYPES,
  DAILY_UPLOAD_CAP,
  MAX_UPLOAD_BYTES,
  UPLOAD_ACCEPT_ATTR,
  UPLOAD_POLL_CEILING_MS,
  UPLOAD_POLL_FIRST_MS,
  UPLOAD_POLL_MAX_MS,
  coerceUploadId,
  refuseUpload,
  uploadFailureMessage,
  uploadFailureOf,
  uploadPhaseMessage,
  uploadPollDelayMs,
  uploadRefusalMessage,
  uploadTypeOf,
  type UploadFailure,
  type UploadLang,
  type UploadPhase,
  type UploadRefusal,
} from "./upload-contract.ts";

const SMALL = 200 * 1024;
const file = (over: Partial<{ type: string; name: string; size: number }> = {}) => ({
  type: "image/jpeg",
  name: "worksheet.jpg",
  size: SMALL,
  ...over,
});

/* ------------------------------------------------------------ verdicts */

test("the three accepted types pass, and nothing else does", () => {
  for (const type of ACCEPTED_UPLOAD_TYPES) {
    assert.equal(refuseUpload(file({ type })), null, type);
  }
  for (const type of ["image/heic", "image/gif", "text/plain", "application/zip", ""]) {
    assert.equal(refuseUpload(file({ type, name: "x.bin" })), "type", type);
  }
});

test("type is checked before size — a huge unsupported file says so at once", () => {
  // The route's own ordering, and its reason: "that file type isn't supported"
  // is useful, and making somebody wait through a 40 MB upload to be told the
  // same thing is not.
  assert.equal(
    refuseUpload(file({ type: "application/zip", name: "hw.zip", size: 40 * 1024 * 1024 })),
    "type"
  );
});

test("an oversized photo is refused before it leaves the phone", () => {
  assert.equal(refuseUpload(file({ size: MAX_UPLOAD_BYTES + 1 })), "size");
  assert.equal(refuseUpload(file({ size: MAX_UPLOAD_BYTES })), null, "the limit itself is fine");
});

test("a zero-byte file gets its own answer, not 'too big'", () => {
  assert.equal(refuseUpload(file({ size: 0 })), "empty");
});

test("a picker that declares no type is read from the extension", () => {
  // Several Android file managers hand back a perfectly good JPEG with
  // `type: ""`. Refusing it would tell a student their homework photograph is
  // an unsupported file, which is the worst possible answer to "here is my
  // work".
  assert.equal(uploadTypeOf({ type: "", name: "IMG_0042.JPG" }), "image/jpeg");
  assert.equal(uploadTypeOf({ type: "", name: "scan.pdf" }), "application/pdf");
  assert.equal(refuseUpload(file({ type: "", name: "IMG_0042.JPG" })), null);
  // …but an extension we do not accept is still refused.
  assert.equal(refuseUpload(file({ type: "", name: "notes.docx" })), "type");
  // A declared type always wins: the fallback is for silence, not for override.
  assert.equal(uploadTypeOf({ type: "image/png", name: "x.pdf" }), "image/png");
});

test("the accept attribute offers exactly the accepted types", () => {
  assert.equal(UPLOAD_ACCEPT_ATTR, ACCEPTED_UPLOAD_TYPES.join(","));
});

test("every HTTP refusal maps to a failure the student can read", () => {
  assert.equal(uploadFailureOf(415), "type");
  assert.equal(uploadFailureOf(413), "size");
  assert.equal(uploadFailureOf(429), "cap");
  assert.equal(uploadFailureOf(403), "unverified");
  assert.equal(uploadFailureOf(401), "unverified");
  // Anything unforeseen is still a thing that did not work.
  assert.equal(uploadFailureOf(500), "server");
  assert.equal(uploadFailureOf(418), "server");
});

/* ---------------------------------------------------------------- copy */

const LANGS: UploadLang[] = ["en", "ar"];
const REFUSALS: UploadRefusal[] = ["type", "empty", "size"];
const FAILURES: UploadFailure[] = [
  "type",
  "size",
  "cap",
  "unverified",
  "offline",
  "server",
];
const PHASES: UploadPhase[] = [
  "uploading",
  "pending",
  "parsed",
  "unreadable",
  "failed",
  "slow",
];

/** Every student-facing sentence this module can produce. */
function everySentence(): string[] {
  const out: string[] = [];
  for (const lang of LANGS) {
    for (const r of REFUSALS) out.push(uploadRefusalMessage(r, 12.5 * 1048576, lang));
    for (const f of FAILURES) out.push(uploadFailureMessage(f, 12.5 * 1048576, lang));
    for (const p of PHASES) out.push(uploadPhaseMessage(p, lang));
  }
  return out;
}

test("every sentence exists, in both registers", () => {
  for (const s of everySentence()) {
    assert.equal(typeof s, "string");
    assert.ok(s.trim().length > 0, "an empty sentence is a silent failure");
  }
});

test("no sentence shows the student a status code", () => {
  const CODE = /\b(400|401|403|404|413|415|429|500|502|503)\b/;
  for (const s of everySentence()) {
    assert.equal(CODE.test(s), false, `a status code leaked into student copy: ${s}`);
  }
});

test("no sentence names a media type, a header or an error class", () => {
  const JARGON = /multipart|mime|content-type|octet-stream|error:|exception|null|undefined/i;
  for (const s of everySentence()) {
    assert.equal(JARGON.test(s), false, `developer language leaked into copy: ${s}`);
  }
});

test("the size refusal quotes the file's own size and the limit", () => {
  const msg = uploadRefusalMessage("size", 12.5 * 1048576, "en");
  assert.match(msg, /12\.5/, "the student is told how big their file actually is");
  assert.match(msg, /\b10\b/, "…and what the limit is");
});

test("the cap message names the cap", () => {
  assert.match(uploadFailureMessage("cap", 0, "en"), new RegExp(`\\b${DAILY_UPLOAD_CAP}\\b`));
  // Arabic-Indic, per the Arabic register's own rule (lib/ask.ts).
  assert.match(uploadFailureMessage("cap", 0, "ar"), /١٠/);
});

test("the Arabic register carries no Latin digits", () => {
  for (const lang of ["ar"] as const) {
    for (const r of REFUSALS) {
      assert.equal(/\d/.test(uploadRefusalMessage(r, 12.5 * 1048576, lang)), false);
    }
    for (const f of FAILURES) {
      assert.equal(/\d/.test(uploadFailureMessage(f, 12.5 * 1048576, lang)), false);
    }
  }
});

test("a failure the server and the browser share reads identically", () => {
  // A 40 MB scan that slipped past the picker must not be described one way
  // when we catch it and another way when the route does.
  for (const lang of LANGS) {
    assert.equal(
      uploadFailureMessage("size", MAX_UPLOAD_BYTES + 1, lang),
      uploadRefusalMessage("size", MAX_UPLOAD_BYTES + 1, lang)
    );
    assert.equal(
      uploadFailureMessage("type", SMALL, lang),
      uploadRefusalMessage("type", SMALL, lang)
    );
  }
});

test("a parse that failed never reads like a parse that is running", () => {
  for (const lang of LANGS) {
    const running = [
      uploadPhaseMessage("uploading", lang),
      uploadPhaseMessage("pending", lang),
    ];
    for (const bad of ["unreadable", "failed", "slow"] as const) {
      assert.equal(
        running.includes(uploadPhaseMessage(bad, lang)),
        false,
        `${bad} is indistinguishable from progress in ${lang}`
      );
    }
  }
});

/* ------------------------------------------------------------- polling */

test("the first poll is soon, and the interval grows to a cap", () => {
  assert.equal(uploadPollDelayMs(0), UPLOAD_POLL_FIRST_MS);
  let previous = uploadPollDelayMs(0);
  for (let i = 1; i < 40; i++) {
    const d = uploadPollDelayMs(i);
    assert.ok(d >= previous, `poll ${i} got faster, not slower`);
    assert.ok(d <= UPLOAD_POLL_MAX_MS, `poll ${i} exceeded the cap`);
    previous = d;
  }
  assert.equal(uploadPollDelayMs(40), UPLOAD_POLL_MAX_MS, "it settles at the cap");
});

test("a nonsense attempt number still yields a sane delay", () => {
  for (const n of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
    const d = uploadPollDelayMs(n);
    assert.ok(d >= UPLOAD_POLL_FIRST_MS && d <= UPLOAD_POLL_MAX_MS, String(n));
  }
});

test("the client never gives up before the server has", () => {
  // `PARSE_TIMEOUT_MS` in `lib/uploads.ts` is 90 s, and that module cannot be
  // imported here (it spawns a child process and opens a pool). The number is
  // restated, and the point of the assertion is the INEQUALITY: whichever way
  // either side moves, the client must outlast the parse plus the write of its
  // outcome row.
  const SERVER_PARSE_TIMEOUT_MS = 90_000;
  assert.ok(
    UPLOAD_POLL_CEILING_MS > SERVER_PARSE_TIMEOUT_MS,
    "the client would report failure on a parse that is still running"
  );
});

test("the poll budget stays modest on a slow connection", () => {
  // Roughly how many requests one photograph costs before the ceiling. A fixed
  // one-second interval would be ninety; the backoff exists to keep this small
  // for a phone that is paying for every one of them.
  let elapsed = 0;
  let polls = 0;
  while (elapsed <= UPLOAD_POLL_CEILING_MS) {
    elapsed += uploadPollDelayMs(polls);
    polls++;
  }
  assert.ok(polls < 40, `${polls} polls for one upload is too many`);
});

/* ------------------------------------------------------------- the id */

test("a usable upload id survives the wire", () => {
  assert.equal(coerceUploadId(1), 1);
  assert.equal(coerceUploadId(4096), 4096);
  assert.equal(coerceUploadId("12"), 12, "JSON clients differ about numbers");
});

test("a malformed upload id is dropped, never guessed at", () => {
  for (const bad of [
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 2,
    null,
    undefined,
    true,
    false,
    "",
    "abc",
    "../../etc/passwd",
    [],
    [7],
    {},
    { id: 7 },
  ]) {
    assert.equal(coerceUploadId(bad), undefined, JSON.stringify(bad) ?? String(bad));
  }
});

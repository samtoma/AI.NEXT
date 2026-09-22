/**
 * The upload contract — the ONE place the browser and the server agree about
 * what a student may send, plus the student-facing words for every way it can
 * go wrong (PRD B10, FR-205/206).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS
 * ---------------------------------------------------------------------------
 * `lib/uploads.ts` owns the server half — storage, the parse, the cost meter —
 * and it imports `node:child_process`, `node:fs/promises` and the database. No
 * browser bundle can ever contain it. So the three numbers it enforced (10 MB,
 * ten a day, three media types) were unreachable from the client, and the only
 * way for a composer to refuse a 40 MB scan BEFORE sending it was to write
 * "10 MB" down a second time in a component.
 *
 * Two copies of a limit is how a student on 3G watches a 40 MB scan crawl for
 * four minutes to be told, at the end, that the limit was eight. The numbers
 * therefore live HERE, in a module with no imports at all, and `lib/uploads.ts`
 * re-exports them so every existing server call site is untouched. There is one
 * definition. The composer refuses early because it is reading the same
 * constant the route enforces — not because somebody remembers to keep them in
 * step.
 *
 * ---------------------------------------------------------------------------
 * CLIENT-SIDE VALIDATION IS A KINDNESS, NEVER A CONTROL
 * ---------------------------------------------------------------------------
 * Everything in the "verdicts" section below runs in a browser and is therefore
 * advisory: it exists to save a student a doomed upload and to say something
 * useful instead of a status code. `POST /api/uploads` re-checks every one of
 * them and is the only enforcement that counts — and the cap, which no client
 * can see, is checked there inside the same unit of work that writes the row.
 * Nothing here may ever become the reason a limit holds.
 *
 * ---------------------------------------------------------------------------
 * WHY THE COPY IS HERE AND NOT IN THE COMPONENT
 * ---------------------------------------------------------------------------
 * Two reasons. It is bilingual — the product's default register is English
 * (constitution v3.1.1 Principle V) but two of the three loaded courses are
 * Arabic, so every sentence exists twice and neither is "the" string. And it is
 * the part most worth a test: "say plainly what is wrong, in the student's own
 * words, never a status code" is a requirement, and a requirement that lives
 * inside a `.tsx` cannot be asserted under `node --test`, which does not strip
 * JSX. Pure functions in a `.ts` module can be, and are
 * (`upload-contract.test.mts`).
 *
 * The API's own English sentences stay where they are. `/api/uploads/[id]`
 * answers with a `message` for any client that has no UI of its own; this
 * surface ignores it and renders from `parseStatus`, because the status is the
 * contract and the sentence is not — and because the server has no idea which
 * language the student in front of it is reading.
 */

/* ===================================================== the limits, once */

/** 10 MB. Enforced by `POST /api/uploads`; previewed here. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Ten a day, per student (Principle VI — image tokens are the one place this
 * build could quietly outspend the baseline). The client never counts: it
 * learns it has run out from a 429 and says so.
 */
export const DAILY_UPLOAD_CAP = 10;

/**
 * A photograph of a worksheet, a screenshot, or a PDF handout. Deliberately
 * short: every type here is one the parse prompt can actually read, and a type
 * the model cannot open is a failure the student experiences as a hang.
 */
export const ACCEPTED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;

export type AcceptedUploadType = (typeof ACCEPTED_UPLOAD_TYPES)[number];

export function isAcceptedUploadType(t: string): t is AcceptedUploadType {
  return (ACCEPTED_UPLOAD_TYPES as readonly string[]).includes(t);
}

/**
 * The `accept` attribute for the file input.
 *
 * It is a HINT to the picker, not a guarantee: every mobile OS lets a
 * determined finger past it, which is why `refuseUpload` below runs on whatever
 * comes back regardless of what the picker was asked for.
 */
export const UPLOAD_ACCEPT_ATTR = ACCEPTED_UPLOAD_TYPES.join(",");

/* ================================================= the media-type fallback */

/**
 * Extension → media type, for the pickers that hand back a File with `type`
 * empty.
 *
 * This is not hypothetical and it is not a desktop problem: several Android
 * file managers, and a few camera intents, return a perfectly good JPEG whose
 * `type` is `""`. `FormData` then sends it with no declared type, the route's
 * `isAccepted` check refuses it, and the student is told their photograph is an
 * unsupported file — the single most demoralising possible answer to "here is
 * my homework".
 *
 * So when — and ONLY when — the browser declares nothing at all, the extension
 * is consulted and the file is re-wrapped with the inferred type before it is
 * sent (`typedUploadFile`). This does not weaken anything: the server still
 * accepts exactly three types and still refuses everything else, and a file
 * whose bytes do not match its name fails at the parse, which is already a
 * state the student is told about. A client could always have declared any type
 * it liked; the server's check was never trusting this one.
 */
const EXTENSION_TYPES: Record<string, AcceptedUploadType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

/** The media type to send for this file: the browser's, or the extension's. */
export function uploadTypeOf(file: { type: string; name: string }): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_TYPES[ext] ?? "";
}

/**
 * The file as it goes into the `FormData`, with the inferred type attached when
 * the browser declared none.
 *
 * Returns the original object untouched in the ordinary case — which is every
 * case on the stated device target (iPad Safari and desktop both type their
 * files correctly), so the re-wrap is a fallback path and not the normal one.
 */
export function typedUploadFile(file: File): File {
  if (file.type) return file;
  const inferred = uploadTypeOf(file);
  if (!inferred) return file;
  return new File([file], file.name, {
    type: inferred,
    lastModified: file.lastModified,
  });
}

/* ========================================================= the verdicts */

/** Why a file will not be sent. One code per sentence below. */
export type UploadRefusal = "type" | "empty" | "size";

/**
 * Advisory pre-flight for one picked file, in the route's own order.
 *
 * Type before size, for the route's reason: "that file type isn't supported"
 * is a useful message, and making somebody wait through a 40 MB upload to be
 * told the same thing is not. Emptiness sits between them because a 0-byte file
 * of an accepted type is a distinct and common accident (a picker handing back
 * a placeholder for a photo still syncing from iCloud) and deserves its own
 * sentence rather than "too big".
 */
export function refuseUpload(file: {
  type: string;
  name: string;
  size: number;
}): UploadRefusal | null {
  if (!isAcceptedUploadType(uploadTypeOf(file))) return "type";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_UPLOAD_BYTES) return "size";
  return null;
}

/**
 * Ways the SERVER can refuse, as the client understands them.
 *
 * Mapped from the status code at the one call site, so that no sentence below
 * has to know a number and no component ever shows one. `server` is the
 * catch-all: an unexpected status is still a thing that did not work, and the
 * student's next action is the same either way.
 */
export type UploadFailure =
  | "type"
  | "size"
  | "cap"
  | "unverified"
  | "offline"
  | "server";

/** HTTP status → the failure the student is told about. */
export function uploadFailureOf(status: number): UploadFailure {
  if (status === 415) return "type";
  if (status === 413) return "size";
  if (status === 429) return "cap";
  if (status === 403 || status === 401) return "unverified";
  return "server";
}

/* ============================================================== the copy */

export type UploadLang = "en" | "ar";

/** Latin → Arabic-Indic digits, for the Arabic register (see `lib/ask.ts`). */
const arDigits = (s: string): string =>
  s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);

/** "10.4" — one decimal place, which is all anyone needs to see. */
function megabytes(bytes: number, lang: UploadLang): string {
  const mb = (bytes / 1048576).toFixed(1);
  return lang === "ar" ? arDigits(mb) : mb;
}

/**
 * The limit as a whole number of megabytes, for the sentence that quotes it.
 * Derived rather than written out, so the copy cannot outlive the constant.
 */
const MAX_MB = String(Math.floor(MAX_UPLOAD_BYTES / 1048576));

/**
 * What a refused file says, in the student's own words.
 *
 * No status code, no MIME type, no "validation error" — and in every case a
 * next action the student can actually take, because the audience is a
 * fifteen-year-old who has just been told their homework did not go through.
 */
export function uploadRefusalMessage(
  refusal: UploadRefusal,
  bytes: number,
  lang: UploadLang
): string {
  if (lang === "ar") {
    switch (refusal) {
      case "type":
        return "الملف ده مش هينفتح معايا — ابعتلي صورة (JPG أو PNG) أو ملف PDF.";
      case "empty":
        return "الملف ده فاضي — جرّب تصوّر الورقة تاني.";
      case "size":
        return `الملف ${megabytes(bytes, "ar")} ميجا، وأنا باستحمل ${arDigits(
          MAX_MB
        )} بس — صوّر الورقة بدل ما تبعت السكان، أو قُص الصورة على السؤال.`;
    }
  }
  switch (refusal) {
    case "type":
      return "I can't open that kind of file — send me a photo (JPG or PNG) or a PDF.";
    case "empty":
      return "That file came through empty — try taking the photo again.";
    case "size":
      return `That file is ${megabytes(bytes, "en")} MB and I can take up to ${MAX_MB} — photograph the page instead of scanning it, or crop it to the question.`;
  }
}

/** What a server refusal says. Same rules: no codes, always a next action. */
export function uploadFailureMessage(
  failure: UploadFailure,
  bytes: number,
  lang: UploadLang
): string {
  // The two the server and the browser both know about share one sentence:
  // a student who slipped a 40 MB scan past the picker should read the same
  // thing whether we caught it or the route did.
  if (failure === "type" || failure === "size")
    return uploadRefusalMessage(failure, bytes, lang);
  if (lang === "ar") {
    switch (failure) {
      case "cap":
        return `بعتّ ${arDigits(
          String(DAILY_UPLOAD_CAP)
        )} حاجات النهارده — ده حدّي. نكمّل بالكتابة دلوقتي، وبكره تبعت تاني.`;
      case "unverified":
        return "أكّد إيميلك الأول وبعدها تقدر تبعتلي شغلك.";
      case "offline":
        return "مش عارف أوصل للنت — راجع الاتصال وجرّب تاني.";
      default:
        return "مروّحش — جرّب تاني بعد شوية، وفي الوقت ده اكتبلي السؤال.";
    }
  }
  switch (failure) {
    case "cap":
      return `That's ${DAILY_UPLOAD_CAP} uploads today — my limit. Let's keep going by typing, and send me more tomorrow.`;
    case "unverified":
      return "Confirm your email first, then you can send me your work.";
    case "offline":
      return "I can't reach the internet — check your connection and try again.";
    default:
      return "That didn't go through. Try again in a moment — and type the question to me meanwhile.";
  }
}

/**
 * The live states of one attachment, and what the student reads for each.
 *
 * `slow` is not a server state: it is what this surface says when the poll
 * ceiling is reached (below). It exists because "a parse that fails or comes
 * back unreadable must say so and must not look like a hang" — and a spinner
 * that never stops is the definition of a hang.
 */
export type UploadPhase =
  | "uploading"
  | "pending"
  | "parsed"
  | "unreadable"
  | "failed"
  | "slow";

export function uploadPhaseMessage(phase: UploadPhase, lang: UploadLang): string {
  if (lang === "ar") {
    switch (phase) {
      case "uploading":
        return "بابعت…";
      case "pending":
        return "بقرأ اللي بعتّه…";
      case "parsed":
        return "قريتها ✓ اسألني عنها";
      case "unreadable":
        return "مش قادر أقراها كويس — صوّرها تاني في نور أحسن، أو اكتبلي السؤال.";
      case "failed":
        return "حصلت مشكلة وأنا بقراها — جرّب تبعتها تاني.";
      case "slow":
        return "بتاخد وقت أطول من المعتاد — اكتبلي السؤال وأنا معاك، أو ابعتها تاني.";
    }
  }
  switch (phase) {
    case "uploading":
      return "Sending…";
    case "pending":
      return "Reading it…";
    case "parsed":
      return "Got it ✓ ask me about it";
    case "unreadable":
      return "I can't read that clearly enough — retake it in better light, or type the question to me.";
    case "failed":
      return "Something went wrong reading that — want to try sending it again?";
    case "slow":
      return "This is taking longer than usual — type your question and I'm with you, or send it again.";
  }
}

/** The labels on the two affordances and the remove button. */
export function uploadControlLabels(lang: UploadLang): {
  attach: string;
  camera: string;
  remove: string;
  region: string;
} {
  return lang === "ar"
    ? {
        attach: "ابعت صورة أو ملف",
        camera: "صوّر الورقة",
        remove: "شيل الملف",
        region: "الملف اللي بعتّه",
      }
    : {
        attach: "Send a photo or a file",
        camera: "Photograph the page",
        remove: "Remove this file",
        region: "Your upload",
      };
}

/* =========================================================== the polling */

/**
 * The poll schedule for `GET /api/uploads/{id}`.
 *
 * The route answers 202 and parses in the background, so the only way to learn
 * the outcome is to ask. Three numbers, and each is a decision:
 *
 *  · FIRST (900 ms) — small photographs come back in about a second, and the
 *    first poll is the one that makes the control feel instant. Not 0: an
 *    immediate poll is guaranteed to find `pending` and costs a round trip on
 *    the connection we are trying to protect.
 *  · MAX (4 s) — the interval GROWS towards this rather than sitting at the
 *    first one. A fixed 1 s interval over a 90 s parse is ninety requests from
 *    a phone on 3G for one photograph; the backoff makes it about thirty, with
 *    the dense polling where it pays (the first few seconds) and the sparse
 *    polling where it does not.
 *  · CEILING (100 s) — deliberately just PAST the server's own 90 s parse
 *    timeout (`PARSE_TIMEOUT_MS` in `lib/uploads.ts`). A client that gave up
 *    first would show "something went wrong" about a parse that was still
 *    running and about to succeed; ten seconds of slack covers the write of the
 *    outcome row. When this is reached the phase becomes `slow`, never silence.
 */
export const UPLOAD_POLL_FIRST_MS = 900;
export const UPLOAD_POLL_MAX_MS = 4_000;
export const UPLOAD_POLL_CEILING_MS = 100_000;

/** Delay before poll number `attempt` (0-based), growing 1.25× to the cap. */
export function uploadPollDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(
    UPLOAD_POLL_MAX_MS,
    Math.round(UPLOAD_POLL_FIRST_MS * Math.pow(1.25, n))
  );
}

/* ================================================ the id, across the wire */

/**
 * An upload id as `POST /api/ask` is willing to believe it.
 *
 * A positive safe integer, or nothing. It is NOT an ownership check and must
 * never grow into one: the id is handed to `askContext`, which reaches
 * `getParsedUpload(uploadId, studentId)` inside the student's own unit of work,
 * under a row-level-security policy that is enabled AND forced. An id belonging
 * to somebody else yields no row there — not a filtered row, no row — so a
 * second check in the route could only ever disagree with the one that
 * actually holds, and the disagreement would be the bug.
 *
 * What this does is keep `NaN`, `Infinity`, `-1`, `1.5`, objects and arrays out
 * of a query parameter. Strings of digits are accepted because JSON clients
 * differ about numbers and a dropped id costs the student their grounding
 * silently; booleans are not, because `Number(true)` is 1 and 1 is somebody's
 * upload.
 */
export function coerceUploadId(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) return undefined;
  return n;
}

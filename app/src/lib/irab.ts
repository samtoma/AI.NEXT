/**
 * إعراب grading — a scripted SLOT DIFF, never string equality. (ADR-0006)
 *
 * The extraction contract stores an إعراب answer as a typed record
 * (`services/extraction/schemas.py` → `IrabAnswer`), not as the formulaic
 * sentence a student writes. This module is the runtime half of that decision:
 * it compares the student's slots against the key's slots, awards partial
 * credit, and returns a COMPUTED diagnosis naming the one slot that went wrong.
 *
 * Three properties, all load-bearing:
 *
 *  1. **No model call.** Grading an إعراب is a table lookup and a set compare.
 *     Six of the vertical's nine question types grade this way (ADR-0006
 *     "Consequences"), which is why Arabic runtime cost lands below maths.
 *  2. **VARIANT is correct, not a defect** (arabic-verification.md §2.3.4).
 *     «منادى منصوب وعلامة نصبه الفتحة» and «منادى مضاف منصوب وعلامة نصبه الفتحة
 *     الظاهرة على آخره» are the same answer at two levels of fullness. A
 *     string-equality grader marks the fuller — i.e. the better — answer wrong.
 *     That single false failure is enough to make an anxious 15-year-old stop
 *     trusting the product, so subset-compatibility is a first-class verdict.
 *  3. **The diagnosis is computed here, not re-derived by the tutor.** The AI
 *     receives «the sign slot: الفتحة → الياء, licensed by <rule clause>» and
 *     verbalises it. It never solves the grammar itself, so it cannot invent a
 *     rule the book does not print (CLAUDE.md §3).
 *
 * Deliberately dependency-free (no React, no `@/` alias) so the same function
 * serves the widget, a future `/api/attempts` branch, and `node --test`.
 */

/* ------------------------------------------------------------------ */
/* The slot vocabulary — mirrors schemas.py so drift is visible         */
/* ------------------------------------------------------------------ */

export type IrabState = "مرفوع" | "منصوب" | "مجرور" | "مجزوم" | "مبني";

export type IrabPosition =
  | "في محل رفع"
  | "في محل نصب"
  | "في محل جر"
  | "في محل جزم";

export type IrabSign =
  | "الضمة"
  | "الفتحة"
  | "الكسرة"
  | "الألف"
  | "الواو"
  | "الياء"
  | "السكون"
  | "حذف النون"
  | "حذف حرف العلة"
  | "تنوين الفتح"
  | "تنوين الضم"
  | "تنوين الكسر"
  /** the built-on marker for مبني — «مبني على الضم» */
  | "الضم";

export type SignKind =
  | "ظاهرة"
  | "مقدرة"
  | "نائبة عن الفتحة"
  | "نائبة عن الضمة"
  | "نائبة عن الكسرة"
  | "—";

/** The human-approved answer key (one `IrabAnswer` row of a question). */
export interface IrabAnswer {
  word_ar: string;
  role_ar: string;
  state: IrabState;
  /** مبني only — «في محل نصب» */
  position?: IrabPosition | null;
  sign?: IrabSign | null;
  sign_kind?: SignKind;
  reason_ar?: string | null;
  /** RuleClause id — MUST resolve to a clause printed in THIS book */
  rule_ref: string;
  /** the full formulaic string, as the model answer displays it */
  surface_ar: string;
  /** human-approved equivalent phrasings (the VARIANT harvest) */
  accept_ar?: string[];
}

/**
 * What the student built, or what an independent model re-derived. Every slot
 * is optional: an under-specified answer is not a wrong answer (§2.3.4).
 */
export interface IrabSubmission {
  /** the token the student parsed — token alignment runs FIRST */
  word_ar?: string;
  role_ar?: string;
  state?: string;
  position?: string;
  sign?: string;
  sign_kind?: string;
  /**
   * The option text the student tapped, e.g. «منصوب بالفتحة» or
   * «مبني على الضم في محل نصب». Parsed into slots; explicit slots win.
   */
  mark_phrase?: string;
  /** a whole formulaic sentence (typed answer / a second model's `surface_ar`) */
  surface_ar?: string;
}

export type SlotName =
  | "token"
  | "role"
  | "state"
  | "position"
  | "sign"
  | "sign_kind";

export type SlotStatus =
  /** both sides present and equivalent */
  | "match"
  /** one side omits it, or one side is a fuller phrasing of the other */
  | "variant"
  /** both sides present and incompatible — this is the teachable moment */
  | "conflict";

export interface SlotOutcome {
  slot: SlotName;
  status: SlotStatus;
  expected: string;
  got: string;
  /** contribution to the score, 0–1 of this slot's weight */
  credit: number;
  weight: number;
}

export interface IrabDiagnosis {
  slot: SlotName;
  expected: string;
  got: string;
  /** student-facing Arabic, COMPUTED from a template — never model prose */
  message_ar: string;
  /** the printed clause the correct answer is licensed by */
  rule_ref: string;
  /** the clause text, when the caller supplied it */
  rule_quote_ar?: string;
  rule_page?: number;
  /**
   * What the student's pick WOULD have been right for, straight off the book's
   * printed sign table (§ RULE TABLE below). Absent when no table covers it.
   */
  belongs_to_ar?: string;
}

export type IrabVerdict =
  /** every compared slot equal */
  | "AGREE"
  /** compatible, differing only in fullness — CORRECT (§2.3.4) */
  | "VARIANT"
  /** some slots right, at least one conflict */
  | "PARTIAL"
  /** wrong token, or nothing survives */
  | "DISAGREE"
  /** the KEY itself is not shippable — never blame the student for this */
  | "KEY_INVALID";

export interface IrabResult {
  verdict: IrabVerdict;
  /** AGREE or VARIANT. The only thing the student's streak should look at. */
  correct: boolean;
  /** 0–1 partial credit over the weighted slots */
  score: number;
  slots: SlotOutcome[];
  /** the first conflicting slot in teaching order, or null when correct */
  diagnosis: IrabDiagnosis | null;
  /** English one-liner for the AI stream (widget `onResult` note) */
  note: string;
  /** populated only for KEY_INVALID */
  keyErrors: string[];
}

/** Optional grading context: the printed clause, and the noun's type. */
export interface IrabGradeOptions {
  rule?: { id?: string; quote_ar?: string; page?: number };
  /** enables the rule table as a deterministic third voter */
  nounType?: NounType;
  /** «مضاف» | «شبيه بالمضاف» | «نكرة غير مقصودة» | «علم مفرد» | «نكرة مقصودة» */
  subtype?: string;
}

/* ------------------------------------------------------------------ */
/* COMPARE form — folding for equivalence, never for display           */
/* ------------------------------------------------------------------ */

/**
 * Fold an Arabic term for COMPARISON only (the COMPARE-LOOSE form of
 * arabic-verification.md §1.3 — the STORE form is what we persist and render).
 * Strips تشكيل, tatweel and the Quranic annotation block; unifies the alef
 * family, ى/ي and ة/ه; drops Arabic punctuation; collapses whitespace.
 *
 * Never call this on anything that will be rendered — it removes the harakat
 * that ARE the content in this subject.
 */
export function foldCompare(s: string): string {
  return (
    (s ?? "")
      .normalize("NFC")
      // harakat, hamza/maddah marks, dagger alef, tatweel
      .replace(/[ً-ٰٟـ]/g, "")
      // Quranic annotation block (pause aids — publisher-specific, ADR-0006 §2)
      .replace(/[ۖ-ۭ]/g, "")
      // invisibles
      .replace(/[​-‏؜﻿]/g, "")
      .replace(/[آأإٱ]/g, "ا") // آأإٱ → ا
      .replace(/ى/g, "ي") // ى → ي
      .replace(/ة/g, "ه") // ة → ه
      .replace(/[.,؛،؟!:"'«»()[\]{}…—–-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Word list of the folded form (used for subset-compatibility). */
function foldWords(s: string): string[] {
  const f = foldCompare(s);
  return f === "" ? [] : f.split(" ");
}

/** Strip the ال / بال / وال clitics a pick-list phrase carries. */
function bareWord(w: string): string {
  let x = w;
  if (x.startsWith("و")) x = x.slice(1);
  if (x.startsWith("ب") || x.startsWith("ل") || x.startsWith("ك")) {
    if (x.slice(1).startsWith("ال")) x = x.slice(1);
  }
  if (x.startsWith("ال")) x = x.slice(2);
  return x;
}

/* ------------------------------------------------------------------ */
/* Phrase → slots. A closed lexicon, so a tapped option becomes data.  */
/* ------------------------------------------------------------------ */

const STATE_WORDS: Record<string, IrabState> = {
  مرفوع: "مرفوع",
  منصوب: "منصوب",
  مجرور: "مجرور",
  مجزوم: "مجزوم",
  مبني: "مبني",
};

const POSITION_WORDS: Record<string, IrabPosition> = {
  رفع: "في محل رفع",
  نصب: "في محل نصب",
  جر: "في محل جر",
  جزم: "في محل جزم",
};

/** bare (ال-stripped, ة-folded) word → canonical sign */
const SIGN_WORDS: Record<string, IrabSign> = {
  ضمه: "الضمة",
  ضم: "الضم",
  فتحه: "الفتحة",
  فتح: "الفتحة",
  كسره: "الكسرة",
  كسر: "الكسرة",
  الف: "الألف",
  واو: "الواو",
  ياء: "الياء",
  سكون: "السكون",
};

/** Multi-word signs, matched (and consumed) before the word scan. */
const SIGN_PHRASES: [string, IrabSign][] = [
  ["حذف حرف العله", "حذف حرف العلة"],
  ["حذف النون", "حذف النون"],
  ["تنوين الفتح", "تنوين الفتح"],
  ["تنوين الضم", "تنوين الضم"],
  ["تنوين الكسر", "تنوين الكسر"],
];

const KIND_PHRASES: [string, SignKind][] = [
  ["نائبه عن الفتحه", "نائبة عن الفتحة"],
  ["نيابه عن الفتحه", "نائبة عن الفتحة"],
  ["نائبه عن الضمه", "نائبة عن الضمة"],
  ["نيابه عن الضمه", "نائبة عن الضمة"],
  ["نائبه عن الكسره", "نائبة عن الكسرة"],
  ["نيابه عن الكسره", "نائبة عن الكسرة"],
];

/**
 * «منصوب وعلامة نصبه الفتحة الظاهرة» → {state, sign, sign_kind}.
 *
 * A pick-list option is a *phrase*; the grader needs slots. The lexicon is
 * closed (it is exactly schemas.py's enums plus the clitics Arabic writes them
 * with), so this parse is total and deterministic: anything it does not
 * recognise simply stays unset, which grades as "under-specified", never wrong.
 */
export function parseIrabPhrase(phrase: string): {
  state?: IrabState;
  position?: IrabPosition;
  sign?: IrabSign;
  sign_kind?: SignKind;
} {
  let f = foldCompare(phrase);
  if (!f) return {};
  const out: {
    state?: IrabState;
    position?: IrabPosition;
    sign?: IrabSign;
    sign_kind?: SignKind;
  } = {};

  for (const [needle, kind] of KIND_PHRASES) {
    if (f.includes(needle)) {
      out.sign_kind = kind;
      f = f.replace(needle, " ");
    }
  }
  for (const [needle, sign] of SIGN_PHRASES) {
    if (f.includes(needle)) {
      out.sign = sign;
      f = f.replace(needle, " ");
    }
  }
  // «في محل نصب» — the محل marker binds the following case word
  const mahal = /محل\s+(رفع|نصب|جر|جزم)/.exec(f);
  if (mahal) {
    out.position = POSITION_WORDS[mahal[1]];
    f = f.replace(mahal[0], " ");
  }

  for (const w of f.split(/\s+/).filter(Boolean)) {
    const b = bareWord(w);
    if (!out.state && STATE_WORDS[b]) {
      out.state = STATE_WORDS[b];
      continue;
    }
    if (!out.sign && SIGN_WORDS[b]) {
      out.sign = SIGN_WORDS[b];
      continue;
    }
    if (!out.sign_kind && (b === "ظاهره" || b === "مقدره")) {
      out.sign_kind = b === "ظاهره" ? "ظاهرة" : "مقدرة";
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* THE RULE TABLE — the deterministic third voter                      */
/* ------------------------------------------------------------------ */
/*
 * Encoded by hand from the book's own printed sign matrices (Prep-3 Arabic,
 * printed pp. 11 and 17 — «إعراب المنادى المضاف» and «المنادى المبني»), and
 * transcribed in arabic-verification.md §2.2. It is DATA, reviewed like a
 * passage: nothing here is inferred, and no topic gets a table until the book
 * prints one. Two jobs:
 *   - validate a key before it can mark anyone wrong;
 *   - name what the student's wrong pick WOULD have been right for, which is
 *     the difference between «غلط» and a lesson.
 */

export type NounType =
  | "مفرد"
  | "جمع تكسير"
  | "جمع مؤنث سالم"
  | "مثنى"
  | "جمع مذكر سالم"
  | "الأسماء الخمسة";

/** المنادى المعرب — منصوب; the sign varies with the noun's type (printed 11). */
export const MUNADA_MURAB_SIGN: Record<NounType, IrabSign> = {
  مفرد: "الفتحة",
  "جمع تكسير": "الفتحة",
  "جمع مؤنث سالم": "الكسرة",
  مثنى: "الياء",
  "جمع مذكر سالم": "الياء",
  "الأسماء الخمسة": "الألف",
};

/** المنادى المبني — مبني على ما يُرفع به، في محل نصب (printed 17). */
export const MUNADA_MABNI_ON: Partial<Record<NounType, IrabSign>> = {
  مفرد: "الضم",
  "جمع تكسير": "الضم",
  "جمع مؤنث سالم": "الضم",
  مثنى: "الألف",
  "جمع مذكر سالم": "الواو",
};

/** The three معرب subtypes and the two مبني ones, as the book names them. */
const MURAB_SUBTYPES = ["مضاف", "شبيه بالمضاف", "نكره غير مقصوده"];
const MABNI_SUBTYPES = ["علم مفرد", "نكره مقصوده", "مفرد علم"];

/**
 * The حالة a موقع implies, where THIS book states it — and `undefined`
 * everywhere else.
 *
 * The `irab_builder` filters its علامة list by the موقع the student just
 * picked, which is itself the teaching («ما دام مضاف، يبقى حكمه إيه؟»). That
 * filter must be sourced, not guessed: an unknown role simply shows every
 * option, which is a worse widget but never a wrong one.
 *
 * Printed: p.11 (المنادى المعرب منصوب), p.17 (المنادى المبني في محل نصب),
 * p.22 (نداء ما فيه «ال»؛ «أيّ» مبني على الضم).
 */
export function impliedState(role_ar: string): IrabState | undefined {
  const r = foldCompare(role_ar);
  if (r.includes("مضاف اليه")) return "مجرور";
  if (!r.includes("مناد") && !r.includes("اي")) return undefined;
  if (MABNI_SUBTYPES.some((s) => r.includes(s)) || r.includes("مبني")) return "مبني";
  if (MURAB_SUBTYPES.some((s) => r.includes(s)) || r.includes("معرب")) return "منصوب";
  return undefined;
}

/** Which noun types take this sign, in the معرب / مبني table respectively. */
export function signOwners(
  sign: IrabSign,
  state: IrabState
): NounType[] {
  const table: Partial<Record<NounType, IrabSign>> =
    state === "مبني" ? MUNADA_MABNI_ON : MUNADA_MURAB_SIGN;
  return (Object.keys(table) as NounType[]).filter((n) =>
    sameSign(table[n], sign)
  );
}

/**
 * Rule-table consistency for a منادى answer. Returns `null` when no table
 * covers the case — an honest "we don't know" beats a fabricated ruling
 * (arabic-verification.md §2.2: "where a topic has no table yet … note the
 * gap"). Never returns a verdict it cannot source from the printed page.
 */
export function checkRuleTable(
  ans: Pick<IrabAnswer, "role_ar" | "state" | "sign" | "position">,
  nounType?: NounType
): { ok: boolean; expected?: IrabSign; why: string } | null {
  if (!nounType) return null;
  const role = foldCompare(ans.role_ar);
  const isMunada = role.includes("منادي") || role.includes("مناد");
  if (!isMunada) return null;

  const mabniByRole = MABNI_SUBTYPES.some((s) => role.includes(s));
  const murabByRole = MURAB_SUBTYPES.some((s) => role.includes(s));
  const treatAsMabni = ans.state === "مبني" || (mabniByRole && !murabByRole);

  if (treatAsMabni) {
    const expected = MUNADA_MABNI_ON[nounType];
    if (!expected) return null; // الأسماء الخمسة never appears as a مبني منادى
    return {
      ok: ans.state === "مبني" && sameSign(ans.sign, expected),
      expected,
      why: `المنادى المبني من نوع «${nounType}» يُبنى على ${expected} في محل نصب`,
    };
  }
  const expected = MUNADA_MURAB_SIGN[nounType];
  return {
    ok: ans.state === "منصوب" && sameSign(ans.sign, expected),
    expected,
    why: `المنادى المعرب من نوع «${nounType}» منصوب ب${expected}`,
  };
}

/* ------------------------------------------------------------------ */
/* Slot comparison                                                     */
/* ------------------------------------------------------------------ */

/** الضم ≡ الضمة (and فتح/فتحة, كسر/كسرة) — the same mark, two spellings. */
const SIGN_CLASSES: string[][] = [["الضمة", "الضم"]];

function signClassKey(sign: string): string {
  const f = foldCompare(sign);
  for (const cls of SIGN_CLASSES)
    if (cls.some((c) => foldCompare(c) === f)) return foldCompare(cls[0]);
  return f;
}

function sameSign(a: IrabSign | null | undefined, b: IrabSign | null | undefined): boolean {
  if (!a || !b) return false;
  return signClassKey(a) === signClassKey(b);
}

type Cmp = { status: SlotStatus; expected: string; got: string };

/** Closed-vocabulary slot: equal, absent, or a genuine conflict. */
function cmpExact(
  expected: string | null | undefined,
  got: string | null | undefined,
  eq: (a: string, b: string) => boolean = (a, b) => foldCompare(a) === foldCompare(b)
): Cmp {
  const e = (expected ?? "").trim();
  const g = (got ?? "").trim();
  if (!e && !g) return { status: "match", expected: "", got: "" };
  if (!e || !g) return { status: "variant", expected: e, got: g };
  return { status: eq(e, g) ? "match" : "conflict", expected: e, got: g };
}

/**
 * Free-phrase slot (the role). Compared as WORD SETS so that «منادى منصوب» and
 * «منادى مضاف منصوب» are the same answer at two levels of fullness — the exact
 * case §2.3.4 calls VARIANT, and the exact case a string compare gets wrong.
 * Disjoint or crossing sets («مضاف إليه» vs «منادى مضاف») stay a conflict.
 */
function cmpPhrase(expected: string, got: string): Cmp {
  const e = (expected ?? "").trim();
  const g = (got ?? "").trim();
  if (!e && !g) return { status: "match", expected: "", got: "" };
  if (!e || !g) return { status: "variant", expected: e, got: g };
  const E = new Set(foldWords(e));
  const G = new Set(foldWords(g));
  if (E.size === G.size && [...E].every((w) => G.has(w)))
    return { status: "match", expected: e, got: g };
  const eSubG = [...E].every((w) => G.has(w));
  const gSubE = [...G].every((w) => E.has(w));
  if (eSubG || gSubE) return { status: "variant", expected: e, got: g };
  return { status: "conflict", expected: e, got: g };
}

/**
 * Slot weights. The two decisions the exam actually scores — الموقع and
 * العلامة — carry the weight; the elaborations (kind, محل) are worth little
 * because omitting them is not an error at all.
 */
const WEIGHT: Record<SlotName, number> = {
  token: 0,
  role: 3,
  state: 2,
  sign: 3,
  position: 0.5,
  sign_kind: 0.5,
};

/** Teaching order — the first conflict here is what the tutor talks about. */
const DIAGNOSIS_ORDER: SlotName[] = [
  "token",
  "role",
  "state",
  "sign",
  "position",
  "sign_kind",
];

/* ------------------------------------------------------------------ */
/* Key validation — a key that cannot be licensed never marks anyone   */
/* ------------------------------------------------------------------ */

/**
 * The runtime mirror of `IrabAnswer.slots_are_coherent` in schemas.py, plus the
 * §1.6 grounding gate. Anything listed here means the CONTENT is broken, so the
 * caller must refuse to render — marking a student against an unlicensed key is
 * the one failure mode worse than not asking the question at all.
 */
export function validateIrabKey(key: Partial<IrabAnswer> | null | undefined): string[] {
  const errs: string[] = [];
  if (!key || typeof key !== "object") return ["missing answer record"];
  if (!key.word_ar?.trim()) errs.push("word_ar is empty");
  if (!key.role_ar?.trim()) errs.push("role_ar is empty");
  if (!key.state) errs.push("state is missing");
  if (key.state === "مبني") {
    if (!key.position) errs.push("مبني needs its محل — «مبني على … في محل نصب»");
    if (key.sign_kind && key.sign_kind !== "—")
      errs.push("a مبني word has no علامة إعراب kind; use sign_kind '—'");
  } else if (key.state) {
    if (key.position) errs.push("a معرب word has a حالة, not a محل — drop position");
    if (!key.sign) errs.push("a معرب word needs its علامة");
  }
  // The grounding gate (arabic-viz-widgets.md §1.6): every إعراب must cite a
  // clause printed in THIS book. The book prints zero worked إعراب examples, so
  // an uncited answer is improvised grammar, however plausible it reads.
  if (!key.rule_ref || !/^gc:/.test(key.rule_ref))
    errs.push("rule_ref must cite a printed RuleClause id (gc:…)");
  return errs;
}

/* ------------------------------------------------------------------ */
/* The grader                                                          */
/* ------------------------------------------------------------------ */

export function gradeIrab(
  submission: IrabSubmission,
  key: IrabAnswer,
  opts: IrabGradeOptions = {}
): IrabResult {
  const keyErrors = validateIrabKey(key);
  if (keyErrors.length > 0) {
    return {
      verdict: "KEY_INVALID",
      correct: false,
      score: 0,
      slots: [],
      diagnosis: null,
      note: `irab: KEY_INVALID — ${keyErrors.join("; ")} (question withheld, student not marked)`,
      keyErrors,
    };
  }

  // 1. a tapped phrase becomes slots; anything explicit wins over the parse
  const parsed = submission.mark_phrase
    ? parseIrabPhrase(submission.mark_phrase)
    : {};
  const surfaceParsed = submission.surface_ar
    ? parseIrabPhrase(submission.surface_ar)
    : {};
  const sub = {
    word_ar: submission.word_ar,
    role_ar: submission.role_ar,
    state: submission.state ?? parsed.state ?? surfaceParsed.state,
    position: submission.position ?? parsed.position ?? surfaceParsed.position,
    sign: submission.sign ?? parsed.sign ?? surfaceParsed.sign,
    sign_kind: submission.sign_kind ?? parsed.sign_kind ?? surfaceParsed.sign_kind,
  };

  // 2. a whole-sentence answer that matches an approved phrasing is done —
  //    this is where the VARIANT harvest from verification lands at runtime
  const approved = [key.surface_ar, ...(key.accept_ar ?? [])].filter(Boolean);
  const surfaceHit =
    !!submission.surface_ar &&
    approved.some((a) => foldCompare(a) === foldCompare(submission.surface_ar!));

  // 3. token alignment first — a right analysis of the wrong word is not a
  //    partially-right answer, it is a different question (§2.3.1)
  const tokenCmp = cmpExact(key.word_ar, sub.word_ar);
  if (tokenCmp.status === "conflict") {
    const slots: SlotOutcome[] = [
      { slot: "token", ...tokenCmp, credit: 0, weight: WEIGHT.token },
    ];
    return {
      verdict: "DISAGREE",
      correct: false,
      score: 0,
      slots,
      diagnosis: {
        slot: "token",
        expected: key.word_ar,
        got: sub.word_ar ?? "",
        message_ar: `إنت أعربت «${sub.word_ar}» — بس السؤال على «${key.word_ar}».`,
        rule_ref: key.rule_ref,
        ...(opts.rule?.quote_ar ? { rule_quote_ar: opts.rule.quote_ar } : {}),
        ...(opts.rule?.page ? { rule_page: opts.rule.page } : {}),
      },
      note: `irab: WRONG TOKEN — parsed «${sub.word_ar}», question is on «${key.word_ar}»`,
      keyErrors: [],
    };
  }

  // 4. slot by slot
  const cmps: Record<Exclude<SlotName, "token">, Cmp> = {
    role: cmpPhrase(key.role_ar, sub.role_ar ?? ""),
    state: cmpExact(key.state, sub.state),
    sign: cmpExact(key.sign, sub.sign, (a, b) =>
      signClassKey(a) === signClassKey(b)
    ),
    position: cmpExact(key.position, sub.position),
    sign_kind: cmpExact(
      key.sign_kind === "—" ? "" : key.sign_kind,
      sub.sign_kind === "—" ? "" : sub.sign_kind
    ),
  };

  const slots: SlotOutcome[] = (
    ["role", "state", "sign", "position", "sign_kind"] as const
  ).map((name) => {
    const c = cmps[name];
    return {
      slot: name,
      status: c.status,
      expected: c.expected,
      got: c.got,
      weight: WEIGHT[name],
      // a variant (fuller, or simply omitted) earns full credit — it is not an
      // error, it is a different level of detail
      credit: c.status === "conflict" ? 0 : 1,
    };
  });
  slots.unshift({
    slot: "token",
    status: tokenCmp.status,
    expected: tokenCmp.expected,
    got: tokenCmp.got,
    weight: WEIGHT.token,
    credit: 1,
  });

  const totalWeight = slots.reduce((s, x) => s + x.weight, 0) || 1;
  const earned = slots.reduce((s, x) => s + x.weight * x.credit, 0);
  const score = surfaceHit ? 1 : Math.round((earned / totalWeight) * 1000) / 1000;

  const conflicts = slots.filter((s) => s.status === "conflict");
  const variants = slots.filter((s) => s.status === "variant" && s.weight > 0);

  // 5. the student must have said SOMETHING gradable: an empty submission is
  //    not a VARIANT, it is unanswered
  const answeredSlots = slots.filter(
    (s) => s.weight > 0 && (s.got ?? "") !== ""
  ).length;

  let verdict: IrabVerdict;
  if (surfaceHit) verdict = "VARIANT";
  else if (answeredSlots === 0) verdict = "DISAGREE";
  else if (conflicts.length === 0)
    verdict = variants.length === 0 ? "AGREE" : "VARIANT";
  else if (conflicts.some((c) => c.slot === "role") && conflicts.some((c) => c.slot === "sign"))
    verdict = "DISAGREE";
  else verdict = "PARTIAL";

  const correct = verdict === "AGREE" || verdict === "VARIANT";
  const diagnosis = correct
    ? null
    : buildDiagnosis(slots, key, sub, opts);

  return {
    verdict,
    correct,
    score,
    slots,
    diagnosis,
    note: buildNote(verdict, score, slots, key, sub),
    keyErrors: [],
  };
}

/* ------------------------------------------------------------------ */
/* The computed diagnosis                                              */
/* ------------------------------------------------------------------ */

function buildDiagnosis(
  slots: SlotOutcome[],
  key: IrabAnswer,
  sub: { state?: string; sign?: string },
  opts: IrabGradeOptions
): IrabDiagnosis | null {
  const first = DIAGNOSIS_ORDER.map((n) =>
    slots.find((s) => s.slot === n && s.status === "conflict")
  ).find(Boolean);
  if (!first) {
    // answered nothing gradable
    return {
      slot: "role",
      expected: key.role_ar,
      got: "",
      message_ar: "لسه ما اخترتش الموقع والعلامة — جرّب تاني.",
      rule_ref: key.rule_ref,
      ...(opts.rule?.quote_ar ? { rule_quote_ar: opts.rule.quote_ar } : {}),
      ...(opts.rule?.page ? { rule_page: opts.rule.page } : {}),
    };
  }

  let message = "";
  let belongs: string | undefined;
  switch (first.slot) {
    case "role":
      message = `الموقع مش «${first.got}» — «${key.word_ar}» هنا ${key.role_ar}.`;
      if (key.reason_ar) message += ` ${key.reason_ar}`;
      break;
    case "state":
      message = `الموقع ماشي — بس «${key.word_ar}» ${key.state}، مش ${first.got}.`;
      break;
    case "sign": {
      // «ب» + «الفتحة» → «بالفتحة»: the clitic fuses, it is not a prefix chip
      message = `الموقع صح ✓ — العلامة بس. «${key.word_ar}» ${key.state} ب${key.sign}، مش ب${first.got}.`;
      const owners = signOwners(first.got as IrabSign, key.state);
      if (owners.length > 0) {
        belongs = owners.join(" و");
        message += ` ${first.got} دي علامة ${belongs}.`;
      }
      break;
    }
    case "position":
      message = `«${key.word_ar}» مبني، فله محل — ${key.position}، مش ${first.got}.`;
      break;
    case "sign_kind":
      message = `العلامة صح — بس نوعها ${key.sign_kind}، مش ${first.got}.`;
      break;
    default:
      message = `الإجابة مش مظبوطة: ${first.expected} مش ${first.got}.`;
  }

  const table = checkRuleTable(key, opts.nounType);
  if (table?.why && first.slot === "sign") message += ` (${table.why}.)`;

  return {
    slot: first.slot,
    expected: first.expected,
    got: first.got,
    message_ar: message,
    rule_ref: key.rule_ref,
    ...(opts.rule?.quote_ar ? { rule_quote_ar: opts.rule.quote_ar } : {}),
    ...(opts.rule?.page ? { rule_page: opts.rule.page } : {}),
    ...(belongs ? { belongs_to_ar: belongs } : {}),
  };
}

/** English, for the AI stream — the tutor VERBALISES this, never re-derives it. */
function buildNote(
  verdict: IrabVerdict,
  score: number,
  slots: SlotOutcome[],
  key: IrabAnswer,
  sub: { role_ar?: string; state?: string; sign?: string }
): string {
  const pct = Math.round(score * 100);
  if (verdict === "AGREE")
    return `irab «${key.word_ar}»: AGREE — all slots match (${key.role_ar} · ${key.state} · ${key.sign ?? key.position ?? "—"})`;
  if (verdict === "VARIANT") {
    const varied = slots
      .filter((s) => s.status === "variant" && s.weight > 0)
      .map((s) => s.slot)
      .join(", ");
    return `irab «${key.word_ar}»: VARIANT — subset-compatible, counted CORRECT (differs only in fullness: ${varied || "phrasing"})`;
  }
  const diff = slots
    .filter((s) => s.status === "conflict")
    .map((s) => `${s.slot}: ${s.expected} → ${s.got}`)
    .join("; ");
  return `irab «${key.word_ar}»: ${verdict} ${pct}% — slot diff [${diff}] (student said ${sub.role_ar ?? "—"} / ${sub.state ?? "—"} / ${sub.sign ?? "—"})`;
}

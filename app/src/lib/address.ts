/**
 * How the tutor addresses the student — the one place the voice is decided
 * (FR-2602, FR-2605; plan A9 "the address seam").
 *
 * Until P6 the answer was hard-coded: 63 masculine pronouns in the lesson
 * prompt, 21 in the ask prompt, 11 in the check-in copy, and a masculine Arabic
 * vocative («يا بطل») handed to the model as the pattern to follow. None of it
 * was derived from anything — there was no gender signal to derive it from —
 * so every student was addressed as a boy. That is the defect this module
 * removes, and it removes it by making the forms a value the prompt templates
 * read rather than letters they contain.
 *
 * **Three registers, and the third is not the masculine.** `female` and `male`
 * each get their grammatical register. Everything else — `unspecified`, and
 * `null` for the picker-era students who were never asked — gets a register
 * correct for either: singular *they* in English, and in Arabic the student's
 * name with no gendered vocative and phrasings that need no agreement.
 * FR-2605 is explicit that the unknown case MUST NOT fall back to the
 * masculine, so `null` and `"unspecified"` are the same answer here and the
 * masculine is never a default anywhere in this file.
 *
 * **Scope, hard (FR-2603).** These forms decide the shape of a sentence and
 * nothing else. Nothing in this module is a difficulty, a topic, a selection or
 * a band, nothing downstream may branch teaching on it, and nothing here may
 * reach an event property, a log line or an error message (FR-2604). The only
 * consumers are prompt templates.
 *
 * **Pure, and deliberately import-free.** `lib/checkin.ts` renders its copy on
 * both the server and the "use client" lesson surface, so anything it depends
 * on has to run in a browser too.
 *
 * The Arabic register vocabulary («يا بطل/يا بطلة», «دوس/دوسي», «جاهز/جاهزة»,
 * «إنتَ/إنتِ») is Egyptian colloquial address, matching the register already in
 * the review-mode closing line rather than an MSA translation of the English.
 * It is address vocabulary, not mathematical terminology, so no ministry-term
 * question arises; the feminine forms are the ordinary agreement of the
 * masculine ones already shipped.
 */

/** As stored on `students.gender` — `null` for a row that was never asked. */
export type Gender = "female" | "male" | "unspecified" | null;

/** Which of the three registers a gender resolves to. */
export type Register = "feminine" | "masculine" | "either";

/**
 * Every form a prompt template needs, already agreed.
 *
 * The verb helpers exist because swapping a pronoun is not enough: "he is an
 * Egyptian student" becomes "they ARE", "he answers" becomes "they ANSWER",
 * "he's had a first go" becomes "they'VE had". A template that changed the
 * pronoun and left the verb would produce ungrammatical English for two of the
 * three registers, which is a worse tutor than the masculine one.
 */
export interface AddressForms {
  register: Register;
  /** one letter for cache keys — see `lib/session-cache.ts` */
  key: "f" | "m" | "n";

  /* English third person, for instructions written ABOUT the student */
  they: string;
  them: string;
  their: string;
  themself: string;
  /** sentence-initial forms, so templates never hand-capitalise */
  They: string;
  Their: string;

  /* present-tense agreement */
  /** the third-person "-s": `answer${s}` → "answers" / "answer" */
  s: string;
  /** the same suffix for templates that SHOUT: `SEE${S}` */
  S: string;
  is: string;
  has: string;
  does: string;
  /** contraction of *is*: "he's ready" → "they're ready" */
  isContr: string;
  /** contraction of *has*: "he's had a go" → "they've had a go" */
  hasContr: string;

  /* Arabic */
  /** names the register inline, e.g. "(بصيغة المخاطبة)" */
  arAddressee: string;
  /** the review-mode closing example, agreed end to end */
  arClosingEg: string;
}

const FEMININE = {
  register: "feminine",
  key: "f",
  they: "she",
  them: "her",
  their: "her",
  themself: "herself",
  They: "She",
  Their: "Her",
  s: "s",
  S: "S",
  is: "is",
  has: "has",
  does: "does",
  isContr: "'s",
  hasContr: "'s",
  arAddressee: "بصيغة المخاطبة",
  arClosingEg: "تمام يا بطلة — كده خلصنا، دوسي إنهاء لو جاهزة.",
} as const satisfies AddressForms;

const MASCULINE = {
  register: "masculine",
  key: "m",
  they: "he",
  them: "him",
  their: "his",
  themself: "himself",
  They: "He",
  Their: "His",
  s: "s",
  S: "S",
  is: "is",
  has: "has",
  does: "does",
  isContr: "'s",
  hasContr: "'s",
  arAddressee: "بصيغة المخاطب",
  arClosingEg: "تمام يا بطل — كده خلصنا، دوس إنهاء لو جاهز.",
} as const satisfies AddressForms;

/**
 * Correct for either. Singular *they* in English; in Arabic, address by name
 * with no gendered vocative and a phrasing that needs no agreement — research
 * R12's "what the neutral register actually is", specified here so it is not
 * left to whoever next edits a prompt.
 */
const EITHER = {
  register: "either",
  key: "n",
  they: "they",
  them: "them",
  their: "their",
  themself: "themselves",
  They: "They",
  Their: "Their",
  s: "",
  S: "",
  is: "are",
  has: "have",
  does: "do",
  isContr: "'re",
  hasContr: "'ve",
  arAddressee: "بصيغة الخطاب المباشر",
  arClosingEg: "تمام — كده خلصنا، وزرار الإنهاء متاح في أي وقت.",
} as const satisfies AddressForms;

/** The register a stored gender resolves to. `null` is `unspecified`. */
export function registerOf(gender: Gender): Register {
  return gender === "female"
    ? "feminine"
    : gender === "male"
      ? "masculine"
      : "either";
}

/**
 * The forms for this student.
 *
 * `firstName` personalises the Arabic either-correct vocative, which is the one
 * form that needs a name to be neutral rather than absent — «يا سلمى» instead
 * of picking between «يا بطل» and «يا بطلة». It is optional: with no name the
 * either-correct closing simply drops the vocative.
 */
export function addressForms(gender: Gender, firstName?: string): AddressForms {
  const r = registerOf(gender);
  if (r === "feminine") return FEMININE;
  if (r === "masculine") return MASCULINE;
  const name = firstOf(firstName);
  return name
    ? { ...EITHER, arClosingEg: `تمام يا ${name} — كده خلصنا، وزرار الإنهاء متاح في أي وقت.` }
    : EITHER;
}

/** The name a vocative uses — the first word, trimmed, or "". */
function firstOf(displayName?: string): string {
  return (displayName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * THE ADDRESS BLOCK — the instruction carried into every prompt that addresses
 * this student, rendered by `retrievalBlock()` (lib/retrieval.ts) so one
 * retrieval bundle decides the voice for every surface at once.
 *
 * It is stated as grammar, with the FR-2603 boundary spelled out in the block
 * itself: a model told a student's gender without being told what it is for is
 * a model that may decide the lesson should be about football.
 */
export function addressBlock(gender: Gender, displayName?: string): string {
  const a = addressForms(gender, displayName);
  const who = firstOf(displayName) || "the student";
  const english = `- English: address ${who} as "you". Referring to ${who} in the third person, use ${a.they}/${a.them}/${a.their}${a.register === "either" ? " (singular they)" : ""}.`;
  const arabic =
    a.register === "either"
      ? `- Arabic: ${who}'s grammatical gender is not recorded. Address ${who} by name with NO gendered vocative («يا ${firstOf(displayName) || "…"}» — never «يا بطل», never «يا بطلة»), and pick phrasings that need no gender agreement («وزرار الإنهاء متاح» rather than «دوس إنهاء» / «دوسي إنهاء»). Do not guess, and never fall back to the masculine.`
      : a.register === "feminine"
        ? `- Arabic: use the FEMININE second-person register throughout — «يا بطلة», «إنتِ», «دوسي», «جاهزة» — and agree every adjective and verb with it.`
        : `- Arabic: use the MASCULINE second-person register throughout — «يا بطل», «إنتَ», «دوس», «جاهز» — and agree every adjective and verb with it.`;
  return `HOW TO ADDRESS THIS STUDENT (grammatical forms only):
${english}
${arabic}
- This decides the FORM of your sentences and nothing else: never the topic, never which question you push, never how hard it is. Never mention it, never ask about it, never remark on it.`;
}

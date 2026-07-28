"""Arabic text normal forms, the seal checksum, and the sacred-content detector.

ADR-0006 (Arabic Language vertical). Frozen specification:
  docs/specs/arabic-verification.md      §1.3 (two normal forms), §1.4 (seal artifact)
  docs/specs/arabic-sensitive-content.md §1  (escalate-only detector), §4 (containment)

THREE NORMAL FORMS. They are never interchangeable and never combined:

    store_form()      STORE   — persisted, checksummed, approved, displayed.
                                Semantic-preserving: it NEVER drops a harakah.
    compare_verify()  VERIFY  — agreement checking between PUBLISHED editions of
                                the same text. Drops ONLY the tajweed/pause
                                annotation block, which legitimately differs
                                between publishers. Keeps every letter, every
                                harakah, the dagger alef and the hamza marks.
    compare_loose()   LOOSE   — routes transcription disagreements and grades a
                                student's typed answer. NEVER stored, NEVER
                                displayed, NEVER used to accept a passage.

Confusing them is the exact defect this module exists to prevent:

  * folding ى→ي in STORE is a fidelity defect (this book prints both spellings —
    verification T5), while NOT folding it when grading a student's typing is a
    false failure;
  * using LOOSE to compare two editions of a verse would fold أ/ا, ى/ي and every
    harakah — it would declare two genuinely different texts identical, which is
    the one thing an authority cross-check exists to catch;
  * comparing two editions byte-for-byte reports correct scripture as corrupt.
    Measured on سورة الفرقان ٦٣–٧٠: a raw compare flagged 6 of 8 verses, and
    every single difference was U+06ED (SMALL LOW MEEM, an iqlab aid) present in
    one edition and not the other. Under compare_verify(): 8/8 agreement.

Hence three functions, three names, three docstrings, one module.

NORMALIZER_VERSION is part of every seal. Bumping it changes every checksum and
therefore revokes every human approval (verification §5.4): sealed passages
carrying an older version are rejected until a human re-seals them.

Pure stdlib on purpose — the runtime containment check (§4) will import this
same module, and it must not drag Pydantic into the request path.
"""
from __future__ import annotations

import hashlib
import unicodedata

# Frozen. Changing this string invalidates every text_sha256 and every human
# approval bound to one. That is intended, not a bug (verification §5.4).
#
# v2 (2026-07-29) — TATWEEL IS NOT ALWAYS DECORATION. verification §1.3 rule 2
# said "strip U+0640, justification artifact, no phonetic value", written from
# the book's prose («باب اللــوق», T6). Measured against the cross-verified
# سورة الفرقان ٦٣–٧٠ reference (services/extraction/verify/), that rule silently
# modified scripture: the passage carries 11 tatweels and EVERY ONE of them is a
# diacritic carrier — in يُضَـٰعَفْ the tatweel exists to hold the dagger alef
# between ض and ع. Stripping them contradicts "store the text exactly as the
# authority publishes it, letters/diacritics unmodified".
#
# The two cases separate deterministically, and the real data confirms it:
#   tatweel FOLLOWED BY A COMBINING MARK -> a carrier. It is text. Preserved.
#   bare tatweel                         -> justification. Stripped (T6).
# On the verified passage: 11/11 carriers preserved. On «اللــوق»: 0 carriers,
# all stripped. Bumping to v2 is free right now because nothing has been sealed
# yet — which is exactly why this had to be caught in Wave 0.
NORMALIZER_VERSION = "ar-norm-v2"

# Versions the COMPARE-VERIFY rule set, which is recorded on every cross-check
# verdict: "these two editions agreed UNDER THIS DEFINITION of agreement".
# Widening it later without bumping this would silently re-interpret old verdicts.
COMPARE_VERIFY_VERSION = "ar-verify-v1"


class ArabicTextError(ValueError):
    """A stored-text rule was violated.

    Subclasses ValueError so Pydantic surfaces it as a normal validation error
    (loud, with the field path) instead of a crash.
    """


# --- codepoint policy (verification §1.3, rules 2-6) -------------------------

TATWEEL = 0x0640  # kashida: justification artefact, no phonetic value (T6)

# Stripped (value None) or replaced. Invisibles must go before the
# presentation-form check below: U+FEFF sits inside that range.
_INVISIBLE: dict[int, int | None] = {
    0x200B: None,    # ZERO WIDTH SPACE
    0xFEFF: None,    # ZWNBSP / BOM
    0x200E: None,    # LRM
    0x200F: None,    # RLM
    0x061C: None,    # ARABIC LETTER MARK
    0x00A0: 0x0020,  # NBSP -> plain space
}

# Rejected, not stripped: they never occur in ministry book text, and their
# presence means the source was mangled somewhere upstream.
_REJECT_JOINERS = {0x200C: "ZWNJ", 0x200D: "ZWJ"}

# Arabic Presentation Forms A/B are what a broken PDF text layer emits — but the
# block mixes two very different things, and verification §1.3 rule 4 only ever
# meant to catch one of them:
#
#   POSITIONAL VARIANTS (ﻲ ﻻ ﺽ …) — the same letter re-encoded by its shape in
#     the word. Meaningless outside typesetting, and they break search,
#     comparison and every normal form. REJECTED.
#   SEMANTIC LIGATURES (﴿ ﴾ ﷺ) — characters carrying their own meaning that the
#     book prints deliberately. They are content. ALLOWED.
#
# Decided 2026-07-29, recorded in verification §1.3 rule 4: ﷺ U+FDFA is stored
# exactly as the book prints it in قاسم أمين's prose (sensitive-content §0,
# printed p.25). Spelling it out as صلى الله عليه وسلم would silently change
# printed text, which the sacred lane forbids outright.
#
# Blanket NFKC is NOT used: it would expand all three into letter sequences.
#
# Same class by the same rationale, not yet encountered in this book — add on
# sight rather than pre-deciding: ﷻ U+FDFB, ﷽ U+FDFD, ﷲ U+FDF2.
_PRESENTATION_ALLOWED = {0xFD3E, 0xFD3F, 0xFDFA}  # ﴿ ﴾ ﷺ

# Models occasionally emit these instead of ك / ي / ٠-٩. Invisible at a glance,
# guaranteed defect (verification §1.3 rule 5).
_NON_EGYPTIAN: dict[int, str] = {
    0x06A9: "Farsi keheh — use ك U+0643",
    0x06CC: "Farsi yeh — use ي U+064A",
    0x06BE: "heh doachashmee — use ه U+0647",
    0x06C1: "heh goal — use ه U+0647",
}


def store_form(s: str) -> str:
    """STORE normal form: what we persist, checksum, approve and display.

    Order (verification §1.3, amended v2): NFC -> strip invisibles -> reject
    joiners -> strip BARE tatweel -> reject presentation forms (except ﴿﴾) ->
    reject non-Egyptian codepoints -> collapse whitespace runs -> trim.

    PRESERVED, no exceptions: every harakah (U+064B-U+0656), dagger alef
    (U+0670), ٱ (U+0671), the Quranic mark range (U+06D6-U+06ED), Arabic-Indic
    digits ٠-٩ as printed, every ء/أ/إ/آ/ا · ة/ه · ى/ي distinction, and any
    tatweel that carries a combining mark (see NORMALIZER_VERSION v2).

    Raises ArabicTextError on a rejected codepoint — a rejection is a finding,
    never something to silently repair.
    """
    out: list[str] = []
    text = unicodedata.normalize("NFC", s)
    for i, ch in enumerate(text):
        cp = ord(ch)
        if cp in _REJECT_JOINERS:
            raise ArabicTextError(
                f"{_REJECT_JOINERS[cp]} (U+{cp:04X}) at offset {i}: mangled source text")
        if cp in _INVISIBLE:
            repl = _INVISIBLE[cp]
            if repl is not None:
                out.append(chr(repl))
            continue
        if cp == TATWEEL:
            # A tatweel holding a diacritic is a carrier — text, not decoration.
            nxt = text[i + 1] if i + 1 < len(text) else ""
            if nxt and unicodedata.combining(nxt):
                out.append(ch)
            continue
        if (0xFB50 <= cp <= 0xFDFF or 0xFE70 <= cp <= 0xFEFF) and cp not in _PRESENTATION_ALLOWED:
            raise ArabicTextError(
                f"Arabic presentation form U+{cp:04X} "
                f"({unicodedata.name(ch, '?')}) at offset {i}: text was copied from a "
                "broken PDF layer; only ﴿ U+FD3E and ﴾ U+FD3F are allowed")
        if cp in _NON_EGYPTIAN:
            raise ArabicTextError(
                f"non-Egyptian codepoint U+{cp:04X} at offset {i}: {_NON_EGYPTIAN[cp]}")
        if 0x06F0 <= cp <= 0x06F9:
            raise ArabicTextError(
                f"extended Arabic-Indic digit U+{cp:04X} at offset {i}: "
                "use ٠-٩ U+0660-U+0669 as the book prints them")
        out.append(ch)
    return " ".join("".join(out).split())


# --- COMPARE-VERIFY (edition agreement — never stored, never displayed) ------
#
# The Quranic annotation block U+06D6-U+06ED is tajweed and pause apparatus
# (small high seen, pause marks ۖ ۗ ۚ, end-of-ayah ۝, sajdah ۩, small low meem
# ۭ). Publishers legitimately differ on it: it is a reading AID printed over the
# text, not the text. Everything else in that neighbourhood IS text and is kept:
#
#   U+0670 dagger alef        — a LETTER (the alef of هَٰذَا). Dropping it would
#                               make two different words compare equal.
#   U+0653-U+0655 maddah,     — hamza placement. Text, not annotation.
#     hamza above/below
#   U+0671 alef wasla ٱ       — text.
#   U+064B-U+0652 harakat     — text; the whole point of Uthmani orthography.
#
# Getting this boundary wrong in either direction is a real defect: too wide and
# a corrupted verse passes as agreeing; too narrow and correct scripture is
# reported as corrupt (which is what a byte-compare does).

QURANIC_ANNOTATION_RANGE = (0x06D6, 0x06ED)

_VERIFY_DROP = (
    {cp: None for cp in range(QURANIC_ANNOTATION_RANGE[0], QURANIC_ANNOTATION_RANGE[1] + 1)}
    | {TATWEEL: None}
)


def compare_verify(s: str) -> str:
    """COMPARE-VERIFY form: is this the same published text?

    The ONLY legitimate use is agreement checking between independent published
    editions of a fixed text (ADR-0006 sacred lane: the book transcript vs two
    online authorities). NEVER stored, NEVER displayed, NEVER checksummed —
    what we persist is the STORE form of what the authority publishes.

    Keeps every letter, every harakah, the dagger alef and the hamza marks.
    Drops the tajweed/pause annotation block and ALL tatweel — including the
    diacritic carriers that STORE preserves, because whether a publisher uses a
    carrier is typography, not text. That divergence from STORE is deliberate:
    this form answers "same text?", not "same bytes?".
    """
    t = unicodedata.normalize("NFC", s).translate(_VERIFY_DROP)
    return " ".join(t.split())


def editions_agree(a: str, b: str) -> bool:
    """True when two published editions carry the same text (VERIFY form)."""
    return compare_verify(a) == compare_verify(b)


# --- COMPARE-LOOSE (a router and a comparator — never an acceptance test) ----

_LOOSE_DROP = (
    {cp: None for cp in range(0x064B, 0x0657)}          # harakat, shadda, sukun, hamza marks
    | {0x0670: None}                                     # dagger alef
    | {cp: None for cp in range(0x06D6, 0x06EE)}         # Quranic marks, ۝, sajdah
    | {TATWEEL: None}
    | {0xFD3E: None, 0xFD3F: None}                       # ornate brackets
    | {ord(c): None for c in "،؛؟.,!:\"'()[]«»—-…"}      # punctuation: token hygiene only
)
_LOOSE_FOLD = (
    {ord(c): "ا" for c in "أإآٱ"}
    | {ord("ى"): "ي", ord("ة"): "ه", ord("ؤ"): "و", ord("ئ"): "ي"}
)


def compare_loose(s: str) -> str:
    """COMPARE-LOOSE form. Two — and only two — legitimate uses:

    1. routing a transcription disagreement (identical LOOSE + different STORE
       = a DIACRITIC DISPUTE, the dangerous class -> human queue);
    2. grading a student's typed answer, where «هونا» for «هَوْنًا» and «فى» for
       «في» must both be accepted.

    NEVER stored, NEVER displayed, NEVER used to accept a passage. Tolerant by
    design: it does not raise, because student input is not book text.
    """
    t = unicodedata.normalize("NFC", s)
    t = t.translate(_LOOSE_DROP).translate(_LOOSE_FOLD)
    return " ".join(t.split())


# --- the seal ---------------------------------------------------------------

def sha256_text(s: str) -> str:
    """sha256 of the UTF-8 bytes. The seal identity (verification §1.4)."""
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def seal_text(unit_texts: list[str]) -> str:
    """The exact string a passage checksum is taken over.

    Each unit is STORE-normalised individually, then joined with '\\n'. The join
    is structural and is NOT re-normalised (store_form collapses newlines), so
    this function — not store_form — is the single definition of passage
    identity. Changing it changes every checksum; treat it as frozen with
    NORMALIZER_VERSION.
    """
    return "\n".join(store_form(t) for t in unit_texts)


# --- the escalate-only sacred detector (sensitive-content §1) ----------------
#
# It can move a passage or a stem UP to quran/hadith for human confirmation.
# It can NEVER clear one down. A hit that no human has confirmed blocks the
# load; it does not silently classify.

_SACRED_CODEPOINTS: dict[int, str] = {
    0xFD3E: "﴿ ornate left parenthesis",
    0xFD3F: "﴾ ornate right parenthesis",
    0xFDFA: "ﷺ sallallahou alayhe wasallam",
    0xFDFB: "ﷻ jalla jalaluhu",
}
_SACRED_RANGES = (
    (0x0610, 0x0614, "Arabic honorific sign"),
    (0x06D6, 0x06ED, "Quranic annotation mark"),
)
_SACRED_PHRASES = (
    "قال تعالى", "قال الله تعالى", "بسم الله الرحمن الرحيم", "سورة", "الآية",
    "صلى الله عليه وسلم", "قال رسول الله", "رواه البخاري", "رواه مسلم",
    "حديث شريف", "عليه الصلاة والسلام",
)
_SACRED_PHRASES_LOOSE = tuple((p, compare_loose(p)) for p in _SACRED_PHRASES)


def scan_sacred_markers(text: str) -> list[str]:
    """Return human-readable markers suggesting Quranic/Hadith content.

    Escalation only (sensitive-content §1). A hit means 'a human must classify
    this', never 'this is safe'. Deliberately tolerant of un-normalised input:
    it runs on raw model output, including output that store_form would reject.
    """
    hits: list[str] = []
    for ch in text:
        cp = ord(ch)
        if cp in _SACRED_CODEPOINTS and _SACRED_CODEPOINTS[cp] not in hits:
            hits.append(_SACRED_CODEPOINTS[cp])
        for lo, hi, name in _SACRED_RANGES:
            if lo <= cp <= hi and name not in hits:
                hits.append(name)
    loose = compare_loose(text)
    for printed, needle in _SACRED_PHRASES_LOOSE:
        if needle and needle in loose:
            hits.append(f"phrase «{printed}»")
    return hits


# --- the no-retyping lint primitive (verification §1.6) ----------------------

def longest_shared_word_run(a: str, b: str) -> tuple[int, str]:
    """Longest run of consecutive words shared by `a` and `b`, in LOOSE form.

    Returns (word count, the matched run as LOOSE tokens). The comparison is
    LOOSE on purpose: we want to catch a quote whose diacritics were changed —
    that is precisely the defect. Callers decide the threshold (§1.6 uses 4).
    """
    aw, bw = compare_loose(a).split(), compare_loose(b).split()
    if not aw or not bw:
        return 0, ""
    best = end_i = 0
    prev = [0] * (len(bw) + 1)
    for i in range(1, len(aw) + 1):
        cur = [0] * (len(bw) + 1)
        for j in range(1, len(bw) + 1):
            if aw[i - 1] == bw[j - 1]:
                cur[j] = prev[j - 1] + 1
                if cur[j] > best:
                    best, end_i = cur[j], i
        prev = cur
    return best, " ".join(aw[end_i - best:end_i])


# Content classes that may never be bulk-approved, never varied, never voiced.
# Kept here (not in schemas) so the loader, the variant engine and the runtime
# all key off one definition.
SEALED_SENSITIVITY_CLASSES = frozenset({"quran", "hadith"})

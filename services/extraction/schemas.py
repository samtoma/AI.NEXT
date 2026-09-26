"""Typed extraction schemas (thesis Pillar I: schema-first, not text-first).

Every fact carries provenance back to a content-addressed source document.
Validation happens here, before anything touches the database.
"""
from __future__ import annotations

import re
from typing import Literal, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator, model_serializer

from arabic_text import (
    COMPARE_VERIFY_VERSION,
    SEALED_SENSITIVITY_CLASSES,
    NORMALIZER_VERSION,
    scan_sacred_markers,
    seal_text,
    sha256_text,
    store_form,
)

NodeKind = Literal["program", "course", "module", "learning_objective", "topic"]
EdgeType = Literal["part_of", "teaches", "prerequisite_of", "about", "relates_to"]
Tier = Literal["basic", "standard", "advanced"]
# Arabic types (ADR-0006) are additive. Only the MVP-IN set is listed: a type
# with no typed answer record is a hole through which a free-text answer walks.
# `shakl` and `explain` land WITH their answer models (contract §6 DEFER); `why`
# ships as `mcq` in the MVP.
QuestionType = Literal["mcq", "numeric", "short",
                       "irab", "extract", "lexical", "rhetoric", "spelling_fix"]


class SourceDocument(BaseModel):
    title: str
    publisher: str
    edition: Optional[str] = None
    language: Literal["en", "ar"]
    grade: str
    subject: str
    file_path: Optional[str] = None


class ExtractionRun(BaseModel):
    extractor: str
    extractor_version: str
    schema_version: str


class Node(BaseModel):
    id: str
    kind: NodeKind
    label: str
    description: Optional[str] = None
    syllabus_ref: Optional[str] = None
    source_page: Optional[int] = None
    order_in_parent: Optional[int] = None


class Edge(BaseModel):
    src: str
    dst: str
    type: EdgeType


class Choice(BaseModel):
    key: str
    text: str


class ClaimFact(BaseModel):
    """One checkable atom inside a claim (date, area, name, cause, result...).

    Raw material for the scripted cross-consistency check (contract §4.2).
    """
    kind: str
    entity: str
    value: str


# Where a claim's evidence sits. The first four are the social-studies contract's
# (§3) and are unchanged. The rest are the v2 line's (extraction-pipeline.md §3.4
# evidence kinds and §3.5 claim anchors), added for the English maths books.
EvidenceKind = Literal[
    "text", "map", "concept_box", "enrichment_box",
    "heading", "intro", "summary", "definition", "box", "worked_example", "exercise",
    "figure",
]
# What a maths claim states (extraction-pipeline.md §3.5).
ClaimType = Literal["definition", "rule", "method", "convention", "caution"]
Lang = Literal["ar", "en"]


class ClaimStep(BaseModel):
    """One atomic claim with page evidence.

    Social studies (docs/specs/social-extraction-contract.md §3): an Arabic
    claim-step, `claim_ar`, exactly as before. The v2 line (extraction-pipeline.md
    §3.5, specs/003 T336) generalises it: `claim` + `lang` carry a claim in any
    language, with the book anchor it came from and what kind of statement it is.

    `claim_ar` is kept as the Arabic spelling of the same field, so every shipped
    bundle validates and dumps byte-identically (selfcheck_arabic.py) and the
    loader's `s.claim_ar` keeps working for them. Exactly one of the two is set.
    Read `text` and `language` rather than either field when the language is not
    known in advance. `step` is assigned by the loader from list order,
    mirroring math strings.
    """
    claim_ar: Optional[str] = Field(default=None, min_length=1)
    evidence_page: int
    evidence_kind: EvidenceKind
    facts: Optional[list[ClaimFact]] = None
    # --- v2 line (T336). All defaulted: the Arabic and social bundles are
    #     unchanged under model_dump(exclude_defaults=True).
    claim: Optional[str] = None
    lang: Optional[Lang] = None
    claim_type: Optional[ClaimType] = None
    anchor: Optional[str] = None           # the book anchor: a section code, WE8.3, Ex8-2:5b …

    @model_validator(mode="after")
    def claim_not_blank(self) -> "ClaimStep":
        if self.claim_ar is not None and self.claim is not None:
            raise ValueError("set claim or claim_ar, not both (claim_ar is the Arabic spelling "
                             "of the same field)")
        if self.claim_ar is None and self.claim is None:
            raise ValueError("claim_ar must be non-empty (or set claim + lang)")
        if not self.text.strip():
            raise ValueError("claim_ar must be non-empty" if self.claim is None
                             else "claim must be non-empty")
        if self.claim is not None and self.lang is None:
            raise ValueError("a `claim` names its language: set lang ('en' or 'ar')")
        if self.claim_ar is not None and self.lang not in (None, "ar"):
            raise ValueError(f"claim_ar is Arabic by definition; lang '{self.lang}' contradicts it")
        return self

    @property
    def text(self) -> str:
        """The claim, whichever field carries it."""
        return self.claim if self.claim is not None else (self.claim_ar or "")

    @property
    def language(self) -> str:
        return self.lang or "ar"


# =============================================================================
# Arabic Language vertical — ADR-0006
#   contract      docs/specs/arabic-extraction-contract.md
#   fidelity      docs/specs/arabic-verification.md
#   sensitivity   docs/specs/arabic-sensitive-content.md
#
# The governing asymmetry: a paraphrase of a fact is a weaker fact; a paraphrase
# of an آية is a defect. So the primary atom is a VERBATIM TEXT — sealed,
# checksummed, never regenerated — and the secondary atom is a RULE THAT IS
# APPLIED (إعراب is derived per word, so its answer is a slot record, never a
# string). Everything below is additive and defaulted: math and social bundles
# validate and dump byte-identically (proved by selfcheck_arabic.py).
# =============================================================================

# Assigned by a human and stored as data — never inferred at runtime, never
# inferred from a title (sensitive-content §1, S7: «آيات العلم» is a poem; a
# حديث hides inside قاسم أمين's prose; a Quranic شاهد hides inside a grammar
# rule). SEALED_SENSITIVITY_CLASSES = {quran, hadith} is defined in arabic_text
# so the loader, the variant engine and the runtime key off ONE definition.
SensitivityClass = Literal["quran", "hadith", "religious_reference",
                           "political", "opinion_invited", "secular"]

# The fidelity tier is a discriminator, not a label: it selects the capture lane
# and the runtime policy (contract §2.1).
#   sacred   قرآن/حديث   authority cross-check   model may NEVER emit the text
#   literary شعر          K-way consensus         may quote, character-exact
#   prose    نثر/إملاء     K-way consensus         may quote or paraphrase in شرح
Fidelity = Literal["sacred", "literary", "prose"]
PassageKind = Literal["quran", "hadith", "poetry", "prose", "dictation"]

# `authority_verified` (sacred): the passage is transcribed from the book page
# as TEXT, and the citation it reports is then fetched RAW — curl, no model in
# the loop — from two or more independent published authorities. The three
# strings are diffed under COMPARE-VERIFY. All agree -> seal. Any disagreement
# -> FLAG for a human; never silently pick a source, never hard-block the run.
# (Samuel, 2026-07-29, superseding ADR-0006 decision #2: the Quran is immutable
# and widely published, so verification is cheap and reliable, and it avoids the
# corpus-licensing question entirely.)
#
# `double_blind` (everything else): K=3 decorrelated transcriptions, because no
# authority exists for "what THIS ministry book printed".
CaptureLane = Literal["authority_verified", "double_blind"]

_AR_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def require_store_form(value: str, where: str) -> str:
    """Every stored Arabic string must ALREADY be in STORE normal form.

    Not 'normalise it for them' — reject it. If the pipeline stores a string
    that differs from its own normal form, some later stage will re-normalise
    it, the checksum will move, and a human approval will silently evaporate
    (verification §1.7). Tatweel, presentation forms, Farsi codepoints and
    stray whitespace all fail here, at the model boundary.
    """
    normalised = store_form(value)  # raises ArabicTextError on a rejected codepoint
    if normalised != value:
        raise ValueError(
            f"{where}: not in STORE normal form (ar-norm {NORMALIZER_VERSION}). "
            f"Stored {value!r}, normal form is {normalised!r} — the difference is "
            "tatweel, an invisible, or whitespace. Store the normal form.")
    return value


class QuranRef(BaseModel):
    """The citation the vision model reports ALONGSIDE its transcript.

    It is reported independently of the text, and it is what the cross-check
    fetches: `?chapter_number=<surah>` then slice `ayah_from..ayah_to`. Getting
    the citation wrong and the characters right still produces the wrong
    passage, so the integers are verified in their own right.
    """
    surah: int = Field(ge=1, le=114)
    ayah_from: int = Field(ge=1)
    ayah_to: int = Field(ge=1)
    script: Literal["uthmani"] = "uthmani"
    riwaya: Literal["hafs"] = "hafs"

    @model_validator(mode="after")
    def range_is_sane(self) -> "QuranRef":
        if self.ayah_to < self.ayah_from:
            raise ValueError(f"quran {self.surah}: ayah_to < ayah_from")
        return self

    @property
    def citation_ref(self) -> str:
        return f"quran:{self.surah}:{self.ayah_from}-{self.ayah_to}"

    @property
    def ayah_count(self) -> int:
        return self.ayah_to - self.ayah_from + 1


class AuthoritySource(BaseModel):
    """One independent published edition consulted for the cross-check.

    `endpoint` is fetched RAW — no model in the loop — so a hallucinated verse
    cannot enter through the verifier. Recorded per passage because "which
    editions agreed" is the provenance that makes the seal auditable later.
    """
    name: str                            # "api.quran.com/v4 · quran/verses/uthmani"
    endpoint: str
    fetched_at: Optional[str] = None
    agrees: bool
    # Populated only when agrees is False: unit index -> what differed. Free
    # text, for a human reading the flag — never parsed.
    differences: list[str] = []

    @model_validator(mode="after")
    def disagreement_is_explained(self) -> "AuthoritySource":
        if not self.agrees and not self.differences:
            raise ValueError(
                f"{self.name}: disagreement recorded with no differences listed — a human "
                "resolving this flag needs to see WHAT differed")
        return self


class TextVerification(BaseModel):
    """How this passage's characters were established, and by whom.

    Sacred lane (`authority_crosscheck`): the book transcript is diffed against
    two or more independent authorities under COMPARE-VERIFY, which drops the
    tajweed/pause annotation block (publishers legitimately differ there) and
    keeps every letter, harakah, dagger alef and hamza mark.

    A `flagged` verdict is NOT an error and never blocks the run — it is the
    correct outcome of a real disagreement. It keeps the passage out of `live`
    until a human decides.
    """
    method: Literal["authority_crosscheck", "k_way_transcription"]
    compare_form: str = COMPARE_VERIFY_VERSION
    verdict: Literal["agree", "flagged"]
    sources: list[AuthoritySource] = []
    transcript_agrees: Optional[bool] = None   # book page vs the authorities
    flag_reason: Optional[str] = None

    @model_validator(mode="after")
    def verdict_matches_the_evidence(self) -> "TextVerification":
        if self.method == "authority_crosscheck":
            if len(self.sources) < 2:
                raise ValueError(
                    "authority_crosscheck needs >= 2 INDEPENDENT authorities: one source "
                    "agreeing with itself is not a cross-check")
            if len({s.name for s in self.sources}) != len(self.sources):
                raise ValueError("the same authority listed twice is not two authorities")
        all_agree = all(s.agrees for s in self.sources) and self.transcript_agrees is not False
        if self.verdict == "agree" and not all_agree:
            raise ValueError(
                "verdict 'agree' with a disagreeing source or transcript — on any verification "
                "failure the passage is FLAGGED for a human, never silently accepted")
        if self.verdict == "flagged" and not self.flag_reason:
            raise ValueError("a flagged verdict must say what a human is being asked to look at")
        return self


class TextUnit(BaseModel):
    """One آية / بيت / فقرة. Structure, not a blob, so a diff localises and a
    defect stays small (verification §1.4)."""
    n: int = Field(ge=1)                  # 1-based index within the passage
    printed_n: Optional[str] = None       # as printed, Arabic-Indic: "٦٣"
    text_ar: str = Field(min_length=1)    # full string incl. تشكيل, as captured
    sadr_ar: Optional[str] = None         # poetry only
    ajuz_ar: Optional[str] = None         # poetry only

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "TextUnit":
        require_store_form(self.text_ar, f"unit {self.n} text_ar")
        for name in ("sadr_ar", "ajuz_ar"):
            if (v := getattr(self, name)) is not None:
                require_store_form(v, f"unit {self.n} {name}")
        if (self.sadr_ar is None) != (self.ajuz_ar is None):
            raise ValueError(f"unit {self.n}: a بيت needs BOTH صدر and عجز")
        if self.sadr_ar and self.text_ar != f"{self.sadr_ar} {self.ajuz_ar}":
            raise ValueError(
                f"unit {self.n}: text_ar must be exactly 'صدر عجز' joined by one space — "
                "otherwise the hemistichs and the hashed text can drift apart")
        return self


class TextPassage(BaseModel):
    """A SEALED passage: produced once, reviewed once, thereafter only ever
    referenced — never regenerated, never paraphrased, never re-typed by any
    pipeline stage or by the runtime tutor (verification §1.1).

    `text_sha256` is its identity. Approval binds to that identity
    (`approved_sha256`), so one changed harakah auto-demotes a live passage.
    """
    id: str
    lesson: str
    kind: PassageKind
    fidelity: Fidelity
    sensitivity_class: SensitivityClass
    title_ar: str
    attribution_ar: str                          # "سورة الفرقان (٦٣ – ٧٠)"
    quran_ref: Optional[QuranRef] = None
    citation_ref: Optional[str] = None           # "quran:25:63-70"
    units: list[TextUnit] = Field(min_length=1)
    text_sha256: str
    normalizer_version: str = NORMALIZER_VERSION
    capture_lane: CaptureLane
    transcribers: list[str] = []                 # model ids that produced the text
    verification: Optional[TextVerification] = None   # how the characters were established
    approved_by: Optional[str] = None            # human sign-off on the hash
    approved_at: Optional[str] = None
    approved_sha256: Optional[str] = None        # the bytes that were approved
    source_page: int

    @property
    def store_text(self) -> str:
        """The exact string the checksum is taken over (verification §1.4)."""
        return seal_text([u.text_ar for u in self.units])

    @property
    def is_sacred(self) -> bool:
        """Quran/Hadith. Never bulk-approved, never varied, never voiced."""
        return self.fidelity == "sacred" or self.sensitivity_class in SEALED_SENSITIVITY_CLASSES

    @property
    def approval_valid(self) -> bool:
        return bool(self.approved_by) and self.approved_sha256 == self.text_sha256

    @property
    def verification_flagged(self) -> bool:
        """A real disagreement is waiting for a human. Not an error, not a block."""
        return self.verification is not None and self.verification.verdict == "flagged"

    @property
    def approval_stale(self) -> bool:
        """Approved bytes exist and no longer match the text: AUTO-DEMOTE.

        This is the invariant the whole seal exists for — change one harakah in
        a live passage and it stops being servable, with no override flag.
        """
        return bool(self.approved_sha256) and self.approved_sha256 != self.text_sha256

    @model_validator(mode="after")
    def checksum_recomputes(self) -> "TextPassage":
        # Bumping the normalizer changes every checksum and therefore revokes
        # every approval (verification §5.4). Old seals must be redone by a
        # human, so they are rejected rather than silently re-hashed.
        if self.normalizer_version != NORMALIZER_VERSION:
            raise ValueError(
                f"{self.id}: sealed under normalizer '{self.normalizer_version}' but this "
                f"pipeline is '{NORMALIZER_VERSION}' — re-seal required; all approvals "
                "bound to the old normalizer are revoked")
        actual = sha256_text(self.store_text)
        if actual != self.text_sha256:
            raise ValueError(
                f"{self.id}: text_sha256 does not recompute (declared {self.text_sha256[:12]}…, "
                f"actual {actual[:12]}…). A checksum that moves means a stage mutated sealed "
                "text; the blast radius is unknown — quarantine the bundle (verification §1.7)")
        if self.approved_by and not self.approved_sha256:
            raise ValueError(
                f"{self.id}: approved_by without approved_sha256 — a human approves an exact "
                "byte sequence, not 'this passage' (verification §5.1)")
        return self

    @model_validator(mode="after")
    def fidelity_selects_the_lane(self) -> "TextPassage":
        sacred_kind = self.kind in ("quran", "hadith")
        if sacred_kind != (self.fidelity == "sacred"):
            raise ValueError(
                f"{self.id}: kind '{self.kind}' and fidelity '{self.fidelity}' disagree — "
                "قرآن/حديث are always sacred, and nothing else is")
        if sacred_kind and self.sensitivity_class != self.kind:
            raise ValueError(
                f"{self.id}: kind '{self.kind}' must carry sensitivity_class '{self.kind}', "
                f"not '{self.sensitivity_class}'")
        if self.fidelity == "sacred":
            if self.capture_lane != "authority_verified":
                raise ValueError(
                    f"{self.id}: sacred text is sealed by cross-check against independent "
                    "published authorities — capture_lane must be 'authority_verified'")
            if not self.citation_ref:
                raise ValueError(
                    f"{self.id}: sacred passage without a citation. The citation is what the "
                    "cross-check fetches; without it the characters cannot be verified at all")
            if self.verification is None:
                raise ValueError(
                    f"{self.id}: sacred passage with no verification record. A transcript that "
                    "was never diffed against an authority is exactly the defect this lane "
                    "exists to prevent")
            if self.verification.method != "authority_crosscheck":
                raise ValueError(
                    f"{self.id}: sacred text is verified by authority_crosscheck, not "
                    f"'{self.verification.method}'")
        elif self.capture_lane != "double_blind":
            raise ValueError(
                f"{self.id}: non-sacred text is sealed by K-way decorrelated transcription — "
                "capture_lane must be 'double_blind'")
        return self

    @model_validator(mode="after")
    def structure_matches_the_citation(self) -> "TextPassage":
        if [u.n for u in self.units] != list(range(1, len(self.units) + 1)):
            raise ValueError(f"{self.id}: unit.n must run 1..{len(self.units)} with no gaps")
        if self.kind == "quran":
            if self.quran_ref is None:
                raise ValueError(
                    f"{self.id}: a Quran passage must carry quran_ref "
                    "(surah, ayah_from, ayah_to) — the citation the cross-check fetches")
            if self.citation_ref != self.quran_ref.citation_ref:
                raise ValueError(
                    f"{self.id}: citation_ref '{self.citation_ref}' != citation "
                    f"'{self.quran_ref.citation_ref}'")
            if len(self.units) != self.quran_ref.ayah_count:
                raise ValueError(
                    f"{self.id}: {len(self.units)} units for {self.quran_ref.ayah_count} آيات "
                    f"({self.quran_ref.ayah_from}–{self.quran_ref.ayah_to}) — a verse is "
                    "missing or duplicated")
            printed = [u.printed_n for u in self.units]
            if all(printed):
                want = list(range(self.quran_ref.ayah_from, self.quran_ref.ayah_to + 1))
                try:
                    got = [int(p.translate(_AR_DIGITS)) for p in printed]
                except ValueError:
                    raise ValueError(f"{self.id}: printed_n must be Arabic-Indic digits as printed")
                if got != want:
                    raise ValueError(
                        f"{self.id}: printed آية numbers {got} are not contiguous {want}")
        if self.kind == "poetry" and not all(u.sadr_ar for u in self.units):
            raise ValueError(
                f"{self.id}: every بيت needs صدر and عجز — a linear read scrambles the "
                "hemistich pairing (verification T3)")
        return self


class VocabItem(BaseModel):
    """معاني المفردات — the answer key for `lexical`, graded by set membership.

    The book prints معنى and sometimes جمع/مفرد. It NEVER prints مضاد, yet its own
    drills demand one (contract §2.2). Anything we supply that the book did not
    print is `authored: true` and goes to the human gate as a first-class review
    item instead of being laundered as extracted fact.
    """
    lesson: str
    word_ar: str
    gloss_ar: str
    plural_ar: Optional[str] = None
    singular_ar: Optional[str] = None
    antonym_ar: Optional[str] = None
    authored: bool = False
    passage_ref: Optional[str] = None
    unit_n: Optional[int] = None
    source_page: int

    @model_validator(mode="after")
    def authored_fields_are_declared(self) -> "VocabItem":
        for name in ("word_ar", "gloss_ar", "plural_ar", "singular_ar", "antonym_ar"):
            if (v := getattr(self, name)) is not None:
                require_store_form(v, f"vocab «{self.word_ar}» {name}")
        if self.antonym_ar and not self.authored:
            raise ValueError(
                f"vocab «{self.word_ar}»: this book never prints مضاد, so an antonym is "
                "authored content — set authored=true so the human gate sees it")
        return self


# Drawn from the book's own printed مواطن الجمال wording. A note that needs a new
# label is a HUMAN decision to extend this enum, never a generation decision —
# this is the guardrail against MSA renderings of English rhetoric terms
# reaching a student (contract §4.6).
RhetoricType = Literal[
    "تشبيه", "استعارة", "كناية", "تضاد", "أسلوب مؤكد", "نداء", "استفهام",
    "أمر", "نهي", "تعبير يوحي", "أفعال مضارعة", "إطناب", "إيجاز", "حسن تعليل",
    # Full-book extension (2026-07-30): labels the book itself prints in
    # مواطن الجمال across T1U2–T2U3 — surfaced by the assembler's drop report
    # (~20 printed notes had no admissible label). Same guardrail as before:
    # these are the book's own wording, not invented terminology. Pending
    # Samuel's confirmation as the enum's human owner.
    "طباق", "جناس", "تصوير", "أسلوب مدح", "أسلوب ذم", "أسلوب شرط",
    "أسلوب استثناء", "تنكير", "أسلوب تفضيل",
]
RhetoricPurpose = Literal[
    "التنبيه", "الاستنكار", "النصح والإرشاد", "الدعاء", "التعجب", "التقرير",
    "التمني", "التحذير", "الاستمرار والتجدد", "التوكيد", "التعليل",
]


class SpanRef(BaseModel):
    """A half-open character span into one unit of a sealed passage.

    Downstream stages address passage content by span — they may not copy the
    text into their own fields (verification §1.1). This is also what lets the
    student surface highlight the answer inside the passage: the Arabic
    analogue of the maths Evidence Walk.
    """
    passage_ref: str
    unit_n: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=1)
    expected_ar: Optional[str] = None   # the exact slice; checked at bundle level

    @model_validator(mode="after")
    def span_is_sane(self) -> "SpanRef":
        if self.end <= self.start:
            raise ValueError(f"{self.passage_ref}#{self.unit_n}: empty span [{self.start},"
                             f"{self.end})")
        if self.expected_ar is not None:
            require_store_form(self.expected_ar, f"span {self.passage_ref}#{self.unit_n}")
        return self


class RhetoricNote(BaseModel):
    """مواطن الجمال — a table (شاهد → نوع → غرض) over a closed vocabulary, which
    is why the richest interaction in this vertical grades with zero AI."""
    id: str
    lesson: str
    passage_ref: str
    unit_n: Optional[int] = None
    expression_ar: str                   # MUST be character-exact in the passage
    span: Optional[SpanRef] = None       # computed by the pipeline, never authored
    type: RhetoricType
    purpose: Optional[RhetoricPurpose] = None
    effect_ar: str                       # الأثر, the book's own wording
    verbatim_from_book: bool
    source_page: int

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "RhetoricNote":
        require_store_form(self.expression_ar, f"{self.id} expression_ar")
        require_store_form(self.effect_ar, f"{self.id} effect_ar")
        return self


class RuleClause(BaseModel):
    """One printed rule sentence. `RuleClause.id` is the citation target that
    makes an إعراب answer auditable; `first_taught_lesson` is what turns the
    cumulative-scope oracle into a script (contract §4.5)."""
    id: str                              # "gc:munada:mudaf-sign-ya-jam-mudhakkar"
    text_ar: str
    kind: Literal["definition", "tool", "type", "condition", "sign", "exception", "note"]
    examples_ar: list[str] = []
    first_taught_lesson: str             # "ara1-1"
    source_page: int

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "RuleClause":
        require_store_form(self.text_ar, f"{self.id} text_ar")
        for i, ex in enumerate(self.examples_ar):
            require_store_form(ex, f"{self.id} examples_ar[{i}]")
        if not self.id.startswith("gc:"):
            raise ValueError(f"{self.id}: rule clause ids are 'gc:<rule>:<slug>' (contract §1)")
        return self


class GrammarRule(BaseModel):
    """A grammar rule is a UNIT-SPANNING object taught in installments — المنادى
    runs ara1-1 → ara1-3 — so scope is cumulative, never lesson-local."""
    id: str                              # "gr:munada"
    label_ar: str
    unit: str                            # "module:ara-u1"
    taught_in: list[str] = Field(min_length=1)
    clauses: list[RuleClause] = Field(min_length=1)
    types_tree: Optional[dict] = None

    @model_validator(mode="after")
    def clauses_belong_to_the_installments(self) -> "GrammarRule":
        if not self.id.startswith("gr:"):
            raise ValueError(f"{self.id}: grammar rule ids are 'gr:<latin-slug>' (contract §1)")
        for c in self.clauses:
            if c.first_taught_lesson not in self.taught_in:
                raise ValueError(
                    f"{c.id}: first taught in '{c.first_taught_lesson}', which is not among "
                    f"{self.id}'s installments {self.taught_in}")
        return self


class SpellingCase(BaseModel):
    """One row of a printed إملاء case table."""
    id: str
    condition_ar: str                    # "مضمومة وما قبلها مفتوح"
    written_as_ar: str                   # "على واو"
    examples_ar: list[str] = []
    source_page: int

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "SpellingCase":
        require_store_form(self.condition_ar, f"{self.id} condition_ar")
        require_store_form(self.written_as_ar, f"{self.id} written_as_ar")
        for i, ex in enumerate(self.examples_ar):
            require_store_form(ex, f"{self.id} examples_ar[{i}]")
        return self


class SpellingRule(BaseModel):
    """الإملاء — the book's most-drilled skill, printed as literal case tables.

    `printed_case_count` is read off the page and asserted here: the coverage
    oracle's integer equality, moved into the type itself (contract §5.2b).
    """
    id: str                              # "sp:hamza-mid-waw"
    label_ar: str
    lesson: str
    cases: list[SpellingCase] = Field(min_length=1)
    printed_case_count: int = Field(ge=1)
    note_ar: Optional[str] = None

    @model_validator(mode="after")
    def cardinality_matches_the_page(self) -> "SpellingRule":
        if not self.id.startswith("sp:"):
            raise ValueError(f"{self.id}: spelling rule ids are 'sp:<latin-slug>' (contract §1)")
        if len(self.cases) != self.printed_case_count:
            raise ValueError(
                f"{self.id}: {len(self.cases)} cases extracted but the page prints "
                f"{self.printed_case_count} — a row was dropped or invented")
        return self


# --- إعراب: a slot record, never a string ------------------------------------
# Storing the formula as a string loses the derivation, loses the ability to say
# WHICH part the student got wrong, and loses independent verification. As slots
# it buys three things at once: grading with no LLM, a COMPUTED diagnosis (the
# tutor verbalises a slot diff, it never re-derives), and a cache key that is a
# small finite set per question (contract §2.5).

IrabState = Literal["مرفوع", "منصوب", "مجرور", "مجزوم", "مبني"]
IrabPosition = Literal["في محل رفع", "في محل نصب", "في محل جر", "في محل جزم"]
IrabSign = Literal["الضمة", "الفتحة", "الكسرة", "الألف", "الواو", "الياء",
                   "السكون", "حذف النون", "حذف حرف العلة",
                   "تنوين الفتح", "تنوين الضم", "تنوين الكسر",
                   "الضم"]  # الضم: the built-on marker for مبني (مبني على الضم)
SignKind = Literal["ظاهرة", "مقدرة", "نائبة عن الفتحة",
                   "نائبة عن الضمة", "نائبة عن الكسرة", "—"]


class IrabAnswer(BaseModel):
    """«يا طالبَ العلمِ» → منادى مضاف منصوب وعلامة نصبه الفتحة الظاهرة.

    A wrong answer produces a SLOT DIFF (e.g. `sign: الفتحة → الياء`), and the
    tutor verbalises that diff grounded in the cited clause. That is the
    runtime-explanation discipline — never solve from scratch — applied to a
    subject whose canonical solution is a derivation.
    """
    word_ar: str
    role_ar: str                         # "منادى مضاف" / "مضاف إليه" / "نعت" / "بدل"
    state: IrabState
    position: Optional[IrabPosition] = None   # مبني only: «في محل نصب»
    sign: Optional[IrabSign] = None
    sign_kind: SignKind = "ظاهرة"
    reason_ar: Optional[str] = None      # "لأنه جمع مذكر سالم"
    rule_ref: str                        # RuleClause.id — MUST resolve (contract §4.4)
    surface_ar: str                      # the full formulaic string the student writes
    accept_ar: list[str] = []            # human-approved equivalent phrasings (VARIANT)

    @model_validator(mode="after")
    def slots_are_coherent(self) -> "IrabAnswer":
        require_store_form(self.word_ar, "irab word_ar")
        require_store_form(self.surface_ar, "irab surface_ar")
        if self.state == "مبني":
            if self.position is None:
                raise ValueError(
                    f"«{self.word_ar}»: مبني needs its محل — «مبني على … في محل نصب»")
            if self.sign_kind != "—":
                raise ValueError(
                    f"«{self.word_ar}»: a مبني word has no علامة إعراب kind; use sign_kind '—' "
                    "and put the built-on marker in `sign`")
        else:
            if self.position is not None:
                raise ValueError(
                    f"«{self.word_ar}»: a معرب word has a حالة, not a محل — drop `position`")
            if self.sign is None:
                raise ValueError(f"«{self.word_ar}»: a معرب word needs its علامة")
        if not self.rule_ref.startswith("gc:"):
            raise ValueError(
                f"«{self.word_ar}»: rule_ref must cite a RuleClause printed in THIS book "
                "(contract §4.4) — an إعراب the book cannot license is not shippable")
        return self


# --- the other typed answers (contract §3) -----------------------------------

class ExtractAnswer(BaseModel):
    """استخرج من النص — spans into the sealed passage, never copied strings, so
    the grader cannot drift from the text."""
    primary: SpanRef
    accepted: list[SpanRef] = []


class LexicalAnswer(BaseModel):
    """هات مرادف / مضاد / جمع / مفرد — graded by set membership under
    COMPARE-LOOSE, so «هونا» is accepted for «هَوْنًا»."""
    field: Literal["معنى", "مضاد", "جمع", "مفرد"]
    accept: list[str] = Field(min_length=1)
    authored: bool = False               # true when the book never printed it

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "LexicalAnswer":
        for i, a in enumerate(self.accept):
            require_store_form(a, f"lexical accept[{i}]")
        if self.field == "مضاد" and not self.authored:
            raise ValueError("مضاد is never printed in this book — set authored=true")
        return self


class RhetoricAnswer(BaseModel):
    """ما نوع الأسلوب / ما الغرض البلاغي — closed enums, so it grades with no
    model call and no terminology drift."""
    type: RhetoricType
    purpose: Optional[RhetoricPurpose] = None
    effect_ar: Optional[str] = None


class SpellingFixAnswer(BaseModel):
    """صوّب الخطأ الإملائي — a wrong answer maps to a CASE ROW, giving the same
    computed-diagnosis property as an إعراب slot diff."""
    corrected_ar: str
    case_id: str                         # SpellingCase.id — MUST resolve
    wrong_ar: Optional[str] = None

    @model_validator(mode="after")
    def stored_text_is_normal(self) -> "SpellingFixAnswer":
        require_store_form(self.corrected_ar, "spelling corrected_ar")
        return self


# Distinct required-field sets, so the union is unambiguous — same convention as
# `list[str] | list[ClaimStep]` above. `Question.answer_matches_type` then pins
# each type to exactly one record, loudly.
ArabicAnswer = IrabAnswer | ExtractAnswer | LexicalAnswer | RhetoricAnswer | SpellingFixAnswer

AR_ANSWER_BY_TYPE: dict[str, type[BaseModel]] = {
    "irab": IrabAnswer,
    "extract": ExtractAnswer,
    "lexical": LexicalAnswer,
    "rhetoric": RhetoricAnswer,
    "spelling_fix": SpellingFixAnswer,
}
# Only `extract` is structurally passage-bound: «استخرج من النص» has no meaning
# without the text. إعراب and مواطن الجمال drills are frequently set on the
# book's own rule examples rather than on a passage line, so `passage_ref` is
# optional for them — the marker/quote detectors, not a required field, are what
# catch an unlabelled question that quotes the text.
PASSAGE_BOUND_TYPES = frozenset({"extract"})


# =============================================================================
# The v2 line (extraction-pipeline.md §3.3–§3.6; specs/003 T336, T401)
#
# Everything below is additive and defaulted, like the Arabic vertical before
# it: every shipped bundle validates and dumps byte-identically
# (tests/test_schemas_v2.py compares against the committed schema's dumps).
# =============================================================================

# Where a book question's canonical solution comes from (FR-4302, decision 19).
#   book_worked       a worked example: the book's printed QUESTION/SOLUTION
#   book_worked_epub  an exercise: the worked solution the EPUB edition carries
#                     for it, which the PDF (the citation authority) does not print
#   teachers_guide    the Teacher's Guide's solution, only where it adds something
#                     the book and its EPUB lack
#   answer_anchored   steps derived to the printed answer from the lesson's own
#                     methods, kept for books with no worked solutions; not
#                     expected for Grade 10
SolutionProvenance = Literal["book_worked", "book_worked_epub", "teachers_guide",
                             "answer_anchored"]
QuestionSource = Literal["seed", "authored"]

# The maths-expression marker's answer spec (specs/003 contracts/answer-marker.md,
# FR-4320). It travels in the question's existing `choices` JSON as
# {"marker": {...}}, the way widgets carry theirs (ADR-0009), so no
# question_type CHECK is widened; question_type stays 'short'.
MarkerKind = Literal["expression", "equation", "values", "interval", "coordinates",
                     "surd", "recurring"]
# `tolerance` is for the kinds whose key can be a decimal. An exact kind never
# takes one: a surd question refuses a decimal (contract, Behaviour §3).
NUMERIC_MARKER_KINDS = frozenset({"values", "interval", "coordinates", "recurring"})
_VARIABLE_RE = re.compile(r"^[A-Za-z](?:_[A-Za-z0-9]+)?$|^\\[a-zA-Z]+$")


class SubjectForm(BaseModel):
    """`form: {"subject": "x"}` — "make x the subject of the formula"."""
    model_config = ConfigDict(extra="forbid")
    subject: str = Field(min_length=1)


class Tolerance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    abs: float = Field(gt=0)


class AnswerSpec(BaseModel):
    """What the app's expression marker needs to mark one typed answer.

    `key` is LaTeX, written by S3 from the book's printed answer. Notation is
    normalised at assembly (decision 15: decimal point, `(x, y)`), and put into
    the marker library's canonical form once T413 has chosen the library.
    `form` is the form the question asks for; an equivalent answer in another
    form is marked `wrong_form`, never correct (FR-4320). The forms are EXACTLY the
    ones the app's `readMarkerSpec` accepts (app/src/lib/answer-marker.ts FORM_NAMES,
    which throws on any other): factorised, expanded, simplest, `decimal` (the
    per-question flag for "write it as a decimal": 7/33 is not 0.2̇1̇, backlog 31) and
    {subject} on an equation. A form the app does not know never reaches a spec: the
    book's "product of prime factors" (backlog 30) is carried as the item's
    `asked_form` and the item is HELD until the app's marker can check it.
    `marker_check.mjs` runs the app's own reader and key check on every bundle.
    """
    model_config = ConfigDict(extra="forbid")
    kind: MarkerKind
    key: str = Field(min_length=1)
    form: Optional[Literal["factorised", "expanded", "simplest", "decimal"] | SubjectForm] = None
    variables: list[str] = []
    tolerance: Optional[Tolerance] = None

    @model_validator(mode="after")
    def coherent(self) -> "AnswerSpec":
        if not self.key.strip():
            raise ValueError("marker key must be non-empty")
        for v in self.variables:
            if not _VARIABLE_RE.match(v):
                raise ValueError(f"marker variable {v!r} is not a single letter, a subscripted "
                                 "letter or a LaTeX Greek name")
        if len(set(self.variables)) != len(self.variables):
            raise ValueError(f"marker variables repeat: {self.variables}")
        if self.tolerance is not None and self.kind not in NUMERIC_MARKER_KINDS:
            raise ValueError(f"marker kind '{self.kind}' is exact; a tolerance belongs only to "
                             f"{sorted(NUMERIC_MARKER_KINDS)}")
        if isinstance(self.form, SubjectForm):
            if self.kind != "equation":
                # the app's reader: "a subject form needs an equation"
                raise ValueError("'make x the subject' is a form of an equation (the app's marker)")
            if self.variables and self.form.subject not in self.variables:
                raise ValueError(f"subject {self.form.subject!r} is not among the variables "
                                 f"{self.variables}")
        if self.form in ("factorised", "expanded") and self.kind not in ("expression", "equation"):
            raise ValueError(f"form '{self.form}' applies to an expression or an equation, "
                             f"not to kind '{self.kind}'")
        if self.form == "decimal" and self.kind not in ("expression", "recurring", "values"):
            raise ValueError(f"form 'decimal' applies to a number, a recurring decimal or values, "
                             f"not to kind '{self.kind}'")
        return self


class MarkerChoices(BaseModel):
    """The `choices` value of a marker-graded question: {"marker": AnswerSpec}.

    `answer_only: true` (G2, Samuel's answer 22 → decision 43; pipeline-handoff.md): the book has
    no working for this item, so it is marked on its answer alone and the tutor gives NO step-by-step
    explanation (there is nothing canonical to ground one in). Absent otherwise — never `false`."""
    model_config = ConfigDict(extra="forbid")
    marker: AnswerSpec
    answer_only: Optional[Literal[True]] = None

    @model_serializer(mode="wrap")
    def _absent_is_absent(self, handler):
        # the stored `choices` of every other marker question stays {"marker": {...}} exactly
        out = handler(self)
        if isinstance(out, dict) and out.get("answer_only") is None:
            out.pop("answer_only", None)
        return out


class McqChoices(BaseModel):
    """The `choices` value of a multiple-choice question some of whose OTHER options are also true,
    less precisely (G2, Samuel's answer 20 → decision 41; pipeline-handoff.md, FR-4320's re-entry
    rule): {"options": [Choice…], "less_specific": [<option key>…]}. The key is the most specific
    answer; a pick in `less_specific` is returned for re-entry ("true, but be more precise") and is
    never marked wrong. An ordinary multiple-choice question keeps its plain list."""
    model_config = ConfigDict(extra="forbid")
    options: list[Choice] = Field(min_length=2)
    less_specific: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def keys_exist(self) -> "McqChoices":
        keys = [c.key for c in self.options]
        if len(set(keys)) != len(keys):
            raise ValueError(f"option keys repeat: {keys}")
        unknown = [k for k in self.less_specific if k not in keys]
        if unknown:
            raise ValueError(f"less_specific names no option: {unknown} (options {keys})")
        if len(set(self.less_specific)) != len(self.less_specific):
            raise ValueError(f"less_specific repeats a key: {self.less_specific}")
        return self


# --- A lesson's book provenance (FR-4311, decision 18; data-model §2) --------

_SECTION_NUMBER_RE = re.compile(r"^[0-9]{1,2}\.[0-9]{1,2}$")
# The app's lesson-slug rule (app/src/lib/lesson-slug.ts SLUG_RE).
LESSON_SLUG_RE = re.compile(r"^[a-z0-9]{1,12}-[0-9]{1,3}$")


class BookSection(BaseModel):
    """One printed section a lesson covers: its number and title as printed, and its
    section code (EMA…) where the book has one."""
    model_config = ConfigDict(extra="forbid")
    number: str
    title: str = Field(min_length=1)
    code: Optional[str] = None

    @model_validator(mode="after")
    def printed_number(self) -> "BookSection":
        if not _SECTION_NUMBER_RE.match(self.number):
            raise ValueError(f"section number {self.number!r} is not a printed '<chapter>.<n>'")
        return self


class LessonPart(BaseModel):
    """Part n of m of one split section."""
    model_config = ConfigDict(extra="forbid")
    n: int = Field(ge=1)
    of: int = Field(ge=2)

    @model_validator(mode="after")
    def in_range(self) -> "LessonPart":
        if self.n > self.of:
            raise ValueError(f"part {self.n} of {self.of}")
        return self


class Lesson(BaseModel):
    """A lesson and where it comes from in its book (FR-4311).

    - one section, no part: the ordinary case (every National lesson);
    - one section with `part`: one part of a split section (G0 P1a–e);
    - several sections: a merged lesson (G0 P3a–b), which takes its first
      section's slug;
    - `chapter_intro`: a promoted chapter introduction (G0 P2a–b).

    The loader writes it to the book-sections store (migration 034). Part
    prerequisites are derived from it at read time, never written as edges
    (FR-4317).
    """
    model_config = ConfigDict(extra="forbid")
    slug: str
    title: str = Field(min_length=1)
    module: Optional[str] = None
    order_in_module: Optional[int] = Field(default=None, ge=1)
    sections: list[BookSection] = Field(min_length=1)
    part: Optional[LessonPart] = None
    chapter_intro: bool = False
    # data-model §2: the key a section's parts share. Derived when absent (below).
    group_key: Optional[str] = None
    printed_pages: Optional[tuple[int, int]] = None

    @model_validator(mode="after")
    def provenance_is_coherent(self) -> "Lesson":
        if not LESSON_SLUG_RE.match(self.slug):
            raise ValueError(f"lesson slug {self.slug!r} does not match the app's SLUG_RE "
                             f"{LESSON_SLUG_RE.pattern}")
        numbers = [s.number for s in self.sections]
        if len(set(numbers)) != len(numbers):
            raise ValueError(f"{self.slug}: a section is listed twice: {numbers}")
        if self.part is not None and len(self.sections) != 1:
            raise ValueError(f"{self.slug}: a part belongs to exactly one section, "
                             f"not {numbers}")
        if self.chapter_intro and (len(self.sections) != 1 or self.part is not None):
            raise ValueError(f"{self.slug}: a promoted introduction is one whole section")
        derived = self.derived_group_key()
        if self.group_key is None:
            self.group_key = derived
        elif self.part is not None and self.group_key != derived:
            raise ValueError(f"{self.slug}: a part's group_key is its section ({derived}), "
                             f"not {self.group_key!r}")
        if self.printed_pages and self.printed_pages[0] > self.printed_pages[1]:
            raise ValueError(f"{self.slug}: printed_pages {self.printed_pages} run backwards")
        return self

    def derived_group_key(self) -> str:
        """A part: its section. A merged lesson: the section its slug names (g10m1s3-1
        covering 1.2 and 1.3 is grouped as 1.3), else its first. Anything else: its
        one section."""
        if self.part is not None or len(self.sections) == 1:
            return self.sections[0].number
        named = section_of_slug(self.slug)
        numbers = [s.number for s in self.sections]
        return named if named in numbers else numbers[0]


def section_of_slug(slug: str) -> Optional[str]:
    """`g10m8s3-2` → "8.3": the printed section a v2 lesson slug names (None for
    slugs that name no section, such as the Prep-3 `u1-1`)."""
    m = re.match(r"^[a-z]+?\d*[a-z](\d+)s(\d+)-\d+$", slug)
    return f"{m.group(1)}.{m.group(2)}" if m else None


# --- Id helpers (specs/003 contracts/pipeline-handoff.md, "Ids") -------------

def lo_id(lesson_slug: str, n: int) -> str:
    """`lo:<lesson>-<n>`: the lesson is the LO id's prefix (lesson-slug.ts)."""
    if not LESSON_SLUG_RE.match(lesson_slug) or n < 1:
        raise ValueError(f"cannot mint an objective id from {lesson_slug!r}, {n}")
    return f"lo:{lesson_slug}-{n}"


def lo_tail(lo: str) -> str:
    return lo.removeprefix("lo:")


def worked_example_question_id(lo: str, we_number: int) -> str:
    """`q:<lo tail>:we03` for the book's worked example 3 (numbered per chapter)."""
    return f"q:{lo_tail(lo)}:we{we_number:02d}"


def exercise_question_id(lo: str, item_id: str) -> str:
    """`q:<lo tail>:ex8-2-5b` for exercise item `Ex8-2:5b` (label, question, sub-part)."""
    m = re.match(r"^Ex(\d{1,2})-(\d{1,2}):(\d{1,3})([a-z]{0,3}(?:-[ivx]+)?)$", item_id)
    if not m:
        raise ValueError(f"exercise item id {item_id!r} is not Ex<ch>-<set>:<q><sub>")
    return f"q:{lo_tail(lo)}:ex{m.group(1)}-{m.group(2)}-{m.group(3)}{m.group(4)}"


class Question(BaseModel):
    id: str
    lo: str
    tier: Tier
    type: QuestionType
    stem: str
    # A choice list (mcq), or the marker's answer spec {"marker": {...}} for a
    # typed maths answer (contracts/answer-marker.md, FR-4320; type 'short').
    choices: Optional[list[Choice] | MarkerChoices | McqChoices] = None
    # Math / social / mcq: the answer key as a string (unchanged).
    # Arabic (ADR-0006): a typed answer record. An إعراب answer is a slot record
    # so it can be slot-diffed with no LLM; a bare string is rejected below.
    answer: str | ArabicAnswer
    # Math: list[str] (canonical step-by-step solution, unchanged).
    # Social: list[ClaimStep] (model answer with per-claim evidence, contract §3).
    # Arabic: list[str] — the derivation steps, grounded in the cited RuleClause.
    # Mixed lists are rejected by the union: all-str or all-ClaimStep.
    solution: list[str] | list[ClaimStep] = Field(
        min_length=1, description="Canonical solution: math strings or social claim-steps")
    source_page: int
    source_note: str
    verified: bool = False  # True only after an INDEPENDENT re-solve confirmed the answer
    # --- Arabic vertical (ADR-0006). All defaulted: math and social bundles are
    #     unchanged under model_dump(exclude_defaults=True).
    passage_ref: Optional[str] = None              # the sealed TextPassage this is about
    sensitivity_class: Optional[SensitivityClass] = None   # human-assigned, never inferred
    sensitivity_reviewed_by: Optional[str] = None  # clears a detector escalation (§1)
    variant_of: Optional[str] = None               # seed question id (provenance, ADR-0001)
    # --- The v2 line (T336). All defaulted: every shipped bundle is unchanged
    #     under model_dump(exclude_defaults=True).
    # 'seed' = a verbatim book item; 'authored' = agent-written (every bundle so
    # far, which is why absent means 'authored' to the loader). Never 'variant'.
    source: Optional[QuestionSource] = None
    solution_provenance: Optional[SolutionProvenance] = None   # FR-4302
    family: Optional[str] = None                   # a generated item's family (S6), as a field

    @property
    def marker(self) -> Optional[AnswerSpec]:
        """The expression marker's spec, when this question is marker-graded."""
        return self.choices.marker if isinstance(self.choices, MarkerChoices) else None

    @model_validator(mode="after")
    def marker_is_a_short_answer(self) -> "Question":
        if isinstance(self.choices, MarkerChoices):
            if self.type != "short":
                raise ValueError(
                    f"{self.id}: a marker-graded question is question_type 'short' "
                    f"(contracts/answer-marker.md: no CHECK is widened), not '{self.type}'")
            if not isinstance(self.answer, str) or not self.answer.strip():
                raise ValueError(f"{self.id}: a marker-graded question still carries its "
                                 "answer as text (the printed answer), for the tutor and the "
                                 "console")
        if self.family is not None and self.solution_provenance is not None:
            raise ValueError(f"{self.id}: a generated family's item computes its own solution; "
                             "it cannot also claim a book solution provenance")
        return self

    @model_validator(mode="after")
    def answer_matches_type(self) -> "Question":
        expected = AR_ANSWER_BY_TYPE.get(self.type)
        if expected is None:
            if not isinstance(self.answer, str):
                raise ValueError(
                    f"{self.id}: '{self.type}' takes a string answer key, got "
                    f"{type(self.answer).__name__}")
            return self
        if not isinstance(self.answer, expected):
            raise ValueError(
                f"{self.id}: '{self.type}' answers are TYPED RECORDS, not strings — expected "
                f"{expected.__name__}, got {type(self.answer).__name__}. Storing the formula as "
                "a string loses the slots, so the grader needs an LLM and the tutor cannot say "
                "which part was wrong (contract §2.5)")
        if self.sensitivity_class is None:
            raise ValueError(
                f"{self.id}: Arabic questions carry an explicit sensitivity_class — it is "
                "assigned by a human and stored as data, never inferred at runtime and never "
                "from a title (sensitive-content §1)")
        if self.type in PASSAGE_BOUND_TYPES and not self.passage_ref:
            raise ValueError(f"{self.id}: '{self.type}' must name the passage it is about")
        # Pydantic mirror of the variant-engine guard, so a hand-written bundle
        # cannot smuggle a generated variant of scripture past it (S1).
        if self.variant_of and self.sensitivity_class in SEALED_SENSITIVITY_CLASSES:
            raise ValueError(
                f"{self.id}: a '{self.sensitivity_class}' question may never be a variant of "
                "anything — sacred text is copied, never produced (ADR-0006)")
        return self

    @model_validator(mode="after")
    def mcq_has_valid_answer(self) -> "Question":
        if isinstance(self.choices, McqChoices) and self.type != "mcq":
            raise ValueError(f"{self.id}: options with less_specific belong to an mcq, not '{self.type}'")
        if self.type == "mcq":
            options = self.choices.options if isinstance(self.choices, McqChoices) else self.choices
            if not isinstance(options, list) or len(options) < 2:
                raise ValueError(f"{self.id}: mcq needs >= 2 choices")
            if self.answer not in {c.key for c in options}:
                raise ValueError(f"{self.id}: answer '{self.answer}' not among choice keys")
            if isinstance(self.choices, McqChoices) and self.answer in self.choices.less_specific:
                raise ValueError(f"{self.id}: the key '{self.answer}' is the most specific answer; "
                                 "it cannot also be listed as less specific")
        return self


VIZ_KINDS = {"coordinate_plot", "function_graph", "arrow_map", "product_grid",
             "ratio_bars", "stat_chart", "trig_triangle", "geo_scene", "number_line",
             # VIZ_SPEC v2 (ADR-0004, Social Studies vertical)
             "map_scene", "timeline", "flow_chain"}


class Visual(BaseModel):
    id: str
    lo: str
    question: Optional[str] = None
    kind: str
    spec: dict
    caption: Optional[str] = None
    source_page: Optional[int] = None

    @model_validator(mode="after")
    def known_kind(self) -> "Visual":
        if self.kind not in VIZ_KINDS:
            raise ValueError(f"{self.id}: unknown viz kind '{self.kind}' (see VIZ_SPEC.md)")
        return self


class KeyTerm(BaseModel):
    """مفاهيم أتعلمها glossary entry (contract §2.2) — verbatim ministry terminology.

    Validated at bundle level; DB storage deferred (human verbatim-check artifact).
    """
    term_ar: str
    definition_ar: str
    page: int
    lesson: str


# =============================================================================
# Explanation / refutation library — ADR-0007 (Student MVP 1.0 comparison build)
#
# The PRD's central teaching bet: when a student gets something wrong, the tutor
# serves content AUTHORED AHEAD OF TIME for that specific misconception, rather
# than re-deriving an explanation in the moment.
#
# ⚠️  Constitution v2.0.0 Principle III is SUSPENDED for these rows, in the
# comparison environment only (decisions.md Q8): no reviewer exists at this
# stage, so they ship pipeline-generated and unreviewed. Two consequences are
# baked into the schema rather than left to convention:
#   * `generated_by` is REQUIRED — every row can name what produced it;
#   * there is no `reviewed` field here at all. The loader forces reviewed=false
#     on insert, so a bundle cannot assert that its own content was reviewed.
#     Review is something a human does later, in the database, never something
#     generated content can claim about itself.
#
# Additive and defaulted, like the Arabic vertical before it: math, social and
# Arabic bundles validate and dump byte-identically.
# =============================================================================


class Misconception(BaseModel):
    """A diagnosable wrong turn a student takes on one learning objective."""

    # `mc:<lo tail>:<slug>` is the shipped catalogue's convention
    # (seed/generated/misconceptions.json, pipeline-handoff "Ids"); `misc:` is
    # the retired refutation workflow's and stays accepted for old bundles.
    id: str = Field(pattern=r"^(?:mc|misc):[a-z0-9\-]+:[a-z0-9\-]+$")
    lo: str
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    # How it shows up in an answer. Optional because some misconceptions are
    # only visible in working, not in a final answer — and a guessed signal is
    # worse than none, since it drives a wrong diagnosis.
    signal: Optional[str] = None
    generated_by: str = Field(min_length=1)


class ExplanationEntry(BaseModel):
    """One authored teaching move for a learning objective."""

    id: str = Field(min_length=1)
    lo: str
    entry_type: Literal["worked_example", "faded", "contrasting_case", "refutation"]
    # Typed steps, same shape discipline as canonical_solution.
    content: list[ClaimStep] | list[dict] = Field(min_length=1)
    misconception: Optional[str] = None
    source_page: Optional[int] = None
    generated_by: str = Field(min_length=1)

    @model_validator(mode="after")
    def refutation_needs_target(self) -> "ExplanationEntry":
        # A refutation with nothing to refute is a bug, not a row. The DB
        # enforces this too (migration 009); catching it here means the
        # pipeline fails at assembly rather than at load, with the bundle in
        # hand to fix.
        if self.entry_type == "refutation" and not self.misconception:
            raise ValueError(
                f"explanation {self.id}: entry_type='refutation' requires a misconception"
            )
        return self


class SeedBundle(BaseModel):
    # Source-document resolution (per bundle, in batch order):
    #   1. source_document set  -> this bundle defines (and uses) that document
    #   2. source_file set      -> reuse the document with this file_path, defined by an
    #                              earlier bundle in the batch or already present in the DB
    #   3. neither              -> inherit the previous bundle's resolved document
    # (unit1.json-style batches keep working unchanged: first bundle defines, rest inherit)
    source_document: Optional[SourceDocument] = None
    source_file: Optional[str] = None  # file_path of a source document defined elsewhere
    extraction_run: ExtractionRun
    syllabus_version: str
    nodes: list[Node]
    edges: list[Edge]
    questions: list[Question]
    visuals: list[Visual] = []
    key_terms: list[KeyTerm] = []  # contract §2.2 (social); empty for math bundles
    external_node_refs: list[str] = []  # node ids defined by an earlier bundle (e.g. course:...)
    # --- Arabic vertical (ADR-0006); empty for every math and social bundle.
    text_passages: list[TextPassage] = []
    vocab_items: list[VocabItem] = []
    rhetoric_notes: list[RhetoricNote] = []
    grammar_rules: list[GrammarRule] = []
    spelling_rules: list[SpellingRule] = []
    # Grammar is taught in INSTALLMENTS across lessons, so a lesson bundle
    # legitimately cites a clause sealed by an earlier bundle (contract §4.5).
    external_rule_refs: list[str] = []
    external_passage_refs: list[str] = []
    # --- Explanation library (ADR-0007); empty for every pre-MVP1.0 bundle.
    misconceptions: list[Misconception] = []
    explanation_entries: list[ExplanationEntry] = []
    # --- Lesson book provenance (FR-4311, T401), in catalogue order. Empty for
    #     every shipped bundle; the loader derives one-section provenance for
    #     them from their slugs and titles (T404).
    lessons: list[Lesson] = []

    @model_validator(mode="after")
    def lesson_provenance(self) -> "SeedBundle":
        """FR-4311/FR-4312 as far as one bundle can see them.

        Returns at once for a bundle with no lessons, so every shipped bundle's
        path is untouched."""
        if not self.lessons:
            return self
        slugs = [lsn.slug for lsn in self.lessons]
        if len(set(slugs)) != len(slugs):
            raise ValueError(f"a lesson is listed twice: {sorted(s for s in slugs if slugs.count(s) > 1)}")
        # Parts of one section: numbered 1..m, all saying the same m, consecutive
        # in the listed (catalogue) order (FR-4312).
        parts: dict[str, list[tuple[int, Lesson]]] = {}
        for i, lsn in enumerate(self.lessons):
            if lsn.part is not None:
                parts.setdefault(lsn.group_key, []).append((i, lsn))
        for key, members in parts.items():
            ns = [lsn.part.n for _, lsn in members]
            ofs = {lsn.part.of for _, lsn in members}
            if len(ofs) != 1 or sorted(ns) != list(range(1, next(iter(ofs)) + 1)):
                raise ValueError(f"section {key}: parts {sorted(ns)} of {sorted(ofs)} — a split "
                                 "section's parts are numbered 1..m, every one of them present")
            idx = [i for i, _ in members]
            if idx != list(range(idx[0], idx[0] + len(idx))) or ns != sorted(ns):
                raise ValueError(f"section {key}: its parts are not consecutive and in part "
                                 f"order in `lessons` ({[lsn.slug for _, lsn in members]})")
        # Every objective in the bundle belongs to a listed lesson, and every
        # listed lesson has an objective here.
        known = set(slugs)
        lo_lessons = {re.sub(r"-[0-9]+$", "", n.id.removeprefix("lo:"))
                      for n in self.nodes if n.kind == "learning_objective"}
        orphans = sorted(lo_lessons - known)
        if orphans:
            raise ValueError(f"objectives of lessons {orphans} have no book provenance in `lessons`")
        empty = sorted(known - lo_lessons)
        if empty:
            raise ValueError(f"lessons {empty} carry no objective in this bundle")
        return self

    @model_validator(mode="after")
    def referential_integrity(self) -> "SeedBundle":
        if self.source_document and self.source_file:
            raise ValueError("set source_document OR source_file, not both")
        ids = {n.id for n in self.nodes} | set(self.external_node_refs)
        for e in self.edges:
            if e.src not in ids or e.dst not in ids:
                raise ValueError(f"edge {e.src} -> {e.dst}: unknown node id")
        lo_ids = {n.id for n in self.nodes if n.kind == "learning_objective"}
        for q in self.questions:
            if q.lo not in lo_ids:
                raise ValueError(f"question {q.id}: unknown LO {q.lo}")
        # Library rows attach to LOs, which for a refutation bundle live in an
        # earlier bundle — so external_node_refs counts, exactly as it does for
        # edges above.
        misc_ids = {m.id for m in self.misconceptions}
        for m in self.misconceptions:
            if m.lo not in ids:
                raise ValueError(f"misconception {m.id}: unknown LO {m.lo}")
        for x in self.explanation_entries:
            if x.lo not in ids:
                raise ValueError(f"explanation {x.id}: unknown LO {x.lo}")
            if x.misconception and x.misconception not in misc_ids:
                raise ValueError(
                    f"explanation {x.id}: unknown misconception {x.misconception}"
                )
        qids = {q.id for q in self.questions}
        for v in self.visuals:
            if v.lo not in lo_ids:
                raise ValueError(f"visual {v.id}: unknown LO {v.lo}")
            if v.question and v.question not in qids:
                raise ValueError(f"visual {v.id}: unknown question {v.question}")
        # prerequisite graph must be a DAG (Ch. 15.4)
        prereq = [(e.src, e.dst) for e in self.edges if e.type == "prerequisite_of"]
        adj: dict[str, list[str]] = {}
        for s, d in prereq:
            adj.setdefault(s, []).append(d)
        seen: dict[str, int] = {}  # 0=visiting, 1=done

        def dfs(u: str) -> None:
            seen[u] = 0
            for v in adj.get(u, []):
                if seen.get(v) == 0:
                    raise ValueError(f"prerequisite cycle involving {u} -> {v}")
                if v not in seen:
                    dfs(v)
            seen[u] = 1

        for s, _ in prereq:
            if s not in seen:
                dfs(s)
        return self

    # -------------------------------------------------------------------------
    # Arabic referential integrity (ADR-0006). Kept as a SEPARATE validator that
    # returns immediately when a bundle carries no Arabic artefacts, so the math
    # and social path above is provably untouched.
    # -------------------------------------------------------------------------
    @model_validator(mode="after")
    def arabic_referential_integrity(self) -> "SeedBundle":
        arabic = bool(self.text_passages or self.grammar_rules or self.spelling_rules
                      or any(q.type in AR_ANSWER_BY_TYPE for q in self.questions))

        # The escalate-only detector runs on EVERY bundle: sacred text is
        # scattered — it turns up inside grammar rules and inside another
        # author's prose — so "handle the Quran lesson carefully" is not a
        # policy (sensitive-content §1/S7). It can only move a stem UP to a
        # sealed class for human confirmation; it can never clear one down.
        # (Verified zero hits across every shipped math and social bundle.)
        for q in self.questions:
            if q.sensitivity_class in SEALED_SENSITIVITY_CLASSES or q.sensitivity_reviewed_by:
                continue
            if hits := scan_sacred_markers(q.stem):
                raise ValueError(
                    f"question {q.id}: sacred-content detector fired ({'; '.join(hits)}) but the "
                    f"question is classed '{q.sensitivity_class}'. A human must confirm the class "
                    "(set sensitivity_class) or record the review (sensitivity_reviewed_by). "
                    "The detector escalates only — it never clears content down")
        if not arabic:
            return self

        passages = {p.id: p for p in self.text_passages}
        if len(passages) != len(self.text_passages):
            raise ValueError("duplicate TextPassage id in bundle")
        known_passages = set(passages) | set(self.external_passage_refs)
        clauses = {c.id for r in self.grammar_rules for c in r.clauses} | set(
            self.external_rule_refs)
        cases = {c.id for r in self.spelling_rules for c in r.cases}

        def unit_text(ref: str, unit_n: int, who: str) -> Optional[str]:
            """STORE text of one unit, or None when the passage is external."""
            if ref not in known_passages:
                raise ValueError(f"{who}: unknown passage {ref}")
            p = passages.get(ref)
            if p is None:
                return None
            if not 1 <= unit_n <= len(p.units):
                raise ValueError(f"{who}: passage {ref} has no unit {unit_n}")
            return p.units[unit_n - 1].text_ar

        def check_span(s: SpanRef, who: str) -> None:
            text = unit_text(s.passage_ref, s.unit_n, who)
            if text is None:
                return
            if s.end > len(text):
                raise ValueError(
                    f"{who}: span [{s.start},{s.end}) runs past unit {s.unit_n} "
                    f"({len(text)} chars)")
            if s.expected_ar is not None and text[s.start:s.end] != s.expected_ar:
                raise ValueError(
                    f"{who}: span text «{text[s.start:s.end]}» != expected «{s.expected_ar}» — "
                    "the span and the sealed text have drifted apart")

        # Fidelity: every rhetoric شاهد is a character-exact substring of the
        # sealed passage. Anything else means someone re-typed the book (§5.2d).
        for note in self.rhetoric_notes:
            text = unit_text(note.passage_ref, note.unit_n or 1, f"rhetoric {note.id}")
            if text is not None and note.unit_n and note.expression_ar not in text:
                raise ValueError(
                    f"rhetoric {note.id}: «{note.expression_ar}» is not a character-exact "
                    f"substring of {note.passage_ref} unit {note.unit_n} — quote the sealed "
                    "text, never re-type it (verification §1.6)")
            if note.span:
                check_span(note.span, f"rhetoric {note.id}")
        for v in self.vocab_items:
            if v.passage_ref:
                unit_text(v.passage_ref, v.unit_n or 1, f"vocab «{v.word_ar}»")

        for q in self.questions:
            if q.passage_ref and q.passage_ref not in known_passages:
                raise ValueError(f"question {q.id}: unknown passage {q.passage_ref}")
            # Derived sealing: a question ABOUT sacred text is itself sacred,
            # computed from the passage rather than trusted from the label.
            src = passages.get(q.passage_ref or "")
            if src is not None and src.is_sacred and q.sensitivity_class not in (
                    SEALED_SENSITIVITY_CLASSES):
                raise ValueError(
                    f"question {q.id}: bound to sacred passage {src.id} but classed "
                    f"'{q.sensitivity_class}' — it inherits '{src.sensitivity_class}'")
            if isinstance(q.answer, IrabAnswer):
                if q.answer.rule_ref not in clauses:
                    raise ValueError(
                        f"question {q.id}: rule_ref {q.answer.rule_ref} resolves to no clause "
                        "printed in this book (contract §4.4) — add it to a GrammarRule or to "
                        "external_rule_refs")
            elif isinstance(q.answer, ExtractAnswer):
                for s in [q.answer.primary, *q.answer.accepted]:
                    check_span(s, f"question {q.id}")
            elif isinstance(q.answer, SpellingFixAnswer):
                if q.answer.case_id not in cases:
                    raise ValueError(
                        f"question {q.id}: case_id {q.answer.case_id} resolves to no printed "
                        "إملاء case row")
        return self

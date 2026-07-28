"""Typed extraction schemas (thesis Pillar I: schema-first, not text-first).

Every fact carries provenance back to a content-addressed source document.
Validation happens here, before anything touches the database.
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

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


class ClaimStep(BaseModel):
    """Social-studies claim-step: one atomic Arabic claim with page evidence
    (الإجابة النموذجية بالأدلة — docs/specs/social-extraction-contract.md §3).
    `step` is assigned by the loader from list order, mirroring math strings.
    """
    claim_ar: str = Field(min_length=1)
    evidence_page: int
    evidence_kind: Literal["text", "map", "concept_box", "enrichment_box"]
    facts: Optional[list[ClaimFact]] = None

    @model_validator(mode="after")
    def claim_not_blank(self) -> "ClaimStep":
        if not self.claim_ar.strip():
            raise ValueError("claim_ar must be non-empty")
        return self


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


class Question(BaseModel):
    id: str
    lo: str
    tier: Tier
    type: QuestionType
    stem: str
    choices: Optional[list[Choice]] = None
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
        if self.type == "mcq":
            if not self.choices or len(self.choices) < 2:
                raise ValueError(f"{self.id}: mcq needs >= 2 choices")
            if self.answer not in {c.key for c in self.choices}:
                raise ValueError(f"{self.id}: answer '{self.answer}' not among choice keys")
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

"""Self-check for the Arabic Wave-0 contract (ADR-0006).

    cd services/extraction && uv run python selfcheck_arabic.py

Two things it must prove, in this order:

  A. NOTHING REGRESSED. Every shipped math and social bundle still validates,
     and none of the new fields leaks into their dumps.
  B. The new models REJECT the failure cases the specs name — a mismatched
     checksum, a sacred passage without a citation, an إعراب answer as a bare
     string, tatweel or presentation forms in stored text — plus the two safety
     guards (variant engine, loader).

No test framework on purpose: this runs in the same `uv run` an extraction agent
already has, with no new dependency. Exits non-zero on the first failing group.

FIXTURE NOTE — read before editing. The sacred fixture below deliberately
contains NO scripture. Its unit text is a plain Arabic sentence saying "this is
where the verified text goes". That is not squeamishness: the schema cannot tell
scripture from a placeholder, and it is not supposed to — character-exactness is
a property of the authority cross-check and the human sign-off, not of this
file. Never type a verse into a test fixture.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from arabic_text import (
    compare_loose,
    compare_verify,
    scan_sacred_markers,
    seal_text,
    sha256_text,
    store_form,
)
from schemas import SeedBundle
from variant_engine import VariantRefused, assert_variable
import load_seed

HERE = Path(__file__).resolve().parent
PASSED: list[str] = []
FAILED: list[str] = []


def ok(label: str, condition: bool, detail: str = "") -> None:
    (PASSED if condition else FAILED).append(f"{label}{(' — ' + detail) if detail else ''}")


def rejects(label: str, fn, expect: str = "") -> None:
    """Assert fn() raises, and that the message says what a human needs to do."""
    try:
        fn()
    except (Exception, SystemExit) as e:        # SystemExit is the loader's refusal
        msg = str(e)
        if expect and expect not in msg:
            FAILED.append(f"{label} — raised, but message lacks {expect!r}: {msg[:160]}")
        else:
            PASSED.append(f"{label} — {type(e).__name__}")
        return
    FAILED.append(f"{label} — DID NOT RAISE (this is the defect the check exists for)")


# =============================================================================
# A. Regression: the shipped bundles
# =============================================================================
NEW_FIELDS = {
    "passage_ref", "sensitivity_class", "sensitivity_reviewed_by", "variant_of",
    "text_passages", "vocab_items", "rhetoric_notes", "grammar_rules",
    "spelling_rules", "external_rule_refs", "external_passage_refs",
}


def check_shipped_bundles() -> None:
    for p in sorted((HERE / "seed").glob("*.json")):
        # seed/ also holds non-bundle artefacts (social-skeleton-traps.json is a
        # QA containment set: `_meta` + `traps`, and never was a SeedBundle).
        if '"extraction_run"' not in p.read_text():
            print(f"  skip  A/{p.name} — not a seed bundle")
            continue
        try:
            b = SeedBundle.model_validate_json(p.read_text())
        except Exception as e:                  # noqa: BLE001
            FAILED.append(f"A/{p.name} validates — {type(e).__name__}: {str(e)[:200]}")
            continue
        dump = b.model_dump(mode="json", exclude_defaults=True)
        leaked = (NEW_FIELDS & set(dump)) | {
            k for q in dump.get("questions", []) for k in NEW_FIELDS & set(q)}
        ok(f"A/{p.name} validates ({len(b.questions)} questions)", True)
        ok(f"A/{p.name} carries no Arabic fields", not leaked, ", ".join(sorted(leaked)))
        # Round-trip stability: dump -> validate -> dump is a fixed point.
        again = SeedBundle.model_validate(b.model_dump(mode="json")).model_dump(
            mode="json", exclude_defaults=True)
        ok(f"A/{p.name} round-trips unchanged", again == dump)


# =============================================================================
# B. The two normal forms
# =============================================================================
def check_normal_forms() -> None:
    ok("B/STORE keeps every harakah", store_form("هَوْنًا") == "هَوْنًا")
    ok("B/STORE keeps ى/ي and ة/ه apart (T5)",
       store_form("فى") != store_form("في") and store_form("رحمة") != store_form("رحمه"))
    ok("B/STORE strips tatweel (T6)", store_form("اللــوق") == "اللوق")
    ok("B/STORE keeps ﴿﴾", store_form("﴿كلمة﴾") == "﴿كلمة﴾")
    ok("B/LOOSE folds harakat and ى→ي for student typing",
       compare_loose("هَوْنًا") == "هونا" and compare_loose("فى") == compare_loose("في"))
    ok("B/LOOSE is NOT STORE (they can never be confused)",
       compare_loose("هَوْنًا") != store_form("هَوْنًا"))

    # --- COMPARE-VERIFY: the boundary Samuel's cross-check measured.
    # Synthetic strings, not scripture. U+06ED (SMALL LOW MEEM) is an iqlab
    # aid that publishers differ on; U+0670 (dagger alef) is a LETTER.
    edition_a, edition_b = "مِنۭ بَعْدِ", "مِن بَعْدِ"
    ok("B/VERIFY ignores the tajweed annotation block (U+06ED)",
       compare_verify(edition_a) == compare_verify(edition_b))
    ok("B/…but STORE keeps it — the annotation is never dropped from the seal",
       store_form(edition_a) != store_form(edition_b))
    ok("B/VERIFY keeps the dagger alef U+0670 (a letter, not annotation)",
       compare_verify("هَذَا") != compare_verify("هَٰذَا"))
    ok("B/VERIFY keeps harakat — «مِن» is not «مَن»",
       compare_verify("مِن") != compare_verify("مَن"))
    ok("B/LOOSE would have masked both — which is why it is not the verifier",
       compare_loose("هَذَا") == compare_loose("هَٰذَا")
       and compare_loose("مِن") == compare_loose("مَن"))
    # --- the presentation-form block holds two different things, and rule 4
    # only ever meant to catch one of them (decided 2026-07-29).
    ok("B/STORE keeps ﷺ U+FDFA — a semantic ligature the book prints",
       store_form("قال ﷺ لأصحابه") == "قال ﷺ لأصحابه")
    ok("B/…and ﷺ still escalates the sacred detector (storable ≠ unclassified)",
       any("ﷺ" in h for h in scan_sacred_markers("قال ﷺ لأصحابه")))
    rejects("B/STORE still rejects a POSITIONAL variant (ﻲ U+FEF2)",
            lambda: store_form("ﻲ"), "U+FEF2")
    rejects("B/STORE rejects presentation forms", lambda: store_form("ﻻ"), "presentation form")
    rejects("B/STORE rejects Farsi yeh", lambda: store_form("کتاب"), "U+06A9")
    rejects("B/STORE rejects extended Arabic-Indic digits", lambda: store_form("۱۲"), "U+06F1")
    rejects("B/STORE rejects ZWJ", lambda: store_form("ا‍ب"), "ZWJ")


# =============================================================================
# C-F. Fixtures — a minimal but VALID Arabic bundle, then one mutation each
# =============================================================================
SACRED_UNITS = [
    # Placeholder, not scripture — see the module docstring.
    "هنا يوضع النص المحقق من المصادر المعتمدة",
    "وهنا يوضع النص التالي المحقق من المصادر المعتمدة",
]
POEM_UNITS = [("أيهذا الشاكي وما بك داء", "كيف تغدو إذا غدوت عليلا")]

CROSSCHECK = {
    "method": "authority_crosscheck", "verdict": "agree", "transcript_agrees": True,
    "sources": [
        {"name": "api.quran.com/v4 · quran/verses/uthmani",
         "endpoint": "https://api.quran.com/api/v4/quran/verses/uthmani?chapter_number=25",
         "agrees": True},
        {"name": "api.alquran.cloud/v1 · quran-uthmani",
         "endpoint": "https://api.alquran.cloud/v1/surah/25/quran-uthmani",
         "agrees": True},
    ],
}


def sacred_passage(**over) -> dict:
    d = {
        "id": "t:ara1-1:001", "lesson": "ara1-1", "kind": "quran", "fidelity": "sacred",
        "sensitivity_class": "quran", "title_ar": "عباد الرحمن",
        "attribution_ar": "سورة الفرقان (٦٣ – ٦٤)",
        "quran_ref": {"surah": 25, "ayah_from": 63, "ayah_to": 64},
        "citation_ref": "quran:25:63-64",
        "units": [{"n": i + 1, "printed_n": n, "text_ar": t}
                  for i, (n, t) in enumerate(zip(["٦٣", "٦٤"], SACRED_UNITS))],
        "text_sha256": sha256_text(seal_text(SACRED_UNITS)),
        "capture_lane": "authority_verified", "verification": CROSSCHECK,
        "transcribers": ["vision-model-a"], "source_page": 8,
    }
    return d | over


def poem_passage(**over) -> dict:
    units = [{"n": i + 1, "printed_n": str(i + 1), "text_ar": f"{s} {a}",
              "sadr_ar": s, "ajuz_ar": a} for i, (s, a) in enumerate(POEM_UNITS)]
    texts = [u["text_ar"] for u in units]
    d = {
        "id": "t:ara1-2:001", "lesson": "ara1-2", "kind": "poetry", "fidelity": "literary",
        "sensitivity_class": "secular", "title_ar": "كن جميلا",
        "attribution_ar": "إيليا أبو ماضي", "units": units,
        "text_sha256": sha256_text(seal_text(texts)),
        "capture_lane": "double_blind", "transcribers": ["m1", "m2", "m3"],
        "approved_by": "teacher:demo", "approved_sha256": sha256_text(seal_text(texts)),
        "source_page": 14,
    }
    return d | over


IRAB = {
    "word_ar": "طالبي", "role_ar": "منادى مضاف", "state": "منصوب", "sign": "الياء",
    "sign_kind": "نائبة عن الفتحة", "reason_ar": "لأنه جمع مذكر سالم",
    "rule_ref": "gc:munada:mudaf-sign-ya-jam-mudhakkar",
    "surface_ar": "منادى مضاف منصوب وعلامة نصبه الياء نيابة عن الفتحة لأنه جمع مذكر سالم",
}


def bundle(**over) -> dict:
    d = {
        "source_document": {
            "title": "لغتي حياتي", "publisher": "MOE", "language": "ar",
            "grade": "prep-3", "subject": "arabic language",
            "file_path": "docs/Source/Arabic_Prp3_Tr1_2.pdf"},
        "extraction_run": {"extractor": "selfcheck", "extractor_version": "0",
                           "schema_version": "ara-1"},
        "syllabus_version": "2025-2026",
        "nodes": [
            {"id": "course:prep3-arabic-ar", "kind": "course", "label": "اللغة العربية"},
            {"id": "module:ara-u1", "kind": "module", "label": "الوحدة الأولى"},
            {"id": "lo:ara1-1-1", "kind": "learning_objective", "label": "المنادى"},
        ],
        "edges": [{"src": "module:ara-u1", "dst": "course:prep3-arabic-ar", "type": "part_of"},
                  {"src": "module:ara-u1", "dst": "lo:ara1-1-1", "type": "teaches"}],
        "text_passages": [sacred_passage(), poem_passage()],
        "grammar_rules": [{
            "id": "gr:munada", "label_ar": "المنادى", "unit": "module:ara-u1",
            "taught_in": ["ara1-1"],
            "clauses": [{"id": "gc:munada:mudaf-sign-ya-jam-mudhakkar",
                         "text_ar": "والياء مع جمع المذكر السالم", "kind": "sign",
                         "examples_ar": ["يا طالبي العلم"], "first_taught_lesson": "ara1-1",
                         "source_page": 11}]}],
        "spelling_rules": [{
            "id": "sp:hamza-mid-waw", "label_ar": "الهمزة المتوسطة على واو", "lesson": "ara1-1",
            "printed_case_count": 1,
            "cases": [{"id": "spc:hamza-mid-waw:1", "condition_ar": "مضمومة وما قبلها مفتوح",
                       "written_as_ar": "على واو", "examples_ar": ["يؤم"], "source_page": 12}]}],
        "vocab_items": [{"lesson": "ara1-1", "word_ar": "هونا", "gloss_ar": "بسكينة ووقار",
                         "source_page": 9}],
        "rhetoric_notes": [{
            "id": "rh:ara1-2:001", "lesson": "ara1-2", "passage_ref": "t:ara1-2:001",
            "unit_n": 1, "expression_ar": "أيهذا الشاكي", "type": "نداء",
            "purpose": "التنبيه", "effect_ar": "نداء للتنبيه", "verbatim_from_book": True,
            "source_page": 15}],
        "questions": [{
            "id": "q:ara1-1:001", "lo": "lo:ara1-1-1", "tier": "standard", "type": "irab",
            "stem": "أعرب ما تحته خط: يا طالبي العلم", "answer": IRAB,
            "solution": ["نوع المنادى: مضاف", "حالته: منصوب", "علامته: الياء نيابة عن الفتحة"],
            "source_page": 11, "source_note": "authored · ara1-1", "verified": True,
            "sensitivity_class": "secular"}],
    }
    return d | over


def check_the_seal() -> None:
    ok("C/valid Arabic bundle validates", SeedBundle.model_validate(bundle()) is not None)

    rejects("C/mismatched checksum is rejected",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(text_sha256="0" * 64), poem_passage()])),
            "does not recompute")

    # One changed harakah, checksum honestly recomputed: NOT an error — an
    # auto-demotion. This is verification §5.1's invariant, the one that matters.
    changed = [SACRED_UNITS[0] + "ِ", SACRED_UNITS[1]]
    demoted = sacred_passage(
        units=[{"n": i + 1, "printed_n": n, "text_ar": t}
               for i, (n, t) in enumerate(zip(["٦٣", "٦٤"], changed))],
        text_sha256=sha256_text(seal_text(changed)),
        approved_by="scholar:demo", approved_sha256=sha256_text(seal_text(SACRED_UNITS)))
    b = SeedBundle.model_validate(bundle(text_passages=[demoted, poem_passage()]))
    ok("C/one changed harakah auto-demotes a live passage",
       b.text_passages[0].approval_stale and not b.text_passages[0].approval_valid)

    rejects("C/sacred passage without a citation is rejected",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(quran_ref=None, citation_ref=None), poem_passage()])),
            "without a citation")
    rejects("C/a Quran passage without its (surah, ayah) record is rejected",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(quran_ref=None), poem_passage()])),
            "must carry quran_ref")
    rejects("C/sacred passage must go through the authority lane",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(capture_lane="double_blind"), poem_passage()])),
            "authority_verified")
    rejects("C/sacred passage with no verification record is rejected",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(verification=None), poem_passage()])),
            "never diffed against an authority")
    rejects("C/one authority is not a cross-check",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(verification=CROSSCHECK | {
                    "sources": CROSSCHECK["sources"][:1]}), poem_passage()])),
            ">= 2 INDEPENDENT authorities")
    rejects("C/the same authority twice is not two authorities",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(verification=CROSSCHECK | {
                    "sources": [CROSSCHECK["sources"][0], CROSSCHECK["sources"][0]]}),
                poem_passage()])),
            "listed twice")
    rejects("C/'agree' over a disagreeing source is rejected",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(verification=CROSSCHECK | {"sources": [
                    CROSSCHECK["sources"][0],
                    CROSSCHECK["sources"][1] | {"agrees": False,
                                                "differences": ["unit 2 pos 14"]}]}),
                poem_passage()])),
            "never silently accepted")

    # A real disagreement is a FLAG, not an error and not a blocked run.
    flagged = sacred_passage(verification={
        "method": "authority_crosscheck", "verdict": "flagged",
        "flag_reason": "المصدران يختلفان في موضع واحد — يحتاج مراجعة بشرية",
        "transcript_agrees": True,
        "sources": [CROSSCHECK["sources"][0],
                    CROSSCHECK["sources"][1] | {"agrees": False,
                                                "differences": ["unit 2 pos 14"]}]})
    fb = SeedBundle.model_validate(bundle(text_passages=[flagged, poem_passage()]))
    ok("C/a flagged cross-check is representable and does not block",
       fb.text_passages[0].verification_flagged and not fb.text_passages[0].approval_valid)
    rejects("C/a flag must say what the human is looking at",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(verification={
                    "method": "authority_crosscheck", "verdict": "flagged",
                    "sources": CROSSCHECK["sources"]}), poem_passage()])),
            "what a human is being asked")
    rejects("C/citation and unit count must agree (a dropped verse)",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(quran_ref={"surah": 25, "ayah_from": 63, "ayah_to": 70},
                               citation_ref="quran:25:63-70"),
                poem_passage()])),
            "missing or duplicated")
    # T6: «باب اللــوق» is printed with a justification kashida. store_form()
    # would silently drop it, which is exactly why the model requires the text
    # to ALREADY be in normal form: a silent strip moves the checksum later.
    stretched = ["بابُ اللــوق مكان قديم", SACRED_UNITS[1]]
    rejects("C/tatweel in stored text is rejected (T6)",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(units=[{"n": i + 1, "printed_n": n, "text_ar": t}
                                      for i, (n, t) in enumerate(zip(["٦٣", "٦٤"], stretched))],
                               text_sha256=sha256_text(seal_text(stretched))),
                poem_passage()])),
            "STORE normal form")
    rejects("C/presentation forms in stored text are rejected",
            lambda: SeedBundle.model_validate(bundle(vocab_items=[
                {"lesson": "ara1-1", "word_ar": "ﻻ", "gloss_ar": "كلمة", "source_page": 9}])),
            "presentation form")
    rejects("C/poetry needs both hemistichs (T3)",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(),
                poem_passage(units=[{"n": 1, "text_ar": "أيهذا الشاكي وما بك داء"}],
                             text_sha256=sha256_text(seal_text(["أيهذا الشاكي وما بك داء"])),
                             approved_sha256=sha256_text(
                                 seal_text(["أيهذا الشاكي وما بك داء"])))])),
            "صدر")
    # The قاسم أمين case (sensitive-content §0, printed p.25): an honorific
    # ligature inside another author's prose. Placeholder text, no hadith typed.
    honorific = ["هنا يوضع النص النثري المحقق الذي يرد فيه ﷺ داخل كلام المؤلف"]
    prose = {
        "id": "t:ara2-1:001", "lesson": "ara2-1", "kind": "prose", "fidelity": "prose",
        "sensitivity_class": "religious_reference", "title_ar": "رحمة ومحبة",
        "attribution_ar": "قاسم أمين",
        "units": [{"n": 1, "text_ar": honorific[0]}],
        "text_sha256": sha256_text(seal_text(honorific)),
        "capture_lane": "double_blind", "transcribers": ["m1", "m2", "m3"],
        "source_page": 25,
    }
    pb = SeedBundle.model_validate(bundle(
        text_passages=[sacred_passage(), poem_passage(), prose]))
    ok("C/a prose passage carrying ﷺ seals unchanged (the قاسم أمين case)",
       pb.text_passages[2].units[0].text_ar == honorific[0]
       and "ﷺ" in pb.text_passages[2].store_text)

    rejects("C/an إملاء table that lost a row is rejected",
            lambda: SeedBundle.model_validate(bundle(spelling_rules=[{
                "id": "sp:hamza-mid-waw", "label_ar": "x", "lesson": "ara1-1",
                "printed_case_count": 5,
                "cases": [{"id": "spc:1", "condition_ar": "أ", "written_as_ar": "ب",
                           "source_page": 12}]}])),
            "the page prints")


def check_typed_answers() -> None:
    q = bundle()["questions"][0]
    rejects("D/إعراب answer as a bare string is rejected",
            lambda: SeedBundle.model_validate(bundle(questions=[
                q | {"answer": "منادى مضاف منصوب وعلامة نصبه الياء"}])),
            "TYPED RECORDS")
    rejects("D/إعراب slots must cohere (مبني needs its محل)",
            lambda: SeedBundle.model_validate(bundle(questions=[
                q | {"answer": IRAB | {"state": "مبني", "sign": "الضم", "sign_kind": "—"}}])),
            "محل")
    rejects("D/rule_ref must resolve to a printed clause",
            lambda: SeedBundle.model_validate(bundle(questions=[
                q | {"answer": IRAB | {"rule_ref": "gc:munada:invented"}}])),
            "no clause printed in this book")
    rejects("D/an Arabic question needs an explicit sensitivity_class",
            lambda: SeedBundle.model_validate(bundle(questions=[
                {k: v for k, v in q.items() if k != "sensitivity_class"}])),
            "sensitivity_class")
    rejects("D/an mcq may not carry a typed answer record",
            lambda: SeedBundle.model_validate(bundle(questions=[
                q | {"type": "mcq", "choices": [{"key": "a", "text": "أ"},
                                                {"key": "b", "text": "ب"}]}])),
            "string answer key")
    ok("D/valid إعراب answer keeps its slots",
       SeedBundle.model_validate(bundle()).questions[0].answer.sign == "الياء")


def check_bundle_integrity() -> None:
    rejects("E/a rhetoric شاهد must be character-exact in the passage",
            lambda: SeedBundle.model_validate(bundle(rhetoric_notes=[
                bundle()["rhetoric_notes"][0] | {"expression_ar": "أيها الشاكي"}])),
            "character-exact")
    rejects("E/a question on sacred text inherits its class",
            lambda: SeedBundle.model_validate(bundle(questions=[
                bundle()["questions"][0] | {"passage_ref": "t:ara1-1:001",
                                            "sensitivity_class": "secular"}])),
            "inherits")
    rejects("E/a sacred question may never be a variant (S1 mirror)",
            lambda: SeedBundle.model_validate(bundle(questions=[
                bundle()["questions"][0] | {"sensitivity_class": "quran",
                                            "variant_of": "q:ara1-1:000"}])),
            "never be a variant")
    rejects("E/the detector escalates an unclassified sacred stem",
            lambda: SeedBundle.model_validate(bundle(questions=[
                bundle()["questions"][0] | {"stem": "استخرج من الآية الكريمة كلمة",
                                            "sensitivity_class": "secular"}])),
            "detector fired")
    ok("E/a human review clears that escalation",
       SeedBundle.model_validate(bundle(questions=[
           bundle()["questions"][0] | {"stem": "استخرج من الآية الكريمة كلمة",
                                       "sensitivity_class": "secular",
                                       "sensitivity_reviewed_by": "teacher:demo"}])) is not None)


def check_guards() -> None:
    b = SeedBundle.model_validate(bundle())
    seed_q = b.questions[0]
    sacred_q = seed_q.model_copy(update={"sensitivity_class": "quran"})

    rejects("F/variant engine refuses sacred class",
            lambda: assert_variable(sacred_q), "refusing to vary")
    rejects("F/variant engine refuses a passage-bound question",
            lambda: assert_variable(seed_q.model_copy(update={"passage_ref": "t:ara1-1:001"}),
                                    b.text_passages), "sacred passage")
    rejects("F/variant engine refuses a stem that quotes a sealed passage",
            lambda: assert_variable(
                seed_q.model_copy(update={"stem": "اشرح: أيهذا الشاكي وما بك داء"}),
                b.text_passages), "consecutive words")
    rejects("F/variant engine refuses on sacred markers alone",
            lambda: assert_variable(seed_q.model_copy(
                update={"stem": "اذكر معنى الكلمة في الآية", "sensitivity_reviewed_by": "x"})),
            "markers")
    try:
        assert_variable(b.questions[0].model_copy(update={"stem": "أعرب: يا طالبي العلم"}), [])
        ok("F/an ordinary question is still variable", True)
    except VariantRefused as e:
        ok("F/an ordinary question is still variable", False, e.reason)

    paths = [Path("selfcheck-fixture.json")]
    rejects("F/loader hard-refuses --approve-all on sacred content",
            lambda: load_seed.sacred_gate(paths, [b], True), "REFUSING --approve-all")
    held = load_seed.sacred_gate(paths, [b], False)
    ok("F/loader holds sacred-derived questions at review",
       held == set(), "no sacred-derived question in the base fixture")
    b_sacred = SeedBundle.model_validate(bundle(questions=[
        bundle()["questions"][0] | {"passage_ref": "t:ara1-1:001",
                                    "sensitivity_class": "quran"}]))
    held = load_seed.sacred_gate(paths, [b_sacred], False)
    ok("F/a verified sacred question is STILL held at review",
       held == {"q:ara1-1:001"} and b_sacred.questions[0].verified is True)
    ok("F/shipped bundles are untouched by the gate",
       load_seed.sacred_gate(
           [HERE / "seed" / "social-t1.json"],
           [SeedBundle.model_validate_json((HERE / "seed" / "social-t1.json").read_text())],
           True) == set())


# =============================================================================
# G. The real cross-verified passage (read-only; never modified by this script)
# =============================================================================
def check_real_reference_passage() -> None:
    """Run the contract against the actual Wave-1 passage.

    `verify/ref-quran-25-63-70.json` is the output of the validated cross-check
    lane (سورة الفرقان ٦٣–٧٠, two independent authorities agreeing 8/8). It is
    the only real scripture in the repo and this script only ever READS it.

    This group caught a live defect: NORMALIZER_VERSION v1 stripped all tatweel
    per verification §1.3 rule 2, and this passage carries 11 tatweels that are
    all diacritic carriers — v1 would have silently modified scripture and then
    sealed the modified bytes.
    """
    ref = HERE / "verify" / "ref-quran-25-63-70.json"
    if not ref.exists():
        print("  skip  G/ — no verified reference passage in verify/")
        return
    verses = json.loads(ref.read_text())
    ok("G/reference passage has all 8 آيات", len(verses) == 8, str(len(verses)))

    import unicodedata
    texts = [v["text"] for v in verses]
    ok("G/STORE modifies the authority text by NOTHING except NFC",
       all(store_form(t) == unicodedata.normalize("NFC", t) for t in texts))
    ok("G/STORE is idempotent on it (so the seal cannot move later)",
       all(store_form(store_form(t)) == store_form(t) for t in texts))
    ok("G/every tatweel in it is a diacritic carrier and survives STORE",
       sum(store_form(t).count("ـ") for t in texts) == 11,
       f"{sum(store_form(t).count(chr(0x640)) for t in texts)} of 11 kept")
    with_ann = next(t for t in texts if any(0x06D6 <= ord(c) <= 0x06ED for c in t))
    without = "".join(c for c in with_ann if not 0x06D6 <= ord(c) <= 0x06ED)
    ok("G/STORE keeps the tajweed annotation block", store_form(with_ann) != store_form(without))
    ok("G/VERIFY absorbs it — the 6-of-8 false mismatch does not recur",
       compare_verify(with_ann) == compare_verify(without))

    # The whole point: the real passage validates against the real contract.
    units = [store_form(t) for t in texts]
    ar_digits = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
    passage = sacred_passage(
        attribution_ar="سورة الفرقان (٦٣ – ٧٠)",
        quran_ref={"surah": 25, "ayah_from": 63, "ayah_to": 70},
        citation_ref="quran:25:63-70",
        units=[{"n": i + 1, "printed_n": str(63 + i).translate(ar_digits), "text_ar": t}
               for i, t in enumerate(units)],
        text_sha256=sha256_text(seal_text(units)))
    try:
        b = SeedBundle.model_validate(bundle(text_passages=[passage, poem_passage()]))
        ok("G/the real سورة الفرقان ٦٣–٧٠ passage validates end-to-end", True)
        ok("G/…and the loader holds it out of live regardless of flags",
           load_seed.sacred_gate([Path("ref.json")], [b], False) == set()
           and b.text_passages[0].is_sacred and not b.text_passages[0].approval_valid)
    except Exception as e:                      # noqa: BLE001
        ok("G/the real سورة الفرقان ٦٣–٧٠ passage validates end-to-end", False, str(e)[:200])


def main() -> int:
    check_shipped_bundles()
    check_normal_forms()
    check_the_seal()
    check_typed_answers()
    check_bundle_integrity()
    check_real_reference_passage()
    check_guards()
    for line in PASSED:
        print(f"  ok    {line}")
    for line in FAILED:
        print(f"  FAIL  {line}")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

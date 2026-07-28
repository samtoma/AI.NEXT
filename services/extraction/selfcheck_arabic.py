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
where the corpus text goes". That is not squeamishness: the schema cannot tell
scripture from a placeholder, and it is not supposed to — character-exactness is
a property of the pinned corpus and the human sign-off, not of this file. Never
type a verse into a test fixture.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from arabic_text import ArabicTextError, compare_loose, seal_text, sha256_text, store_form
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
    except Exception as e:                      # noqa: BLE001 — any loud failure counts
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
    rejects("B/STORE rejects presentation forms", lambda: store_form("ﻻ"), "presentation form")
    rejects("B/STORE rejects Farsi yeh", lambda: store_form("کتاب"), "U+06A9")
    rejects("B/STORE rejects extended Arabic-Indic digits", lambda: store_form("۱۲"), "U+06F1")
    rejects("B/STORE rejects ZWJ", lambda: store_form("ا‍ب"), "ZWJ")


# =============================================================================
# C-F. Fixtures — a minimal but VALID Arabic bundle, then one mutation each
# =============================================================================
SACRED_UNITS = [
    # Placeholder, not scripture — see the module docstring.
    "هنا يوضع النص المنقول من المصحف المرجعي المثبت",
    "وهنا يوضع النص التالي من المصحف المرجعي المثبت",
]
POEM_UNITS = [("أيهذا الشاكي وما بك داء", "كيف تغدو إذا غدوت عليلا")]


def sacred_passage(**over) -> dict:
    d = {
        "id": "t:ara1-1:001", "lesson": "ara1-1", "kind": "quran", "fidelity": "sacred",
        "sensitivity_class": "quran", "title_ar": "عباد الرحمن",
        "attribution_ar": "سورة الفرقان (٦٣ – ٦٤)",
        "quran_ref": {"surah": 25, "ayah_from": 63, "ayah_to": 64},
        "corpus_ref": "quran:25:63-64",
        "units": [{"n": i + 1, "printed_n": n, "text_ar": t}
                  for i, (n, t) in enumerate(zip(["٦٣", "٦٤"], SACRED_UNITS))],
        "text_sha256": sha256_text(seal_text(SACRED_UNITS)),
        "capture_lane": "corpus", "source_page": 8,
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
                sacred_passage(quran_ref=None, corpus_ref=None), poem_passage()])),
            "quran_ref")
    rejects("C/sacred passage may not be transcribed",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(capture_lane="double_blind"), poem_passage()])),
            "NEVER transcribed")
    rejects("C/citation and unit count must agree",
            lambda: SeedBundle.model_validate(bundle(text_passages=[
                sacred_passage(quran_ref={"surah": 25, "ayah_from": 63, "ayah_to": 70}),
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


def main() -> int:
    check_shipped_bundles()
    check_normal_forms()
    check_the_seal()
    check_typed_answers()
    check_bundle_integrity()
    check_guards()
    for line in PASSED:
        print(f"  ok    {line}")
    for line in FAILED:
        print(f"  FAIL  {line}")
    print(f"\n{len(PASSED)} passed, {len(FAILED)} failed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())

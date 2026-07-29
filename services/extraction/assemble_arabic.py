#!/usr/bin/env python3
"""Arabic bundle assembler (ADR-0006): workflow output → validated SeedBundle.

    uv run assemble_arabic.py runbook/<run-output>.json [--out seed/arabic-t1.json]

Consumes the `arabic-lesson.workflow.js` conveyor output and produces:
  - seed/arabic-t1.json         — a SeedBundle (validated here, again by the loader)
  - seed/content/<slug>.json    — the read-surface content file per lesson

THE SACRED LANE LIVES HERE (amended ADR-0006 §2). The workflow's transcript is
EVIDENCE, never the stored text. For every Quran passage this assembler:
  1. takes the citation the vision model reported (verified integers),
  2. fetches that verse range RAW — urllib, no model in the loop — from two
     independent authorities (api.quran.com, api.alquran.cloud),
  3. diffs authority-vs-authority and transcript-vs-authority under
     COMPARE-VERIFY (annotation block U+06D6–U+06ED dropped; letters, harakat,
     dagger alef and hamza marks kept),
  4. stores the canonical Uthmani (quran.com edition) in STORE form, sealed
     with text_sha256,
  5. on ANY disagreement (including a failed fetch): verdict=flagged with the
     reason — a human decides. Never silently pick a source, never block the
     rest of the lesson.

The sealed local reference (verify/ref-quran-*.json) is used as a third,
offline check when its citation matches — and as the failure-mode witness if
the network is down (still recorded as flagged, because a cross-check that
didn't happen is not a cross-check).

Non-scripture passages (dictation, later poetry/prose) are stored from the
book transcript in STORE form under the double_blind lane. NOTE: the conveyor
currently captures K=1, not the contract's K=2/3 — recorded per passage in
`transcribers`; the K gap is a known conveyor debt before full-book scale-up.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from arabic_text import (
    compare_loose,
    compare_verify,
    seal_text,
    sha256_text,
    scan_sacred_markers,
    store_form,
)
from schemas import SeedBundle

HERE = Path(__file__).parent

# --- the two independent authorities (selfcheck_arabic.py pins the same) -----
AUTHORITIES = {
    "api.quran.com/v4 · quran/verses/uthmani":
        "https://api.quran.com/api/v4/quran/verses/uthmani?chapter_number={surah}",
    "api.alquran.cloud/v1 · quran-uthmani":
        "https://api.alquran.cloud/v1/surah/{surah}/quran-uthmani",
}

ARABIC_INDIC = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")


def _fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "ainext-extraction/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fetch_authority(name: str, surah: int, a_from: int, a_to: int) -> list[str]:
    """Raw verse texts for surah:a_from-a_to from one authority. No model."""
    url = AUTHORITIES[name].format(surah=surah)
    data = _fetch_json(url)
    if "quran.com" in name:
        verses = {v["verse_key"]: v["text_uthmani"] for v in data["verses"]}
        return [verses[f"{surah}:{n}"] for n in range(a_from, a_to + 1)]
    ayahs = {a["numberInSurah"]: a["text"] for a in data["data"]["ayahs"]}
    return [ayahs[n] for n in range(a_from, a_to + 1)]


def local_reference(surah: int, a_from: int, a_to: int) -> list[str] | None:
    """The sealed offline reference, if one covers this exact citation."""
    p = HERE / "verify" / f"ref-quran-{surah}-{a_from}-{a_to}.json"
    if not p.exists():
        return None
    rows = json.loads(p.read_text())
    by_key = {r["key"]: r["text"] for r in rows}
    try:
        return [by_key[f"{surah}:{n}"] for n in range(a_from, a_to + 1)]
    except KeyError:
        return None


def crosscheck_quran(citation: str, transcript_units: list[str]) -> tuple[list[str], dict]:
    """The sacred lane. Returns (canonical unit texts, TextVerification dict).

    Canonical = quran.com's Uthmani in STORE form. Any disagreement between the
    authorities, or a transcript that does not carry the same text, or a fetch
    failure → verdict 'flagged' with the reason. Flag ≠ block (ADR-0006 §2).
    """
    m = re.fullmatch(r"(\d+):(\d+)-(\d+)", citation.strip())
    if not m:
        raise SystemExit(f"unparseable Quran citation {citation!r}")
    surah, a_from, a_to = int(m[1]), int(m[2]), int(m[3])
    n = a_to - a_from + 1

    fetched: dict[str, list[str] | None] = {}
    errors: dict[str, str] = {}
    for name in AUTHORITIES:
        try:
            fetched[name] = fetch_authority(name, surah, a_from, a_to)
        except Exception as e:  # a failed fetch is a FLAG, never a crash
            fetched[name] = None
            errors[name] = f"fetch failed: {e}"

    names = list(AUTHORITIES)
    a_units = fetched[names[0]]
    b_units = fetched[names[1]]
    ref_units = local_reference(surah, a_from, a_to)

    # canonical basis: quran.com, else alquran.cloud, else the sealed reference
    basis = a_units or b_units or ref_units
    if basis is None:
        raise SystemExit(
            f"quran {citation}: no authority reachable and no sealed local reference — "
            "cannot establish canonical text at all")
    canonical = [store_form(u) for u in basis]

    flag_reasons: list[str] = []
    sources = []
    for name in names:
        units = fetched[name]
        if units is None:
            sources.append({"name": name, "endpoint": AUTHORITIES[name].format(surah=surah),
                            "agrees": False, "differences": [errors[name]]})
            flag_reasons.append(f"{name}: {errors[name]}")
            continue
        diffs = [f"ayah {a_from + i}: differs under COMPARE-VERIFY"
                 for i in range(n)
                 if compare_verify(units[i]) != compare_verify(basis[i])]
        sources.append({
            "name": name,
            "endpoint": AUTHORITIES[name].format(surah=surah),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "agrees": not diffs,
            "differences": diffs,
        })
        if diffs:
            flag_reasons.append(f"{name}: {len(diffs)} verse(s) differ")

    if ref_units is not None:
        ref_diffs = [i for i in range(n)
                     if compare_verify(ref_units[i]) != compare_verify(basis[i])]
        if ref_diffs:
            flag_reasons.append(
                f"sealed local reference disagrees on {len(ref_diffs)} verse(s)")

    transcript_agrees: bool | None = None
    if transcript_units and len(transcript_units) == n:
        t_diffs = [a_from + i for i in range(n)
                   if compare_verify(transcript_units[i]) != compare_verify(canonical[i])]
        transcript_agrees = not t_diffs
        if t_diffs:
            flag_reasons.append(
                f"book transcript differs from the authorities on ayah(s) "
                f"{', '.join(map(str, t_diffs))} — imlā'ī drift or a misread page")
    elif transcript_units:
        transcript_agrees = False
        flag_reasons.append(
            f"transcript has {len(transcript_units)} unit(s) for {n} آيات")
    else:
        transcript_agrees = False
        flag_reasons.append("transcript arrived unstructured (no per-ayah units)")

    verification = {
        "method": "authority_crosscheck",
        "verdict": "flagged" if flag_reasons else "agree",
        "sources": sources,
        "transcript_agrees": transcript_agrees,
        "flag_reason": "; ".join(flag_reasons) or None,
    }
    return canonical, verification


# --- lesson id mapping -------------------------------------------------------
# Workflow ids are term-qualified (ar-t1u1l1). App slugs must match
# lesson.ts SLUG_RE (<alnum≤12>-<digits>), so units number CONTINUOUSLY across
# terms: T1 U1–3 → ara1..ara3, T2 U1–3 → ara4..ara6. No collisions, no regex
# violation, and lo:ara<unit>-<lesson>-<n> keeps the soc-style convention.
def slug_of(workflow_id: str) -> tuple[str, int, int]:
    """'ar-t1u1l1' → ('ara1-1', unit_no, lesson_no)."""
    m = re.fullmatch(r"ar-t(\d)u(\d)l(\d)", workflow_id)
    if not m:
        raise SystemExit(f"unrecognized workflow lesson id {workflow_id!r}")
    term, unit, lesson = int(m[1]), int(m[2]), int(m[3])
    unit_no = (term - 1) * 3 + unit
    return f"ara{unit_no}-{lesson}", unit_no, lesson


# --- the five assessable axes (ADR-0006 §4: 5 spine LOs per lesson) ----------
# The conveyor's questions carry lo_n 1..5 on exactly this scaffold. خط/تعبير/
# تلاوة objectives are NOT spine LOs: they go to the content file as
# out_of_scope, and the app states — in visible copy — that they aren't scored.
AXES = [
    ("فهم النص والاستماع", ["reading", "listening", "speaking"]),
    ("معاني المفردات", ["vocabulary"]),
    ("مواطن الجمال", ["rhetoric"]),
    (None, ["grammar"]),          # label = the lesson's grammar topic
    ("الإملاء", ["spelling"]),
]


def rhetoric_enum(raw_type: str, raw_effect: str) -> tuple[str | None, str | None]:
    """Map the conveyor's free-text نوع/غرض onto the closed enums (contract
    §4.6). Unmappable → (None, None): the note is dropped to the report, never
    force-fitted."""
    types = ["تشبيه", "استعارة", "كناية", "تضاد", "أسلوب مؤكد", "نداء", "استفهام",
             "أمر", "نهي", "تعبير يوحي", "أفعال مضارعة", "إطناب", "إيجاز", "حسن تعليل"]
    purposes = ["التنبيه", "الاستنكار", "النصح والإرشاد", "الدعاء", "التعجب", "التقرير",
                "التمني", "التحذير", "الاستمرار والتجدد", "التوكيد", "التعليل"]
    loose = compare_loose(raw_type)
    t = next((x for x in types if compare_loose(x) in loose), None)
    if t is None and "جميل" in raw_type:  # «تعبير جميل يدل على…» = تعبير يوحي
        t = "تعبير يوحي"
    effect_loose = compare_loose(raw_effect or "")
    p = next((x for x in purposes if compare_loose(x) in effect_loose), None)
    return t, p


def find_span(expression: str, units: list[str]) -> tuple[int, str] | None:
    """Locate a re-typed شاهد inside the sealed units under LOOSE comparison
    and return (unit_n, the CANONICAL character-exact slice). This is how an
    imlā'ī-typed expression is repaired INTO the sealed text instead of being
    stored as a paraphrase of it (verification §1.6)."""
    want = compare_loose(expression).split()
    if not want:
        return None
    for n, unit in enumerate(units, start=1):
        words = unit.split()
        loose_words = [compare_loose(w) for w in words]
        for i in range(len(words) - len(want) + 1):
            if [w for w in loose_words[i:i + len(want)]] == want:
                return n, " ".join(words[i:i + len(want)])
    return None


IRAB_STATES = {"مرفوع", "منصوب", "مجرور", "مجزوم", "مبني"}
IRAB_SIGNS = ["تنوين الفتح", "تنوين الضم", "تنوين الكسر", "حذف حرف العلة",
              "حذف النون", "الضمة", "الفتحة", "الكسرة", "الألف", "الواو",
              "الياء", "السكون", "الضم"]
SIGN_KINDS = ["نائبة عن الفتحة", "نائبة عن الضمة", "نائبة عن الكسرة", "مقدرة", "ظاهرة"]

STATE_NOUN = {"منصوب": "نصبه", "مرفوع": "رفعه", "مجرور": "جره", "مجزوم": "جزمه"}


def map_irab(q: dict, clause_ids: dict[str, str]) -> dict | None:
    """Conveyor irab_answer → IrabAnswer dict (typed slots, gc: rule refs).
    Returns None when a slot can't be mapped onto the closed enums — the
    question is then reported, not loaded with a guessed answer."""
    a = q.get("irab_answer") or {}
    word = store_form(q.get("target_word") or "")
    role = store_form(a.get("role") or "")
    state = (a.get("state") or "").strip()
    if not word or not role or state not in IRAB_STATES:
        return None
    sign = _base_sign((a.get("sign") or "").strip())
    raw_kind = (a.get("sign_kind") or "ظاهرة").strip()
    kind = next((k for k in SIGN_KINDS if raw_kind.startswith(k) or k in raw_kind), "ظاهرة")
    # «نائبة عن الفتحة؛ لأنه جمع مؤنث سالم» → kind + the لأنّ… reason
    reason = None
    if m := re.search(r"لأن.*$", raw_kind):
        reason = store_form(m.group(0))
    first_ref = re.split(r"[،,\s]+", (a.get("rule_ref") or "").strip())[0]
    rule_ref = clause_ids.get(first_ref)
    if sign is None or rule_ref is None:
        return None
    noun = STATE_NOUN.get(state, "إعرابه")
    kind_phrase = {"ظاهرة": "الظاهرة", "مقدرة": "المقدرة"}.get(kind, kind)
    surface = store_form(f"{role} {state} وعلامة {noun} {sign} {kind_phrase}"
                         + (f" {reason}" if reason else ""))
    out = {"word_ar": word, "role_ar": role, "state": state, "sign": sign,
           "sign_kind": kind, "rule_ref": rule_ref, "surface_ar": surface}
    if reason:
        out["reason_ar"] = reason
    return out


def lexical_field(stem: str) -> tuple[str, bool] | None:
    s = compare_loose(stem)
    if "مضاد" in s:
        return "مضاد", True          # never printed in this book → authored
    if "مرادف" in s or "معني" in s:
        return "معنى", False
    if "جمع" in s:
        return "جمع", False
    if "مفرد" in s:
        return "مفرد", False
    return None


def _base_sign(raw: str) -> str | None:
    """«الكسرة نيابة عن الفتحة» → «الكسرة»: the re-deriver folds the kind into
    the sign string, so the SIGN is the EARLIEST enum value in the string —
    matching by list order would pick الفتحة out of the نيابة clause."""
    hits = [(raw.find(s), -len(s), s) for s in IRAB_SIGNS if s in (raw or "")]
    return min(hits)[2] if hits else None


def rederive_agrees(q: dict, verdicts: dict[str, dict]) -> bool:
    """Blind re-derivation oracle: role/state/sign must all agree."""
    v = verdicts.get(q["id"], {}).get("my_irab")
    a = q.get("irab_answer")
    if not v or not a:
        return False
    return (compare_loose(v.get("role", "")) == compare_loose(a.get("role", ""))
            and v.get("state") == a.get("state")
            and _base_sign(v.get("sign", "")) is not None
            and _base_sign(v.get("sign", "")) == _base_sign(a.get("sign", "")))


def assemble_lesson(lesson: dict, report: list[str]) -> tuple[dict, dict]:
    """One conveyor lesson → (bundle fragment, content-file dict)."""
    meta = lesson["lesson"]
    slug, unit_no, _ = slug_of(meta["id"])
    module_id = f"module:ara-u{unit_no}"
    seg, text, art = lesson["segment"], lesson["text"], lesson["artefacts"]
    qs = lesson["questions"]["questions"]
    verdicts = {v["id"]: v for v in lesson["rederive"]["verdicts"]}

    # ---------------- passages ----------------
    passages: list[dict] = []
    passage_units: dict[str, list[str]] = {}
    sacred_ids: set[str] = set()
    for i, p in enumerate(text["passages"], start=1):
        pid = f"t:{slug}:{i:03d}"
        kind = p["kind"]
        page = int(p["printed_page"])
        if kind in ("quran", "hadith"):
            transcript = [u["text"] for u in (p.get("units") or [])]
            canonical, verification = crosscheck_quran(p["citation"], transcript)
            m = re.fullmatch(r"(\d+):(\d+)-(\d+)", p["citation"].strip())
            surah, a_from, a_to = int(m[1]), int(m[2]), int(m[3])
            units = [{"n": j + 1, "printed_n": str(a_from + j).translate(ARABIC_INDIC),
                      "text_ar": t} for j, t in enumerate(canonical)]
            passages.append({
                "id": pid, "lesson": slug, "kind": kind, "fidelity": "sacred",
                "sensitivity_class": kind,
                "title_ar": store_form(meta["title"]),
                "attribution_ar": store_form(p.get("attribution") or meta["src"]),
                "quran_ref": {"surah": surah, "ayah_from": a_from, "ayah_to": a_to},
                "citation_ref": f"quran:{surah}:{a_from}-{a_to}",
                "units": units,
                "text_sha256": sha256_text(seal_text([u["text_ar"] for u in units])),
                "capture_lane": "authority_verified",
                "transcribers": ["arabic-lesson.workflow:text (sonnet)"],
                "verification": verification,
                "source_page": page,
            })
            sacred_ids.add(pid)
            if verification["verdict"] == "flagged":
                report.append(f"FLAG {pid}: {verification['flag_reason']}")
            else:
                report.append(f"SEALED {pid}: authorities agree 2/2, transcript agrees, "
                              f"{len(units)} آيات")
        else:
            # non-sacred: the book transcript IS the text (K=1 debt noted above)
            if p.get("verses"):
                units = [{"n": v["n"], "printed_n": str(v["n"]).translate(ARABIC_INDIC),
                          "text_ar": store_form(f"{v['sadr']} {v['ajuz']}"),
                          "sadr_ar": store_form(v["sadr"]), "ajuz_ar": store_form(v["ajuz"])}
                         for v in p["verses"]]
            else:
                paras = [s.strip() for s in re.split(r"\n+", p["text"]) if s.strip()]
                # the printed title line becomes the card title, not unit 1
                if kind == "dictation" and len(paras) > 1 and len(paras[0]) <= 40:
                    paras = paras[1:]
                units = [{"n": j + 1, "text_ar": store_form(t)}
                         for j, t in enumerate(paras)]
            fidelity = "literary" if kind == "poetry" else "prose"
            # A readable title, never the pipeline id: dictation pieces open
            # with their printed title line; otherwise fall back by kind.
            kind_label = {"dictation": "قطعة الإملاء", "poetry": meta["title"],
                          "prose": meta["title"], "story": meta["title"]}
            first_line = (p.get("text") or "").strip().split("\n")[0].strip()
            title = (first_line if kind == "dictation" and 0 < len(first_line) <= 40
                     else kind_label.get(kind, meta["title"]))
            passages.append({
                "id": pid, "lesson": slug, "kind": kind, "fidelity": fidelity,
                "sensitivity_class": "secular",
                "title_ar": store_form(title),
                # attribution only when the page prints one — the lesson's
                # source line (سورة الفرقان…) must not leak onto other passages
                "attribution_ar": store_form(p.get("attribution")
                                             or ("قطعة إملائية" if kind == "dictation"
                                                 else meta["src"])),
                "units": units,
                "text_sha256": sha256_text(seal_text([u["text_ar"] for u in units])),
                "capture_lane": "double_blind",
                "transcribers": ["arabic-lesson.workflow:text (sonnet, K=1 — contract debt)"],
                "source_page": page,
            })
        passage_units[pid] = [u["text_ar"] for u in passages[-1]["units"]]

    main_pid = passages[0]["id"] if passages else None

    # ---------------- grammar rule ----------------
    gslug = f"munada" if "منادى" in art["grammar"]["topic"] else f"gr{unit_no}"
    topic_slug = re.sub(r"[^a-z0-9]+", "-", f"{slug}")
    rule_id = f"gr:{topic_slug}"
    clause_ids: dict[str, str] = {}
    clauses = []
    for r in art["grammar"]["rule_lines"]:
        cid = f"gc:{topic_slug}:{r['id'].lower()}"
        clause_ids[r["id"]] = cid
        txt = store_form(r["text"])
        kind = ("sign" if "علام" in txt or "يُنصَب" in txt or "ينصب" in compare_loose(txt)
                else "type" if re.match(r"^(أول|ثاني|ثالث)", txt)
                else "definition" if r["id"] == "R1" else "note")
        clauses.append({"id": cid, "text_ar": txt, "kind": kind,
                        "first_taught_lesson": slug, "source_page": int(r["printed_page"])})
    grammar_rules = [{
        "id": rule_id, "label_ar": store_form(art["grammar"]["topic"]),
        "unit": module_id, "taught_in": [slug], "clauses": clauses,
        "types_tree": {"types": art["grammar"].get("types") or []},
    }] if clauses else []

    # ---------------- spelling rule ----------------
    spelling_rules = []
    case_rows = (art.get("spelling") or {}).get("cases") or []
    sp_id = f"sp:{topic_slug}-hamza" if case_rows else None
    if case_rows:
        cases = []
        for j, c in enumerate(case_rows, start=1):
            cond = store_form(c["condition"])
            m = re.search(r"على\s+(واو|ألف|ياء|نبرة|السطر|سطر)", cond)
            written = store_form(f"على {m.group(1)}") if m else "—"
            cases.append({"id": f"sc:{topic_slug}:{j}", "condition_ar": cond,
                          "written_as_ar": written,
                          "examples_ar": [store_form(x) for x in c.get("examples", [])],
                          "source_page": passages[-1]["source_page"] if passages else 0})
        spelling_rules.append({
            "id": sp_id, "label_ar": store_form((art.get("spelling") or {}).get("topic")
                                                or "الإملاء"),
            "lesson": slug, "cases": cases, "printed_case_count": len(cases),
        })

    # ---------------- vocab ----------------
    vocab_items = []
    for v in art["vocab"]:
        vocab_items.append({k: val for k, val in {
            "lesson": slug,
            "word_ar": store_form(v["word"]),
            "gloss_ar": store_form(v["meaning"]),
            "plural_ar": store_form(v["plural"]) if v.get("plural") else None,
            "singular_ar": store_form(v["singular"]) if v.get("singular") else None,
            "antonym_ar": store_form(v["antonym"]) if v.get("antonym") else None,
            "authored": bool(v.get("authored")) or bool(v.get("antonym")),
            "passage_ref": main_pid,
            "source_page": passages[0]["source_page"] if passages else 0,
        }.items() if val is not None})

    # ---------------- rhetoric ----------------
    rhetoric_notes = []
    for j, r in enumerate(art["rhetoric"], start=1):
        t, purpose = rhetoric_enum(r["type"], r.get("effect") or "")
        if t is None:
            report.append(f"DROP rhetoric[{j}] «{r['expression'][:30]}…»: "
                          f"type {r['type']!r} not in the closed enum — human queue")
            continue
        located = find_span(r["expression"], passage_units.get(main_pid, []))
        note = {
            "id": f"rh:{slug}:{j}", "lesson": slug, "passage_ref": main_pid,
            "expression_ar": store_form(located[1] if located else r["expression"]),
            "type": t, "effect_ar": store_form(r["effect"]),
            "verbatim_from_book": True, "source_page": int(r["printed_page"]),
        }
        if located:
            note["unit_n"] = located[0]
        if purpose:
            note["purpose"] = purpose
        rhetoric_notes.append(note)

    # ---------------- LOs ----------------
    los = []
    objectives = seg["objectives"]

    def objective_text(skills: list[str]) -> str | None:
        hits = [o["text"] for o in objectives if o.get("skill") in skills
                and o.get("assessable")]
        return " · ".join(hits) if hits else None

    for n, (label, skills) in enumerate(AXES, start=1):
        lo_label = label or store_form(art["grammar"]["topic"])
        los.append({
            "id": f"lo:{slug}-{n}", "kind": "learning_objective",
            "label": lo_label,
            "description": objective_text(skills),
            "syllabus_ref": f"{slug} · {meta['title']}",
            "source_page": passages[0]["source_page"] if passages else None,
            "order_in_parent": n,
        })

    # ---------------- questions ----------------
    questions = []
    for q in qs:
        qid = f"q:{slug}:{q['id'].rsplit('-', 1)[-1]}"
        lo_n = min(max(int(q.get("lo_n") or 1), 1), 5)
        stem = q["stem"]
        page = int(q.get("source_page") or 0) or (passages[0]["source_page"] if passages else 0)
        base = {
            "id": qid, "lo": f"lo:{slug}-{lo_n}", "tier": q["tier"], "stem": stem,
            "source_page": page,
            "source_note": f"conveyor {meta['id']}"
                           + (f" · grounded in {q['grounded_in']}" if q.get("grounded_in") else ""),
        }
        # sacred inheritance is computed, never guessed: a stem that quotes the
        # آيات (detector) or extracts from the sacred passage is quran-class.
        sacred_stem = bool(scan_sacred_markers(stem)) and main_pid in sacred_ids
        sensitivity = "quran" if sacred_stem else "secular"
        wf_type = q["type"]
        try:
            if wf_type == "irab":
                answer = map_irab(q, clause_ids)
                if answer is None:
                    report.append(f"DROP {qid}: irab slots unmappable onto the enums")
                    continue
                verified = rederive_agrees(q, verdicts)
                sol = [f"القاعدة: {next((c['text_ar'] for c in clauses if c['id'] == answer['rule_ref']), '')}",
                       f"الإجابة: {answer['surface_ar']}"]
                questions.append(base | {
                    "type": "irab", "answer": answer, "solution": sol,
                    "verified": verified, "sensitivity_class": sensitivity})
            elif wf_type == "extract":
                target_pid = main_pid if sacred_stem or "الآيات" in stem or "النص" in stem else main_pid
                # locate the answer inside whichever passage carries it
                located = None
                for pid, units in passage_units.items():
                    if (hit := find_span(q.get("answer") or "", units)):
                        located, target_pid = hit, pid
                        break
                if not located:
                    report.append(f"DEMOTE {qid}: extract answer not locatable in any "
                                  "sealed passage — kept as short-answer")
                    questions.append(base | {
                        "type": "short", "answer": store_form(q.get("answer") or ""),
                        "solution": [store_form(q.get("answer") or "")],
                        "sensitivity_class": ("quran" if target_pid in sacred_ids
                                              else sensitivity),
                        "passage_ref": target_pid})
                    continue
                unit_n, exact = located
                unit_text = passage_units[target_pid][unit_n - 1]
                start = unit_text.index(exact)
                questions.append(base | {
                    "type": "extract",
                    "answer": {"primary": {"passage_ref": target_pid, "unit_n": unit_n,
                                            "start": start, "end": start + len(exact),
                                            "expected_ar": exact}},
                    "solution": [f"الموضع: {exact}"],
                    "sensitivity_class": ("quran" if target_pid in sacred_ids else sensitivity),
                    "passage_ref": target_pid})
            elif wf_type == "lexical":
                f = lexical_field(stem)
                if f is None:
                    questions.append(base | {
                        "type": "short", "answer": store_form(q.get("answer") or ""),
                        "solution": [store_form(q.get("answer") or "")],
                        "sensitivity_class": sensitivity})
                    continue
                field, authored = f
                accept = [store_form(x) for x in
                          [q.get("answer") or "", *(q.get("accepted") or [])] if x]
                questions.append(base | {
                    "type": "lexical",
                    "answer": {"field": field, "accept": accept, "authored": authored},
                    "solution": [f"{field}: {accept[0]}"],
                    "sensitivity_class": sensitivity})
            elif wf_type == "rhetoric_purpose":
                t, purpose = rhetoric_enum(q.get("answer") or "", q.get("answer") or "")
                if t is None:
                    questions.append(base | {
                        "type": "short", "answer": store_form(q.get("answer") or ""),
                        "solution": [store_form(q.get("answer") or "")],
                        "sensitivity_class": sensitivity})
                    continue
                ans = {"type": t}
                if purpose:
                    ans["purpose"] = purpose
                effect = re.sub(r"^[^؛;]*[؛;]\s*", "", q.get("answer") or "")
                if effect:
                    ans["effect_ar"] = store_form(effect)
                questions.append(base | {
                    "type": "rhetoric", "answer": ans,
                    "solution": [store_form(q.get("answer") or t)],
                    "sensitivity_class": sensitivity})
            elif wf_type == "spelling":
                grounded = compare_loose(q.get("grounded_in") or "")
                case = next((c for sp in spelling_rules for c in sp["cases"]
                             if compare_loose(c["condition_ar"]) in grounded
                             or grounded and compare_loose(c["condition_ar"])[:30] in grounded),
                            None)
                corrected = None
                if m := re.search(r"«([^»]+)»", q.get("answer") or ""):
                    corrected = m.group(1)
                if case and corrected:
                    questions.append(base | {
                        "type": "spelling_fix",
                        "answer": {"corrected_ar": store_form(corrected),
                                   "case_id": case["id"]},
                        "solution": [store_form(q.get("answer") or "")],
                        "sensitivity_class": sensitivity})
                else:
                    questions.append(base | {
                        "type": "short", "answer": store_form(q.get("answer") or ""),
                        "solution": [store_form(q.get("answer") or "")],
                        "sensitivity_class": sensitivity})
            elif wf_type == "mcq":
                raw = q.get("answer") or ""
                keys = {c["key"]: c for c in (q.get("choices") or [])}
                key = next((k for k in keys if raw.startswith(k) or f"({k})" in raw[:6]
                            or raw.strip() == k), None)
                if key is None:  # answer written as the choice text
                    key = next((k for k, c in keys.items()
                                if compare_loose(c["text"]) in compare_loose(raw)), None)
                if key is None or len(keys) < 2:
                    report.append(f"DROP {qid}: mcq answer key unresolvable")
                    continue
                questions.append(base | {
                    "type": "mcq",
                    "choices": [{"key": c["key"], "text": c["text"]}
                                for c in q["choices"]],
                    "answer": key, "solution": [store_form(keys[key]["text"])],
                    "sensitivity_class": sensitivity})
            else:  # short / explain
                questions.append(base | {
                    "type": "short", "answer": store_form(q.get("answer") or ""),
                    "solution": [store_form(q.get("answer") or "")],
                    "sensitivity_class": sensitivity})
        except Exception as e:
            report.append(f"DROP {qid}: {e}")

    # every question about a sacred passage carries the passage_ref so the
    # loader's derived-sealing check sees the binding
    for qq in questions:
        if qq["sensitivity_class"] == "quran" and "passage_ref" not in qq and main_pid:
            qq["passage_ref"] = main_pid

    # ---------------- nodes / edges ----------------
    unit_label = f"الوحدة {['الأولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة'][unit_no-1]}"
    nodes = [
        {"id": module_id, "kind": "module", "label": f"{unit_label} — اللغة العربية",
         "order_in_parent": unit_no},
        *los,
    ]
    edges = [{"src": module_id, "dst": "course:prep3-arabic-ar", "type": "part_of"},
             *({"src": module_id, "dst": lo["id"], "type": "teaches"} for lo in los)]

    # ---------------- content file (the read surface + visible honesty) ------
    out_of_scope = [
        {"text": o["text"], "skill": o.get("skill"),
         "reason": "لا تُقيَّم هذه المهارة في المنصة حاليًا — نعرضها كما هي في الكتاب ولا نمنحها درجة."}
        for o in objectives if not o.get("assessable")
    ]
    content = {
        "lessonId": slug,
        "title": meta["title"],
        "tamheed": seg.get("tamheed") or "",
        "qadaya": [q_["text"] for q_ in (seg.get("qadaya") or [])],
        "out_of_scope": out_of_scope,
        "subtopics": [{"key": "exposition", "title": meta["title"],
                       "exposition": art.get("exposition") or ""}],
        "key_terms": [{"term_ar": v["word_ar"], "definition_ar": v["gloss_ar"]}
                      for v in vocab_items],
        "enrichment": [], "misconceptions": [],
        "interactives": [
            {"lo": f"lo:{slug}-{ {'extract_spans':3,'style_purpose':3,'irab_builder':4,'hamza_seat':5,'term_match':2}.get(i['kind'], 1) }",
             "kind": i["kind"], "prompt_ar": i["prompt_ar"], "spec": i["spec"]}
            for i in lesson["interactives"]["interactives"]
        ],
        "passages": [
            {"id": p["id"], "kind": p["kind"], "title_ar": p["title_ar"],
             "attribution_ar": p["attribution_ar"],
             "citation_ref": p.get("citation_ref"),
             "sacred": p["id"] in sacred_ids,
             "verification_verdict": (p.get("verification") or {}).get("verdict"),
             "units": [{"n": u["n"], "printed_n": u.get("printed_n"),
                        "text_ar": u["text_ar"]} for u in p["units"]]}
            for p in passages
        ],
    }

    fragment = {
        "nodes": nodes, "edges": edges, "questions": questions,
        "text_passages": passages, "vocab_items": vocab_items,
        "rhetoric_notes": rhetoric_notes, "grammar_rules": grammar_rules,
        "spelling_rules": spelling_rules,
    }
    return fragment, content


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run_output", type=Path)
    ap.add_argument("--out", type=Path, default=HERE / "seed" / "arabic-t1.json")
    args = ap.parse_args()

    run = json.loads(args.run_output.read_text())
    report: list[str] = []

    bundle: dict = {
        "source_document": {
            "title": "اللغة العربية — لغتي حياتي، الصف الثالث الإعدادي",
            "publisher": "وزارة التربية والتعليم والتعليم الفني — جمهورية مصر العربية",
            "language": "ar", "grade": "prep-3", "subject": "arabic language",
            "file_path": "docs/Source/Arabic_Prp3_Tr1_2.pdf",
        },
        "extraction_run": {
            "extractor": "arabic-lesson workflow (ADR-0006 conveyor) + assemble_arabic",
            "extractor_version": "conveyor-1", "schema_version": "ara-1",
        },
        "syllabus_version": "2025-2026",
        "nodes": [{"id": "course:prep3-arabic-ar", "kind": "course",
                   "label": "اللغة العربية — الصف الثالث الإعدادي",
                   "order_in_parent": 3}],
        "edges": [], "questions": [], "visuals": [],
        "text_passages": [], "vocab_items": [], "rhetoric_notes": [],
        "grammar_rules": [], "spelling_rules": [],
    }

    content_dir = HERE / "seed" / "content"
    for lesson in run["lessons"]:
        frag, content = assemble_lesson(lesson, report)
        for key in ("nodes", "edges", "questions", "text_passages", "vocab_items",
                    "rhetoric_notes", "grammar_rules", "spelling_rules"):
            bundle[key].extend(frag[key])
        cpath = content_dir / f"{content['lessonId']}.json"
        cpath.write_text(json.dumps(content, ensure_ascii=False, indent=1))
        report.append(f"content → {cpath.relative_to(HERE)}")

    validated = SeedBundle.model_validate(bundle)  # loud, before anything is written
    args.out.write_text(json.dumps(bundle, ensure_ascii=False, indent=1))

    n_sacred = sum(tp.is_sacred for tp in validated.text_passages)
    n_flagged = sum(tp.verification_flagged for tp in validated.text_passages)
    try:
        shown = args.out.relative_to(HERE)
    except ValueError:
        shown = args.out
    print(f"\nbundle → {shown}")
    print(f"  {len(validated.nodes)} nodes · {len(validated.questions)} questions · "
          f"{len(validated.text_passages)} passages ({n_sacred} sacred, {n_flagged} flagged) · "
          f"{len(validated.vocab_items)} vocab · {len(validated.rhetoric_notes)} rhetoric · "
          f"{sum(len(g.clauses) for g in validated.grammar_rules)} rule clauses · "
          f"{sum(len(s.cases) for s in validated.spelling_rules)} إملاء cases")
    print("\n".join(f"  {line}" for line in report))
    verified = sum(q.verified for q in validated.questions)
    print(f"  verified questions (blind re-derivation agreed): {verified}/{len(validated.questions)}")


if __name__ == "__main__":
    main()

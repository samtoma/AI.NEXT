"""S8 Coverage audit: the integer equalities (extraction-pipeline.md §3.11, B14).

    uv run coverage_report.py --book g10-math                  # the whole book
    uv run coverage_report.py --book g10-math --chapter 8      # the pilot chapter
    uv run coverage_report.py --book g10-math --check          # print, write nothing

Exit code: 0 GREEN, 1 RED, 2 could not read an input.

WHAT IT READS (defaults from the book config; every one can be overridden):
    manifest        the S0 manifest with G0 applied
    objectives      objectives/<book>/<slug>.json      (S1 after G1)
    runs            runs/<book>/lesson/<slug>.json     (S2–S4 after G2)
    seed            seed/<book>/*.json                 (the assembled bundles, S9)
    content         seed/content/<slug>.json           (the lesson-content files, S9; default the
                                                        bundles' sibling content/)
    generated       seed/generated/<book>/             (the reviewed exports, B15)
    maths           runs/<book>/maths/summary.json     (S0b counts)
    s5              runs/<book>/misconceptions/*.json  (S5 final runs; drafts are skipped)
    widget gaps     coverage/<book>.widget-gaps.json   (S7)
It trusts none of them to report on itself: every count is recomputed from the rows.

WHAT IT WRITES: coverage/<book>.json — every check, its two sides, and each failure with the
scope it failed in (a lesson, a chapter, an objective or the book). The file is
deterministic: no timestamps, so an unchanged book re-audits byte-identically.

GREEN means every equality holds, or every failure is covered by a SIGNED exception. A human
signs one by adding it to the `exceptions` list of the coverage file:
    {"check": "tier_floor", "scope": "lo:g10m8s3-2-2", "reason": "…",
     "signed_by": "Samuel", "signed_at": "2026-09-30"}
`scope` is the failure's scope as the report prints it, or "*" for every scope of that check.
A re-run keeps the list. An exception without `signed_by` is listed and ignored. A RED audit
blocks assembly unless its exceptions are signed (§3.11).

THE CHECKS (§3.11, one per row, plus two the brief adds):
    pages                   body pages = pages assigned to lessons + pages excluded with a reason
    worked_examples         manifest worked examples = worked-example items accounted for
    items_mapped_once       exercise items (end-of-chapter included) = items mapped to exactly one
                            objective; unmapped = 0. The one exception is answer 15 (b), Samuel,
                            2026-09-26: an end-of-chapter item G1 ruled "outside this chapter's
                            objectives" (objectives/<slug>.json `outside_items`, with a reason) is a
                            failure of scope "item <ref>" EXCEPTED by that verdict, signed with the G1
                            approver's name and date (`g1_exceptions` in the report). It is kept out of
                            practice, never dropped silently, and an unapproved ruling excepts nothing.
    mapped_items_accounted  mapped items = book questions + items excluded with a reason
    objective_evidence      objectives = objectives with a claim, a book question, and worked-
                            example-or-exercise evidence of two kinds or more
    tier_floor              objectives × 3 tiers = cells with a live item, book or generated (FR-4305)
    module_widgets          modules = modules with a widget question + signed CHAPTER-scope widget gaps
                            (FR-4306). A lesson-scope gap records an accepted missing kind; signing
                            one never covers a chapter.
    distractor_refutations  tagged distractors and predicates = those whose misconception has a
                            refutation (FR-1112)
    misconception_refutations  catalogue entries = entries with a refutation
    s5_catalogue            entries S5 kept (`totals.entries`) = those in the catalogue; none of
                            `records[].dropped[]` is in it (the verifier is fail-closed)
    figures                 manifest figures = visuals + viz gaps with a reason
    maths_images            images to transcribe = by hash + by agreement + by the third reading +
                            resolved at G0b; unresolved 0. Teacher-only images no rule accepted are
                            never transcribed (FR-4408) and are not in the count. With --chapter,
                            only the images the chapter's blocks use (S0b's `by_chapter`).
    items_typed_once        exercise items = numeric + choice + expression + not_markable
    solution_sources        book questions = book_worked + book_worked_epub + teachers_guide
                            (+ answer_anchored, expected 0 where the EPUB carries solutions)
    lesson_provenance       lessons = lessons carrying book provenance; parts consecutive, 1..m
    teacher_only            teacher-only blocks = blocks dropped at S2; reaching a claim = 0
    notation                un-normalised decimal commas and `(x; y)` left in any bundle = 0
                            (decision 15); the items the book printed that way are counted too
    claims_served           the bundles' claims = the claims in the lessons' content files, lesson
                            by lesson (S2's claims are served from seed/content/<slug>.json)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import book_config
from assemble_lesson_bundle import (LessonRun, ObjectivesFile, book_lesson, check_lessons,
                                    manifest_lessons, normalise, residual_notation)
from schemas import Lesson

HERE = Path(__file__).resolve().parent
TIERS = ("basic", "standard", "advanced")
COVERAGE_VERSION = 1


def _pages(rng) -> set[int]:
    return set(range(rng[0], rng[1] + 1)) if rng else set()


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from _strings(x)


MATHS_ROUTES = ("accepted_by_hash", "accepted_by_agreement", "accepted_by_third_reading", "resolved_at_g0b")


def maths_scopes(maths: dict, chapters: set[int] | None) -> list[tuple[str, dict | None]]:
    """S0b's counts for the audit's scope: the whole book, or each audited chapter."""
    if chapters is None or "by_chapter" not in maths:
        # a summary from before the per-chapter counts: the book-level count is what there is
        return [("book", maths)]
    by = maths.get("by_chapter") or {}
    return [(f"chapter {ch}", by.get(str(ch))) for ch in sorted(chapters)]


def item_refs(ex: dict) -> tuple[list[str], bool]:
    """An exercise set's item references, and whether they had to be derived.

    B3's manifest lists them (`item_refs`); the scouting draft only counts items per
    question, so the refs are rebuilt as `Ex<label>:<q>` or `Ex<label>:<q><a,b,…>`.
    """
    if ex.get("item_refs"):
        return list(ex["item_refs"]), False
    refs = []
    for q, k in enumerate(ex.get("items_per_question") or [], start=1):
        refs += [f"Ex{ex['label']}:{q}"] if k == 1 else [
            f"Ex{ex['label']}:{q}{chr(ord('a') + i)}" for i in range(k)]
    return refs, True


class Check:
    def __init__(self, cid: str, title: str) -> None:
        self.id, self.title = cid, title
        self.want = self.got = 0
        self.failures: list[dict] = []
        self.notes: list[str] = []

    def fail(self, scope: str, detail: str) -> None:
        self.failures.append({"scope": scope, "detail": detail})

    def as_dict(self, exceptions: list[dict]) -> dict:
        signed = [e for e in exceptions if e.get("check") == self.id and e.get("signed_by")]
        excepted = [f for f in self.failures
                    if any(e.get("scope") in ("*", f["scope"]) for e in signed)]
        state = ("holds" if not self.failures else
                 "excepted" if len(excepted) == len(self.failures) else "fails")
        return {"id": self.id, "title": self.title, "want": self.want, "got": self.got,
                "state": state, "failures": self.failures,
                "excepted_scopes": sorted({f["scope"] for f in excepted}),
                **({"notes": self.notes} if self.notes else {})}


def audit(book, manifest: dict, objectives: dict[str, ObjectivesFile], runs: dict[str, LessonRun],
          bundles: list[dict], generated: dict, maths: dict | None, widget_gaps: dict | None,
          chapters: set[int] | None, s5_runs: list[dict] | None = None,
          content: dict[str, dict] | None = None) -> tuple[list[Check], dict]:
    pairs = [(m, l) for m, l in manifest_lessons(manifest)
             if chapters is None or m["chapter"] in chapters]
    modules = {m["id"]: m for m, _ in pairs}
    lessons = [(m, l) for m, l in pairs]
    slugs = [l["id"] for _, l in lessons]
    lesson_of_lo: dict[str, str] = {}
    all_los: list[str] = []
    for s in slugs:
        for o in (objectives[s].objectives if s in objectives else []):
            lesson_of_lo[o.id] = s
            all_los.append(o.id)
    module_of_lesson = {l["id"]: m["id"] for m, l in lessons}

    questions = [q for b in bundles for q in b.get("questions", [])]
    visuals = [v for b in bundles for v in b.get("visuals", [])]
    b_lessons = [lsn for b in bundles for lsn in b.get("lessons", [])]
    gen_q = [q for key in ("generated-questions", "widget-questions")
             for q in (generated.get(key) or {}).get("questions", [])]
    catalogue = (generated.get("misconceptions") or {}).get("misconceptions", [])
    run_items = {(s, it.ref): it for s in slugs if s in runs for it in runs[s].items}
    checks: list[Check] = []
    g1_exceptions: list[dict] = []

    # ---- pages -------------------------------------------------------------
    c = Check("pages", "Body pages = pages assigned to lessons + pages excluded with a reason")
    for mid, m in modules.items():
        body = _pages(m.get("printed_pages"))
        assigned = set().union(*[_pages(l.get("printed_pages")) for mm, l in lessons if mm is m])
        excluded = set()
        for x in m.get("excluded_pages") or []:
            if x.get("reason"):
                excluded |= _pages(x["pages"])
        for key in ("introduction", "chapter_summary", "end_of_chapter_exercise"):
            part = m.get(key)
            if part and not any(l.get("chapter_intro") and l.get("sections", [{}])[0].get("number")
                                == part.get("section") for _, l in lessons):
                excluded |= _pages(part.get("printed_pages"))
        covered = (assigned | excluded) & body
        c.want += len(body)
        c.got += len(covered)
        if missing := sorted(body - covered):
            c.fail(mid, f"{len(missing)} body page(s) neither in a lesson nor excluded with a "
                        f"reason: {missing[:12]}")
    checks.append(c)

    # ---- worked examples ----------------------------------------------------
    c = Check("worked_examples", "Manifest worked examples = worked-example items accounted for")
    for m, l in lessons:
        want = {f"WE{w['n']}" for w in l.get("worked_examples") or []}
        got = {ref for (s, ref), it in run_items.items() if s == l["id"] and it.kind == "worked_example"}
        c.want += len(want)
        c.got += len(want & got)
        if want - got:
            c.fail(l["id"], f"worked example(s) with no S3 item: {sorted(want - got)}")
        if got - want:
            c.fail(l["id"], f"S3 worked example(s) the manifest does not list: {sorted(got - want)}")
    checks.append(c)

    # ---- exercise items mapped exactly once -----------------------------------
    c = Check("items_mapped_once", "Exercise items = items mapped to exactly one objective")
    manifest_items: dict[str, str] = {}          # ref -> where it sits (lesson or chapter)
    derived_any = False
    for m, l in lessons:
        for ex in l.get("exercises") or []:
            refs, derived = item_refs(ex)
            derived_any |= derived
            manifest_items.update({r: l["id"] for r in refs})
    for mid, m in modules.items():
        if eoc := m.get("end_of_chapter_exercise"):
            refs, derived = item_refs(eoc)
            derived_any |= derived
            manifest_items.update({r: mid for r in refs})
        # a set that closes a split section and belongs to no one part (6-6): S1 distributes it too
        for group in m.get("section_exercises_to_map") or []:
            for ex in group.get("exercises") or []:
                refs, derived = item_refs(ex)
                derived_any |= derived
                manifest_items.update({r: mid for r in refs})
    mapped = Counter(r for s in slugs if s in objectives
                     for o in objectives[s].objectives for r in o.exercise_items)
    outside: dict[str, dict] = {}                 # answer 15 (b): G1's named rulings, by item
    for s in slugs:
        for x in ((objectives[s].model_extra or {}).get("outside_items") or [] if s in objectives else []):
            outside.setdefault(x.get("item"), x)
    c.want = len(manifest_items)
    c.got = sum(1 for r in manifest_items if mapped[r] == 1)
    unmapped = sorted(r for r in manifest_items if mapped[r] == 0 and r not in outside)
    if unmapped:
        c.fail("book", f"{len(unmapped)} item(s) mapped to no objective: {unmapped[:12]}")
    for r in sorted(x for x in manifest_items if mapped[x] == 0 and x in outside):
        x = outside[r]
        c.fail(f"item {r}", f"{r}: ruled outside this chapter's objectives at G1 by "
                            f"{x.get('by') or 'NO ONE (the chapter is not approved at G1)'}"
                            f"{' on ' + str(x.get('at')) if x.get('at') else ''}: {x.get('why')}")
        if x.get("by"):
            g1_exceptions.append({"check": "items_mapped_once", "scope": f"item {r}", "reason": x.get("why"),
                                  "signed_by": x["by"], "signed_at": x.get("at"),
                                  "source": "G1 verdict outside_items (answer 15)"})
    for r in sorted(x for x in outside if x in manifest_items and mapped[x] > 0):
        c.fail(f"item {r}", f"{r}: ruled outside this chapter's objectives at G1, yet mapped to an objective")
    if multi := sorted(r for r in manifest_items if mapped[r] > 1):
        c.fail("book", f"{len(multi)} item(s) mapped to more than one objective: {multi[:12]}")
    if extra := sorted(r for r in mapped if r not in manifest_items):
        c.fail("book", f"{len(extra)} mapped item(s) the manifest does not list: {extra[:12]}")
    if derived_any:
        c.notes.append("some item references were rebuilt from items_per_question; B3's manifest "
                       "should list them (item_refs)")
    checks.append(c)

    # ---- mapped items accounted ---------------------------------------------------
    c = Check("mapped_items_accounted",
              "Mapped exercise items = book questions + items excluded with a reason")
    lo_of_item = {r: o.id for s in slugs if s in objectives for o in objectives[s].objectives
                  for r in o.exercise_items}
    found = {ref: (s, it) for (s, ref), it in run_items.items() if it.kind == "exercise"}
    c.want = len(lo_of_item)
    for ref, lo in sorted(lo_of_item.items()):
        hit = found.get(ref)
        if hit is None:
            c.fail(lesson_of_lo.get(lo, "book"), f"{ref}: mapped to {lo} but no S3 item")
        elif hit[1].lo != lo:
            c.fail(hit[0], f"{ref}: S1 maps it to {lo}, S3 to {hit[1].lo}")
        else:
            c.got += 1
    if extra := sorted(set(found) - set(lo_of_item)):
        c.fail("book", f"S3 item(s) S1 never mapped: {extra[:12]}")
    fates = Counter(it.fate() for it in run_items.values() if it.kind == "exercise")
    c.notes.append("exercise items by fate: " + ", ".join(f"{k} {v}" for k, v in sorted(fates.items())))
    checks.append(c)

    # ---- objectives' evidence ---------------------------------------------------------
    c = Check("objective_evidence", "Objectives = objectives with a claim, a book question and "
              "worked-example-or-exercise evidence (two kinds or more)")
    claims_by_lo = Counter(cl.lo for s in slugs if s in runs for cl in runs[s].claims if cl.supported)
    q_by_lo = Counter(q["lo"] for q in questions)
    for s in slugs:
        for o in (objectives[s].objectives if s in objectives else []):
            c.want += 1
            kinds = {e.kind for e in o.evidence}
            why = [w for w, bad in (
                ("no claim", not claims_by_lo[o.id]), ("no book question", not q_by_lo[o.id]),
                ("no worked-example or exercise evidence", not kinds & {"worked_example", "exercise"}),
                ("fewer than two kinds of evidence", len(kinds) < 2)) if bad]
            if why:
                c.fail(o.id, "; ".join(why))
            else:
                c.got += 1
    checks.append(c)

    # ---- tier floor ------------------------------------------------------------
    c = Check("tier_floor", "Objectives × tiers = cells with at least one live item, book or "
              "generated (FR-4305)")
    cells: dict[str, set[str]] = defaultdict(set)
    for q in questions:
        if q.get("verified"):
            cells[q["lo"]].add(q["tier"])
    for q in gen_q:
        if q.get("status") == "live" and q.get("lo_id") in lesson_of_lo:
            cells[q["lo_id"]].add(q["tier"])
    for lo in all_los:
        c.want += 3
        c.got += len(cells[lo] & set(TIERS))
        if missing := [t for t in TIERS if t not in cells[lo]]:
            c.fail(lo, f"no live item at tier(s) {', '.join(missing)}")
    checks.append(c)

    # ---- widgets per module -------------------------------------------------------
    c = Check("module_widgets", "Modules = modules with a widget question + signed-off widget gaps "
              "(FR-4306)")
    widgets_per_chapter: dict[str, int] = {}
    # Only a CHAPTER-scope gap stands in for a chapter's widget. A lesson-scope gap records that
    # one lesson's kind is missing; signing it accepts the missing kind, not a widgetless chapter.
    signed_gaps = {g.get("module") for g in (widget_gaps or {}).get("gaps", [])
                   if (g.get("signed_off") or {}).get("by") and g.get("scope") == "chapter"}
    for mid in modules:
        n = sum(1 for q in gen_q if q.get("question_type") == "widget"
                and module_of_lesson.get(lesson_of_lo.get(q.get("lo_id"), "")) == mid)
        widgets_per_chapter[mid] = n
        c.want += 1
        if n or mid in signed_gaps:
            c.got += 1
        else:
            c.fail(mid, "no widget question and no signed-off widget gap")
    checks.append(c)

    # ---- distractors / predicates -> refutations -------------------------------------
    by_id = {m["id"]: m for m in catalogue}
    refuted = {m["id"] for m in catalogue if m.get("refutation")}
    c = Check("distractor_refutations", "Tagged distractors and predicates = those whose "
              "misconception has a refutation (FR-1112)")
    tags: list[tuple[str, str]] = []
    for q in gen_q:
        ch = q.get("choices")
        if isinstance(ch, list):
            tags += [(q["id"], x["misconception_id"]) for x in ch if x.get("misconception_id")]
        elif isinstance(ch, dict):
            tags += [(q["id"], d["misconception_id"]) for d in ch.get("diagnostics") or []
                     if d.get("misconception_id")]
    for m in catalogue:
        tags += [(mp.get("question_id"), m["id"]) for mp in m.get("maps") or []]
    c.want = len(tags)
    for qid, mid in tags:
        if mid in refuted:
            c.got += 1
        else:
            c.fail(qid or "book", f"names {mid}, which " + ("has no refutation" if mid in by_id
                                                          else "is not in the catalogue"))
    checks.append(c)

    c = Check("misconception_refutations", "Catalogue entries = entries with a refutation")
    refutations_per_misconception = {m["id"]: len(m.get("refutation") or []) for m in catalogue}
    c.want = len(catalogue)
    c.got = len(refuted)
    for mid, n in refutations_per_misconception.items():
        if not n:
            c.fail(mid, "no refutation steps")
    if dup := [k for k, v in Counter(m["id"] for m in catalogue).items() if v > 1]:
        c.fail("book", f"one error, one entry (FR-1115): duplicate ids {dup[:6]}")
    checks.append(c)

    c = Check("s5_catalogue", "Entries S5 kept = entries in the catalogue; no dropped entry in it")
    if not s5_runs:
        c.fail("book", "no S5 final run (runs/<book>/misconceptions/)")
    else:
        kept = {e["id"] for run in s5_runs for r in run.get("records") or []
                for e in r.get("entries") or []}
        dropped = {d.get("id") for run in s5_runs for r in run.get("records") or []
                   for d in r.get("dropped") or []}
        c.want = sum((run.get("totals") or {}).get("entries", 0) for run in s5_runs)
        c.got = len(kept & set(by_id))
        if c.want != len(kept):
            c.fail("book", f"totals.entries says {c.want}, the records list {len(kept)}")
        if missing := sorted(kept - set(by_id)):
            c.fail("book", f"kept by S5 but not in the catalogue: {missing[:8]}")
        if leaked := sorted(dropped & set(by_id)):
            c.fail("book", f"dropped by the verifier but in the catalogue: {leaked[:8]}")
        c.notes.append(f"{len(dropped)} entr(ies) dropped by the verifier")
    checks.append(c)

    # ---- figures ------------------------------------------------------------------
    # Per CHAPTER: a figure printed with an end-of-chapter or shared exercise (its problem or its
    # question's header) reaches whichever lesson G1 gave that item, so the manifest can only say
    # how many the chapter holds: its lessons' own book figures + those of the sets S1 distributes.
    c = Check("figures", "Manifest figures = visuals + viz gaps with a reason (per chapter)")
    for mid, m in modules.items():
        mine = [l for mm, l in lessons if mm is m]
        want = sum((l.get("figures") or {}).get("book", 0) for l in mine)
        want += ((m.get("end_of_chapter_exercise") or {}).get("figures") or {}).get("in_problems", 0)
        want += sum((ex.get("figures") or {}).get("in_problems", 0)
                    for g in m.get("section_exercises_to_map") or [] for ex in g.get("exercises") or [])
        got, unreasoned = 0, []
        for l in mine:
            got += sum(1 for v in visuals if v["id"].startswith(f"v:{l['id']}:"))
            gaps = runs[l["id"]].viz_gaps if l["id"] in runs else []
            got += sum(1 for g in gaps if g.get("reason"))
            if any(not g.get("reason") for g in gaps):
                unreasoned.append(l["id"])
        c.want += want
        c.got += got
        if want != got:
            c.fail(mid, f"{want} figure(s) in the manifest, {got} visual(s) + reasoned gap(s)"
                        + (f"; a gap with no reason in {', '.join(unreasoned)}" if unreasoned else ""))
    checks.append(c)

    # ---- maths images (S0b) -----------------------------------------------------------
    c = Check("maths_images", "Maths images to transcribe = accepted by hash + by agreement + by the "
              "third reading + resolved at G0b; unresolved = 0")
    if maths is None:
        c.fail("book", "no S0b summary (runs/<book>/maths/summary.json)")
    else:
        for scope, counts in maths_scopes(maths, chapters):
            if counts is None:
                c.fail(scope, "S0b's summary has no count for this chapter: no image of it was assembled")
                continue
            want = counts.get("to_transcribe")
            if want is None:      # a summary from before the third reading: all images, less teacher-only
                want = counts.get("unique", 0) - counts.get("teacher_only_not_transcribed", 0)
            got = sum(counts.get(k, 0) for k in MATHS_ROUTES)
            c.want += want
            c.got += got
            if want != got:
                c.fail(scope, f"{want} image(s) to transcribe, {got} accepted or resolved"
                              f" ({counts.get('unresolved', 0)} on the G0b queue)")
        c.notes.append("by route: " + ", ".join(
            f"{k.removeprefix('accepted_by_')} {sum((cs or {}).get(k, 0) for _, cs in maths_scopes(maths, chapters))}"
            for k in MATHS_ROUTES))
    checks.append(c)

    # ---- items typed exactly once --------------------------------------------------------
    c = Check("items_typed_once", "Exercise items = numeric + choice + expression + not_markable")
    typed = Counter(it.answer_type for it in run_items.values() if it.kind == "exercise")
    c.want = len({ref for (_, ref), it in run_items.items() if it.kind == "exercise"})
    c.got = sum(typed.values())
    if c.want != c.got:
        c.fail("book", f"{c.got} typings for {c.want} distinct item(s): an item typed twice")
    c.notes.append("by type: " + ", ".join(f"{k} {v}" for k, v in sorted(typed.items())))
    checks.append(c)

    # ---- solution sources -----------------------------------------------------------
    c = Check("solution_sources", "Book questions = book_worked + book_worked_epub + teachers_guide "
              "(+ answer_anchored)")
    src = Counter(q.get("solution_provenance") for q in questions)
    c.want = len(questions)
    c.got = sum(src[k] for k in ("book_worked", "book_worked_epub", "teachers_guide",
                                 "answer_anchored"))
    if src.get(None):
        c.fail("book", f"{src[None]} book question(s) carry no solution source (FR-4302)")
    if src.get("answer_anchored") and book.sources.epub:
        c.fail("book", f"{src['answer_anchored']} answer_anchored solution(s) in a book whose EPUB "
                       "carries worked solutions (expected 0, decision 19)")
    c.notes.append("by source: " + ", ".join(f"{k} {v}" for k, v in sorted(
        (k, v) for k, v in src.items() if k)))
    checks.append(c)

    # ---- lesson provenance ------------------------------------------------------------
    c = Check("lesson_provenance", "Lessons = lessons carrying book provenance; parts consecutive "
              "and numbered 1..m")
    carried = {x["slug"]: x for x in b_lessons}
    c.want = len(slugs)
    c.got = sum(1 for s in slugs if s in carried)
    if missing := [s for s in slugs if s not in carried]:
        c.fail("book", f"lesson(s) with no provenance in any bundle: {missing[:12]}")
    ordered = [Lesson.model_validate(carried[s]) for s in slugs if s in carried]
    for p in check_lessons(ordered):
        c.fail("book", p)
    try:
        want_prov = [book_lesson(m, l) for m, l in lessons]
        for w in want_prov:
            got = carried.get(w.slug)
            if got and Lesson.model_validate(got) != w:
                c.fail(w.slug, "the bundle's provenance differs from the manifest's")
    except Exception as exc:  # noqa: BLE001 — a malformed manifest lesson is a finding
        c.fail("book", f"manifest provenance unreadable: {exc}")
    checks.append(c)

    # ---- teacher-only blocks --------------------------------------------------------------
    c = Check("teacher_only", "Teacher-only blocks = blocks dropped at S2; reaching a claim = 0 "
              "(FR-4408)")
    for m, l in lessons:
        want = (l.get("boxes") or {}).get("teachers_guide", 0)
        t = runs[l["id"]].teacher_only if l["id"] in runs else None
        got = t.dropped if t else 0
        c.want += want
        c.got += got
        if want != got:
            c.fail(l["id"], f"{want} teacher-only block(s) in the manifest, {got} dropped at S2")
        if t and t.reached_claim:
            c.fail(l["id"], f"{t.reached_claim} teacher-only block(s) reached a claim")
    checks.append(c)

    # ---- notation ---------------------------------------------------------------------
    c = Check("notation", "Un-normalised decimal commas and (x; y) pairs left in the bundles = 0 "
              "(decision 15)")
    printed = sum(1 for it in run_items.values()
                  if any(normalise(t)[1] for t in [it.stem, *it.solution, it.answer or "",
                         (it.marker or {}).get("key", ""), *[x.get("text", "") for x in it.choices or []]]))
    residual = []
    for b in bundles:
        for s in _strings({k: v for k, v in b.items() if k not in ("assembled_from", "source_document")}):
            residual += residual_notation(s)
    for q in gen_q:
        for s in _strings(q):
            residual += residual_notation(s)
    c.want = 0
    c.got = len(residual)
    if residual:
        c.fail("book", f"{len(residual)} un-normalised span(s): {residual[:8]}")
    c.notes.append(f"{printed} S3 item(s) printed in the book's notation were normalised")
    checks.append(c)

    # ---- S2's claims, where the lesson surfaces read them ------------------------------------
    c = Check("claims_served", "Claims in the bundles = claims in the lessons' content files")
    if content is not None:
        bundle_claims: dict[str, Counter] = defaultdict(Counter)
        for b in bundles:
            for cl in b.get("claims", []):
                bundle_claims[book_config.lesson_slug(cl["lo"])][(cl["lo"], cl["claim"], cl["anchor"])] += 1
        for s in slugs:
            want = bundle_claims.get(s, Counter())
            c.want += sum(want.values())
            if s not in content:
                if bundles:
                    c.fail(s, "no lesson-content file: the lesson's claims have no home")
                continue
            got = Counter((cl["lo"], cl["claim"], cl["anchor"]) for cl in content[s].get("claims", []))
            c.got += sum((want & got).values())
            if want != got:
                c.fail(s, f"{sum(want.values())} claim(s) in the bundle, {sum(got.values())} in the content file")
    checks.append(c)

    extra = {"g1_exceptions": g1_exceptions,
             "widgets_per_chapter": widgets_per_chapter,
             "refutations_per_misconception": refutations_per_misconception,
             "notation": {"items_printed_in_book_notation": printed,
                          "residual_in_bundles": len(residual)}}
    return checks, extra


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load_json(p: Path | None) -> dict | None:
    return json.loads(p.read_text()) if p and p.exists() else None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--book", required=True)
    ap.add_argument("--chapter", type=int, action="append")
    ap.add_argument("--manifest", type=Path)
    ap.add_argument("--objectives", type=Path)
    ap.add_argument("--runs", type=Path)
    ap.add_argument("--seed", type=Path, help="the assembled bundles (default seed/<book>/)")
    ap.add_argument("--content", type=Path, help="the lesson-content files (default: the bundles' sibling content/)")
    ap.add_argument("--generated", type=Path, help="default seed/generated/<book>/")
    ap.add_argument("--maths", type=Path, help="default runs/<book>/maths/summary.json")
    ap.add_argument("--widget-gaps", type=Path, help="default coverage/<book>.widget-gaps.json")
    ap.add_argument("--s5", type=Path, action="append",
                    help="S5 final run output(s) (default runs/<book>/misconceptions/*.json)")
    ap.add_argument("--out", type=Path, help="default coverage/<book>.json")
    ap.add_argument("--check", action="store_true", help="print the audit, write nothing")
    a = ap.parse_args(argv)

    book = book_config.load_book(a.book)
    manifest_p = a.manifest or (book.repo_path(book.manifest) if book.manifest else None)
    objectives_d = a.objectives or HERE / "objectives" / book.book
    runs_d = a.runs or HERE / "runs" / book.book / "lesson"
    seed_d = a.seed or HERE / "seed" / book.book
    gen_d = a.generated or HERE / "seed" / "generated" / book.book
    maths_p = a.maths or HERE / "runs" / book.book / "maths" / "summary.json"
    gaps_p = a.widget_gaps or HERE / "coverage" / f"{book.book}.widget-gaps.json"
    out_p = a.out or HERE / "coverage" / f"{book.book}.json"
    if not manifest_p or not manifest_p.exists():
        print(f"ERROR: no manifest for {book.book}", file=sys.stderr)
        return 2
    manifest = json.loads(manifest_p.read_text())
    chapters = set(a.chapter) if a.chapter else None
    slugs = [l["id"] for m, l in manifest_lessons(manifest)
             if chapters is None or m["chapter"] in chapters]
    inputs: dict[str, str] = {"manifest": sha256(manifest_p)}
    objectives, runs = {}, {}
    for s in slugs:
        for d, key, model, into in ((objectives_d, "objectives", ObjectivesFile, objectives),
                                    (runs_d, "runs/lesson", LessonRun, runs)):
            p = d / f"{s}.json"
            if p.exists():
                into[s] = model.model_validate_json(p.read_text())
                inputs[f"{key}/{p.name}"] = sha256(p)
    bundles = []
    for p in sorted(seed_d.glob("*.json")) if seed_d.exists() else []:
        b = json.loads(p.read_text())
        if "extraction_run" in b:
            bundles.append(b)
            inputs[f"seed/{p.name}"] = sha256(p)
    generated = {}
    for key in ("generated-questions", "widget-questions", "misconceptions"):
        p = gen_d / f"{key}.json"
        if p.exists():
            generated[key] = json.loads(p.read_text())
            inputs[f"generated/{p.name}"] = sha256(p)
    maths, gaps = load_json(maths_p), load_json(gaps_p)
    s5_paths = a.s5 or sorted((HERE / "runs" / book.book / "misconceptions").glob("*.json"))
    s5_runs = []
    for p in s5_paths:
        run = json.loads(p.read_text())
        if run.get("stage") == "final" and run.get("book") == book.book:
            s5_runs.append(run)
            inputs[f"s5/{p.name}"] = sha256(p)
    for name, p, v in (("maths", maths_p, maths), ("widget-gaps", gaps_p, gaps)):
        if v is not None:
            inputs[name] = sha256(p)

    previous = load_json(out_p) or {}
    exceptions = previous.get("exceptions", [])
    content_d = a.content or seed_d.parent / "content"
    content = {}
    for s in slugs:
        p = content_d / f"{s}.json"
        if p.exists():
            content[s] = json.loads(p.read_text())
            inputs[f"content/{p.name}"] = sha256(p)
    checks, extra = audit(book, manifest, objectives, runs, bundles, generated, maths, gaps, chapters,
                          s5_runs, content)
    # G1's named rulings (answer 15) except their own failures; they are regenerated from the objectives
    # files on every run and reported apart from the hand-signed `exceptions` list
    rows = [c.as_dict(exceptions + extra.get("g1_exceptions", [])) for c in checks]
    failing = [r["id"] for r in rows if r["state"] == "fails"]
    status = "RED" if failing else "GREEN"
    report = {
        "coverage_version": COVERAGE_VERSION, "book": book.book, "course_id": book.course_id,
        "chapters": sorted(chapters) if chapters else "all", "status": status,
        "summary": {"checks": len(rows), "hold": sum(r["state"] == "holds" for r in rows),
                    "excepted": sum(r["state"] == "excepted" for r in rows), "fail": len(failing)},
        "checks": rows, **extra,
        "missing_inputs": sorted([f"objectives/{s}.json" for s in slugs if s not in objectives]
                                 + [f"runs/lesson/{s}.json" for s in slugs if s not in runs]
                                 + ([] if bundles else ["seed/*.json"])),
        "inputs": dict(sorted(inputs.items())),
        "exceptions": exceptions,
    }
    for r in rows:
        mark = {"holds": "=", "excepted": "~", "fails": "x"}[r["state"]]
        print(f"  {mark} {r['id']:<26} want {r['want']:>5}  got {r['got']:>5}  {r['state']}")
        for f in r["failures"][:4]:
            print(f"      {f['scope']}: {f['detail']}")
        if len(r["failures"]) > 4:
            print(f"      … +{len(r['failures']) - 4} more")
    unsigned = [e for e in exceptions if not e.get("signed_by")]
    if unsigned:
        print(f"  ! {len(unsigned)} exception(s) without signed_by — ignored")
    print(f"COVERAGE: {status} — {book.book}"
          + (f" (chapters {sorted(chapters)})" if chapters else "")
          + f": {report['summary']['hold']} hold, {report['summary']['excepted']} excepted, "
            f"{len(failing)} fail")
    if not a.check:
        out_p.parent.mkdir(parents=True, exist_ok=True)
        out_p.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        print(f"wrote {out_p}")
    return 0 if status == "GREEN" else 1


if __name__ == "__main__":
    sys.exit(main())

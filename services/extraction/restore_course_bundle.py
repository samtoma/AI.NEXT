"""Replay a previously exported, reviewed bundle for ONE course ("Load a course" restore, T430).

    python restore_course_bundle.py --course <id> --dir <export dir> --dry-run      # writes nothing
    python restore_course_bundle.py --course <id> --dir <export dir>                # replay it
    python restore_course_bundle.py --course <id> --dir <export dir> --verify-only  # read-back only

Normally run by `deploy/load-course.sh <course-id> restore-dry-run | restore-rehearse | restore`,
which stages the export from the box's checkout, backs the database up first and runs the
post-flight. Decision 29 (Samuel's answer 27, "Build the safe restore"); FR-4208, FR-4210;
constitution X.

WHAT A "BUNDLE" IS HERE. The three files `export_generated_content.py --course` writes
(generated-questions.json, widget-questions.json, misconceptions.json) plus the
`export-record.json` it writes beside them. That is the course's generated bank, its
misconception catalogue with the refutations, and the catalogue's stamps on the book's own
multiple-choice options. It is NOT the book: the course graph, the book's questions, figures
and lessons come from the seed bundles and change only through a content refresh
(refresh-content.sh) or a whole-database rollback. Restore never touches them, beyond the
catalogue's stamps on book options, which the export carries.

PROVENANCE, or it refuses (exit 2, nothing written):
  * the directory holds an export record for THIS course, naming this course's book;
  * every file's sha256 is the one the record says the export wrote — a freshly generated
    bundle has no record, and a hand-edited export no longer matches its own;
  * the course is loaded, and the database's source document for it is the one the export was
    taken from (a changed objective set is reported, not refused, as long as every row still
    lands on an objective of this course);
  * every id in the bundle that the database already holds is the same kind of row, on the
    same objective (an id is an identity, not a slot);
  * every catalogue map still finds its book option by exact text (else the book changed since
    the export, and the replay could not reproduce it).

STUDENTS, or it refuses (exit 2, nothing written). No student row is ever written, deleted or
rewritten — not attempts, mastery, lesson pointers, sessions, logs or anything else. A replay
makes the course's generated content EQUAL the export, so rows the export does not hold are
removed — and that is exactly how progress gets orphaned. So before anything is written, every
content row the replay would remove, and every question whose asked-or-accepted content it
would change (objective, type, stem, choices, answer key — as load_seed.py --update defines
it), is looked up in every column of every student table (FK or JSON). One hit anywhere and the
whole restore refuses, naming each row and where it is referenced (counts, never a student).

ONE TRANSACTION, VERIFIED BEFORE IT COMMITS. The replay runs in a single REPEATABLE READ
transaction. Inside it, before COMMIT: (1) a digest of every student table must be identical
before and after the writes — proof, even on the live database with students working, that
this run wrote no student row; (2) the course must EXPORT to exactly the bytes that were
restored (export_generated_content.build_bundles with the restored files as the prior). Either
check failing rolls the whole replay back: the database is exactly as it was.

WHAT IS KEPT FROM THE BUNDLE, PER ROW: each question's own status, reviewed_by and reviewed_at
(the semantics `load_generated_questions.py --restore` has); the catalogue's labels,
descriptions and signals; each refutation's steps. A refutation whose text changes loses its
review mark, because the export carries none for refutations and a review of other words is
not a review of these. A question whose worked solution changes gets a new solution_version,
as load_seed.py does, so logged explanations keep pointing at the version they used.

Exit codes: 0 done (or dry run clean / read-back matches) · 1 unexpected error ·
2 refused, nothing written · 3 the replay did not read back as the export: rolled back,
nothing written (a defect: tell Samuel).
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import sys
from collections import Counter, defaultdict
from datetime import timezone
from pathlib import Path

import book_config
import export_generated_content as egc

FILES = egc.FILES
RECORD = egc.RECORD
# Every table that holds a student's data — deploy/load-course.sh's STUDENT_TABLES, the same list.
STUDENT_TABLES = ("students accounts guardians attempts mastery understanding_checks explanation_log "
                  "sessions student_progress ai_interactions analytics_events uploads safety_flags "
                  "feedback student_course_access student_curriculum_changes student_testers "
                  "course_availability").split()
Q_COLS = ("tier", "question_type", "stem", "choices", "correct_answer", "canonical_solution",
          "status", "parent_question_id", "source_page", "source_note", "reviewed_by", "reviewed_at")
MATERIAL = ("question_type", "stem", "choices", "correct_answer")


class Refused(Exception):
    pass


class Mismatch(Exception):
    pass


def say(msg: str = "") -> None:
    print(msg, flush=True)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _item(choices):
    """What a question asks or accepts: its choices with every misconception stamp removed (a
    stamp is the catalogue's annotation, load_seed._choice_pairs' rule, extended to a widget's
    diagnostics)."""
    if isinstance(choices, list):
        return [_item(c) for c in choices]
    if isinstance(choices, dict):
        return {k: _item(v) for k, v in choices.items() if k != "misconception_id"}
    return choices


def _norm(field: str, v):
    if v is None:
        return None
    if field == "reviewed_at" and not isinstance(v, str):
        return v.astimezone(timezone.utc).isoformat()
    if field in ("source_page", "correct_answer"):
        return str(v)
    return v


def _options(choices):
    """(the list of options, a function putting a new list back in the same shape)."""
    if isinstance(choices, dict) and isinstance(choices.get("options"), list):
        return choices["options"], lambda new: dict(choices, options=new)
    if isinstance(choices, list):
        return choices, lambda new: new
    return None, None


# ---- the export ---------------------------------------------------------------------------

def read_export(d: Path, course: str) -> tuple[dict, dict[str, str], dict[str, dict]]:
    """(record, file texts, parsed bundles), or Refused naming every provenance problem."""
    problems: list[str] = []
    rp = d / RECORD
    if not rp.is_file():
        raise Refused(
            f"there is no {RECORD} in the export directory. Only an export taken with "
            "`export_generated_content.py --course` carries one — this is a freshly generated "
            "bundle, or an export older than export records. Export the course from the live "
            "database, commit the result, deploy it, then restore.")
    try:
        record = json.loads(rp.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise Refused(f"{RECORD} is not JSON: {exc}")
    if record.get("record") != egc.RECORD_FORMAT:
        problems.append(f"{RECORD} is format {record.get('record')!r}, this restore reads "
                        f"{egc.RECORD_FORMAT!r}")
    if record.get("course_id") != course:
        problems.append(f"the export record is for {record.get('course_id')!r}, not {course!r}")
    book = book_config.book_for_course(course)
    if book is None:
        problems.append(f"no book config names {course} (services/extraction/books/*.json)")
    else:
        if record.get("book") != book.book:
            problems.append(f"the export record names book {record.get('book')!r}; {course}'s book "
                            f"config is {book.book!r}")
        if book.sacred_content:
            problems.append(f"{book.book} carries scripture (sacred_content). The sacred gate "
                            "(ADR-0006) lives in load_seed.py; restore does not replay content for "
                            "such a book. Ask Samuel")
    files = record.get("files") or {}
    if sorted(files) != sorted(FILES):
        problems.append(f"the record lists {sorted(files)}, an export writes {sorted(FILES)}")
    texts: dict[str, str] = {}
    bundles: dict[str, dict] = {}
    for name in FILES:
        p = d / name
        if not p.is_file():
            problems.append(f"{name} is missing from the export directory")
            continue
        raw = p.read_bytes()
        want = (files.get(name) or {}).get("sha256")
        got = _sha(raw)
        if got != want:
            problems.append(f"{name}: sha256 {got[:12]}… is not the {str(want)[:12]}… its export "
                            "record says was written — it was changed after the export, or is not "
                            "the export this record describes")
        texts[name] = raw.decode("utf-8")
        try:
            bundles[name] = json.loads(texts[name])
        except ValueError as exc:
            problems.append(f"{name} is not JSON: {exc}")
            continue
        for key, want_v in (("course_id", course), ("book", record.get("book"))):
            if key in bundles[name] and bundles[name][key] != want_v:
                problems.append(f"{name} says {key} {bundles[name][key]!r}, the record {want_v!r}")
    if problems:
        raise Refused("the export's provenance does not check out:\n" +
                      "\n".join(f"  x {p}" for p in problems))
    return record, texts, bundles


# ---- student references --------------------------------------------------------------------

def student_columns(cur) -> list[tuple[str, str, str, bool]]:
    """(table, column, data type, has student_id) for every text/json column of a student table."""
    cur.execute("""SELECT c.table_name, c.column_name, c.data_type,
                          EXISTS (SELECT 1 FROM information_schema.columns s
                                   WHERE s.table_schema = 'public' AND s.table_name = c.table_name
                                     AND s.column_name = 'student_id')
                     FROM information_schema.columns c
                    WHERE c.table_schema = 'public' AND c.table_name = ANY(%s)
                      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
                    ORDER BY c.table_name, c.ordinal_position""", (list(STUDENT_TABLES),))
    return cur.fetchall()


def student_refs(cur, cols, ids) -> dict[str, list[str]]:
    """id -> where student data names it. A text column must EQUAL the id; a JSON column must
    contain it as a JSON string. Counts only — never which student."""
    from psycopg import sql
    ids = sorted(set(ids))
    out: dict[str, list[str]] = defaultdict(list)
    if not ids:
        return out
    for table, col, dtype, has_student in cols:
        t, c = sql.Identifier(table), sql.Identifier(col)
        cond = (sql.SQL("strpos(t.{}::text, to_json(x.id)::text) > 0").format(c)
                if dtype in ("jsonb", "json") else sql.SQL("t.{} = x.id").format(c))
        who = sql.SQL("count(DISTINCT t.student_id)") if has_student else sql.SQL("NULL")
        cur.execute(sql.SQL("SELECT x.id, count(*), {} FROM unnest(%s::text[]) AS x(id) "
                            "JOIN public.{} t ON {} GROUP BY x.id").format(who, t, cond), (ids,))
        for rid, n, students in cur.fetchall():
            out[rid].append(f"{table}.{col}: {n} row(s)"
                            + (f", {students} student(s)" if students is not None else ""))
    return out


def student_digest(cur) -> list[tuple[str, int, str]]:
    cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(%s) "
                "ORDER BY tablename", (list(STUDENT_TABLES),))
    from psycopg import sql
    out = []
    for (t,) in cur.fetchall():
        cur.execute(sql.SQL("SELECT count(*), coalesce(md5(string_agg(x::text, E'\\n' ORDER BY "
                            "x::text)), '-') FROM public.{} x").format(sql.Identifier(t)))
        n, h = cur.fetchone()
        out.append((t, n, h))
    return out


# ---- the plan ------------------------------------------------------------------------------

class Plan:
    def __init__(self) -> None:
        self.notes: list[str] = []
        self.refusals: list[str] = []
        self.q_add: list[dict] = []
        self.q_update: list[tuple[dict, list[str], bool]] = []   # (row, fields, solution changed)
        self.q_unchanged = 0
        self.q_delete: list[str] = []
        self.status_moves: Counter = Counter()
        self.stamp_changes = 0
        self.mc_add: list[dict] = []
        self.mc_update: list[dict] = []
        self.mc_unchanged = 0
        self.mc_delete: list[str] = []
        self.ref_add: list[dict] = []
        self.ref_update: list[tuple[str, dict, bool]] = []       # (row id, entry, was reviewed)
        self.ref_delete: list[str] = []
        self.restamp: dict[str, object] = {}
        self.generator = "unattributed"


def plan(cur, course: str, record: dict, bundles: dict[str, dict]) -> Plan:
    p = Plan()
    cur.execute("SELECT count(*) FROM graph_nodes WHERE id = %s AND kind = 'course'", (course,))
    if cur.fetchone()[0] != 1:
        raise Refused(f"{course} is not loaded. Restore replays an export onto a course that is "
                      "present; a course that is absent goes through mode 'load'.")
    cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s", (course,))
    los = {r[0] for r in cur.fetchall()}

    fp = egc.course_fingerprint(cur, course)
    was = record.get("course") or {}
    if fp["source_sha256"] != was.get("source_sha256"):
        raise Refused(f"the course in the database is not the one this export was taken from: its "
                      f"source document is {fp['source_sha256']!r}, the export's "
                      f"{was.get('source_sha256')!r}. Nothing was written.")
    if fp["objective_digest"] != was.get("objective_digest"):
        p.notes.append(f"the course's objectives changed since the export ({was.get('objectives')} "
                       f"then, {fp['objectives']} now); every row below is still checked to sit on "
                       "one of them")

    questions = [q for n in ("generated-questions.json", "widget-questions.json")
                 for q in bundles[n].get("questions") or []]
    catalogue = bundles["misconceptions.json"]
    entries = catalogue.get("misconceptions") or []
    p.generator = catalogue.get("generator") or "unattributed"
    ids = [q["id"] for q in questions]
    for qid, n in Counter(ids).items():
        if n > 1:
            p.refusals.append(f"{qid} appears {n} times across the two question bundles")
    bundle_q = {q["id"]: q for q in questions}
    entry_by_id = {m["id"]: m for m in entries}
    aliases = {a: m for m in entries for a in m.get("aliases") or []}
    for q in questions:
        if q.get("lo_id") not in los:
            p.refusals.append(f"{q['id']} sits on {q.get('lo_id')}, which is not an objective of {course}")
    for m in entries:
        if m.get("lo_id") not in los:
            p.refusals.append(f"catalogue entry {m['id']} sits on {m.get('lo_id')}, which is not an "
                              f"objective of {course}")

    # --- what the database holds, in the export's scope and by id --------------------------
    cur.execute(f"""SELECT id, lo_id, source, materialised_from, solution_version,
                           {', '.join(Q_COLS)}
                      FROM questions WHERE id = ANY(%s)
                         OR (source = 'variant' AND materialised_from IS NULL
                             AND lo_id = ANY(%s))""", (ids, sorted(los)))
    cols = ("id", "lo_id", "source", "materialised_from", "solution_version") + Q_COLS
    db_q_all = {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}
    in_scope = {i: r for i, r in db_q_all.items()
                if r["source"] == "variant" and r["materialised_from"] is None and r["lo_id"] in los}
    for qid, q in bundle_q.items():
        old = db_q_all.get(qid)
        if old is None:
            continue
        if qid not in in_scope:
            p.refusals.append(f"{qid} exists in the database as a {old['source']} question"
                              + (" materialised from a session" if old["materialised_from"] else "")
                              + f" on {old['lo_id']} — not this export's row")
        elif old["lo_id"] != q["lo_id"]:
            p.refusals.append(f"{qid} is on {old['lo_id']} in the database and on {q['lo_id']} in the "
                              "export — an id is an identity; a moved question is a new question")

    cur.execute("SELECT id, lo_id, label, description, signal FROM misconceptions")
    db_mc = {r[0]: dict(zip(("id", "lo_id", "label", "description", "signal"), r))
             for r in cur.fetchall()}
    for mid, m in entry_by_id.items():
        old = db_mc.get(mid)
        if old and old["lo_id"] != m["lo_id"]:
            p.refusals.append(f"catalogue entry {mid} is on {old['lo_id']} in the database and on "
                              f"{m['lo_id']} in the export")

    # --- structural validation, against the catalogue as it will stand ---------------------
    course_mc = {i for i, m in db_mc.items() if m["lo_id"] in los}
    known = {i: m["lo_id"] for i, m in db_mc.items() if i not in course_mc}
    known.update({i: m["lo_id"] for i, m in entry_by_id.items()})
    known.update({a: m["lo_id"] for a, m in aliases.items()})
    import load_generated_questions as lgq
    for name in ("generated-questions.json", "widget-questions.json"):
        problems, notes = lgq.validate(bundles[name], known, restoring=True)
        p.refusals += [f"{name}: {x}" for x in problems]
        p.notes += [f"{name}: {x}" for x in notes[:5]]
        if len(notes) > 5:
            p.notes.append(f"{name}: … and {len(notes) - 5} more cross-objective reference(s)")
    parents = {q["parent_question_id"] for q in questions if q.get("parent_question_id")}
    cur.execute("SELECT id FROM questions WHERE id = ANY(%s)", (sorted(parents),))
    have = {r[0] for r in cur.fetchall()} | set(bundle_q)
    for parent in sorted(parents - have):
        p.refusals.append(f"parent question {parent} (named by the export) is not in the database")

    # --- questions: add, change, remove ------------------------------------------------------
    touch_material: list[str] = []
    for qid, q in bundle_q.items():
        old = in_scope.get(qid)
        if old is None:
            if qid not in db_q_all:
                p.q_add.append(q)
                p.status_moves[(None, q.get("status"))] += 1
            continue
        changed = [f for f in Q_COLS if _norm(f, old[f]) != _norm(f, q.get(f))]
        if not changed:
            p.q_unchanged += 1
            continue
        material = [f for f in MATERIAL if (_item(old[f]) if f == "choices" else _norm(f, old[f]))
                    != (_item(q.get(f)) if f == "choices" else _norm(f, q.get(f)))]
        if material:
            touch_material.append(qid)
        if "status" in changed:
            p.status_moves[(old["status"], q.get("status"))] += 1
        if "reviewed_by" in changed or "reviewed_at" in changed:
            p.stamp_changes += 1
        p.q_update.append((q, changed, "canonical_solution" in changed))
    p.q_delete = sorted(set(in_scope) - set(bundle_q))

    # --- the catalogue -----------------------------------------------------------------------
    for mid, m in entry_by_id.items():
        old = db_mc.get(mid)
        if old is None:
            p.mc_add.append(m)
        elif any(old[f] != m.get(f) for f in ("label", "description", "signal")):
            p.mc_update.append(m)
        else:
            p.mc_unchanged += 1
    p.mc_delete = sorted(course_mc - set(entry_by_id) - set(aliases))

    cur.execute("""SELECT id, misconception_id, content, reviewed OR reviewed_by IS NOT NULL
                     FROM explanation_library
                    WHERE entry_type = 'refutation' AND misconception_id IS NOT NULL
                      AND lo_id = ANY(%s) ORDER BY id""", (sorted(los),))
    db_ref: dict[str, list[tuple[str, object, bool]]] = defaultdict(list)
    for rid, mid, content, reviewed in cur.fetchall():
        db_ref[mid].append((rid, content, reviewed))
    for mid, rows in db_ref.items():
        if mid in p.mc_delete:
            p.ref_delete += [r[0] for r in rows]
    for mid, m in entry_by_id.items():
        steps = m.get("refutation") or []
        rows = db_ref.get(mid, [])
        if len(rows) > 1:
            p.notes.append(f"{mid} has {len(rows)} refutation rows; the export reads one")
        if not steps:
            p.ref_delete += [r[0] for r in rows]
            continue
        if not rows:
            p.ref_add.append(m)
            continue
        rid, content, reviewed = rows[-1]
        have_steps = content if isinstance(content, list) else (content or {}).get("steps", [])
        if have_steps != steps:
            p.ref_update.append((rid, m, bool(reviewed)))

    # --- the catalogue's stamps on the book's own options -------------------------------------
    maps: dict[tuple[str, str], str] = {}
    for m in entries:
        for x in m.get("maps") or []:
            maps[(x.get("question_id"), x.get("choice_text"))] = m["id"]
    ours = course_mc | set(entry_by_id) | set(aliases)
    cur.execute("""SELECT id, choices FROM questions
                    WHERE lo_id = ANY(%s) AND source IN ('seed', 'authored')
                      AND question_type = 'mcq' AND choices IS NOT NULL""", (sorted(los),))
    book = {r[0]: r[1] for r in cur.fetchall()}
    matched: set[tuple[str, str]] = set()
    for qid, choices in book.items():
        opts, rewrap = _options(choices)
        if opts is None:
            continue
        new = []
        for c in opts:
            if not isinstance(c, dict):
                new.append(c)
                continue
            want = maps.get((qid, c.get("text")))
            if want:
                matched.add((qid, c.get("text")))
                new.append(dict(c, misconception_id=want))
            elif c.get("misconception_id") in ours:
                new.append({k: v for k, v in c.items() if k != "misconception_id"})
            else:
                new.append(c)       # another course's stamp, or none: not the export's to change
        if new != opts:
            p.restamp[qid] = rewrap(new)
    for (qid, text), mid in maps.items():
        if (qid, text) in matched:
            continue
        if qid in bundle_q:
            opts, _ = _options(bundle_q[qid].get("choices"))
            if not any(isinstance(c, dict) and c.get("text") == text
                       and c.get("misconception_id") == mid for c in opts or []):
                p.notes.append(f"{mid} maps {qid} {text!r}, but the export's question does not carry "
                               "that stamp")
            continue
        p.refusals.append(f"{mid} maps {qid} option {text!r}, which the database's book no longer "
                          "has — the book changed since the export")

    # --- what the replay would remove, and what else names it --------------------------------
    removed_q, removed_mc = set(p.q_delete), set(p.mc_delete)
    if removed_q:
        cur.execute("""SELECT parent_question_id, count(*) FROM questions
                        WHERE parent_question_id = ANY(%s) AND NOT (id = ANY(%s))
                        GROUP BY 1""", (sorted(removed_q), sorted(removed_q)))
        for qid, n in cur.fetchall():
            p.refusals.append(f"{qid} (not in the export) is the parent of {n} other question(s)")
        cur.execute("SELECT question_id, count(*) FROM visuals WHERE question_id = ANY(%s) GROUP BY 1",
                    (sorted(removed_q),))
        for qid, n in cur.fetchall():
            p.refusals.append(f"{qid} (not in the export) has {n} figure(s); restore does not remove "
                              "the book's figures")
    if removed_mc:
        replaced = set(bundle_q) | removed_q | set(book)
        cur.execute("""SELECT q.id, m.id FROM questions q, unnest(%s::text[]) AS m(id)
                        WHERE q.choices IS NOT NULL AND NOT (q.id = ANY(%s))
                          AND strpos(q.choices::text, to_json(m.id)::text) > 0""",
                    (sorted(removed_mc), sorted(replaced)))
        for qid, mid in cur.fetchall():
            p.refusals.append(f"{mid} (not in the export) is named by question {qid}, which the "
                              "export does not replace")
        cur.execute("""SELECT misconception_id, entry_type, count(*) FROM explanation_library
                        WHERE misconception_id = ANY(%s) AND entry_type <> 'refutation'
                        GROUP BY 1, 2""", (sorted(removed_mc),))
        for mid, et, n in cur.fetchall():
            p.refusals.append(f"{mid} (not in the export) has {n} {et} explanation(s)")

    cols_s = student_columns(cur)
    held = student_refs(cur, cols_s, list(removed_q) + list(removed_mc) + p.ref_delete + touch_material)
    for qid in p.q_delete:
        if held.get(qid):
            p.refusals.append(f"question {qid} is not in the export, and student data names it: "
                              + "; ".join(held[qid]))
    for mid in p.mc_delete:
        if held.get(mid):
            p.refusals.append(f"misconception {mid} is not in the export, and student data names it: "
                              + "; ".join(held[mid]))
    for rid in p.ref_delete:
        if held.get(rid):
            p.refusals.append(f"refutation {rid} would be removed, and student data names it: "
                              + "; ".join(held[rid]))
    for qid in touch_material:
        if held.get(qid):
            p.refusals.append(f"question {qid}: the export changes what it asks or accepts, and "
                              "student data names it (a past answer would stop meaning what it "
                              "meant): " + "; ".join(held[qid]))
    return p


def print_plan(p: Plan) -> None:
    say("   questions   add %d · change %d · unchanged %d · remove %d" % (
        len(p.q_add), len(p.q_update), p.q_unchanged, len(p.q_delete)))
    for (a, b), n in sorted(p.status_moves.items(), key=lambda kv: (str(kv[0][0]), str(kv[0][1]))):
        say(f"               status {a or '(new)'} -> {b}: {n}")
    if p.stamp_changes:
        say(f"               review stamps put back as exported: {p.stamp_changes}")
    say("   catalogue   add %d · change %d · unchanged %d · remove %d" % (
        len(p.mc_add), len(p.mc_update), p.mc_unchanged, len(p.mc_delete)))
    cleared = sum(1 for _, _, r in p.ref_update if r)
    say("   refutations add %d · change %d · remove %d" % (len(p.ref_add), len(p.ref_update),
                                                            len(p.ref_delete))
        + (f"  ({cleared} changed one(s) lose a review mark: the export carries none)" if cleared else ""))
    say(f"   book options re-stamped by the catalogue: {len(p.restamp)} question(s)")
    for n in p.notes:
        say(f"   note: {n}")


# ---- the replay ------------------------------------------------------------------------------

def apply(cur, p: Plan) -> None:
    for m in p.mc_add:
        cur.execute("""INSERT INTO misconceptions (id, lo_id, label, description, signal, generated_by)
                       VALUES (%s, %s, %s, %s, %s, %s)""",
                    (m["id"], m["lo_id"], m["label"], m["description"], m.get("signal"), p.generator))
    for m in p.mc_update:
        cur.execute("UPDATE misconceptions SET label = %s, description = %s, signal = %s WHERE id = %s",
                    (m["label"], m["description"], m.get("signal"), m["id"]))
    for m in p.ref_add:
        cur.execute("""INSERT INTO explanation_library
                         (id, lo_id, misconception_id, entry_type, content, generated_by, reviewed)
                       VALUES (%s, %s, %s, 'refutation', %s, %s, false)""",
                    (f"expl:{m['id']}", m["lo_id"], m["id"], json.dumps(m["refutation"]), p.generator))
    for rid, m, _ in p.ref_update:
        cur.execute("""UPDATE explanation_library
                          SET content = %s, reviewed = false, reviewed_by = NULL, reviewed_at = NULL
                        WHERE id = %s""", (json.dumps(m["refutation"]), rid))

    def vals(q):
        return (q["tier"], q["question_type"], q["stem"],
                json.dumps(q["choices"]) if q.get("choices") is not None else None,
                str(q["correct_answer"]), json.dumps(q["canonical_solution"]), q.get("status"),
                q.get("source_page"), q.get("source_note"), q.get("reviewed_by"), q.get("reviewed_at"))
    for q in p.q_add:
        cur.execute("""INSERT INTO questions
                         (id, lo_id, tier, question_type, stem, choices, correct_answer,
                          canonical_solution, status, source_page, source_note, reviewed_by,
                          reviewed_at, solution_version, source)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1, 'variant')""",
                    (q["id"], q["lo_id"], *vals(q)))
    for q, _, solution_changed in p.q_update:
        cur.execute("""UPDATE questions
                          SET tier = %s, question_type = %s, stem = %s, choices = %s,
                              correct_answer = %s, canonical_solution = %s, status = %s,
                              source_page = %s, source_note = %s, reviewed_by = %s, reviewed_at = %s,
                              solution_version = solution_version + %s
                        WHERE id = %s""", (*vals(q), 1 if solution_changed else 0, q["id"]))
    # parents last: a parent may itself be a row this replay adds
    for q in p.q_add + [u[0] for u in p.q_update]:
        cur.execute("""UPDATE questions SET parent_question_id = %s
                        WHERE id = %s AND parent_question_id IS DISTINCT FROM %s""",
                    (q.get("parent_question_id"), q["id"], q.get("parent_question_id")))
    for qid, choices in p.restamp.items():
        cur.execute("UPDATE questions SET choices = %s WHERE id = %s", (json.dumps(choices), qid))
    if p.q_delete:
        cur.execute("DELETE FROM questions WHERE id = ANY(%s)", (p.q_delete,))
    if p.ref_delete:
        cur.execute("DELETE FROM explanation_library WHERE id = ANY(%s)", (p.ref_delete,))
    if p.mc_delete:
        cur.execute("DELETE FROM misconceptions WHERE id = ANY(%s)", (p.mc_delete,))


def readback(cur, course: str, texts: dict[str, str], bundles: dict[str, dict]) -> list[str]:
    """Export the course as it now stands, with the restored files as the prior, and compare it
    with the restored files byte for byte. [] when identical."""
    cur.execute("SELECT node_id FROM node_subject WHERE course_id = %s ORDER BY node_id", (course,))
    los = [r[0] for r in cur.fetchall()]
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            now = egc.build_bundles(cur, los, lambda name: bundles[name])
    except egc.CatalogueDrift as exc:
        return [f"misconceptions.json: {exc}"]
    out = []
    for name in FILES:
        got = egc.dump(now[name])
        if got != texts[name]:
            a, b = texts[name].splitlines(), got.splitlines()
            at = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
            out.append(f"{name}: differs from line {at + 1} "
                       f"(export {a[at][:90] if at < len(a) else '<end>'!r}, "
                       f"database {b[at][:90] if at < len(b) else '<end>'!r})")
    return out


# ---- main ------------------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--course", required=True)
    ap.add_argument("--dir", required=True, type=Path,
                    help="the export: export-record.json and the three bundles it names")
    ap.add_argument("--dsn", default=os.environ.get("AINEXT_DB_DSN"))
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true",
                      help="every check and every write, in a transaction that is rolled back")
    mode.add_argument("--verify-only", action="store_true",
                      help="read only: does the course export to exactly these files?")
    args = ap.parse_args(argv)
    if not args.dsn:
        print("ERROR: pass --dsn or set AINEXT_DB_DSN", file=sys.stderr)
        return 1
    try:
        record, texts, bundles = read_export(args.dir, args.course)
    except Refused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    f = record["files"]
    say(f"export for {args.course} (book {record['book']}): "
        + ", ".join(f"{n} {f[n]['records']} record(s) sha256 {f[n]['sha256'][:12]}…" for n in FILES))
    say("   provenance: every file matches its export record")

    import psycopg
    conn = psycopg.connect(args.dsn)
    try:
        if args.verify_only:
            conn.read_only = True
            with conn.cursor() as cur:
                diff = readback(cur, args.course, texts, bundles)
            conn.rollback()
            if diff:
                print("READ-BACK: the course does NOT export to the restored files:", file=sys.stderr)
                for d in diff:
                    print(f"  x {d}", file=sys.stderr)
                return 3
            say(f"READ-BACK OK: {args.course} exports to exactly the restored files, byte for byte")
            return 0

        env = (os.environ.get("AINEXT_ENVIRONMENT") or "").strip().lower()
        if env != "mvp1" and not args.dry_run:
            print(f"REFUSED: AINEXT_ENVIRONMENT is {env or '<unset>'}, not 'mvp1'. Generated content "
                  "is bounded to the comparison environment (constitution III, ADR-0008).",
                  file=sys.stderr)
            return 2
        conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        with conn.cursor() as cur:
            try:
                p = plan(cur, args.course, record, bundles)
            except Refused as exc:
                conn.rollback()
                print(f"REFUSED: {exc}", file=sys.stderr)
                return 2
            say("what the replay does:")
            print_plan(p)
            if p.refusals:
                conn.rollback()
                print(f"\nREFUSED: {len(p.refusals)} problem(s); nothing was written:", file=sys.stderr)
                for r in p.refusals:
                    print(f"  x {r}", file=sys.stderr)
                return 2
            say("   students: nothing the replay removes or re-words is named by any student row")
            before = student_digest(cur)
            apply(cur, p)
            after = student_digest(cur)
            if after != before:
                conn.rollback()
                changed = [f"{a[0]}" for a, b in zip(before, after) if a != b]
                print(f"FAILED: the replay changed student rows ({', '.join(changed)}). Rolled back; "
                      "nothing was written. This is a defect — tell Samuel.", file=sys.stderr)
                return 3
            say(f"   students: all {len(before)} student tables identical before and after the "
                "replay (inside the transaction)")
            diff = readback(cur, args.course, texts, bundles)
            if diff:
                conn.rollback()
                print("READ-BACK FAILED: the replayed course does not export to the restored files. "
                      "Rolled back; nothing was written. Tell Samuel:", file=sys.stderr)
                for d in diff:
                    print(f"  x {d}", file=sys.stderr)
                return 3
            say(f"   read-back: {args.course} exports to exactly the restored files, byte for byte")
        if args.dry_run:
            conn.rollback()
            say("DRY RUN — every write above was rolled back; nothing was written")
        else:
            conn.commit()
            say(f"RESTORED — {args.course}'s generated content is the export's, row for row")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

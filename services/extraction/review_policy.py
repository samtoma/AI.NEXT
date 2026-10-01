"""Who may promote a question, and what a stamp means — one place for every loader (migration 035).

Samuel's answers 33 and 37 (2026-09-27, 2026-10-01; docs/WIP-g10-pilot/samuel-answers.md):

  * ONLY A HUMAN STAMP IS A REVIEW (33). `questions.reviewed_by` holds a human's stamp and nothing
    else. An AI check is recorded in `ai_checked_by` / `ai_checked_at` and is never a review; the
    console shows it as "AI-checked, awaiting human". Free text that is not a stamp ("stem fixed by
    orchestrator … — not Samuel", a bulk promotion) goes to `review_note`.
  * STUDENTS ALWAYS FULL, MATHS ONLY (37a). Everything extracted for a MATHS course is live to
    students as if reviewed; review stays internal (the console backlog is every item without a
    human stamp, 37b). On a maths question `status = 'review'` means ONLY "an automatic safety check
    blocks it", and `hold_reason` says which. Social Studies and Arabic keep their review queue
    (`review` with no reason = awaiting a human); sacred content stays sealed (ADR-0006) everywhere.
  * GATES AUTO-PASS DURING THE FAN-OUT (37c). A gate passed on the AI checks' recommendation is
    marked `auto-pass G<n> (AI recommendation)` — in `ai_checked_by`, never in `reviewed_by`.
  * BOOK PICTURE FOR NOW (37d). A figure no native type can draw yet is shown as the book's own
    image (a `book_image` stand-in visual) and the question goes live; it stays in the backlog as
    "needs native figure". A book picture that shows the question's unknown is never shown: the
    question stays held, `figure_reveals_answer`.
"""

from __future__ import annotations

import re

import book_config

# --- what an AI check is called -------------------------------------------------------------
AI_DUAL_CHECK = "ai dual-check"          # a book question two independent AI readings confirmed
AUTO_PASS = "auto-pass {gate} (AI recommendation)"
BULK_NOTE = "promoted without review: {stamp}"   # --approve-all, local-dev promotions: never a review

# --- why a question is held at 'review' (migration 035; the loaders' vocabulary) -------------
FIGURE_MISSING = "figure_missing"                # stem shows [figure]; no figure, no stand-in
FIGURE_REVEALS_ANSWER = "figure_reveals_answer"  # the only picture shows the unknown
KATEX_ERROR = "katex_error"                      # the maths does not render
ANSWER_MISMATCH = "answer_mismatch"              # the key disagrees with the book / the re-solve
UNANSWERABLE = "unanswerable"                    # the marker cannot mark the key
UNVERIFIED = "unverified"                        # the independent checks did not confirm the key
SACRED = "sacred"                                # ADR-0006's sealed gate
HUMAN_HOLD = "human_hold"                        # a human held it — no loader ever releases it

AUTOMATIC_HOLDS = frozenset({FIGURE_MISSING, FIGURE_REVEALS_ANSWER, KATEX_ERROR, ANSWER_MISMATCH,
                             UNANSWERABLE, UNVERIFIED, SACRED})
HOLD_REASONS = AUTOMATIC_HOLDS | {HUMAN_HOLD}

# Released by a later load when the cause is gone (the figure arrived, the key now checks): the
# reasons a loader derives from the bundle itself. SACRED is re-derived on every load too, but its
# release needs the passage approval the sacred gate reads — never this list alone.
LOADER_RELEASABLE = frozenset({FIGURE_MISSING, FIGURE_REVEALS_ANSWER, KATEX_ERROR, ANSWER_MISMATCH,
                               UNANSWERABLE, UNVERIFIED})


def auto_pass_by(gate: str) -> str:
    """The stamp an auto-passed gate leaves — in ai_checked_by, never reviewed_by."""
    return AUTO_PASS.format(gate=gate.upper())


def is_auto(stamp: str | None) -> bool:
    return bool(stamp) and stamp.lower().startswith("auto-pass ")


def subject_of(course_id: str | None) -> str | None:
    """The course's subject from its book config (books/*.json), or None for an unknown course."""
    if not course_id:
        return None
    return book_config.course_subjects().get(course_id)


def students_always_full(course_id: str | None) -> bool:
    """Answer 37a: a MATHS course serves everything extracted as if reviewed. Social Studies and
    Arabic do not; an unknown course does not (the safe default)."""
    return subject_of(course_id) == "math"


def require_review_columns(cur) -> None:
    """Refuse to write stamps the old way: every loader needs migration 035's columns."""
    cur.execute("""SELECT count(*) FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'questions'
                      AND column_name IN ('ai_checked_by', 'ai_checked_at', 'hold_reason', 'review_note')""")
    if cur.fetchone()[0] != 4:
        raise SystemExit("REFUSING: migration 035 (db/migrations/035-human-review-stamps.sql) is not applied — "
                         "the loaders write AI checks, hold reasons and notes to its columns, never into "
                         "reviewed_by. Apply the migrations first (deploy/apply-migrations.sh, scripts/local-dev.sh).")


def join_notes(*notes: str | None) -> str | None:
    """'a; b' without empties or repeats, None when nothing is left."""
    out: list[str] = []
    for n in notes:
        for part in (n or "").split("; "):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return "; ".join(out) or None


_FIG_MARK = " [held: figure missing]"
_AI_RE = re.compile(r"^\s*ai |\(pending [^)]*\)\s*$", re.I)
_BULK_RE = re.compile(r"^\s*local-(?:dev|docker)|\(poc bulk\)\s*$", re.I)
_PENDING_RE = re.compile(r"\s*\(pending [^)]*\)$", re.I)


def split_legacy_stamp(stamp: str | None) -> dict:
    """A pre-035 `reviewed_by` string split the way migration 035 splits it, for a RESTORE of an export
    written before 035: {reviewed_by, ai_checked_by, figure_hold, note}. A post-035 human stamp comes
    back unchanged as reviewed_by."""
    out = {"reviewed_by": None, "ai_checked_by": None, "figure_hold": False, "note": None}
    if not stamp:
        return out
    s = stamp
    if _FIG_MARK in s:
        out["figure_hold"] = True
        s = s.replace(_FIG_MARK, "")
    head, _, rest = s.partition("; ")
    head, rest = head.strip() or None, rest.strip() or None
    if rest and re.search(r"held: its figure is missing", rest, re.I):
        out["figure_hold"] = True
    notes = [rest]
    if head is None:
        pass
    elif _AI_RE.search(head):
        out["ai_checked_by"] = _PENDING_RE.sub("", head).strip()
    elif _BULK_RE.search(head):
        notes.insert(0, BULK_NOTE.format(stamp=head))
    else:
        out["reviewed_by"] = head
    out["note"] = join_notes(*notes)
    return out

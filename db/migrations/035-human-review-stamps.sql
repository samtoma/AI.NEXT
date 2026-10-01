-- ===========================================================================
-- 035 — only a human stamp is a review; AI checks and hold reasons get their
--       own columns
--
-- Feature 003. Samuel's answer 33 (2026-09-27, "Only human stamps count"): a
-- question is reviewed only when a human signed it; AI-only checks show in the
-- console as "AI-checked, awaiting human"; nothing changes for students.
-- Answer 37 a–d (2026-10-01): for a MATHS course everything extracted is live
-- to students as if reviewed, review stays internal (the console backlog is
-- every item without a human stamp), and `status = 'review'` on a maths
-- question now means only "blocked by an automatic safety check", with a
-- machine reason. Social Studies and Arabic keep their review queue; sacred
-- content stays sealed (ADR-0006) — this file changes no status.
--
-- Additive and idempotent. Safe to re-run; `deploy/apply-migrations.sh` does,
-- on every deploy, in filename order, while the previous app is still serving.
-- Rollback: `rollback/035-human-review-stamps.down.sql`.
-- ===========================================================================
--
-- WHY. Until now `questions.reviewed_by` carried four different kinds of
-- string, and every reader treated "not NULL" as "a human read it":
--
--   * a human's stamp            "Samuel Toma (G2 accept)", "<who> (sampled)",
--                                "<who> (family <tpl> via <qid>)"
--   * an AI check                "ai dual-check (pending Samuel)" — written by
--                                load_seed.py on every verified book question
--   * a bulk / dev promotion     "samuel (poc bulk)" (--approve-all, "explicitly
--                                not a real review"), "local-dev", "local-docker",
--                                "local-dev (dry run)", "local-dev (pilot scratch)"
--   * annotations glued on       " [held: figure missing]" (the loader's figure
--                                gate), "; held: its figure is missing" (G2 on a
--                                figureless item), "; stem fixed by orchestrator
--                                (data-engineer agent), … — not Samuel"
--
-- So the console could not tell "a human signed this" from "two AI readings
-- agreed", and ADR-0019's revocation query (`reviewed_by IS NULL` = unread by
-- a human) silently skipped every AI-stamped row. After this file:
--
--   reviewed_by, reviewed_at   a HUMAN stamp, and nothing else. NULL = no human
--                              has signed this item = it is in the console's
--                              review backlog (answer 37b).
--   ai_checked_by, _at         the automatic check that passed it: "ai
--                              dual-check" (two independent AI readings agreed
--                              with the book), "auto-pass G<n> (AI
--                              recommendation)" (a gate the fan-out passed on
--                              the AI checks' recommendation, answer 37c). Never
--                              a review; the console shows it as "AI-checked,
--                              awaiting human".
--   hold_reason                why an AUTOMATIC SAFETY CHECK keeps a question at
--                              'review' (never set on a live row — CHECK below).
--                              The loaders' vocabulary, not a CHECK list (034's
--                              lesson: a value list needs widening):
--                                figure_missing         stem shows a figure; no
--                                                       figure and no stand-in
--                                figure_reveals_answer  the only picture draws
--                                                       the unknown (withheld)
--                                katex_error            the maths does not render
--                                answer_mismatch        answer key != the book's
--                                unanswerable           the marker cannot mark the key
--                                unverified             the independent checks did
--                                                       not confirm the key
--                                sacred                 ADR-0006's sealed gate
--                                human_hold             a human held it (G2 hold,
--                                                       G3 "fix") — the one reason
--                                                       no loader ever releases
--                              NULL on a 'review' row of Social Studies or Arabic
--                              means what it always meant there: awaiting a human.
--   review_note                free text that is not a stamp: who else changed
--                              the item ("stem fixed by orchestrator … — not
--                              Samuel"), a G2 note, a bulk promotion
--                              ("promoted without review: samuel (poc bulk)").
--
-- THE BACKFILL splits every legacy string into those columns, once:
--   1. " [held: figure missing]" is removed; a 'review' row gets
--      hold_reason = 'figure_missing' (the figure gate's own mark).
--   2. "<stamp>; <note>; <note>" — the first segment is the stamp, the rest go
--      to review_note verbatim ("held: its figure is missing" also sets
--      hold_reason = 'figure_missing' on a 'review' row).
--   3. The stamp is classified: "ai …" or "… (pending <name>)" → ai_checked_by
--      (the "(pending …)" suffix dropped: a NULL reviewed_by now says it),
--      ai_checked_at = the old reviewed_at; "local-dev …" or "… (poc bulk)" →
--      review_note "promoted without review: <stamp>"; anything else is a human
--      stamp and stays in reviewed_by, reviewed_at untouched.
-- A re-run finds nothing to split (no legacy string survives step 1–3), so it
-- changes nothing. A loader of the PREVIOUS build that writes a legacy string
-- between this file and the new build is split on the next deploy's re-run.
--
-- NOTHING ANY STUDENT SEES CHANGES: no status is written here. The only
-- student-adjacent reader, the attempts route's `solution_reviewed` (an
-- analytics property, SC-011), now reports what it always claimed to report —
-- whether a human read the solution.
--
-- GRANTS: none needed on `questions`. 017's table-level SELECT (ainext_app,
-- ainext_operator), INSERT (ainext_app, materialised widgets) and UPDATE
-- (ainext_operator, the console's review gate) cover columns added later.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_checked_by text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS ai_checked_at timestamptz;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS hold_reason   text;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS review_note   text;

COMMENT ON COLUMN questions.reviewed_by IS
  'A HUMAN reviewer''s stamp and nothing else (answer 33, migration 035). NULL = '
  'no human has signed this item: it is in the console review backlog.';
COMMENT ON COLUMN questions.ai_checked_by IS
  'The automatic check that passed this item ("ai dual-check", "auto-pass G3 '
  '(AI recommendation)"). Never a review (migration 035).';
COMMENT ON COLUMN questions.hold_reason IS
  'Why an automatic safety check holds this question at review (figure_missing, '
  'figure_reveals_answer, katex_error, answer_mismatch, unanswerable, unverified, '
  'sacred) or human_hold. Never set on a live row (migration 035).';
COMMENT ON COLUMN questions.review_note IS
  'Free-text review annotations that are not a stamp (migration 035).';

-- ---------------------------------------------------------------------------
-- 2. The backfill — split every legacy reviewed_by string, once
-- ---------------------------------------------------------------------------

WITH src AS (
  SELECT id,
         strpos(reviewed_by, ' [held: figure missing]') > 0          AS fig_mark,
         replace(reviewed_by, ' [held: figure missing]', '')         AS r1
    FROM questions
   WHERE reviewed_by IS NOT NULL
     AND (   strpos(reviewed_by, ' [held: figure missing]') > 0
          OR strpos(reviewed_by, '; ') > 0
          OR reviewed_by ~* '^\s*ai '
          OR reviewed_by ~* '\(pending [^)]*\)\s*$'
          OR reviewed_by ~* '^\s*local-(dev|docker)'
          OR reviewed_by ~* '\(poc bulk\)\s*$')
), parts AS (
  SELECT id, fig_mark,
         nullif(btrim(split_part(r1, '; ', 1)), '')                                 AS stamp,
         nullif(btrim(substr(r1, length(split_part(r1, '; ', 1)) + 3)), '')         AS notes
    FROM src
), cls AS (
  SELECT id, fig_mark, stamp, notes,
         CASE WHEN stamp IS NULL                                        THEN 'none'
              WHEN stamp ~* '^ai ' OR stamp ~* '\(pending [^)]*\)$'     THEN 'ai'
              WHEN stamp ~* '^local-(dev|docker)' OR stamp ~* '\(poc bulk\)$'    THEN 'bulk'
              ELSE 'human' END                                          AS kind
    FROM parts
)
UPDATE questions q
   SET reviewed_by   = CASE WHEN c.kind = 'human' THEN c.stamp END,
       reviewed_at   = CASE WHEN c.kind = 'human' THEN q.reviewed_at END,
       ai_checked_by = CASE WHEN c.kind = 'ai'
                            THEN coalesce(q.ai_checked_by,
                                          btrim(regexp_replace(c.stamp, '\s*\(pending [^)]*\)$', '')))
                            ELSE q.ai_checked_by END,
       ai_checked_at = CASE WHEN c.kind = 'ai' THEN coalesce(q.ai_checked_at, q.reviewed_at)
                            ELSE q.ai_checked_at END,
       hold_reason   = CASE WHEN q.status = 'review' AND q.hold_reason IS NULL
                                 AND (c.fig_mark OR coalesce(c.notes, '') ~* 'held: its figure is missing')
                            THEN 'figure_missing' ELSE q.hold_reason END,
       review_note   = nullif(concat_ws('; ',
                                        q.review_note,
                                        CASE WHEN c.kind = 'bulk'
                                             THEN 'promoted without review: ' || c.stamp END,
                                        c.notes), '')
  FROM cls c
 WHERE q.id = c.id;

-- A human's G2 "hold" is the one hold no loader may release (it was a person's call, not a
-- check's). Before 035 it was only readable from the stamp; give it its reason, once.
UPDATE questions
   SET hold_reason = 'human_hold'
 WHERE status = 'review' AND hold_reason IS NULL AND reviewed_by ~ '\(G2 hold\)$';

-- ---------------------------------------------------------------------------
-- 3. A live question never carries a hold reason
-- ---------------------------------------------------------------------------
-- Structural, not a value list (034's rule), so it never needs widening.
-- Created only when the catalogue says it is missing (030's idiom): a re-run
-- takes no lock and re-validates nothing. The backfill above sets a reason only
-- on 'review' rows, so the first run validates cleanly.

DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.questions'::regclass
                    AND conname = 'questions_held_not_live') THEN
    ALTER TABLE questions ADD CONSTRAINT questions_held_not_live
      CHECK (hold_reason IS NULL OR status <> 'live');
  END IF;
END
$check$;

-- ---------------------------------------------------------------------------
-- 4. Verification — asserted, not assumed
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  legacy int;
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'questions'
         AND column_name IN ('ai_checked_by', 'ai_checked_at', 'hold_reason', 'review_note')) <> 4 THEN
    RAISE EXCEPTION '035: a review column is missing on questions';
  END IF;

  SELECT count(*) INTO legacy FROM questions
   WHERE reviewed_by IS NOT NULL
     AND (   strpos(reviewed_by, ' [held: figure missing]') > 0
          OR strpos(reviewed_by, '; ') > 0
          OR reviewed_by ~* '^\s*ai '
          OR reviewed_by ~* '\(pending [^)]*\)\s*$'
          OR reviewed_by ~* '^\s*local-(dev|docker)'
          OR reviewed_by ~* '\(poc bulk\)\s*$');
  IF legacy > 0 THEN
    RAISE EXCEPTION '035: % reviewed_by value(s) still carry an AI, bulk or annotated stamp', legacy;
  END IF;

  -- The console promotes and holds through these columns; the student surface
  -- only reads them.
  IF NOT has_column_privilege('ainext_operator', 'questions', 'hold_reason', 'UPDATE')
     OR NOT has_column_privilege('ainext_operator', 'questions', 'reviewed_by', 'UPDATE')
     OR NOT has_column_privilege('ainext_app', 'questions', 'hold_reason', 'SELECT') THEN
    RAISE EXCEPTION '035: the review columns are not readable by ainext_app / writable by ainext_operator';
  END IF;

  RAISE NOTICE '035 review stamps: % human-stamped, % AI-checked only, % held by a safety check, % annotated',
    (SELECT count(*) FROM questions WHERE reviewed_by IS NOT NULL),
    (SELECT count(*) FROM questions WHERE reviewed_by IS NULL AND ai_checked_by IS NOT NULL),
    (SELECT count(*) FROM questions WHERE hold_reason IS NOT NULL),
    (SELECT count(*) FROM questions WHERE review_note IS NOT NULL);
END
$verify$;

COMMIT;

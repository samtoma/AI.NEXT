-- ===========================================================================
-- 042 — `lesson_saves`: where a student left a lesson, on the server (FR-204)
--
-- GitHub issue #25. Additive and idempotent. Safe to re-run;
-- `scripts/local-dev.sh` does, and `deploy/apply-migrations.sh` does on every
-- deploy, in filename order, one transaction per file.
-- Rollback: `rollback/042-lesson-saves.down.sql`.
-- ===========================================================================
--
-- Before this the place lived in the browser's `localStorage` for seven days:
-- one device only, gone on sign-out, gone after a week. The product owner's
-- calls (2026-10-26) are what this table encodes:
--
--  · The place lives ONLY here. There is no browser fallback; old browser
--    saves are not migrated, and the client clears the legacy
--    `ainext-lesson:*` keys when it reads.
--  · NO EXPIRY. A row stays until the student starts the lesson over or
--    completes it (both DELETE), or her student row goes (CASCADE).
--  · It survives sign-out: the place belongs to the student account, not the
--    device.
--  · Two devices, one lesson: the most recent save wins. One row per
--    (student, environment, mode, lesson); every save is an upsert and
--    `updated_at` is the server's clock at that write.
--  · Lessons only — not homework, not the home chat.
--
-- MINORS' DATA (constitution, "minimum only"). The payload is what resume
-- needs and nothing else: the transcript the student has already seen in
-- this lesson, the board items, the focused board key, the covered LO ids,
-- the sitting id and whether she finished early. No new personal data — no
-- name, grade, interests, device, IP or user agent is stored here. The
-- transcript is the same text `sessions`/`turns` already hold for the sitting.
-- The shape is checked by the route (`lib/lesson-resume.ts`
-- `validateSavePayload`) and capped in size there; the CHECK below is a
-- backstop, not the rule.
--
-- SHAPE
--  · `environment` NOT NULL with NO default (FR-2109): the writer names its
--    stack, so a save can never be pooled across environments.
--  · `mode`/`lesson_slug` mirror `LessonMode` and `lib/lesson-slug.ts` SLUG_RE.
--    The slug is not an FK — a lesson is a lexical group of LOs, not a row
--    (same reason as migration 028).
--  · `payload_version` is the payload's own `v`, kept as a column so a later
--    shape change can find old rows without parsing every document.
--  · `student_id ... ON DELETE CASCADE`: a place means nothing without its
--    student, and the smoke scripts delete test students through ainext_maint.
--
-- GRANTS. `ainext_app` SELECT/INSERT/UPDATE/DELETE — read on open, upsert as
-- the lesson goes, delete on Start over and on completing the lesson.
-- `ainext_maint` ALL. `ainext_operator` NOTHING: no console surface reads a
-- child's in-progress transcript from here; when one wants to, it adds the
-- grant, the policy and its CROSS_STUDENT_READS entry together (028's rule).
--
-- ROW-LEVEL SECURITY, ENABLE + FORCE, one per-student policy (ADR-0012,
-- migration 017's shape), guarded by catalogue checks so a re-run on a live
-- deploy takes no ACCESS EXCLUSIVE lock when nothing differs (028's pattern).

CREATE TABLE IF NOT EXISTS lesson_saves (
  student_id       BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  environment      TEXT   NOT NULL,
  mode             TEXT   NOT NULL CHECK (mode IN ('learn','review')),
  lesson_slug      TEXT   NOT NULL CHECK (lesson_slug ~ '^[a-z0-9]{1,12}-[0-9]{1,3}$'),
  payload_version  SMALLINT NOT NULL,
  payload          JSONB  NOT NULL
                   CHECK (jsonb_typeof(payload) = 'object'
                          AND octet_length(payload::text) <= 2097152),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, environment, mode, lesson_slug)
);

COMMENT ON TABLE lesson_saves IS
  'FR-204 / issue #25: where a student left a lesson, so any device offers Continue / Start over. One row per (student, environment, mode, lesson); upsert, most recent wins. No expiry; deleted on Start over and on completing the lesson. Minimum data: seen transcript, board, focus, covered LOs, sitting id, endedEarly. Student data: RLS forced (ADR-0012).';
COMMENT ON COLUMN lesson_saves.payload IS
  'lib/lesson-resume.ts SavedSession minus `at` (read back from updated_at). Shape validated and size-capped by the route; this CHECK is only a backstop.';
COMMENT ON COLUMN lesson_saves.updated_at IS
  'Server clock at the latest save. "Most recent save wins" across devices.';

-- --- grants ------------------------------------------------------------------
REVOKE ALL ON lesson_saves FROM ainext_app, ainext_operator;
GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_saves TO ainext_app;
GRANT ALL PRIVILEGES                 ON lesson_saves TO ainext_maint;

-- --- row-level security (ADR-0012), guarded so a re-run locks nothing ---------
DO $rls$
DECLARE
  want_qual text := '(student_id = (NULLIF(current_setting(''app.student_id''::text, true), ''''::text))::bigint)';
  have_qual text;
  have_check text;
  have_roles name[];
  have_cmd text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class
           WHERE oid = 'public.lesson_saves'::regclass) THEN
    ALTER TABLE lesson_saves ENABLE ROW LEVEL SECURITY;
  END IF;
  IF NOT (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = 'public.lesson_saves'::regclass) THEN
    ALTER TABLE lesson_saves FORCE ROW LEVEL SECURITY;
  END IF;

  SELECT qual, with_check, roles, cmd
    INTO have_qual, have_check, have_roles, have_cmd
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'lesson_saves'
     AND policyname = 'lesson_saves_app';
  IF NOT FOUND
     OR have_cmd IS DISTINCT FROM 'ALL'
     OR have_roles IS DISTINCT FROM ARRAY['ainext_app']::name[]
     OR have_qual IS DISTINCT FROM want_qual
     OR have_check IS DISTINCT FROM want_qual THEN
    DROP POLICY IF EXISTS lesson_saves_app ON lesson_saves;
    CREATE POLICY lesson_saves_app ON lesson_saves FOR ALL TO ainext_app
      USING      (student_id = nullif(current_setting('app.student_id', true), '')::bigint)
      WITH CHECK (student_id = nullif(current_setting('app.student_id', true), '')::bigint);
  END IF;
END
$rls$;

-- --- verify ------------------------------------------------------------------
DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity
            FROM pg_class WHERE oid = 'public.lesson_saves'::regclass) THEN
    RAISE EXCEPTION
      'lesson_saves needs ENABLE *and* FORCE row level security (ADR-0012)';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'lesson_saves') <> 1 THEN
    RAISE EXCEPTION
      'lesson_saves must carry exactly one policy, lesson_saves_app';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'lesson_saves'
         AND column_name = 'environment') IS NOT NULL THEN
    RAISE EXCEPTION 'lesson_saves.environment must have no default (FR-2109)';
  END IF;
  IF NOT has_table_privilege('ainext_app', 'lesson_saves', 'SELECT')
     OR NOT has_table_privilege('ainext_app', 'lesson_saves', 'INSERT')
     OR NOT has_table_privilege('ainext_app', 'lesson_saves', 'UPDATE')
     OR NOT has_table_privilege('ainext_app', 'lesson_saves', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_app cannot read, save or discard a lesson place — resume would '
      'silently stop working for everybody';
  END IF;
  IF has_table_privilege('ainext_operator', 'lesson_saves', 'SELECT')
     OR has_table_privilege('ainext_operator', 'lesson_saves', 'INSERT')
     OR has_table_privilege('ainext_operator', 'lesson_saves', 'UPDATE')
     OR has_table_privilege('ainext_operator', 'lesson_saves', 'DELETE') THEN
    RAISE EXCEPTION
      'ainext_operator holds a privilege on lesson_saves. No console surface '
      'reads it; a read belongs with the surface that needs it and its entry '
      'in lib/auth/authorize.ts CROSS_STUDENT_READS';
  END IF;
  RAISE NOTICE 'lesson_saves: ready';
END
$verify$;

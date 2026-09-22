-- ===========================================================================
-- 018 — the grant migration 017 missed: the `node_subject` VIEW
--
-- ADR-0014 (the console as a second build target) · ADR-0012 (RLS roles)
-- Additive and idempotent. Safe to re-run; `scripts/local-dev.sh` does.
-- ===========================================================================
--
-- WHAT IS WRONG TODAY. Migration 017 enumerates its content grants by table:
--
--   GRANT SELECT ON graph_nodes, graph_edges, questions, visuals, misconceptions,
--                   explanation_library, source_documents, extraction_runs
--     TO ainext_app, ainext_operator;
--
-- `node_subject` — a VIEW created in 006 and redefined in 007, which derives a
-- learning objective's subject from its course lineage — is in neither that
-- list nor any other. `ainext_maint` picked it up incidentally
-- (`GRANT ALL PRIVILEGES ON ALL TABLES`, which in Postgres includes views), so
-- the loaders and the parity check never noticed. Nothing else has it:
--
--   SELECT relname, has_table_privilege('ainext_app', oid, 'SELECT')
--     FROM pg_class WHERE relkind = 'v';   ->  node_subject | f
--
-- The consequence is live on the student build right now: `/spine` answers
-- **500, "permission denied for view node_subject"**, because `lib/queries.ts`
-- reads it inside `withPrincipal`. It is not a console defect and it predates
-- this phase — it appeared the moment ADR-0012's repoint moved the application
-- off a superuser connection — but the console needs the same grant for any
-- view that resolves a subject, so it is fixed here rather than reported and
-- left.
--
-- WHY THIS IS NOT A WIDENING, which matters because 017 is deliberately narrow.
-- `node_subject` is defined entirely over `graph_nodes` and `graph_edges`, and
-- both roles already hold SELECT on both. The view exposes nothing either role
-- cannot already compute from the tables it can read; it exposes it in one
-- statement instead of four. No student-scoped table is involved, the view has
-- no RLS of its own, and no policy is relaxed by this file.
--
-- Views are not automatically covered by a table grant in Postgres, and a
-- `GRANT ... ON ALL TABLES` would sweep in every future table as well — which
-- is exactly the blanket 017 refused. So this names the one relation it means.
-- A view added later needs a line here; that is the cost of the narrow grant,
-- and it is the cheaper of the two mistakes.

BEGIN;

GRANT SELECT ON node_subject TO ainext_app, ainext_operator;

DO $verify$
BEGIN
  IF NOT has_table_privilege('ainext_app', 'node_subject', 'SELECT')
     OR NOT has_table_privilege('ainext_operator', 'node_subject', 'SELECT') THEN
    RAISE EXCEPTION 'node_subject is still unreadable by ainext_app / ainext_operator';
  END IF;
  RAISE NOTICE 'node_subject: SELECT granted to ainext_app and ainext_operator';
END
$verify$;

COMMIT;

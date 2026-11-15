-- SUPERSEDED (2026-11-15). Do not apply. Its policy rollback is now 016_member_owner_rls.rollback.prepared.sql.
-- Replaced by 015b_member_reader_functions.prepared.sql (reader and statistics
-- functions) and 016_member_owner_rls.prepared.sql (+ rollback), because
-- owner-bound RLS before the statistics switch would break multi-member
-- statistics.read. This file only stops.
DO $superseded$
BEGIN
  RAISE EXCEPTION 'superseded: apply 015b then 016 instead';
END
$superseded$;

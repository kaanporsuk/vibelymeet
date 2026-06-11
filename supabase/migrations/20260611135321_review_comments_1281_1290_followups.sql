-- Follow-ups for Codex review comments on merged PRs #1281-#1290.
--
-- PR #1285 added entry-named public RPC wrappers that web and native clients call
-- immediately. Because that migration is already applied, this forward migration
-- only reloads the PostgREST schema cache so warm deployments discover the
-- existing `video_session_continue_entry_v2` and
-- `video_session_entry_auto_promote_v2` signatures without rewriting history.

DO $$
BEGIN
  IF to_regprocedure('public.video_session_continue_entry_v2(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.video_session_continue_entry_v2(uuid,text,text)';
  END IF;

  IF to_regprocedure('public.video_session_entry_auto_promote_v2(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing public.video_session_entry_auto_promote_v2(uuid,text,text)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

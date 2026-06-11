CREATE TRIGGER emit_video_date_match_eta_hint_v2 AFTER UPDATE OF ready_gate_status ON public.video_sessions FOR EACH ROW EXECUTE FUNCTION emit_video_date_match_eta_hint_v2();

CREATE TRIGGER enforce_one_active_video_session_before_write BEFORE INSERT OR UPDATE OF participant_1_id, participant_2_id, ended_at, state, phase ON public.video_sessions FOR EACH ROW EXECUTE FUNCTION enforce_one_active_video_session();

CREATE TRIGGER trg_video_sessions_terminal_audit_stamp BEFORE INSERT OR UPDATE ON public.video_sessions FOR EACH ROW EXECUTE FUNCTION video_date_terminal_audit_stamp_v1();

CREATE TRIGGER video_session_refund_on_end AFTER UPDATE OF ended_reason ON public.video_sessions FOR EACH ROW WHEN (((new.ended_reason IS NOT NULL) AND (new.ended_reason IS DISTINCT FROM old.ended_reason) AND (new.refund_status IS NULL))) EXECUTE FUNCTION video_session_refund_on_end_trigger();


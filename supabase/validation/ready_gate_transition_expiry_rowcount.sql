-- Read-only validation pack for Ready Gate transition expiry/rowcount hardening.
-- Safe for production catalog verification after the migration is applied.

with fn as (
  select
    p.oid,
    pg_get_functiondef(p.oid) as def,
    p.prosecdef,
    p.proconfig
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ready_gate_transition'
    and pg_get_function_identity_arguments(p.oid) = 'p_session_id uuid, p_action text, p_reason text'
)
select
  'ready_gate_transition_signature_security' as check_name,
  to_regprocedure('public.ready_gate_transition(uuid,text,text)') is not null
  and exists (
    select 1
    from fn
    where prosecdef
      and proconfig @> array['search_path=public']
  ) as ok;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'ready_gate_transition_locks_before_sensitive_checks' as check_name,
  position('FOR UPDATE' in def) > 0
  and position('ready_gate_expires_at <= v_now' in def) > position('FOR UPDATE' in def)
  and position('IF p_action IN (''mark_ready'', ''snooze'')' in def) > position('FOR UPDATE' in def)
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'mark_ready_and_snooze_reject_elapsed_gate_under_lock' as check_name,
  def like '%IF p_action IN (''mark_ready'', ''snooze'')%'
  and def like '%ready_gate_expires_at IS NOT NULL%'
  and def like '%ready_gate_expires_at <= v_now%'
  and def like '%ready_gate_status = ''expired''%'
  and def like '%''reason'', ''ready_gate_expired''%'
  and def like '%''error_code'', ''ready_gate_expired''%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'guarded_updates_check_rowcount' as check_name,
  length(def) - length(replace(def, 'GET DIAGNOSTICS v_row_count = ROW_COUNT', '')) >=
    length('GET DIAGNOSTICS v_row_count = ROW_COUNT') * 4
  and def like '%guarded_update_zero_rows%'
  and def like '%stale_transition%'
  and def like '%session_no_longer_ready_gate_mutable%'
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'terminal_idempotency_and_shape_preserved' as check_name,
  def like '%ready_gate_status IN (''forfeited'', ''expired'', ''both_ready'')%'
  and def like '%''success'', true%'
  and def like '%''status'', v_session.ready_gate_status%'
  and def like '%''ready_gate_expires_at'', v_session.ready_gate_expires_at%'
  and def like '%''terminal'', true%'
  and has_function_privilege('authenticated', 'public.ready_gate_transition(uuid,text,text)', 'EXECUTE')
  as ok
from fn;

with fn as (
  select pg_get_functiondef('public.ready_gate_transition(uuid,text,text)'::regprocedure) as def
)
select
  'observability_and_grace_preserved' as check_name,
  def like '%record_event_loop_observability%'
  and def like '%both_ready_provider_prepare_grace_extended%'
  and def like '%v_now + interval ''45 seconds''%'
  as ok
from fn;

with prior as (
  select
    to_regprocedure('public.ready_gate_transition_20260501190000_expiry_rowcount_prior(uuid,text,text)') as oid
)
select
  'prior_ready_gate_base_not_client_executable' as check_name,
  oid is not null
  and not has_function_privilege('anon', oid, 'EXECUTE')
  and not has_function_privilege('authenticated', oid, 'EXECUTE')
  as ok
from prior;

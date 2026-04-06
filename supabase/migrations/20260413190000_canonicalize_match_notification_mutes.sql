insert into public.match_notification_mutes (
  user_id,
  match_id,
  muted_until,
  created_at
)
select
  mm.user_id,
  mm.match_id,
  max(mm.muted_until) as muted_until,
  min(mm.created_at) as created_at
from public.match_mutes mm
group by mm.user_id, mm.match_id
on conflict (user_id, match_id) do update
set muted_until = case
  when public.match_notification_mutes.muted_until is null then excluded.muted_until
  when excluded.muted_until is null then public.match_notification_mutes.muted_until
  else greatest(public.match_notification_mutes.muted_until, excluded.muted_until)
end;

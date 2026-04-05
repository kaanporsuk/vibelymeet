alter table public.blocked_users
  add constraint blocked_users_blocker_id_profiles_fkey
  foreign key (blocker_id)
  references public.profiles(id)
  on delete cascade;

alter table public.blocked_users
  add constraint blocked_users_blocked_id_profiles_fkey
  foreign key (blocked_id)
  references public.profiles(id)
  on delete cascade;

alter table public.user_schedules
  add constraint user_schedules_user_id_profiles_fkey
  foreign key (user_id)
  references public.profiles(id)
  on delete cascade;

alter table public.user_reports
  add constraint user_reports_reporter_id_profiles_fkey
  foreign key (reporter_id)
  references public.profiles(id)
  on delete restrict;

alter table public.user_reports
  add constraint user_reports_reported_id_profiles_fkey
  foreign key (reported_id)
  references public.profiles(id)
  on delete restrict;

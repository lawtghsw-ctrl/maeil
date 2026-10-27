begin;

-- Read-only sharing. Never grant db.view_all: it also controls UPDATE/DELETE.
-- Existing tenant guards, writer restrictions and mutation policies stay intact.
create policy app_leads_long_absent_shared_read
on public.app_leads for select to authenticated
using (
  public.is_active_user()
  and law_firm_id = public.current_law_firm_id()
  and public.has_permission('db.view')
  and not public.is_writing_staff()
  and (
    data ->> 'detailStage' = '장기부재'
    or (
      (data -> 'detailStage' is null or data -> 'detailStage' = 'null'::jsonb)
      and data ->> 'status' = '종결_중단'
    )
  )
);

commit;

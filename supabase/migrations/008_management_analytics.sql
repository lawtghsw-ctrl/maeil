-- LawPower v28.11
-- Manager analytics / settlement settings
-- Adds one tenant-scoped JSON setting used by dashboard, settlements and analytics.

begin;

insert into public.firm_settings(law_firm_id,key,value)
select
  id,
  'management_analytics_v1',
  jsonb_build_object(
    'version',1,
    'acquisitionMode','direct_ads',
    'dbPurchaseUnitCost',0,
    'monthlyContractTarget',50,
    'activeDbCap',40,
    'neglectedDays',7,
    'minimumContactAttempts',5,
    'feeRules',jsonb_build_array(
      jsonb_build_object('id','fee-personal-rehab-2026-10-01','caseType','개인회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
      jsonb_build_object('id','fee-personal-bankruptcy-2026-10-01','caseType','개인파산','baseFee',3000000,'minFee',2600000,'approvalDiscountAmount',300000,'effectiveFrom','2026-10-01'),
      jsonb_build_object('id','fee-workout-2026-10-01','caseType','워크아웃','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
      jsonb_build_object('id','fee-corporate-rehab-2026-10-01','caseType','법인회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
      jsonb_build_object('id','fee-general-rehab-2026-10-01','caseType','일반회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
      jsonb_build_object('id','fee-other-2026-10-01','caseType','기타사건','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01')
    ),
    'staffCompensations','[]'::jsonb,
    'paymentFees',jsonb_build_array(
      jsonb_build_object('paymentMethod','단순분납','rate',0,'payer','해당 없음'),
      jsonb_build_object('paymentMethod','로피분납','rate',3,'payer','사무소 부담'),
      jsonb_build_object('paymentMethod','신카할부완납','rate',3.5,'payer','사무소 부담'),
      jsonb_build_object('paymentMethod','캐피탈분납','rate',5,'payer','사무소 부담')
    ),
    'adSpendEntries','[]'::jsonb,
    'fixedCosts',jsonb_build_array(
      jsonb_build_object('id','fixed-rent','label','임대료','monthlyAmount',0),
      jsonb_build_object('id','fixed-telecom','label','통신비','monthlyAmount',0),
      jsonb_build_object('id','fixed-crm','label','CRM · 솔루션','monthlyAmount',0)
    ),
    'monthClosings','{}'::jsonb
  )
from public.law_firms
on conflict(law_firm_id,key) do nothing;

-- New firms receive the manager setting automatically.
create or replace function public.initialize_firm_defaults()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.firm_settings(law_firm_id,key,value) values
    (new.id,'settlement_rates','{}'::jsonb),
    (new.id,'case_documents','{}'::jsonb),
    (new.id,'min_living_cost','{"sizes":{"1":1538543,"1.5":2029059,"2":2519575,"2.5":2867498,"3":3215422,"4":3896843},"extraPerPerson":0}'::jsonb),
    (new.id,'management_analytics_v1',jsonb_build_object(
      'version',1,'acquisitionMode','direct_ads','dbPurchaseUnitCost',0,
      'monthlyContractTarget',50,'activeDbCap',40,'neglectedDays',7,'minimumContactAttempts',5,
      'feeRules',jsonb_build_array(
        jsonb_build_object('id','fee-personal-rehab-2026-10-01','caseType','개인회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
        jsonb_build_object('id','fee-personal-bankruptcy-2026-10-01','caseType','개인파산','baseFee',3000000,'minFee',2600000,'approvalDiscountAmount',300000,'effectiveFrom','2026-10-01'),
        jsonb_build_object('id','fee-workout-2026-10-01','caseType','워크아웃','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
        jsonb_build_object('id','fee-corporate-rehab-2026-10-01','caseType','법인회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
        jsonb_build_object('id','fee-general-rehab-2026-10-01','caseType','일반회생','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01'),
        jsonb_build_object('id','fee-other-2026-10-01','caseType','기타사건','baseFee',4000000,'minFee',3400000,'approvalDiscountAmount',400000,'effectiveFrom','2026-10-01')
      ),
      'staffCompensations','[]'::jsonb,
      'paymentFees',jsonb_build_array(
        jsonb_build_object('paymentMethod','단순분납','rate',0,'payer','해당 없음'),
        jsonb_build_object('paymentMethod','로피분납','rate',3,'payer','사무소 부담'),
        jsonb_build_object('paymentMethod','신카할부완납','rate',3.5,'payer','사무소 부담'),
        jsonb_build_object('paymentMethod','캐피탈분납','rate',5,'payer','사무소 부담')
      ),
      'adSpendEntries','[]'::jsonb,
      'fixedCosts',jsonb_build_array(
        jsonb_build_object('id','fixed-rent','label','임대료','monthlyAmount',0),
        jsonb_build_object('id','fixed-telecom','label','통신비','monthlyAmount',0),
        jsonb_build_object('id','fixed-crm','label','CRM · 솔루션','monthlyAmount',0)
      ),
      'monthClosings','{}'::jsonb
    ))
  on conflict do nothing;

  insert into public.firm_meta_event_rules(law_firm_id,trigger_type,trigger_value,event_name,enabled) values
    (new.id,'detail_stage','예약','Schedule',false),
    (new.id,'detail_stage','상담','Contact',false),
    (new.id,'status','수임전환','CompleteRegistration',false)
  on conflict do nothing;
  return new;
end;
$$;

-- SUPER_ADMIN may read/write any firm's manager setting.
-- FIRM_ADMIN may read/write its own manager setting.
-- Existing staff access to legacy settings remains unchanged.
drop policy if exists firm_settings_read on public.firm_settings;
drop policy if exists firm_settings_insert on public.firm_settings;
drop policy if exists firm_settings_update on public.firm_settings;

create policy firm_settings_read
on public.firm_settings for select to authenticated
using (
  public.is_super_admin()
  or (
    public.is_active_user()
    and law_firm_id = public.current_law_firm_id()
    and (
      public.is_admin_user()
      or (key='settlement_rates' and public.has_any_permission(array['settlements.view','settlement_settings.view']))
      or (key='min_living_cost' and public.has_any_permission(array['living.view','db.view_consultation','db.edit_consultation']))
      or (key='case_documents' and public.has_permission('cases.send_docs'))
      or (key='management_analytics_v1' and public.is_firm_admin())
    )
  )
);

create policy firm_settings_insert
on public.firm_settings for insert to authenticated
with check (
  public.is_super_admin()
  or (
    public.is_active_user()
    and law_firm_id = public.current_law_firm_id()
    and (
      (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
      or (key='case_documents' and public.has_permission('cases.send_docs'))
      or (key='min_living_cost' and public.has_permission('living.edit'))
      or (key='management_analytics_v1' and public.is_firm_admin())
    )
  )
);

create policy firm_settings_update
on public.firm_settings for update to authenticated
using (
  public.is_super_admin()
  or (
    public.is_active_user()
    and law_firm_id = public.current_law_firm_id()
    and (
      (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
      or (key='case_documents' and public.has_permission('cases.send_docs'))
      or (key='min_living_cost' and public.has_permission('living.edit'))
      or (key='management_analytics_v1' and public.is_firm_admin())
    )
  )
)
with check (
  public.is_super_admin()
  or (
    public.is_active_user()
    and law_firm_id = public.current_law_firm_id()
    and (
      (key='settlement_rates' and public.has_permission('settlement_settings.edit'))
      or (key='case_documents' and public.has_permission('cases.send_docs'))
      or (key='min_living_cost' and public.has_permission('living.edit'))
      or (key='management_analytics_v1' and public.is_firm_admin())
    )
  )
);

commit;

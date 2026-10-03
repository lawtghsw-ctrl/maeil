-- LawPower v28.6 POST-CHECK
select column_name, data_type, column_default
from information_schema.columns
where table_schema='public'
  and table_name='meta_event_queue'
  and column_name in ('crm_status','crm_stage','event_time')
order by column_name;

select
  f.name as law_firm,
  r.trigger_type,
  r.trigger_value,
  r.event_name,
  r.enabled
from public.firm_meta_event_rules r
join public.law_firms f on f.id=r.law_firm_id
order by f.name, r.trigger_type, r.trigger_value, r.event_name;

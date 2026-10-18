-- Additive per-firm e-sign connections. No existing CRM/settings rows changed.
create table public.platform_firm_esign_connections (
  id uuid primary key default gen_random_uuid(),
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  active boolean not null default true,
  company_id text not null,
  credentials_ciphertext text not null,
  templates jsonb not null check (jsonb_typeof(templates) = 'array' and jsonb_array_length(templates) between 1 and 20),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create unique index platform_firm_esign_active on public.platform_firm_esign_connections(law_firm_id) where active;

create table public.platform_firm_esign_documents (
  case_id text primary key references public.app_cases(id) on delete cascade,
  law_firm_id uuid not null references public.law_firms(id) on delete cascade,
  connection_id uuid references public.platform_firm_esign_connections(id) on delete restrict,
  credential_source text not null check (credential_source in ('connection','legacy_env')),
  company_id text,
  document_id text,
  status text not null default 'requesting' check (status in ('requesting','created','unknown')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check ((credential_source = 'connection' and connection_id is not null) or (credential_source = 'legacy_env' and connection_id is null))
);
create unique index platform_firm_esign_document_identity on public.platform_firm_esign_documents(company_id, document_id) where document_id is not null;
alter table public.platform_firm_esign_connections enable row level security;
alter table public.platform_firm_esign_documents enable row level security;
revoke all on public.platform_firm_esign_connections, public.platform_firm_esign_documents from public, anon, authenticated;
grant select, insert, update, delete on public.platform_firm_esign_connections, public.platform_firm_esign_documents to service_role;

create function public.replace_firm_esign_connection(p_law_firm_id uuid, p_company_id text, p_credentials_ciphertext text, p_templates jsonb, p_updated_by uuid, p_expected_connection_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_current uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_law_firm_id::text, 2468));
  select id into v_current from public.platform_firm_esign_connections where law_firm_id=p_law_firm_id and active;
  if v_current is distinct from p_expected_connection_id then raise exception 'ESIGN_CONNECTION_CONFLICT'; end if;
  update public.platform_firm_esign_connections set active=false where law_firm_id=p_law_firm_id and active;
  insert into public.platform_firm_esign_connections(law_firm_id,company_id,credentials_ciphertext,templates,updated_by)
  values(p_law_firm_id,p_company_id,p_credentials_ciphertext,p_templates,p_updated_by) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.replace_firm_esign_connection(uuid,text,text,jsonb,uuid,uuid) from public, anon, authenticated;
grant execute on function public.replace_firm_esign_connection(uuid,text,text,jsonb,uuid,uuid) to service_role;

-- Snapshot only the existing legacy document ownership. Source CRM JSON is
-- untouched; future client changes to a document ID cannot change this binding.
insert into public.platform_firm_esign_documents(case_id,law_firm_id,credential_source,document_id,status)
select id,law_firm_id,'legacy_env',btrim(data->>'eformsignDocumentId'),'created'
from public.app_cases
where law_firm_id='0a5900a4-48b3-4503-8c9b-3979c7d2d95c'
  and nullif(btrim(data->>'eformsignDocumentId'),'') is not null;

create function public.merge_firm_esign_case_metadata(p_case_id text, p_law_firm_id uuid, p_metadata jsonb)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if jsonb_typeof(p_metadata) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_metadata) k where k not in ('eformsignDocumentId','eformsignStatus','eformsignStatusCode','eformsignSentAt','eformsignCheckedAt','eformsignError','eformsignLawFirmId','eformsignConnectionId')
  ) then raise exception 'Invalid e-sign metadata'; end if;
  update public.app_cases set data=coalesce(data,'{}'::jsonb) || p_metadata
  where id=p_case_id and law_firm_id=p_law_firm_id;
  if not found then raise exception 'Case not found'; end if;
end;
$$;
revoke all on function public.merge_firm_esign_case_metadata(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.merge_firm_esign_case_metadata(text,uuid,jsonb) to service_role;

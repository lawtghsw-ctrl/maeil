-- Additive, service-role-only advertising reporting storage. Existing CAPI,
-- CRM, settings, billing and messaging data are not modified.
create table public.platform_meta_insights_tokens (
  meta_account_id uuid primary key references public.firm_meta_accounts(id) on delete cascade,
  access_token_ciphertext text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create table public.platform_meta_insights_cache (
  account_id text not null check (account_id ~ '^[0-9]{3,30}$'),
  range_start date not null,
  range_end date not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  snapshot jsonb,
  last_error text,
  last_attempt_at timestamptz not null default now(),
  primary key (account_id, range_start, range_end, fingerprint),
  check (range_end >= range_start and range_end - range_start <= 92),
  check (snapshot is null or jsonb_typeof(snapshot) = 'object'),
  check (last_error is null or length(last_error) <= 1000)
);

alter table public.platform_meta_insights_tokens enable row level security;
alter table public.platform_meta_insights_cache enable row level security;
revoke all on table public.platform_meta_insights_tokens from public, anon, authenticated;
revoke all on table public.platform_meta_insights_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_meta_insights_tokens to service_role;
grant select, insert, update, delete on table public.platform_meta_insights_cache to service_role;
comment on table public.platform_meta_insights_tokens is 'Optional encrypted read token; never replaces the CAPI token. Server super-admin guard required.';
comment on table public.platform_meta_insights_cache is 'Only complete Meta account/range reports. Service role only; no client RLS policy.';

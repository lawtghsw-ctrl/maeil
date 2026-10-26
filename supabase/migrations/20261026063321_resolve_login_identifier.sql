begin;

-- Server-only lookup for an existing email's local part. Authentication still
-- happens through Supabase Auth; this function never changes an account.
create or replace function public.resolve_login_identifier(p_identifier text)
returns table(id uuid, email text)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  identifier text;
begin
  -- IS DISTINCT FROM also rejects a missing role claim.
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role only' using errcode = '42501';
  end if;

  if p_identifier is null or octet_length(p_identifier) > 1024 then
    raise exception 'invalid login identifier' using errcode = '22023';
  end if;
  identifier := btrim(p_identifier);
  if length(identifier) not between 1 and 254
     or identifier !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+$' then
    raise exception 'invalid login identifier' using errcode = '22023';
  end if;

  -- Do not discard inactive/banned/unconfirmed users to resolve a collision.
  -- The caller must require exactly one row and use the original stored email.
  return query
    select u.id, u.email::text
    from auth.users as u
    where lower(split_part(u.email, '@', 1)) = lower(identifier)
    order by u.id
    limit 2;
end;
$$;

-- Remove explicit grants as well as PUBLIC's default function EXECUTE grant.
revoke all on function public.resolve_login_identifier(text) from public, anon, authenticated, service_role;
grant execute on function public.resolve_login_identifier(text) to service_role;

commit;

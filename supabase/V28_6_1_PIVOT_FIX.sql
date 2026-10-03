-- LawPower v28.6.1
-- DB관리 피벗 데이터 정규화 + 기존 데이터 복구
-- 실행 위치: Supabase SQL Editor
-- 데이터 삭제 없음. app_leads.data의 피벗용 canonical 필드만 채웁니다.

begin;

create or replace function public.lawpower_normalize_debt_range(v text)
returns text
language plpgsql
immutable
as $$
declare
  s text := lower(regexp_replace(coalesce(v,''), '[\s_,·ㆍ원]', '', 'g'));
begin
  if s = '' then return null; end if;

  if s in ('3천만원~5천만원','3천만원-5천만원','3000만원~5000만원','3000만원-5000만원') then
    return '3천만원~5천만원';
  end if;
  if s in ('5천만원~1억원','5천만원-1억원','5000만원~1억원','5000만원-1억원') then
    return '5천만원~1억원';
  end if;
  if s in ('1억원이상','1억이상','1억원초과','1억초과') then
    return '1억원 이상';
  end if;

  if (position('3천' in s) > 0 or position('3000' in s) > 0)
     and (position('5천' in s) > 0 or position('5000' in s) > 0) then
    return '3천만원~5천만원';
  end if;

  if (position('5천' in s) > 0 or position('5000' in s) > 0)
     and (position('1억' in s) > 0 or position('10000' in s) > 0) then
    return '5천만원~1억원';
  end if;

  if (position('1억' in s) > 0 or position('10000' in s) > 0)
     and (position('이상' in s) > 0 or position('초과' in s) > 0) then
    return '1억원 이상';
  end if;

  return null;
end;
$$;

create or replace function public.lawpower_normalize_income_range(v text)
returns text
language plpgsql
immutable
as $$
declare
  s text := lower(regexp_replace(coalesce(v,''), '[\s_,·ㆍ원]', '', 'g'));
begin
  if s = '' then return null; end if;

  if s in ('100~200만원','100-200만원','100만원~200만원','100만원-200만원') then
    return '100~200만원';
  end if;
  if s in ('200~400만원','200-400만원','200만원~400만원','200만원-400만원') then
    return '200~400만원';
  end if;
  if s in ('400만원이상','400이상','400만원초과','400초과') then
    return '400만원 이상';
  end if;

  if position('100' in s) > 0 and position('200' in s) > 0 then
    return '100~200만원';
  end if;

  if position('200' in s) > 0 and position('400' in s) > 0 then
    return '200~400만원';
  end if;

  if position('400' in s) > 0
     and (position('이상' in s) > 0 or position('초과' in s) > 0) then
    return '400만원 이상';
  end if;

  return null;
end;
$$;

create or replace function public.lawpower_normalize_consult_time(v text)
returns text
language plpgsql
immutable
as $$
declare
  s text := lower(regexp_replace(coalesce(v,''), '[\s_,·ㆍ]', '', 'g'));
begin
  if s = '' then return null; end if;

  if s = lower(regexp_replace('평일 오전(9시~12시)', '[\s_,·ㆍ]', '', 'g')) then
    return '평일 오전(9시~12시)';
  end if;
  if s = lower(regexp_replace('평일 점심(12시~1시)', '[\s_,·ㆍ]', '', 'g')) then
    return '평일 점심(12시~1시)';
  end if;
  if s = lower(regexp_replace('평일 오후(1시~6시)', '[\s_,·ㆍ]', '', 'g')) then
    return '평일 오후(1시~6시)';
  end if;
  if s = lower(regexp_replace('퇴근 후(6시~9시)', '[\s_,·ㆍ]', '', 'g')) then
    return '퇴근 후(6시~9시)';
  end if;

  if position('퇴근' in s) > 0 or (position('6시' in s) > 0 and position('9시' in s) > 0) then
    return '퇴근 후(6시~9시)';
  end if;

  if position('점심' in s) > 0 or (position('12시' in s) > 0 and position('1시' in s) > 0) then
    return '평일 점심(12시~1시)';
  end if;

  if position('오전' in s) > 0 or (position('9시' in s) > 0 and position('12시' in s) > 0) then
    return '평일 오전(9시~12시)';
  end if;

  if position('오후' in s) > 0 or (position('1시' in s) > 0 and position('6시' in s) > 0) then
    return '평일 오후(1시~6시)';
  end if;

  return null;
end;
$$;

create or replace function public.normalize_app_lead_pivot_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  debt_value text;
  income_value text;
  time_value text;
begin
  debt_value := public.lawpower_normalize_debt_range(
    coalesce(nullif(new.data->>'debtRange',''), new.data->>'debtRaw')
  );
  income_value := public.lawpower_normalize_income_range(
    coalesce(nullif(new.data->>'incomeRange',''), new.data->>'incomeRaw')
  );
  time_value := public.lawpower_normalize_consult_time(
    coalesce(nullif(new.data->>'consultTime',''), new.data->>'consultTimeRaw')
  );

  if debt_value is not null then
    new.data := jsonb_set(new.data, '{debtRange}', to_jsonb(debt_value), true);
  end if;
  if income_value is not null then
    new.data := jsonb_set(new.data, '{incomeRange}', to_jsonb(income_value), true);
  end if;
  if time_value is not null then
    new.data := jsonb_set(new.data, '{consultTime}', to_jsonb(time_value), true);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_app_leads_normalize_pivot on public.app_leads;
create trigger trg_app_leads_normalize_pivot
before insert or update of data on public.app_leads
for each row execute function public.normalize_app_lead_pivot_fields();

-- 기존 82건 포함 과거 데이터에 trigger를 한 번 적용합니다.
-- detailStage/status는 바꾸지 않으므로 Meta 자동규칙 이벤트는 새로 생성되지 않습니다.
update public.app_leads
set data = data;

commit;

-- 확인용
select
  count(*) as total,
  count(*) filter (where data->>'consultTime' is not null and data->>'consultTime' <> '') as consult_time_mapped,
  count(*) filter (where data->>'debtRange' is not null and data->>'debtRange' <> '') as debt_range_mapped,
  count(*) filter (where data->>'incomeRange' is not null and data->>'incomeRange' <> '') as income_range_mapped
from public.app_leads;

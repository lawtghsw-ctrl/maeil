"use client";

// 상담일지 좌측 컬럼. v14에서는 사용자가 제시한 원본 서식과 동일하게 모든 항목을
// "라벨 셀 | 입력 셀" 한 줄 구조로 배치합니다. 광역지역과 관할법원은 각각 드롭다운으로
// 선택하고, 생년월일 달력 선택 시 만 나이를 자동 계산해 우측에 표시합니다.
import type { ChangeEvent } from "react";
import type { ConsultationPersonal } from "@/lib/types";
import { Input, Select } from "@/components/ui/Primitives";
import { calcKoreanAge } from "@/lib/consultation";
import { ADMIN_REGIONS, courtsForRegion, normalizeAdminRegion, type AdminRegion } from "@/lib/court-jurisdiction";
import {
  FieldRow,
  OXToggle,
  SectionCard,
  UnitNumberInput,
  compactInputClass,
  compactSelectClass,
} from "./shared";

export function BasicInfoSection({
  personal,
  patchPersonal,
  requiredKeys,
  missingKeys,
  displayName,
  displayPhone,
  joinedAtLabel,
  caseNumberLabel,
}: {
  personal: ConsultationPersonal;
  patchPersonal: (p: Partial<ConsultationPersonal>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
  displayName: string;
  displayPhone: string;
  joinedAtLabel: string;
  caseNumberLabel: string;
}) {
  const autoAge = calcKoreanAge(personal.birthDate);
  const residenceRegion = normalizeAdminRegion(personal.residenceRegion);
  const workRegion = normalizeAdminRegion(personal.workRegion);
  const residenceCourts = courtsForRegion(residenceRegion);
  const workCourts = courtsForRegion(workRegion);

  function required(key: string) {
    return requiredKeys.has(key);
  }
  function missing(key: string) {
    return missingKeys.has(key);
  }

  function changeResidenceRegion(v: string) {
    const region = (v || undefined) as AdminRegion | undefined;
    const courts = courtsForRegion(region);
    patchPersonal({
      residenceRegion: region,
      jurisdictionCourt: personal.jurisdictionCourt && courts.includes(personal.jurisdictionCourt) ? personal.jurisdictionCourt : undefined,
    });
  }

  function changeWorkRegion(v: string) {
    const region = (v || undefined) as AdminRegion | undefined;
    const courts = courtsForRegion(region);
    patchPersonal({
      workRegion: region,
      workJurisdictionCourt:
        personal.workJurisdictionCourt && courts.includes(personal.workJurisdictionCourt) ? personal.workJurisdictionCourt : undefined,
    });
  }

  function changeBirthDate(v: string) {
    const age = calcKoreanAge(v || undefined);
    patchPersonal({ birthDate: v || undefined, age });
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-1">
      <SectionCard title="기본정보" className="shrink-0">
        <FieldRow label="이름">
          <Input className={`${compactInputClass} text-center font-semibold`} value={displayName} readOnly />
        </FieldRow>
        <FieldRow label="연락처">
          <Input className={`${compactInputClass} text-center font-semibold`} value={displayPhone} readOnly />
        </FieldRow>

        <FieldRow label="면책이력" required={required("dischargeHistory")} missing={missing("dischargeHistory")}>
          <OXToggle value={personal.dischargeHistory} onChange={(v) => patchPersonal({ dischargeHistory: v })} />
          <Input
            className={compactInputClass}
            value={personal.dischargeHistoryNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ dischargeHistoryNote: e.target.value })}
            placeholder="면책이력 상세내용"
          />
        </FieldRow>

        <FieldRow label="코인,주식,도박 사행성 여부" labelClassName="text-[9px]">
          <OXToggle value={personal.riskyAssetActivity} onChange={(v) => patchPersonal({ riskyAssetActivity: v })} />
          <Input
            className={compactInputClass}
            value={personal.riskyAssetNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ riskyAssetNote: e.target.value })}
            placeholder="관련 내용"
          />
        </FieldRow>

        <FieldRow label="거주지역" required={required("residenceRegion")} missing={missing("residenceRegion")}>
          <Select className={compactSelectClass} value={residenceRegion} onChange={(e: ChangeEvent<HTMLSelectElement>) => changeResidenceRegion(e.target.value)}>
            <option value="">지역 선택</option>
            {ADMIN_REGIONS.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </Select>
          <Select
            className={compactSelectClass}
            value={personal.jurisdictionCourt ?? ""}
            disabled={!residenceRegion}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchPersonal({ jurisdictionCourt: e.target.value || undefined })}
          >
            <option value="">관할법원 선택</option>
            {personal.jurisdictionCourt && !residenceCourts.includes(personal.jurisdictionCourt) && (
              <option value={personal.jurisdictionCourt}>{personal.jurisdictionCourt}</option>
            )}
            {residenceCourts.map((court) => <option key={court} value={court}>{court}</option>)}
          </Select>
        </FieldRow>

        <FieldRow label="회사지역" required={required("workRegion")} missing={missing("workRegion")}>
          <Select className={compactSelectClass} value={workRegion} onChange={(e: ChangeEvent<HTMLSelectElement>) => changeWorkRegion(e.target.value)}>
            <option value="">지역 선택</option>
            {ADMIN_REGIONS.map((region) => (
              <option key={region} value={region}>{region}</option>
            ))}
          </Select>
          <Select
            className={compactSelectClass}
            value={personal.workJurisdictionCourt ?? ""}
            disabled={!workRegion}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => patchPersonal({ workJurisdictionCourt: e.target.value || undefined })}
          >
            <option value="">관할법원 선택</option>
            {personal.workJurisdictionCourt && !workCourts.includes(personal.workJurisdictionCourt) && (
              <option value={personal.workJurisdictionCourt}>{personal.workJurisdictionCourt}</option>
            )}
            {workCourts.map((court) => <option key={court} value={court}>{court}</option>)}
          </Select>
        </FieldRow>

        <FieldRow label="나이">
          <input type="date" className={compactInputClass} value={personal.birthDate ?? ""} onChange={(e) => changeBirthDate(e.target.value)} />
          <div className="flex h-7 min-w-[92px] items-center justify-center rounded border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-700">
            {autoAge === undefined ? "만 - 세" : `만 ${autoAge}세`}
          </div>
        </FieldRow>

        <FieldRow label="결혼" required={required("spouse")} missing={missing("spouse")}>
          <OXToggle value={personal.spouse} onChange={(v) => patchPersonal({ spouse: v })} />
        </FieldRow>

        <FieldRow label="소득" required={required("basicIncomeNote")} missing={missing("basicIncomeNote")}>
          <Input
            className={compactInputClass}
            value={personal.basicIncomeNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ basicIncomeNote: e.target.value })}
            placeholder="소득·양육비 등 상담 확인내용"
          />
        </FieldRow>

        <FieldRow label="미성년자녀" required={required("childrenCount")} missing={missing("childrenCount")}>
          <UnitNumberInput value={personal.childrenCount} onChange={(v) => patchPersonal({ childrenCount: v })} unit="명" />
        </FieldRow>

        <FieldRow label="부모" required={required("parentCount")} missing={missing("parentCount")}>
          <UnitNumberInput value={personal.parentCount} onChange={(v) => patchPersonal({ parentCount: v })} unit="명" className="max-w-[45%]" />
          <span className="text-[10px] text-slate-400">/</span>
          <Input
            className={compactInputClass}
            value={personal.parentAgeStatus ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentAgeStatus: e.target.value })}
            placeholder="연령 / 상태"
          />
        </FieldRow>

        <FieldRow label="부모소득" required={required("parentSupportNote")} missing={missing("parentSupportNote")}>
          <Input
            className={compactInputClass}
            value={personal.parentSupportNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentSupportNote: e.target.value })}
            placeholder="소득 또는 부양여부"
          />
        </FieldRow>

        <FieldRow label="유입">
          <Input className={`${compactInputClass} text-center`} value={joinedAtLabel} readOnly />
        </FieldRow>
        <FieldRow label="사건번호">
          <Input className={compactInputClass} value={caseNumberLabel} readOnly />
        </FieldRow>
        <FieldRow label="통화요청시간">
          <Input
            className={compactInputClass}
            value={personal.callRequestTime ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ callRequestTime: e.target.value })}
          />
        </FieldRow>
      </SectionCard>

      <SectionCard title="기타" className="shrink-0">
        <FieldRow label="본인명의 다른 재산" required={required("otherAssetsNote")} missing={missing("otherAssetsNote")}>
          <Input className={compactInputClass} value={personal.otherAssetsNote ?? ""} onChange={(e) => patchPersonal({ otherAssetsNote: e.target.value })} />
        </FieldRow>
        <FieldRow label="개인채무">
          <Input className={compactInputClass} value={personal.personalDebtNote ?? ""} onChange={(e) => patchPersonal({ personalDebtNote: e.target.value })} />
        </FieldRow>
        <FieldRow label="채무사실공유">
          <OXToggle value={personal.debtDisclosureShared} onChange={(v) => patchPersonal({ debtDisclosureShared: v })} />
          <Input
            className={compactInputClass}
            value={personal.debtDisclosureNote ?? ""}
            onChange={(e) => patchPersonal({ debtDisclosureNote: e.target.value })}
            placeholder="공유 여부 관련 메모"
          />
        </FieldRow>
      </SectionCard>
    </div>
  );
}

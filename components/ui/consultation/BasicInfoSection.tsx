"use client";

// 상담일지 대형 팝업 — 좌측 컬럼 "기본정보" + "기타" 섹션. 이름/연락처/유입일/사건번호는
// DbLead·Client·CaseRecord에 이미 있는 값을 그대로 표시만 하고(중복 저장 없음), 그 외
// 필드는 ConsultationPersonal(lib/types.ts)에 additive로 추가된 필드입니다.
//
// v13(레이아웃 정밀개편) 요청 반영 사항:
// - "*소득"은 별도 필드를 새로 만들지 않고 기존 income.monthlyAvgIncome(소득 섹션의
//   "월 실수령"과 동일한 값)을 이 위치에서도 바로 보고 수정할 수 있도록 재사용했습니다
//   (중복 저장 방지 — 요청 원문 "기존 정상 기능 유지/중복 저장 금지" 원칙 준수).
// - 나이: 수동 입력값(age)은 그대로 두고, 아래쪽 생년월일이 입력돼 있으면 "(만 OO세)"
//   자동계산값을 참고용으로 함께 보여줍니다(calcKoreanAge).
// - "기타" 구분 바 아래: 본인명의 다른 재산 / 개인채무 / 채무사실공유(신규 필드) 추가.
import type { ChangeEvent } from "react";
import type { ConsultationIncome, ConsultationPersonal, Gender } from "@/lib/types";
import { Input, Label, Select } from "@/components/ui/Primitives";
import { calcKoreanAge } from "@/lib/consultation";
import { ManwonInput, OXToggle, SectionCard, UnitNumberInput, compactTextareaClass, dateInputClass } from "./shared";

export function BasicInfoSection({
  personal,
  patchPersonal,
  income,
  patchIncome,
  requiredKeys,
  missingKeys,
  displayName,
  displayPhone,
  joinedAtLabel,
  caseNumberLabel,
}: {
  personal: ConsultationPersonal;
  patchPersonal: (p: Partial<ConsultationPersonal>) => void;
  income: ConsultationIncome;
  patchIncome: (p: Partial<ConsultationIncome>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
  displayName: string;
  displayPhone: string;
  joinedAtLabel: string;
  caseNumberLabel: string;
}) {
  const autoAge = calcKoreanAge(personal.birthDate);

  return (
    <div className="space-y-3">
      <SectionCard title="기본정보">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Label text="이름">
            <Input value={displayName} readOnly />
          </Label>
          <Label text="연락처">
            <Input value={displayPhone} readOnly />
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
          <Label text="면책이력 여부" required={requiredKeys.has("dischargeHistory")} missing={missingKeys.has("dischargeHistory")}>
            <OXToggle value={personal.dischargeHistory} onChange={(v) => patchPersonal({ dischargeHistory: v })} />
          </Label>
          <Label text="코인/주식/도박/사행성 여부">
            <OXToggle value={personal.riskyAssetActivity} onChange={(v) => patchPersonal({ riskyAssetActivity: v })} />
          </Label>
        </div>
        {personal.dischargeHistory && (
          <Label text="면책이력 상세내용">
            <textarea
              className={compactTextareaClass}
              value={personal.dischargeHistoryNote ?? ""}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ dischargeHistoryNote: e.target.value })}
            />
          </Label>
        )}
        {personal.riskyAssetActivity && (
          <Label text="관련 메모">
            <textarea
              className={compactTextareaClass}
              value={personal.riskyAssetNote ?? ""}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ riskyAssetNote: e.target.value })}
            />
          </Label>
        )}

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
          <Label text="거주지역" required={requiredKeys.has("residenceRegion")} missing={missingKeys.has("residenceRegion")}>
            <Input
              value={personal.residenceRegion ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ residenceRegion: e.target.value })}
              placeholder="예: 경기 / 수원회생법원"
            />
          </Label>
          <Label text="회사지역" required={requiredKeys.has("workRegion")} missing={missingKeys.has("workRegion")}>
            <Input value={personal.workRegion ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ workRegion: e.target.value })} placeholder="예: 경기 / 수원회생법원" />
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Label text="나이">
            <div className="flex items-center gap-1.5">
              <UnitNumberInput value={personal.age} onChange={(v) => patchPersonal({ age: v })} unit="세" className="flex-1" />
              {autoAge !== undefined && <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-slate-400">(만 {autoAge}세)</span>}
            </div>
          </Label>
          <Label text="결혼 여부" required={requiredKeys.has("spouse")} missing={missingKeys.has("spouse")}>
            <OXToggle value={personal.spouse} onChange={(v) => patchPersonal({ spouse: v })} />
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Label text="소득" required={requiredKeys.has("monthlyAvgIncome")} missing={missingKeys.has("monthlyAvgIncome")}>
            <ManwonInput value={income.monthlyAvgIncome} onChange={(v) => patchIncome({ monthlyAvgIncome: v })} />
          </Label>
          <Label text="미성년 자녀 수" required={requiredKeys.has("childrenCount")} missing={missingKeys.has("childrenCount")}>
            <UnitNumberInput value={personal.childrenCount} onChange={(v) => patchPersonal({ childrenCount: v })} unit="명" />
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Label text="부모 수 / 연령·상태" required={requiredKeys.has("parentCount")} missing={missingKeys.has("parentCount")}>
            <div className="flex items-center gap-1.5">
              <UnitNumberInput value={personal.parentCount} onChange={(v) => patchPersonal({ parentCount: v })} unit="명" className="flex-1" />
              <Input
                className="flex-1"
                value={personal.parentAgeStatus ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentAgeStatus: e.target.value })}
                placeholder="연령/상태"
              />
            </div>
          </Label>
          <Label text="부모소득" required={requiredKeys.has("parentSupportNote")} missing={missingKeys.has("parentSupportNote")}>
            <Input
              value={personal.parentSupportNote ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentSupportNote: e.target.value })}
              placeholder="소득 또는 부양여부"
            />
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
          <Label text="유입">
            <Input value={joinedAtLabel} readOnly />
          </Label>
          <Label text="사건번호">
            <Input value={caseNumberLabel} readOnly />
          </Label>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <Label text="통화 요청시간">
            <Input
              value={personal.callRequestTime ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ callRequestTime: e.target.value })}
              placeholder="예: 평일 저녁 8시 이후"
            />
          </Label>
          <Label text="관할법원">
            <Input value={personal.jurisdictionCourt ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ jurisdictionCourt: e.target.value })} />
          </Label>
        </div>

        {/* 아래는 기존(v12 이전) 상담일지 서식에 있던 필드로, 화면 상단 우선순위에서는
            내렸지만 데이터는 그대로 유지·수정 가능합니다(생년월일은 위 "나이" 자동계산의
            기준값으로도 쓰입니다). */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
          <Label text="생년월일">
            <input type="date" className={dateInputClass} value={personal.birthDate ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ birthDate: e.target.value })} />
          </Label>
          <Label text="성별">
            <Select
              value={personal.gender ?? ""}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => patchPersonal({ gender: (e.target.value || undefined) as Gender | undefined })}
              className="w-full"
            >
              <option value="">선택안함</option>
              <option value="남">남</option>
              <option value="여">여</option>
            </Select>
          </Label>
          <Label text="자녀 나이">
            <Input value={personal.childrenAges ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ childrenAges: e.target.value })} placeholder="예: 8세, 5세" />
          </Label>
          <Label text="중대질환·장기요양">
            <OXToggle value={personal.seriousIllness} onChange={(v) => patchPersonal({ seriousIllness: v })} />
          </Label>
        </div>
        <Label text="혼인/이혼 및 배우자 관련 메모">
          <textarea className={compactTextareaClass} value={personal.maritalNote ?? ""} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ maritalNote: e.target.value })} />
        </Label>
      </SectionCard>

      <SectionCard title="기타">
        <Label text="본인명의 다른 재산" required={requiredKeys.has("otherAssetsNote")} missing={missingKeys.has("otherAssetsNote")}>
          <Input
            value={personal.otherAssetsNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ otherAssetsNote: e.target.value })}
            placeholder="예: 없음 / 배우자 명의 아파트 1채"
          />
        </Label>
        <Label text="개인채무">
          <Input value={personal.personalDebtNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ personalDebtNote: e.target.value })} placeholder="예: 지인에게 300만원" />
        </Label>
        <Label text="채무사실공유">
          <OXToggle value={personal.debtDisclosureShared} onChange={(v) => patchPersonal({ debtDisclosureShared: v })} />
        </Label>
        {personal.debtDisclosureShared !== undefined && (
          <Input
            value={personal.debtDisclosureNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ debtDisclosureNote: e.target.value })}
            placeholder="채무사실 공유 관련 메모(누구에게, 어디까지 공유했는지 등)"
          />
        )}
      </SectionCard>
    </div>
  );
}

"use client";

// 상담일지 대형 팝업 — "기본정보" 섹션. 이름/연락처/유입일/사건번호는 DbLead·Client·
// CaseRecord에 이미 있는 값을 그대로 표시만 하고(중복 저장 없음), 그 외 필드는 모두
// ConsultationPersonal(lib/types.ts)에 additive로 추가된 필드입니다.
import type { ChangeEvent } from "react";
import type { ConsultationPersonal, Gender } from "@/lib/types";
import { Input, Label, Select } from "@/components/ui/Primitives";
import { OXToggle, SectionCard, UnitNumberInput, compactTextareaClass, dateInputClass } from "./shared";

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
  return (
    <SectionCard title="기본정보">
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        <Label text="이름">
          <Input value={displayName} readOnly />
        </Label>
        <Label text="연락처">
          <Input value={displayPhone} readOnly />
        </Label>
        <Label text="거주지역" required={requiredKeys.has("residenceRegion")} missing={missingKeys.has("residenceRegion")}>
          <Input
            value={personal.residenceRegion ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ residenceRegion: e.target.value })}
            placeholder="예: 서울 관악구"
          />
        </Label>
        <Label text="회사지역">
          <Input value={personal.workRegion ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ workRegion: e.target.value })} />
        </Label>
        <Label text="나이">
          <UnitNumberInput value={personal.age} onChange={(v) => patchPersonal({ age: v })} unit="세" />
        </Label>
        <Label text="결혼 여부">
          <OXToggle value={personal.spouse} onChange={(v) => patchPersonal({ spouse: v })} />
        </Label>
        <Label text="미성년 자녀 수">
          <UnitNumberInput value={personal.childrenCount} onChange={(v) => patchPersonal({ childrenCount: v })} unit="명" />
        </Label>
        <Label text="부모 수">
          <UnitNumberInput value={personal.parentCount} onChange={(v) => patchPersonal({ parentCount: v })} unit="명" />
        </Label>
        <Label text="유입일">
          <Input value={joinedAtLabel} readOnly />
        </Label>
        <Label text="사건번호">
          <Input value={caseNumberLabel} readOnly />
        </Label>
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

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
        <Label text="면책이력 여부">
          <OXToggle value={personal.dischargeHistory} onChange={(v) => patchPersonal({ dischargeHistory: v })} />
        </Label>
        <Label text="코인/주식/도박/사행성">
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

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
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
        <Label text="기타 부양가족">
          <Input value={personal.otherDependents ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ otherDependents: e.target.value })} />
        </Label>
        <Label text="중대질환·장기요양 여부">
          <OXToggle value={personal.seriousIllness} onChange={(v) => patchPersonal({ seriousIllness: v })} />
        </Label>
      </div>
      <Label text="혼인/이혼 및 배우자 관련 메모">
        <textarea className={compactTextareaClass} value={personal.maritalNote ?? ""} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ maritalNote: e.target.value })} />
      </Label>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
        <Label text="부모 연령/상태">
          <Input value={personal.parentAgeStatus ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentAgeStatus: e.target.value })} />
        </Label>
        <Label text="부모 소득/부양여부">
          <Input value={personal.parentSupportNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentSupportNote: e.target.value })} />
        </Label>
      </div>
      <Label text="부양가족 특이사항">
        <Input value={personal.dependentNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ dependentNote: e.target.value })} />
      </Label>
    </SectionCard>
  );
}

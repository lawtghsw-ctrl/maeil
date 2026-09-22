"use client";

// 상담일지 좌측 컬럼. 사용자가 지정한 순서를 그대로 세로로 쌓고, 참고 이미지처럼
// '라벨 셀 + 입력 셀' 표 형태로 밀도를 높였습니다. 기존 데이터 필드는 삭제하지 않고
// 화면에서 요구된 항목만 노출합니다.
import type { ChangeEvent } from "react";
import type { ConsultationIncome, ConsultationPersonal } from "@/lib/types";
import { calcKoreanAge } from "@/lib/consultation";
import {
  DenseRow,
  OXToggle,
  SectionCard,
  UnitNumberInput,
  denseInputClass,
  denseTextareaClass,
} from "./shared";

export function BasicInfoSection({
  personal,
  patchPersonal,
  income: _income,
  patchIncome: _patchIncome,
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
  const hasRealCaseNumber = !!caseNumberLabel && !caseNumberLabel.startsWith("-");

  return (
    <div className="space-y-2">
      <SectionCard title="기본정보">
        <DenseRow label="이름">
          <input className={denseInputClass} value={displayName} readOnly />
        </DenseRow>
        <DenseRow label="연락처">
          <input className={denseInputClass} value={displayPhone} readOnly />
        </DenseRow>

        <DenseRow
          label="면책이력"
          required={requiredKeys.has("dischargeHistory")}
          missing={missingKeys.has("dischargeHistory")}
        >
          <OXToggle value={personal.dischargeHistory} onChange={(v) => patchPersonal({ dischargeHistory: v })} />
        </DenseRow>
        <DenseRow label="" required={requiredKeys.has("dischargeHistory")}>
          <textarea
            className={denseTextareaClass}
            value={personal.dischargeHistoryNote ?? ""}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ dischargeHistoryNote: e.target.value })}
            placeholder="면책이력 상세내용"
          />
        </DenseRow>

        <DenseRow label="코인,주식,도박 사행성 여부" labelWidth="112px">
          <OXToggle value={personal.riskyAssetActivity} onChange={(v) => patchPersonal({ riskyAssetActivity: v })} />
          <input
            className={denseInputClass}
            value={personal.riskyAssetNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ riskyAssetNote: e.target.value })}
            placeholder="관련 내용"
          />
        </DenseRow>

        <DenseRow
          label="거주지역"
          required={requiredKeys.has("residenceRegion")}
          missing={missingKeys.has("residenceRegion")}
        >
          <input
            className={denseInputClass}
            value={personal.residenceRegion ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ residenceRegion: e.target.value })}
            placeholder="예: 경기"
          />
          <span className="shrink-0 text-slate-400">/</span>
          <input
            className={denseInputClass}
            value={personal.residenceCourt ?? personal.jurisdictionCourt ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              patchPersonal({ residenceCourt: e.target.value, jurisdictionCourt: e.target.value })
            }
            placeholder="예: 수원회생법원"
          />
        </DenseRow>

        <DenseRow
          label="회사지역"
          required={requiredKeys.has("workRegion")}
          missing={missingKeys.has("workRegion")}
        >
          <input
            className={denseInputClass}
            value={personal.workRegion ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ workRegion: e.target.value })}
            placeholder="예: 경기"
          />
          <span className="shrink-0 text-slate-400">/</span>
          <input
            className={denseInputClass}
            value={personal.workCourt ?? personal.jurisdictionCourt ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ workCourt: e.target.value })}
            placeholder="예: 수원회생법원"
          />
        </DenseRow>

        <DenseRow label="나이">
          <input
            className={denseInputClass}
            value={personal.birthDate ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const birthDate = e.target.value;
              patchPersonal({ birthDate, age: calcKoreanAge(birthDate) });
            }}
            placeholder="생년월일 (예: 730315)"
          />
          <span className="shrink-0 text-slate-400">/</span>
          <input
            className={`${denseInputClass} w-16 flex-none text-center`}
            value={autoAge ?? personal.age ?? ""}
            readOnly
            placeholder="만나이"
          />
          <span className="shrink-0 text-[11px] font-semibold text-slate-500">세</span>
        </DenseRow>

        <DenseRow label="결혼" required={requiredKeys.has("spouse")} missing={missingKeys.has("spouse")}>
          <OXToggle value={personal.spouse} onChange={(v) => patchPersonal({ spouse: v })} />
        </DenseRow>

        <DenseRow
          label="소득"
          required={requiredKeys.has("basicIncomeNote")}
          missing={missingKeys.has("basicIncomeNote")}
          contentClassName="py-1"
        >
          <textarea
            className={denseTextareaClass}
            value={personal.basicIncomeNote ?? ""}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ basicIncomeNote: e.target.value })}
            placeholder="소득·양육비·가족관계 등 상담 시 확인한 내용을 기재"
          />
        </DenseRow>

        <DenseRow
          label="미성년자녀"
          required={requiredKeys.has("childrenCount")}
          missing={missingKeys.has("childrenCount")}
        >
          <UnitNumberInput value={personal.childrenCount} onChange={(v) => patchPersonal({ childrenCount: v })} unit="명" className="max-w-[150px]" />
        </DenseRow>

        <DenseRow label="부모" required={requiredKeys.has("parentCount")} missing={missingKeys.has("parentCount")}>
          <UnitNumberInput value={personal.parentCount} onChange={(v) => patchPersonal({ parentCount: v })} unit="명" className="max-w-[120px]" />
          <span className="shrink-0 text-slate-400">/</span>
          <input
            className={denseInputClass}
            value={personal.parentAgeStatus ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentAgeStatus: e.target.value })}
            placeholder="연령 / 상태"
          />
        </DenseRow>

        <DenseRow
          label="부모소득"
          required={requiredKeys.has("parentSupportNote")}
          missing={missingKeys.has("parentSupportNote")}
        >
          <input
            className={denseInputClass}
            value={personal.parentSupportNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ parentSupportNote: e.target.value })}
            placeholder="소득 또는 부양여부"
          />
        </DenseRow>

        <DenseRow label="유입">
          <input className={denseInputClass} value={joinedAtLabel} readOnly />
        </DenseRow>
        <DenseRow label="사건번호">
          <input
            className={denseInputClass}
            value={hasRealCaseNumber ? caseNumberLabel : personal.caseNumberDraft ?? ""}
            readOnly={hasRealCaseNumber}
            onChange={
              hasRealCaseNumber
                ? undefined
                : (e: ChangeEvent<HTMLInputElement>) => patchPersonal({ caseNumberDraft: e.target.value })
            }
            placeholder={hasRealCaseNumber ? undefined : "사건번호"}
          />
        </DenseRow>
        <DenseRow label="통화요청시간">
          <input
            className={denseInputClass}
            value={personal.callRequestTime ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ callRequestTime: e.target.value })}
          />
        </DenseRow>
      </SectionCard>

      <SectionCard title="기타">
        <DenseRow
          label="본인명의 다른 재산"
          labelWidth="102px"
          required={requiredKeys.has("otherAssetsNote")}
          missing={missingKeys.has("otherAssetsNote")}
          contentClassName="py-1"
        >
          <textarea
            className={denseTextareaClass}
            value={personal.otherAssetsNote ?? ""}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ otherAssetsNote: e.target.value })}
          />
        </DenseRow>
        <DenseRow label="개인채무" contentClassName="py-1">
          <textarea
            className={denseTextareaClass}
            value={personal.personalDebtNote ?? ""}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => patchPersonal({ personalDebtNote: e.target.value })}
          />
        </DenseRow>
        <DenseRow label="채무사실공유">
          <OXToggle value={personal.debtDisclosureShared} onChange={(v) => patchPersonal({ debtDisclosureShared: v })} />
          <input
            className={denseInputClass}
            value={personal.debtDisclosureNote ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchPersonal({ debtDisclosureNote: e.target.value })}
            placeholder="공유 여부 관련 메모"
          />
        </DenseRow>
      </SectionCard>
    </div>
  );
}

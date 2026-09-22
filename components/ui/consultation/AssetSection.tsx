"use client";

// 상담일지 대형 팝업 — 중단 컬럼 "자산" 섹션. 거주형태·차량은 ConsultationHousing(v12
// 추가) 필드이고, 그 아래 기존 "재산현황(청산가치 참고)" 표(AssetRow[])는 그대로 접어서
// 유지합니다. v13 레이아웃 정밀개편 요청에서 "총 채무금액/총 신용금액/…/보유중인
// 신용카드" 묶음이 자산 항목 바로 아래에 별도 구분 바 없이 이어져 있어(요청 원문에
// [채무요약]이라는 별도 "바"가 없음), 구 DebtSummary 컴포넌트의 자동계산 타일과 수동
// 입력란을 이 섹션 안으로 접어 넣었습니다 — 계산 로직 자체는 전혀 바뀌지 않았습니다.
import type { ChangeEvent } from "react";
import type { AssetRow, ConsultationDebtSummaryExtra, ConsultationHousing, LoanRecord } from "@/lib/types";
import { HOUSING_TYPES } from "@/lib/types";
import { Input, Label, NumberInput, Select } from "@/components/ui/Primitives";
import { OXToggle, SectionCard, UnitNumberInput, ManwonInput } from "./shared";
import { fmtWon } from "@/lib/format";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function AssetSection({
  housing,
  patchHousing,
  assets,
  setAssets,
  loanRecords,
  debtSummaryExtra,
  patchDebtSummaryExtra,
  requiredKeys,
  missingKeys,
}: {
  housing: ConsultationHousing;
  patchHousing: (p: Partial<ConsultationHousing>) => void;
  assets: AssetRow[];
  setAssets: Updater<AssetRow[]>;
  loanRecords: LoanRecord[];
  debtSummaryExtra: ConsultationDebtSummaryExtra;
  patchDebtSummaryExtra: (p: Partial<ConsultationDebtSummaryExtra>) => void;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  function updateAsset(i: number, patch: Partial<AssetRow>) {
    setAssets((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  const totalDebt = loanRecords.reduce((a, l) => a + (l.balance || 0), 0);
  const totalCredit = loanRecords.filter((l) => l.kind1 === "신용").reduce((a, l) => a + (l.balance || 0), 0);
  const totalSecured = loanRecords.filter((l) => l.kind1 === "담보").reduce((a, l) => a + (l.balance || 0), 0);
  const totalInterest = loanRecords.reduce((a, l) => a + (l.balance || 0) * ((l.interestRate || 0) / 100), 0);
  const totalMonthlyPayment = loanRecords.reduce((a, l) => a + (l.monthlyPayment || 0), 0);

  return (
    <SectionCard title="자산">
      <Label text="거주형태" required={requiredKeys.has("housingType")} missing={missingKeys.has("housingType")}>
        <div className="flex flex-wrap gap-1.5">
          {HOUSING_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => patchHousing({ housingType: t })}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                housing.housingType === t ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Label>
      <Label text="거주 관련 메모">
        <Input value={housing.housingNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ housingNote: e.target.value })} />
      </Label>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 border-t border-slate-100 pt-2">
        <Label text="차량 보유 여부">
          <OXToggle value={housing.hasVehicle} onChange={(v) => patchHousing({ hasVehicle: v })} />
        </Label>
        <Label text="배우자 차량 보유 여부">
          <OXToggle value={housing.spouseHasVehicle} onChange={(v) => patchHousing({ spouseHasVehicle: v })} />
        </Label>
      </div>
      {housing.hasVehicle && (
        <Label text="차량 정보">
          <Input value={housing.vehicleInfo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ vehicleInfo: e.target.value })} placeholder="예: 2020년식 아반떼, 시세 900만원" />
        </Label>
      )}
      {housing.spouseHasVehicle && (
        <Label text="배우자 차량 정보">
          <Input
            value={housing.spouseVehicleInfo ?? ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchHousing({ spouseVehicleInfo: e.target.value })}
          />
        </Label>
      )}

      {/* ---- v13: 채무 요약(자동계산) — 아래 "기대출 리스트"의 잔액/이자/월불입 합계를
          이 자리에서 바로 확인할 수 있도록 이어붙였습니다(계산은 loanRecords 기준 그대로) */}
      <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-[11px]">
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="font-semibold text-slate-500">총 채무금액</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{fmtWon(totalDebt)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="font-semibold text-slate-500">월 불입금</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{fmtWon(totalMonthlyPayment)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="font-semibold text-slate-500">총 신용금액</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{fmtWon(totalCredit)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-2">
          <div className="font-semibold text-slate-500">총 담보금액</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{fmtWon(totalSecured)}</div>
        </div>
        <div className="col-span-2 rounded-lg bg-slate-50 p-2">
          <div className="font-semibold text-slate-500">총 이자(연 추정)</div>
          <div className="mt-0.5 text-sm font-bold text-slate-900">{fmtWon(totalInterest)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Label text="급여일">
          <UnitNumberInput value={debtSummaryExtra.salaryPayDay} onChange={(v) => patchDebtSummaryExtra({ salaryPayDay: v })} unit="일" max={31} />
        </Label>
        <Label text="카드결제금액">
          <ManwonInput value={debtSummaryExtra.cardPaymentAmount} onChange={(v) => patchDebtSummaryExtra({ cardPaymentAmount: v })} />
        </Label>
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Label text="매출결제일">
          <UnitNumberInput value={debtSummaryExtra.cardPaymentDay} onChange={(v) => patchDebtSummaryExtra({ cardPaymentDay: v })} unit="일" max={31} />
        </Label>
        <Label text="보유중인 신용카드">
          <Input value={debtSummaryExtra.heldCreditCards ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => patchDebtSummaryExtra({ heldCreditCards: e.target.value })} placeholder="예: 국민카드, 현대카드" />
        </Label>
      </div>

      <div className="border-t border-slate-100 pt-2">
        <div className="mb-1.5 text-[11px] font-semibold text-slate-400">재산현황(청산가치 참고) — 기존 표 그대로 유지</div>
        <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
              <tr>
                {["구분", "평가액", "담보", "담보금액"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assets.map((row, i) => (
                <tr key={row.category} className="border-t border-slate-100">
                  <td className="px-2 py-1 font-semibold text-slate-600">{row.category}</td>
                  <td className="px-2 py-1">
                    <NumberInput className="h-7 w-20 px-1.5 text-[11px]" value={row.value} onChange={(v) => updateAsset(i, { value: v })} />
                  </td>
                  <td className="px-2 py-1">
                    <Select
                      value={row.hasSecurity ? "예" : "아니오"}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => updateAsset(i, { hasSecurity: e.target.value === "예" })}
                      className="h-7 w-16 px-1 text-[11px]"
                    >
                      <option value="아니오">아니오</option>
                      <option value="예">예</option>
                    </Select>
                  </td>
                  <td className="px-2 py-1">
                    <NumberInput
                      className="h-7 w-20 px-1.5 text-[11px]"
                      value={row.securityAmount}
                      onChange={(v) => updateAsset(i, { securityAmount: v })}
                      disabled={!row.hasSecurity}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}

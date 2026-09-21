"use client";

// 상담일지(개인회생·개인파산 상담일지) 입력 탭 6종(인적사항/소득현황/재산현황/채무현황/
// 변제계획/상담메모) — 원래 고객관리 수정 팝업(CustomerEditModal)에만 있던 내용을 공용
// 컴포넌트로 분리했습니다. DB관리 단계에서도 상담일지를 작성할 수 있어야 한다는 요청에
// 따라, 두 화면(DB관리의 상담일지 작성 팝업 / 고객관리의 고객정보 수정 팝업)에서
// 동일한 입력 UI를 그대로 재사용합니다. 부모가 tab(현재 활성 탭)과 각 값·setter를
// 그대로 넘겨주는 완전한 controlled 컴포넌트입니다.
import { type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import type {
  AssetRow,
  ConsultationIncome,
  ConsultationPersonal,
  DebtRow,
  Gender,
  OccupationType,
  RepaymentPlanInput,
} from "@/lib/types";
import { lookupMinLivingCost, type RepaymentPlanResult } from "@/lib/consultation";
import { fmtWon } from "@/lib/format";
import { Input, Label, NumberInput, Select } from "@/components/ui/Primitives";

export type ConsultationTabKey = "인적사항" | "소득현황" | "재산현황" | "채무현황" | "변제계획" | "상담메모";
export const CONSULTATION_TABS: ConsultationTabKey[] = ["인적사항", "소득현황", "재산현황", "채무현황", "변제계획", "상담메모"];

const OCCUPATION_TYPES: OccupationType[] = ["사업자", "직장인", "프리랜서", "무직", "기타"];

export const dateInputClass =
  "h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:h-10 sm:text-sm";
export const textareaClass =
  "min-h-32 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:text-sm";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function ConsultationTabsEditor({
  activeTab,
  personal,
  setPersonal,
  income,
  setIncome,
  assets,
  setAssets,
  debts,
  setDebts,
  plan,
  setPlan,
  consultMemo,
  setConsultMemo,
  result,
}: {
  activeTab: ConsultationTabKey | string;
  personal: ConsultationPersonal;
  setPersonal: Updater<ConsultationPersonal>;
  income: ConsultationIncome;
  setIncome: Updater<ConsultationIncome>;
  assets: AssetRow[];
  setAssets: Updater<AssetRow[]>;
  debts: DebtRow[];
  setDebts: Updater<DebtRow[]>;
  plan: RepaymentPlanInput;
  setPlan: Updater<RepaymentPlanInput>;
  consultMemo: string;
  setConsultMemo: (v: string) => void;
  result: RepaymentPlanResult;
}) {
  const { minLivingCostTable } = useStore();

  function updateAsset(i: number, patch: Partial<AssetRow>) {
    setAssets((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }
  function updateDebt(i: number, patch: Partial<DebtRow>) {
    setDebts((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

  return (
    <>
      {activeTab === "인적사항" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="생년월일">
              <input
                type="date"
                className={dateInputClass}
                value={personal.birthDate ?? ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, birthDate: e.target.value }))}
              />
            </Label>
            <Label text="성별">
              <Select value={personal.gender ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, gender: (e.target.value || undefined) as Gender | undefined }))} className="w-full">
                <option value="">선택안함</option>
                <option value="남">남</option>
                <option value="여">여</option>
              </Select>
            </Label>
            <Label text="거주지(초본주소)">
              <Input value={personal.address ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, address: e.target.value }))} />
            </Label>
            <Label text="관할법원">
              <Input value={personal.jurisdictionCourt ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, jurisdictionCourt: e.target.value }))} />
            </Label>
            <Label text="직업">
              <Select
                value={personal.occupationType ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, occupationType: (e.target.value || undefined) as OccupationType | undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                {OCCUPATION_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="배우자 유무">
              <Select
                value={personal.spouse === undefined ? "" : personal.spouse ? "예" : "아니오"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, spouse: e.target.value === "예" ? true : e.target.value === "아니오" ? false : undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                <option value="예">예</option>
                <option value="아니오">아니오</option>
              </Select>
            </Label>
            <Label text="자녀 인원">
              <NumberInput value={personal.childrenCount ?? 0} onChange={(v) => setPersonal((p) => ({ ...p, childrenCount: v }))} />
            </Label>
            <Label text="자녀 나이">
              <Input value={personal.childrenAges ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, childrenAges: e.target.value }))} placeholder="예: 8세, 5세" />
            </Label>
            <Label text="기타 부양가족">
              <Input value={personal.otherDependents ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, otherDependents: e.target.value }))} />
            </Label>
            <Label text="중대질환·장기요양 여부">
              <Select
                value={personal.seriousIllness === undefined ? "" : personal.seriousIllness ? "예" : "아니오"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setPersonal((p) => ({ ...p, seriousIllness: e.target.value === "예" ? true : e.target.value === "아니오" ? false : undefined }))}
                className="w-full"
              >
                <option value="">선택안함</option>
                <option value="예">예</option>
                <option value="아니오">아니오</option>
              </Select>
            </Label>
          </div>
          <Label text="부양가족 특이사항">
            <Input value={personal.dependentNote ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setPersonal((p) => ({ ...p, dependentNote: e.target.value }))} />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ① 인적사항 체크포인트 — 거주지·관할법원 일치 여부, 부양가족 인원(생계비 산정 직결), 중대질환·장기요양 여부를 빠짐없이 확인하세요.
          </div>
        </div>
      )}

      {activeTab === "소득현황" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="소득유형">
              <Input value={income.incomeType ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, incomeType: e.target.value }))} placeholder="예: 근로소득, 사업소득" />
            </Label>
            <Label text="회사명·사업자명">
              <Input value={income.workplaceName ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, workplaceName: e.target.value }))} />
            </Label>
            <Label text="재직기간·사업장정보">
              <Input value={income.tenureInfo ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, tenureInfo: e.target.value }))} />
            </Label>
            <Label text="월평균소득(최근 3개월)">
              <NumberInput value={income.monthlyAvgIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, monthlyAvgIncome: v }))} />
            </Label>
            <Label text="2중소득(부업)">
              <NumberInput value={income.secondaryIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, secondaryIncome: v }))} />
            </Label>
            <Label text="연금소득(국민/노령)">
              <NumberInput value={income.pensionIncome ?? 0} onChange={(v) => setIncome((x) => ({ ...x, pensionIncome: v }))} />
            </Label>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">연소득(자동)</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(result.totalIncome)}</div>
          </div>
          <Label text="비고">
            <Input value={income.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => setIncome((v) => ({ ...v, note: e.target.value }))} />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ② 소득현황 체크포인트 — 최근 3개월 평균으로 산정, 부업·2중소득 누락 여부, 사업소득자는 매출/매입 장부 요청 여부를 확인하세요.
          </div>
        </div>
      )}

      {activeTab === "재산현황" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {["구분", "평가액", "담보·대출", "담보·대출 금액", "비고"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {assets.map((row, i) => (
                  <tr key={row.category} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.category}</td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.value} onChange={(v) => updateAsset(i, { value: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <Select value={row.hasSecurity ? "예" : "아니오"} onChange={(e: ChangeEvent<HTMLSelectElement>) => updateAsset(i, { hasSecurity: e.target.value === "예" })} className="w-24">
                        <option value="아니오">아니오</option>
                        <option value="예">예</option>
                      </Select>
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.securityAmount} onChange={(v) => updateAsset(i, { securityAmount: v })} disabled={!row.hasSecurity} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-40" value={row.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateAsset(i, { note: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <div className="text-xs font-semibold text-slate-500">자산합계(자동)</div>
            <div className="mt-1 text-lg font-bold text-slate-900">{fmtWon(result.assetTotal)}</div>
          </div>
          <Label text="소액임차인 최우선변제 참고 메모 (지역별 기준액은 매년 고시되므로 자동조회 대신 담당자가 직접 확인해 기록)">
            <Input
              value={plan.smallLeaseNote ?? ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPlan((p) => ({ ...p, smallLeaseNote: e.target.value }))}
              placeholder="예: 서울 지역 기준 최우선변제 대상 여부 확인 필요"
            />
          </Label>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ③ 재산현황 체크포인트 — 임차보증금 반환채권, 보험 해약환급금, 퇴직금 예상액(1/2 산정 여부), 최근 처분한 재산 유무를 확인하세요.
          </div>
        </div>
      )}

      {activeTab === "채무현황" && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-xs">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  {["구분", "채권자", "내용", "금액", "비고"].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {debts.map((row, i) => (
                  <tr key={row.category} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-semibold text-slate-700">{row.category}</td>
                    <td className="px-3 py-2">
                      <Input className="w-32" value={row.creditor ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { creditor: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-32" value={row.detail ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { detail: e.target.value })} />
                    </td>
                    <td className="px-3 py-2">
                      <NumberInput className="w-32" value={row.amount} onChange={(v) => updateDebt(i, { amount: v })} />
                    </td>
                    <td className="px-3 py-2">
                      <Input className="w-40" value={row.note ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => updateDebt(i, { note: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">채무합계(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.debtTotal)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">담보채무합계(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.securedDebtTotal)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">신용채무(탕감대상)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.unsecuredDebtTotal)}</div>
            </div>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ④ 채무현황 체크포인트 — 세금·건강보험 체납액(우선변제 50% 한도 별도 확인 필요), 담보채무의 실제 담보가치, 신용채무 총액과 채권자 수를 확인하세요.
          </div>
        </div>
      )}

      {activeTab === "변제계획" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Label text="가구원수">
              <NumberInput
                min={1}
                value={plan.householdSize}
                onChange={(v) =>
                  setPlan((p) => ({
                    ...p,
                    householdSize: v || 1,
                    minLivingCost: lookupMinLivingCost(v || 1, minLivingCostTable),
                  }))
                }
              />
            </Label>
            <Label text="최저생계비 (최저생계비 계산기 설정값 자동 반영 — 필요 시 수동 수정 가능)">
              <NumberInput value={plan.minLivingCost} onChange={(v) => setPlan((p) => ({ ...p, minLivingCost: v }))} />
            </Label>
            <Label text="기타공제금">
              <NumberInput value={plan.otherDeduction} onChange={(v) => setPlan((p) => ({ ...p, otherDeduction: v }))} />
            </Label>
            <Label text="변제개월수">
              <NumberInput min={1} value={plan.repaymentMonths} onChange={(v) => setPlan((p) => ({ ...p, repaymentMonths: v || 1 }))} />
            </Label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">월 가용소득(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.monthlyDisposableIncome)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">총변제예정액(자동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.totalPlannedRepayment)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">청산가치(자동=자산-담보채무)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.liquidationValue)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">청산가치 보장 여부</div>
              <div className={`mt-1 font-bold ${result.liquidationCovered ? "text-emerald-600" : "text-red-600"}`}>
                {result.liquidationCovered ? "보장됨" : "미달 — 월 변제금 상향 반영"}
              </div>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-600">최종 월 변제금(자동)</div>
              <div className="mt-1 text-lg font-bold text-blue-700">{fmtWon(result.finalMonthlyRepayment)}</div>
            </div>
            <div className="rounded-xl bg-blue-50 p-4">
              <div className="text-xs font-semibold text-blue-600">최종 총변제예정액(자동)</div>
              <div className="mt-1 text-lg font-bold text-blue-700">{fmtWon(result.finalTotalRepayment)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 p-4">
              <div className="text-xs font-semibold text-slate-500">기존 신용채무총액(연동)</div>
              <div className="mt-1 font-bold text-slate-900">{fmtWon(result.unsecuredDebtTotal)}</div>
            </div>
            <div className="rounded-xl bg-emerald-50 p-4">
              <div className="text-xs font-semibold text-emerald-600">탕감액(자동) / 탕감률</div>
              <div className="mt-1 font-bold text-emerald-700">
                {fmtWon(result.writeOffAmount)} ({result.writeOffRate.toFixed(1)}%)
              </div>
            </div>
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${result.feasible ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}>
            진행가능여부(자동판정): {result.feasible ? "가능" : "재검토 필요"}
            <div className="mt-1 text-xs font-normal">{result.feasibilityNote}</div>
          </div>
          <div className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
            ※ 위 계산은 상담 단계의 추정치이며, 최종 산정은 담당변호사 확인이 필요합니다. 최저생계비·소액임차인 기준액은 매년/지역별로 변경되므로 최신 고시 기준을 직접 확인해 입력하세요.
          </div>
        </div>
      )}

      {activeTab === "상담메모" && (
        <div className="space-y-4">
          <Label text="상담메모 / 상담내역">
            <textarea
              className={`${textareaClass} min-h-64`}
              value={consultMemo}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setConsultMemo(e.target.value)}
              placeholder="상담 진행 내용, 고객 요청사항, 후속 조치 등을 자유롭게 기록하세요."
            />
          </Label>
        </div>
      )}
    </>
  );
}

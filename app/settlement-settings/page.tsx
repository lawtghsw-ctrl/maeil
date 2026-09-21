"use client";

// ---- 정산설정 (독립 메뉴) ----
// 예전에는 고객관리 상세화면의 '정산 설정' 팝업 안에서만 담당자×결제수단 요율을
// 조정할 수 있었는데, 관리자가 이 설정을 별도 메뉴에서 언제든 관리할 수 있도록
// 독립된 페이지로 분리했습니다. 여기서 설정한 요율은
//  1) 고객관리 수정화면에서 영업진이 의뢰인의 '결제방식'을 선택하면
//  2) 정산 메뉴의 담당자별 예상 정산액에 담당자×결제방식 조합으로 즉시 반영됩니다.
import { useMemo, useState, type ChangeEvent } from "react";
import { useStore } from "@/lib/store";
import { PAYMENT_METHOD_NOTE, STAFF_LIST, type PaymentMethod, type StaffName } from "@/lib/types";
import { fmtWon } from "@/lib/format";
import { Card, NumberInput, PageHeader } from "@/components/ui/Primitives";

const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_NOTE) as PaymentMethod[];
const EXAMPLE_CONTRACT_AMOUNT = 3_300_000;

export default function SettlementSettingsPage() {
  const { settlementRates, updateSettlementRate } = useStore();
  const [exStaff, setExStaff] = useState<StaffName>(STAFF_LIST[0]);
  const [exMethod, setExMethod] = useState<PaymentMethod>(PAYMENT_METHODS[0]);

  const exRate = settlementRates[exStaff]?.[exMethod] ?? 0;
  const exAmount = useMemo(() => Math.round((EXAMPLE_CONTRACT_AMOUNT * exRate) / 100), [exRate]);

  return (
    <>
      <PageHeader
        title="정산설정"
        description="담당자 × 결제수단별 정산요율(%)을 관리자가 미리 설정해두면, 고객관리에서 영업진이 결제방식을 선택하는 즉시 정산 메뉴의 예상 정산액에 자동으로 반영됩니다."
      />

      <Card className="mb-4 space-y-2 border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-700">
        <div className="font-semibold">연동 흐름</div>
        <div>
          1. 이 화면에서 담당자별 · 결제수단별 정산요율(%)을 설정합니다. &nbsp;→&nbsp; 2. 고객관리 &gt; 고객정보 수정 화면에서
          영업진이 의뢰인의 결제방식을 드롭다운으로 선택합니다. &nbsp;→&nbsp; 3. 정산 메뉴의 담당자별 정산 요약에 (담당자 ×
          선택된 결제방식) 요율이 곱해진 예상 정산액이 자동으로 계산되어 표시됩니다.
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4 text-sm font-semibold text-slate-900">담당자 × 결제수단 정산요율(%)</div>
        <div className="overflow-x-auto">
          <table className="admin-responsive-table w-full min-w-[640px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">담당자</th>
                {PAYMENT_METHODS.map((m) => (
                  <th key={m} className="px-4 py-3 font-medium">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {STAFF_LIST.map((staff) => (
                <tr key={staff} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{staff}</td>
                  {PAYMENT_METHODS.map((m) => (
                    <td key={m} className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <NumberInput className="w-20" value={settlementRates[staff]?.[m] ?? 0} onChange={(v) => updateSettlementRate(staff, m, v)} />
                        <span className="text-slate-400">%</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">결제수단 설명</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="rounded-xl border border-slate-100 p-3">
              <div className="text-xs font-bold text-slate-800">{m}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-slate-500">{PAYMENT_METHOD_NOTE[m]}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-3 text-sm font-semibold text-slate-900">예상 정산금 미리보기</div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={exStaff}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setExStaff(e.target.value as StaffName)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {STAFF_LIST.map((s) => (
              <option key={s} value={s}>
                담당 {s}
              </option>
            ))}
          </select>
          <select
            value={exMethod}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setExMethod(e.target.value as PaymentMethod)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <div className="text-xs font-semibold text-slate-500">예시 계약금액 {fmtWon(EXAMPLE_CONTRACT_AMOUNT)} 기준</div>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="text-lg font-bold text-slate-900">{fmtWon(exAmount)}</span>
            <span className="text-xs text-slate-400">
              = 계약금액 {fmtWon(EXAMPLE_CONTRACT_AMOUNT)} × 적용요율 {exRate}%
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}

"use client";

// 상담일지 대형 팝업 — "자산" 섹션. 거주형태·차량은 v12에서 새로 추가된 ConsultationHousing
// 필드이고, 그 아래 "재산현황(청산가치 참고)" 표는 기존 재산현황(AssetRow[], 청산가치 산정용)
// 표를 그대로 접어 넣은 것입니다 — 기존 필드/계산 로직은 전혀 바뀌지 않았습니다.
import type { ChangeEvent } from "react";
import type { AssetRow, ConsultationHousing } from "@/lib/types";
import { HOUSING_TYPES } from "@/lib/types";
import { Input, Label, NumberInput, Select } from "@/components/ui/Primitives";
import { OXToggle, SectionCard } from "./shared";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

export function AssetSection({
  housing,
  patchHousing,
  assets,
  setAssets,
  requiredKeys,
  missingKeys,
}: {
  housing: ConsultationHousing;
  patchHousing: (p: Partial<ConsultationHousing>) => void;
  assets: AssetRow[];
  setAssets: Updater<AssetRow[]>;
  requiredKeys: Set<string>;
  missingKeys: Set<string>;
}) {
  function updateAsset(i: number, patch: Partial<AssetRow>) {
    setAssets((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  }

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

      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 border-t border-slate-100 pt-2.5">
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

      <div className="border-t border-slate-100 pt-2.5">
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

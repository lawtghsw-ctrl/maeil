"use client";

// ---- 상세 DB관리 ----
// "사진 보낸거처럼 고객을 분류하고 싶다"는 요청 반영 — 상담일지에서 지정한 상세
// 단계(detailStage)를 기준으로, 참고 이미지 스타일의 색상 타일(착수/서류/법원/워크아웃
// 4개 트랙 × 단계별 건수·비율)을 보여주고, 타일을 클릭하면 그 아래에 해당 단계의
// 고객 리스트가 게시판 형식으로 나타나도록 만들었습니다.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import {
  DB_DETAIL_STAGE_GROUPS,
  DB_DETAIL_STAGE_TRACK_COLOR,
  DB_DETAIL_STAGE_TRACKS,
  DB_LEAD_STATUS_LABEL,
  type DbDetailStage,
  type DbDetailStageTrack,
  type DbLead,
} from "@/lib/types";
import { fmtDate, fmtPct } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/Primitives";
import { DbLeadStatusBadge } from "@/components/ui/Badge";
import { Layers } from "lucide-react";

export default function DbDetailManagementPage() {
  const { leads } = useStore();
  const [selectedStage, setSelectedStage] = useState<DbDetailStage | null>(null);

  const classifiedCount = leads.filter((l) => l.detailStage).length;
  const totalCount = leads.length;

  // 트랙별 · 단계별 건수 — 전체 리드 수 대비 비율(%)로 표시(참고 이미지와 동일한 방식)
  const countOf = useMemo(() => {
    const map = new Map<DbDetailStage, number>();
    for (const l of leads) {
      if (!l.detailStage) continue;
      map.set(l.detailStage, (map.get(l.detailStage) ?? 0) + 1);
    }
    return map;
  }, [leads]);

  const trackTotal = useMemo(() => {
    const map = new Map<DbDetailStageTrack, number>();
    for (const track of DB_DETAIL_STAGE_TRACKS) {
      const sum = DB_DETAIL_STAGE_GROUPS[track].reduce((a, s) => a + (countOf.get(s) ?? 0), 0);
      map.set(track, sum);
    }
    return map;
  }, [countOf]);

  const selectedLeads: DbLead[] = useMemo(() => {
    if (!selectedStage) return [];
    return leads
      .filter((l) => l.detailStage === selectedStage)
      .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
  }, [leads, selectedStage]);

  return (
    <>
      <PageHeader
        title="상세 DB관리"
        description={`상담일지에서 지정한 상세 단계 기준 분류 — 분류됨 ${classifiedCount}건 / 전체 ${totalCount}건. 타일을 클릭하면 아래에 해당 단계의 고객 리스트가 나타납니다.`}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {DB_DETAIL_STAGE_TRACKS.map((track) => (
          <Card key={track} className="overflow-hidden">
            <div
              className="flex items-center justify-between border-b border-slate-100 px-4 py-3"
              style={{ borderTopWidth: 3, borderTopColor: DB_DETAIL_STAGE_TRACK_COLOR[track] }}
            >
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: DB_DETAIL_STAGE_TRACK_COLOR[track] }}
                />
                {track} 트랙
              </div>
              <span className="text-xs text-slate-400">{trackTotal.get(track) ?? 0}건</span>
            </div>
            <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3">
              {DB_DETAIL_STAGE_GROUPS[track].map((stage) => {
                const count = countOf.get(stage) ?? 0;
                const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
                const active = selectedStage === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setSelectedStage((prev) => (prev === stage ? null : stage))}
                    className={`rounded-xl border-2 p-3 text-left transition ${
                      active ? "border-slate-800 bg-slate-900 text-white shadow-md" : "border-slate-100 bg-slate-50 text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    <div className={`truncate text-xs font-semibold ${active ? "text-white" : "text-slate-600"}`}>{stage}</div>
                    <div className="mt-1.5 flex items-baseline gap-1">
                      <span className="text-lg font-bold">{count}</span>
                      <span className={`text-[11px] ${active ? "text-slate-300" : "text-slate-400"}`}>건({fmtPct(pct)})</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-4 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Layers size={16} className="text-slate-400" />
            {selectedStage ? `${selectedStage} 단계 고객 리스트` : "단계를 선택하면 고객 리스트가 표시됩니다"}
          </div>
          {selectedStage && <span className="text-xs text-slate-400">{selectedLeads.length}건</span>}
        </div>

        {!selectedStage ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">
            위 타일 중 하나를 클릭해 해당 단계로 분류된 고객만 모아볼 수 있습니다.
          </div>
        ) : selectedLeads.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">이 단계로 분류된 고객이 아직 없습니다.</div>
        ) : (
          // 게시판처럼 세로로 나열 — 목록이 길어지면 카드 안에서 세로 스크롤
          <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
            {selectedLeads.map((lead) => (
              <div key={lead.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-900">{lead.name}</span>
                    <span className="text-xs text-slate-400">{lead.phone}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    접수 {fmtDate(lead.receivedAt)} · 담당 {lead.assignedStaff}
                    {lead.applicationType && ` · ${lead.applicationType}`}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <DbLeadStatusBadge status={lead.status} />
                  {lead.convertedClientId ? (
                    <Link href="/clients" className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
                      고객관리로 이동
                    </Link>
                  ) : (
                    <Link href="/db" className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                      DB관리에서 보기
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mt-3 text-[11px] text-slate-400">
        ※ 단계 분류는 DB관리 &gt; 상담일지 팝업의 "상세 단계" 드롭다운에서 지정합니다. {DB_LEAD_STATUS_LABEL["신규접수"]} 상태처럼 아직 분류하지 않은 건은 위 타일에 집계되지 않습니다.
      </div>
    </>
  );
}

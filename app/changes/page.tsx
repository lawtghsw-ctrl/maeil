"use client";

// 도원 Admin(tg_m)의 '변동내역'(components/change-history.tsx) 구조를 이식.
// 실제 Supabase 트리거 대신, store.tsx의 각 mutation 호출부에서 직접 남기는
// 인메모리 changeLog를 사용합니다(새로고침 시 초기화되는 데모 로그).
import { useMemo, useState } from "react";
import { useStore, type ChangeAction, type ChangeCategory, type ChangeLogEntry } from "@/lib/store";
import { Badge, Card, PageHeader, Pagination, pageRows, type BadgeTone } from "@/components/ui/Primitives";

const CATEGORIES: ChangeCategory[] = ["DB관리", "계약관리", "설정"];
const ACTION_TONE: Record<ChangeAction, BadgeTone> = {
  등록: "green",
  수정: "blue",
  삭제: "red",
};

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function CategoryCard({ category, rows }: { category: ChangeCategory; rows: ChangeLogEntry[] }) {
  const [page, setPage] = useState(1);
  const pageSize = 5;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="text-sm font-semibold text-slate-900">{category}</div>
        <div className="text-xs text-slate-400">{rows.length}건</div>
      </div>
      <div className="divide-y divide-slate-100">
        {rows.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">변동 내역이 없습니다.</div>}
        {pageRows(rows, page, pageSize).map((r) => (
          <div key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge tone={ACTION_TONE[r.action]}>{r.action}</Badge>
                <span className="truncate font-semibold text-slate-900">{r.targetName}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">{r.detail}</div>
            </div>
            <div className="shrink-0 text-right text-xs text-slate-400">
              <div>{fmtDateTime(r.at)}</div>
              <div>{r.staff}</div>
            </div>
          </div>
        ))}
      </div>
      <Pagination page={page} total={rows.length} onChange={setPage} pageSize={pageSize} />
    </Card>
  );
}

export default function ChangesPage() {
  const { changeLog, can, profile } = useStore();
  const [categoryFilter, setCategoryFilter] = useState<ChangeCategory | "전체">("전체");

  const byCategory = useMemo(() => {
    const map = new Map<ChangeCategory, ChangeLogEntry[]>();
    for (const c of CATEGORIES) map.set(c, []);
    for (const entry of changeLog) {
      map.get(entry.category)?.push(entry);
    }
    return map;
  }, [changeLog]);

  const visibleCategories = categoryFilter === "전체" ? CATEGORIES : [categoryFilter];

  return (
    <>
      <PageHeader
        title="기간별 변동내역"
        description={`${can("changes.view_all") ? "전체 직원" : profile?.displayName ?? "내"} 기준 · DB관리·계약관리·설정 등록/수정/삭제 이력 ${changeLog.length}건`}
      />

      <Card className="mb-4 flex flex-wrap gap-2 p-3">
        <button
          onClick={() => setCategoryFilter("전체")}
          className={`rounded-md px-2.5 py-1 text-xs font-semibold ${categoryFilter === "전체" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          전체 ({changeLog.length})
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategoryFilter(c)}
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${categoryFilter === c ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {c} ({byCategory.get(c)?.length ?? 0})
          </button>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {visibleCategories.map((c) => (
          <CategoryCard key={c} category={c} rows={byCategory.get(c) ?? []} />
        ))}
      </div>
    </>
  );
}

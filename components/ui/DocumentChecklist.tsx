"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import {
  DOC_REMINDER_THRESHOLDS,
  DOCUMENT_CHECKLIST_TEMPLATE,
  DOCUMENT_SOURCE_COLOR,
  type DocumentSourceTag,
} from "@/lib/documents";
import { fmtDate } from "@/lib/format";

const SOURCE_ORDER: DocumentSourceTag[] = ["주민센터", "온라인전용", "직장요청", "세무사요청", "기타"];

export function DocumentChecklist({ caseId, docsSentAt }: { caseId: string; docsSentAt?: string }) {
  const { caseDocuments, toggleDocument } = useStore();
  const checked = caseDocuments[caseId] ?? {};

  const { doneCount, total } = useMemo(() => {
    const total = DOCUMENT_CHECKLIST_TEMPLATE.length;
    const doneCount = DOCUMENT_CHECKLIST_TEMPLATE.filter((d) => checked[d.id]).length;
    return { doneCount, total };
  }, [checked]);

  const elapsedDays = docsSentAt
    ? Math.floor((Date.now() - new Date(docsSentAt + "T00:00:00").getTime()) / 86400000)
    : undefined;
  const isOverdueReminder =
    elapsedDays !== undefined && doneCount < total && elapsedDays >= DOC_REMINDER_THRESHOLDS[0];

  return (
    <div className="card p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink">서류 체크리스트</div>
        <div className="text-xs text-muted">
          {doneCount}/{total} 수령완료
          {docsSentAt && ` · 안내문 발송 ${fmtDate(docsSentAt)}`}
        </div>
      </div>

      {docsSentAt && isOverdueReminder && (
        <div className="mb-3 rounded-md2 bg-gold-tint px-3 py-2 text-xs text-gold">
          안내문 발송 후 {elapsedDays}일 경과 — 미수령 서류 독촉이 필요할 수 있어요 (D+
          {DOC_REMINDER_THRESHOLDS.join(", D+")} 기준).
        </div>
      )}

      <div className="space-y-4">
        {SOURCE_ORDER.map((source) => {
          const items = DOCUMENT_CHECKLIST_TEMPLATE.filter((d) => d.source === source);
          if (items.length === 0) return null;
          return (
            <div key={source}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: DOCUMENT_SOURCE_COLOR[source] }}
                />
                <span style={{ color: DOCUMENT_SOURCE_COLOR[source] }}>{source}</span>
              </div>
              <ul className="space-y-1.5">
                {items.map((item) => (
                  <li key={item.id}>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md2 border border-line px-3 py-2 text-xs hover:bg-bg">
                      <input
                        type="checkbox"
                        checked={!!checked[item.id]}
                        onChange={() => toggleDocument(caseId, item.id)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className={checked[item.id] ? "text-muted line-through" : "text-ink"}>
                          {item.no}. {item.label}
                        </span>
                        {item.note && <span className="block text-[11px] text-muted2">{item.note}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

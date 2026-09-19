"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getCaseById,
  getClientById,
  getInstallmentsByCase,
  getScheduleByCase,
  receivableOf,
} from "@/lib/mock-data";
import { CASE_STAGES, STAGE_LABELS } from "@/lib/types";
import { CaseTypeBadge, InstallmentStatusBadge, StatusBadge } from "@/components/ui/Badge";
import { fmtDate, fmtWon } from "@/lib/format";

export default function CaseDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = Array.isArray(params.id) ? params.id[0] : params.id;
  const c = caseId ? getCaseById(caseId) : undefined;

  if (!c) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm text-muted">사건을 찾을 수 없습니다.</p>
        <Link href="/cases" className="mt-3 inline-block text-sm text-brand">
          사건 목록으로 돌아가기
        </Link>
      </div>
    );
  }

  const client = getClientById(c.clientId);
  const installs = getInstallmentsByCase(c.id);
  const schedule = getScheduleByCase(c.id);
  const receivable = receivableOf(c);
  const stageIdx = CASE_STAGES.indexOf(c.stage);

  return (
    <div className="space-y-4">
      <Link href="/cases" className="text-sm text-muted hover:text-ink">
        ← 사건 목록
      </Link>

      <div className="card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold text-ink">{client?.name ?? "-"}님</h1>
          <CaseTypeBadge caseType={c.caseType} />
          <StatusBadge status={c.status} />
          <span className="text-sm text-muted">{c.caseNumber}</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {c.court} · 담당 {c.assignedStaff} · {client?.phone}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoBox label="총 채무액" value={fmtWon(c.totalDebt)} />
          <InfoBox label="계약금액" value={fmtWon(c.contractAmount)} />
          <InfoBox label="기납부액" value={fmtWon(c.paidAmount)} />
          <InfoBox
            label="미수금"
            value={fmtWon(receivable)}
            tone={receivable > 0 ? "danger" : undefined}
          />
        </div>

        {c.monthlyRepayment && (
          <div className="mt-3 rounded-md2 bg-brand-pale px-3 py-2 text-sm text-brand">
            월 변제금 {fmtWon(c.monthlyRepayment)}
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="mb-4 text-sm font-semibold text-ink">절차 진행 단계</div>
        <div className="flex items-center overflow-x-auto pb-1">
          {CASE_STAGES.map((st, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div key={st} className="flex items-center">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      active
                        ? "bg-brand text-white"
                        : done
                        ? "bg-success text-white"
                        : "bg-line text-muted2"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <div
                    className={`w-20 text-center text-[11px] ${
                      active ? "font-semibold text-brand" : "text-muted2"
                    }`}
                  >
                    {STAGE_LABELS[c.caseType][st]}
                  </div>
                </div>
                {i < CASE_STAGES.length - 1 && (
                  <div
                    className={`h-0.5 w-8 shrink-0 sm:w-12 ${
                      i < stageIdx ? "bg-success" : "bg-line"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 text-xs text-muted">
          최근 단계 변경일 {fmtDate(c.stageUpdatedAt)}
          {c.filingDate && ` · 법원접수일 ${fmtDate(c.filingDate)}`}
          {c.nextHearingDate && ` · 다음 기일 ${fmtDate(c.nextHearingDate)}`}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold text-ink">입금 내역</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">회차</th>
                <th className="py-2 pr-3 font-medium">납부기한</th>
                <th className="py-2 pr-3 font-medium">금액</th>
                <th className="py-2 pr-3 font-medium">상태</th>
                <th className="py-2 font-medium">입금일</th>
              </tr>
            </thead>
            <tbody>
              {installs.map((ins) => (
                <tr key={ins.id} className="border-b border-line last:border-0">
                  <td className="py-2.5 pr-3 text-muted">
                    {ins.seq === 1 ? "계약금" : `${ins.seq - 1}회차`}
                  </td>
                  <td className="py-2.5 pr-3 text-muted">{fmtDate(ins.dueDate)}</td>
                  <td className="py-2.5 pr-3 text-ink">{fmtWon(ins.amount)}</td>
                  <td className="py-2.5 pr-3">
                    <InstallmentStatusBadge status={ins.status} />
                  </td>
                  <td className="py-2.5 text-muted">
                    {ins.paidDate ? fmtDate(ins.paidDate) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 text-sm font-semibold text-ink">일정</div>
        {schedule.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted">등록된 일정이 없습니다.</div>
        ) : (
          <ul className="space-y-2">
            {schedule.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-md2 border border-line px-3 py-2 text-sm">
                <span className="rounded-sm2 bg-brand-pale px-1.5 py-0.5 text-[11px] font-medium text-brand">
                  {s.type}
                </span>
                <span className="text-ink">{s.title}</span>
                <span className="ml-auto text-muted">{fmtDate(s.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function InfoBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-md2 border border-line px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 text-sm font-semibold ${tone === "danger" ? "text-danger" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

"use client";

// 최종 상담일지 레이아웃:
// - 브라우저 창에 거의 꽉 차는 대형 팝업
// - 좌/중/우 동일 폭 3열
// - 좌측은 기본정보→기타, 중단은 소득→자산, 우측은 의사→플랜
// - 기대출리스트는 참고 이미지처럼 중단+우측 하단(2개 컬럼)을 합쳐 배치
// - 각 섹션 제목은 회색 '구분 바'일 뿐 클릭/입력 액션이 없음
// - 전체 팝업 스크롤을 최소화하고, 필요한 경우 각 컬럼/기대출 표 내부에서만 스크롤
// 기존 데이터 필드는 삭제하지 않고 화면에서 요구된 항목만 재배치합니다.
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  REQUIRED_CONSULTATION_FIELDS,
  checkConsultationRequired,
  computeRepaymentPlan,
  emptyAssetRows,
  emptyDebtRows,
  emptyPlanInput,
  getConsultationCompletionStats,
} from "@/lib/consultation";
import type {
  AssetRow,
  AttachedFileMeta,
  ConsultationCounselPlan,
  ConsultationDebtSummaryExtra,
  ConsultationHousing,
  ConsultationIncome,
  ConsultationInfo,
  ConsultationJudgment,
  ConsultationPersonal,
  ConsultationRecentLoanInsurance,
  ConsultDirection,
  DbDetailStage,
  DebtRow,
  LoanRecord,
  MemoLogEntry,
  OccupationType,
  RepaymentPlanInput,
} from "@/lib/types";
import { CONSULT_DIRECTIONS, DB_DETAIL_STAGE_GROUPS, DB_DETAIL_STAGE_TRACKS } from "@/lib/types";
import { Button, Modal } from "@/components/ui/Primitives";
import { BasicInfoSection } from "./BasicInfoSection";
import { IncomeSection } from "./IncomeSection";
import { AssetSection } from "./AssetSection";
import { DecisionSection } from "./DecisionSection";
import { PlanSection } from "./PlanSection";
import { DebtListSection } from "./DebtListSection";
import { ConsultationMemoSection } from "./ConsultationMemoSection";
import { denseSelectClass } from "./shared";
import { Download, MessageSquareText, ShieldAlert, ShieldCheck } from "lucide-react";

type Updater<T> = (updater: T | ((prev: T) => T)) => void;

function makePatcher<T>(setState: Updater<T>) {
  return (patch: Partial<T>) => setState((prev) => ({ ...prev, ...patch }));
}

export function ConsultationModal({
  open,
  resetKey,
  onClose,
  displayName,
  displayPhone,
  joinedAtLabel,
  caseNumberLabel,
  applicationType,
  onApplicationTypeChange,
  showDetailStage = false,
  detailStage,
  onDetailStageChange,
  initialConsultation,
  onSave,
  onExportExcel,
}: {
  open: boolean;
  resetKey: string;
  onClose: () => void;
  displayName: string;
  displayPhone: string;
  joinedAtLabel: string;
  caseNumberLabel: string;
  applicationType: ConsultDirection | undefined;
  onApplicationTypeChange: (v: ConsultDirection | undefined) => void;
  showDetailStage?: boolean;
  detailStage?: DbDetailStage;
  onDetailStageChange?: (v: DbDetailStage | undefined) => void;
  initialConsultation: ConsultationInfo | undefined;
  onSave: (consultation: ConsultationInfo) => void;
  onExportExcel?: (draft: ConsultationInfo) => void;
}) {
  const [personal, setPersonal] = useState<ConsultationPersonal>(initialConsultation?.personal ?? {});
  const [income, setIncome] = useState<ConsultationIncome>(initialConsultation?.income ?? {});
  const [assets, setAssets] = useState<AssetRow[]>(initialConsultation?.assets ?? emptyAssetRows());
  const [debts, setDebts] = useState<DebtRow[]>(initialConsultation?.debts ?? emptyDebtRows());
  const [plan, setPlan] = useState<RepaymentPlanInput>(initialConsultation?.plan ?? emptyPlanInput());
  const [memoLog, setMemoLog] = useState<MemoLogEntry[]>(initialConsultation?.memoLog ?? []);
  const [loanRecords, setLoanRecords] = useState<LoanRecord[]>(initialConsultation?.loanRecords ?? []);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileMeta[]>(initialConsultation?.attachedFiles ?? []);
  const [housing, setHousing] = useState<ConsultationHousing>(initialConsultation?.housing ?? {});
  const [judgment, setJudgment] = useState<ConsultationJudgment>(initialConsultation?.judgment ?? {});
  const [counselPlan, setCounselPlan] = useState<ConsultationCounselPlan>(initialConsultation?.counselPlan ?? {});
  const [debtSummaryExtra, setDebtSummaryExtra] = useState<ConsultationDebtSummaryExtra>(initialConsultation?.debtSummaryExtra ?? {});
  const [recentLoanInsurance, setRecentLoanInsurance] = useState<ConsultationRecentLoanInsurance>(initialConsultation?.recentLoanInsurance ?? {});
  const [showMemo, setShowMemo] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPersonal(initialConsultation?.personal ?? {});
    setIncome(initialConsultation?.income ?? {});
    setAssets(initialConsultation?.assets ?? emptyAssetRows());
    setDebts(initialConsultation?.debts ?? emptyDebtRows());
    setPlan(initialConsultation?.plan ?? emptyPlanInput());
    setMemoLog(initialConsultation?.memoLog ?? []);
    setLoanRecords(initialConsultation?.loanRecords ?? []);
    setAttachedFiles(initialConsultation?.attachedFiles ?? []);
    setHousing(initialConsultation?.housing ?? {});
    setJudgment(initialConsultation?.judgment ?? {});
    setCounselPlan(initialConsultation?.counselPlan ?? {});
    setDebtSummaryExtra(initialConsultation?.debtSummaryExtra ?? {});
    setRecentLoanInsurance(initialConsultation?.recentLoanInsurance ?? {});
    setShowMemo(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey]);

  const patchPersonal = useMemo(() => makePatcher(setPersonal), []);
  const patchIncome = useMemo(() => makePatcher(setIncome), []);
  const patchHousing = useMemo(() => makePatcher(setHousing), []);
  const patchJudgment = useMemo(() => makePatcher(setJudgment), []);
  const patchCounselPlan = useMemo(() => makePatcher(setCounselPlan), []);
  const patchDebtSummaryExtra = useMemo(() => makePatcher(setDebtSummaryExtra), []);
  const patchRecentLoanInsurance = useMemo(() => makePatcher(setRecentLoanInsurance), []);
  const patchPlan = useMemo(() => makePatcher(setPlan), []);

  const result = useMemo(
    () => computeRepaymentPlan(income.monthlyAvgIncome ?? 0, income.secondaryIncome ?? 0, income.pensionIncome ?? 0, assets, debts, plan),
    [income, assets, debts, plan]
  );

  const draft: ConsultationInfo = useMemo(
    () => ({
      personal,
      income,
      assets,
      debts,
      plan,
      memo: initialConsultation?.memo,
      memoLog,
      loanRecords,
      attachedFiles,
      housing,
      judgment,
      counselPlan,
      debtSummaryExtra,
      recentLoanInsurance,
    }),
    [personal, income, assets, debts, plan, memoLog, loanRecords, attachedFiles, housing, judgment, counselPlan, debtSummaryExtra, recentLoanInsurance, initialConsultation?.memo]
  );

  const completeness = useMemo(() => checkConsultationRequired(applicationType, draft), [applicationType, draft]);
  const stats = useMemo(() => getConsultationCompletionStats(applicationType, draft), [applicationType, draft]);
  const missingKeys = useMemo(() => new Set(completeness.missingFields.map((f) => f.key)), [completeness]);
  const requiredKeys = useMemo(() => new Set(REQUIRED_CONSULTATION_FIELDS.map((f) => f.key)), []);

  function save() {
    onSave(draft);
    onClose();
  }

  const headerExtra = (
    <span
      title={completeness.ok ? "필수항목 입력 완료" : completeness.missing.join("\n")}
      className={`hidden shrink-0 items-center gap-1 rounded px-2 py-1 text-[11px] font-bold sm:inline-flex ${
        completeness.ok ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
      }`}
    >
      {completeness.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
      작성률 {stats.percent}% · 필수 {REQUIRED_CONSULTATION_FIELDS.length - missingKeys.size}/{REQUIRED_CONSULTATION_FIELDS.length}
    </span>
  );

  return (
    <>
      <Modal
        open={open}
        title={`${displayName} · 상담일지`}
        headerExtra={headerExtra}
        onClose={onClose}
        size="full"
        contentClassName="overflow-hidden !p-2 sm:!p-2.5"
      >
        <div className="flex h-full min-h-0 flex-col gap-2">
          {/* 기존 상담후방향/상세단계 기능은 없애지 않고 높이 32px짜리 얇은 툴바로 이동 */}
          <div className="flex min-h-8 shrink-0 items-center gap-2 rounded-[5px] border border-slate-300 bg-slate-50 px-2 py-1">
            <span className="shrink-0 text-[11px] font-semibold text-slate-600">상담 후 방향</span>
            <select
              value={applicationType ?? ""}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => onApplicationTypeChange((e.target.value || undefined) as ConsultDirection | undefined)}
              className={`${denseSelectClass} w-[150px] ${missingKeys.has("applicationType") ? "border-sky-400 bg-sky-50" : ""}`}
            >
              <option value="">미지정</option>
              {CONSULT_DIRECTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            {showDetailStage && (
              <>
                <span className="ml-1 shrink-0 text-[11px] font-semibold text-slate-600">상세 단계</span>
                <select
                  value={detailStage ?? ""}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => onDetailStageChange?.((e.target.value || undefined) as DbDetailStage | undefined)}
                  className={`${denseSelectClass} w-[180px]`}
                >
                  <option value="">미지정</option>
                  {DB_DETAIL_STAGE_TRACKS.map((track) => (
                    <optgroup key={track} label={track}>
                      {DB_DETAIL_STAGE_GROUPS[track].map((s) => <option key={s} value={s}>{s}</option>)}
                    </optgroup>
                  ))}
                </select>
              </>
            )}

            <div className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
              {attachedFiles.length > 0 && <span>첨부 {attachedFiles.length}건</span>}
              {!completeness.ok && (
                <span className="font-semibold text-red-600" title={completeness.missing.join("\n")}>필수 미입력 {completeness.missing.length}건</span>
              )}
            </div>
          </div>

          {/* 3열 동일 폭. 기대출리스트는 중단+우측의 하단을 합친 2열 폭. */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 xl:grid-cols-3 xl:grid-rows-[minmax(0,1fr)_245px]">
            <div className="min-h-0 xl:row-span-2 xl:overflow-y-auto xl:pr-0.5">
              <BasicInfoSection
                personal={personal}
                patchPersonal={patchPersonal}
                income={income}
                patchIncome={patchIncome}
                requiredKeys={requiredKeys}
                missingKeys={missingKeys}
                displayName={displayName}
                displayPhone={displayPhone}
                joinedAtLabel={joinedAtLabel}
                caseNumberLabel={caseNumberLabel}
              />
            </div>

            <div className="min-h-0 space-y-2 xl:overflow-y-auto xl:pr-0.5">
              <IncomeSection
                income={income}
                patchIncome={patchIncome}
                occupationType={personal.occupationType}
                onOccupationTypeChange={(v: OccupationType | undefined) => patchPersonal({ occupationType: v })}
                requiredKeys={requiredKeys}
                missingKeys={missingKeys}
              />
              <AssetSection
                housing={housing}
                patchHousing={patchHousing}
                assets={assets}
                setAssets={setAssets}
                loanRecords={loanRecords}
                debtSummaryExtra={debtSummaryExtra}
                patchDebtSummaryExtra={patchDebtSummaryExtra}
                requiredKeys={requiredKeys}
                missingKeys={missingKeys}
              />
            </div>

            <div className="min-h-0 space-y-2 xl:overflow-y-auto xl:pr-0.5">
              <DecisionSection judgment={judgment} patchJudgment={patchJudgment} />
              <PlanSection
                counselPlan={counselPlan}
                patchCounselPlan={patchCounselPlan}
                plan={plan}
                patchPlan={patchPlan}
                result={result}
                recentLoanInsurance={recentLoanInsurance}
                patchRecentLoanInsurance={patchRecentLoanInsurance}
              />
            </div>

            <DebtListSection
              className="h-full min-h-0 xl:col-start-2 xl:col-span-2 xl:row-start-2"
              loanRecords={loanRecords}
              setLoanRecords={setLoanRecords}
              setAttachedFiles={setAttachedFiles}
            />
          </div>

          <div className="flex h-9 shrink-0 items-center justify-between border-t border-slate-200 pt-1.5">
            <div className="flex items-center gap-1.5">
              <Button variant="secondary" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={() => setShowMemo(true)}>
                <MessageSquareText size={13} /> 상담메모 {memoLog.length > 0 ? `(${memoLog.length})` : ""}
              </Button>
              {onExportExcel && (
                <Button variant="secondary" className="h-7 rounded-[4px] px-2 text-[11px]" onClick={() => onExportExcel(draft)}>
                  <Download size={13} /> 엑셀 다운로드
                </Button>
              )}
            </div>
            <div className="flex gap-1.5">
              <Button variant="secondary" className="h-7 rounded-[4px] px-3 text-[11px]" onClick={onClose}>취소</Button>
              <Button className="h-7 rounded-[4px] px-3 text-[11px]" onClick={save}>저장</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 메모 기능은 기존 요구사항을 보존하되 메인 상담일지 높이를 잡아먹지 않도록 별도 팝업으로 분리 */}
      <Modal open={open && showMemo} title={`${displayName} · 상담메모`} onClose={() => setShowMemo(false)} size="lg">
        <ConsultationMemoSection memoLog={memoLog} setMemoLog={setMemoLog} />
        <div className="mt-3 flex justify-end">
          <Button onClick={() => setShowMemo(false)}>확인</Button>
        </div>
      </Modal>
    </>
  );
}

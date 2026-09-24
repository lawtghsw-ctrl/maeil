"use client";

// 상담일지 대형 팝업(v12 전면개편, v13 레이아웃 정밀개편) — 기본정보→소득→자산→상담판단→
// 채무→상담메모를 스크롤 없이(내부 스크롤은 각 표/리스트 안에서만) 한 화면에서 확인·수정할
// 수 있는 단일 팝업으로 통합했습니다. DB관리(app/db/page.tsx)의 LeadConsultationModal과
// 고객관리(app/clients/page.tsx)의 ClientConsultationModal이 이 컴포넌트 하나를 공유하며,
// "상담 후 방향"(applicationType)·"상세 단계"(detailStage) 선택만 화면별로 다르게 보여줄
// 수 있도록 옵션으로 뺐습니다(고객관리에는 detailStage 개념이 없음).
//
// ---- v13 레이아웃 정밀개편 (사용자가 이미지 대신 정밀한 필드 배치를 텍스트로 재요청) ----
// 좌측(기본정보+기타) / 중단(소득+자산+채무요약) / 우측(의사+플랜+최근대출·보험)을 명시적
// 3개 컬럼 div로 배치하고(이전처럼 CSS Grid auto-flow에 기대지 않음 — 순서 보장 목적),
// 하단 전체폭에 "기대출리스트"(파일업로드+수기입력 통합) → 상담메모 순으로 이어붙였습니다.
// "[기본정보][소득][의사][자산][기대출리스트][기타][플랜]"은 shared.tsx의 SectionBar로
// 순수 회색 구분 바(액션 불가)로 렌더링됩니다.
//
// ---- 저장 방식에 대한 설계 결정 (Section 11, v12에서 확정, 변경 없음) ----
// 프로젝트 전체가 예외 없이 "취소/저장" 명시적 버튼 구조라, 이 모달도 자동저장 대신
// 명시적 저장 버튼을 유지합니다. 헤더에는 자동저장 상태 대신 "상담일지 작성률/필수항목
// 충족" 배지를 보여줍니다(고객전환 가능 여부는 이 배지가 아니라 필수항목 충족 여부로만
// 판정 — Section 24).
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
import { Button, Modal, Select } from "@/components/ui/Primitives";
import { BasicInfoSection } from "./BasicInfoSection";
import { IncomeSection } from "./IncomeSection";
import { AssetSection } from "./AssetSection";
import { DecisionSection } from "./DecisionSection";
import { PlanSection } from "./PlanSection";
import { DebtListSection } from "./DebtListSection";
import { ConsultationMemoSection } from "./ConsultationMemoSection";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { fmtWon } from "@/lib/format";

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
  allowApplicationTypeEdit = true,
  showDetailStage = false,
  detailStage,
  onDetailStageChange,
  initialConsultation,
  onSave,
  onExportExcel,
  contractAmount = 0,
  paidAmount = 0,
  outstandingAmount = 0,
  showFinanceSummary = true,
  readOnly = false,
  reservationChoice,
  reservationAt,
  onReservationChoiceChange,
  onReservationAtChange,
}: {
  open: boolean;
  // 대상(리드/고객)이 바뀔 때마다 내부 draft 상태를 다시 초기화하기 위한 키. 보통
  // lead.id 또는 client.id를 그대로 넘기면 됩니다.
  resetKey: string;
  onClose: () => void;
  displayName: string;
  displayPhone: string;
  joinedAtLabel: string;
  caseNumberLabel: string;
  applicationType: ConsultDirection | undefined;
  onApplicationTypeChange: (v: ConsultDirection | undefined) => void;
  allowApplicationTypeEdit?: boolean;
  // 상세 DB관리 분류(detailStage)는 DB관리 화면에만 있는 개념이라(고객관리 Client에는
  // 없음), 화면별로 켜고 끌 수 있도록 옵션으로 뺐습니다.
  showDetailStage?: boolean;
  detailStage?: DbDetailStage;
  onDetailStageChange?: (v: DbDetailStage | undefined) => void;
  initialConsultation: ConsultationInfo | undefined;
  onSave: (consultation: ConsultationInfo) => void;
  // 고객관리 화면에만 있는 "고객 상담 엑셀 다운로드" 버튼 — 지금 화면에서 편집 중인
  // draft 스냅샷을 그대로 넘겨줘야 해서(저장하지 않고도 다운로드 가능), 콜백 형태로
  // 뺐습니다. 전달하지 않으면 버튼 자체가 보이지 않습니다(DB관리 화면은 사용 안 함).
  onExportExcel?: (draft: ConsultationInfo) => void;
  // 계약관리와 연결된 금액 요약. DB 단계에서 아직 계약이 없으면 0원으로 표시합니다.
  contractAmount?: number;
  paidAmount?: number;
  outstandingAmount?: number;
  showFinanceSummary?: boolean;
  readOnly?: boolean;
  // DB 리드 상담일지에서만 노출되는 예약 일정 편집. 고객/계약 쪽에서 재사용할 때는 생략 가능.
  reservationChoice?: boolean;
  reservationAt?: string;
  onReservationChoiceChange?: (value: boolean | undefined) => void;
  onReservationAtChange?: (value: string | undefined) => void;
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

  // 대상이 바뀌면(resetKey 변경) 모든 draft를 해당 대상의 값으로 다시 채웁니다 — 기존
  // LeadConsultationModal/CustomerEditModal과 동일한 패턴.
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

  const result = useMemo(() => {
    const loanTotal = loanRecords.reduce((sum, row) => sum + (row.balance || 0), 0);
    const loanSecured = loanRecords
      .filter((row) => row.kind1 === "담보")
      .reduce((sum, row) => sum + (row.balance || 0), 0);
    const loanUnsecured = loanRecords
      .filter((row) => row.kind1 !== "담보")
      .reduce((sum, row) => sum + (row.balance || 0), 0);

    const totalDebt = debtSummaryExtra.totalDebtAmount ?? (loanTotal || undefined);
    const securedDebt = debtSummaryExtra.totalSecuredAmount ?? (loanSecured || undefined);
    const unsecuredDebt = debtSummaryExtra.totalCreditAmount ?? (loanUnsecured || undefined);

    return computeRepaymentPlan(
      income.monthlyAvgIncome ?? 0,
      income.secondaryIncome ?? 0,
      income.pensionIncome ?? 0,
      assets,
      debts,
      plan,
      { totalDebt, securedDebt, unsecuredDebt }
    );
  }, [income, assets, debts, plan, loanRecords, debtSummaryExtra]);

  // "지금 이 화면에서 편집 중인 값 전체"를 하나의 ConsultationInfo 스냅샷으로 모아
  // 필수값 검사·작성률 계산·저장에 공통으로 씁니다. (구) 단일 memo 필드는 이 화면에서
  // 더 이상 편집하지 않으므로 기존 값을 그대로 승계합니다.
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
    if (readOnly) return;
    onSave(draft);
    onClose();
  }

  const headerExtra = (
    <span
      className={`hidden shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold sm:inline-flex ${
        completeness.ok ? "bg-emerald-50 text-emerald-700" : "bg-sky-50 text-sky-700"
      }`}
    >
      {completeness.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
      작성률 {stats.percent}% · 필수항목 {REQUIRED_CONSULTATION_FIELDS.length - missingKeys.size}/{REQUIRED_CONSULTATION_FIELDS.length}
    </span>
  );

  return (
    <Modal open={open} title={`${displayName} · 상담일지`} headerExtra={headerExtra} onClose={onClose} size="full">
      {readOnly && <div className="mb-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">조회 전용 권한입니다. 상담일지 내용은 확인할 수 있지만 수정·파일반영·예약변경·저장은 할 수 없습니다.</div>}
      <fieldset disabled={readOnly} className="min-w-0 border-0 p-0 disabled:opacity-100">
      <div className="space-y-1">
        <div className="flex min-h-8 flex-wrap items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-1">
          <span className="shrink-0 whitespace-nowrap rounded bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">상담 후 방향</span>
          <Select
            value={applicationType ?? ""}
            disabled={!allowApplicationTypeEdit}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => onApplicationTypeChange((e.target.value || undefined) as ConsultDirection | undefined)}
            className={`h-7 min-w-[150px] px-2 text-[11px] sm:h-7 sm:text-[11px] ${!applicationType ? "border-sky-400 bg-sky-50" : ""}`}
          >
            <option value="">미지정</option>
            {CONSULT_DIRECTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>

          {showDetailStage && (
            <>
              <span className="ml-1 shrink-0 whitespace-nowrap rounded bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">상세 단계</span>
              <Select
                value={detailStage ?? ""}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => onDetailStageChange?.((e.target.value || undefined) as DbDetailStage | undefined)}
                className="h-7 sm:h-7 min-w-[190px] px-2 text-[11px]"
              >
                <option value="">미지정</option>
                {DB_DETAIL_STAGE_TRACKS.map((track) => (
                  <optgroup key={track} label={track}>
                    {DB_DETAIL_STAGE_GROUPS[track].map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                  </optgroup>
                ))}
              </Select>
            </>
          )}

          <span className={`ml-auto shrink-0 whitespace-nowrap rounded px-2 py-1 text-[10px] font-bold ${completeness.ok ? "bg-emerald-50 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
            {completeness.ok ? "필수항목 입력완료" : `필수 미입력 ${completeness.missing.length}건`}
          </span>
        </div>

        {showFinanceSummary && <div className="grid grid-cols-3 overflow-hidden rounded border border-slate-200 bg-white">
          <div className="flex min-h-10 items-center justify-between gap-2 border-r border-slate-200 px-3">
            <span className="text-[11px] font-extrabold text-slate-600">계약금</span>
            <strong className="text-[13px] font-black text-blue-700">{fmtWon(contractAmount)}</strong>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-2 border-r border-slate-200 px-3">
            <span className="text-[11px] font-extrabold text-slate-600">납부금</span>
            <strong className="text-[13px] font-black text-emerald-700">{fmtWon(paidAmount)}</strong>
          </div>
          <div className="flex min-h-10 items-center justify-between gap-2 px-3">
            <span className="text-[11px] font-extrabold text-slate-600">미수금</span>
            <strong className="text-[13px] font-black text-red-600">{fmtWon(Math.max(0, outstandingAmount))}</strong>
          </div>
        </div>}

        {/* v14 레이아웃: 상단 3열은 같은 grid row를 공유해 전체 높이가 일치합니다.
            좌=기본정보/기타, 중=소득/자산, 우=의사/플랜. 하단에는 좌측 상담메모와
            중+우 2열을 합친 기대출리스트를 붙여 배치해 빈 여백을 최소화했습니다. */}
        <div className="grid grid-cols-1 items-stretch gap-0.5 xl:grid-cols-3">
          <div className="h-full min-h-0">
            <BasicInfoSection
              personal={personal}
              patchPersonal={patchPersonal}
              requiredKeys={requiredKeys}
              missingKeys={missingKeys}
              displayName={displayName}
              displayPhone={displayPhone}
              joinedAtLabel={joinedAtLabel}
              caseNumberLabel={caseNumberLabel}
            />
          </div>

          <div className="flex h-full min-h-0 flex-col gap-0.5">
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
              loanRecords={loanRecords}
              debtSummaryExtra={debtSummaryExtra}
              patchDebtSummaryExtra={patchDebtSummaryExtra}
              requiredKeys={requiredKeys}
              missingKeys={missingKeys}
            />
          </div>

          <div className="flex h-full min-h-0 flex-col gap-0.5">
            <DecisionSection judgment={judgment} patchJudgment={patchJudgment} />
            <PlanSection
              counselPlan={counselPlan}
              patchCounselPlan={patchCounselPlan}
              plan={plan}
              patchPlan={patchPlan}
              result={result}
              recentLoanInsurance={recentLoanInsurance}
              patchRecentLoanInsurance={patchRecentLoanInsurance}
              requiredKeys={requiredKeys}
              missingKeys={missingKeys}
              reservationChoice={reservationChoice}
              reservationAt={reservationAt}
              onReservationChoiceChange={onReservationChoiceChange}
              onReservationAtChange={onReservationAtChange}
            />
          </div>

          <div className="min-h-[190px] xl:col-start-1">
            <ConsultationMemoSection memoLog={memoLog} setMemoLog={setMemoLog} />
          </div>
          <div className="min-h-[190px] xl:col-span-2 xl:col-start-2">
            <DebtListSection loanRecords={loanRecords} setLoanRecords={setLoanRecords} setAttachedFiles={setAttachedFiles} />
          </div>
        </div>
      </div>
      </fieldset>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <div>
          {onExportExcel && (
            <Button variant="secondary" className="h-7 sm:h-7 px-2 text-[10px]" onClick={() => onExportExcel(draft)}>
              <Download size={12} /> 고객 상담 엑셀 다운로드
            </Button>
          )}
        </div>
        <div className="flex gap-1">
          <Button variant="secondary" className="h-10 sm:h-10 min-w-[72px] px-5 text-sm font-bold" onClick={onClose}>취소</Button>
          {!readOnly && <Button className="h-10 sm:h-10 min-w-[72px] px-5 text-sm font-bold" onClick={save}>저장</Button>}
        </div>
      </div>
    </Modal>
  );
}

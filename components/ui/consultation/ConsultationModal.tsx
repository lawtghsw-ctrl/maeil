"use client";

// 상담일지 대형 팝업(v12 전면개편) — 기본정보→소득→자산→상담판단→채무→상담메모를 스크롤
// 없이(내부 스크롤은 각 표/리스트 안에서만) 한 화면에서 확인·수정할 수 있는 단일 팝업으로
// 통합했습니다(Section 1). DB관리(app/db/page.tsx)의 옛 LeadConsultationModal과
// 고객관리(app/clients/page.tsx)의 CustomerEditModal 안 상담일지 탭들을 이 컴포넌트 하나로
// 대체하며, "상담 후 방향"(applicationType)·"상세 단계"(detailStage) 선택만 화면별로
// 다르게 보여줄 수 있도록 옵션으로 뺐습니다(고객관리에는 detailStage 개념이 없음).
//
// ---- 저장 방식에 대한 설계 결정 (Section 11) ----
// 요청 원문의 "자동저장" 항목은 "단, 기존 프로젝트가 명시적인 저장 버튼 구조로 통일되어
// 있다면 기존 UX를 먼저 분석하고 충돌 없는 방식으로 구현해달라"는 단서를 달고 있습니다.
// 이 프로젝트 전체(InstallmentModal/EformStubModal/DocGuideModal/CustomerEditModal/구
// LeadConsultationModal 등 모든 팝업)를 확인한 결과 예외 없이 전부 "취소/저장" 명시적
// 버튼 구조이고 자동저장을 쓰는 화면이 하나도 없어, 이 모달에서만 자동저장을 도입하면
// 오히려 프로젝트 전체 UX와 충돌합니다. 그래서 기존 관례를 그대로 따라 "취소/저장" 버튼을
// 유지했고, 대신 헤더에는 자동저장 상태 대신 Section 24가 요구하는 "상담일지 작성률/필수
// 항목 충족" 배지를 보여줍니다(고객전환 가능 여부 판정에는 이 배지가 아니라 필수항목
// 충족 여부만 사용됨 — Section 24 명시 사항).
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
import { Button, Label, Modal, Select } from "@/components/ui/Primitives";
import { SectionCard } from "./shared";
import { BasicInfoSection } from "./BasicInfoSection";
import { IncomeSection } from "./IncomeSection";
import { AssetSection } from "./AssetSection";
import { DecisionSection } from "./DecisionSection";
import { PlanSection } from "./PlanSection";
import { RecentLoanInsuranceSection } from "./RecentLoanInsuranceSection";
import { DebtSummary } from "./DebtSummary";
import { DebtUploader } from "./DebtUploader";
import { DebtTable } from "./DebtTable";
import { ConsultationMemoSection } from "./ConsultationMemoSection";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";

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

  const result = useMemo(
    () => computeRepaymentPlan(income.monthlyAvgIncome ?? 0, income.secondaryIncome ?? 0, income.pensionIncome ?? 0, assets, debts, plan),
    [income, assets, debts, plan]
  );

  // 채무 요약(DebtSummary)의 자동계산과 별개로, "지금 이 화면에서 편집 중인 값 전체"를
  // 하나의 ConsultationInfo 스냅샷으로 모아 필수값 검사·작성률 계산·저장에 공통으로 씁니다.
  // (구) 단일 memo 필드는 이 화면에서 더 이상 편집하지 않으므로 기존 값을 그대로 승계합니다.
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
      <div className="space-y-3">
        <div
          className={`rounded-xl border-2 px-3.5 py-2.5 text-xs font-semibold ${
            completeness.ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-sky-300 bg-sky-50 text-sky-700"
          }`}
        >
          {completeness.ok ? (
            "필수 항목이 모두 입력되었습니다 — 고객 전환이 가능합니다."
          ) : (
            <div className="space-y-1">
              <div>아래 하늘색으로 표시된 필수 항목을 모두 입력해야 &lsquo;고객 전환&rsquo;이 가능합니다. (미입력 {completeness.missing.length}건)</div>
              <ul className="list-disc space-y-0.5 pl-4 font-normal">
                {completeness.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className={`grid gap-2.5 ${showDetailStage ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
          <Label text="상담 후 방향(개인회생/개인파산/워크아웃)" required missing={!applicationType}>
            <Select value={applicationType ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => onApplicationTypeChange((e.target.value || undefined) as ConsultDirection | undefined)} className="w-full">
              <option value="">미지정</option>
              {CONSULT_DIRECTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Label>
          {showDetailStage && (
            <Label text="상세 단계 (상세 DB관리 분류)">
              <Select value={detailStage ?? ""} onChange={(e: ChangeEvent<HTMLSelectElement>) => onDetailStageChange?.((e.target.value || undefined) as DbDetailStage | undefined)} className="w-full">
                <option value="">미지정</option>
                {DB_DETAIL_STAGE_TRACKS.map((track) => (
                  <optgroup key={track} label={track}>
                    {DB_DETAIL_STAGE_GROUPS[track].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Label>
          )}
        </div>

        {/* 3열 그리드(1fr 1.05fr 1fr) — 정보는 많지만 한 화면에서 오갈 필요 없이 훑어볼 수
            있도록, 각 섹션은 SectionCard 하나의 카드 안에서만 스크롤되고(재산현황/채무
            리스트 등) 팝업 전체는 스크롤하지 않는 것을 기본으로 합니다. */}
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1.05fr_1fr]">
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
          <IncomeSection
            income={income}
            patchIncome={patchIncome}
            occupationType={personal.occupationType}
            onOccupationTypeChange={(v: OccupationType | undefined) => patchPersonal({ occupationType: v })}
            requiredKeys={requiredKeys}
            missingKeys={missingKeys}
          />
          <DecisionSection judgment={judgment} patchJudgment={patchJudgment} />

          <PlanSection counselPlan={counselPlan} patchCounselPlan={patchCounselPlan} plan={plan} patchPlan={patchPlan} result={result} />
          <AssetSection housing={housing} patchHousing={patchHousing} assets={assets} setAssets={setAssets} requiredKeys={requiredKeys} missingKeys={missingKeys} />
          <RecentLoanInsuranceSection value={recentLoanInsurance} patch={patchRecentLoanInsurance} />

          <DebtSummary loanRecords={loanRecords} extra={debtSummaryExtra} patchExtra={patchDebtSummaryExtra} />

          <SectionCard title="채무 파일 업로드" className="xl:col-span-3">
            <DebtUploader loanRecords={loanRecords} setLoanRecords={setLoanRecords} setAttachedFiles={setAttachedFiles} />
            {attachedFiles.length > 0 && (
              <div className="mt-1 text-[11px] text-slate-400">
                첨부된 파일 {attachedFiles.length}건 — {attachedFiles.map((f) => f.name).join(", ")}
              </div>
            )}
          </SectionCard>

          <DebtTable loanRecords={loanRecords} setLoanRecords={setLoanRecords} />

          <ConsultationMemoSection memoLog={memoLog} setMemoLog={setMemoLog} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3.5">
        <div>
          {onExportExcel && (
            <Button variant="secondary" onClick={() => onExportExcel(draft)}>
              <Download size={15} />
              고객 상담 엑셀 다운로드
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={save}>저장</Button>
        </div>
      </div>
    </Modal>
  );
}

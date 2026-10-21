// Synthetic-only fixtures and the offline TypeScript module loader used by PDF checks.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(relative, mocks = {}, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const module = { exports: {} }; cache.set(relative, module);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const requireFile = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(relative), name) + '.ts', mocks, cache);
    return require(name);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Blob, btoa, Date, Intl, URL: mocks.URL ?? URL, setTimeout: mocks.setTimeout ?? setTimeout, document: mocks.document, fetch: mocks.fetch ?? (() => { throw new Error('Customer-data network access is forbidden'); }) }, { filename: relative })(requireFile, module, module.exports);
  return module.exports;
}
function snapshot(long = false) {
  const marker = '합성 상담기록: 가족과 소득 자료를 확인하고 다음 상담에서 준비서류를 안내합니다.';
  return {
    name: '홍길동 합성자료', phone: '000-0000-0000', joinedAtLabel: '2026-10-18', caseNumberLabel: '합성-0000', applicationType: '개인회생', detailStage: '상담',
    reservationChoice: false, reservationAt: '2026-10-20T14:30', exportedAt: '2026-10-18T03:00:00Z', hasUnsavedChanges: true,
    memoDraft: { text: '아직 추가하지 않은 작성 중 메모입니다. 저장 콜백 호출 없이 내보냅니다.', staff: '합성 상담원', tag: '일반' },
    finance: { contractAmount: 2000000, paidAmount: 0, outstandingAmount: 2000000 },
    consultation: {
      personal: { age: 41, gender: '남', residenceRegion: '서울 합성지역', address: '가상 주소 (실제 고객 아님)', jurisdictionCourt: '서울회생법원', spouse: false, childrenCount: 0, parentCount: 2, parentSupportNote: '합성 부모 소득 메모', basicIncomeNote: '근로소득 확인', dischargeHistory: false, otherAssetsNote: '없음', riskyAssetActivity: false },
      income: { incomeType: '근로소득', workplaceName: '가상 회사', employmentStartDate: '2020-01-01', tenureMonths: 81, monthlyAvgIncome: 3000000, secondaryIncome: 0, hasFourInsurances: true, salaryAccountBank: '가상은행', salaryAccountChangeable: false, note: marker },
      assets: [{ category: '예금/적금', value: 0, hasSecurity: false, securityAmount: 0, note: '0원 확인' }, { category: '자동차', value: 8000000, hasSecurity: true, securityAmount: 3000000, note: '가상 차량' }],
      debts: [{ category: '세금체납', creditor: '합성 기관', detail: '가상 내역', amount: 0, note: '없음' }],
      housing: { housingType: '월세', housingNote: '합성 거주 메모', hasVehicle: true, vehicleInfo: '가상 차량 1대', spouseHasVehicle: false },
      debtSummaryExtra: { totalDebtAmount: 0, totalCreditAmount: 0, monthlyPaymentAmount: 0, salaryPayDay: 25, cardPaymentDay: 10 },
      judgment: { workoutFeasible: false, workoutGuided: true, costGuided: false, judgmentNote: marker },
      counselPlan: { rehabPlanNote: marker, recoveryPlanNote: '합성 회복 플랜', principalReductionRange: '40~50%', paymentReductionPct: 0 },
      recentLoanInsurance: { recentLoanUsage: '가상 생활비', insurancePremium: 0, insuranceNote: marker },
      plan: { householdSize: 1, minLivingCost: 1500000, otherDeduction: 0, repaymentMonths: 36, smallLeaseNote: '합성 참고 메모' },
      loanRecords: Array.from({ length: long ? 25 : 2 }, (_, index) => ({ id: `private-internal-${index}`, kind1: index % 2 ? '담보' : '신용', kind2: '합성 상품', lender: `가상 금융사 ${index + 1}`, executedAt: '2026-01-01', balance: 1000000 + index, monthlyPayment: 50000, interestRate: 7.5, originalAmount: 2000000, securedAmount: 0, note: `${marker}\n기대출 끝 ${index + 1}`, source: 'manual' })),
      memo: '이전 단일 메모도 보존합니다.',
      memoLog: [{ id: 'private-memo-id', staff: '합성 상담원', at: '2026-10-18T03:00:00Z', tag: '재통화', text: long ? `긴메모시작\n${Array.from({ length: 170 }, (_, index) => `${index + 1}. ${marker}`).join('\n')}\n긴메모마지막확인` : marker }],
      attachedFiles: [{ id: 'private-file-id', name: '합성첨부.pdf', sizeKb: 12, attachedAt: '2026-10-18T03:00:00Z', url: 'https://forbidden.invalid/private', bytes: 'DO_NOT_EXPORT_ATTACHMENT_BYTES' }],
    },
  };
}

function shortSnapshot() {
  return {
    name: '김가상 합성자료', phone: '000-0000-0000', joinedAtLabel: '2026-10-18', caseNumberLabel: '가상-1234',
    applicationType: '개인회생', detailStage: '상담', reservationChoice: false,
    exportedAt: '2026-10-18T03:00:00Z', hasUnsavedChanges: false,
    consultation: {
      personal: { age: 38, spouse: false, childrenCount: 0, residenceRegion: '서울 가상지역' },
      income: { incomeType: '근로소득', monthlyAvgIncome: 2800000, hasFourInsurances: true },
      housing: { housingType: '월세', hasVehicle: false },
      debtSummaryExtra: { totalDebtAmount: 48000000, monthlyPaymentAmount: 900000 },
      judgment: { workoutFeasible: false, costGuided: true },
      counselPlan: { rehabPlanNote: '소득 및 채무 증빙 확인 후 신청 준비. 다음 통화에서 필요서류 안내.' },
      plan: { householdSize: 1, repaymentMonths: 36 },
      memoLog: [{ id: 'synthetic-only', staff: '가상 상담원', at: '2026-10-18T03:00:00Z', tag: '일반', text: '상담 내용을 확인했습니다. 급여명세서와 채무증명서를 준비하기로 했습니다.' }],
    },
  };
}
module.exports = { load, snapshot, shortSnapshot };

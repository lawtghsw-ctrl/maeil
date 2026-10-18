// Synthetic offline fixtures: existing formulas and JSON persistence only, no DB or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const original = Module._load;
Module._load = function(name, parent, ...rest) {
  if (name.startsWith('@/')) return original.call(this, path.join(root, name.slice(2)), parent, ...rest);
  return original.call(this, name, parent, ...rest);
};
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
}).outputText, file);
global.fetch = () => { throw new Error('Network is forbidden'); };
const core = require('../lib/management-core.ts');
const access = require('../lib/management-access.ts');
const rule = (patch = {}) => ({ staff: 'A', employmentType: '정규직', baseSalary: 3100, incentiveMode: '건당고정', incentiveValue: 40, clawbackOnCancel: true, ...patch });
const settings = (patch = {}) => ({ ...structuredClone(core.DEFAULT_MANAGEMENT_SETTINGS), staffCompensations: [rule(patch)] });
const cases = [
  { id: 'active', assignedStaff: 'A', contractDate: '2026-10-05', contractAmount: 1000, status: '진행중' },
  { id: 'zero', assignedStaff: 'A', contractDate: '2026-10-06', contractAmount: 0, status: '진행중' },
  { id: 'cancelled', assignedStaff: 'A', contractDate: '2026-10-07', contractAmount: 400, status: '취하' },
  { id: 'older', assignedStaff: 'A', contractDate: '2026-09-01', contractAmount: 2000, status: '진행중' },
  { id: 'other-staff', assignedStaff: 'B', contractDate: '2026-10-05', contractAmount: 999, status: '진행중' },
];
const payments = [
  { id: 'partial', caseId: 'active', paidDate: '2026-10-09', status: '완료', amount: 1000, actualPaidAmount: 300 },
  { id: 'zero-actual', caseId: 'active', paidDate: '2026-10-10', status: '완료', amount: 200, actualPaidAmount: 0 },
  { id: 'planned', caseId: 'active', paidDate: '2026-10-10', status: '예정', amount: 1000 },
  { id: 'older-contract', caseId: 'older', paidDate: '2026-10-10', status: '완료', amount: 800, actualPaidAmount: 200 },
  { id: 'cancelled-receipt', caseId: 'cancelled', paidDate: '2026-10-10', status: '완료', amount: 500, actualPaidAmount: 100 },
  { id: 'unlinked', caseId: 'absent', paidDate: '2026-10-10', status: '완료', amount: 500 },
  { id: 'other-staff', caseId: 'other-staff', paidDate: '2026-10-10', status: '완료', amount: 700 },
  { id: 'prior-receipt', caseId: 'active', paidDate: '2026-09-30', status: '완료', amount: 250 },
];
const calc = s => core.laborCostForRange(cases, payments, s, '2026-10-01', '2026-10-31');

test('fixed, fee percentage and actual receipts percentage retain distinct existing bases', () => {
  const originalInputs = structuredClone({ cases, payments });
  // Fixed keeps the historical zero-fee case count; percentage uses the fee sum.
  assert.equal(calc(settings()), 3100 + 2 * 40);
  assert.equal(calc(settings({ incentiveMode: '수임액%', incentiveValue: 10 })), 3100 + 1000 * 0.1);
  // 300 current + 200 older contract; no planned, zero-actual, prior-date, other staff or unlinked payment.
  assert.equal(calc(settings({ incentiveMode: '회수매출%', incentiveValue: 10 })), 3100 + 500 * 0.1);
  assert.deepEqual({ cases, payments }, originalInputs);
});

test('existing cancel exclusion toggle applies to all three bases without changing contracts or receipts', () => {
  assert.equal(calc(settings({ clawbackOnCancel: false })), 3100 + 3 * 40);
  assert.equal(calc(settings({ incentiveMode: '수임액%', incentiveValue: 10, clawbackOnCancel: false })), 3100 + 1400 * 0.1);
  assert.equal(calc(settings({ incentiveMode: '회수매출%', incentiveValue: 10, clawbackOnCancel: false })), 3100 + 600 * 0.1);
});

test('partial month prorates only salary and preserves decimal percentage rounding', () => {
  const s = settings({ incentiveMode: '수임액%', incentiveValue: 12.55 });
  assert.equal(core.laborCostForRange(cases, payments, s, '2026-10-01', '2026-10-15'), 1626);
  assert.equal(core.staffCompensationForRange('A', cases, payments, s, '2026-10-01', '2026-10-15'), 1626);
  assert.equal(core.staffCompensationForRange('B', cases, payments, s, '2026-10-01', '2026-10-15'), 0);
});

test('closed month keeps fixed rule snapshot after the open-month setting changes to percentage', () => {
  const s = settings();
  const frozen = core.makeFinancialSnapshot(s);
  s.monthClosings['2026-10'] = { closedAt: '2026-11-01T00:00:00Z', snapshot: frozen };
  s.staffCompensations[0] = rule({ baseSalary: 6200, incentiveMode: '수임액%', incentiveValue: 20 });
  const input = structuredClone(s);
  const extended = [...cases, { id: 'november', assignedStaff: 'A', contractDate: '2026-11-05', contractAmount: 1000, status: '진행중' }];
  assert.equal(calc(s), 3180);
  assert.equal(core.laborCostForRange(extended, payments, s, '2026-11-01', '2026-11-30'), 6400);
  assert.equal(core.laborCostForRange(extended, payments, s, '2026-10-01', '2026-11-30'), 9580);
  assert.deepEqual(s, input);
  assert.equal(frozen.staffCompensations[0].incentiveMode, '건당고정');
});

test('existing JSON and firm setting merge preserve fixed rows, allow explicit percent and leave private data and closing untouched', () => {
  const s = settings();
  s.adSpendEntries = [{ id: 'private', date: '2026-10-01', creative: 'synthetic-private', amount: 777 }];
  s.monthClosings['2026-09'] = { closedAt: 'old', snapshot: core.makeFinancialSnapshot(s) };
  const before = structuredClone(s);
  assert.deepEqual(core.normalizeManagementSettings(JSON.parse(JSON.stringify(s))).staffCompensations, s.staffCompensations);
  assert.deepEqual(core.ensureStaffCompensations(s, ['A']).staffCompensations, s.staffCompensations);
  const request = access.firmVisibleSettings(s);
  request.staffCompensations[0].incentiveMode = '수임액%';
  request.staffCompensations[0].incentiveValue = 12.5;
  const result = access.mergeFirmSettings(s, request);
  assert.deepEqual(result.staffCompensations, [rule({ incentiveMode: '수임액%', incentiveValue: 12.5 })]);
  assert.deepEqual(result.adSpendEntries, before.adSpendEntries);
  assert.deepEqual(result.monthClosings, before.monthClosings);
  assert.deepEqual(s, before);
});

test('zero incentive does not invent a bonus; legacy absent actual payment keeps its existing fallback', () => {
  for (const incentiveMode of ['건당고정', '수임액%', '회수매출%']) assert.equal(calc(settings({ incentiveMode, incentiveValue: 0 })), 3100);
  const legacy = [{ caseId: 'active', amount: 900, status: '완료', paidDate: '2026-10-08' }];
  assert.equal(core.laborCostForRange(cases, legacy, settings({ baseSalary: 0, incentiveMode: '회수매출%', incentiveValue: 10 }), '2026-10-01', '2026-10-31'), 90);
});

// Synthetic fixtures only; no production/customer data or external calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, cache = new Map()) {
  const filename = path.resolve(root, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl }, { filename })(name => {
    assert.ok(name.startsWith('.'), 'Only local pure modules allowed');
    return load(path.resolve(path.dirname(filename), `${name}.ts`), cache);
  }, module, module.exports);
  return module.exports;
}
const { buildAnalyticsReceipts, createReceiptOnlySection } = load('lib/analytics-receipts.ts');
const contract = (id, patch = {}) => ({ id, clientId: 'client', contractDate: '2026-11-01', contractAmount: 999999,
  assignedStaff: 'Synthetic staff', status: '취하', paymentMethod: '단순분납', _lawFirmId: 'firm-a', ...patch });
const payment = (id, patch = {}) => ({ id, caseId: 'case', seq: 1, paidDate: '2026-10-03', dueDate: '2026-10-01',
  actualPaidAmount: 100, amount: 999999, status: '완료', _lawFirmId: 'firm-a', ...patch });
const report = (installments, rest = {}) => buildAnalyticsReceipts({ cases: [contract('case')],
  clients: [{ id: 'client', name: 'Synthetic customer', _lawFirmId: 'firm-a' }], installments,
  periodStart: '2026-10-01', cutoff: '2026-10-31', mode: 'monthly', firmId: 'firm-a', ...rest });

test('one actual receipt per installment, independently of contract date/status, no IDs or contract data exported', () => {
  const result = report([payment('secret-record-a'), payment('secret-record-b', { seq: 2, actualPaidAmount: 200 })]);
  const section = createReceiptOnlySection(result.rows);
  assert.equal(result.rows.length, 2);
  assert.equal(result.total, 300);
  assert.equal(section.rows[1][3], 2);
  assert.equal(section.totalRow[5], 300);
  assert.deepEqual(Array.from(section.headers), ['입금일', '담당', '의뢰인', '회차', '납부방식', '실입금액']);
  assert.doesNotMatch(JSON.stringify(section), /secret-record|999999|취하|계약|확인사항|상태|기록 ID/);
});

test('monthly and cumulative use actual paid date; future payments never leak into cutoff', () => {
  const payments = [payment('prior', { paidDate: '2026-09-30', actualPaidAmount: 20 }), payment('first', { paidDate: '2026-10-01' }),
    payment('last', { paidDate: '2026-10-31' }), payment('future', { paidDate: '2026-11-01' })];
  assert.equal(report(payments).total, 200);
  const cumulative = report(payments, { mode: 'cumulative' });
  assert.equal(cumulative.total, 220);
  assert.deepEqual(Array.from(cumulative.rows, r => r.date), ['2026-09-30', '2026-10-01', '2026-10-31']);
});

test('missing date/amount and schedules never become receipts; explicit zero remains zero', () => {
  const result = report([payment('undated', { paidDate: '' }), payment('invalid-date', { paidDate: '2026-02-30' }),
    payment('unknown', { actualPaidAmount: undefined }), payment('null', { actualPaidAmount: null }),
    payment('negative', { actualPaidAmount: -1 }), payment('pending', { status: '예정' }), payment('zero', { actualPaidAmount: 0 })]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.total, 0);
  assert.equal(result.undatedCount, 2);
  assert.equal(result.unknownAmountCount, 3);
});

test('valid unmatched receipts stay in cash total without made-up identity or exported IDs', () => {
  const result = report([payment('orphan-record', { caseId: 'missing-case', seq: 0 })]);
  assert.equal(result.total, 100);
  assert.equal(result.missingIdentityCount, 1);
  assert.deepEqual(Array.from(createReceiptOnlySection(result.rows).rows[0]), ['2026-10-03', '-', '-', '-', '-', 100]);
});

test('tenant-scoped joins and deduplication cannot join or sum another firm records', () => {
  const result = report([payment('same'), payment('same'), payment('same', { _lawFirmId: 'firm-b', actualPaidAmount: 500 })], {
    cases: [contract('case', { _lawFirmId: 'firm-b', assignedStaff: 'WRONG' }), contract('case')],
    clients: [{ id: 'client', name: 'WRONG', _lawFirmId: 'firm-b' }, { id: 'client', name: 'Synthetic customer', _lawFirmId: 'firm-a' }],
  });
  assert.equal(result.total, 100);
  assert.equal(result.rows.length, 1);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.rows[0].clientName, 'Synthetic customer');
  assert.equal(result.rows[0].assignedStaff, 'Synthetic staff');
});

test('same client contracts are not merged and source data is immutable', () => {
  const cases = [contract('a'), contract('b')].map(Object.freeze);
  const installments = [payment('a', { caseId: 'a' }), payment('b', { caseId: 'b', actualPaidAmount: 250 })].map(Object.freeze);
  const result = report(Object.freeze(installments), { cases: Object.freeze(cases) });
  assert.equal(result.rows.length, 2);
  assert.equal(result.total, 350);
});

test('invalid report ranges fail explicitly; empty period retains clean header and zero total', () => {
  assert.throws(() => report([], { cutoff: '2026-02-30' }), /조회기간/);
  assert.throws(() => report([], { periodStart: '2026-11-01' }), /조회기간/);
  const section = createReceiptOnlySection(report([]).rows);
  assert.equal(section.rows.length, 0);
  assert.equal(section.headers.length, 6);
  assert.equal(section.totalRow[5], 0);
});

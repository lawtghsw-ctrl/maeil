// Synthetic fixtures only. No production data or connected services.
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
  const requireFile = name => {
    if (!name.startsWith('.') && !name.startsWith('@/')) throw new Error(`External module forbidden: ${name}`);
    const target = name.startsWith('@/') ? path.resolve(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
    const resolved = ['.ts', '.tsx', ''].map(ext => target + ext).find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    return load(resolved, cache);
  };
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl }, { filename })(requireFile, module, module.exports);
  return module.exports;
}

const { buildAnalyticsLedger, analyticsLedgerDate, recordedActualPayment } = load('lib/analytics-ledger.ts');
const contract = (id, patch = {}) => ({ id, clientId: `client-${id}`, contractDate: '2026-10-05',
  contractAmount: 1000, paidAmount: 0, assignedStaff: 'Synthetic staff', caseNumber: `SYN-${id}`,
  caseType: '개인회생', paymentMethod: '단순분납', status: '진행중', _lawFirmId: 'firm-a', ...patch });
const payment = (id, caseId, patch = {}) => ({ id, caseId, seq: 1, dueDate: '2026-10-05',
  paidDate: '2026-10-05', amount: 200, actualPaidAmount: 150, status: '완료', _lawFirmId: 'firm-a', ...patch });
const report = (cases, installments = [], rest = {}) => buildAnalyticsLedger({ cases,
  clients: cases.map(record => ({ id: record.clientId, name: `Synthetic ${record.id}`, _lawFirmId: record._lawFirmId })),
  installments, periodStart: '2026-10-01', periodEnd: '2026-10-31', cutoff: '2026-10-31', mode: 'monthly', firmId: 'firm-a', ...rest });
const row = (result, id) => result.rows.find(item => item.case.id === id);
function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(item => { if (!Object.isFrozen(item)) deepFreeze(item); }); } return value; }

test('monthly includes old contracts paid this month; cumulative includes old unpaid and excludes future contracts', () => {
  const cases = [contract('new'), contract('old-paid', { contractDate: '2026-09-01' }),
    contract('old-unpaid', { contractDate: '2026-09-01' }), contract('future', { contractDate: '2026-11-01' })];
  const payments = [payment('previous', 'old-paid', { paidDate: '2026-09-10', actualPaidAmount: 100 }),
    payment('month', 'old-paid', { actualPaidAmount: 250 }), payment('future-receipt', 'old-paid', { paidDate: '2026-11-01', actualPaidAmount: 300 })];
  const monthly = report(cases, payments), cumulative = report(cases, payments, { mode: 'cumulative' });
  assert.deepEqual(Array.from(monthly.rows, item => item.case.id), ['new', 'old-paid']);
  assert.deepEqual(Array.from(cumulative.rows, item => item.case.id), ['new', 'old-paid', 'old-unpaid']);
  assert.equal(row(monthly, 'old-paid').periodPaid, 250);
  assert.equal(row(monthly, 'old-paid').cumulativePaid, 350);
  assert.equal(row(monthly, 'old-paid').balance, 650);
  assert.equal(monthly.totals.periodPaid, 250);
  assert.equal(cumulative.totals.cumulativePaid, 350);
  assert.equal(monthly.warnings.filter(item => item.code === 'excluded-contract-receipt').length, 0);
});

test('actual zero stays zero; legacy completed schedule, planned/failed/overdue are not cash', () => {
  const result = report([contract('a')], [payment('zero', 'a', { actualPaidAmount: 0 }),
    payment('old', 'a', { actualPaidAmount: undefined, amount: 125 }),
    payment('plan', 'a', { status: '예정', amount: 900 }), payment('failed', 'a', { status: '실패' }),
    payment('late', 'a', { status: '연체' })]);
  assert.equal(result.totals.periodPaid, 0);
  assert.equal(result.totals.cumulativePaid, 0);
  assert.equal(result.rows[0].periodPayments.length, 2);
  assert.equal(result.rows[0].balanceKnown, false);
  assert.equal(result.rows[0].unknownActualCount, 1);
  assert.equal(result.totals.periodUnknownActualCount, 1);
  assert.equal(result.totals.cumulativeUnknownActualCount, 1);
});

test('only finite explicit non-negative numeric actual amounts are cash; no coercion or scheduled fallback', () => {
  assert.equal(recordedActualPayment({ actualPaidAmount: 0, amount: 999 }), 0);
  assert.equal(recordedActualPayment({ actualPaidAmount: 75, amount: 999 }), 75);
  for (const value of [undefined, null, NaN, Infinity, -1, '', '100']) {
    assert.equal(recordedActualPayment({ actualPaidAmount: value, amount: 999 }), undefined);
  }
  const values = [undefined, NaN, -1, Infinity];
  const result = report([contract('a')], values.map((value, index) => payment(`unknown-${index}`, 'a', { actualPaidAmount: value, amount: 9000 })));
  assert.equal(result.totals.periodPaid, 0);
  assert.equal(result.totals.cumulativePaid, 0);
  assert.equal(result.totals.periodUnknownActualCount, 4);
  assert.equal(result.totals.cumulativeUnknownActualCount, 4);
  assert.equal(result.rows[0].missingActualPayments.length, 4);
  assert.equal(result.rows[0].balanceKnown, false);
  assert.equal(result.totals.confirmedBalance, 0);
});

test('future-only unknown actuals do not invalidate earlier cash or balance, including case summary', () => {
  const result = report([contract('a', { paidAmount: 500 })], [payment('known', 'a', { actualPaidAmount: 200 }),
    payment('future-unknown', 'a', { paidDate: '2026-11-01', actualPaidAmount: undefined, amount: 9999 })]);
  assert.equal(result.rows[0].periodPaid, 200);
  assert.equal(result.rows[0].cumulativePaid, 200);
  assert.equal(result.rows[0].balanceKnown, true);
  assert.equal(result.rows[0].unknownActualCount, 0);
  assert.equal(result.rows[0].unreconciledPaid, 0);
  assert.equal(result.totals.confirmedBalance, 800);
  assert.equal(result.incompletePayments.length, 0);
  assert.equal(result.warnings.filter(item => item.code === 'missing-actual-payment').length, 0);
});

test('undated unknown and unmatched unknown payments stay visible without inventing an amount', () => {
  const result = report([contract('a')], [payment('undated', 'a', { paidDate: undefined, actualPaidAmount: undefined, amount: 9999 }),
    payment('orphan-unknown', 'missing', { actualPaidAmount: undefined, amount: 8888 })]);
  assert.equal(result.totals.periodPaid, 0);
  assert.equal(result.totals.excludedPeriodPaid, 0);
  assert.equal(result.totals.unallocatedPaid, 0);
  assert.equal(result.totals.periodUnknownActualCount, 1);
  assert.equal(result.totals.cumulativeUnknownActualCount, 1);
  assert.equal(result.totals.undatedUnknownActualCount, 1);
  assert.equal(result.incompletePayments.length, 2);
  assert.equal(result.rows[0].balanceKnown, false);
  assert.equal(result.rows[0].unallocatedPaidKnown, false);
  assert.equal(result.unallocatedCases[0].amountKnown, false);
  assert.equal(result.warnings.filter(item => item.code === 'missing-actual-payment').length, 2);
});

test('first installment is counted once and case summary is never added to receipts', () => {
  const record = contract('a', { paidAmount: 400 });
  const receipt = payment('deposit', 'a', { seq: 1, actualPaidAmount: 400 });
  const result = report([record, { ...record, contractAmount: 9999 }], [receipt, { ...receipt, actualPaidAmount: 9999 }]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.contractAmount, 1000);
  assert.equal(result.totals.cumulativePaid, 400);
  assert.equal(result.totals.unallocatedPaid, 0);
  assert.equal(result.warnings.filter(item => item.code === 'duplicate-case').length, 1);
  assert.equal(result.warnings.filter(item => item.code === 'duplicate-installment').length, 1);
});

test('same client has separate contract balances without multiplying repeated payment rows', () => {
  const cases = [contract('a', { clientId: 'shared' }), contract('b', { clientId: 'shared', contractAmount: 500 })];
  const result = report(cases, [payment('one', 'a', { actualPaidAmount: 300 }), payment('two', 'a', { actualPaidAmount: 200 }),
    payment('three', 'b', { actualPaidAmount: 100 })], { clients: [{ id: 'shared', name: '=HYPERLINK("synthetic")', _lawFirmId: 'firm-a' }] });
  assert.equal(result.rows.length, 2);
  assert.equal(row(result, 'a').cumulativePaid, 500);
  assert.equal(row(result, 'b').cumulativePaid, 100);
  assert.equal(result.totals.cumulativePaid, 600);
  assert.equal(result.totals.balance, 900);
  assert.equal(result.rows[0].client.name, '=HYPERLINK("synthetic")');
});

test('overpayment remains signed; cancelled contracts and receipts remain visible without invented refunds', () => {
  const result = report([contract('over', { contractAmount: 100 }), contract('cancel', { status: '취하', contractAmount: 200 })],
    [payment('over-cash', 'over', { actualPaidAmount: 150 }), payment('cancel-cash', 'cancel', { actualPaidAmount: 100 })]);
  assert.equal(row(result, 'over').balance, -50);
  assert.equal(row(result, 'over').overpayment, 50);
  assert.equal(row(result, 'over').status, '초과입금');
  assert.equal(row(result, 'cancel').status, '취하');
  assert.equal(result.totals.periodPaid, 250);
  assert.equal(result.totals.balance, 50);
});

test('undated old case totals and malformed completed payment dates are explicit, not historical cash', () => {
  const result = report([contract('legacy', { paidAmount: 600 }), contract('invalid', { paidAmount: 999 })],
    [payment('bad-date', 'invalid', { paidDate: '2026-02-30', actualPaidAmount: 120 }),
      payment('missing-date', 'invalid', { paidDate: undefined, actualPaidAmount: 80 })]);
  const legacy = row(result, 'legacy'), invalid = row(result, 'invalid');
  assert.equal(result.totals.periodPaid, 0);
  assert.equal(result.totals.cumulativePaid, 0);
  assert.equal(legacy.unallocatedPaid, 600);
  assert.equal(legacy.unallocatedSource, 'case');
  assert.equal(invalid.unallocatedPaid, 200);
  assert.equal(invalid.unallocatedSource, 'installments');
  assert.equal(invalid.balanceKnown, false);
  assert.equal(legacy.balanceKnown, false);
  assert.equal(result.totals.unallocatedPaid, 800); // Not 1,799: summary and receipt source are not added.
  assert.equal(result.warnings.filter(item => item.code === 'undated-sources-disagree').length, 1);
  assert.equal(result.totals.confirmedBalance, 0);
  assert.equal(result.totals.confirmedOverpayment, 0);
  assert.equal(result.totals.uncertainBalanceCases, 2);
  const displayedBalances = result.rows.map(item => item.balanceKnown ? item.balance : '확인 필요');
  assert.deepEqual(Array.from(displayedBalances), ['확인 필요', '확인 필요']);
});

test('excess case payment summary is not extra cash and excludes disputed balance from confirmed totals', () => {
  const result = report([contract('mismatch', { paidAmount: 700 }), contract('known')],
    [payment('partial', 'mismatch', { actualPaidAmount: 200 }), payment('known-paid', 'known', { actualPaidAmount: 100 })]);
  const mismatch = row(result, 'mismatch');
  assert.equal(result.totals.cumulativePaid, 300);
  assert.equal(mismatch.unreconciledPaid, 500);
  assert.equal(mismatch.balanceKnown, false);
  assert.equal(mismatch.unallocatedPaid, 0); // Discrepancy is not invented as actual cash.
  assert.equal(mismatch.warnings.some(item => item.code === 'case-paid-summary-mismatch'), true);
  assert.equal(result.totals.balance, 1700); // Diagnostic known-record difference only.
  assert.equal(result.totals.confirmedBalance, 900);
  assert.equal(result.totals.uncertainBalanceCases, 1);
});

test('case summary matching future receipts does not make past dated cash or balance uncertain', () => {
  const result = report([contract('future-paid', { paidAmount: 500 })],
    [payment('past', 'future-paid', { actualPaidAmount: 200 }),
      payment('later', 'future-paid', { paidDate: '2026-11-05', actualPaidAmount: 300 })]);
  assert.equal(result.rows[0].cumulativePaid, 200);
  assert.equal(result.rows[0].unreconciledPaid, 0);
  assert.equal(result.rows[0].balanceKnown, true);
  assert.equal(result.totals.confirmedBalance, 800);
});

test('month edges use KST consistently and reject impossible calendar dates', () => {
  assert.equal(analyticsLedgerDate('2026-09-30T15:00:00Z'), '2026-10-01');
  assert.equal(analyticsLedgerDate('2026-10-31T14:59:59Z'), '2026-10-31');
  assert.equal(analyticsLedgerDate('2026-10-31T15:00:00Z'), '2026-11-01');
  assert.equal(analyticsLedgerDate('2026-10-01T00:01:00'), '2026-10-01'); // Existing timestamp-without-zone convention is KST.
  assert.equal(analyticsLedgerDate('2026-02-30'), '');
  const result = report([contract('a')], [payment('start', 'a', { paidDate: '2026-09-30T15:00:00Z', actualPaidAmount: 10 }),
    payment('end', 'a', { paidDate: '2026-10-31T14:59:59Z', actualPaidAmount: 20 }),
    payment('after', 'a', { paidDate: '2026-10-31T15:00:00Z', actualPaidAmount: 30 })]);
  assert.equal(result.totals.periodPaid, 30);
  assert.equal(result.totals.cumulativePaid, 30);
});

test('old contracts with undated cash remain separately visible even when no monthly row can be attributed', () => {
  const cases = [contract('old-legacy', { contractDate: '2026-08-01', paidAmount: 700 }),
    contract('old-undated', { contractDate: '2026-09-01' })];
  const payments = [payment('unknown-day', 'old-undated', { paidDate: undefined, actualPaidAmount: 300 })];
  const monthly = report(cases, payments);
  assert.equal(monthly.rows.length, 0);
  assert.equal(monthly.totals.periodPaid, 0);
  assert.equal(monthly.totals.unallocatedPaid, 0);
  assert.equal(monthly.totals.excludedUnallocatedPaid, 1000);
  assert.deepEqual(Array.from(monthly.unallocatedCases, item => [item.caseId, item.amount, item.includedInRows]),
    [['old-legacy', 700, false], ['old-undated', 300, false]]);
  const cumulative = report(cases, payments, { mode: 'cumulative' });
  assert.equal(cumulative.rows.length, 2);
  assert.equal(cumulative.totals.unallocatedPaid, 1000);
  assert.equal(cumulative.totals.excludedUnallocatedPaid, 0);
  assert.equal(cumulative.unallocatedCases.every(item => item.includedInRows), true);
});

test('future or invalid contracts with paid receipts remain excluded and separately reconcilable', () => {
  const result = report([contract('future', { contractDate: '2026-11-01' }), contract('bad', { contractDate: '' })],
    [payment('future-paid', 'future', { actualPaidAmount: 200 }), payment('bad-paid', 'bad', { actualPaidAmount: 100 }),
      payment('orphan', 'missing', { actualPaidAmount: 50 })]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.totals.excludedPeriodPaid, 350);
  assert.equal(result.totals.excludedCumulativePaid, 350);
  assert.equal(result.warnings.filter(item => item.code === 'excluded-contract-receipt').length, 2);
  assert.equal(result.warnings.filter(item => item.code === 'unmatched-payment').length, 1);
});

test('same IDs in different stamped firms never cross-join, while selected scope omits foreign rows', () => {
  const a = contract('same'), b = contract('same', { _lawFirmId: 'firm-b', contractAmount: 800 });
  const payments = [payment('pa', 'same', { actualPaidAmount: 100 }),
    payment('pb', 'same', { _lawFirmId: 'firm-b', actualPaidAmount: 300 })];
  const scoped = report([a, b], payments);
  assert.equal(scoped.rows.length, 1); assert.equal(scoped.totals.periodPaid, 100);
  const global = report([a, b], payments, { firmId: undefined });
  assert.equal(global.rows.length, 2);
  assert.equal(global.rows[0].periodPaid, 100); assert.equal(global.rows[1].periodPaid, 300);
  assert.notEqual(global.rows[0].key, global.rows[1].key);
  const ambiguous = report([a, b], [payment('unknown-firm', 'same', { _lawFirmId: undefined, actualPaidAmount: 75 })], { firmId: undefined });
  assert.equal(ambiguous.totals.periodPaid, 0); assert.equal(ambiguous.totals.excludedPeriodPaid, 75);
  assert.equal(ambiguous.warnings.filter(item => item.code === 'ambiguous-payment').length, 1);
});

test('read-only derivation does not mutate deeply frozen source records or arrays', () => {
  const cases = deepFreeze([contract('a')]), payments = deepFreeze([payment('one', 'a')]);
  const before = JSON.stringify({ cases, payments }); report(cases, payments);
  assert.equal(JSON.stringify({ cases, payments }), before);
});

test('empty reporting periods remain valid and impossible/range-reversed cutoffs fail visibly', () => {
  const empty = report([]);
  assert.equal(empty.totals.caseCount, 0); assert.equal(empty.totals.periodPaid, 0); assert.equal(empty.warnings.length, 0);
  assert.throws(() => report([], [], { cutoff: '2026-10-30' }), /원장 조회기간/);
  assert.throws(() => report([], [], { periodStart: '2026-11-01' }), /원장 조회기간/);
  assert.throws(() => report([], [], { periodEnd: '2026-02-30' }), /원장 조회기간/);
});

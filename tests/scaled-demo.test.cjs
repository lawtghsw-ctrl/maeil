// Synthetic fixtures only. No credentials, network, database, accounts or SMS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl, fetch() { throw Error('Network forbidden'); } }, { filename: file })(() => { throw Error('Runtime dependency forbidden'); }, module, module.exports);
  return module.exports;
}
const { buildSalesDemo } = load('lib/demo/sales-demo.ts');
const { buildScaledSalesDemo, SCALED_DEMO_TARGETS } = load('lib/demo/scaled-demo.ts');
const { DB_DETAIL_STAGE_OPTIONS, DB_LEAD_STATUSES, CASE_STAGES } = load('lib/types.ts');
const firmId = '11111111-1111-4111-8111-111111111111', batchKey = '20261018-test-500';
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
function baseline() { const data = buildSalesDemo(firmId, '2026-10-18'); return { firmId, batchKey, existingLeads: data.leads, existingCases: data.cases }; }
const active = lead => !lead.convertedClientId && !['거절', '부적합', '종결_중단'].includes(lead.status);

test('append-only expansion reaches 500/90/18%, exact 6-staff allocations and active cap 40', () => {
  const input = freeze(baseline()), before = JSON.stringify(input), result = buildScaledSalesDemo(input);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(clone(result.summary.added), { leads: 488, clients: 86, cases: 86, installments: 516, schedules: 124 });
  assert.equal(result.summary.after.conversionRate, 18);
  assert.equal(result.summary.after.supplyValue, 25_000_000);
  assert.equal(result.summary.after.unitPrice, 50_000);
  const allLeads = [...input.existingLeads, ...result.leads], allCases = [...input.existingCases, ...result.cases];
  assert.equal(allLeads.length, 500); assert.equal(allCases.length, 90);
  assert.equal(new Set(allLeads.filter(lead => lead.convertedCaseId).map(lead => lead.id)).size, 90);
  for (let index = 0; index < 6; index++) {
    const staff = `TEST${index + 1}`, leads = allLeads.filter(lead => lead.assignedStaff === staff);
    assert.equal(leads.length, [84, 84, 83, 83, 83, 83][index]);
    assert.equal(leads.filter(active).length, 40);
    assert.equal(leads.filter(lead => lead.convertedClientId).length, 15);
    assert.equal(allCases.filter(record => record.assignedStaff === staff && record.contractAmount > 0 && record.status !== '취하').length, 15);
  }
  assert.deepEqual(clone(result.summary.after.groups), { retained: 90, fresh: 40, absent: 80, longAbsent: 30, reserved: 40, consulting: 50, closed: 170 });
  assert.deepEqual(clone(result.summary.after.groups), clone(SCALED_DEMO_TARGETS.groups));
});

test('same original baseline and batch key are deterministic, order-independent and collision-separated', () => {
  const input = baseline(), first = buildScaledSalesDemo(input), second = buildScaledSalesDemo(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(first), JSON.stringify(buildScaledSalesDemo({ ...input, existingLeads: [...input.existingLeads].reverse(), existingCases: [...input.existingCases].reverse() })));
  const alternate = buildScaledSalesDemo({ ...input, batchKey: 'another-batch' });
  const ids = new Set([...first.leads, ...first.clients, ...first.cases, ...first.installments, ...first.schedules].map(row => row.id));
  assert.equal(ids.size, 488 + 86 + 86 + 516 + 124);
  assert.ok([...alternate.leads, ...alternate.clients, ...alternate.cases, ...alternate.installments, ...alternate.schedules].every(row => !ids.has(row.id)));
  for (const rows of [first.leads, first.clients, first.cases, first.installments, first.schedules]) assert.ok(rows.every(row => row.id.startsWith(`DEMO2-${firmId}-${batchKey}-`)));
});

test('original rows never appear in output, and all new converted links form one-to-one chains', () => {
  const input = baseline(), result = buildScaledSalesDemo(input), originalIds = new Set([...input.existingLeads, ...input.existingCases].map(row => row.id));
  assert.ok([...result.leads, ...result.cases].every(row => !originalIds.has(row.id)));
  const leadMap = new Map(result.leads.map(row => [row.id, row])), clientMap = new Map(result.clients.map(row => [row.id, row]));
  assert.equal(new Set(result.cases.map(record => record.fromLeadId)).size, 86);
  for (const record of result.cases) {
    const lead = leadMap.get(record.fromLeadId), client = clientMap.get(record.clientId);
    assert.ok(lead && client);
    assert.equal(lead.convertedClientId, client.id); assert.equal(lead.convertedCaseId, record.id);
    assert.equal(client.fromLeadId, lead.id); assert.equal(client.assignedStaff, lead.assignedStaff); assert.equal(record.assignedStaff, lead.assignedStaff);
    assert.notEqual(client.consultation, lead.consultation);
    assert.deepEqual(clone(client.consultation), clone(lead.consultation));
    assert.ok(record.contractAmount > 0); assert.notEqual(record.status, '취하');
  }
});

test('safe synthetic contacts, meaningful consultation sections and valid domain enums', () => {
  const result = buildScaledSalesDemo(baseline());
  for (const row of [...result.leads, ...result.clients]) {
    assert.equal(row.phone, ''); assert.equal(row.email, undefined);
    assert.match(row.name, /^가상고객\d{3}$/);
    const info = row.consultation;
    for (const key of ['personal', 'income', 'housing', 'judgment', 'counselPlan', 'debtSummaryExtra', 'recentLoanInsurance']) assert.ok(info[key]);
    assert.ok(info.memoLog.length >= 1 && info.memoLog.length <= 4);
    assert.equal(info.loanRecords.length, 2); assert.equal(info.attachedFiles, undefined);
    assert.ok(info.memoLog.every(memo => memo.text.startsWith('[시연]')));
    assert.equal(info.loanRecords.reduce((sum, loan) => sum + loan.balance, 0), info.debtSummaryExtra.totalDebtAmount);
    assert.equal(info.debts.reduce((sum, debt) => sum + debt.amount, 0), info.debtSummaryExtra.totalDebtAmount);
  }
  for (const lead of result.leads) {
    assert.ok(DB_LEAD_STATUSES.includes(lead.status)); assert.ok(DB_DETAIL_STAGE_OPTIONS.includes(lead.detailStage));
    assert.equal(lead.source, '기타');
    assert.equal(lead.sourceExternalKey, undefined); assert.equal(lead._platform, undefined); assert.equal(lead.adName, undefined);
    assert.ok(lead.contactLog.every(entry => entry.type === 'phone' && entry.note.startsWith('[시연]')));
  }
  for (const record of result.cases) assert.ok(CASE_STAGES.includes(record.stage));
});

test('intakes cover all 18 KST days evenly; new contracts and recorded events are chronological', () => {
  const result = buildScaledSalesDemo(baseline());
  assert.equal(result.summary.after.intakeDays.length, 18);
  assert.ok(result.summary.after.intakeDays.every(row => row.count >= 27 && row.count <= 28));
  const leadMap = new Map(result.leads.map(lead => [lead.id, lead]));
  for (const lead of result.leads) {
    assert.ok(lead.receivedAt.endsWith('+09:00'));
    assert.ok(lead.receivedAt.slice(0, 10) >= '2026-10-01' && lead.receivedAt.slice(0, 10) <= '2026-10-18');
    assert.ok(Date.parse(lead.stageUpdatedAt) >= Date.parse(lead.receivedAt));
    for (const memo of lead.consultation.memoLog) assert.ok(Date.parse(memo.at) >= Date.parse(lead.receivedAt) && memo.at.slice(0, 10) <= '2026-10-18');
    for (const contact of lead.contactLog) assert.ok(Date.parse(contact.at) >= Date.parse(lead.receivedAt));
    if (lead.detailStage === '장기부재') assert.ok(lead.receivedAt.slice(0, 10) <= '2026-10-10');
  }
  for (const record of result.cases) {
    assert.ok(record.contractDate >= leadMap.get(record.fromLeadId).receivedAt.slice(0, 10));
    assert.ok(record.contractDate <= '2026-10-18');
  }
});

test('absence histories have no fabricated connected call and reservations have matching schedules', () => {
  const result = buildScaledSalesDemo(baseline());
  for (const lead of result.leads) {
    if (lead.detailStage === '신규디비') assert.equal(lead.contactLog.length, 0);
    if (['부재', '장기부재'].includes(lead.detailStage)) {
      assert.ok(lead.contactLog.length >= 2);
      assert.ok(lead.contactLog.every(entry => entry.connected === false && entry.durationSeconds === 0));
      assert.ok(lead.consultation.memoLog.some(entry => entry.tag === '부재중'));
      assert.equal(lead.consultation.judgment.costGuided, false);
    }
    if (lead.detailStage === '예약') {
      assert.match(lead.reservationAt, /^2026-10-\d{2}T(14|16):00$/);
      assert.equal(result.schedules.filter(schedule => schedule.type === '상담예약' && schedule.title.includes(`${lead.name} `)).length, 1);
    }
  }
});

test('installment amounts and paid totals reconcile, including prepaid, outstanding and overdue examples', () => {
  const result = buildScaledSalesDemo(baseline());
  assert.ok(result.installments.some(row => row.status === '완료'));
  assert.ok(result.installments.some(row => row.status === '예정'));
  assert.ok(result.installments.some(row => row.status === '연체'));
  assert.ok(result.cases.some(row => row.paidAmount === row.contractAmount));
  assert.ok(result.cases.some(row => row.paidAmount < row.contractAmount));
  for (const record of result.cases) {
    const rows = result.installments.filter(row => row.caseId === record.id);
    assert.equal(rows.length, 6);
    assert.deepEqual(clone(rows.map(row => row.seq)), [1, 2, 3, 4, 5, 6]);
    assert.equal(rows.reduce((sum, row) => sum + row.amount, 0), record.contractAmount);
    assert.equal(rows.reduce((sum, row) => sum + (row.status === '완료' ? row.actualPaidAmount : 0), 0), record.paidAmount);
    assert.equal(record.totalDebt, result.leads.find(row => row.id === record.fromLeadId).consultation.debtSummaryExtra.totalDebtAmount);
    for (const row of rows) {
      assert.ok(row.dueDate >= record.contractDate);
      if (row.status === '완료') assert.ok(row.paidDate >= record.contractDate && row.paidDate <= '2026-10-18');
      else assert.equal(row.paidDate, undefined);
      if (row.status === '연체') assert.ok(row.dueDate < '2026-10-18');
    }
  }
});

test('actual baseline assignment and stage differences adjust additions without changing originals', () => {
  const input = baseline();
  input.existingLeads[0].assignedStaff = 'TEST6'; input.existingCases[0].assignedStaff = 'TEST6';
  input.existingLeads[10].assignedStaff = 'TEST4';
  input.existingLeads[8].status = '거절'; input.existingLeads[8].detailStage = '불가';
  const before = JSON.stringify(input), result = buildScaledSalesDemo(freeze(input));
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(clone(result.summary.after.groups), clone(SCALED_DEMO_TARGETS.groups));
  assert.ok(result.summary.after.staff.every(staff => staff.active === 40 && staff.retained === 15));
  assert.equal(result.cases.filter(row => row.assignedStaff === 'TEST6').length, 14);
  assert.equal(result.leads.filter(row => row.detailStage === '예약').length, 39);
});

test('invalid inputs fail closed instead of overwriting or re-expanding existing material', () => {
  const attempts = [
    input => { input.firmId = '../wrong'; },
    input => { input.batchKey = 'bad key'; },
    input => { input.existingLeads.pop(); },
    input => { input.existingCases.pop(); },
    input => { input.existingLeads[0].id = input.existingLeads[1].id; },
    input => { input.existingCases[0].id = input.existingCases[1].id; },
    input => { input.existingLeads[0]._lawFirmId = 'foreign'; },
    input => { input.existingCases[0]._lawFirmId = 'foreign'; },
    input => { input.existingLeads[0].assignedStaff = '실제직원'; },
    input => { input.existingLeads[0].receivedAt = 'invalid'; },
    input => { input.existingLeads[0].receivedAt = '2026-09-30T12:00:00+09:00'; },
    input => { input.existingCases[0].contractAmount = 0; },
    input => { input.existingCases[0].contractAmount = NaN; },
    input => { input.existingCases[0].status = '취하'; },
    input => { input.existingCases[0].fromLeadId = 'missing'; },
    input => { input.existingCases[0].clientId = 'wrong'; },
    input => { input.existingCases[0].assignedStaff = 'TEST6'; },
    input => { input.existingLeads[8].convertedCaseId = 'missing'; },
    input => { input.existingLeads[8].convertedClientId = 'missing'; },
  ];
  for (const change of attempts) { const input = baseline(); change(input); assert.throws(() => buildScaledSalesDemo(input)); }
  const input = baseline(), result = buildScaledSalesDemo(input);
  assert.throws(() => buildScaledSalesDemo({ ...input, existingLeads: [...input.existingLeads, ...result.leads], existingCases: [...input.existingCases, ...result.cases] }), /최초 스냅샷/);
});

test('generated ID collision with baseline is rejected', () => {
  const input = baseline(), old = input.existingLeads[0].id;
  input.existingLeads[0].id = `DEMO2-${firmId}-${batchKey}-DB-013`;
  input.existingCases.find(record => record.fromLeadId === old).fromLeadId = input.existingLeads[0].id;
  assert.throws(() => buildScaledSalesDemo(input), /충돌/);
});

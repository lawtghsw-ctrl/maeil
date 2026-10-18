// Pure normalization only. Existing source records must stay byte-for-byte intact.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
Module._load = function(name, parent, ...rest) {
  return originalLoad.call(this, name.startsWith('@/') ? path.join(root, name.slice(2)) : name, parent, ...rest);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText, filename);
const core = require('../lib/management-core.ts');
const access = require('../lib/management-access.ts');

test('all current workload views apply 40 even when the saved legacy cap is 50', () => {
  for (const saved of [undefined, 0, 1, 40, 50, 100, '50', null]) {
    const source = { ...structuredClone(core.DEFAULT_MANAGEMENT_SETTINGS), activeDbCap: saved };
    const before = JSON.stringify(source);
    assert.equal(core.normalizeManagementSettings(source).activeDbCap, 40);
    assert.equal(access.firmVisibleSettings(source).activeDbCap, 40);
    assert.equal(JSON.stringify(source), before);
  }
  assert.equal(core.ACTIVE_DB_CAP, 40);
  assert.equal(core.DEFAULT_MANAGEMENT_SETTINGS.activeDbCap, 40);
});

test('workload standard leaves financial rules and prior closed snapshots unchanged', () => {
  const source = structuredClone(core.DEFAULT_MANAGEMENT_SETTINGS);
  source.activeDbCap = 50;
  source.staffCompensations = [{staff:'A',employmentType:'정규직',baseSalary:1200000,incentiveMode:'수임액%',incentiveValue:12.5,clawbackOnCancel:true}];
  source.monthClosings['2026-09'] = {closedAt:'2026-10-01',snapshot:core.makeFinancialSnapshot(source),totals:{contractCount:2,contractSales:8000000,cashSales:1000000,purchaseCost:500000,laborCost:1200000,paymentFees:0,fixedCost:100000}};
  const before = structuredClone(source), normalized = core.normalizeManagementSettings(source);
  assert.deepEqual(source, before);
  assert.deepEqual(normalized.staffCompensations, before.staffCompensations);
  assert.deepEqual(normalized.monthClosings, before.monthClosings);
  assert.deepEqual(core.closedTotalsForRange(normalized,'2026-09-01','2026-09-30'), before.monthClosings['2026-09'].totals);
});

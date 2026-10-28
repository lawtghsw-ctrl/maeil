const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');

// All fixtures are synthetic. This executes the application's real export writer,
// not a separately restyled sample, and never reads a customer or a network source.
const filename = path.join(__dirname, '../lib/analytics-excel.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  fileName: filename,
}).outputText;

function load(globals = {}, browserBundle = false) {
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, Date, Blob, Uint8Array, setTimeout,
    require(name) {
      assert.equal(name, 'exceljs');
      return browserBundle ? require('exceljs/dist/exceljs.min.js') : ExcelJS;
    },
    ...globals,
  };
  // Execute in this realm: ExcelJS's Array checks must see the same Array class.
  new Function(...Object.keys(context), compiled)(...Object.values(context));
  return module.exports;
}

function fixture() {
  return {
    filename: 'synthetic-analytics.xlsx', periodLabel: '2026-10-01 ~ 2026-10-31', scopeLabel: '가상 범위',
    sheets: [{
      name: '04_실제납부', title: 'REMOVED TITLE', subtitle: 'REMOVED SUBTITLE',
      kpis: [{ label: '가상 지표', value: 25, format: 'percent1' }, { label: '미확정 지표', value: null, format: 'won' }],
      sections: [{
        title: 'FIRST SECTION TITLE',
        headers: ['식별자', '계약일', '실제 납부액', '납부율', '확인', '비고'],
        formats: ['text', 'date', 'won', 'percent1', 'text', 'text'],
        rows: [
          ['SYN-001', '2026-10-01', 120000, 12.5, true, '첫 번째 기록'],
          ['SYN-002', '2026-10-02', 0, 0, false, '=HYPERLINK("https://example.invalid","text")'],
          ['SYN-003', '2026-10-03', -10000, -1.5, null, '다음 줄\n두 번째 줄'],
        ],
        totalRow: ['합계', null, 110000, null, null, null],
        note: '날짜가 없는 납부는 해당 월의 실제 입금에 포함하지 않습니다.',
      }, {
        title: '추가 내역', headers: ['항목', '값'], rows: [['보존된 추가 기록', 4.25]],
      }],
    }, {
      name: '빈_조회', title: 'NO COVER', sections: [{ title: 'Empty', headers: ['항목', '건수'], rows: [] }],
    }, {
      name: '지표만', title: 'NO COVER', kpis: [{ label: '건수', value: 7, format: 'integer' }],
    }],
  };
}

function assertCentered(workbook) {
  for (const sheet of workbook.worksheets) {
    sheet.eachRow(row => row.eachCell(cell => {
      assert.equal(cell.alignment.horizontal, 'center', `${sheet.name}!${cell.address} must be centered`);
      assert.equal(cell.alignment.vertical, 'middle', `${sheet.name}!${cell.address} must remain vertically centered`);
    }));
  }
}

test('every sheet starts with a table header; first records, all sections, KPIs and source totals survive', async () => {
  const input = fixture();
  const before = JSON.stringify(input);
  const wb = await load().buildAnalyticsMeetingWorkbook(input);
  assert.equal(wb.worksheets.length, 3);
  const first = wb.worksheets[0];
  assert.deepEqual(first.getRow(1).values.slice(1), input.sheets[0].sections[0].headers);
  assert.deepEqual([2, 3, 4].map(row => first.getCell(row, 1).value), ['SYN-001', 'SYN-002', 'SYN-003']);
  assert.equal(first.getCell('C5').value, 110000);
  assert.equal(first.getCell('C5').font.bold, true);
  assert.equal(first.getCell('C5').border.top.style, 'double');
  assert.equal(first.getCell('C2').value, 120000);
  assert.equal(first.getCell('C3').value, 0);
  assert.equal(first.getCell('C4').value, -10000);
  assert.equal(first.getCell('D2').value, 0.125);
  assert.equal(first.getCell('D4').value, -0.015);
  assert.equal(first.getCell('D2').numFmt, '0.0%;[Red]-0.0%;0.0%');
  const values = [];
  first.eachRow(row => row.eachCell(cell => values.push(cell.value)));
  assert.ok(values.includes('보존된 추가 기록'));
  assert.ok(values.includes(4.25));
  assert.ok(values.includes('가상 지표'));
  assert.ok(values.includes(0.25));
  for (const removed of ['REMOVED TITLE', 'REMOVED SUBTITLE', 'FIRST SECTION TITLE', '조회기간', '생성일시']) {
    assert.ok(!values.includes(removed));
  }
  assert.equal(wb.worksheets[1].getCell('A1').value, '항목');
  assert.equal(wb.worksheets[2].getCell('A1').value, '지표');
  assert.equal(wb.worksheets[2].getCell('A2').value, '건수');
  assertCentered(wb);
  assert.equal(JSON.stringify(input), before, 'writer must not mutate the analytics model');
});

test('serialized XLSX contains real fonts/fills/borders/formats, row-1 panes, scoped filter and print setup', async () => {
  const wb = await load().buildAnalyticsMeetingWorkbook(fixture());
  const bytes = await wb.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(bytes);
  const styles = await zip.file('xl/styles.xml').async('string');
  const sheet = await zip.file('xl/worksheets/sheet1.xml').async('string');
  const workbookXml = await zip.file('xl/workbook.xml').async('string');
  assert.match(styles, /맑은 고딕/);
  assert.match(styles, /rgb="FFF2F7EE"/);
  assert.match(styles, /rgb="FFE6EAE5"/);
  assert.match(styles, /style="thin"/);
  assert.match(styles, /style="double"/);
  assert.match(styles, /horizontal="center"/);
  assert.doesNotMatch(styles, /horizontal="(?:left|right)"/);
  assert.match(styles, /yyyy-mm-dd/);
  assert.match(styles, /0\.0%/);
  assert.match(sheet, /<pane[^>]*ySplit="1"[^>]*topLeftCell="A2"[^>]*state="frozen"/);
  assert.match(sheet, /<autoFilter ref="A1:F4"\/>/);
  assert.match(sheet, /<pageSetup[^>]*paperSize="9"[^>]*fitToWidth="1"[^>]*fitToHeight="0"/);
  assert.match(sheet, /<col[^>]*width="[1-9]/);
  assert.match(workbookXml, /_xlnm.Print_Titles[^<]*>[^<]*!\$1:\$1/);
  assert.match(workbookXml, /_xlnm.Print_Area/);
  assert.doesNotMatch(sheet, /<f[ >]/, 'untrusted string values must not become formulas');
  const imported = new ExcelJS.Workbook();
  await imported.xlsx.load(bytes);
  const reopened = imported.worksheets[0];
  assert.equal(reopened.getCell('B2').value.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(reopened.getCell('C2').value, 120000);
  assert.equal(reopened.getCell('C2').font.name, '맑은 고딕');
  assert.equal(reopened.getCell('C2').fill.fgColor.argb, 'FFF2F7EE');
  assert.equal(reopened.views[0].ySplit, 1);
  assert.equal(reopened.autoFilter, 'A1:F4');
  assert.equal(reopened.getCell('F3').type, ExcelJS.ValueType.String);
  assert.equal(reopened.getCell('F4').alignment.wrapText, true);
  assert.ok(reopened.getRow(4).height >= 40);
  assertCentered(imported);
  // Optional local QA output is generated by the real app writer, not an artifact substitute.
  if (process.env.ANALYTICS_EXCEL_QA_OUTPUT) fs.writeFileSync(process.env.ANALYTICS_EXCEL_QA_OUTPUT, Buffer.from(bytes));
});

test('typing preserves identifiers, zero, blanks, invalid dates and literal strings', async () => {
  const input = {
    filename: 'types.xlsx', periodLabel: '', scopeLabel: '', sheets: [{ name: 'Types', title: '', sections: [{
      title: '', headers: ['일자', '식별자', '금액', '없음', '문자'], formats: ['date', 'text', 'won', 'integer', 'text'],
      rows: [
        ['2024-02-29', '00123', 0, null, '=1+1'],
        ['2026-02-29', '20261001', -7, undefined, '+SUM(A1:A2)'],
        [new Date('2026-10-31T00:00:00Z'), '00001', 2, 0, '@literal'],
        ['', '00002', 0, '', ''],
      ],
    }] }],
  };
  const sheet = (await load().buildAnalyticsMeetingWorkbook(input)).worksheets[0];
  assert.equal(sheet.getCell('A2').value.toISOString(), '2024-02-29T00:00:00.000Z');
  assert.equal(sheet.getCell('A3').value, '2026-02-29');
  assert.equal(sheet.getCell('A4').value.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(sheet.getCell('B2').value, '00123');
  assert.equal(sheet.getCell('B3').value, '20261001');
  assert.equal(sheet.getCell('C2').value, 0);
  assert.equal(sheet.getCell('D2').value, null);
  assert.equal(sheet.getCell('D3').value, null);
  assert.equal(sheet.getCell('D4').value, 0);
  assert.equal(sheet.getCell('E2').value, '=1+1');
  assert.equal(sheet.getCell('A5').value, null);
  assert.equal(sheet.getCell('C5').value, 0);
  assert.equal(sheet.getCell('D5').value, null);
  assert.equal(sheet.getCell('E5').value, null);
});

test('empty results remain filterable and names are valid and case-insensitively unique', async () => {
  const input = { filename: 'empty.xlsx', periodLabel: '', scopeLabel: '', sheets: ["'A/B'", "a:b", 'History', '', 'x'.repeat(40), 'x'.repeat(40)].map(name => ({ name, title: '' })) };
  const wb = await load().buildAnalyticsMeetingWorkbook(input);
  assert.deepEqual(wb.worksheets.map(s => s.name), ['A B', 'a b (2)', 'History_', 'Sheet', 'x'.repeat(31), 'x'.repeat(27) + ' (2)']);
  for (const sheet of wb.worksheets) {
    assert.equal(sheet.getCell('A1').value, '항목');
    assert.equal(sheet.rowCount, 1);
    assert.equal(sheet.autoFilter.to.row, 1);
    assert.equal(sheet.views[0].ySplit, 1);
  }
  await assert.rejects(load().buildAnalyticsMeetingWorkbook({ ...input, sheets: [] }), /시트/);
});

test('rejects truncated schemas and non-finite numbers instead of silently losing data', async () => {
  const input = fixture();
  input.sheets[0].sections[0].rows.push(['too', 'many', 'source', 'columns', 1, 2, 3]);
  await assert.rejects(load().buildAnalyticsMeetingWorkbook(input), /열 제목/);
  const invalid = fixture();
  invalid.sheets[0].sections[0].rows[0][2] = Infinity;
  await assert.rejects(load().buildAnalyticsMeetingWorkbook(invalid), /숫자/);
});

test('actual browser bundle creates styled XLSX and download removes its temporary element', async () => {
  const calls = [];
  let blob;
  const anchor = { click() { calls.push('click'); }, remove() { calls.push('remove'); } };
  const api = load({
    URL: { createObjectURL(value) { blob = value; return 'blob:synthetic'; }, revokeObjectURL(value) { calls.push(value); } },
    document: { createElement(type) { assert.equal(type, 'a'); return anchor; }, body: { appendChild(value) { assert.equal(value, anchor); calls.push('append'); } } },
    setTimeout(callback, delay) { assert.equal(delay, 30000); callback(); },
  }, true);
  await api.exportAnalyticsMeetingWorkbook(fixture());
  assert.equal(anchor.download, 'synthetic-analytics.xlsx');
  assert.equal(anchor.href, 'blob:synthetic');
  assert.equal(blob.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.deepEqual(calls, ['append', 'click', 'remove', 'blob:synthetic']);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.match(await zip.file('xl/styles.xml').async('string'), /맑은 고딕/);
});

test('all eight production sheets retain their data, centered cells, and a receipt-only first tab', async () => {
  const cache = new Map();
  function sourceModule(file) {
    const absolute = path.resolve(__dirname, '..', file);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const module = { exports: {} };
    cache.set(absolute, module);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: absolute,
    }).outputText;
    const requireSource = name => {
      assert.ok(name.startsWith('@/') || name.startsWith('.'), `Unexpected external module: ${name}`);
      const target = name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : path.resolve(path.dirname(absolute), name);
      const resolved = ['.ts', '.tsx'].map(extension => target + extension).find(fs.existsSync);
      assert.ok(resolved, name);
      return sourceModule(resolved);
    };
    new Function('require', 'module', 'exports', code)(requireSource, module, module.exports);
    return module.exports;
  }
  const { DEFAULT_MANAGEMENT_SETTINGS } = sourceModule('lib/management-core.ts');
  const { buildAnalyticsReport } = sourceModule('lib/analytics-report.ts');
  const store = {
    leads: [], clients: [{ id: 'synthetic-client', name: '가상 의뢰인', _lawFirmId: 'synthetic-firm' }],
    cases: [{ id: 'synthetic-case', clientId: 'synthetic-client', contractDate: '2026-10-05', contractAmount: 1000000,
      paidAmount: 200000, assignedStaff: '가상 담당', caseNumber: 'SYN-2026-001', caseType: '개인회생',
      paymentMethod: '단순분납', status: '진행중', stage: '서류준비', _lawFirmId: 'synthetic-firm' }],
    installments: [
      { id: 'synthetic-receipt', caseId: 'synthetic-case', seq: 1, dueDate: '2026-10-10', paidDate: '2026-10-10',
        amount: 300000, actualPaidAmount: 200000, status: '완료', _lawFirmId: 'synthetic-firm' },
      { id: 'synthetic-receipt-two', caseId: 'synthetic-case', seq: 2, dueDate: '2026-10-20', paidDate: '2026-10-20',
        amount: 300000, actualPaidAmount: 150000, status: '완료', _lawFirmId: 'synthetic-firm' },
      { id: 'synthetic-pending', caseId: 'synthetic-case', seq: 3, dueDate: '2026-10-21', paidDate: '2026-10-21',
        amount: 300000, actualPaidAmount: 300000, status: '예정', _lawFirmId: 'synthetic-firm' },
      { id: 'synthetic-undated', caseId: 'synthetic-case', seq: 4, dueDate: '2026-10-22',
        amount: 300000, actualPaidAmount: 120000, status: '완료', _lawFirmId: 'synthetic-firm' },
      { id: 'synthetic-missing-actual', caseId: 'synthetic-case', seq: 5, dueDate: '2026-10-23', paidDate: '2026-10-23',
        amount: 300000, status: '완료', _lawFirmId: 'synthetic-firm' },
      { id: 'synthetic-prior', caseId: 'synthetic-case', seq: 6, dueDate: '2026-09-20', paidDate: '2026-09-20',
        amount: 300000, actualPaidAmount: 70000, status: '완료', _lawFirmId: 'synthetic-firm' },
    ],
    workStaffNames: ['가상 담당'], staffDirectory: [], superAdminFirmScope: 'synthetic-firm',
    firmDirectory: [{ id: 'synthetic-firm', name: '가상 사무소', status: 'active' }], caseDocuments: {},
  };
  const settings = { globalSuperView: false, effectiveFirmId: 'synthetic-firm', activeSettings: structuredClone(DEFAULT_MANAGEMENT_SETTINGS), settingsByFirm: {}, error: null };
  const report = buildAnalyticsReport({ store, settings, start: '2026-10-01', end: '2026-10-31', mode: 'monthly', supply: { data: null, error: null, loading: false } });
  const specs = report.buildSheets();
  assert.equal(specs.length, 8);
  assert.deepEqual(specs.map(sheet => sheet.name), ['04 입금내역', '00 회의요약', '01 팀인원', '02 상담운영', '05 사건수납', '07 정산입력', '06 산식기준', '03 DB구매유입']);
  assert.equal(specs[0].sections.length, 1, 'receipt tab must not append contract, quality-check or status tables');
  assert.ok(!specs[0].kpis?.length, 'receipt tab must not append unrelated KPI rows');
  assert.deepEqual(specs[0].sections[0].headers, ['입금일', '담당', '의뢰인', '회차', '납부방식', '실입금액']);
  assert.equal(specs[0].sections[0].rows.length, 2, 'one row per actual dated receipt, never one row per contract');
  assert.deepEqual(specs[0].sections[0].rows.map(row => row.slice(1)), [
    ['가상 담당', '가상 의뢰인', 1, '단순분납', 200000],
    ['가상 담당', '가상 의뢰인', 2, '단순분납', 150000],
  ]);
  const workbook = await load().buildAnalyticsMeetingWorkbook({ filename: 'synthetic-full-report.xlsx', periodLabel: report.periodLabel, scopeLabel: report.scopeLabel, sheets: specs });
  for (const [index, sheet] of workbook.worksheets.entries()) {
    assert.deepEqual(sheet.getRow(1).values.slice(1), specs[index].sections[0].headers);
    assert.equal(sheet.views[0].ySplit, 1);
    assert.equal(sheet.autoFilter.from.row, 1);
    assert.equal(sheet.autoFilter.to.row, 1 + specs[index].sections[0].rows.length);
  }
  const receipts = workbook.worksheets[0];
  assert.equal(receipts.columnCount, 6);
  assert.equal(receipts.rowCount, 4, 'headers, two receipts and one total only');
  assert.equal(receipts.pageSetup.paperSize, 9);
  assert.equal(receipts.pageSetup.orientation, 'portrait');
  assert.equal(receipts.pageSetup.fitToPage, true);
  assert.equal(receipts.pageSetup.fitToWidth, 1);
  assert.equal(receipts.pageSetup.fitToHeight, 0);
  assert.equal(receipts.pageSetup.printTitlesColumn, undefined);
  assert.equal(receipts.pageSetup.printTitlesRow, '1:1');
  assert.equal(receipts.pageSetup.printArea, 'A1:F4');
  assert.equal(receipts.views[0].xSplit, 0);
  assert.equal(receipts.views[0].topLeftCell, 'A2');
  assert.equal(receipts.getCell('F2').value, 200000);
  assert.equal(receipts.getCell('F3').value, 150000);
  assert.equal(receipts.getCell('F4').value, 350000);
  assert.equal(receipts.getCell('F4').font.bold, true);
  assert.equal(receipts.getCell('F4').border.top.style, 'double');
  const firstTabValues = [];
  receipts.eachRow(row => row.eachCell(cell => firstTabValues.push(cell.value)));
  for (const forbidden of ['계약일', '사건번호', '사건유형', '계약금액', '계약 ID', '입금 기록 ID', '확인사항', '상태', '진행중', '완료', 'SYN-2026-001', 'synthetic-case', 'synthetic-receipt', 1000000]) {
    assert.ok(!firstTabValues.includes(forbidden), `receipt tab must not include ${forbidden}`);
  }
  assertCentered(workbook);
  const bytes = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes);
  assert.equal(reopened.worksheets.length, 8);
  assert.equal(reopened.worksheets[0].getCell('A2').value.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(reopened.worksheets[0].getCell('A3').value.toISOString(), '2026-10-20T00:00:00.000Z');
  assert.equal(reopened.worksheets[0].getCell('B4').value, null, 'empty total cells stay truly blank');
  assert.equal(reopened.worksheets[0].getCell('F2').numFmt, '#,##0"원";[Red]-#,##0"원";0"원"');
  assertCentered(reopened);
  // The alignment change must not drop or coerce any values/formats on the other seven tabs.
  for (let index = 1; index < workbook.worksheets.length; index++) {
    const original = workbook.worksheets[index];
    const restored = reopened.worksheets[index];
    assert.equal(restored.rowCount, original.rowCount);
    assert.equal(restored.columnCount, original.columnCount);
    original.eachRow(row => row.eachCell(cell => {
      assert.deepEqual(restored.getCell(cell.address).value, cell.value, `${original.name}!${cell.address} retains value`);
      assert.equal(restored.getCell(cell.address).numFmt, cell.numFmt, `${original.name}!${cell.address} retains format`);
    }));
  }
  if (process.env.ANALYTICS_EXCEL_REPORT_QA_OUTPUT) fs.writeFileSync(process.env.ANALYTICS_EXCEL_REPORT_QA_OUTPUT, Buffer.from(bytes));
});

test('a scope change during XLSX serialization cancels the final browser download', async () => {
  let current=true,guards=0;
  const api=load({URL:{createObjectURL(){throw new Error('Stale URL created');}},document:{createElement(){throw new Error('Stale element created');}}},true);
  const pending=api.exportAnalyticsMeetingWorkbook({...fixture(),canDownload:()=>{guards++;return current;}});
  current=false;
  await pending;
  assert.equal(guards,1);
});

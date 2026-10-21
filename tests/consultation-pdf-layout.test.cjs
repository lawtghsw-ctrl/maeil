const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { jsPDF } = require('jspdf');
const { load, snapshot, shortSnapshot } = require('./helpers/consultation-pdf.cjs');
const font = fs.readFileSync(path.resolve(__dirname, '../public/fonts/NanumGothic-Regular.ttf')).toString('base64');
const clean = text => text.replace(/\s/g, '');

function instrumentedPdf() {
  const rectangles = [], texts = [], documents = [];
  function RecordingPdf(options) {
    const doc = new jsPDF(options);
    const rect = doc.rect, text = doc.text;
    let cell;
    doc.rect = function(x, y, width, height, ...args) {
      cell = { x, y, width, height, page: doc.internal.getCurrentPageInfo().pageNumber, texts: [] };
      rectangles.push(cell);
      return rect.call(doc, x, y, width, height, ...args);
    };
    doc.text = function(value, x, y, options, ...args) {
      const size = doc.getFontSize(), width = doc.getTextWidth(value);
      const item = { value, x: options?.align === 'right' ? x - width : x, y, width, size, page: doc.internal.getCurrentPageInfo().pageNumber };
      texts.push(item);
      if (cell?.page === item.page && y >= cell.y && y <= cell.y + cell.height) cell.texts.push(item);
      return text.call(doc, value, x, y, options, ...args);
    };
    documents.push(doc);
    return doc;
  }
  return { pdf: load('lib/consultation-pdf.ts', { jspdf: { jsPDF: RecordingPdf } }), rectangles, texts, documents };
}
function assertGeometry(render) {
  assert.ok(render.rectangles.length > 0);
  for (const rect of render.rectangles) {
    assert.ok(rect.x >= 9 - 0.01 && rect.x + rect.width <= 201 + 0.01, `Cell outside horizontal print area: ${JSON.stringify(rect)}`);
    assert.ok(rect.y >= 15 - 0.01 && rect.y + rect.height <= 282 + 0.01, `Cell outside body: ${JSON.stringify(rect)}`);
    for (const item of rect.texts) {
      assert.ok(item.x >= rect.x + 1.19 && item.x + item.width <= rect.x + rect.width - 1.19, `Text overruns its cell: ${JSON.stringify(item)}`);
      assert.ok(item.y - item.size / (72 / 25.4) * 0.8 >= rect.y - 0.01, `Text above cell: ${item.value}`);
      assert.ok(item.y + item.size / (72 / 25.4) * 0.25 <= rect.y + rect.height + 0.01, `Text below cell: ${item.value}`);
    }
  }
  for (const item of render.texts) {
    assert.ok(item.size >= 9, `Illegibly small text: ${item.size}pt`);
    assert.ok(item.x >= 9 - 0.01 && item.x + item.width <= 201 + 0.01, `Text outside page: ${item.value}`);
    assert.ok(item.y >= 9 && item.y <= 291.01, `Text outside vertical print area: ${item.value}`);
  }
}

for (const [name, build, pages] of [['short', shortSnapshot, 1], ['populated', snapshot, 2], ['stress', () => snapshot(true), 7]]) {
  test(`${name} fixture uses ${pages} portrait A4 pages with readable type, bounded cells and complete values`, async () => {
    const input = build(), before = JSON.stringify(input), render = instrumentedPdf();
    const blob = await render.pdf.createConsultationPdf(input, font);
    assert.equal(JSON.stringify(input), before, 'Rendering must not mutate the draft');
    assert.equal(render.documents[0].getNumberOfPages(), pages);
    assert.equal(blob.type, 'application/pdf');
    assertGeometry(render);
    const output = clean(render.texts.map(item => item.value).join(''));
    const sections = load('lib/consultation-pdf-data.ts').consultationPdfSections(input);
    for (const section of sections) {
      assert.ok(output.includes(clean(section.title)), `Missing section: ${section.title}`);
      for (const row of section.rows) for (const value of row) {
        // Check each explicit line separately: a long memo can cross a page heading.
        for (const line of value.split('\n')) assert.ok(output.includes(clean(line)), `Missing value: ${line}`);
      }
    }
    if (name === 'stress') {
      for (let number = 1; number <= 25; number++) assert.ok(output.includes(clean(`기대출 끝 ${number}`)));
      for (let number = 1; number <= 170; number++) assert.ok(output.includes(clean(`${number}. 합성 상담기록`)));
    }
    const bodyText = render.texts.find(item => item.value.includes(input.name));
    assert.equal(bodyText.size, 10, 'Real consultation values remain at 10 pt, not scaled to fit');
  });
}

test('single oversized debt cell, unbroken Korean/Latin strings and memo author metadata paginate without clipping or omissions', async () => {
  const input = shortSnapshot();
  input.consultation.debts = [{ category: '기타', creditor: '가상 기관', amount: 10000,
    detail: '대출상세시작' + 'LONGTOKEN0123456789'.repeat(140) + '대출상세마지막',
    note: Array.from({ length: 90 }, (_, index) => `고유채무행${String(index).padStart(3, '0')} 확인 자료`).join('\n') }];
  input.consultation.memoLog = [{ id: 'synthetic-long-metadata', staff: '메타시작' + '가상상담원'.repeat(850) + '메타마지막',
    at: '2026-10-18T23:30:00Z', tag: '일반', text: '메모시작' + '긴연속한글'.repeat(600) + '메모마지막' }];
  const render = instrumentedPdf();
  await render.pdf.createConsultationPdf(input, font);
  assertGeometry(render);
  const output = clean(render.texts.map(item => item.value).join(''));
  for (const marker of ['대출상세시작', '대출상세마지막', '메타시작', '메타마지막', '메모시작', '메모마지막', '2026-10-19 08:30']) assert.ok(output.includes(clean(marker)), `Lost boundary marker: ${marker}`);
  for (let index = 0; index < 90; index++) assert.ok(output.includes(`고유채무행${String(index).padStart(3, '0')}확인자료`));
  // Reassemble the same debt column across pages, excluding the other columns
  // printed between its continuation fragments; assert all unbroken text survives.
  const debtDetail = render.rectangles.filter(rect => Math.abs(rect.x - (9 + 44 / 182 * 192)) < 0.01 && Math.abs(rect.width - 56 / 182 * 192) < 0.01)
    .flatMap(rect => rect.texts).filter(item => item.size === 10).map(item => item.value).join('');
  assert.ok(debtDetail.includes(input.consultation.debts[0].detail));
  const memoBody = render.rectangles.filter(rect => Math.abs(rect.width - 192) < 0.01)
    .flatMap(rect => rect.texts).filter(item => item.size === 10 && !item.value.includes('(계속)')).map(item => item.value).join('');
  assert.ok(memoBody.includes(input.consultation.memoLog[0].text));
  const memoMetadata = render.rectangles.filter(rect => Math.abs(rect.width - 192) < 0.01)
    .flatMap(rect => rect.texts).filter(item => item.size === 9).map(item => item.value).join('');
  assert.ok(memoMetadata.includes(input.consultation.memoLog[0].staff));
  assert.ok(render.documents[0].getNumberOfPages() > 3);
});

test('compact field rows preserve optional calculation, personal, loan source and attachment allowlists', async () => {
  const input = snapshot();
  Object.assign(input.consultation.personal, {
    birthDate: '1985-03-21', occupationType: '합성직군', workRegion: '가상회사지역', workJurisdictionCourt: '가상회사법원',
    maritalNote: '혼인확인메모', childrenAges: '자녀나이확인', parentAgeStatus: '부모상태확인', otherDependents: '기타부양확인',
    seriousIllness: '질환여부합성', dependentNote: '부양특이합성', callRequestTime: '14:00~16:00', dischargeHistoryNote: '면책이력확인',
    personalDebtNote: '개인채무확인', debtDisclosureShared: false, debtDisclosureNote: '공유여부확인', riskyAssetNote: '투자활동확인',
  });
  Object.assign(input.consultation.income, { tenureInfo: '재직상세확인', pensionIncome: 123400, severancePayEstimate: 12345600, salaryAccount: '통장상태확인' });
  Object.assign(input.consultation.housing, { spouseVehicleInfo: '배우자차량확인' });
  Object.assign(input.consultation.debtSummaryExtra, { cardPaymentAmount: 456700, heldCreditCards: '합성카드확인' });
  Object.assign(input.consultation.judgment, { workoutInProgress: false, workoutAmount: 876500 });
  Object.assign(input.consultation.recentLoanInsurance, { insuranceRefundAmount: 321000 });
  input.consultation.loanRecords[0].source = 'file'; input.consultation.loanRecords[0].sourceFileName = '가상대출자료.pdf';
  input.consultation.memoLog[0].pinned = true;
  input.result = { totalIncome: 36000000, assetTotal: 8000000, debtTotal: 2000000, securedDebtTotal: 1000000,
    unsecuredDebtTotal: 1000000, monthlyDisposableIncome: 1500000, totalPlannedRepayment: 54000000, liquidationValue: 5000000,
    liquidationCovered: true, finalMonthlyRepayment: 1500000, finalTotalRepayment: 54000000, writeOffAmount: 0,
    writeOffRate: 0, feasible: false, feasibilityNote: '가상판정참고확인' };
  const render = instrumentedPdf(); await render.pdf.createConsultationPdf(input, font); assertGeometry(render);
  const output = clean(render.texts.map(item => item.value).join(''));
  const sections = load('lib/consultation-pdf-data.ts').consultationPdfSections(input);
  for (const section of sections) for (const row of section.rows) for (const value of row) for (const line of value.split('\n')) assert.ok(output.includes(clean(line)), `Lost allowlisted content: ${line}`);
  for (const marker of ['가상판정참고확인', '파일 추출', '가상대출자료.pdf', '[고정]', '저장되지 않은 내용 포함', '한국시간']) assert.ok(output.includes(clean(marker)));
  assert.doesNotMatch(output, /forbidden.invalid|private-file-id|private-internal|private-memo-id|DO_NOT_EXPORT/);
});

test('real compact PDFs embed Korean glyphs, preserve page geometry and contain numbered footers', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lawpower-compact-pdf-'));
  try {
    const pdf = load('lib/consultation-pdf.ts');
    for (const [name, input, count] of [['short', shortSnapshot(), 1], ['populated', snapshot(), 2]]) {
      const file = path.join(dir, name + '.pdf');
      fs.writeFileSync(file, Buffer.from(await (await pdf.createConsultationPdf(input, font)).arrayBuffer()));
      const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
      assert.match(info, /Page size:\s+595\.28 x 841\.89 pts \(A4\)/);
      const python = process.env.PDF_TEST_PYTHON || 'python';
      const report = JSON.parse(execFileSync(python, ['-c', `from pypdf import PdfReader
import json,sys
r=PdfReader(sys.argv[1]); pages=[]
for p in r.pages:
 fonts=p['/Resources']['/Font']; embedded=[]
 for v in fonts.values():
  f=v.get_object()
  for d in f.get('/DescendantFonts', [f]):
   desc=d.get_object().get('/FontDescriptor')
   if desc:
    desc=desc.get_object(); embedded.append('/FontFile2' in desc)
 pages.append({'text':p.extract_text(), 'width':float(p.mediabox.width), 'height':float(p.mediabox.height), 'embedded':any(embedded)})
print(json.dumps(pages))`, file], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
      assert.equal(report.length, count);
      for (const [index, page] of report.entries()) {
        assert.equal(page.embedded, true); assert.equal(page.width, 595.28); assert.equal(page.height, 841.89);
        assert.ok(page.text.includes(`${index + 1} / ${count}`));
      }
      const text = report.map(page => page.text).join('');
      assert.ok(text.includes(input.name)); assert.ok(text.includes('2026-10-18 12:00')); assert.ok(text.includes('한국시간'));
      assert.equal(text.includes('저장되지 않은 내용 포함'), input.hasUnsavedChanges);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('browser font asset stays same-origin and is cached across concurrent exports; explicit font data stays offline', async () => {
  const requests = [];
  const bytes = fs.readFileSync(path.resolve(__dirname, '../public/fonts/NanumGothic-Regular.ttf'));
  const pdf = load('lib/consultation-pdf.ts', { fetch: async (url, options) => {
    requests.push({ url, options });
    return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  } });
  const blobs = await Promise.all([pdf.createConsultationPdf(shortSnapshot()), pdf.createConsultationPdf(snapshot())]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/fonts/NanumGothic-Regular.ttf');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(requests[0].options.cache, 'force-cache');
  assert.equal(requests[0].options.redirect, 'error');
  assert.equal(requests[0].options.body, undefined);
  assert.ok(blobs.every(blob => blob.type === 'application/pdf'));
  await pdf.createConsultationPdf(shortSnapshot(), font);
  assert.equal(requests.length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const font = fs.readFileSync(path.join(root, 'public/fonts/NanumGothic-Regular.ttf')).toString('base64');
const { load, snapshot } = require('./helpers/consultation-pdf.cjs');
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
const data = load('lib/consultation-pdf-data.ts');

test('PDF data contains draft, all selected sections, legacy memo, zero/false values and only attachment metadata', () => {
  const input = freeze(snapshot()), before = JSON.stringify(input), sections = data.consultationPdfSections(input), text = JSON.stringify(sections);
  assert.match(text, /아직 추가하지 않은/); assert.match(text, /이전 단일 메모/); assert.match(text, /상담 플랜/); assert.match(text, /기대출 리스트/);
  assert.match(text, /0원/); assert.match(text, /아니오/); assert.match(text, /합성첨부.pdf/);
  assert.doesNotMatch(text, /DO_NOT_EXPORT|forbidden.invalid|private-file-id|private-internal|private-memo-id/);
  assert.equal(JSON.stringify(input), before);
  const debt = sections.find(section => section.title === '채무 요약');
  assert.equal(debt.rows[0][1], '0원', 'Explicit zero overrides automatic loan totals');
});

test('PDF text and filenames handle control characters and special input without interpreting HTML', () => {
  assert.equal(data.consultationPdfText('<script>홍길동</script>\r\n문장\u0000🙂'), '<script>홍길동</script>\n문장[U+1F642]');
  assert.equal(data.consultationPdfFilename({ name: '../홍길동:가상', exportedAt: '2026-10-18T23:30:00Z' }), '상담일지_.._홍길동_가상_2026-10-19.pdf');
  assert.equal(data.consultationPdfDateTime('2026-10-20T14:30'), '2026-10-20 14:30');
  assert.equal(data.consultationPdfDateTime('2026-10-18T23:30:00Z'), '2026-10-19 08:30');
});

test('portable snapshot copy preserves optional, zero/false and invalid numeric values without sharing nested records', () => {
  const input = snapshot(); input.consultation.income.pensionIncome = NaN;
  input.consultation.assets[0].securityAmount = undefined;
  const captured = data.copyConsultationPdfSnapshot(input);
  assert.equal(captured.reservationChoice, false); assert.equal(captured.finance.paidAmount, 0);
  assert.equal(captured.consultation.assets[0].securityAmount, undefined);
  assert.ok(Number.isNaN(captured.consultation.income.pensionIncome));
  input.consultation.personal.address = '나중에 바뀐 주소'; input.consultation.loanRecords[0].balance = 777;
  assert.notEqual(captured.consultation.personal.address, input.consultation.personal.address);
  assert.notEqual(captured.consultation.loanRecords[0].balance, input.consultation.loanRecords[0].balance);
  assert.match(JSON.stringify(data.consultationPdfSections(captured)), /확인 필요원/);
});

test('legacy scalar lists and malformed text fields do not abort PDF or expose hidden object metadata', () => {
  const input = snapshot();
  input.consultation.personal.childrenAges = [7, 10, 0];
  input.consultation.personal.dischargeHistoryNote = { text: 'unverified nested content', id: 'HIDDEN_OBJECT_ID', url: 'https://forbidden.invalid', bytes: 'DO_NOT_EXPORT' };
  input.consultation.income.salaryAccount = ['가상 통장', null, false];
  input.consultation.attachedFiles[0].attachedAt = { invalid: true, url: 'https://forbidden.invalid' };
  const output = JSON.stringify(data.consultationPdfSections(input));
  assert.match(output, /7, 10, 0/); assert.match(output, /가상 통장, -, 아니오/);
  assert.match(output, /입력 형식 확인 필요/);
  assert.doesNotMatch(output, /HIDDEN_OBJECT_ID|forbidden.invalid|DO_NOT_EXPORT|unverified nested content/);
});

test('invalid and extreme legacy dates are preserved as text rather than throwing during Korean-time conversion', () => {
  for (const value of ['알 수 없는 날짜', '2026-99-99T12:00', '+275760-09-13T00:00:00.000Z']) {
    assert.equal(data.consultationPdfDateTime(value), value);
  }
  assert.equal(data.consultationPdfDateTime(undefined), '-');
});

test('corrupt collection entries keep explicit placeholder rows, valid neighbors and full visible counts', () => {
  const fixtures = [
    ['assets', '재산 현황', 'note'], ['debts', '채무 현황', 'note'],
    ['loanRecords', '기대출 리스트', 'note'], ['memoLog', '상담 메모', 'text'],
    ['attachedFiles', '첨부파일 목록', 'name'],
  ];
  for (const [key, title, field] of fixtures) {
    const input = snapshot(), row = input.consultation[key][0];
    input.consultation[key] = [{ ...row, [field]: '정상 첫 항목' }, null, 42, [], { ...row, [field]: '정상 마지막 항목' }];
    if (key === 'memoLog') input.consultation[key].push({ ...row, deletedAt: '2026-10-01', text: '삭제된 메모 제외' });
    const before = JSON.stringify(input), sections = data.consultationPdfSections(input);
    const section = sections.find(item => item.title.startsWith(title)), output = JSON.stringify(section);
    assert.equal(section.rows.length, 5, key); assert.equal(section.rows.filter(row => row.includes('[입력 형식 확인 필요]')).length, 3, key);
    assert.match(output, /정상 첫 항목/); assert.match(output, /정상 마지막 항목/);
    assert.doesNotMatch(output, /삭제된 메모 제외|forbidden.invalid|DO_NOT_EXPORT|private-/);
    if (key === 'loanRecords' || key === 'memoLog') assert.match(section.title, /5건/);
    assert.equal(JSON.stringify(input), before, 'No stored data changes');
  }
});

test('invalid collection shapes are visibly marked without reading unknown nested metadata', () => {
  for (const key of ['assets', 'debts', 'loanRecords', 'memoLog', 'attachedFiles']) {
    for (const value of [{ id: 'HIDDEN_COLLECTION_ID', url: 'https://forbidden.invalid', bytes: 'DO_NOT_EXPORT' }, 'broken-list', false, 7]) {
      const input = snapshot(); input.consultation[key] = value; input.finance = undefined;
      const output = JSON.stringify(data.consultationPdfSections(input));
      assert.match(output, /목록 형식 확인 필요/); assert.match(output, /입력 형식 확인 필요/);
      assert.doesNotMatch(output, /HIDDEN_COLLECTION_ID|forbidden.invalid|DO_NOT_EXPORT|broken-list|계약 \/ 수납 요약/);
    }
  }
});

test('a corrupt loan row cannot silently become a falsely complete inferred total', () => {
  const input = snapshot(); input.consultation.debtSummaryExtra = {};
  input.consultation.loanRecords = [{ ...input.consultation.loanRecords[0], balance: 1000 }, null];
  const section = data.consultationPdfSections(input).find(section => section.title === '채무 요약');
  assert.equal(section.rows[0][1], '확인 필요원');
  input.consultation.debtSummaryExtra.totalDebtAmount = 0;
  assert.equal(data.consultationPdfSections(input).find(section => section.title === '채무 요약').rows[0][1], '0원', 'Explicit user-entered totals still win');
});

test('real PDF is portrait A4 with embedded Korean text and complete long tables/memos across pages', async () => {
  const pdf = load('lib/consultation-pdf.ts');
  const input = freeze(snapshot(true)), before = JSON.stringify(input);
  const blob = await pdf.createConsultationPdf(input, font);
  assert.equal(blob.type, 'application/pdf'); assert.equal(JSON.stringify(input), before);
  const dir = process.env.CONSULTATION_PDF_SAMPLE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'lawpower-pdf-'));
  fs.mkdirSync(dir, { recursive: true }); const file = path.join(dir, 'consultation-synthetic-a4.pdf');
  fs.writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  assert.match(info, /Page size:\s+595\.28 x 841\.89 pts \(A4\)/);
  const pages = Number(info.match(/Pages:\s+(\d+)/)?.[1]); assert.ok(pages >= 4 && pages < 25, `Expected usable multipage output, got ${pages}`);
  const bundledPython = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const python = process.env.PDF_TEST_PYTHON || (fs.existsSync(bundledPython) ? bundledPython : 'python');
  const extracted = execFileSync(python, ['-c', 'from pypdf import PdfReader; import sys; print("".join((p.extract_text() or "") + "\\f" for p in PdfReader(sys.argv[1]).pages))', file], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  for (const text of ['홍길동 합성자료', '서울회생법원', '작성 중 메모', '긴메모시작', '긴메모마지막확인', '기대출 끝 25', '합성첨부.pdf']) assert.ok(extracted.includes(text), `Missing Korean text: ${text}`);
  assert.equal(extracted.split('\f').length - 1, pages);
  if (!process.env.CONSULTATION_PDF_SAMPLE_DIR) { fs.unlinkSync(file); fs.rmdirSync(dir); }
});

test('font failure produces a recoverable error and permits a later retry without customer network requests', async () => {
  const requests = [];
  const pdf = load('lib/consultation-pdf.ts', { fetch: async (url, options) => { requests.push({ url, options }); return { ok: false }; } });
  await assert.rejects(pdf.createConsultationPdf(snapshot()), /글꼴/);
  await assert.rejects(pdf.createConsultationPdf(snapshot()), /글꼴/);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url === '/fonts/NanumGothic-Regular.ttf' && !request.options.body));
});

test('download creates a PDF file link, clicks it, removes it and revokes only its local blob URL', () => {
  const actions = [], input = snapshot(), blob = new Blob(['offline PDF'], { type: 'application/pdf' });
  let release;
  const anchor = { click: () => actions.push('click'), remove: () => actions.push('remove') };
  const pdf = load('lib/consultation-pdf.ts', {
    document: { createElement: tag => { assert.equal(tag, 'a'); return anchor; }, body: { appendChild: node => { assert.equal(node, anchor); actions.push('append'); } } },
    URL: { createObjectURL: value => { assert.equal(value, blob); return 'blob:local-only'; }, revokeObjectURL: value => actions.push(value) },
    setTimeout: (callback, delay) => { assert.equal(delay, 60000); release = callback; },
  });
  pdf.downloadConsultationPdf(blob, input);
  assert.equal(anchor.href, 'blob:local-only'); assert.equal(anchor.download, '상담일지_홍길동 합성자료_2026-10-18.pdf');
  assert.deepEqual(actions, ['append', 'click', 'remove']); release();
  assert.deepEqual(actions, ['append', 'click', 'remove', 'blob:local-only']);
});

test('automatic download reuses the prepared modal URL without revoking the direct save/open links', () => {
  const actions = [], anchor = { click: () => actions.push('click'), remove: () => actions.push('remove') };
  const pdf = load('lib/consultation-pdf.ts', {
    document: { createElement: () => anchor, body: { appendChild: () => actions.push('append') } },
    URL: { createObjectURL: () => { throw new Error('Do not allocate a second URL'); }, revokeObjectURL: () => { throw new Error('Modal owns URL lifetime'); } },
    setTimeout: () => { throw new Error('Prepared links must not expire on a timer'); },
  });
  pdf.downloadConsultationPdf(new Blob(['offline PDF']), snapshot(), 'blob:prepared');
  assert.equal(anchor.href, 'blob:prepared'); assert.deepEqual(actions, ['append', 'click', 'remove']);
});

module.exports = { snapshot };

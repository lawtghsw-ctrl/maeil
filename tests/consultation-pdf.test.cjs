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

module.exports = { snapshot };

// Synthetic/offline: actual helpers and consumers; never reaches a database or SMS API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} }; cache.set(absolute, module);
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const req = name => name.startsWith('.') ? load(path.resolve(path.dirname(absolute), name) + '.ts') : require(name);
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Date, Intl, fetch() { throw Error('Network forbidden'); } }, { filename: absolute })(req, module, module.exports);
  return module.exports;
}
const memos = load('lib/consultation-memos.ts');
const calls = load('lib/consultation.ts');
const { buildLeadSearchIndex } = load('lib/list-indexes.ts');
const { consultationPdfSections } = load('lib/consultation-pdf-data.ts');
const { buildFirmPerformanceReport } = load('lib/performance/firm.ts');
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
const at = '2026-10-18T02:00:00Z', audit = { at: '2026-10-18T03:00:00Z', by: '수정 담당자' };
const row = (id, extra = {}) => ({ id, text: `합성 메모 ${id}`, at, staff: '원 작성자', tag: '일반', ...extra });

test('legacy visible order stays identical; edits change only text and additive audit metadata', () => {
  const input = freeze([row('latest', { tag: '부재중' }), row('old', { at: '2026-10-16T02:00:00Z' })]);
  const before = JSON.stringify(input);
  assert.deepEqual(clone(memos.visibleMemoEntries(input)), clone(input));
  const edited = memos.editMemoEntry(input, 'latest', '  수정된 내용\n두 번째 줄  ', audit);
  assert.equal(edited[0].text, '  수정된 내용\n두 번째 줄  ');
  for (const key of ['id', 'tag', 'at', 'staff']) assert.equal(edited[0][key], input[0][key]);
  assert.deepEqual(clone(edited[0].editHistory), [{ text: input[0].text, ...audit }]);
  assert.equal(edited[0].editedAt, audit.at); assert.equal(edited[0].editedBy, audit.by);
  const again = memos.editMemoEntry(edited, 'latest', '다음 수정', { ...audit, by: '다른 담당자' });
  assert.equal(again[0].editHistory.length, 2); assert.equal(again[0].editHistory[1].text, edited[0].text);
  assert.equal(memos.editMemoEntry(edited, 'latest', edited[0].text, audit)[0], edited[0]);
  assert.equal(JSON.stringify(input), before);
});

test('soft delete/restore retains original content, authorship, pin and raw chronology', () => {
  const input = freeze([row('latest'), row('pinned', { pinned: true, pinOrder: 0, tag: '재통화' }), row('old')]);
  const deleted = memos.deleteMemoEntry(input, 'pinned', audit);
  assert.deepEqual(deleted.map(entry => entry.id), input.map(entry => entry.id));
  assert.equal(deleted.length, input.length); assert.equal(deleted[1].text, input[1].text);
  assert.equal(deleted[1].deletedAt, audit.at); assert.equal(deleted[1].deletedBy, audit.by);
  assert.equal(memos.activeMemoEntries(deleted).length, 2);
  assert.equal(memos.deleteMemoEntry(deleted, 'pinned', { at, by: '다른 담당자' })[1], deleted[1]);
  assert.equal(memos.editMemoEntry(deleted, 'pinned', '거부', audit)[1], deleted[1]);
  assert.equal(memos.pinMemoEntry(deleted, 'pinned', false)[1], deleted[1]);
  assert.deepEqual(clone(memos.restoreMemoEntry(deleted, 'pinned')), clone(input));
});

test('pin/unpin/drag modifies metadata without moving, dropping or duplicating stored memo entries', () => {
  const input = freeze([row('a'), row('b'), row('c'), row('deleted', { deletedAt: at, pinned: true, pinOrder: 0 })]);
  let output = memos.pinMemoEntry(input, 'b', true); output = memos.pinMemoEntry(output, 'c', true);
  assert.deepEqual(clone(memos.visibleMemoEntries(output).map(entry => entry.id)), ['b', 'c', 'a']);
  output = memos.reorderPinnedMemos(output, ['c', 'b']);
  assert.deepEqual(clone(memos.visibleMemoEntries(output).map(entry => entry.id)), ['c', 'b', 'a']);
  assert.deepEqual(clone(output.map(entry => entry.id)), input.map(entry => entry.id));
  output.forEach((entry, index) => { for (const key of ['text', 'at', 'staff', 'tag']) assert.equal(entry[key], input[index][key]); });
  output = memos.pinMemoEntry(output, 'c', false);
  assert.deepEqual(clone(memos.visibleMemoEntries(output).map(entry => entry.id)), ['b', 'a', 'c']);
  assert.equal(output[3], input[3]);
});

test('ambiguous IDs and stale/incomplete drag payloads do not mutate legacy rows', () => {
  const duplicate = freeze([row('dup'), row('dup')]);
  for (const result of [memos.editMemoEntry(duplicate, 'dup', 'bad', audit), memos.deleteMemoEntry(duplicate, 'dup', audit), memos.pinMemoEntry(duplicate, 'dup', true)]) assert.deepEqual(clone(result), clone(duplicate));
  const input = freeze([row('a', { pinned: true, pinOrder: 1 }), row('b', { pinned: true, pinOrder: 0 })]);
  for (const ids of [['a'], ['a', 'a'], ['a', 'missing']]) assert.deepEqual(clone(memos.reorderPinnedMemos(input, ids)), clone(input));
  assert.deepEqual(clone(memos.editMemoEntry(input, 'missing', 'bad', audit)), clone(input));
  assert.deepEqual(clone(memos.visibleMemoEntries(undefined)), []);
  assert.deepEqual(clone(memos.activeMemoEntries(null)), []);
});

test('deleted contacts cannot clear daily/periodic warnings; pins do not change contact counts', () => {
  const input = [row('answer', { tag: '재통화', deletedAt: at }), row('absence', { tag: '부재중' }), row('gone', { tag: '부재중', deletedAt: at })];
  assert.deepEqual(clone(calls.checkCallWarning(input, '2026-10-18', 2)), { active: true, noAnswerCountToday: 1, reachedToday: false, threshold: 2 });
  const pinned = memos.pinMemoEntry(input, 'absence', true);
  assert.deepEqual(clone(calls.checkCallWarning(pinned, '2026-10-18')), clone(calls.checkCallWarning(input, '2026-10-18')));
  assert.equal(calls.checkCallWarning(memos.restoreMemoEntry(input, 'answer'), '2026-10-18').active, false);
  assert.equal(calls.checkPeriodicContactWarning(input.filter(entry => entry.deletedAt), '2026-10-18').active, true);
  const prior = [row('prior', { at: '2026-10-10T02:00:00Z' }), row('new', { deletedAt: at })];
  assert.equal(calls.checkPeriodicContactWarning(prior, '2026-10-18').lastContactDate, '2026-10-10');
});

test('search, completion and PDF exclude deleted text and old edit history while PDF uses pin display order', () => {
  const log = [row('gone', { text: 'DELETED_ONLY', deletedAt: at }), row('active', { text: 'CURRENT_ONLY', editHistory: [{ text: 'OLD_EDIT_ONLY', ...audit }] }), row('pin', { pinned: true, pinOrder: 0 })];
  const lead = { id: 'lead', name: '합성 고객', phone: '000', status: '신규접수', assignedStaff: '담당자', consultation: { memoLog: log } };
  const index = buildLeadSearchIndex([lead], []).get(lead).text;
  assert.match(index, /current_only/); assert.doesNotMatch(index, /deleted_only|old_edit_only/);
  const snapshot = { consultation: lead.consultation, exportedAt: at };
  const sections = consultationPdfSections(snapshot), memoSection = sections.find(section => section.title.startsWith('상담 메모'));
  assert.equal(memoSection.title, '상담 메모 (2건)');
  assert.match(memoSection.rows[0][0], /고정/); assert.equal(memoSection.rows[0][1], '합성 메모 pin');
  assert.doesNotMatch(JSON.stringify(sections), /DELETED_ONLY|OLD_EDIT_ONLY/);
  const empty = calls.getConsultationCompletionStats(undefined, {});
  assert.equal(calls.getConsultationCompletionStats(undefined, { memoLog: [log[0]] }).filledCount, empty.filledCount);
  assert.equal(calls.getConsultationCompletionStats(undefined, { memoLog: [log[1]] }).filledCount, empty.filledCount + 1);
});

test('performance excludes tombstoned contact events while all DB/contract/receipt metrics stay unchanged', () => {
  const log = [row('live', { tag: '부재중' }), row('gone', { tag: '재통화', deletedAt: at }), row('old', { at: '2026-09-10T00:00:00Z', deletedAt: at })];
  const input = { leads: [{ id: 'lead', name: '합성', assignedStaff: '담당자', receivedAt: at, status: '신규접수', consultation: { memoLog: log } }], cases: [], clients: [], installments: [] };
  const report = data => buildFirmPerformanceReport(data, '2026-10-01', '2026-10-31', { firmId: 'synthetic', firmName: '합성 로펌' }, undefined, new Date(at));
  const before = JSON.stringify(input), actual = report(freeze(input));
  const filtered = report({ ...input, leads: [{ ...input.leads[0], consultation: { memoLog: [log[0]] } }] });
  assert.equal(actual.summary.contacts, 1); assert.equal(actual.previous.contacts, 0);
  assert.deepEqual(clone(actual), clone(filtered)); assert.equal(JSON.stringify(input), before);
});

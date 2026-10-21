const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), runtime = path.resolve(root, '../store-test-runtime/node_modules');
const React = require(path.join(runtime, 'react')), Renderer = require(path.join(runtime, 'react-test-renderer')), { act } = Renderer;
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node ? text(node.children) : '';
// Reuse the existing isolated real ConsultationModal harness, not its test suite.
const file = ts.createSourceFile('fixture.js', fs.readFileSync(path.join(__dirname, 'consultation-pdf-ui.test.cjs'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'harness');
const harness = vm.runInNewContext(`(${fn.getText(file).replace("console }, { filename:", "console, Error }, { filename:")})`, { fs, path, vm, ts, root, React, Renderer, act, text, Date, structuredClone, Blob, setTimeout, clearTimeout, console, Error });
const save = h => h.tree.root.findAllByType('button').find(node => text(node) === '저장');

test('edited phone is draft-protected, included in PDF snapshot, and passed on successful save', async () => {
  let closed = 0;
  const h = harness({ props: { allowPhoneEdit: true, onClose: () => closed++ } }); await h.mount();
  try {
    await act(async () => h.captures.BasicInfoSection.onPhoneChange(' 010-2222-3333 ')); h.flushDraft();
    assert.equal(JSON.parse(h.storage.get('lawpower:consultation-draft:v1:synthetic-one')).customerPhone, ' 010-2222-3333 ');
    await act(async () => h.button().props.onClick());
    assert.equal(h.snapshots[0].phone, '010-2222-3333'); assert.equal(h.snapshots[0].hasUnsavedChanges, true); assert.equal(h.saved.length, 0);
    await act(async () => save(h).props.onClick());
    assert.equal(h.saved[0][2], '010-2222-3333'); assert.equal(closed, 1); assert.equal(h.storage.size, 0);
  } finally { h.close(); }
});

test('invalid phone blocks save; server failure retains entered phone and local recovery', async () => {
  const attempts = []; let closed = 0;
  const h = harness({ props: { allowPhoneEdit: true, onClose: () => closed++, onSave: (...args) => { attempts.push(args); return false; } } }); await h.mount();
  try {
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('')); await act(async () => save(h).props.onClick());
    assert.equal(attempts.length, 0); assert.match(text(h.tree.toJSON()), /연락처는 비워둘/);
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('010-4444-5555')); h.flushDraft();
    await act(async () => save(h).props.onClick()); assert.equal(attempts[0][2], '010-4444-5555'); assert.equal(closed, 0);
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-4444-5555'); assert.equal(h.storage.size, 1);
    await h.update({ open: false }); await h.update({ open: true });
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-4444-5555'); assert.match(text(h.tree.toJSON()), /임시본을 자동 복구/);
  } finally { h.close(); }
});

test('readonly/no-basic-permission modes never expose or submit an editable phone', async () => {
  const h = harness(); await h.mount();
  try {
    assert.equal(h.captures.BasicInfoSection.allowPhoneEdit, false);
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('010-9999-9999'));
    await act(async () => save(h).props.onClick()); assert.equal(h.saved[0][2], undefined);
    await h.update({ readOnly: true, allowPhoneEdit: true });
    assert.equal(h.captures.BasicInfoSection.allowPhoneEdit, false); assert.equal(h.captures.BasicInfoSection.displayPhone, '000-0000-0000');
    await act(async () => h.button().props.onClick()); assert.equal(h.snapshots[0].phone, '000-0000-0000');
  } finally { h.close(); }
});

test('customer switch resets phone and legacy drafts without a phone use the current stored phone', async () => {
  const h = harness({ props: { allowPhoneEdit: true } }); await h.mount();
  try {
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('010-1111-2222')); h.flushDraft();
    h.storage.set('lawpower:consultation-draft:v1:synthetic-two', JSON.stringify({ version: 1, resetKey: 'synthetic-two', updatedAt: new Date().toISOString(), consultation: { personal: { basicIncomeNote: '오래된 임시본' } } }));
    await h.update({ resetKey: 'synthetic-two', displayPhone: '010-5555-6666' });
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-5555-6666');
    await act(async () => h.button().props.onClick()); assert.equal(h.snapshots[0].phone, '010-5555-6666');
    await h.update({ displayPhone: '010-7777-8888' });
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-7777-8888', 'untouched phone follows the latest stored value');
  } finally { h.close(); }
});


test('unrelated consultation saves and reverted phone edits never overwrite a realtime phone correction', async () => {
  const h = harness({ props: { allowPhoneEdit: true } }); await h.mount();
  try {
    await act(async () => h.captures.BasicInfoSection.patchPersonal({ basicIncomeNote: 'unrelated edit' }));
    await h.update({ displayPhone: '010-2222-3333' }); h.flushDraft();
    const stored = JSON.parse(h.storage.get('lawpower:consultation-draft:v1:synthetic-one'));
    assert.equal(stored.customerPhone, undefined);
    await act(async () => h.button().props.onClick()); assert.equal(h.snapshots[0].phone, '010-2222-3333');
    await act(async () => save(h).props.onClick()); assert.equal(h.saved[0][2], undefined);
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('010-9999-8888'));
    await h.update({ displayPhone: '010-4444-5555' });
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-9999-8888', 'intentional edit remains intact');
    await act(async () => h.captures.BasicInfoSection.onPhoneChange('010-2222-3333'));
    assert.equal(h.captures.BasicInfoSection.displayPhone, '010-4444-5555', 'reverting restores latest server value');
    await act(async () => save(h).props.onClick()); assert.equal(h.saved[1][2], undefined);
  } finally { h.close(); }
});

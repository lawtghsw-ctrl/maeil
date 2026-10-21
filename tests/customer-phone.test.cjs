const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const moduleUnderTest = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/customer-phone.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(`(function(module,exports){${source}})`, { Error })(moduleUnderTest, moduleUnderTest.exports);
const { changedCustomerPhone } = moduleUnderTest.exports;
test('phone edits retain leading zeros, country code and familiar formatting', () => {
  for (const phone of ['010-1234-5678', '02-123-4567', '031.123.4567', '+82 10 1234 5678', '+1 (212) 555-0199', '15881234']) {
    assert.equal(changedCustomerPhone('01000000000', `  ${phone}  `, true), phone);
  }
});
test('phone validation rejects deletion, letters, misplaced country code and unreasonable digit counts', () => {
  for (const phone of ['', ' ', '1234567', '+1234567890123456', '010-ABCD-5678', '010+12345678', '<script>01012345678</script>', '010\n12345678']) {
    assert.throws(() => changedCustomerPhone('01000000000', phone, true));
  }
});
test('unchanged legacy data and non-editor callers cannot produce a phone patch', () => {
  assert.equal(changedCustomerPhone('legacy unknown', 'legacy unknown', true), undefined);
  assert.equal(changedCustomerPhone('010-1234-5678', ' 010-1234-5678 ', true), undefined);
  assert.equal(changedCustomerPhone('010-1234-5678', '', false), undefined);
  assert.equal(changedCustomerPhone('010-1234-5678', '010-7777-8888', false), undefined);
});

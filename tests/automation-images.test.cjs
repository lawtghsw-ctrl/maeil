const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const filename = path.join(__dirname, '../lib/sms/automation-images.ts');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
vm.runInNewContext(`(function(module,exports){${output}\n})`, { Error, Uint8Array })(moduleUnderTest, moduleUnderTest.exports);
const { validateAutomationImageFiles: validate, AUTOMATION_IMAGE_LIMIT_BYTES: limit, MAX_AUTOMATION_IMAGES } = moduleUnderTest.exports;
const jpeg = Buffer.from([255, 216, 255, 255, 217]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const gif = Buffer.from([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]);
const file = (bytes = jpeg, name = 'image.jpg', type = 'image/jpeg') => new File([bytes], name, { type });

test('accepts JPEG, PNG, GIF and empty removal lists without changing the files', async () => {
  assert.equal(MAX_AUTOMATION_IMAGES, 3); assert.equal(limit, 2 * 1024 * 1024);
  await validate([]);
  const files = [file(), file(png, '한글 그림.PNG', 'image/png'), file(gif, 'image.gif', 'image/gif')];
  await validate(files);
  assert.equal(files.length, 3);
  await validate([file(jpeg, 'PHOTO.JPEG', '')]);
  const gif87a = Buffer.from(gif); gif87a[4] = 55;
  await validate([file(gif87a, 'legacy.gif', 'image/gif')]);
});

test('rejects four images instead of silently truncating and reads no bytes for invalid metadata', async () => {
  let reads = 0;
  const fake = { name: 'image.jpg', type: 'image/jpeg', size: 5, arrayBuffer: async () => { reads++; return jpeg; } };
  await assert.rejects(validate([fake, fake, fake, fake]), /최대 3개/);
  await assert.rejects(validate([{ ...fake, size: limit + 1 }]), /총 용량/);
  await assert.rejects(validate([{ ...fake, size: 0 }]), /JPEG/);
  await assert.rejects(validate([{ ...fake, name: 'picture.webp', type: 'image/webp' }]), /JPEG/);
  assert.equal(reads, 0);
});

test('enforces the total 2 MiB boundary, not a per-file limit', async () => {
  const bytes = Buffer.alloc(limit); jpeg.copy(bytes); bytes[limit - 2] = 255; bytes[limit - 1] = 217;
  await validate([file(bytes)]);
  await assert.rejects(validate([file(bytes), file()]), /총 용량/);
  const half = Buffer.alloc(limit / 2 + 1); jpeg.copy(half); half[half.length - 2] = 255; half[half.length - 1] = 217;
  await assert.rejects(validate([file(half), file(half)]), /총 용량/);
});

test('rejects MIME spoofing, wrong extensions, empty images and truncated header/trailer bytes', async () => {
  const invalid = [
    file(Buffer.from('<svg/>')), file(jpeg, 'image.png', 'image/png'), file(png),
    file(jpeg, 'image.jpg', 'image/png'), file(jpeg, 'image.jpg', 'text/plain'),
    file(jpeg, 'image.jpg.exe'), file(Buffer.alloc(0)),
    file(jpeg.subarray(0, -1)), file(png.subarray(1), 'x.png', 'image/png'),
    file(png.subarray(0, -1), 'x.png', 'image/png'),
    file(gif.subarray(0, -1), 'x.gif', 'image/gif'),
  ];
  for (const image of invalid) await assert.rejects(validate([image]), /형식|JPEG/);
});

test('unreadable and inconsistent files are rejected without partial acceptance', async () => {
  await assert.rejects(validate([file(), {
    name: 'missing.jpg', type: 'image/jpeg', size: 5,
    arrayBuffer: async () => { throw new Error('unavailable'); },
  }]), /읽지 못했습니다/);
  await assert.rejects(validate([{ name: 'short.jpg', type: 'image/jpeg', size: 6, arrayBuffer: async () => jpeg }]), /실제 형식/);
});

test('byte-signature acceptance agrees with the actual relay validator for all supported formats', async () => {
  const { validateImages } = await import(pathToFileURL(path.join(__dirname, '../services/sms-relay/src/validation.mjs')).href);
  for (const [bytes, extension, type] of [[jpeg, 'jpg', 'image/jpeg'], [png, 'png', 'image/png'], [gif, 'gif', 'image/gif']]) {
    for (let index = 0; index < bytes.length; index++) {
      const changed = Buffer.from(bytes); changed[index] ^= 255;
      const image = { filename: `test.${extension}`, contentType: type, base64: changed.toString('base64') };
      let relayAccepts = true;
      try { validateImages([image], 'MMS'); } catch { relayAccepts = false; }
      let clientAccepts = true;
      try { await validate([file(changed, image.filename, type)]); } catch { clientAccepts = false; }
      assert.equal(clientAccepts, relayAccepts, `${extension}, mutated byte ${index}`);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { countEucKrBytes, validateMessage, validateImages, IMAGE_LIMIT_BYTES, ValidationError } from '../src/validation.mjs';

const jpeg = bytes => ({ filename: 'photo.jpg', contentType: 'image/jpeg', base64: bytes.toString('base64') });
test('EUC-KR counts Korean two bytes and ASCII one, with exact provider boundaries', () => {
  assert.equal(countEucKrBytes('가나다 ABC\n'), 11);
  assert.deepEqual(validateMessage('가'.repeat(45), 'SMS'), { messageBytes: 90, titleBytes: 0 });
  validateMessage('A'.repeat(90), 'SMS'); validateMessage('한'.repeat(1000), 'LMS', '제'.repeat(22));
  for (const call of [() => validateMessage('한'.repeat(46), 'SMS'), () => validateMessage('A'.repeat(2001), 'LMS'), () => validateMessage('x', 'MMS', '제'.repeat(23)), () => validateMessage('x', 'SMS', '제목')]) assert.throws(call, ValidationError);
});
test('unencodable emoji, isolated surrogate, controls, empty and invalid types fail without replacement', () => {
  for (const message of ['', '   ', '\u0000', '\u001b', '\u007f', '😀', '\ud800', '힣', '똠']) assert.throws(() => validateMessage(message, 'SMS'), ValidationError);
  for (const type of ['sms', '', 'EMAIL', null]) assert.throws(() => validateMessage('valid', type), ValidationError);
  assert.throws(() => validateMessage('valid', 'LMS', null), ValidationError);
});
test('JPEG, PNG and GIF remain supported with bounded canonical bytes', () => {
  const jpg = jpeg(Buffer.from([255, 216, 255, 0, 255, 217]));
  const png = { filename: 'photo.png', contentType: 'image/png', base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]).toString('base64') };
  const gif = { filename: 'photo.gif', contentType: 'image/gif', base64: Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(7), Buffer.from([59])]).toString('base64') };
  assert.equal(validateImages([jpg, png, gif], 'MMS').length, 3);
  assert.deepEqual(validateImages(undefined, 'SMS'), []);
  const max = Buffer.alloc(IMAGE_LIMIT_BYTES); max.set([255, 216, 255]); max.set([255, 217], max.length - 2);
  assert.equal(validateImages([jpeg(max)], 'MMS')[0].bytes.length, IMAGE_LIMIT_BYTES);
  for (const images of [[], [jpg, jpg, jpg, jpg], [{ ...jpg, filename: '../photo.jpg' }], [{ ...jpg, filename: 'photo.png' }], [{ ...jpg, contentType: 'image/svg+xml' }], [{ ...jpg, extra: true }], [{ ...jpg, base64: jpg.base64 + '\n' }], [{ ...jpg, base64: 'AAAA' }], [jpeg(max), jpg]]) assert.throws(() => validateImages(images, 'MMS'), ValidationError);
  assert.throws(() => validateImages([jpg], 'SMS'), ValidationError);
});

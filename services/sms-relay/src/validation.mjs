// Pure message validation shared with the app's server-side submission code.
// This file never imports the relay server, SQLite, credentials, or transport.
export const LIVE_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
export const IMAGE_LIMIT_BYTES = 2 * 1024 * 1024;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ValidationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
let koreanCharacters;
function supportedCharacters() {
  if (koreanCharacters) return koreanCharacters;
  const characters = new Set();
  const decoder = new TextDecoder('euc-kr', { fatal: true });
  const pair = new Uint8Array(2);
  // WHATWG's decoder also knows Windows-949. Restrict the byte range to
  // KS X 1001 so this matches PostgreSQL convert_to(text, 'EUC_KR').
  for (let lead = 0xa1; lead <= 0xfe; lead++) {
    pair[0] = lead;
    for (let trail = 0xa1; trail <= 0xfe; trail++) {
      pair[1] = trail;
      try {
        const character = decoder.decode(pair);
        if ([...character].length === 1 && character.codePointAt(0) > 0x7f) characters.add(character);
      } catch { /* Undefined byte pairs are not encodable. */ }
    }
  }
  koreanCharacters = characters;
  return characters;
}
export function countEucKrBytes(text) {
  if (typeof text !== 'string') throw new ValidationError('INVALID_MESSAGE');
  let bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    if ((point < 0x20 && ![9, 10, 13].includes(point)) || point === 0x7f) throw new ValidationError('MESSAGE_CONTROL_CHARACTER');
    if (point <= 0x7f) bytes++;
    else if (supportedCharacters().has(character)) bytes += 2;
    else throw new ValidationError('MESSAGE_UNSUPPORTED_CHARACTER');
  }
  return bytes;
}
export function validateMessage(message, msgType, title = '') {
  if (!['SMS', 'LMS', 'MMS'].includes(msgType) || typeof message !== 'string' || !message.trim() || message.length > 2000) throw new ValidationError('INVALID_MESSAGE');
  const messageBytes = countEucKrBytes(message);
  if (messageBytes > (msgType === 'SMS' ? 90 : 2000)) throw new ValidationError('MESSAGE_TOO_LONG');
  if (typeof title !== 'string' || title.length > 44 || (msgType === 'SMS' && title !== '')) throw new ValidationError('INVALID_TITLE');
  const titleBytes = countEucKrBytes(title);
  if (titleBytes > 44) throw new ValidationError('TITLE_TOO_LONG');
  return { messageBytes, titleBytes };
}
export function validateImages(images, msgType) {
  if (images === undefined) images = [];
  if (!Array.isArray(images) || images.length > 3 || (msgType !== 'MMS' && images.length) || (msgType === 'MMS' && !images.length)) throw new ValidationError('INVALID_IMAGES');
  let total = 0;
  return images.map((image) => {
    if (!image || typeof image !== 'object' || Array.isArray(image) || Object.keys(image).length !== 3 ||
      !Object.hasOwn(image, 'filename') || !Object.hasOwn(image, 'contentType') || !Object.hasOwn(image, 'base64') ||
      typeof image.filename !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(image.filename) ||
      typeof image.base64 !== 'string' || !image.base64 || image.base64.length > Math.ceil(IMAGE_LIMIT_BYTES / 3) * 4 ||
      image.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.base64)) throw new ValidationError('INVALID_IMAGE');
    const bytes = Buffer.from(image.base64, 'base64');
    if (bytes.toString('base64') !== image.base64) throw new ValidationError('INVALID_IMAGE');
    total += bytes.length;
    if (total > IMAGE_LIMIT_BYTES) throw new ValidationError('IMAGES_TOO_LARGE');
    const jpeg = image.contentType === 'image/jpeg' && /\.jpe?g$/i.test(image.filename) && bytes.length >= 5 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
    const png = image.contentType === 'image/png' && /\.png$/i.test(image.filename) && bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]));
    const gif = image.contentType === 'image/gif' && /\.gif$/i.test(image.filename) && bytes.length >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) && bytes.at(-1) === 0x3b;
    if (!jpeg && !png && !gif) throw new ValidationError('INVALID_IMAGE_FORMAT');
    return { filename: image.filename, contentType: image.contentType, base64: image.base64, bytes };
  });
}

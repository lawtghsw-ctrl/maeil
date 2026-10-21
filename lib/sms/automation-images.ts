/** Client-side checks mirror the relay's image signatures without importing Node APIs. */
export const MAX_AUTOMATION_IMAGES = 3;
export const AUTOMATION_IMAGE_LIMIT_BYTES = 2 * 1024 * 1024;
export const AUTOMATION_IMAGE_ACCEPT = "image/jpeg,image/png,image/gif";

type ImageType = "image/jpeg" | "image/png" | "image/gif";

function imageType(file: File): ImageType | null {
  const extension = /\.(jpe?g|png|gif)$/i.exec(file.name)?.[1].toLowerCase();
  const type = extension === "jpg" || extension === "jpeg" ? "image/jpeg"
    : extension === "png" ? "image/png" : extension === "gif" ? "image/gif" : null;
  // Some OS file choosers omit MIME. The extension and actual bytes still have to agree.
  return type && (!file.type || file.type === type) ? type : null;
}

function matches(bytes: Uint8Array, expected: readonly number[], offset: number) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function validSignature(bytes: Uint8Array, type: ImageType) {
  if (type === "image/jpeg") return bytes.length >= 5
    && matches(bytes, [255, 216, 255], 0) && matches(bytes, [255, 217], bytes.length - 2);
  if (type === "image/png") return bytes.length >= 20
    && matches(bytes, [137, 80, 78, 71, 13, 10, 26, 10], 0)
    && matches(bytes, [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130], bytes.length - 12);
  return bytes.length >= 14
    && (matches(bytes, [71, 73, 70, 56, 55, 97], 0) || matches(bytes, [71, 73, 70, 56, 57, 97], 0))
    && bytes[bytes.length - 1] === 59;
}

/** Validate a complete replacement selection. A bad file rejects the whole selection. */
export async function validateAutomationImageFiles(files: readonly File[]): Promise<void> {
  if (files.length > MAX_AUTOMATION_IMAGES) throw new Error("첨부 이미지는 최대 3개까지 선택할 수 있습니다.");
  if (files.reduce((total, file) => total + file.size, 0) > AUTOMATION_IMAGE_LIMIT_BYTES) {
    throw new Error("첨부 이미지의 총 용량은 2MB 이하여야 합니다.");
  }
  const types = files.map((file) => {
    const type = imageType(file);
    if (!type || !Number.isFinite(file.size) || file.size <= 0) {
      throw new Error("JPEG·PNG·GIF 이미지 파일만 사용할 수 있습니다. 파일 형식과 확장자를 확인해주세요.");
    }
    return type;
  });
  await Promise.all(files.map(async (file, index) => {
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { throw new Error("이미지 파일을 읽지 못했습니다. 다시 선택해주세요."); }
    if (bytes.byteLength !== file.size || !validSignature(bytes, types[index])) {
      throw new Error("이미지의 실제 형식이 올바르지 않습니다. 정상적인 JPEG·PNG·GIF 파일을 선택해주세요.");
    }
  }));
}

// Keep the user's familiar separators; never silently change a country code or
// leading zero. Validation applies only when a phone number is actually edited,
// so legacy imported values do not prevent unrelated consultation saves.
export function changedCustomerPhone(original: string, draft: string, canEdit: boolean): string | undefined {
  if (!canEdit) return undefined;
  const phone = draft.trim();
  if (phone === original.trim()) return undefined;
  if (!phone) throw new Error("고객 연락처는 비워둘 수 없습니다.");
  const digits = phone.replace(/[^0-9]/g, "");
  if (phone.length > 40 || !/^\+?[0-9][0-9 ().-]*$/.test(phone) || digits.length < 8 || digits.length > 15) {
    throw new Error("연락처는 숫자 8~15자리로 입력해주세요. 국가번호(+), 공백, 괄호, 점, 하이픈을 사용할 수 있습니다.");
  }
  return phone;
}

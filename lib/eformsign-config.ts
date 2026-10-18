export const MAEIL_ESIGN_FIRM_ID = "0a5900a4-48b3-4503-8c9b-3979c7d2d95c";
export const ESIGN_FIELD_LABELS = { name: "이름", address: "주소", residentNumber: "주민번호", phone: "전화번호", creditorCount: "채권자", fee: "보수", month: "월", day: "일", signerName: "갑_이름" } as const;
export type EsignField = keyof typeof ESIGN_FIELD_LABELS;
export interface EsignTemplate {
  caseType: string; templateId: string; documentName: string;
  fixedYear: number | null; yearField: string;
  fields: Record<EsignField, string>;
}
export interface FirmEsignConfig {
  lawFirmId: string; connectionId: string | null; source: "connection" | "legacy_env";
  apiKey: string; privateKey: string; memberId: string; senderMemberId: string;
  companyId: string; templates: EsignTemplate[];
}
export interface FirmEsignView {
  connectionId: string | null;
  lawFirmId: string; canManage: boolean; configured: boolean; source: "connection" | "legacy_env" | "none";
  companyId: string; templates: EsignTemplate[]; updatedAt: string | null;
  presence: { apiKey: boolean; privateKey: boolean; memberId: boolean; senderMemberId: boolean };
}
export function defaultEsignTemplate(templateId = ""): EsignTemplate {
  return { caseType: "개인회생", templateId, documentName: "사건위임약정서(개인회생)", fixedYear: 2026, yearField: "", fields: { ...ESIGN_FIELD_LABELS } };
}
export function validateEsignTemplates(raw: unknown): EsignTemplate[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) throw new Error("전자계약 템플릿은 1개 이상 20개 이하로 등록해주세요.");
  const seen = new Set<string>();
  return raw.map(value => {
    const v = value && typeof value === "object" ? value : {};
    const caseType = String(v.caseType || "").trim(), templateId = String(v.templateId || "").trim(), documentName = String(v.documentName || "").trim();
    if (!caseType || caseType.length > 100 || seen.has(caseType) || !/^[\w-]{1,128}$/.test(templateId) || !documentName || documentName.length > 200) throw new Error("사건유형·템플릿 ID·문서명을 확인해주세요. 같은 사건유형은 중복할 수 없습니다.");
    seen.add(caseType);
    const yearField = String(v.yearField || "").trim();
    const fixedYear = v.fixedYear === null || v.fixedYear === "" ? null : Number(v.fixedYear);
    if (fixedYear !== null && (!Number.isInteger(fixedYear) || fixedYear < 2000 || fixedYear > 2100)) throw new Error("고정 계약연도는 2000~2100 사이로 입력해주세요.");
    if (yearField.length > 100 || (fixedYear === null && !yearField)) throw new Error("템플릿의 고정연도 또는 연도 입력항목을 지정해주세요.");
    const fields = {} as Record<EsignField, string>;
    for (const key of Object.keys(ESIGN_FIELD_LABELS) as EsignField[]) {
      const id = String(v.fields?.[key] || "").trim();
      if (!id || id.length > 100) throw new Error(`${ESIGN_FIELD_LABELS[key]} 입력항목 ID를 확인해주세요.`);
      fields[key] = id;
    }
    const ids = Object.values(fields).concat(yearField ? [yearField] : []);
    if (new Set(ids).size !== ids.length) throw new Error("템플릿 입력항목 ID가 중복되었습니다.");
    return { caseType, templateId, documentName, fixedYear, yearField, fields };
  });
}

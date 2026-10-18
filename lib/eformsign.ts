import { createPrivateKey, sign } from "crypto";
import type { EsignTemplate, FirmEsignConfig } from "@/lib/eformsign-config";

export type EformsignAccess = {
  accessToken: string;
  apiUrl: string;
  memberId: string;
  companyId?: string;
};

export type EformsignCreateInput = {
  name: string;
  address: string;
  residentNumber: string;
  phone: string;
  creditorCount: string;
  fee: string;
  contractDate: string;
  signerName: string;
  message: string;
};

function privateKeyFromConfig(value: string) {
  const raw = value.replace(/\\n/g, "\n").trim();
  if (raw.includes("BEGIN")) return createPrivateKey(raw);

  const hex = raw.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("EFORMSIGN_PRIVATE_KEY 형식이 올바르지 않습니다.");
  }
  return createPrivateKey({
    key: Buffer.from(hex, "hex"),
    format: "der",
    type: "pkcs8",
  });
}

function signatureFor(executionTime: number, privateKey: string) {
  return sign(
    "sha256",
    Buffer.from(String(executionTime), "utf8"),
    { key: privateKeyFromConfig(privateKey), dsaEncoding: "der" }
  ).toString("hex");
}

function providerOrigin(value: string) {
  let url: URL; try { url = new URL(value); } catch { throw new Error("이폼사인 API 주소를 확인하지 못했습니다."); }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".eformsign.com") || url.port || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("허용되지 않은 이폼사인 API 주소입니다.");
  return url.origin;
}
async function providerFetch(url: string, init: RequestInit) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, cache: "no-store", redirect: "error", signal: controller.signal });
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let length = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 1_048_576) { await reader.cancel(); throw new Error("Response too large"); }
      chunks.push(value);
    }
    let body: any = {}; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Invalid provider JSON is handled as a failed response below. */ }
    return { ok: response.ok, status: response.status, body };
  }
  catch { throw new Error("이폼사인 응답을 확인하지 못했습니다. 발송 요청 후에는 결과 확인 전 재발송하지 마세요."); }
  finally { clearTimeout(timer); }
}
async function requestToken(memberId: string, config: FirmEsignConfig): Promise<EformsignAccess> {
  const apiKey = config.apiKey;
  const executionTime = Date.now();
  let signature: string; try { signature = signatureFor(executionTime, config.privateKey); } catch { throw new Error("이폼사인 서명키 형식을 확인해주세요."); }

  const response = await providerFetch("https://service.eformsign.com/v2.0/api_auth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Buffer.from(apiKey, "utf8").toString("base64")}`,
      eformsign_signature: signature,
    },
    body: JSON.stringify({ execution_time: executionTime, member_id: memberId }),
    cache: "no-store",
  });

  const body = response.body;
  const accessToken = String(body?.oauth_token?.access_token || "").trim();
  const apiUrl = String(body?.api_key?.company?.api_url || "").trim().replace(/\/+$/, "");
  if (!response.ok || !accessToken || !apiUrl) {
    throw new Error(`이폼사인 인증에 실패했습니다. 계정·API 키·서명키·멤버 권한을 확인해주세요. (HTTP ${response.status})`);
  }
  const companyId = String(body?.api_key?.company?.company_id || "").trim();
  if (config.companyId && companyId !== config.companyId) throw new Error("이폼사인 응답 회사가 이 로펌에 등록한 회사와 다릅니다.");

  return {
    accessToken,
    apiUrl: providerOrigin(apiUrl),
    memberId,
    companyId: companyId || undefined,
  };
}

export async function getEformsignAccess(config: FirmEsignConfig): Promise<EformsignAccess> {
  const primary = config.senderMemberId?.trim();
  const fallback = config.memberId?.trim();
  if (!config.apiKey || !config.privateKey || !fallback) throw new Error("이 로펌의 이폼사인 연결정보가 부족합니다.");
  const candidates = [...new Set([primary, fallback].filter(Boolean) as string[])];
  let lastError: unknown;

  for (const memberId of candidates) {
    try {
      return await requestToken(memberId, config);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("이폼사인 인증에 실패했습니다.");
}

function localPhone(value: string) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  if (!digits.startsWith("0")) throw new Error("전화번호 형식을 확인해주세요.");
  return digits;
}

function moneyText(value: string) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[\s,원]/g, "");
  if (/^\d+$/.test(digits)) return Number(digits).toLocaleString("ko-KR");
  return raw;
}

function dateParts(isoDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  const time = Date.parse(String(isoDate || "").trim());
  if (!match || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== match[0]) throw new Error("계약일 형식을 확인해주세요.");
  return { year: Number(match[1]), month: String(Number(match[2])), day: String(Number(match[3])) };
}

export function eformsignStatusLabel(code: string) {
  const map: Record<string, string> = {
    "001": "초안",
    "002": "문서 작성",
    "003": "서명완료",
    "010": "결재 요청",
    "011": "결재 반려",
    "012": "결재 승인",
    "013": "결재 취소",
    "020": "내부자 요청",
    "021": "내부자 반려",
    "022": "내부자 승인",
    "030": "외부자 요청",
    "031": "외부자 반려",
    "032": "외부자 승인",
    "040": "취소 요청",
    "042": "취소",
    "043": "문서 수정",
    "045": "반려 요청",
    "047": "삭제 요청",
    "049": "삭제",
    "060": "서명 요청",
    "061": "참여자 반려",
    "062": "참여자 승인",
    "070": "검토 요청",
    "071": "검토 반려",
    "072": "검토 승인",
    doc_tempsave: "초안",
    doc_create: "문서 작성",
    doc_complete: "서명완료",
    doc_request_participant: "서명 요청",
    doc_accept_participant: "참여자 승인",
    doc_reject_participant: "참여자 반려",
    doc_revoke: "취소",
  };
  return map[code] || code || "상태 미확인";
}

export async function getEformsignDocumentStatus(access: EformsignAccess, documentId: string) {
  const response = await providerFetch(
    `${providerOrigin(access.apiUrl)}/v2.0/api/documents/${encodeURIComponent(documentId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access.accessToken}`,
      },
      cache: "no-store",
    }
  );
  const body = response.body;
  if (!response.ok) {
    throw new Error(`이폼사인 문서상태를 조회하지 못했습니다. 문서와 계정 권한을 확인해주세요. (HTTP ${response.status})`);
  }
  const statusCode = String(body?.current_status?.status_type || "").trim();
  return { statusCode, status: eformsignStatusLabel(statusCode), raw: body };
}

export function buildEformsignPayload(input: EformsignCreateInput, template: EsignTemplate) {
  if (!template.templateId) throw new Error("이 로펌의 전자계약 템플릿이 등록되지 않았습니다.");
  const date = dateParts(input.contractDate);

  // 현재 템플릿의 연도(2026)는 문서 본문에 고정되어 있고 API 입력항목은 월/일만 존재합니다.
  if (template.fixedYear !== null && date.year !== template.fixedYear) {
    throw new Error(`현재 이폼사인 템플릿의 계약연도는 ${template.fixedYear}으로 고정되어 있습니다. 템플릿 연도 수정 후 발송해주세요.`);
  }

  const payload = {
    document: {
      document_name: `${template.documentName} - ${input.name}`,
      comment: input.message || "계약서 확인 후 서명 부탁드립니다.",
      recipients: [
        {
          step_type: "05",
          use_mail: false,
          use_sms: true,
          member: {
            name: input.name,
            sms: {
              country_code: "+82",
              phone_number: localPhone(input.phone),
            },
          },
          auth: {
            valid: { day: 7, hour: 0 },
          },
        },
      ],
      fields: [
        { id: template.fields.name, value: input.name },
        { id: template.fields.address, value: input.address },
        { id: template.fields.residentNumber, value: input.residentNumber },
        { id: template.fields.phone, value: input.phone },
        { id: template.fields.creditorCount, value: input.creditorCount },
        { id: template.fields.fee, value: moneyText(input.fee) },
        { id: template.fields.month, value: date.month },
        { id: template.fields.day, value: date.day },
        { id: template.fields.signerName, value: input.signerName },
        ...(template.yearField ? [{ id: template.yearField, value: String(date.year) }] : []),
      ],
      select_group_name: "",
      notification: [],
    },
  };
  return payload;
}

export async function createEformsignDocument(input: EformsignCreateInput, config: FirmEsignConfig, template: EsignTemplate, existingAccess?: EformsignAccess) {
  const payload = buildEformsignPayload(input, template);
  const access = existingAccess || await getEformsignAccess(config);

  const response = await providerFetch(
    `${providerOrigin(access.apiUrl)}/v2.0/api/documents?template_id=${encodeURIComponent(template.templateId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access.accessToken}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    }
  );
  const body = response.body;
  if (!response.ok) {
    throw new Error(`이폼사인 문서 발송 응답을 확인해주세요. (HTTP ${response.status})`);
  }

  const documentId = String(body?.document?.id || body?.document_id || body?.id || "").trim();
  if (!documentId) throw new Error("이폼사인 응답에서 document_id를 확인하지 못했습니다.");

  let statusCode = "060";
  let status = eformsignStatusLabel(statusCode);
  try {
    const checked = await getEformsignDocumentStatus(access, documentId);
    statusCode = checked.statusCode || statusCode;
    status = checked.status || status;
  } catch {
    // 발송 자체가 성공했다면 상태조회 일시 실패 때문에 발송 성공을 되돌리지 않습니다.
  }

  return { documentId, statusCode, status, accessMemberId: access.memberId };
}

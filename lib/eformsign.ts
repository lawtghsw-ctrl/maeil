import { createPrivateKey, sign } from "crypto";

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

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

function privateKeyFromEnv() {
  const raw = requiredEnv("EFORMSIGN_PRIVATE_KEY").replace(/\\n/g, "\n").trim();
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

function signatureFor(executionTime: number) {
  return sign(
    "sha256",
    Buffer.from(String(executionTime), "utf8"),
    { key: privateKeyFromEnv(), dsaEncoding: "der" }
  ).toString("hex");
}

async function requestToken(memberId: string): Promise<EformsignAccess> {
  const apiKey = requiredEnv("EFORMSIGN_API_KEY");
  const executionTime = Date.now();
  const signature = signatureFor(executionTime);

  const response = await fetch("https://service.eformsign.com/v2.0/api_auth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Buffer.from(apiKey, "utf8").toString("base64")}`,
      eformsign_signature: signature,
    },
    body: JSON.stringify({ execution_time: executionTime, member_id: memberId }),
    cache: "no-store",
  });

  const body: any = await response.json().catch(() => ({}));
  const accessToken = String(body?.oauth_token?.access_token || "").trim();
  const apiUrl = String(body?.api_key?.company?.api_url || "").trim().replace(/\/+$/, "");
  if (!response.ok || !accessToken || !apiUrl) {
    const message = body?.ErrorMessage || body?.message || `HTTP ${response.status}`;
    throw new Error(`이폼사인 Access Token 발급 실패: ${message}`);
  }

  return {
    accessToken,
    apiUrl,
    memberId,
    companyId: String(body?.api_key?.company?.company_id || "").trim() || undefined,
  };
}

export async function getEformsignAccess(): Promise<EformsignAccess> {
  const primary = process.env.EFORMSIGN_SENDER_MEMBER_ID?.trim();
  const fallback = requiredEnv("EFORMSIGN_MEMBER_ID");
  const candidates = [...new Set([primary, fallback].filter(Boolean) as string[])];
  let lastError: unknown;

  for (const memberId of candidates) {
    try {
      return await requestToken(memberId);
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
  if (!match) throw new Error("계약일 형식을 확인해주세요.");
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
  const response = await fetch(
    `${access.apiUrl}/v2.0/api/documents/${encodeURIComponent(documentId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access.accessToken}`,
      },
      cache: "no-store",
    }
  );
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.ErrorMessage || body?.message || `HTTP ${response.status}`;
    throw new Error(`이폼사인 문서상태 조회 실패: ${message}`);
  }
  const statusCode = String(body?.current_status?.status_type || "").trim();
  return { statusCode, status: eformsignStatusLabel(statusCode), raw: body };
}

export async function createEformsignDocument(input: EformsignCreateInput) {
  const access = await getEformsignAccess();
  const templateId = requiredEnv("EFORMSIGN_TEMPLATE_ID");
  const date = dateParts(input.contractDate);

  // 현재 템플릿의 연도(2026)는 문서 본문에 고정되어 있고 API 입력항목은 월/일만 존재합니다.
  if (date.year !== 2026) {
    throw new Error("현재 이폼사인 템플릿의 계약연도는 2026으로 고정되어 있습니다. 템플릿 연도 수정 후 발송해주세요.");
  }

  const payload = {
    document: {
      document_name: `사건위임약정서(개인회생) - ${input.name}`,
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
        { id: "이름", value: input.name },
        { id: "주소", value: input.address },
        { id: "주민번호", value: input.residentNumber },
        { id: "전화번호", value: input.phone },
        { id: "채권자", value: input.creditorCount },
        { id: "보수", value: moneyText(input.fee) },
        { id: "월", value: date.month },
        { id: "일", value: date.day },
        { id: "갑_이름", value: input.signerName },
      ],
      select_group_name: "",
      notification: [],
    },
  };

  const response = await fetch(
    `${access.apiUrl}/v2.0/api/documents?template_id=${encodeURIComponent(templateId)}`,
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
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.ErrorMessage || body?.message || `HTTP ${response.status}`;
    throw new Error(`이폼사인 문서 발송 실패: ${message}`);
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

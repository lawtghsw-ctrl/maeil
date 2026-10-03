import { NextRequest } from "next/server";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlatformRole = "super_admin" | "firm_admin" | "staff";

export async function requirePlatformUser(request: NextRequest, allowed: PlatformRole[]) {
  const admin = createAdminClient();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("UNAUTHORIZED");

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,email,display_name,staff_name,is_active,law_firm_id,platform_role,role")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.is_active !== true) throw new Error("FORBIDDEN");

  const platformRole = (profile.platform_role || "staff") as PlatformRole;
  if (!allowed.includes(platformRole)) throw new Error("FORBIDDEN");

  if (platformRole !== "super_admin") {
    if (!profile.law_firm_id) throw new Error("NO_FIRM");
    const { data: firm, error: firmError } = await admin
      .from("law_firms")
      .select("id,name,status")
      .eq("id", profile.law_firm_id)
      .maybeSingle();
    if (firmError || !firm) throw new Error("NO_FIRM");
    if (firm.status !== "active") throw new Error("FIRM_SUSPENDED");
  }

  return { admin, user: userData.user, profile: { ...profile, platform_role: platformRole } };
}

export function platformError(err: unknown) {
  const message = err instanceof Error ? err.message : "요청 처리 중 오류가 발생했습니다.";
  if (message === "UNAUTHORIZED") return { status: 401, message: "로그인이 필요합니다." };
  if (message === "FORBIDDEN") return { status: 403, message: "접근 권한이 없습니다." };
  if (message === "NO_FIRM") return { status: 403, message: "소속 로펌 정보가 없습니다. 로파워 관리자에게 문의해주세요." };
  if (message === "FIRM_SUSPENDED") return { status: 403, message: "현재 로펌 이용이 중지되어 있습니다. 로파워 관리자에게 문의해주세요." };
  return { status: 400, message };
}

export function hashSecret(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function makeInviteCode() {
  return `LP-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function makeIntegrationSecret() {
  return `lp_${randomBytes(24).toString("base64url")}`;
}

export function makeSourceKey(prefix = "SRC") {
  return `${prefix}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function integrationKey(): Buffer {
  const raw = process.env.LAWPOWER_INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) throw new Error("LAWPOWER_INTEGRATION_ENCRYPTION_KEY 환경변수가 설정되지 않았습니다.");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("LAWPOWER_INTEGRATION_ENCRYPTION_KEY는 32바이트 키(64자리 HEX 또는 Base64)여야 합니다.");
  return decoded;
}

export function encryptIntegrationSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", integrationKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptIntegrationSecret(value: string) {
  const [version, ivB64, tagB64, cipherB64] = String(value || "").split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !cipherB64) throw new Error("암호화된 연동키 형식이 올바르지 않습니다.");
  const decipher = createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(cipherB64, "base64url")), decipher.final()]).toString("utf8");
}


function requestIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function writePlatformAudit(
  admin: ReturnType<typeof createAdminClient>,
  request: NextRequest,
  profile: { id?: string; display_name?: string | null; staff_name?: string | null; email?: string | null; platform_role?: string | null },
  entry: { lawFirmId?: string | null; action: string; targetType: string; targetId?: string | null; detail?: Record<string, unknown> }
) {
  try {
    const rawIp = requestIp(request);
    const ipHash = rawIp === "unknown" ? null : hashSecret(`audit-ip:${rawIp}`);
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
    const actorName = profile.display_name || profile.staff_name || profile.email || "사용자";
    const { error } = await admin.from("platform_audit_logs").insert({
      actor_user_id: profile.id || null,
      actor_name: actorName,
      actor_role: profile.platform_role || null,
      law_firm_id: entry.lawFirmId || null,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId || null,
      detail: entry.detail || {},
      ip_hash: ipHash,
      user_agent: userAgent,
    });
    if (error) console.error("플랫폼 감사로그 저장 실패", error);
  } catch (error) {
    console.error("플랫폼 감사로그 저장 실패", error);
  }
}

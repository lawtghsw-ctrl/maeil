import { NextRequest, NextResponse } from "next/server";
import { platformError, requirePlatformUser, writePlatformAudit } from "@/lib/platform/server";

export async function POST(request: NextRequest) {
  try {
    const { admin, profile } = await requirePlatformUser(request, ["super_admin"]);
    const body = await request.json();
    const lawFirmId = String(body.lawFirmId || "").trim();
    const action = body.action === "exit" ? "exit" : "enter";
    if (!lawFirmId) throw new Error("로펌을 선택해주세요.");
    const { data: firm, error } = await admin.from("law_firms").select("id,name,firm_code,status").eq("id", lawFirmId).maybeSingle();
    if (error || !firm) throw error || new Error("로펌 정보를 찾지 못했습니다.");
    await writePlatformAudit(admin, request, profile, {
      lawFirmId,
      action: action === "enter" ? "superadmin.firm_view.enter" : "superadmin.firm_view.exit",
      targetType: "law_firm",
      targetId: lawFirmId,
      detail: { firmName: firm.name, firmCode: firm.firm_code, firmStatus: firm.status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = platformError(err);
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
}

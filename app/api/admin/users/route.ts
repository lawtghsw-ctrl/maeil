import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePermissions, type PermissionMap } from "@/lib/permissions";
import { writePlatformAudit } from "@/lib/platform/server";

type PlatformRole = "super_admin" | "firm_admin" | "staff";

async function requireAccountAdmin(request: NextRequest) {
  const admin = createAdminClient();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("UNAUTHORIZED");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) throw new Error("UNAUTHORIZED");
  const { data: profile, error } = await admin.from("profiles")
    .select("id,role,is_active,display_name,staff_name,email,law_firm_id,platform_role")
    .eq("id", userData.user.id).maybeSingle();
  if (error || !profile || profile.is_active !== true || !["super_admin","firm_admin"].includes(profile.platform_role || "")) throw new Error("FORBIDDEN");
  if (profile.platform_role === "firm_admin") {
    if (!profile.law_firm_id) throw new Error("FORBIDDEN");
    const { data: firm, error: firmError } = await admin.from("law_firms").select("status").eq("id", profile.law_firm_id).maybeSingle();
    if (firmError || !firm || firm.status !== "active") throw new Error("FIRM_SUSPENDED");
  }
  return { admin, actorId:userData.user.id, profile:{...profile, platform_role:profile.platform_role as PlatformRole}, actorName:profile.display_name||profile.staff_name||profile.email||"관리자" };
}

function ensureSameFirm(actor:any, target:any) {
  if (actor.platform_role === "super_admin") return;
  if (!actor.law_firm_id || target.law_firm_id !== actor.law_firm_id) throw new Error("FORBIDDEN");
}

async function logAccountChange(admin:any, actorName:string, lawFirmId:string|null, targetName:string, action:"등록"|"수정"|"삭제", detail:string) {
  const id=`CHG-${crypto.randomUUID()}`;
  const { error } = await admin.from("app_change_logs").insert({ id, law_firm_id:lawFirmId, data:{id,category:"설정",action,targetName,detail,staff:actorName,at:new Date().toISOString()} });
  if(error) console.error("직원계정 변경이력 저장 실패",error);
}

function fail(err:unknown) {
  const message=err instanceof Error?err.message:"요청 처리 중 오류가 발생했습니다.";
  if(message==="UNAUTHORIZED") return NextResponse.json({error:"로그인이 필요합니다."},{status:401});
  if(message==="FORBIDDEN") return NextResponse.json({error:"이 로펌의 직원계정 관리 권한이 없습니다."},{status:403});
  if(message==="FIRM_SUSPENDED") return NextResponse.json({error:"현재 로펌 이용이 중지되어 직원계정을 변경할 수 없습니다."},{status:403});
  return NextResponse.json({error:message},{status:400});
}

export async function GET(request:NextRequest) {
  try {
    const {admin,profile}=await requireAccountAdmin(request);
    let q=admin.from("profiles").select("id,email,display_name,role,staff_name,is_active,is_work_staff,auto_assign_leads,lead_assignment_order,permissions,created_at,updated_at,law_firm_id,platform_role").order("created_at");
    if(profile.platform_role!=="super_admin") q=q.eq("law_firm_id",profile.law_firm_id);
    const [{data:listed,error:listError},{data:profiles,error:profileError}]=await Promise.all([admin.auth.admin.listUsers({page:1,perPage:1000}),q]);
    if(listError) throw listError; if(profileError) throw profileError;
    const authMap=new Map((listed?.users??[]).map((u:any)=>[u.id,u]));
    const users=(profiles??[]).map((p:any)=>{const au:any=authMap.get(p.id);return{
      id:p.id,email:au?.email??p.email??"",displayName:p.display_name||p.staff_name||au?.email?.split("@")[0]||"사용자",
      role:p.role==="admin"?"admin":"staff",platformRole:p.platform_role||"staff",lawFirmId:p.law_firm_id,
      staffName:p.staff_name||p.display_name||"",isActive:p.is_active===true,isWorkStaff:p.is_work_staff!==false,
      autoAssignLeads:p.auto_assign_leads===true,leadAssignmentOrder:Number(p.lead_assignment_order??1000),permissions:(p.permissions??{}) as PermissionMap,
      createdAt:au?.created_at??p.created_at,lastSignInAt:au?.last_sign_in_at??null,
    }});
    return NextResponse.json({users});
  } catch(err){return fail(err)}
}

export async function POST(request:NextRequest) {
  try {
    const {admin,profile,actorName}=await requireAccountAdmin(request); const body=await request.json();
    if(profile.platform_role!=="super_admin") throw new Error("직원 신규 가입은 로펌 설정에서 발급한 24시간 1회용 초대코드로 진행해주세요.");
    const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||""),displayName=String(body.displayName||"").trim();
    if(!email.includes("@")) throw new Error("올바른 이메일을 입력해주세요."); if(password.length<8) throw new Error("임시 비밀번호는 8자 이상 입력해주세요."); if(!displayName) throw new Error("직원 이름을 입력해주세요.");
    const lawFirmId=profile.platform_role==="super_admin"?String(body.lawFirmId||profile.law_firm_id||""):String(profile.law_firm_id||"");
    if(!lawFirmId) throw new Error("소속 로펌을 선택해주세요.");
    const {data:targetFirm,error:targetFirmError}=await admin.from("law_firms").select("id,status").eq("id",lawFirmId).maybeSingle();
    if(targetFirmError||!targetFirm) throw new Error("로펌 정보를 찾지 못했습니다.");
    if(targetFirm.status!=="active") throw new Error("이용중지 상태의 로펌에는 계정을 추가할 수 없습니다.");
    const requestedAdmin=body.role==="admin"; if(profile.platform_role!=="super_admin"&&requestedAdmin) throw new Error("로펌 관리자는 일반 직원계정만 생성할 수 있습니다.");
    const platformRole:PlatformRole=requestedAdmin?"firm_admin":"staff";
    const {data:nameRows,error:nameError}=await admin.from("profiles").select("id,display_name,staff_name").eq("law_firm_id",lawFirmId); if(nameError) throw nameError;
    const normalized=displayName.toLocaleLowerCase("ko-KR"); if((nameRows??[]).some((r:any)=>String(r.staff_name||r.display_name||"").trim().toLocaleLowerCase("ko-KR")===normalized)) throw new Error("같은 로펌 안에 동일한 직원명이 이미 존재합니다.");
    const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:displayName,staff_name:displayName}}); if(error||!data.user) throw error||new Error("계정 생성 실패");
    const isWorkStaff=body.isWorkStaff!==false,autoAssignLeads=isWorkStaff&&body.autoAssignLeads===true,order=Math.max(1,Math.min(9999,Number(body.leadAssignmentOrder)||1000));
    const {error:updateError}=await admin.from("profiles").update({email,display_name:displayName,staff_name:displayName,role:requestedAdmin?"admin":"staff",platform_role:platformRole,law_firm_id:lawFirmId,is_active:body.isActive===true,is_work_staff:isWorkStaff,auto_assign_leads:autoAssignLeads,lead_assignment_order:order,permissions:normalizePermissions((body.permissions??{}) as PermissionMap),updated_at:new Date().toISOString()}).eq("id",data.user.id);
    if(updateError){await admin.auth.admin.deleteUser(data.user.id);throw updateError}
    await logAccountChange(admin,actorName,lawFirmId,displayName,"등록",`직원계정 생성 · ${platformRole} · ${body.isActive===true?"활성":"비활성"}`);
    await writePlatformAudit(admin, request, profile, { lawFirmId, action: "member.create", targetType: "profile", targetId: data.user.id, detail: { displayName, platformRole, isActive: body.isActive===true } });
    return NextResponse.json({ok:true,id:data.user.id});
  }catch(err){return fail(err)}
}

export async function PATCH(request:NextRequest) {
  try {
    const {admin,actorId,profile,actorName}=await requireAccountAdmin(request); const body=await request.json(); const id=String(body.id||""); if(!id) throw new Error("사용자 ID가 없습니다.");
    const {data:current,error}=await admin.from("profiles").select("id,role,is_active,staff_name,display_name,law_firm_id,platform_role").eq("id",id).maybeSingle(); if(error||!current) throw new Error("사용자 프로필을 찾지 못했습니다.");
    ensureSameFirm(profile,current); if(current.platform_role==="super_admin"&&id!==actorId) throw new Error("SUPER ADMIN은 이 화면에서 수정할 수 없습니다.");
    const nextAdmin = profile.platform_role === "super_admin" ? body.role === "admin" : current.platform_role === "firm_admin";
    if(profile.platform_role!=="super_admin" && current.platform_role!=="firm_admin" && body.role==="admin") throw new Error("로펌 관리자는 직원을 관리자로 승격할 수 없습니다.");
    const nextPlatformRole:PlatformRole=nextAdmin?"firm_admin":"staff"; const nextActive=body.isActive===true;
    if(id===actorId&&!nextActive) throw new Error("현재 로그인 계정은 비활성화할 수 없습니다.");
    if(current.platform_role==="firm_admin" && (!nextActive || nextPlatformRole!=="firm_admin")) {
      const {count,error:adminCountError}=await admin.from("profiles").select("id",{count:"exact",head:true})
        .eq("law_firm_id",current.law_firm_id).eq("platform_role","firm_admin").eq("is_active",true).neq("id",id);
      if(adminCountError) throw adminCountError;
      if(!count) throw new Error("각 로펌에는 활성 로펌 관리자가 최소 1명 이상 있어야 합니다.");
    }
    const displayName=String(body.displayName||"").trim(),email=String(body.email||"").trim().toLowerCase(),password=String(body.password||""); if(!displayName||!email.includes("@")) throw new Error("이름/이메일을 확인해주세요."); if(password&&password.length<8) throw new Error("새 비밀번호는 8자 이상이어야 합니다.");
    const {data:nameRows}=await admin.from("profiles").select("id,display_name,staff_name").eq("law_firm_id",current.law_firm_id); const normalized=displayName.toLocaleLowerCase("ko-KR"); if((nameRows??[]).some((r:any)=>r.id!==id&&String(r.staff_name||r.display_name||"").trim().toLocaleLowerCase("ko-KR")===normalized)) throw new Error("같은 로펌 안에 동일한 직원명이 이미 존재합니다.");
    const authPatch:any={email,user_metadata:{display_name:displayName,staff_name:displayName}}; if(password) authPatch.password=password; const {error:authError}=await admin.auth.admin.updateUserById(id,authPatch); if(authError) throw authError;
    const isWorkStaff=body.isWorkStaff!==false,autoAssignLeads=isWorkStaff&&body.autoAssignLeads===true,order=Math.max(1,Math.min(9999,Number(body.leadAssignmentOrder)||1000));
    const {error:profileError}=await admin.from("profiles").update({email,display_name:displayName,staff_name:displayName,role:nextAdmin?"admin":"staff",platform_role:nextPlatformRole,is_active:nextActive,is_work_staff:isWorkStaff,auto_assign_leads:autoAssignLeads,lead_assignment_order:order,permissions:normalizePermissions((body.permissions??{}) as PermissionMap),updated_at:new Date().toISOString()}).eq("id",id); if(profileError) throw profileError;
    const oldName=String(current.staff_name||current.display_name||"").trim(); if(oldName&&oldName!==displayName){const {error:renameError}=await admin.rpc("rename_staff_assignments_for_firm",{p_law_firm_id:current.law_firm_id,p_old_name:oldName,p_new_name:displayName});if(renameError) throw renameError}
    await logAccountChange(admin,actorName,current.law_firm_id,displayName,"수정",`직원계정 설정 변경 · ${nextPlatformRole} · ${nextActive?"활성":"비활성"}`);
    await writePlatformAudit(admin, request, profile, { lawFirmId: current.law_firm_id, action: "member.update", targetType: "profile", targetId: id, detail: { displayName, nextPlatformRole, nextActive } });
    return NextResponse.json({ok:true});
  }catch(err){return fail(err)}
}

export async function DELETE(request:NextRequest) {
  try {
    const {admin,actorId,profile,actorName}=await requireAccountAdmin(request); const id=String(request.nextUrl.searchParams.get("id")||""); if(!id) throw new Error("사용자 ID가 없습니다."); if(id===actorId) throw new Error("현재 로그인한 본인 계정은 삭제할 수 없습니다.");
    const {data:target,error}=await admin.from("profiles").select("id,display_name,staff_name,law_firm_id,platform_role").eq("id",id).maybeSingle(); if(error||!target) throw new Error("사용자 프로필을 찾지 못했습니다."); ensureSameFirm(profile,target); if(target.platform_role==="super_admin") throw new Error("SUPER ADMIN은 삭제할 수 없습니다.");
    if(target.platform_role==="firm_admin") {
      const {count,error:adminCountError}=await admin.from("profiles").select("id",{count:"exact",head:true})
        .eq("law_firm_id",target.law_firm_id).eq("platform_role","firm_admin").eq("is_active",true).neq("id",id);
      if(adminCountError) throw adminCountError;
      if(!count) throw new Error("각 로펌에는 활성 로펌 관리자가 최소 1명 이상 있어야 합니다.");
    }
    const targetName=target.staff_name||target.display_name||"사용자"; const [leads,clients,cases]=await Promise.all([
      admin.from("app_leads").select("id",{count:"exact",head:true}).eq("law_firm_id",target.law_firm_id).contains("data",{assignedStaff:targetName}),
      admin.from("app_clients").select("id",{count:"exact",head:true}).eq("law_firm_id",target.law_firm_id).contains("data",{assignedStaff:targetName}),
      admin.from("app_cases").select("id",{count:"exact",head:true}).eq("law_firm_id",target.law_firm_id).contains("data",{assignedStaff:targetName}),
    ]); const assigned=(leads.count??0)+(clients.count??0)+(cases.count??0); if(assigned>0) throw new Error(`담당으로 남아있는 DB/고객/계약이 ${assigned}건 있습니다. 퇴사자는 삭제보다 비활성화를 권장합니다.`);
    const {error:deleteError}=await admin.auth.admin.deleteUser(id); if(deleteError) throw deleteError;
    await logAccountChange(admin,actorName,target.law_firm_id,targetName,"삭제","직원계정 영구삭제");
    await writePlatformAudit(admin, request, profile, { lawFirmId: target.law_firm_id, action: "member.delete", targetType: "profile", targetId: id, detail: { targetName } });
    return NextResponse.json({ok:true});
  }catch(err){return fail(err)}
}

"use client";

import { useStoreSession } from "@/lib/store";
import FirmEsignSettings from "@/components/platform/FirmEsignSettings";

export default function ContractSettingsPage() {
  const { profile, superAdminFirmScope } = useStoreSession();
  if (!profile) return <p className="p-8 text-sm text-slate-500">권한을 확인하는 중...</p>;
  const isSuper = profile.platformRole === "super_admin";
  if (!isSuper && profile.platformRole !== "firm_admin") return <p role="alert" className="p-8 text-sm text-slate-500">계약서 설정은 로펌 관리자만 이용할 수 있습니다.</p>;
  const lawFirmId = isSuper ? superAdminFirmScope?.id : profile.lawFirmId;
  if (!lawFirmId) return <p role="alert" className="p-8 text-sm text-slate-500">계약서를 관리할 로펌을 선택해주세요.</p>;
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-black text-slate-900">계약서 설정</h1><p className="mt-2 text-sm leading-6 text-slate-500">본 로펌의 이폼사인 계정과 수임계약 템플릿을 직접 등록하고 연결 상태를 확인합니다. 계약서 발송은 계약관리에서 진행합니다.</p></header>
    <section aria-labelledby="contract-setup-guide" className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-700"><h2 id="contract-setup-guide" className="font-bold">처음 연결하는 순서</h2><ol className="mt-2 list-decimal space-y-2 pl-5 text-xs leading-6"><li>본 로펌 이폼사인 계정의 API 키·서명키·회사 ID·멤버 ID를 준비합니다.</li><li>이폼사인에 사용할 계약서를 템플릿으로 등록한 뒤, 아래에 템플릿 ID와 문서 자동입력 항목을 입력합니다.</li><li>연결·템플릿을 저장한 다음, ‘저장된 연결 확인’으로 계정 인증 상태를 확인합니다. 계약서 내용과 서명자 설정은 이폼사인 템플릿에서 확인해주세요.</li></ol><a href="https://www.eformsign.com/en/support/documentation/open-api/" target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-semibold text-blue-700 underline">이폼사인 공식 API 도움말 (영문)</a></section>
    <FirmEsignSettings key={lawFirmId} lawFirmId={lawFirmId} />
  </div>;
}

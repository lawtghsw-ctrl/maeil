"use client";
import dynamic from "next/dynamic";
import { useStoreSession } from "@/lib/store";
import PlatformWorkspace from "@/components/platform/PlatformWorkspace";
const FirmDashboard = dynamic(() => import("@/components/dashboard/FirmDashboard"), { loading: () => <p role="status" className="p-8 text-sm text-slate-500">대시보드를 불러오는 중입니다.</p> });
export default function DashboardPage() {
  const { profile, superAdminFirmScope } = useStoreSession();
  if (!profile) return null;
  return profile.platformRole === "super_admin" && !superAdminFirmScope ? <PlatformWorkspace section="home"/> : <FirmDashboard/>;
}

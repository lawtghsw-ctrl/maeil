"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { useStoreSession } from "@/lib/store";

const loading = () => <p role="status" className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-500">로파워 운영 화면을 불러오는 중입니다.</p>;
const Home = dynamic(() => import("./OperationsOverview").then(module => module.OpsHome), { loading });
const Contracts = dynamic(() => import("./OperationsContracts").then(module => module.OperationsContracts), { loading });
const Costs = dynamic(() => import("./OperationsOverview").then(module => module.OperationsCosts), { loading });
const Settings = dynamic(() => import("./OperationsSettings").then(module => module.OperationsSettings), { loading });
const Advertising = dynamic(() => import("./MetaInsights"), { loading });
const Sales = dynamic(() => import("./SalesPipeline"), { loading });
const Firms = dynamic(() => import("./FirmDirectory"), { loading });

export default function PlatformWorkspace({ section }: { section: "home" | "contracts" | "costs" | "settings" | "advertising" | "sales" | "firms" | "logs" }) {
  const { profile, superAdminFirmScope, exitSuperAdminFirmScope } = useStoreSession();
  useEffect(() => { if (profile?.platformRole === "super_admin") exitSuperAdminFirmScope(); }, [profile?.platformRole, exitSuperAdminFirmScope]);
  if (!profile) return loading();
  if (profile.platformRole !== "super_admin") return <p role="alert" className="rounded-xl border bg-white p-8 text-sm text-slate-600">로파워 운영 메뉴는 슈퍼관리자만 사용할 수 있습니다.</p>;
  if (superAdminFirmScope) return loading();
  if (section === "contracts") return <Contracts/>;
  if (section === "costs") return <Costs/>;
  if (section === "settings") return <Settings/>;
  if (section === "advertising") return <Advertising/>;
  if (section === "sales") return <Sales/>;
  if (section === "firms" || section === "logs") return <Firms key={section} initialTab={section === "logs" ? "activity" : "overview"}/>;
  return <Home/>;
}

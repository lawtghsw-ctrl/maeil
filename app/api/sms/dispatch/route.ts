import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { workerAuthorized } from "@/lib/sms/delivery";
import { runSmsWorker } from "@/lib/sms/worker";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
export async function POST(request: NextRequest) {
  if (!workerAuthorized(request)) return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers});
  try { return NextResponse.json({ok:true,...await runSmsWorker(createAdminClient())},{headers}); }
  catch { return NextResponse.json({error:"DISPATCH_UNCONFIRMED"},{status:503,headers}); }
}
export async function GET() { return NextResponse.json({error:"UNAUTHORIZED"},{status:401,headers}); }

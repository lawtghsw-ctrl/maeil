import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Browser session is not available for these external/public routes.
  if (["/join", "/api/join", "/api/integrations/google-sheets/leads", "/api/integrations/meta/flush"].includes(pathname)) {
    return NextResponse.next({ request });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const user = data.user;
  const isLogin = pathname === "/login";

  if (!user && !isLogin) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (!user) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_active,platform_role,law_firm_id")
    .eq("id", user.id)
    .maybeSingle();

  if (isLogin) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = profile?.platform_role === "super_admin" ? "/platform" : "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  // SUPER_ADMIN은 전체 로펌 통합보기와 특정 로펌 직접관리 모드를 모두 사용합니다.
  // 선택 범위는 브라우저 AppStore에서 관리하므로 middleware에서 일반 업무 경로를 차단하지 않습니다.
  if (profile?.platform_role !== "super_admin" && (pathname === "/platform" || pathname.startsWith("/platform/"))) {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return NextResponse.redirect(target);
  }

  if (pathname === "/firm/settings" && !["super_admin", "firm_admin"].includes(profile?.platform_role || "")) {
    const target = request.nextUrl.clone();
    target.pathname = "/";
    target.search = "";
    return NextResponse.redirect(target);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};

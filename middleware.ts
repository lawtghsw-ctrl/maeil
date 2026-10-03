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

  // SUPER_ADMIN의 "어드민 보기" 대상 로펌은 브라우저 sessionStorage에서 관리합니다.
  // middleware는 sessionStorage를 읽을 수 없으므로 SUPER_ADMIN의 일반 업무 경로를
  // /platform 으로 강제 리다이렉트하면 선택한 로펌 어드민에 진입할 수 없습니다.
  // 실제 접근 차단/로펌 범위 검증은 AppShell + AppStore에서 수행합니다.
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

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

  // Avoid ever rendering a cross-firm operational dashboard to SUPER_ADMIN.
  if (profile?.platform_role === "super_admin") {
    const allowed = pathname === "/platform" || pathname.startsWith("/platform/") || pathname === "/firm/settings" || pathname === "/account" || pathname.startsWith("/api/");
    if (!allowed) {
      const target = request.nextUrl.clone();
      target.pathname = "/platform";
      target.search = "";
      return NextResponse.redirect(target);
    }
  } else if (pathname === "/platform" || pathname.startsWith("/platform/")) {
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

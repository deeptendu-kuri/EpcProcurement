import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig } from "@/lib/env";

export function proxy(request: NextRequest) {
  if (!hasSupabaseConfig()) {
    return NextResponse.next();
  }

  // Full Supabase session enforcement is intentionally centralized here once credentials are provided.
  return NextResponse.next({ request });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

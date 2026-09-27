import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/mvp/auth/session";

/** POST /api/mvp/logout — clears the session. Form posts are redirected to /login; JSON gets `{ ok: true }`. */
export async function POST(request: NextRequest) {
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  const response = isJson ? NextResponse.json({ ok: true }) : NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

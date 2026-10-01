import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/mvp/auth/origin";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authConfigError,
  createSessionToken,
  passwordMatches,
  safeNextPath,
} from "@/mvp/auth/session";

/**
 * POST /api/mvp/login — body: form data or JSON `{ password, next? }`.
 * Form posts get a 303 redirect (to `next` on success, back to /login?error=… on failure);
 * JSON posts get `{ ok: true }` or `{ error }` with 401/503.
 */
export async function POST(request: NextRequest) {
  const isForm = !(request.headers.get("content-type") ?? "").includes("application/json");
  let password = "";
  let next: string | null = null;
  try {
    if (isForm) {
      const form = await request.formData();
      password = String(form.get("password") ?? "");
      next = form.get("next") ? String(form.get("next")) : null;
    } else {
      const body = (await request.json()) as { password?: unknown; next?: unknown };
      password = typeof body.password === "string" ? body.password : "";
      next = typeof body.next === "string" ? body.next : null;
    }
  } catch {
    // fall through with an empty password
  }

  const fail = (code: "config" | "invalid", status: number, message: string) => {
    if (!isForm) return NextResponse.json({ error: message }, { status });
    const url = new URL("/login", publicOrigin(request.url));
    url.searchParams.set("error", code);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, 303);
  };

  const configError = authConfigError();
  if (configError) return fail("config", 503, configError);

  const secret = process.env.SESSION_SECRET!.trim();
  const expected = process.env.DEMO_PASSWORD!.trim();
  if (!password || !(await passwordMatches(password, expected))) {
    await new Promise((resolve) => setTimeout(resolve, 400)); // slow down guessing
    return fail("invalid", 401, "Wrong password.");
  }

  const target = safeNextPath(next);
  const response = isForm ? NextResponse.redirect(new URL(target, publicOrigin(request.url)), 303) : NextResponse.json({ ok: true, next: target });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: await createSessionToken(secret),
    httpOnly: true,
    sameSite: "lax",
    secure: publicOrigin(request.url).startsWith("https:"),
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return response;
}

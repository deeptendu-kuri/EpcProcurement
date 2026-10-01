import { NextResponse } from "next/server";
import { getDb } from "@/mvp/db";
import { authConfigError } from "@/mvp/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public readiness probe: no credentials, counts, provider details or error text are exposed. */
export async function GET() {
  try {
    if (authConfigError()) return NextResponse.json({ ok: false }, { status: 503 });
    await getDb().query("select 1");
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}

import { NextResponse } from "next/server";
import { z } from "zod";

/** Shared helpers for /api/mvp route handlers. Auth (401) is handled by src/proxy.ts. */

export const uuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id.");

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

/** Parse a JSON body with a zod schema. Returns either `{ data }` or a ready 400 response. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T>; response?: undefined } | { data?: undefined; response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { response: jsonError(400, "Body must be JSON.") };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    return { response: jsonError(400, `${where}${first?.message ?? "Invalid request."}`, parsed.error.issues) };
  }
  return { data: parsed.data };
}

/** Log the error and return a generic 500 (never leak stack traces). */
export function serverError(context: string, error: unknown, message = "Something went wrong. Try again.") {
  console.error(`[api/mvp] ${context}:`, error);
  return jsonError(500, message);
}

export const NO_STORE = { "cache-control": "no-store" } as const;

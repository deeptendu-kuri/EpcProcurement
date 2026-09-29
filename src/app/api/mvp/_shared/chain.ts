import { ChainError, isDerivedLeadId } from "@/mvp/buyers";
import { jsonError, serverError, uuidSchema } from "./http";

/** A chain root id from the path: a lead uuid or `derived:<key>`; null when invalid. */
export function chainLeadId(raw: string): string | null {
  const id = decodeURIComponent(raw);
  return uuidSchema.safeParse(id).success || isDerivedLeadId(id) ? id : null;
}

/** `?expand=all` or `?expand=t2:pipe_maker,t2:valve_maker`; undefined = default (identified tier-2 nodes). */
export function expandParam(url: string): "all" | string[] | undefined {
  const raw = new URL(url).searchParams.get("expand");
  if (!raw) return undefined;
  if (raw === "all") return "all";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
}

/** Map a ChainError to its status, anything else to a 500. */
export function chainFailure(context: string, error: unknown) {
  if (error instanceof ChainError) return jsonError(error.status, error.message);
  return serverError(context, error);
}

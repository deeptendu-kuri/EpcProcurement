import { publicOrigin } from "@/mvp/auth/origin";
import { jsonError } from "../_shared/http";

export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin && origin !== publicOrigin(request.url) ? jsonError(403, "Cross-origin changes are not allowed.") : null;
}

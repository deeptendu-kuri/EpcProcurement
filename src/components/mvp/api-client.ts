/** Small fetch helpers for the /api/mvp routes (client side). Errors carry the server's message. */

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiJson<T>(url: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) throw new ApiError("Your session has ended. Sign in again.", 401);
    throw new ApiError(data.error ?? `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

export interface LeadPatchBody {
  status?: string;
  rejectReason?: string | null;
  nextAction?: string | null;
  ownerUserId?: string | null;
}

export function patchLead(id: string, body: LeadPatchBody) {
  return apiJson<{ lead: unknown }>(`/api/mvp/leads/${id}`, { method: "PATCH", body });
}

export function addNote(leadId: string, text: string) {
  return apiJson<{ activity: unknown }>(`/api/mvp/leads/${leadId}/activities`, { method: "POST", body: { type: "note", body: text } });
}

export interface DraftResult {
  id: string;
  subject: string;
  body: string;
  blockedReason?: string;
}

export function createDraft(leadId: string, personId: string | null) {
  return apiJson<DraftResult>("/api/mvp/drafts", { method: "POST", body: { leadId, personId } });
}

export function updateDraft(id: string, body: { subject?: string; body?: string; status?: "sent_externally" }) {
  return apiJson<{ draft: unknown }>(`/api/mvp/drafts/${id}`, { method: "PATCH", body });
}

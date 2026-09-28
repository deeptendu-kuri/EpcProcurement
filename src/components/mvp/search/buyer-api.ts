/** Client helpers for /api/mvp/buyers/* and /api/mvp/lists/* (docs/mvp/14 §9–10). */
import type { BuyerSearch, BuyerSearchResult, BuyerView, ContactSearchResult, LeadList } from "@/mvp/buyers/types";
import { apiJson } from "../api-client";

export function searchBuyers(search: BuyerSearch, signal?: AbortSignal) {
  return apiJson<BuyerSearchResult>("/api/mvp/buyers", { method: "POST", body: search, signal });
}

export function searchContacts(search: BuyerSearch, signal?: AbortSignal) {
  return apiJson<ContactSearchResult>("/api/mvp/buyers/contacts", { method: "POST", body: search, signal });
}

/** GET /api/mvp/buyers/[id] → BuyerView (accepts a bare view or { buyer }). */
export async function getBuyer(leadId: string, signal?: AbortSignal): Promise<BuyerView> {
  const data = await apiJson<BuyerView | { buyer: BuyerView }>(`/api/mvp/buyers/${encodeURIComponent(leadId)}`, { signal });
  return "buyer" in data && data.buyer ? data.buyer : (data as BuyerView);
}

type ListsResponse = LeadList[] | { lists: LeadList[] };

export async function getLists(signal?: AbortSignal): Promise<LeadList[]> {
  const data = await apiJson<ListsResponse>("/api/mvp/lists", { signal });
  return Array.isArray(data) ? data : (data.lists ?? []);
}

export async function createList(name: string, leadIds: string[] = []): Promise<LeadList> {
  const data = await apiJson<LeadList | { list: LeadList }>("/api/mvp/lists", { method: "POST", body: { name, leadIds } });
  return "list" in data && data.list ? data.list : (data as LeadList);
}

export function addToList(listId: string, leadIds: string[]) {
  return apiJson<unknown>(`/api/mvp/lists/${encodeURIComponent(listId)}/items`, { method: "POST", body: { leadIds } });
}

/** GET /api/mvp/lists/[id] → { list: LeadList & { leadIds, rows } }. */
export async function getListItems(listId: string, signal?: AbortSignal): Promise<unknown> {
  const data = await apiJson<{ list?: unknown }>(`/api/mvp/lists/${encodeURIComponent(listId)}`, { signal });
  return data.list ?? data;
}

/** Pull lead ids from a list (its `leadIds`, or items carrying a leadId). */
export function leadIdsFrom(data: unknown): string[] {
  const direct = data && typeof data === "object" ? (data as { leadIds?: unknown }).leadIds : undefined;
  if (Array.isArray(direct)) return direct.filter((id): id is string => typeof id === "string");
  const items = Array.isArray(data) ? data : data && typeof data === "object" ? ((data as { items?: unknown[] }).items ?? []) : [];
  return items
    .map((item) => (typeof item === "string" ? item : item && typeof item === "object" ? (item as { leadId?: string }).leadId : undefined))
    .filter((id): id is string => typeof id === "string");
}

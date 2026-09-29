/**
 * Client helpers for the supply-chain routes (docs/mvp/15 §B, §D, §E). Responses are accepted bare
 * or wrapped ({ chain }, { rows }, { lead }) so the UI does not break on small shape changes.
 */
import type { AddContactInput, ChainContactRow, SupplyChain } from "@/mvp/buyers/types";
import { apiJson } from "../api-client";

const enc = encodeURIComponent;

function unwrap<T>(data: unknown, key: string): T {
  if (data && typeof data === "object" && key in data) return (data as Record<string, unknown>)[key] as T;
  return data as T;
}

/** GET /api/mvp/chain/[leadId] (optionally expanding one node to its tier-3 suppliers). */
export async function getChain(leadId: string, options: { expand?: string[]; signal?: AbortSignal } = {}): Promise<SupplyChain> {
  const query = options.expand?.length ? `?expand=${options.expand.map(enc).join(",")}` : "";
  const data = await apiJson<unknown>(`/api/mvp/chain/${enc(leadId)}${query}`, { signal: options.signal });
  return unwrap<SupplyChain>(data, "chain");
}

/** GET /api/mvp/chain/[leadId]/contacts → every node × buying-team slot across the tiers. */
export async function getChainContacts(leadId: string, options: { expand?: string[]; signal?: AbortSignal } = {}): Promise<ChainContactRow[]> {
  const query = options.expand?.length ? `?expand=${options.expand.map(enc).join(",")}` : "";
  const data = await apiJson<unknown>(`/api/mvp/chain/${enc(leadId)}/contacts${query}`, { signal: options.signal });
  if (Array.isArray(data)) return data as ChainContactRow[];
  return unwrap<ChainContactRow[]>(data, "rows") ?? [];
}

/** POST /api/mvp/chain/[leadId]/nodes/[nodeId]/company — set the company of a node (by name or a candidate's id). */
export function setNodeCompany(leadId: string, nodeId: string, body: { name: string; companyId?: string }) {
  return apiJson<unknown>(`/api/mvp/chain/${enc(leadId)}/nodes/${enc(nodeId)}/company`, { method: "POST", body });
}

/** DELETE /api/mvp/chain/[leadId]/nodes/[nodeId]/company — remove a wrong company from a node. */
export function removeNodeCompany(leadId: string, nodeId: string) {
  return apiJson<unknown>(`/api/mvp/chain/${enc(leadId)}/nodes/${enc(nodeId)}/company`, { method: "DELETE" });
}

/** POST /api/mvp/contacts — a manually added person (+ contact points), status Likely. */
export function addContact(input: AddContactInput & { leadId?: string }) {
  return apiJson<unknown>("/api/mvp/contacts", { method: "POST", body: input });
}

/** POST /api/mvp/contacts/[personId]/confirm — confirm as decision maker (activity logged). */
export function confirmContact(personId: string, body: { leadId?: string; slotId?: string; companyId?: string | null }) {
  return apiJson<unknown>(`/api/mvp/contacts/${enc(personId)}/confirm`, { method: "POST", body });
}

/** POST /api/mvp/buyers/derive — save a derived (tier 2/3) buyer as a lead; returns its lead id. */
export async function saveDerivedBuyer(derivedKey: string): Promise<string | null> {
  const data = await apiJson<unknown>("/api/mvp/buyers/derive", { method: "POST", body: { derivedKey } });
  if (data && typeof data === "object") {
    const record = data as { leadId?: unknown; lead?: { id?: unknown } };
    if (typeof record.leadId === "string") return record.leadId;
    if (record.lead && typeof record.lead.id === "string") return record.lead.id;
  }
  return null;
}

/** "derived:<key>" row ids (search rows without a stored lead). */
export { isDerivedLeadId as isDerivedId } from "@/mvp/buyers/types";

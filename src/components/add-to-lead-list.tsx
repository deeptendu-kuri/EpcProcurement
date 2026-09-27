"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListPlus } from "lucide-react";
import { FilterDrawer } from "@/components/filter-drawer";
import { defaultLists } from "@/components/lead-lists";
import { mergeListMembers } from "@/lib/lead-list-members";

type List = { id: string; name: string; description: string; createdAt: string };
type Member = { id: string; listId: string; memberType: "decision-maker"; contactId: string; leadId: string; addedAt: string };
const storageKey = "industrialBuyerLeadLists.v1";

export function useSavedContactIds() {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
        setIds((value.members ?? []).map((member: Member) => member.contactId).filter(Boolean));
      } catch { setIds([]); }
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("lead-lists-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("lead-lists-updated", refresh);
    };
  }, []);
  return ids;
}

export function AddToLeadList({ contacts }: { contacts: { contactId: string; leadId: string }[] }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<List[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadLists() {
    setOpen(true);
    setLoading(true);
    setMessage("");
    let local: List[] = [];
    try { local = JSON.parse(localStorage.getItem(storageKey) ?? "{}").lists ?? []; } catch { /* Remote lists remain available. */ }
    let remote: List[] = [];
    try {
      const response = await fetch("/api/discovery/crm", { signal: AbortSignal.timeout(8000) });
      if (response.ok) remote = (await response.json()).leadLists ?? [];
    } catch { /* Browser lists remain available offline. */ }
    const available = Array.from(new Map([...defaultLists, ...local, ...remote].map((list) => [list.id, list])).values());
    setLists(available);
    setSelected(available[0]?.id ?? "");
    setLoading(false);
  }

  function save() {
    const list = lists.find((item) => item.id === selected);
    if (!list || !contacts.length) return;
    try {
      const current = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
      const members: Member[] = contacts.map((contact) => ({
        id: `${list.id}-decision-maker-${contact.contactId}`,
        listId: list.id, memberType: "decision-maker", ...contact, addedAt: new Date().toISOString(),
      }));
      const mergedLists = Array.from(new Map<string, List>([...(current.lists ?? []), list].map((item: List) => [item.id, item])).values());
      const mergedMembers = mergeListMembers(current.members ?? [], members);
      localStorage.setItem(storageKey, JSON.stringify({ ...current, lists: mergedLists, members: mergedMembers }));
      window.dispatchEvent(new Event("lead-lists-updated"));
      setMessage(`${contacts.length} selected contacts saved to ${list.name} in this browser.`);
    } catch {
      setMessage("Could not save. Browser storage is unavailable; your selection has been kept.");
    }
  }

  return <>
    <button type="button" onClick={loadLists} className="btn-quiet focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold"><ListPlus size={15} />Add to list</button>
    <FilterDrawer open={open} onClose={() => setOpen(false)} title="Add to lead list">
      <div className="space-y-4 p-4">
        <p className="text-sm text-[#475467]">{contacts.length} selected contacts or role targets</p>
        <label className="block text-sm font-semibold">Lead list
          <select value={selected} onChange={(event) => { setSelected(event.target.value); setMessage(""); }} disabled={loading} className="control focus-ring mt-2 h-10 w-full px-3">
            {loading ? <option>Loading lists...</option> : lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>
        <p className="text-xs leading-5 text-[#667085]">Research contact memberships are stored in this browser. Database synchronization is not yet available for these contacts.</p>
        <button type="button" onClick={save} disabled={loading || !selected || !contacts.length} className="btn-primary focus-ring h-10 rounded-md px-4 text-sm font-semibold disabled:opacity-50">Save to list</button>
        {message ? <p role="status" className="text-sm text-[#344054]">{message}</p> : null}
        <Link href="/legacy/lead-lists" className="focus-ring block text-sm font-semibold text-[#2563eb]">Open Lead Lists</Link>
      </div>
    </FilterDrawer>
  </>;
}

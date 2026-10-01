"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChainContactRow, ChainNode, SupplyChain } from "@/mvp/buyers/types";
import { ApiError } from "../api-client";
import { useToast } from "../shell/toast";
import { AddContactModal, type AddContactValues } from "./add-contact-modal";
import { addContact, confirmContact, getChain, getChainContacts, removeNodeCompany, setNodeCompany } from "./chain-api";
import { ChainContactsTable, rowKey } from "./chain-contacts-table";
import { SupplyChainTree } from "./supply-chain-tree";
import { saveDerivedBuyer } from "./chain-api";
import { DraftPanel, type DraftContact } from "../draft-panel";
import { DEMO_CONTACT_EMAIL, type DemoEmailInfo } from "@/mvp/email/config";

function withSet<T>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * The supply-chain tree and "All contacts in this supply chain" for one buyer (docs/mvp/15 §B, §E).
 * Loads GET /api/mvp/chain/[leadId] (+ /contacts); tier-3 suppliers load on "Expand".
 */
export function SupplyChainExplorer({ leadId, rootShortName, demoEmail }: { leadId: string; rootShortName: string; demoEmail?: DemoEmailInfo }) {
  const router = useRouter();
  const toast = useToast();
  const [chain, setChain] = useState<SupplyChain | null>(null);
  const [contacts, setContacts] = useState<ChainContactRow[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [error, setError] = useState<{ message: string; status: number } | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [busyRows, setBusyRows] = useState<Set<string>>(new Set());
  const [candidatesFor, setCandidatesFor] = useState<string | null>(null);
  const [adding, setAdding] = useState<ChainContactRow | null>(null);
  const [emailDraft, setEmailDraft] = useState<{ leadId: string; contact: DraftContact } | null>(null);
  const [retry, setRetry] = useState(0);
  const expandedRef = useRef<Set<string>>(new Set());
  const firstLoadRef = useRef(true);
  const updateExpanded = (next: Set<string>) => {
    expandedRef.current = next;
    setExpanded(next);
  };

  const load = useCallback(
    async (signal?: AbortSignal) => {
      const expand = [...expandedRef.current];
      const [nextChain, nextContacts] = await Promise.all([
        getChain(leadId, { expand, signal }),
        getChainContacts(leadId, { expand, signal }).catch((err: unknown) => {
          if (signal?.aborted) throw err;
          return null;
        }),
      ]);
      // First load: show the tier-3 suppliers the server already included (identified tier-2 companies).
      if (firstLoadRef.current) {
        firstLoadRef.current = false;
        const withChildren = nextChain.nodes.filter((node) => node.tier === 2 && nextChain.nodes.some((other) => other.parentNodeId === node.nodeId));
        if (withChildren.length) {
          const next = new Set([...expandedRef.current, ...withChildren.map((node) => node.nodeId)]);
          expandedRef.current = next;
          setExpanded(next);
        }
      }
      setChain(nextChain);
      if (nextContacts) setContacts(nextContacts);
      setContactsLoading(false);
      setError(null);
    },
    [leadId],
  );

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setError({ message: err instanceof Error ? err.message : "Could not load the supply chain.", status: err instanceof ApiError ? err.status : 0 });
      setContactsLoading(false);
    });
    return () => controller.abort();
  }, [load, retry]);

  const toggleExpand = async (node: ChainNode) => {
    if (expanded.has(node.nodeId)) {
      updateExpanded(withSet(expanded, node.nodeId, false));
      return;
    }
    updateExpanded(withSet(expanded, node.nodeId, true));
    if (chain?.nodes.some((other) => other.parentNodeId === node.nodeId)) return;
    setBusy((previous) => withSet(previous, node.nodeId, true));
    try {
      await load();
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not load the next tier.", tone: "error" });
    } finally {
      setBusy((previous) => withSet(previous, node.nodeId, false));
    }
  };

  const runOnNode = async (node: ChainNode, action: () => Promise<unknown>, done: string) => {
    setBusy((previous) => withSet(previous, node.nodeId, true));
    try {
      await action();
      setCandidatesFor(null);
      await load();
      toast.show({ message: done, tone: "success" });
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "That didn’t work.", tone: "error" });
    } finally {
      setBusy((previous) => withSet(previous, node.nodeId, false));
    }
  };

  const submitContact = async (row: ChainContactRow, values: AddContactValues) => {
    if (!row.companyId) throw new Error("Set the company first.");
    await addContact({
      leadId,
      companyId: row.companyId,
      slotId: row.slotId,
      name: values.name,
      title: values.title || row.title,
      ...(values.email ? { email: values.email } : {}),
      ...(values.phone ? { phone: values.phone } : {}),
      ...(values.linkedinUrl ? { linkedinUrl: values.linkedinUrl } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    });
    toast.show({ message: `${values.name} added as Likely`, tone: "success" });
    await load().catch(() => undefined);
  };

  const confirm = async (row: ChainContactRow) => {
    if (!row.person) return;
    const key = rowKey(row);
    setBusyRows((previous) => withSet(previous, key, true));
    try {
      await confirmContact(row.person.id, { leadId, slotId: row.slotId, companyId: row.companyId });
      await load();
      toast.show({ message: `${row.person.name} confirmed`, tone: "success" });
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not confirm this contact.", tone: "error" });
    } finally {
      setBusyRows((previous) => withSet(previous, key, false));
    }
  };

  const openEmail = async (row: ChainContactRow) => {
    const node = chain?.nodes.find(item => item.nodeId === row.nodeId);
    if (!node?.companyId) return;
    const key = rowKey(row);
    setBusyRows(previous => withSet(previous, key, true));
    try {
      const targetLeadId = node.leadId || (node.derivedKey ? await saveDerivedBuyer(node.derivedKey) : null);
      if (!targetLeadId) throw new Error("Save this company as a buyer before drafting an email.");
      setEmailDraft({ leadId: targetLeadId, contact: {
        id: row.person?.id ?? null, name: row.person?.name ?? "Demo procurement contact", detail: row.person?.title || row.title,
        country: null, rule: null, email: row.person?.email || (demoEmail?.enabled ? DEMO_CONTACT_EMAIL : null),
        companyName: row.companyName, isDemo: !row.person,
      } });
    } catch (err) {
      toast.show({ message: err instanceof Error ? err.message : "Could not open the email draft.", tone: "error" });
    } finally { setBusyRows(previous => withSet(previous, key, false)); }
  };

  const findCandidates = (row: ChainContactRow) => {
    if (row.tier === 3) {
      const node = chain?.nodes.find((item) => item.nodeId === row.nodeId);
      if (node?.parentNodeId && !expanded.has(node.parentNodeId)) updateExpanded(withSet(expanded, node.parentNodeId, true));
    }
    setCandidatesFor(row.nodeId);
    requestAnimationFrame(() => {
      document.querySelector(`[data-node-id="${CSS.escape(row.nodeId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  return (
    <>
      <section id="supply-chain" aria-label="Supply chain" data-tour="buyer-chain" className="scroll-mt-20 rounded-[14px] border border-[var(--line)] bg-white px-[18px] py-4">
        {error ? (
          <div className="flex flex-col items-start gap-2">
            <h2 className="text-base font-bold text-[#111827]">Supply chain from this deal</h2>
            <p className="text-sm text-[#6b7280]">
              {error.status === 404 ? "The supply-chain service is not available on this server yet." : error.message}
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetry((value) => value + 1)}>Try again</button>
          </div>
        ) : chain ? (
          <SupplyChainTree
            chain={chain}
            rootShortName={rootShortName}
            expanded={expanded}
            busy={busy}
            candidatesFor={candidatesFor}
            onCandidatesFor={setCandidatesFor}
            onToggleExpand={(node) => void toggleExpand(node)}
            onSetCompany={(node, body) => runOnNode(node, () => setNodeCompany(leadId, node.nodeId, body), `${body.name} set as ${node.whatTheyDo || "the company"}`)}
            onRemoveCompany={(node) => runOnNode(node, () => removeNodeCompany(leadId, node.nodeId), `${node.name} removed`)}
          />
        ) : (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <span className="sr-only">Loading the supply chain…</span>
            <div className="skeleton h-6 w-1/2 rounded-md" />
            <div className="skeleton h-28 max-w-[420px] rounded-xl" />
            <div className="grid gap-2.5 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => <div key={index} className="skeleton h-28 rounded-xl" />)}
            </div>
          </div>
        )}
      </section>

      {!error ? (
        <section id="chain-contacts" aria-label="Contacts in this supply chain" className="scroll-mt-20 rounded-[14px] border border-[var(--line)] bg-white px-[18px] py-3.5">
          <ChainContactsTable rows={contacts} loading={contactsLoading} busy={busyRows} onAdd={setAdding} onConfirm={(row) => void confirm(row)} onFindCandidates={findCandidates} onEmail={(row) => void openEmail(row)} demoEmail={demoEmail?.enabled} />
        </section>
      ) : null}

      {adding ? (
        <AddContactModal company={adding.companyName} slotTitle={adding.title} onSubmit={(values) => submitContact(adding, values)} onClose={() => setAdding(null)} />
      ) : null}
      {emailDraft ? <DraftPanel key={`${emailDraft.leadId}:${emailDraft.contact.id || "demo"}`} leadId={emailDraft.leadId} contacts={[emailDraft.contact]} demoEmail={demoEmail} autoGenerate onClose={() => setEmailDraft(null)} onSent={() => router.refresh()} /> : null}
    </>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Bookmark, Check, Loader2, Search } from "lucide-react";
import type { LeadKind } from "@/mvp/types";
import { apiJson } from "./api-client";
import { RunProgress } from "./run-progress";
import { EVENTS, emit } from "./shell/events";
import { useToast } from "./shell/toast";
import Link from "next/link";
import { COUNTRIES } from "@/mvp/config/countries";
import { CONTACT_ROLES } from "@/mvp/opportunities/workflow";

interface TicketBody {
  ticketId: string;
  runId: string | null;
  state: string;
  position: number;
  error: string | null;
}

export interface FindFormProps {
  markets: { code: string; name: string }[];
  /** Product names and keywords offered as quick-fill chips. */
  suggestions: string[];
  products: { id: string; name: string }[];
  /** A run to show progress for on load (e.g. /find?run=…). */
  initialRunId?: string | null;
  /** A queued search to follow on load (e.g. /find?ticket=…). */
  initialTicketId?: string | null;
}

/** Find (09 §4.1, 13 §7): what you offer + markets + lead type → Search now (queued) → live progress; Save this search. */
export function FindForm({ markets, products, suggestions, initialRunId = null, initialTicketId = null }: FindFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(products[0]?.name ?? "");
  const [selected, setSelected] = useState<string[]>(markets.map((market) => market.code));
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [contactRole, setContactRole] = useState("buyer");
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [ticketId, setTicketId] = useState<string | null>(initialRunId ? null : initialTicketId);
  const [position, setPosition] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [refreshHours, setRefreshHours] = useState<string>("6");
  const [saving, setSaving] = useState(false);
  const [seenInitial, setSeenInitial] = useState(initialRunId);
  if (initialRunId !== seenInitial) {
    setSeenInitial(initialRunId);
    if (initialRunId) setRunId(initialRunId);
  }

  // Waiting in line: poll the queue until the search has a run id.
  useEffect(() => {
    if (!ticketId || runId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const ticket = await apiJson<TicketBody>(`/api/mvp/queue/${encodeURIComponent(ticketId)}`);
        if (cancelled) return;
        setPosition(ticket.position);
        if (ticket.runId) {
          setRunId(ticket.runId);
          setTicketId(null);
          window.history.replaceState(null, "", `${pathname}?run=${ticket.runId}`);
          return;
        }
        if (ticket.state === "failed") {
          setError(ticket.error ?? "The search could not start.");
          setTicketId(null);
          return;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Lost the queued search.");
          setTicketId(null);
        }
        return;
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    let timer = setTimeout(poll, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticketId, runId, pathname]);

  const toggleMarket = (code: string) =>
    setSelected((current) => (current.includes(code) ? current.filter((value) => value !== code) : [...current, code]));

  const leadKinds = (): LeadKind[] => ["supply_subcontract"];

  const validate = (): boolean => {
    if (query.trim().length < 2) {
      setError("Type what you offer, e.g. “line pipe”.");
      return false;
    }
    if (!productId) { setError("Select the product you want to sell."); return false; }
    if (!selected.length || selected.length > 20) {
      setError("Pick between 1 and 20 countries.");
      return false;
    }
    return true;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const ticket = await apiJson<TicketBody>("/api/mvp/runs", { method: "POST", body: { query: query.trim(), productId, contactRole, markets: selected, leadKinds: leadKinds() } });
      emit(EVENTS.refreshStatus);
      if (ticket.runId) {
        setRunId(ticket.runId);
        window.history.replaceState(null, "", `${pathname}?run=${ticket.runId}`);
      } else {
        setRunId(null);
        setTicketId(ticket.ticketId);
        setPosition(ticket.position);
        toast.show({ message: "Another search is running. Yours starts right after it." });
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The search could not start.");
    } finally {
      setSubmitting(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!validate()) return;
    setSaving(true);
    try {
      await apiJson("/api/mvp/saved-searches", {
        method: "POST",
        body: {
          name: saveName.trim() || query.trim(),
          query: query.trim(),
          productId,
          contactRole,
          markets: selected,
          leadKinds: leadKinds(),
          refreshHours: refreshHours === "manual" ? null : Number(refreshHours),
          lastRunId: runId,
        },
      });
      toast.show({ message: refreshHours === "manual" ? "Search saved." : `Search saved. It refreshes every ${refreshHours} h while the app runs.`, tone: "success" });
      setSaveOpen(false);
      setSaveName("");
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The search could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const onFinished = useCallback(() => {
    emit(EVENTS.refreshStatus);
    startTransition(() => router.refresh());
  }, [router]);

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="card flex flex-col gap-4 p-4 sm:p-5" aria-label="Search for opportunities">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-semibold">Product to sell
            <select aria-label="Product to sell" className="control h-11 px-2" value={productId} onChange={e => { setProductId(e.target.value); setQuery(products.find(p => p.id === e.target.value)?.name ?? ""); }}>
              {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">Add a country
            <select aria-label="Add a country" className="control h-11 px-2" value="" onChange={e => { if (e.target.value && !selected.includes(e.target.value)) setSelected(s => [...s, e.target.value]); }}>
              <option value="">Select any country</option>
              {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <details className="text-sm"><summary className="cursor-pointer font-semibold text-[var(--text-2)]">Optional: prioritize a contact role</summary><p className="mt-2 text-xs text-[var(--text-2)]">Search finds projects and buying companies first. Relevant contacts are listed with role tags; procurement is the default outreach priority.</p>
          <label className="mt-2 flex max-w-md flex-col gap-1 text-sm font-semibold">Priority contact role
            <select aria-label="Priority contact role" className="control h-11 px-2" value={contactRole} onChange={e => setContactRole(e.target.value)}>
              {CONTACT_ROLES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        </details>
        <p className="text-xs text-[#6b7280]">Buyer-only search: companies that won work and could buy the selected product. No open tenders or project owners. Country selection does not guarantee source coverage.</p>
        <p className="rounded-lg bg-[var(--accent-soft)] p-3 text-sm">Automatic demo outreach starts after product fit and named-contact validation pass, if enabled before this search. <Link href="/outreach" className="font-semibold text-[var(--accent-2)] underline">Set up email automation →</Link></p>
        <div className="flex flex-col gap-2 sm:flex-row" data-tour="find-query">
          <label htmlFor="find-query" className="sr-only">What do you offer?</label>
          <input
            id="find-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='What do you offer? e.g. "line pipe", "piping"'
            maxLength={200}
            className="input h-11 min-w-0 flex-1 px-3 text-base"
          />
          <button type="submit" disabled={submitting} className="btn btn-primary h-11 px-5" data-tour="find-search-now">
            {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Search size={16} aria-hidden />}
            {submitting ? "Starting…" : "Search now"}
          </button>
        </div>

        {suggestions.length ? (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Suggestions from your products">
            {suggestions.map((text) => (
              <button key={text} type="button" onClick={() => { setQuery(text); const product = products.find(p => p.name === text); if (product) setProductId(product.id); }} className="chip hover:border-[var(--line-strong)]">
                {text}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-4" data-tour="find-markets">
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6b7280]">Markets</legend>
            {selected.map(code => COUNTRIES.find(c => c.code === code) ?? { code, name: code }).map((market) => {
              const on = selected.includes(market.code);
              return (
                <button
                  key={market.code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleMarket(market.code)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors ${
                    on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-2)]" : "border-[var(--line-strong)] bg-white text-[#4b5563] hover:border-[#b9bdc6]"
                  }`}
                >
                  {on ? <Check size={13} aria-hidden /> : null}
                  {market.name}
                </button>
              );
            })}
          </fieldset>

        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3" data-tour="find-save">
          {saveOpen ? (
            <div className="flex w-full flex-wrap items-end gap-2">
              <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1 text-xs font-semibold text-[#6b7280]">
                Name
                <input value={saveName} onChange={(event) => setSaveName(event.target.value)} placeholder={query || "e.g. Line pipe, Gulf"} maxLength={120} className="input h-9 px-2 text-sm font-normal text-[#111827]" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[#6b7280]">
                Refresh
                <select value={refreshHours} onChange={(event) => setRefreshHours(event.target.value)} className="control h-9 px-2 text-sm font-normal text-[#111827]">
                  <option value="6">Every 6 hours</option>
                  <option value="12">Every 12 hours</option>
                  <option value="24">Every 24 hours</option>
                  <option value="manual">Manual only</option>
                </select>
              </label>
              <button type="button" onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Bookmark size={15} aria-hidden />}
                Save
              </button>
              <button type="button" onClick={() => setSaveOpen(false)} className="btn btn-ghost">Cancel</button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setSaveOpen(true)} className="btn btn-secondary">
                <Bookmark size={15} aria-hidden />
                Save this search
              </button>
              <span className="text-xs text-[#6b7280]">Saved searches refresh by themselves every 6, 12 or 24 hours while the app runs.</span>
            </>
          )}
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-sm font-semibold text-[#b42318]">{error}</p>
        ) : null}
      </form>

      {ticketId && !runId ? (
        <section aria-label="Search progress" className="card flex items-center gap-2 p-4 text-sm text-[#374151]">
          <Loader2 size={16} className="animate-spin text-[var(--accent)]" aria-hidden />
          Waiting in line{position > 0 ? ` (number ${position})` : ""}: another search is running. Yours starts right after it.
        </section>
      ) : null}
      {runId ? <><RunProgress key={runId} runId={runId} onFinished={onFinished} /><Link href={`/crm?search=${runId}`} className="btn btn-primary self-start">Open this search’s CRM results</Link></> : null}
    </div>
  );
}

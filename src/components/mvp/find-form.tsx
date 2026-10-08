"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Bookmark, Check, Loader2, Search } from "lucide-react";
import type { LeadKind, RunInput } from "@/mvp/types";
import { apiJson } from "./api-client";
import { RunProgress } from "./run-progress";
import { EVENTS, emit } from "./shell/events";
import { useToast } from "./shell/toast";
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
  /** Preserve the selected search's material/countries when opening its progress. */
  initialInput?: RunInput | null;
}

/** Find (09 §4.1, 13 §7): what you offer + markets + lead type → Search now (queued) → live progress; Save this search. */
export function FindForm({ markets, products, initialRunId = null, initialTicketId = null, initialInput = null }: FindFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(initialInput?.query ?? products[0]?.name ?? "");
  const [selected, setSelected] = useState<string[]>(initialInput?.markets ?? markets.map((market) => market.code));
  const [productId, setProductId] = useState(initialInput?.productId ?? products[0]?.id ?? "");
  const [contactRole, setContactRole] = useState(initialInput?.contactRole ?? "buyer");
  const [researchMode, setResearchMode] = useState<"preview" | "batch" | "deep">(initialInput?.researchMode ?? "preview");
  const [targetCompanies, setTargetCompanies] = useState(initialInput?.targetCompanies ?? (initialInput?.researchMode === "deep" ? 50 : 20));
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
    if (initialRunId) {
      setRunId(initialRunId);
      if(initialInput){setQuery(initialInput.query);setSelected(initialInput.markets);setProductId(initialInput.productId??products[0]?.id??"");setContactRole(initialInput.contactRole??"buyer");setResearchMode(initialInput.researchMode??"preview");setTargetCompanies(initialInput.targetCompanies??(initialInput.researchMode==="deep"?50:20));}
    }
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
    if (!Number.isInteger(targetCompanies) || targetCompanies < (researchMode === "deep" ? 50 : 1) || targetCompanies > 100) {
      setError(researchMode === "deep" ? "Choose a deep-research target between 50 and 100 companies." : "Choose a research target between 1 and 100 companies.");return false;
    }
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
      const ticket = await apiJson<TicketBody>("/api/mvp/runs", { method: "POST", body: { query: query.trim(), productId, contactRole, researchMode, targetCompanies, markets: selected, leadKinds: leadKinds() } });
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
      <form onSubmit={submit} className="card flex flex-col gap-5 p-5 sm:p-6" aria-label="Search for opportunities">
        <div className="grid gap-5 sm:grid-cols-2" data-tour="find-query">
          <label className="flex flex-col gap-2 text-sm font-semibold">What do you sell?
            <select aria-label="Product to sell" data-main-search className="control h-12 px-3 font-normal" value={productId} onChange={e=>{setProductId(e.target.value);setQuery(products.find(p=>p.id===e.target.value)?.name??"");}}>
              {products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold">Where do you want buyers?
            <select aria-label="Add a country" className="control h-12 px-3 font-normal" value="" onChange={e=>{if(e.target.value&&!selected.includes(e.target.value))setSelected(s=>[...s,e.target.value]);}}>
              <option value="">Add a country</option>{COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <fieldset data-tour="find-markets">
          <legend className="mb-2 text-xs font-semibold text-[var(--muted)]">Selected countries · click to remove</legend>
          <div className="flex flex-wrap gap-2">{selected.map(code=>COUNTRIES.find(c=>c.code===code)??{code,name:code}).map(market=><button key={market.code} type="button" aria-pressed="true" aria-label={market.name} onClick={()=>toggleMarket(market.code)} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 text-sm text-[var(--accent-2)]"><Check size={13} aria-hidden />{market.name}<span aria-hidden>×</span><span className="sr-only">Remove country</span></button>)}</div>
          {!selected.length?<p className="text-sm text-[var(--muted)]">Add at least one country above.</p>:null}
        </fieldset>
        <details className="rounded-lg border border-[var(--line)] p-3 text-sm" open={Boolean(initialInput&&(initialInput.query!==products.find(p=>p.id===initialInput.productId)?.name||initialInput.researchMode==="deep"))}>
          <summary className="cursor-pointer font-semibold text-[var(--text-2)]">Advanced options · keywords, contact roles & research budget</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-semibold">Search keywords<input id="find-query" aria-label="What do you offer?" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200} className="input h-11 px-3 font-normal" /></label>
            <label className="flex flex-col gap-1 font-semibold">Priority contact role<select aria-label="Priority contact role" className="control h-11 px-2 font-normal" value={contactRole} onChange={e=>setContactRole(e.target.value)}>{CONTACT_ROLES.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label className="flex flex-col gap-1 font-semibold">Research mode<select aria-label="Research mode" className="control h-11 px-2 font-normal" value={researchMode} onChange={e=>{const mode=e.target.value as "preview"|"batch"|"deep";setResearchMode(mode);setTargetCompanies(mode==="deep"?50:20);}}><option value="preview">Preview · smallest research budget</option><option value="batch">Batch · broader bounded research</option><option value="deep">Deep · work toward 50–100 companies</option></select></label>
            <label className="flex flex-col gap-1 font-semibold">Target companies<input aria-label="Target companies" type="number" min={researchMode==="deep"?50:1} max={100} value={targetCompanies} onChange={e=>setTargetCompanies(Number(e.target.value))} className="input h-11 px-3 font-normal" /></label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">Optional: prioritize a contact role. All available contacts still appear with role tags. A research target is not a guaranteed number of leads; deeper modes may consume more credits. Companies appear even without contacts.</p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted)]">Relevant contractors and material-consuming companies · saved automatically · missing details stay blank. No supplier-only sellers, open tenders or project owners.</p>
          <button type="submit" disabled={submitting} className="btn btn-primary h-12 px-6" data-tour="find-search-now">{submitting?<Loader2 size={16} className="animate-spin" aria-hidden />:<Search size={16} aria-hidden />}{submitting?"Starting…":"Find buyers"}</button>
        </div>
        <details className="text-sm"><summary className="cursor-pointer text-[var(--muted)]">Schedule this search to refresh later</summary><div className="mt-3"><div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3" data-tour="find-save">
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
              <button type="button" onClick={save} disabled={saving} className="btn btn-secondary">
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
        </div></div></details>
        {error?<p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>:null}
      </form>

      {ticketId && !runId ? (
        <section aria-label="Search progress" className="card flex items-center gap-2 p-4 text-sm text-[#374151]">
          <Loader2 size={16} className="animate-spin text-[var(--accent)]" aria-hidden />
          Waiting in line{position > 0 ? ` (number ${position})` : ""}: another search is running. Yours starts right after it.
        </section>
      ) : null}
      {runId ? <RunProgress key={runId} runId={runId} onFinished={onFinished} /> : null}
    </div>
  );
}

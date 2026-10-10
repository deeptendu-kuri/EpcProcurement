"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { parseMaterialSpec, specChips } from "@/mvp/discovery/spec";
import { Bookmark, Check, Loader2, Search } from "lucide-react";
import type { LeadKind, RunInput } from "@/mvp/types";
import { apiJson } from "./api-client";
import { EVENTS, emit } from "./shell/events";
import { useToast } from "./shell/toast";
import { COUNTRIES } from "@/mvp/config/countries";
import { CONTACT_ROLES } from "@/mvp/opportunities/workflow";
import { interpretMaterial, type MaterialEntry } from "@/mvp/discovery/interpret";

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
  /** Material vocabulary for free-text search (catalogue terms, market words, who buys). */
  materials?: MaterialEntry[];
  /** A run to show progress for on load (e.g. /find?run=…). */
  initialRunId?: string | null;
  /** A queued search to follow on load (e.g. /find?ticket=…). */
  initialTicketId?: string | null;
  /** Preserve the selected search's material/countries when opening its progress. */
  initialInput?: RunInput | null;
  /** Free AI tokens left over the last 24 hours across the search models; null = no daily limit. */
  aiLeft?: number | null;
}

/**
 * Search sizes with honest time and AI estimates (free AI tier: about 7,000 tokens a minute, about 200,000 a
 * day per model). Quick takes no extra rounds; Deep takes the server's extra rounds and may use most of a
 * day's allowance.
 */
const SIZES = {
  quick: { label: "Quick", mode: "preview", target: 10, extraRounds: 0, tokens: 60_000, time: "About 10 minutes · up to 60k AI tokens", hint: "A first batch of leads. Good for a demo." },
  standard: { label: "Standard", mode: "batch", target: 20, extraRounds: 0, tokens: 120_000, time: "About 20 minutes · up to 120k AI tokens", hint: "More searches and pages per country." },
  deep: { label: "Deep", mode: "deep", target: 50, extraRounds: undefined, tokens: 250_000, time: "An hour or more · may use the day's AI allowance", hint: "Keeps searching until 50+ companies are verified." },
} as const satisfies Record<string, { label: string; mode: "preview" | "batch" | "deep"; target: number; extraRounds: number | undefined; tokens: number; time: string; hint: string }>;
type SizeKey = keyof typeof SIZES;
const sizeOf = (mode: "preview" | "batch" | "deep" | undefined): SizeKey => mode === "deep" ? "deep" : mode === "batch" ? "standard" : "quick";

/** Find (09 §4.1, 13 §7): what you offer + markets + lead type → Search now (queued) → live progress; Save this search. */
export function FindForm({ markets, products, materials: givenMaterials, initialRunId = null, initialTicketId = null, initialInput = null, aiLeft = null }: FindFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [query, setQuery] = useState(initialInput?.query ?? "");
  const [selected, setSelected] = useState<string[]>(initialInput?.markets ?? markets.map((market) => market.code));
  const [productId, setProductId] = useState(initialInput?.productId ?? "");
  // The words the user picked a type for: a manual choice holds until the words change.
  const [pickedFor, setPickedFor] = useState<string | null>(initialInput?.productId ? initialInput.query : null);
  const materials = useMemo<MaterialEntry[]>(() => givenMaterials ?? products.map((p) => ({ id: p.id, name: p.name, shortName: p.name, category: "", terms: [p.name.toLowerCase()], standards: [], whoBuys: [] })), [givenMaterials, products]);
  const reading = useMemo(() => interpretMaterial(materials, query), [materials, query]);
  const chosen = materials.find((m) => m.id === productId) ?? null;
  // Follow the words: pre-select the best type unless the user picked one for these words.
  const suggested = reading.best?.id ?? "";
  if (pickedFor !== query && suggested !== productId && (suggested || !query.trim())) setProductId(suggested);
  const [contactRole, setContactRole] = useState(initialInput?.contactRole ?? "buyer");
  const [includeResellers, setIncludeResellers] = useState(initialInput?.includeResellers !== false);
  const variant = useMemo(() => specChips(parseMaterialSpec(query)), [query]);
  const [researchMode, setResearchMode] = useState<"preview" | "batch" | "deep">(initialInput?.researchMode ?? "preview");
  const [targetCompanies, setTargetCompanies] = useState(initialInput?.targetCompanies ?? SIZES[sizeOf(initialInput?.researchMode)].target);
  const [pauseOn, setPauseOn] = useState(Boolean(initialInput?.pauseAfter));
  const [pauseAfter, setPauseAfter] = useState(initialInput?.pauseAfter ?? 10);
  const size = sizeOf(researchMode);
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
      if(initialInput){setQuery(initialInput.query);setSelected(initialInput.markets);setProductId(initialInput.productId??products[0]?.id??"");setContactRole(initialInput.contactRole??"buyer");setResearchMode(initialInput.researchMode??"preview");setTargetCompanies(initialInput.targetCompanies??SIZES[sizeOf(initialInput.researchMode)].target);setPauseOn(Boolean(initialInput.pauseAfter));setPauseAfter(initialInput.pauseAfter??10);}
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
          router.push(`/find?run=${ticket.runId}`);
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
  }, [ticketId, runId, router]);

  const toggleMarket = (code: string) =>
    setSelected((current) => (current.includes(code) ? current.filter((value) => value !== code) : [...current, code]));

  const leadKinds = (): LeadKind[] => ["supply_subcontract"];

  const validate = (): boolean => {
    if (query.trim().length < 2) {
      setError("Type what you supply, e.g. “steel pipe” or “steel plates”.");
      return false;
    }
    if (!productId) { setError("Choose the product type that fits what you supply."); return false; }
    if (!Number.isInteger(targetCompanies) || targetCompanies < (researchMode === "deep" ? 50 : 1) || targetCompanies > 100) {
      setError(researchMode === "deep" ? "Choose a deep-research target between 50 and 100 companies." : "Choose a research target between 1 and 100 companies.");return false;
    }
    if (pauseOn && (!Number.isInteger(pauseAfter) || pauseAfter < 1 || pauseAfter > 100)) { setError("Choose when to pause: after 1 to 100 leads."); return false; }
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
      const ticket = await apiJson<TicketBody>("/api/mvp/runs", { method: "POST", body: { query: query.trim(), productId, contactRole, researchMode, targetCompanies, includeResellers, markets: selected, leadKinds: leadKinds(),
        ...(SIZES[size].extraRounds !== undefined ? { extraRounds: SIZES[size].extraRounds } : {}), ...(pauseOn ? { pauseAfter } : {}) } });
      emit(EVENTS.refreshStatus);
      if (ticket.runId) {
        // The search's own workspace shows its live progress and shortlist.
        setRunId(ticket.runId);
        router.push(`/find?run=${ticket.runId}`);
        return;
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


  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="card flex flex-col gap-5 p-5 sm:p-6" aria-label="Search for opportunities">
        <div className="flex flex-col gap-3" data-tour="find-query">
          <label htmlFor="find-query" className="text-sm font-semibold">What do you supply?</label>
          <div className="relative">
            <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
            <input id="find-query" type="search" data-main-search value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}
              placeholder="e.g. steel pipe, seamless pipe A106, steel plates, ductile iron pipe" autoComplete="off" className="input h-14 w-full pl-11 pr-4 text-base" />
          </div>
          {query.trim().length>=2?<div className="rounded-xl border border-[var(--line)] bg-[var(--subtle)] p-4" aria-live="polite">
            <p className="text-sm">{reading.family?<><strong>{reading.family}</strong> has several types. Choose the one you sell:</>:reading.best?<>Searching for <strong>{chosen?.shortName??reading.best.label}</strong>{variant.length?<> · <strong>{variant.join(" · ")}</strong></>:null}{reading.choices.length>1?" · other types:":""}</>:reading.choices.length?<>Not in your product list. Closest matches:</>:<>This material is not in your product list yet. Choose the closest type:</>}</p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Product type">
              {reading.choices.map(c=><button key={c.id} type="button" aria-pressed={productId===c.id} title={c.detail} onClick={()=>{setProductId(c.id);setPickedFor(query);}}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm ${productId===c.id?"border-[var(--accent)] bg-[var(--accent-soft)] font-semibold text-[var(--accent-2)]":"border-[var(--line)] bg-white"}`}>{productId===c.id?<Check size={13} aria-hidden/>:null}{c.label}</button>)}
              {!reading.choices.length?<select aria-label="Product to sell" className="control h-9 px-2 text-sm" value={productId} onChange={e=>{setProductId(e.target.value);setPickedFor(query);}}><option value="">Choose a product type…</option>{materials.map(m=><option key={m.id} value={m.id}>{m.shortName}</option>)}</select>:null}
            </div>
            {chosen?.whoBuys.length?<p className="mt-3 text-xs leading-relaxed text-[var(--text-2)]"><strong>Who buys {chosen.shortName}:</strong> {chosen.whoBuys.join(" · ")}. We look for these companies and the subcontractors below them.</p>:null}
            {variant.length?<p className="mt-1 text-xs leading-relaxed text-[var(--text-2)]">Companies that name <strong>{variant.join(" · ")}</strong> are ranked first; others that use {chosen?.shortName??"this product"} still appear.</p>:null}
          </div>:null}
          <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] p-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={includeResellers} onChange={(e) => setIncludeResellers(e.target.checked)} aria-label="Also find stockists and traders" />
            <span><span className="font-semibold">Also find stockists and traders</span><span className="block text-xs text-[var(--muted)]">Companies that buy {chosen?.shortName ?? "this material"} to resupply contractors. Turn off if you only sell to end users and contractors; they then count as competitors.</span></span>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold sm:max-w-md">Where do you want buyers?
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
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">How big a search?</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Search size">
            {(Object.keys(SIZES) as SizeKey[]).map(key=>{const z=SIZES[key];return <button key={key} type="button" role="radio" aria-checked={size===key} onClick={()=>{setResearchMode(z.mode);setTargetCompanies(z.target);}}
              className={`rounded-xl border p-3 text-left text-sm transition ${size===key?"border-[var(--accent)] bg-[var(--accent-soft)]":"border-[var(--line)] bg-white hover:bg-[var(--hover)]"}`}>
              <span className="block font-semibold">{z.label}</span><span className="block text-xs text-[var(--text-2)]">{z.time}</span><span className="mt-1 block text-xs text-[var(--muted)]">{z.hint}</span></button>;})}
          </div>
          {aiLeft !== null ? <p className={`text-xs ${aiLeft < SIZES[size].tokens ? "rounded-lg bg-[var(--warn-bg)] px-3 py-2 text-[var(--warn)]" : "text-[var(--muted)]"}`} role={aiLeft < SIZES[size].tokens ? "alert" : undefined}>
            Free AI left (last 24 hours): about {Math.round(aiLeft / 1000)}k tokens.{aiLeft < SIZES[size].tokens ? ` A ${SIZES[size].label} search needs up to ${Math.round(SIZES[size].tokens / 1000)}k, so it may wait for the allowance part-way. Leads found are kept.` : ""}
          </p> : null}
          <label className="flex flex-wrap items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={pauseOn} onChange={e=>setPauseOn(e.target.checked)} aria-label="Pause when leads are found" />
            <span>Pause when</span>
            <input type="number" min={1} max={100} value={pauseAfter} onChange={e=>{setPauseAfter(Number(e.target.value));setPauseOn(true);}} aria-label="Leads before pausing" className="input h-9 w-20 px-2" />
            <span>leads are found, so I can review them, then resume or finish.</span>
          </label>
        </fieldset>
        <details className="rounded-lg border border-[var(--line)] p-3 text-sm" open={Boolean(initialInput&&initialInput.researchMode==="deep")}>
          <summary className="cursor-pointer font-semibold text-[var(--text-2)]">Advanced options · contact role and target</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-semibold">Priority contact role<select aria-label="Priority contact role" className="control h-11 px-2 font-normal" value={contactRole} onChange={e=>setContactRole(e.target.value)}>{CONTACT_ROLES.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
            <label className="flex flex-col gap-1 font-semibold">Target companies<input aria-label="Target companies" type="number" min={researchMode==="deep"?50:1} max={100} value={targetCompanies} onChange={e=>setTargetCompanies(Number(e.target.value))} className="input h-11 px-3 font-normal" /></label>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">Optional: prioritize a contact role. All available contacts still appear with role tags. A research target is not a guaranteed number of leads; deeper modes may consume more credits. Companies appear even without contacts.</p>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--line)] pt-4">
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--muted)]">Finds companies that buy this material for engineering work: contractors, subcontractors and fabrication shops, each with the source that shows why. Results are saved automatically; missing details stay blank.</p>
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
    </div>
  );
}

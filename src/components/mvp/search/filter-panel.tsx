"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  Factory,
  Gauge,
  Home,
  MapPin,
  Network,
  PackageSearch,
  PanelLeftClose,
  Scale,
  Search,
  Shapes,
  Upload,
  UsersRound,
  Waypoints,
  Zap,
} from "lucide-react";
import type { BuyerFacets, BuyerRole, BuyerSignal, BuyerStage, ChainTier, SlotRole } from "@/mvp/buyers/types";
import { TRIGGER_KIND_LABELS } from "@/mvp/buyers/types";

const TIER_OPTION_LABELS: Record<ChainTier, string> = { 1: "Tier 1 · won the work", 2: "Tier 2 · supplies them", 3: "Tier 3 · supplies tier 2" };
import {
  BUYER_ROLE_LABELS,
  BUYER_STAGE_LABELS,
  DEPARTMENTS,
  HOW_SURE_LABELS,
  INDUSTRIES,
  LINK_LEGEND,
  REACH_LABELS,
  SIGNAL_LABELS,
  SLOT_ROLE_LABELS,
} from "./buyer-labels";
import { AnyNotChips, Chip, SubLabel, Switch, type ChipOption } from "./filter-chips";
import {
  CATEGORY_PREFIX,
  HOW_SURE,
  LINKS,
  REACH,
  ROLES,
  SIGNALS,
  SLOT_ROLES,
  STAGES,
  TIERS,
  WITHIN_DAYS,
  activeFilterCount,
  type CatalogueOption,
  type HowSure,
  type KnownLink,
  type Reach,
  type SearchUrlState,
} from "./search-state";

export interface MarketOption {
  code: string;
  name: string;
}

function countOf(facets: { value: string; count: number }[] | undefined, value: string): number | undefined {
  return facets?.find((facet) => facet.value === value)?.count;
}

/**
 * Once results are counted, offer only the options some company in the current scope has (plus anything
 * already chosen), so every choice narrows the list instead of emptying it.
 */
export function available<T extends { value: string; count?: number }>(options: T[], selected: readonly string[], counted: boolean): T[] {
  return counted ? options.filter((option) => (option.count ?? 0) > 0 || selected.includes(option.value)) : options;
}

function Group({
  icon,
  title,
  active = 0,
  defaultOpen = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  active?: number;
  defaultOpen?: boolean;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || active > 0);
  return (
    <section className="border-b border-[var(--line)] py-3">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2.5 text-left text-[15px] text-[#1f2937] hover:text-[#111827]"
        >
          <span className="flex w-5 justify-center text-[#64748b]" aria-hidden>{icon}</span>
          <span className="flex-1">{title}</span>
          {active > 0 && !open ? <span className="count-badge count-badge-accent">{active}</span> : null}
          {open ? <ChevronUp size={14} className="text-[#94a3b8]" aria-hidden /> : <ChevronDown size={14} className="text-[#94a3b8]" aria-hidden />}
        </button>
      </h3>
      {open ? <div className="ml-[30px] mt-1">{children}</div> : null}
    </section>
  );
}

/** Single-value chips (e.g. "Last 90 days"): a selected chip or the offered ones. */
function OneOf<T extends string | number>({ value, options, onChange }: {
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {selected ? (
        <Chip label={selected.label} onRemove={() => onChange(null)} />
      ) : (
        options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => onChange(option.value)}
            className="inline-flex items-center rounded-md bg-[#f3f4f6] px-2 py-[3px] text-[12.5px] text-[#6b7280] hover:bg-[#e5e7eb]"
          >
            + {option.label}
          </button>
        ))
      )}
    </div>
  );
}

function NumberField({ label, value, onCommit, placeholder }: { label: string; value: number | null; onCommit: (value: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const commit = () => {
    const parsed = text.trim() === "" ? null : Number(text.replace(/[, ]/g, ""));
    onCommit(parsed === null || !Number.isFinite(parsed) ? null : parsed);
  };
  return (
    <label className="flex flex-1 flex-col gap-0.5 text-xs text-[var(--muted)]">
      {label}
      <input
        inputMode="numeric"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-1 text-[13px] text-[#374151] focus:border-[var(--accent)] focus:outline-none"
      />
    </label>
  );
}

function TextCommit({ label, value, placeholder, onCommit, multiline = false }: {
  label: string;
  value: string;
  placeholder: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value);
  const common = {
    value: text,
    placeholder,
    "aria-label": label,
    onBlur: () => onCommit(text.trim()),
    className:
      "w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-1 text-[13px] text-[#374151] placeholder:text-[#9ca3af] focus:border-[var(--accent)] focus:outline-none",
  };
  return multiline ? (
    <textarea {...common} rows={4} onChange={(event) => setText(event.target.value)} className={`${common.className} resize-y`} />
  ) : (
    <input
      {...common}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(text.trim());
      }}
    />
  );
}

export interface FilterPanelProps {
  state: SearchUrlState;
  facets: BuyerFacets | null;
  catalogue: CatalogueOption[];
  markets: MarketOption[];
  onChange: (change: Partial<SearchUrlState>) => void;
  onCollapse?: () => void;
  onClear: () => void;
}

/**
 * SuperSearch filter panel (docs/mvp/14 §10, mockup supersearch-v2): collapsible sections with
 * "Is any of / Is not any of" chips. Every change goes to the URL.
 */
export function FilterPanel({ state, facets, catalogue, markets, onChange, onCollapse, onClear }: FilterPanelProps) {
  const [q, setQ] = useState(state.q);

  const countryOptions: ChipOption[] = (facets?.countries??[]).map(f=>({value:f.value,label:markets.find(m=>m.code===f.value)?.name??f.label,count:f.count}));
  const roleOptions: ChipOption[] = ROLES.map((role) => ({ value: role, label: BUYER_ROLE_LABELS[role], count: countOf(facets?.roles, role) }));

  const counted = facets !== null;
  const categories = [...new Set(catalogue.map((item) => item.category))];
  const categoryCount = (category: string) => catalogue.filter((item) => item.category === category).reduce((n, item) => n + (countOf(facets?.items, item.id) ?? 0), 0);
  const sellOptions: ChipOption[] = [
    ...categories.map((category) => ({ value: `${CATEGORY_PREFIX}${category}`, label: category, count: counted ? categoryCount(category) || undefined : undefined })),
    ...catalogue.map((item) => ({ value: item.id, label: item.name, count: countOf(facets?.items, item.id) })),
  ];
  // Items the server knows but the local catalogue does not (e.g. edited catalogue).
  for (const facet of facets?.items ?? []) if (!sellOptions.some((option) => option.value === facet.value)) sellOptions.push({ value: facet.value, label: facet.label, count: facet.count });

  const industryOptions: ChipOption[] = (() => {
    const values = new Map<string, ChipOption>(INDUSTRIES.map((option) => [option.value, { ...option }]));
    for (const facet of facets?.industries ?? []) values.set(facet.value, { value: facet.value, label: facet.label, count: facet.count });
    return [...values.values()];
  })();

  const active = activeFilterCount(state);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--line)] px-[18px]">
        <div>
          <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-[var(--text)]">SuperSearch</h2>
          <p className="text-[12px] text-[var(--muted)]">Filters apply to the selected search</p>
        </div>
        <div className="flex items-center gap-1">
          {active ? (
            <button type="button" onClick={onClear} className="btn btn-ghost btn-sm text-xs">
              Clear all
            </button>
          ) : null}
          {onCollapse ? (
            <button type="button" onClick={onCollapse} aria-label="Hide SuperSearch" title="Hide SuperSearch" className="btn btn-ghost btn-sm btn-icon text-[#94a3b8]">
              <PanelLeftClose size={16} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-8" data-tour="search-filters">
        <form
          className="relative mt-3"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            onChange({ q: q.trim() });
          }}
        >
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9ca3af]" aria-hidden />
          <label htmlFor="search-q" className="sr-only">Company, project or product</label>
          <input
            id="search-q"
            data-main-search
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onBlur={() => q.trim() !== state.q && onChange({ q: q.trim() })}
            placeholder="Filter saved companies"
            className="input h-9 w-full pl-8 text-sm"
          />
        </form>

        <Group icon={<MapPin size={15} />} title="Location" defaultOpen active={state.locAny.length + state.locNot.length}>
          <AnyNotChips
            options={available(countryOptions, [...state.locAny, ...state.locNot], counted)}
            any={state.locAny}
            not={state.locNot}
            freeText
            placeholder="Add country, region or city…"
            onChange={({ any, not }) => onChange({ locAny: any, locNot: not })}
          />
          <Switch
            checked={state.basis === "site"}
            onChange={(site) => onChange({ basis: site ? "site" : "hq" })}
            label={state.basis === "site" ? "Location of the project site (switch to company HQ)" : "Location of the company HQ (switch to project site)"}
            before="Company HQ"
            after="Project site"
          />
        </Group>

        <Group icon={<Home size={15} />} title="Buyer role" defaultOpen active={state.roleAny.length + state.roleNot.length}>
          <AnyNotChips
            options={available(roleOptions, [...state.roleAny, ...state.roleNot], counted)}
            any={state.roleAny}
            not={state.roleNot}
            placeholder="Exclude a role…"
            onChange={({ any, not }) => onChange({ roleAny: any as BuyerRole[], roleNot: not as BuyerRole[] })}
          />
        </Group>

        <Group icon={<Network size={15} />} title="Supply chain tier" defaultOpen active={state.tiers.length}>
          <AnyNotChips
            options={available(TIERS.map((tier) => ({ value: String(tier), label: TIER_OPTION_LABELS[tier], count: countOf(facets?.tiers, String(tier)) })), state.tiers.map(String), counted)}
            any={state.tiers.map(String)}
            anyLabel={null}
            showNot={false}
            onChange={({ any }) => onChange({ tiers: any.map(Number).filter((tier): tier is ChainTier => tier === 1 || tier === 2 || tier === 3) })}
          />
        </Group>

        <Group icon={<Waypoints size={15} />} title="How we know" active={state.links.length}>
          <SubLabel>For tier 2 and 3 companies</SubLabel>
          <AnyNotChips
            options={available(LINKS.map((link) => ({ value: link, label: LINK_LEGEND[link], count: countOf(facets?.linkStatus, link) })), state.links, counted)}
            any={state.links}
            anyLabel={null}
            showNot={false}
            onChange={({ any }) => onChange({ links: any as KnownLink[] })}
          />
        </Group>

        <Group icon={<PackageSearch size={15} />} title="What we can sell them" defaultOpen active={state.sell.length + (state.hideCompetitors ? 0 : 1)}>
          <SubLabel>From your product catalogue</SubLabel>
          <AnyNotChips
            options={available(sellOptions, state.sell, counted)}
            any={state.sell}
            anyLabel={null}
            showNot={false}
            maxOffered={categories.length || 8}
            onChange={({ any }) => onChange({ sell: any })}
          />
          <Switch checked={state.hideCompetitors} onChange={(hideCompetitors) => onChange({ hideCompetitors })} label="Hide competitors" before="Hide competitors" />
        </Group>

        <Group icon={<Zap size={15}/>} title="Trigger" defaultOpen active={state.triggerKinds.length+(state.triggerAge?1:0)}>
          <label className="block text-xs">Trigger kind<select aria-label="Trigger kind" className="control mt-1 w-full" value={state.triggerKinds[0]??''} onChange={e=>onChange({triggerKinds:e.target.value?[e.target.value as import('@/mvp/buyers/types').TriggerKind]:[]})}><option value="">All triggers</option>{(['award','order','tender','subcontract','capability'] as const).filter(v=>!counted||countOf(facets?.triggers,v)||state.triggerKinds.includes(v)).map(v=><option key={v} value={v}>{TRIGGER_KIND_LABELS[v]}{counted?` (${countOf(facets?.triggers,v)??0})`:''}</option>)}</select></label>
          <label className="mt-2 block text-xs">Trigger age<select aria-label="Trigger age" className="control mt-1 w-full" value={state.triggerAge} onChange={e=>onChange({triggerAge:e.target.value})}><option value="">Any date</option>{[30,90,365,540].map(n=><option key={n} value={n}>Last {n} days</option>)}<option value="undated">Date not established</option></select></label>
        </Group>
        <Group icon={<Zap size={15} />} title="Buying signal" active={state.signals.length + (state.withinDays ? 1 : 0)}>
          <AnyNotChips
            options={available(SIGNALS.map((signal) => ({ value: signal, label: SIGNAL_LABELS[signal], count: countOf(facets?.signals, signal) })), state.signals, counted)}
            any={state.signals}
            anyLabel={null}
            showNot={false}
            onChange={({ any }) => onChange({ signals: any as BuyerSignal[] })}
          />
          <SubLabel>Happened in</SubLabel>
          <OneOf
            value={state.withinDays}
            options={WITHIN_DAYS.map((days) => ({ value: days, label: days === 365 ? "Last 12 months" : `Last ${days} days` }))}
            onChange={(withinDays) => onChange({ withinDays })}
          />
        </Group>

        <Group icon={<UsersRound size={15} />} title="Contacts" defaultOpen active={state.departments.length + state.slotRoles.length + (state.onlyWithFound ? 1 : 0)}>
          <AnyNotChips
            options={DEPARTMENTS.map((name) => ({ value: name, label: name }))}
            any={state.departments}
            anyLabel="Department"
            showNot={false}
            onChange={({ any }) => onChange({ departments: any })}
          />
          <AnyNotChips
            options={SLOT_ROLES.map((role) => ({ value: role, label: SLOT_ROLE_LABELS[role] }))}
            any={state.slotRoles}
            anyLabel="Buying role"
            showNot={false}
            onChange={({ any }) => onChange({ slotRoles: any as SlotRole[] })}
          />
          <Switch checked={state.onlyWithFound} onChange={(onlyWithFound) => onChange({ onlyWithFound })} label="Only buyers with a contact found" before="Only with a contact found" />
        </Group>

        <Group icon={<Factory size={15} />} title="Industry and project type" active={state.industry.length}>
          <AnyNotChips options={available(industryOptions, state.industry, counted)} any={state.industry} anyLabel={null} showNot={false} onChange={({ any }) => onChange({ industry: any })} />
        </Group>

        <Group icon={<CircleDollarSign size={15} />} title="Order / project value" active={(state.valueMin !== null ? 1 : 0) + (state.valueMax !== null ? 1 : 0)}>
          <div className="flex gap-3">
            <NumberField label="From (USD)" value={state.valueMin} placeholder="e.g. 1000000" onCommit={(valueMin) => onChange({ valueMin })} />
            <NumberField label="To (USD)" value={state.valueMax} placeholder="Any" onCommit={(valueMax) => onChange({ valueMax })} />
          </div>
        </Group>

        <Group icon={<Shapes size={15} />} title="Lookalike company" active={state.lookalike ? 1 : 0}>
          <SubLabel>Buyers similar to</SubLabel>
          <TextCommit label="Lookalike company" value={state.lookalike} placeholder="Company name" onCommit={(lookalike) => onChange({ lookalike })} />
        </Group>

        <Group icon={<Upload size={15} />} title="Upload company list" active={state.companies.length}>
          <SubLabel>One company name per line (or paste from a spreadsheet)</SubLabel>
          <TextCommit
            multiline
            label="Company list"
            value={state.companies.join("\n")}
            placeholder={"Company A\nCompany B"}
            onCommit={(text) => onChange({ companies: [...new Set(text.split(/[\n,;\t]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 200) })}
          />
          <label className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-[var(--accent)] hover:underline">
            <Upload size={12} aria-hidden /> Choose a .csv or .txt file
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                const names = text
                  .split(/\r?\n/)
                  .map((line) => line.split(/[,;\t]/)[0]?.replace(/^"|"$/g, "").trim() ?? "")
                  .filter(Boolean);
                onChange({ companies: [...new Set(names)].slice(0, 200) });
              }}
            />
          </label>
        </Group>

        <Group icon={<Scale size={15} />} title="Contact rules by country" active={state.reach.length}>
          <AnyNotChips
            options={available(REACH.map((value) => ({ value, label: REACH_LABELS[value], count: countOf(facets?.reach, value) })), state.reach, counted)}
            any={state.reach}
            anyLabel={null}
            showNot={false}
            onChange={({ any }) => onChange({ reach: any as Reach[] })}
          />
        </Group>

        <Group icon={<Gauge size={15} />} title="Buyer fit and how sure we are" active={state.stage.length + state.howSure.length + (state.minFit !== null ? 1 : 0)}>
          <AnyNotChips
            options={available(STAGES.map((stage) => ({ value: stage, label: BUYER_STAGE_LABELS[stage], count: countOf(facets?.stages, stage) })), state.stage, counted)}
            any={state.stage}
            anyLabel="Stage"
            showNot={false}
            onChange={({ any }) => onChange({ stage: any as BuyerStage[] })}
          />
          <AnyNotChips
            options={available(HOW_SURE.map((value) => ({ value, label: HOW_SURE_LABELS[value], count: countOf(facets?.howSure, value) })), state.howSure, counted)}
            any={state.howSure}
            anyLabel="How sure we are"
            showNot={false}
            onChange={({ any }) => onChange({ howSure: any as HowSure[] })}
          />
          <SubLabel>Buyer fit at least</SubLabel>
          <OneOf
            value={state.minFit}
            options={[40, 50, 60, 70].map((value) => ({ value, label: `${value}+` }))}
            onChange={(minFit) => onChange({ minFit })}
          />
        </Group>
      </div>
    </div>
  );
}

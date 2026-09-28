"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";

export interface ChipOption {
  value: string;
  label: string;
  /** Matching buyers (from the search facets), when known. */
  count?: number;
}

/** A selected value chip (blue, with ✕), or an excluded one (red). */
export function Chip({ label, tone = "any", onRemove }: { label: string; tone?: "any" | "not"; onRemove: () => void }) {
  const style = tone === "not" ? "bg-[#fef2f2] text-[#b91c1c] hover:bg-[#fee2e2]" : "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[#dfe9ff]";
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className={`inline-flex items-center gap-1 rounded-md px-2 py-[3px] text-[12.5px] font-medium ${style}`}
    >
      {tone === "not" ? <span className="sr-only">Not </span> : null}
      {label}
      <X size={12} aria-hidden />
    </button>
  );
}

/** A grey "+ Option" chip that adds a value. */
export function AddChip({ label, count, onAdd }: { label: string; count?: number; onAdd: () => void }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={`Add ${label}`}
      className="inline-flex items-center gap-1 rounded-md bg-[#f3f4f6] px-2 py-[3px] text-[12.5px] text-[#6b7280] hover:bg-[#e5e7eb] hover:text-[#374151]"
    >
      <Plus size={11} aria-hidden />
      {label}
      {count !== undefined ? <span className="tabular-nums text-[#9ca3af]">{count}</span> : null}
    </button>
  );
}

export function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-1 mt-2 text-xs text-[var(--muted)]">{children}</p>;
}

/**
 * "Is any of / Is not any of" chips (docs/mvp/14 §10). Offered options add to "any"; the
 * "Is not any of" row excludes values, from the list or (with `freeText`) typed in.
 */
export function AnyNotChips({
  options,
  any,
  not = [],
  onChange,
  showNot = true,
  freeText = false,
  placeholder = "Exclude…",
  anyLabel = "Is any of",
  notLabel = "Is not any of",
  maxOffered = 8,
}: {
  options: ChipOption[];
  any: string[];
  not?: string[];
  onChange: (next: { any: string[]; not: string[] }) => void;
  showNot?: boolean;
  /** Let people type values that are not in the list (e.g. a city). */
  freeText?: boolean;
  placeholder?: string;
  anyLabel?: string | null;
  notLabel?: string;
  maxOffered?: number;
}) {
  const inputId = useId();
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const labelOf = (value: string) => options.find((option) => option.value === value)?.label ?? value;
  const taken = new Set([...any, ...not]);
  const offered = options.filter((option) => !taken.has(option.value));
  const visibleOffered = showAll ? offered : offered.slice(0, maxOffered);

  const addAny = (value: string) => onChange({ any: [...any.filter((item) => item !== value), value], not: not.filter((item) => item !== value) });
  const addNot = (raw: string) => {
    const match = options.find((option) => option.label.toLowerCase() === raw.trim().toLowerCase() || option.value === raw.trim());
    const value = match ? match.value : raw.trim();
    if (!value) return;
    onChange({ any: any.filter((item) => item !== value), not: [...not.filter((item) => item !== value), value] });
  };

  return (
    <div>
      {anyLabel ? <SubLabel>{anyLabel}</SubLabel> : null}
      <div className="flex flex-wrap gap-1.5" data-testid="chips-any">
        {any.map((value) => (
          <Chip key={value} label={labelOf(value)} onRemove={() => onChange({ any: any.filter((item) => item !== value), not })} />
        ))}
        {visibleOffered.map((option) => (
          <AddChip key={option.value} label={option.label} count={option.count} onAdd={() => addAny(option.value)} />
        ))}
        {offered.length > maxOffered ? (
          <button type="button" onClick={() => setShowAll((value) => !value)} className="px-1 text-[12.5px] font-medium text-[var(--accent)] hover:underline">
            {showAll ? "Fewer" : `${offered.length - maxOffered} more`}
          </button>
        ) : null}
      </div>
      {showNot ? (
        <>
          <SubLabel>{notLabel}</SubLabel>
          {not.length ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="chips-not">
              {not.map((value) => (
                <Chip key={value} tone="not" label={labelOf(value)} onRemove={() => onChange({ any, not: not.filter((item) => item !== value) })} />
              ))}
            </div>
          ) : null}
          {freeText ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                addNot(text);
                setText("");
              }}
            >
              <label htmlFor={inputId} className="sr-only">{notLabel}</label>
              <input
                id={inputId}
                list={`${inputId}-options`}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={placeholder}
                className="w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-1 text-[13px] text-[#374151] placeholder:text-[#9ca3af] focus:border-[var(--accent)] focus:outline-none"
              />
              <datalist id={`${inputId}-options`}>
                {offered.map((option) => (
                  <option key={option.value} value={option.label} />
                ))}
              </datalist>
            </form>
          ) : offered.length ? (
            <select
              aria-label={notLabel}
              value=""
              onChange={(event) => {
                if (event.target.value) addNot(event.target.value);
              }}
              className="w-full border-0 border-b border-[var(--line)] bg-transparent px-0 py-1 text-[13px] text-[#9ca3af] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">{placeholder}</option>
              {offered.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Small on/off switch as in the mockup ("Hide competitors", "Company HQ ◐ Project site"). */
export function Switch({ checked, onChange, label, before, after }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  before?: string;
  after?: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-2 text-[13px] text-[#1f2937]">
      {before ? <span aria-hidden>{before}</span> : null}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-[30px] shrink-0 rounded-full transition-colors ${checked ? "bg-[#111827]" : "bg-[#d1d5db]"}`}
      >
        <span aria-hidden className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${checked ? "left-[16px]" : "left-0.5"}`} />
      </button>
      {after ? <span aria-hidden>{after}</span> : null}
    </div>
  );
}

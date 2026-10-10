"use client";

import { AlertTriangle, Loader2, Save } from "lucide-react";
import { isDerivedLeadId, type BuyerRow, type ChainTier } from "@/mvp/buyers/types";
import { SampleBadge } from "../badges";
import { triggerKindLabel } from "@/mvp/buyers/types";
import { HOW_SURE_LABELS, HOW_SURE_STYLES, LINK_LABELS, LINK_STYLES, ROLE_STYLES, TENDER_STYLE, TIER_STYLES, avatarColour, countryName, initials, isTenderLabel, roleText, whatTheyDoText } from "./buyer-labels";

/** A derived row: a tier 2/3 company with no stored lead yet (docs/mvp/15 §D). */
export function isDerivedRow(row: { derivedKey?: string | null; leadId: string; storedLeadId?: string | null }): boolean {
  return Boolean(row.derivedKey) && (row.storedLeadId === null || isDerivedLeadId(row.leadId));
}

/** "Pipeline builder" (+ " · open tender"), never "EPC" / "owner". */
export function rowRoleText(row: Pick<BuyerRow, "whatTheyDo" | "subRoleLabel" | "role" | "roleLabel">): string {
  const plain = whatTheyDoText(row);
  return roleText(row.role, plain, isTenderLabel(row.roleLabel ?? ""));
}

export function TierBadge({ tier }: { tier: ChainTier }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-1.5 py-px text-[11px] font-semibold ${TIER_STYLES[tier]}`} title={tier === 1 ? "Tier 1 · won the work" : `Tier ${tier} · in the supply chain of a deal`}>
      Tier {tier}
    </span>
  );
}

export function Avatar({ name, size = "sm" }: { name: string; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-11 w-11 rounded-[10px] text-sm" : "h-7 w-7 rounded-[7px] text-[11px]";
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center font-bold text-white ${box}`} style={{ background: avatarColour(name) }}>
      {initials(name)}
    </span>
  );
}

export function RolePill({ role, label, prefix }: { role: BuyerRow["role"]; label: string; prefix?: string }) {
  const style = isTenderLabel(label) ? TENDER_STYLE : ROLE_STYLES[role];
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-[9px] py-0.5 text-xs font-semibold ${style}`}>
      {prefix ? `${prefix} · ` : ""}
      {label}
    </span>
  );
}

export interface ResultsTableProps {
  rows: BuyerRow[];
  selected: Set<string>;
  openId: string;
  onToggle: (leadId: string) => void;
  onOpen: (leadId: string) => void;
  /** Show the select checkboxes (default on). */
  selectable?: boolean;
  /** "Save as buyer" on a derived row (creates a lead). */
  onSaveDerived?: (row: BuyerRow) => void;
  /** Derived keys being saved. */
  saving?: ReadonlySet<string>;
  /** Leads saved since the list was first shown (marked New). */
  newIds?: ReadonlySet<string>;
}

/** How a lead is proven (doc 19 §6), as a short tag. */
const PROOF: Record<NonNullable<BuyerRow["verification"]>, { label: string; tone: string; title: string }> = {
  website: { label: "Verified", tone: "bg-[var(--good-bg)] text-[var(--good)]", title: "Its own website shows matching work." },
  listing: { label: "Listed work", tone: "bg-[var(--info-bg)] text-[var(--info)]", title: "A list or directory entry describes its work with this material." },
  rating: { label: "Likely", tone: "bg-[var(--warn-bg)] text-[var(--warn)]", title: "Rated from what the sources say; not verified yet and never emailed automatically." },
};

/** Rating words for the 0–100 buyer fit: the number stays visible, the word makes it scannable. */
export function ratingWord(score: number): { word: string; tone: string } {
  if (score >= 70) return { word: "Strong", tone: "bg-[var(--good-bg)] text-[var(--good)]" };
  if (score >= 45) return { word: "Good", tone: "bg-[var(--info-bg)] text-[var(--info)]" };
  if (score > 0) return { word: "Possible", tone: "bg-[var(--subtle)] text-[var(--text-2)]" };
  return { word: "Not rated", tone: "bg-[var(--subtle)] text-[var(--muted)]" };
}

export function RatingBadge({ score }: { score: number }) {
  const { word, tone } = ratingWord(score);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ${tone}`} title="Buyer fit for this search, 0–100">
      {score > 0 ? <span className="tabular-nums">{score}</span> : null}
      {word}
    </span>
  );
}

const EMAIL_TONE = (status: string) =>
  /Meeting/.test(status) ? "bg-[var(--good-bg)] text-[var(--good)]"
  : /Replied|Intro/.test(status) ? "bg-[var(--info-bg)] text-[var(--info)]"
  : /Held|Stopped|Needs/.test(status) ? "bg-[var(--warn-bg)] text-[var(--warn)]"
  : "bg-[var(--subtle)] text-[var(--text-2)]";

const TH = "px-4 py-3 text-[12px] font-medium text-[var(--muted)]";
const TD = "px-4 py-4 align-top";

/**
 * Leads table (docs/mvp/18 §2): Company (role, country, tier) · Search it came from · Will buy (the
 * searched product and why) · Also can sell · Rating · Email · Contacts. A click opens the evidence drawer.
 */
export function ResultsTable({ rows, selected, openId, onToggle, onOpen, selectable = true, onSaveDerived, saving, newIds }: ResultsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] border-collapse text-[14px] leading-[1.45]" aria-label="Buyers">
        <thead>
          <tr className="border-b border-[var(--line)] text-left">
            {selectable ? <th scope="col" className={`w-[44px] ${TH}`}><span className="sr-only">Select</span></th> : null}
            <th scope="col" className={`w-[24%] ${TH}`}>Company</th>
            <th scope="col" className={`w-[14%] ${TH}`}>Search</th>
            <th scope="col" className={`w-[25%] ${TH}`}>Will buy</th>
            <th scope="col" className={`w-[14%] ${TH}`}>Also can sell</th>
            <th scope="col" className={TH} title="Buyer fit for this search, 0–100">Rating</th>
            <th scope="col" className={TH}>Email</th>
            <th scope="col" className={TH}>Contacts</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const isSelected = selected.has(row.leadId);
            const isOpen = openId === row.leadId;
            const label = rowRoleText(row);
            const derived = isDerivedRow(row);
            const tier: ChainTier = row.tier ?? 1;
            const moreDeals = Math.max(0, (row.dealsCount ?? 1) - 1);
            const product = row.searchedProduct || row.sellSummary;
            const country = row.country ? countryName(row.country) : null;
            const fitNote = row.verification === "rating" ? "Likely buyer · not verified yet"
              : row.trigger ? `${triggerKindLabel(row.trigger.kind)}${row.trigger.date ? ` · ${row.trigger.date}` : ""}`
              : row.searchFit === "explicit" ? "Named on their own website" : row.searchFit === "potential" ? "Their work uses it" : null;
            return (
              <tr
                key={row.leadId}
                data-lead-id={row.leadId}
                data-tour={index === 0 ? "search-first-row" : undefined}
                onClick={() => onOpen(row.leadId)}
                aria-selected={isOpen}
                className={`cursor-pointer border-b border-[var(--line)] transition-colors last:border-b-0 ${isSelected || isOpen ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hover)]"}`}
              >
                {selectable ? <td className={TD} onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={derived}
                    title={derived ? "Save as buyer first" : undefined}
                    onChange={() => onToggle(row.leadId)}
                    aria-label={`Select ${row.name}`}
                    className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  />
                </td> : null}
                <td className={TD}>
                  <div className="flex items-start gap-3">
                    <Avatar name={row.name} />
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(row.leadId);
                        }}
                        className="text-left text-[15px] font-semibold text-[var(--text)] hover:text-[var(--accent)]"
                      >
                        {row.name}
                      </button>
                      <div className="mt-0.5 text-[13px] text-[var(--text-2)]">
                        <span>{label}</span>
                        {country ? <span className="text-[var(--muted)]"> · {country}</span> : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-testid="tier-cell">
                        {newIds?.has(row.leadId) ? <span className="rounded-full bg-[var(--accent)] px-1.5 py-px text-[11px] font-semibold text-white">New</span> : null}
                        {row.verification ? <span title={PROOF[row.verification].title} className={`rounded-full px-1.5 py-px text-[11px] font-semibold ${PROOF[row.verification].tone}`}>{PROOF[row.verification].label}</span> : null}
                        <TierBadge tier={tier} />
                        {tier > 1 && row.link ? (
                          <span className={`inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[11px] font-semibold ${LINK_STYLES[row.link]}`}>{LINK_LABELS[row.link]}</span>
                        ) : null}
                        {tier > 1 && row.foundVia ? (
                          <span className="text-[12px] text-[var(--muted)]">
                            Found via{" "}
                            <a href={`/buyers/${encodeURIComponent(row.foundVia.leadId)}`} onClick={(event) => event.stopPropagation()} className="text-[var(--accent)] hover:underline">
                              {row.foundVia.name}
                            </a>
                          </span>
                        ) : null}
                        {row.isSample ? <SampleBadge /> : null}
                      </div>
                      {derived && onSaveDerived && row.derivedKey ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onSaveDerived(row);
                          }}
                          disabled={saving?.has(row.derivedKey)}
                          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-[12px] font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-60"
                        >
                          {saving?.has(row.derivedKey) ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />} Save as buyer
                        </button>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className={TD} data-testid="search-cell">
                  {row.searches?.length ? (
                    <>
                      <span className="inline-block rounded-lg bg-[var(--subtle)] px-2 py-1 text-[12.5px] font-medium text-[var(--text)]">{row.searches[0].label}</span>
                      {row.searches.length > 1 ? <div className="mt-1 text-[12px] text-[var(--muted)]" title={row.searches.slice(1).map((s) => s.label).join("\n")}>+{row.searches.length - 1} more {row.searches.length === 2 ? "search" : "searches"}</div> : null}
                    </>
                  ) : <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className={TD}>
                  {product ? <div className="font-semibold text-[var(--text)]">{product}</div> : <div className="text-[var(--muted)]">Nothing matched yet</div>}
                  {fitNote ? <div className={`mt-0.5 text-[12.5px] font-medium ${row.verification === "rating" ? "text-[var(--warn)]" : "text-[var(--accent)]"}`}>{fitNote}</div> : null}
                  {row.buyingReason ? <p className="mt-1 line-clamp-2 text-[13px] text-[var(--text-2)]" title={row.buyingReason}>{row.buyingReason}</p>
                    : <p className="mt-1 text-[13px] text-[var(--muted)]">{tier > 1 ? "In the supply chain of this deal" : "Reason not known yet"}</p>}
                  {moreDeals ? <div className="mt-1 text-[12px] font-semibold text-[var(--text-2)]">+{moreDeals} more {moreDeals === 1 ? "deal" : "deals"}</div> : null}
                  {row.competitorNote ? (
                    <div className="mt-1 flex items-start gap-1 text-[12px] text-[var(--bad)]">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
                      {row.competitorNote}
                    </div>
                  ) : null}
                </td>
                <td className={`${TD} text-[13px] text-[var(--text-2)]`}>
                  {row.alsoSell?.length ? row.alsoSell.join(", ") : <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className={TD}>
                  <RatingBadge score={row.fitScore} />
                  <div className={`mt-1 text-[12px] ${HOW_SURE_STYLES[row.howSure]}`} title="How sure we are">{HOW_SURE_LABELS[row.howSure]}</div>
                </td>
                <td className={TD}>
                  {row.emailStatus ? <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold ${EMAIL_TONE(row.emailStatus)}`}>{row.emailStatus}</span> : <span className="text-[var(--muted)]">—</span>}
                </td>
                <td className={`${TD} whitespace-nowrap text-[13px] text-[var(--text-2)]`}>
                  <b className="font-semibold text-[var(--text)]">{row.found}</b> of {row.total} found
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

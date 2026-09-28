/**
 * Buying window (docs/mvp/14 §5): the needs rule drawn as steps from the trigger date, e.g.
 * Order won → Materials & consumables → Coating & testing → Delivery. A step is `done` when it
 * is in the past, `now` when today falls inside it, `next` otherwise. Pure.
 */
import type { NeedsRule } from "@/mvp/config/buyers-config";
import { addMonths } from "./needs";
import type { WindowStep } from "./types";

/** State of a step [from, to] on `today` (ISO days). */
export function stepState(from: string | null, to: string | null, today: string): WindowStep["state"] {
  if (!from && !to) return "next";
  const start = from ?? to!;
  const end = to ?? from!;
  if (end < today) return "done";
  if (start <= today) return "now";
  return "next";
}

export interface WindowOptions {
  /** Delivery due date stated by a source (wins over the rule's typical delivery). */
  deliveryDate?: string | null;
  /** Tender closing date (owner with an open tender). */
  closingDate?: string | null;
  /** Group indexes to leave out (e.g. groups whose items are all competitor items). */
  skipGroups?: ReadonlySet<number>;
}

/**
 * Steps of the buying window. Without a trigger date the dates are null: the trigger is done, the
 * first step is `now`, the rest `next` (a buyer only exists because the trigger happened).
 */
export function windowSteps(rule: NeedsRule | null, triggerDate: string | null, now: Date, opts: WindowOptions = {}): WindowStep[] {
  if (!rule) return [];
  const today = now.toISOString().slice(0, 10);
  const trigger = triggerDate?.slice(0, 10) ?? null;
  const steps: WindowStep[] = [
    { label: rule.trigger, from: trigger, to: trigger, state: trigger ? (trigger <= today ? "done" : "next") : "done" },
  ];

  const seen = new Set<string>();
  rule.groups.forEach((group, index) => {
    if (opts.skipGroups?.has(index) || seen.has(group.label)) return;
    seen.add(group.label);
    if (!trigger) {
      steps.push({ label: group.label, from: null, to: null, state: steps.length === 1 ? "now" : "next" });
      return;
    }
    const from = addMonths(trigger, group.from);
    const to = addMonths(trigger, group.to);
    steps.push({ label: group.label, from, to, state: stepState(from, to, today) });
  });

  if (opts.closingDate && rule.trigger === "Tender open") {
    const closing = opts.closingDate.slice(0, 10);
    steps.splice(1, 0, { label: "Tender closes", from: closing, to: closing, state: closing < today ? "done" : "next" });
  }

  const delivery = opts.deliveryDate?.slice(0, 10) ?? (rule.delivery && trigger ? addMonths(trigger, rule.delivery.months) : null);
  if (delivery || rule.delivery) {
    steps.push({
      label: rule.delivery?.label ?? "Delivery",
      from: delivery,
      to: delivery,
      state: delivery ? (delivery < today ? "done" : "next") : "next",
    });
  }
  return steps;
}

/** The first step that is `now` (else the first `next`), for the headline's "in {window}". */
export function currentStep(steps: readonly WindowStep[]): WindowStep | null {
  return steps.slice(1).find((s) => s.state === "now") ?? steps.slice(1).find((s) => s.state === "next") ?? null;
}

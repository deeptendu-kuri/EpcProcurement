import type { NeedCard } from "@/mvp/buyers/types";

const WINDOW_TONE: Record<NeedCard["window"], string> = {
  "buying now": "bg-[var(--good-bg)] text-[var(--good)]",
  "buying soon": "bg-[var(--info-bg)] text-[var(--info)]",
  "check date": "bg-[var(--warn-bg)] text-[var(--warn)]",
};

/**
 * docs/mvp/20 §8: why this company is a buyer of the searched item, as bullet points the POC can read and
 * defend: its work (the source's own sentence), why that work needs the item, when it buys, and what was checked.
 */
export function NeedProof({ need }: { need: NeedCard }) {
  return (
    <section data-testid="need-proof" className="rounded-xl border border-[var(--line)] p-4">
      <h3 className="font-bold">Why they are a buyer of {need.item}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
        <li>
          <strong>Their work:</strong> “{need.work}”
          {need.url ? <> — <a className="text-[var(--accent)] underline" href={need.url} target="_blank" rel="noreferrer">{need.source ?? "source"}</a></> : null}
          {need.date ? <span className="text-[var(--muted)]"> ({need.date})</span> : null}
        </li>
        {need.why ? <li><strong>Why it needs {need.item}:</strong> {need.why}</li> : null}
        <li>
          <strong>Buying window:</strong>{" "}
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${WINDOW_TONE[need.window]}`}>{need.window}</span>
          {need.window === "check date" ? <span className="text-[var(--muted)]"> — the source gives no date for this work</span> : null}
        </li>
        {need.role || need.country || need.project ? (
          <li><strong>Role:</strong> {[need.role, need.country, need.project ? `Project: ${need.project}` : null].filter(Boolean).join(" · ")}</li>
        ) : null}
        {need.use ? <li><strong>Kind of work:</strong> {need.use}</li> : null}
        {need.competitor ? <li><strong>Strongest signal:</strong> a supplier of this item is named on the same work — {need.competitor}</li> : null}
        <li><strong>Checked:</strong> {need.checks.map((c) => `✓ ${c}`).join(" · ")}</li>
        {need.more > 0 ? <li className="text-[var(--muted)]">{need.more} more {need.more === 1 ? "source shows" : "sources show"} the same.</li> : null}
      </ul>
    </section>
  );
}

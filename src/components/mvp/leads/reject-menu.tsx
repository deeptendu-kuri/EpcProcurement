"use client";

import { useEffect, useRef } from "react";
import { REJECT_REASONS, type RejectReason } from "@/mvp/types";
import { REJECT_REASON_LABELS } from "../labels";

/**
 * Pick a reason for rejecting (09 §4.2: reasons feed tuning). A small menu anchored under its trigger;
 * Esc or a click outside closes it.
 */
export function RejectMenu({
  onPick,
  onClose,
  align = "right",
  drop = "down",
}: {
  onPick: (reason: RejectReason) => void;
  onClose: () => void;
  align?: "left" | "right";
  /** Open below (default) or above the trigger (e.g. in a footer). */
  drop?: "down" | "up";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    (ref.current?.querySelector("button") as HTMLButtonElement | null)?.focus();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Reason for rejecting"
      onClick={(event) => event.stopPropagation()}
      className={`pop-in absolute ${drop === "up" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"} z-50 w-48 rounded-xl border border-[var(--line)] bg-white p-1 text-left shadow-lg ${align === "right" ? "right-0" : "left-0"}`}
    >
      <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold text-[#6b7280]">Why is it not relevant?</p>
      {REJECT_REASONS.map((reason) => (
        <button
          key={reason}
          type="button"
          role="menuitem"
          onClick={() => onPick(reason)}
          className="block w-full rounded-lg px-2.5 py-1.5 text-left text-sm text-[#374151] hover:bg-[var(--subtle)] focus:bg-[var(--subtle)] focus:outline-none"
        >
          {REJECT_REASON_LABELS[reason]}
        </button>
      ))}
    </div>
  );
}

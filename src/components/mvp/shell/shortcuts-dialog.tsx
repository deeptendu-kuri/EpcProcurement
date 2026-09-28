"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["/"], label: "Search buyers" },
  { keys: ["j", "k"], label: "Move down / up in a list" },
  { keys: ["Enter"], label: "Preview the selected buyer" },
  { keys: ["o"], label: "Open the selected buyer" },
  { keys: ["a"], label: "Mark the selected buyer a good lead" },
  { keys: ["r"], label: "Mark the selected buyer not relevant" },
  { keys: ["?"], label: "Show these shortcuts" },
  { keys: ["Esc"], label: "Close a panel or the tour" },
];

/** Keyboard shortcuts list (docs/mvp/13 §2), opened with "?" or Help → Keyboard shortcuts. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" role="presentation">
      <button type="button" aria-label="Close shortcuts" className="backdrop absolute inset-0" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="pop-in relative w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg outline-none"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-base font-bold text-[#111827]">Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon">
            <X size={16} />
          </button>
        </div>
        <ul className="mt-3 divide-y divide-[#f0f1f3]">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.label} className="flex items-center justify-between gap-4 py-2 text-sm text-[#374151]">
              <span>{shortcut.label}</span>
              <span className="flex shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd key={key} className="kbd">{key}</kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

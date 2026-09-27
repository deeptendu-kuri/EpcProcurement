"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

export function FilterDrawer({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  return (
    <dialog ref={dialogRef} aria-labelledby={titleId} className="filter-drawer"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex h-full min-h-0 flex-col bg-white">
        <header className="flex shrink-0 items-center justify-between border-b border-[#e4e7ec] px-4 py-3">
          <h2 id={titleId} className="text-base font-bold text-[#101828]">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="btn-quiet focus-ring flex h-9 w-9 items-center justify-center rounded-md"><X size={18} /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        <footer className="shrink-0 border-t border-[#e4e7ec] p-4">
          <button type="button" onClick={onClose} className="btn-primary focus-ring h-10 w-full rounded-md text-sm font-semibold">Show results</button>
        </footer>
      </div>
    </dialog>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

export interface AddContactValues {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedinUrl: string;
  notes: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Check the form; returns an error message or null. */
export function validateContact(values: AddContactValues): string | null {
  if (!values.name.trim()) return "Enter the person’s name.";
  if (values.email.trim() && !EMAIL.test(values.email.trim())) return "That email address doesn’t look right.";
  if (values.linkedinUrl.trim() && !/^https?:\/\/\S+$/i.test(values.linkedinUrl.trim())) return "The LinkedIn link must start with https://";
  return null;
}

/**
 * "+ Add contact" (docs/mvp/15 §E): name, title, email, phone, LinkedIn URL, notes. Saved as a person
 * with contact points (source manual), status Likely until someone confirms them.
 */
export function AddContactModal({ company, slotTitle, onSubmit, onClose }: {
  company: string;
  slotTitle: string;
  onSubmit: (values: AddContactValues) => Promise<void>;
  onClose: () => void;
}) {
  const [values, setValues] = useState<AddContactValues>({ name: "", title: slotTitle, email: "", phone: "", linkedinUrl: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (key: keyof AddContactValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const problem = validateContact(values);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: values.name.trim(),
        title: values.title.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        linkedinUrl: values.linkedinUrl.trim(),
        notes: values.notes.trim(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this contact.");
      setSaving(false);
    }
  };

  const field = "input h-9 w-full text-sm";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="add-contact-title">
      <button type="button" aria-label="Close" className="backdrop absolute inset-0" onClick={onClose} />
      <form onSubmit={submit} className="pop-in relative w-full max-w-md rounded-2xl bg-white p-5 shadow-lg" noValidate>
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h2 id="add-contact-title" className="text-base font-bold text-[#111827]">Add contact</h2>
            <p className="text-xs text-[var(--muted)]">{company} · {slotTitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-ghost btn-sm btn-icon ml-auto text-[#94a3b8]">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151] sm:col-span-2">
            Name
            <input ref={firstRef} value={values.name} onChange={set("name")} required maxLength={200} className={field} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151] sm:col-span-2">
            Title
            <input value={values.title} onChange={set("title")} maxLength={200} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151]">
            Email
            <input type="email" value={values.email} onChange={set("email")} maxLength={320} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151]">
            Phone
            <input type="tel" value={values.phone} onChange={set("phone")} maxLength={60} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151] sm:col-span-2">
            LinkedIn URL
            <input type="url" value={values.linkedinUrl} onChange={set("linkedinUrl")} maxLength={500} placeholder="https://www.linkedin.com/in/…" className={field} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[#374151] sm:col-span-2">
            Notes
            <textarea value={values.notes} onChange={set("notes")} rows={3} maxLength={4000} className="control focus-ring px-3 py-2 text-sm font-normal" />
          </label>
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">Saved as “Likely” until you confirm they make the decision.</p>
        {error ? <p role="alert" className="mt-2 text-sm font-semibold text-[#b42318]">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} Save contact
          </button>
        </div>
      </form>
    </div>
  );
}

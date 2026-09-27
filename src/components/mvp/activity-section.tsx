"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useState, useTransition } from "react";
import type { ActivityRow, PersonView } from "@/mvp/types";
import { addNote } from "./api-client";
import { ACTIVITY_LABELS, describeStatusChange, formatDateTime } from "./labels";
import { NotFound, Section } from "./section";

/** Activity (09 §4.3): notes, status changes, drafts and sent emails, newest first, plus the note box. */
export const ActivitySection = forwardRef<HTMLTextAreaElement, { leadId: string; activities: ActivityRow[]; people: PersonView[] }>(
  function ActivitySection({ leadId, activities, people }, noteRef) {
    const router = useRouter();
    const [, startTransition] = useTransition();
    const [text, setText] = useState("");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const names = new Map(people.map((person) => [person.id, person.full_name]));

    const submit = async (event: React.FormEvent) => {
      event.preventDefault();
      if (!text.trim()) return;
      setSaving(true);
      setError(null);
      try {
        await addNote(leadId, text.trim());
        setText("");
        startTransition(() => router.refresh());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save the note.");
      } finally {
        setSaving(false);
      }
    };

    return (
      <Section id="activity" title="Activity">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label htmlFor="add-note" className="sr-only">Add a note</label>
          <textarea
            id="add-note"
            ref={noteRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            maxLength={4000}
            placeholder="Add a note…"
            className="control focus-ring px-3 py-2 text-sm"
          />
          <div className="flex items-center justify-end gap-3">
            {error ? <p role="alert" className="text-sm font-semibold text-[#b42318]">{error}</p> : null}
            <button
              type="submit"
              disabled={saving || !text.trim()}
              className="btn-quiet focus-ring inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save note"}
            </button>
          </div>
        </form>
        {activities.length ? (
          <ol className="mt-3 divide-y divide-[#f2f4f7]">
            {activities.map((activity) => (
              <li key={activity.id} className="py-2 text-sm">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-[#101828]">{ACTIVITY_LABELS[activity.type] ?? activity.type}</span>
                  {activity.person_id && names.get(activity.person_id) ? (
                    <span className="text-[#475467]">· {names.get(activity.person_id)}</span>
                  ) : null}
                  <span className="text-xs text-[#667085]">{formatDateTime(activity.created_at)}</span>
                </p>
                {activity.body ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-[#344054]">
                    {activity.type === "status_change" ? describeStatusChange(activity.body) : activity.body}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3"><NotFound text="No activity yet." /></p>
        )}
      </Section>
    );
  },
);

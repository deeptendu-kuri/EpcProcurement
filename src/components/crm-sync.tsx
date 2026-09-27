"use client";

import { useRef, useState } from "react";

type Write = { type: string; payload?: Record<string, unknown>; id?: string };

export function useCrmSync() {
  const failed = useRef(new Map<string, { body: Write; method: "POST" | "DELETE" }>());
  const pending = useRef(0);
  const writes = useRef(new Map<string, Promise<boolean>>());
  const [message, setMessage] = useState("");
  const [failedCount, setFailedCount] = useState(0);

  function write(body: Write, method: "POST" | "DELETE" = "POST") {
    const key = `${body.type}:${body.id ?? body.payload?.id}`;
    const previous = writes.current.get(key) ?? Promise.resolve(true);
    const next = previous.then(() => performWrite(key, body, method));
    writes.current.set(key, next);
    void next.then(() => { if (writes.current.get(key) === next) writes.current.delete(key); });
    return next;
  }

  async function performWrite(key: string, body: Write, method: "POST" | "DELETE") {
    pending.current += 1;
    setMessage("Saving changes...");
    try {
      const response = await fetch("/api/discovery/crm", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error("Save failed");
      failed.current.delete(key);
      if (result.mode === "local-fallback") throw new Error("Database unavailable");
      setMessage("Changes saved to database.");
      return true;
    } catch {
      failed.current.set(key, { body, method });
      setMessage("Changes could not be saved to the database. Retry before leaving this page.");
      return false;
    } finally {
      pending.current -= 1;
      setFailedCount(failed.current.size);
      if (pending.current) setMessage("Saving changes...");
    }
  }

  async function retry() {
    for (const { body, method } of Array.from(failed.current.values())) await write(body, method);
  }

  return { write, retry, failedCount, message };
}

export function CrmSyncStatus({ sync }: { sync: ReturnType<typeof useCrmSync> }) {
  if (!sync.message) return null;
  return <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 rounded-md border border-[#d0d5dd] bg-white px-3 py-2 text-sm text-[#475467]">
    <span>{sync.failedCount ? `${sync.failedCount} unsaved change(s). Retry before leaving this page.` : sync.message}</span>
    {sync.failedCount > 0 ? <button type="button" onClick={() => void sync.retry()} className="btn-quiet focus-ring rounded-md px-3 py-1 font-semibold">Retry save</button> : null}
  </div>;
}

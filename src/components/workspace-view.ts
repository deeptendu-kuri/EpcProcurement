"use client";

import { useEffect, useRef, useState } from "react";

export function readWorkspaceView<T extends object>(raw: string | null, defaults: T): T {
  try {
    const parsed = JSON.parse(raw ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return defaults;
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as (keyof T)[]) {
      const value = parsed[key];
      const fallback = defaults[key];
      if (Array.isArray(fallback)) {
        if (Array.isArray(value) && value.every((item) => typeof item === "string")) result[key] = value as T[keyof T];
      } else if (typeof value === typeof fallback) result[key] = value;
    }
    return result;
  } catch { return defaults; }
}

export function useWorkspaceView<T extends object>(key: string, snapshot: T, restore: (view: T) => void) {
  const initial = useRef({ snapshot, restore });
  const [restored, setRestored] = useState(false);
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    try {
      initial.current.restore(readWorkspaceView(sessionStorage.getItem(key), initial.current.snapshot));
    } catch { /* Views still work when browser storage is unavailable. */ }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Gate persistence until browser-only hydration completes.
    setRestored(true);
  }, [key]);
  useEffect(() => {
    if (!restored) return;
    try { sessionStorage.setItem(key, serialized); } catch { /* In-memory filters remain usable. */ }
  }, [key, restored, serialized]);
}

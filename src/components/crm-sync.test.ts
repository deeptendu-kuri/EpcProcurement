import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCrmSync } from "./crm-sync";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("treats an HTTP-200 application error as a failed save and retries", async () => {
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, mode: "database" }) });
  vi.stubGlobal("fetch", fetch);
  const { result } = renderHook(useCrmSync);
  await act(async () => { await result.current.write({ type: "lead-list", payload: { id: "one" } }); });
  expect(result.current.failedCount).toBe(1);
  await act(async () => { await result.current.retry(); });
  expect(result.current.failedCount).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not report local fallback as a database save", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, mode: "local-fallback" }) }));
  const { result } = renderHook(useCrmSync);
  await act(async () => { await result.current.write({ type: "lead-list", payload: { id: "one" } }); });
  expect(result.current.failedCount).toBe(1);
});

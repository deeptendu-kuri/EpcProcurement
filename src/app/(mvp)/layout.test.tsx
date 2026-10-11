import { describe, expect, it, vi } from "vitest";
const status=vi.hoisted(()=>vi.fn(()=>new Promise(()=>{})));
vi.mock("next/server",()=>({connection:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@/mvp/config/env",()=>({isDemoMode:()=>false}));
vi.mock("@/mvp/scheduler/status",()=>({getAppStatus:status}));
vi.mock("@/components/mvp/shell/app-shell",()=>({AppShell:()=>null}));
import Layout from "./layout";

describe("Nonblocking navigation shell",()=>{
  it("renders the shell without waiting for a database status read",async()=>{
    const result=await Layout({children:"Example page"});
    expect(result.props.children).toBe("Example page");expect(status).not.toHaveBeenCalled();
    expect(result.props.initialStatus.queue.running).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RunProgress } from "./run-progress";
const api=vi.hoisted(()=>vi.fn());
vi.mock("./api-client",()=>({apiJson:api,ApiError:class extends Error {status=500;}}));
afterEach(()=>{cleanup();api.mockReset();});
const run={id:"run-1",status:"done",adhoc_query:{query:"cables",productId:"cables",markets:["IN"]},events:[],counters:{itemsRead:30,relevant:20,scopedProspects:0,deferredPages:10}};
describe("truthful research progress",()=>{
  it("does not equate pages with buyer companies and explicitly reports partial coverage",async()=>{
    api.mockResolvedValue({run});render(<RunProgress runId="run-1"/>);
    expect(await screen.findByText(/Finished · partial coverage/)).toBeTruthy();
    expect(screen.getByText(/20 candidate pages · 0 buyer prospects saved/)).toBeTruthy();
    expect(screen.getByText(/does not mean no buyers exist/)).toBeTruthy();
    expect(screen.getByText(/does not represent the whole market/)).toBeTruthy();
    expect(api.mock.calls.every(call=>call[1]?.method !== "POST")).toBe(true);
  });
  it("offers progressive saved results without waiting for a long search to finish",async()=>{
    api.mockResolvedValue({run:{...run,status:"running",counters:{scopedProspects:2}}});render(<RunProgress runId="run-1"/>);
    const link=await screen.findByRole("link",{name:"View saved companies so far"});
    expect(link.getAttribute("href")).toBe("/crm?search=run-1");
  });
  it("exposes a resumable budget pause and preserves access to previously saved companies",async()=>{
    api.mockResolvedValue({run:{...run,adhoc_query:{...run.adhoc_query,targetCompanies:70},counters:{scopedProspects:12,researchState:"partial",coverageIncomplete:true,deferredUrls:10,researchStopReason:"Page reading budget reached"}}});
    render(<RunProgress runId="run-1"/>);
    expect(await screen.findByText(/Research paused · saved results available/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"Resume saved research"})).toBeTruthy();
    expect(screen.getByText(/Page reading budget reached/)).toBeTruthy();
    expect(screen.getByText(/Research target: 70 companies/)).toBeTruthy();
    expect(screen.getByRole("link",{name:"See the buyers"}).getAttribute("href")).toBe("/crm?search=run-1");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toContain("coverage incomplete");
  });
});

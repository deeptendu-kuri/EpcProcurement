import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,render,screen,within} from "@testing-library/react";
import OverviewPage from "./page";
const mocks=vi.hoisted(()=>({searches:vi.fn(),counts:vi.fn()}));
vi.mock("@/mvp/opportunities",()=>({recentSearches:mocks.searches}));
vi.mock("@/mvp/opportunities/workspace-stats",()=>({searchWorkflowCounts:mocks.counts}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const run=(id:string,query:string,extra={})=>({id,adhoc_query:{productId:"line-pipe",query,markets:["AE"]},created_at:"2026-10-08T10:00:00Z",status:"done",counters:{},result_count:3,...extra});
async function show(searches:ReturnType<typeof run>[]=[],counts:object[]=[]){
  mocks.searches.mockResolvedValue(searches);mocks.counts.mockResolvedValue(counts);
  render(await OverviewPage());
}
describe("search-led overview",()=>{
  it("gives an empty workspace one start action, not empty controls and zero metrics",async()=>{
    await show();expect(screen.getByRole("heading",{name:"Start with what you sell."})).toBeTruthy();
    expect(screen.getAllByRole("link",{name:"Find buyers"})).toHaveLength(1);
    expect(screen.queryByRole("combobox")).toBeNull();expect(screen.queryByText("0")).toBeNull();
    expect(screen.getByRole("button",{name:"Take a quick guide"})).toBeTruthy();
  });
  it("keeps each search linked to its own leads with one row action",async()=>{
    await show([run("run-a","Line pipe"),run("run-b","Electrical cables")],[{run_id:"run-a",workflow_count:1,meeting_count:1}]);
    const rows=within(screen.getByRole("region",{name:"Your searches"})).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("link",{name:"View leads"}).getAttribute("href")).toBe("/crm?run=run-a");
    expect(within(rows[1]).getByRole("link",{name:"View leads"}).getAttribute("href")).toBe("/crm?run=run-b");
    expect(within(rows[0]).getByText("1 meeting booked")).toBeTruthy();
    expect(within(rows[1]).getByText("No email workflow yet")).toBeTruthy();
    expect(screen.queryByRole("link",{name:"Select search"})).toBeNull();
  });
  it("keeps partial coverage visible and offers the actual research log",async()=>{
    await show([run("run-a","Line pipe",{counters:{researchState:"partial",researchStopReason:"Example page budget exhausted"}})]);
    expect(screen.getByText(/Partial coverage: Example page budget exhausted/)).toBeTruthy();
    expect(screen.getByRole("link",{name:"Research details"}).getAttribute("href")).toBe("/find?run=run-a");
  });
});

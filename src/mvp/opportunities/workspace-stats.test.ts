import {beforeEach,describe,expect,it,vi} from "vitest";
import {searchWorkflowCounts} from "./workspace-stats";
const query=vi.hoisted(()=>vi.fn());
vi.mock("@/mvp/db",()=>({getDb:()=>({query})}));
beforeEach(()=>query.mockReset());
describe("read-only overview workflow counts",()=>{
  it("does not query when no product searches exist",async()=>{expect(await searchWorkflowCounts([])).toEqual([]);expect(query).not.toHaveBeenCalled();});
  it("counts workflows per run without the conversation list’s display limit",async()=>{
    query.mockResolvedValue({rows:[{run_id:"Example",workflow_count:250,meeting_count:2}]});
    expect(await searchWorkflowCounts(["Example"])).toEqual([{run_id:"Example",workflow_count:250,meeting_count:2}]);
    const [sql,args]=query.mock.calls[0];expect(sql).toMatch(/^select/);expect(sql).not.toMatch(/limit|insert|update|delete/i);
    expect(sql).toContain("meeting_booked");expect(args).toEqual([["Example"]]);
  });
});

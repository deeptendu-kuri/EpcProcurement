import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import type {Config} from "driver.js";
import {TourController,TOUR_SEEN_KEY,TOUR_STATE_KEY} from "./tour-controller";
import {EVENTS} from "../shell/events";
const mocks=vi.hoisted(()=>({
  push:vi.fn(),api:vi.fn(),show:vi.fn(),configs:[] as Config[],
  router:{push:vi.fn()},toast:{show:vi.fn()}
}));
vi.mock("next/navigation",()=>({usePathname:()=>"/overview",useRouter:()=>mocks.router}));
vi.mock("../api-client",()=>({apiJson:mocks.api}));
vi.mock("../shell/toast",()=>({useToast:()=>mocks.toast}));
vi.mock("driver.js",()=>({driver:(config:Config)=>{
  mocks.configs.push(config);
  return {drive:vi.fn(),destroy:()=>config.onDestroyStarted?.(undefined as never,undefined as never,undefined as never)};
}}));
beforeEach(()=>{
  localStorage.clear();mocks.configs.length=0;vi.clearAllMocks();
  window.history.replaceState(null,"","/overview");
  vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([{}] as unknown as DOMRectList);
});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function show(){return render(<><section data-tour="overview-searches">Example search list</section><TourController /></>);}
describe("optional read-only guide",()=>{
  it("offers a guide on first visit without navigating or creating anything",async()=>{
    show();await screen.findByRole("button",{name:"Start quick guide"});
    expect(mocks.router.push).not.toHaveBeenCalled();expect(mocks.api).not.toHaveBeenCalled();expect(mocks.configs).toHaveLength(0);
  });
  it("remembers Skip guide and does not interrupt the next visit",async()=>{
    show();fireEvent.click(await screen.findByRole("button",{name:"Skip guide"}));expect(localStorage.getItem(TOUR_SEEN_KEY)).toBe("1");
    cleanup();show();await new Promise(resolve=>setTimeout(resolve,30));
    expect(screen.queryByLabelText("Quick guide invitation")).toBeNull();expect(mocks.api).not.toHaveBeenCalled();
  });
  it("can restart from Guide and adds an explicit skip action to the popover",async()=>{
    localStorage.setItem(TOUR_SEEN_KEY,"1");show();fireEvent(window,new Event(EVENTS.startTour));
    await waitFor(()=>expect(mocks.configs).toHaveLength(1));
    const config=mocks.configs[0];const footer=document.createElement("div");
    const renderPopover=config.steps?.[0].popover?.onPopoverRender;
    renderPopover?.({footerButtons:footer} as never,undefined as never);
    const skip=footer.querySelector("button");expect(skip?.textContent).toBe("Skip guide");
    fireEvent.click(skip!);expect(localStorage.getItem(TOUR_STATE_KEY)).toBeNull();expect(mocks.api).not.toHaveBeenCalled();
  });
  it("close/Escape finishes the guide without loading samples or sending mail",async()=>{
    localStorage.setItem(TOUR_SEEN_KEY,"1");show();fireEvent(window,new Event(EVENTS.startTour));
    await waitFor(()=>expect(mocks.configs).toHaveLength(1));
    mocks.configs[0].onCloseClick?.(undefined as never,undefined as never,undefined as never);
    await waitFor(()=>expect(localStorage.getItem(TOUR_STATE_KEY)).toBeNull());
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("resumes only a versioned search scope and opens its opportunity via GET",async()=>{
    const run="11111111-1111-4111-8111-111111111111",lead="22222222-2222-4222-8222-222222222222";
    localStorage.setItem(TOUR_STATE_KEY,JSON.stringify({version:2,active:true,index:3,leadId:null,runId:run}));
    mocks.api.mockResolvedValue({facets:{workspaces:[{opportunityId:lead}]}});
    show();await waitFor(()=>expect(mocks.router.push).toHaveBeenCalledWith(expect.stringContaining("/opportunities/"+lead)));
    expect(mocks.api).toHaveBeenCalledWith(`/api/mvp/crm/tables?run=${run}&tab=leads&size=25`);
    expect(mocks.api.mock.calls.every(call=>call.length===1)).toBe(true);
  });
});

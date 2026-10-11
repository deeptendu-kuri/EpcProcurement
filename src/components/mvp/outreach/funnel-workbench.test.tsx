import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FunnelWorkbench } from "./funnel-workbench";
import { conversationGroup, followupDue, nextStep, type Conversation } from "./conversation-card";
import type { FunnelSettings } from "./demo-funnel-setup";

const api=vi.hoisted(()=>vi.fn());
vi.mock("../api-client",()=>({apiJson:api}));
const settings={enabled:true,ready:true,worker:true,recipient:"approved@example.com",seller:{name:"Example Seller",company:"Example Procurement"},calendar:"approved@example.com",preferences:{timeZone:"Asia/Kolkata"},prospectsPerSearch:3} as FunnelSettings;
function thread(extra:Partial<Conversation>={}):Conversation {
  return {id:"Example-thread",opportunity_id:"11111111-1111-4111-8111-111111111111",company:"Example EPC",product:"Line pipe",keyword:"steel pipe",state:"active",mode:"prospect_demo",recipient:settings.recipient,paused:false,reason:"",run_id:"22222222-2222-4222-8222-222222222222",summary:"",sent_count:1,reply_count:0,followups_sent:0,pending_count:0,review_count:0,next_action_at:"2026-10-13T04:30:00Z",latest_subject:"Example introduction",latest_preview:"Procurement support for your project.",latest_state:"accepted",latest_direction:"out",latest_at:"2026-10-10T04:30:00Z",...extra} as Conversation;
}
beforeEach(()=>{api.mockReset();vi.spyOn(document,"visibilityState","get").mockReturnValue("visible");});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers();});
describe("Email conversation cards",()=>{
  it("shows message-backed counts, a preview, follow-up time and a read-only conversation link",()=>{
    render(<FunnelWorkbench initial={{settings,threads:[thread()]}}/>);
    const card=within(screen.getByRole("article",{name:"Conversation with Example EPC"}));
    expect(card.getByText("Emails sent")).toBeTruthy();expect(card.getByText("Follow-ups sent")).toBeTruthy();
    expect(card.getByText(/Next follow-up check:/)).toBeTruthy();expect(card.getByText("Example introduction")).toBeTruthy();
    expect(card.getByRole("link",{name:/View conversation/}).getAttribute("href")).toContain("tab=conversation");
    expect(api).not.toHaveBeenCalled();
  });
  it("filters review cards immediately and shows their reason instead of a fake sent state",()=>{
    render(<FunnelWorkbench initial={{settings,threads:[thread(),thread({id:"Example-review",company:"Example Held Company",state:"review",reason:"The source only describes design work.",sent_count:0,review_count:1,latest_state:"review"})]}}/>);
    fireEvent.click(within(screen.getByLabelText("Conversation filters")).getByRole("button",{name:"Needs review (1)"}));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Review reason: The source only describes design work.")).toBeTruthy();
    expect(screen.getByText(/Automatic sending is held/)).toBeTruthy();expect(api).not.toHaveBeenCalled();
  });
  it("searches by company, product and keyword without a network round trip",()=>{
    render(<FunnelWorkbench initial={{settings,threads:[thread(),thread({id:"Example-valves",company:"Example Valve Buyer",product:"Cryogenic valves",keyword:"LNG valves"})]}}/>);
    fireEvent.change(screen.getByRole("textbox",{name:"Filter conversations"}),{target:{value:"lng"}});
    expect(screen.getAllByRole("article")).toHaveLength(1);expect(screen.getByRole("article").textContent).toContain("Example Valve Buyer");
    expect(api).not.toHaveBeenCalled();
  });
  it("separates a queued introduction from waiting for a reply",()=>{
    const t=thread({sent_count:0,pending_count:1,latest_state:"queued"});
    expect(conversationGroup(t)).toBe("preparing");expect(nextStep(t,Date.now())).toContain("queued");
    render(<FunnelWorkbench initial={{settings,threads:[t]}}/>);expect(screen.getByText(/Latest email draft/)).toBeTruthy();
    expect(screen.queryByText(/Latest email sent/)).toBeNull();
  });
  it("does not claim scheduled follow-ups while paused, held, stopped, exhausted, or still sending",()=>{
    const now=Date.parse("2026-10-14T00:00:00Z");expect(followupDue(thread(),now)).toBe(true);
    for(const extra of [{paused:true},{state:"review"},{state:"stopped"},{state:"meeting_booked"},{followups_sent:2},{pending_count:1},{next_action_at:"invalid"}])expect(followupDue(thread(extra),now)).toBe(false);
  });
  it.each(["awaiting_calendar","awaiting_time","meeting_pending"])("explains the next scheduling action for %s",state=>{
    expect(conversationGroup(thread({state}))).toBe("replied");expect(nextStep(thread({state}),0)).toMatch(/Calendar|choose|agreed/);
  });
  it("shows only a genuinely booked Meet link",()=>{
    render(<FunnelWorkbench initial={{settings,threads:[thread({state:"meeting_booked",meet_url:"https://meet.google.com/Example"})]}}/>);
    expect(screen.getByRole("link",{name:"Open Google Meet"}).getAttribute("href")).toBe("https://meet.google.com/Example");
  });
  it("keeps inbox diagnostics out of the buyer cards and overview",()=>{
    render(<FunnelWorkbench initial={{settings,threads:[thread({mode:"email_test"})]}}/>);
    expect(screen.queryByRole("article")).toBeNull();expect(screen.getByText("Start your first sales conversation")).toBeTruthy();
  });
  it("does not overlap slow polls and aborts the pending read on unmount",async()=>{
    vi.useFakeTimers();api.mockImplementation(()=>new Promise(()=>{}));
    const view=render(<FunnelWorkbench initial={{settings,threads:[]}}/>);
    await act(async()=>{vi.advanceTimersByTime(30_000);});expect(api).toHaveBeenCalledTimes(1);
    const [,options]=api.mock.calls[0];expect(options.signal.aborted).toBe(false);view.unmount();expect(options.signal.aborted).toBe(true);
  });
  it("does not poll a hidden browser tab",async()=>{
    vi.useFakeTimers();vi.spyOn(document,"visibilityState","get").mockReturnValue("hidden");
    render(<FunnelWorkbench initial={{settings,threads:[]}}/>);await act(async()=>{vi.advanceTimersByTime(30_000);});expect(api).not.toHaveBeenCalled();
  });
  it("shows worker errors as needing attention rather than claiming healthy automation",()=>{
    render(<FunnelWorkbench initial={{settings:{...settings,last_error:"Example provider unavailable"},threads:[thread({reason:"Demo email queued to approved@example.com"})]}}/>);
    expect(screen.getByText(/Automation enabled · worker needs attention/)).toBeTruthy();
    expect(screen.getByText(/Automation is not running/)).toBeTruthy();
    expect(screen.queryByText(/Status: Demo email queued/)).toBeNull();
  });
});

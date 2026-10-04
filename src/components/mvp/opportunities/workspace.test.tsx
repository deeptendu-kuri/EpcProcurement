import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerView } from "@/mvp/buyers/types";
import type { Opportunity } from "@/mvp/opportunities";
import { OpportunityWorkspace } from "./workspace";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../outreach/conversation-timeline",()=>({ConversationTimeline:()=> <div>Email automation timeline</div>}));
afterEach(cleanup);
const opportunity: Opportunity = { id: "opp-1", lead_id: "lead-1", run_id: "run-1", name: "Buyer", product_name: "line pipe", product_id: "line-pipe", keyword: "pipeline", country: "IN", qualification: "pending", is_sample: false, validated_emails: 0, sent: false, contact_role: "buyer", buying_reason: "Won pipeline work", evidence_ids: [], summary: "Saved review notes", owner_name: "Sales", next_action: "Review", follow_up_at: null, created_at: "2026-10-03T00:00:00.000Z" };
const buyer = { name: "Buyer", country: "IN", team: [], proof: [] } as unknown as BuyerView;
function show(overrides: Partial<Opportunity> = {}) { return render(<OpportunityWorkspace opportunity={{ ...opportunity, ...overrides }} buyer={buyer} returnTo="/crm?search=run-1&country=IN" events={[]} drafts={[]} points={[]} demoEmail={{ enabled: true, ready: false, recipient: "test@example.com", error: "Missing key" }} />); }
describe("guided workspace", () => {
  it("keeps saved summary labels accessible and blocks email until buyer-fit review", () => {
    show();
    expect((screen.getByLabelText("Summary", { exact: true }) as HTMLTextAreaElement).value).toBe("Saved review notes");
    expect(screen.queryByRole("button", { name: /Send|Preview demo email/ })).toBeNull();
    expect(screen.getByRole("link",{name:"View automation & next step"}).getAttribute("href")).toBe("/outreach");
    expect(screen.getByRole("link", { name: /Back to filtered CRM/ }).getAttribute("href")).toBe("/crm?search=run-1&country=IN");
    expect(screen.getByText(/Contact verification is not connected/)).toBeTruthy();
  });
  it("shows the real conversation path and integration requirements instead of a manual send button", () => {
    show({ qualification: "approved" });
    fireEvent.click(screen.getByRole("tab",{name:"Conversation"}));
    expect(screen.getByText("Email automation timeline")).toBeTruthy();
    expect(screen.getByText(/booking requires a connected Calendar/)).toBeTruthy();
  });
});

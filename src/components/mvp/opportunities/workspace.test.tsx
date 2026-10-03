import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerView } from "@/mvp/buyers/types";
import type { Opportunity } from "@/mvp/opportunities";
import { OpportunityWorkspace } from "./workspace";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../draft-panel", () => ({ DraftPanel: (p: { opportunityId: string }) => <div role="dialog">Product-scoped draft: {p.opportunityId}</div> }));
afterEach(cleanup);
const opportunity: Opportunity = { id: "opp-1", lead_id: "lead-1", run_id: "run-1", name: "Buyer", product_name: "line pipe", product_id: "line-pipe", keyword: "pipeline", country: "IN", qualification: "pending", is_sample: false, validated_emails: 0, sent: false, contact_role: "buyer", buying_reason: "Won pipeline work", evidence_ids: [], summary: "Saved review notes", owner_name: "Sales", next_action: "Review", follow_up_at: null, created_at: "2026-10-03T00:00:00.000Z" };
const buyer = { name: "Buyer", country: "IN", team: [], proof: [] } as unknown as BuyerView;
function show(overrides: Partial<Opportunity> = {}) { return render(<OpportunityWorkspace opportunity={{ ...opportunity, ...overrides }} buyer={buyer} returnTo="/crm?search=run-1&country=IN" events={[]} drafts={[]} points={[]} demoEmail={{ enabled: true, ready: false, recipient: "test@example.com", error: "Missing key" }} />); }
describe("guided workspace", () => {
  it("keeps saved summary labels accessible and blocks email until buyer-fit review", () => {
    show();
    expect((screen.getByLabelText("Summary", { exact: true }) as HTMLTextAreaElement).value).toBe("Saved review notes");
    expect((screen.getByRole("button", { name: "Contact lead / Preview demo email" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: /Back to filtered CRM/ }).getAttribute("href")).toBe("/crm?search=run-1&country=IN");
    expect(screen.getByText(/FullEnrich is not configured/)).toBeTruthy();
  });
  it("opens a scoped preview after review without representing missing integrations as working", () => {
    show({ qualification: "approved" });
    fireEvent.click(screen.getByRole("button", { name: "Contact lead / Preview demo email" }));
    expect(screen.getByRole("dialog").textContent).toContain("opp-1");
    expect(screen.getByText(/calendar booking are not connected/)).toBeTruthy();
  });
});

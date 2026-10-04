import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactEnrichment } from "./contact-enrichment";
import type { EnrichmentView } from "@/mvp/enrichment";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const api = vi.hoisted(() => vi.fn());
vi.mock("../api-client", () => ({ apiJson: api }));
afterEach(() => { cleanup(); api.mockReset(); });
const ready: EnrichmentView = { configured: true, domain: "buyer.co", domainConfirmed: false, contacts: [] };
describe("contact lookup guidance", () => {
  it("requires an explicit domain review before lookup and shows named contacts without pretending verification", async () => {
    render(<ContactEnrichment opportunityId="opp" sample={false} initial={ready} />);
    const button = screen.getByRole("button", { name: "Find contacts with Hunter" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    api.mockResolvedValue({ message: "One candidate saved", view: { ...ready, domainConfirmed: true, contacts: [{ id: "p", point_id: "cp", name: "Jane Doe", title: "Procurement Manager", email: "jane@buyer.co", verified_at: null, validation_status: "not_checked", confirmed_at: null }] } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("One candidate saved")).toBeTruthy());
    expect(api).toHaveBeenCalledWith("/api/mvp/opportunities/opp/enrichment", { method: "POST", body: { action: "search", domain: "buyer.co", domainConfirmed: true } });
    expect(screen.getByText(/needs review.*not checked/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check email with Hunter" })).toBeTruthy();
  });
  it("keeps sample and unconfigured lookup disabled", () => {
    const ui = render(<ContactEnrichment opportunityId="opp" sample={true} initial={ready} />);
    expect((screen.getByRole("button", { name: "Find contacts with Hunter" }) as HTMLButtonElement).disabled).toBe(true);
    ui.rerender(<ContactEnrichment opportunityId="opp2" sample={false} key="opp2" />);
    expect(screen.getByText(/Contact verification is not connected/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Find contacts with Hunter" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api).not.toHaveBeenCalled();
  });
});

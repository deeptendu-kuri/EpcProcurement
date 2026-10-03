import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutreachRule } from "@/mvp/types";
import { DraftPanel, type DraftContact } from "./draft-panel";

const LEAD_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_IN = "44444444-4444-4444-8444-444444444444";
const PERSON_SA = "55555555-5555-4555-8555-555555555555";

const rule = (country: string, email: OutreachRule["email"], step: string): OutreachRule => ({
  country, email, phone: email, steps: [step], sourceUrl: "https://example.com/rules",
});

const contacts: DraftContact[] = [
  { id: PERSON_IN, name: "R. Example", detail: "Procurement Manager", country: "IN", rule: rule("IN", "opt_out_only", "Include an opt-out line.") },
  { id: PERSON_SA, name: "S. Example", country: "SA", rule: rule("SA", "consent_needed", "Use the official procurement channel first.") },
];

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("DraftPanel", () => {
  it("approves a scoped email into the queue without displaying sent prematurely", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ id: "scoped-draft", subject: "Line pipe", body: "Hello, line pipe requirements?" }, 201))
      .mockReturnValueOnce(jsonResponse({ id: "campaign-id", status: "queued", recipient: "deeptendukuri@gmail.com" }));
    render(<DraftPanel leadId={LEAD_ID} opportunityId="66666666-6666-4666-8666-666666666666" contacts={[contacts[0]]}
      demoEmail={{ enabled: true, ready: true, recipient: "deeptendukuri@gmail.com", error: null }} autoGenerate onClose={() => undefined} />);
    await screen.findByLabelText(/Message/);
    fireEvent.click(screen.getByRole("button", { name: "Approve & automate demo email" }));
    await screen.findByRole("button", { name: "Approved — queued" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/mvp/outreach/campaigns");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ draftId: "scoped-draft", subject: "Line pipe", body: "Hello, line pipe requirements?" });
    expect(screen.getByRole("link", { name: /Track delivery in Outreach/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Demo email sent" })).toBeNull();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).disabled).toBe(true);
  });
  it("shows the blocked reason and disables drafting when the contact's country needs consent", () => {
    render(<DraftPanel leadId={LEAD_ID} contacts={contacts} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Contact"), { target: { value: PERSON_SA } });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Email needs the contact's consent first in Saudi Arabia.");
    expect(alert.textContent).toContain("Use the official procurement channel first.");
    expect((screen.getByRole("button", { name: "Write draft" }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the blocked reason returned by the server and no editable text", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ id: "d1", subject: "", body: "", blockedReason: "This contact opted out." }, 201));
    render(<DraftPanel leadId={LEAD_ID} contacts={contacts} onClose={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Write draft" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("This contact opted out."));
    expect(screen.queryByLabelText(/Message/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as sent" })).toBeNull();
  });

  it("generates an editable draft and marks it as sent", async () => {
    fetchMock
      .mockReturnValueOnce(jsonResponse({ id: "d2", subject: "Line pipe for Phase 2", body: "Hello R., we supply API 5L line pipe." }, 201))
      .mockReturnValueOnce(jsonResponse({ draft: { id: "d2", status: "sent_externally" } }));
    const onSent = vi.fn();
    render(<DraftPanel leadId={LEAD_ID} contacts={contacts} onClose={() => undefined} onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: "Write draft" }));

    const body = (await screen.findByLabelText(/Message/)) as HTMLTextAreaElement;
    expect(body.value).toBe("Hello R., we supply API 5L line pipe.");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ leadId: LEAD_ID, personId: PERSON_IN });

    fireEvent.change(body, { target: { value: "Hello R., edited." } });
    fireEvent.click(screen.getByRole("button", { name: "Mark as sent" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(fetchMock.mock.calls[1][0]).toBe("/api/mvp/drafts/d2");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      subject: "Line pipe for Phase 2", body: "Hello R., edited.", status: "sent_externally",
    });
    expect(screen.getByRole("button", { name: "Marked as sent" })).toBeTruthy();
  });

  it("opens a template automatically for a dummy contact and sends to the configured test inbox", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ id: "demo-draft", subject: "Procurement support", body: "Hello Demo, could we discuss your requirements?" }, 201))
      .mockReturnValueOnce(jsonResponse({ messageId: "provider-id", recipient: "our-inbox@example.com", alreadySent: false }));
    const onSent = vi.fn();
    render(<DraftPanel leadId={LEAD_ID} contacts={[{ id: null, name: "Demo procurement contact", detail: "Head of procurement", country: "SA", rule: rule("SA", "consent_needed", "Use official channel"), isDemo: true, companyName: "Selected Sub-Buyer" }]}
      demoEmail={{ enabled: true, ready: true, recipient: "our-inbox@example.com", error: null }} autoGenerate onClose={() => undefined} onSent={onSent} />);
    await screen.findByLabelText(/Message/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ leadId: LEAD_ID, personId: null, templateOnly: true, demoContact: true, demoContactTitle: "Head of procurement" });
    expect(screen.getByText(/Buyer: Selected Sub-Buyer/)).toBeTruthy();
    expect(screen.getByText(/dummy address/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send demo email" }));
    await screen.findByRole("button", { name: "Demo email sent" });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/mvp/drafts/demo-draft/send");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ subject: "Procurement support", body: "Hello Demo, could we discuss your requirements?" });
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("does not show sent after a failed delivery and offers a same-draft retry", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ id: "demo-draft", subject: "Support", body: "Hello Buyer" }, 201))
      .mockReturnValueOnce(jsonResponse({ error: "Provider did not accept the message" }, 502));
    render(<DraftPanel leadId={LEAD_ID} contacts={contacts} demoEmail={{ enabled: true, ready: true, recipient: "our-inbox@example.com", error: null }} autoGenerate onClose={() => undefined} />);
    await screen.findByLabelText(/Message/);
    fireEvent.click(screen.getByRole("button", { name: "Send demo email" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Demo email sent" })).toBeNull();
    expect(screen.getByRole("button", { name: "Retry demo email" })).toBeTruthy();
    expect((screen.getByLabelText("Subject") as HTMLInputElement).disabled).toBe(true);
  });

  it("disables sending when server credentials are missing but still previews a template", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ id: "demo-draft", subject: "Support", body: "Hello Buyer" }, 201));
    render(<DraftPanel leadId={LEAD_ID} contacts={contacts} demoEmail={{ enabled: true, ready: false, recipient: null, error: "Set RESEND_API_KEY" }} autoGenerate onClose={() => undefined} />);
    await screen.findByLabelText(/Message/);
    expect((screen.getByRole("button", { name: "Send demo email" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Set RESEND_API_KEY")).toBeTruthy();
  });
});

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
});

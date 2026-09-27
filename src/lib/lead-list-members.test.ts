import { describe, expect, it } from "vitest";
import { mergeListMembers, type ListMemberIdentity } from "./lead-list-members";

describe("lead list membership", () => {
  const original: ListMemberIdentity = { id: "legacy-id", listId: "buyers", memberType: "decision-maker", contactId: "contact-1" };
  it("deduplicates repeated saves even with different membership IDs", () => {
    expect(mergeListMembers([original], [{ ...original, id: "new-id" }])).toEqual([original]);
  });
  it("allows a contact in different lists", () => {
    expect(mergeListMembers([original], [{ ...original, id: "other", listId: "new-list" }])).toHaveLength(2);
  });
  it("preserves company memberships and does not mutate input", () => {
    const company: ListMemberIdentity = { id: "company", listId: "buyers", memberType: "converted-lead", leadId: "lead-1" };
    const existing = [company];
    expect(mergeListMembers(existing, [original])).toEqual([company, original]);
    expect(existing).toEqual([company]);
  });
});

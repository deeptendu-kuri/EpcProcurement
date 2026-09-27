export interface ListMemberIdentity {
  id: string;
  listId: string;
  memberType: "decision-maker" | "converted-lead";
  contactId?: string;
  leadId?: string;
}

export function mergeListMembers<T extends ListMemberIdentity>(existing: T[], incoming: T[]): T[] {
  const members = new Map<string, T>();
  for (const member of [...existing, ...incoming]) {
    const entityId = member.memberType === "decision-maker" ? member.contactId : member.leadId;
    const key = JSON.stringify([member.listId, member.memberType, entityId ?? member.id]);
    // Retain the original membership ID, including records imported from older builds.
    if (!members.has(key)) members.set(key, member);
  }
  return [...members.values()];
}

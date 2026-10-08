import { describe, expect, it } from "vitest";
import { activityGroup, activityLabel, availableRoleMatches, journey, uniquePublishedContacts, verifiedProspect } from "./workflow";

describe("separate prospect activity and contact readiness",()=>{
  it("displays a repeated inbox or phone only once without changing source records or merging different numbers",()=>{
    const points=[
      {kind:'phone' as const,value:'+971 54 481 2988',source_url:'https://example.com/contact'},
      {kind:'phone' as const,value:'+971 54.481.2988',source_url:'https://example.com/services'},
      {kind:'phone' as const,value:'+971 6 715 2707',source_url:'https://example.com/contact'},
      {kind:'email' as const,value:'Info@Example.com',source_url:'https://example.com/contact'},
      {kind:'email' as const,value:'info@example.com',source_url:'https://example.com/services'},
    ];
    const result=uniquePublishedContacts(points);
    expect(result).toEqual([points[0],points[2],points[3]]);expect(points).toHaveLength(5);
    expect(result[0].source_url).toBe('https://example.com/contact');
  });
  it("never turns unknown/capability-only work into active purchasing",()=>{
    expect(activityGroup(undefined)).toBe("capability");
    expect(activityGroup("ongoing")).toBe("active");
    expect(activityGroup("historic")).toBe("historic");
    expect(activityLabel("capability_only")).toContain("current work unconfirmed");
    expect(activityLabel(undefined)).toBe("Current activity not established");
  });
  it("filters actual available roles, not a search's requested role",()=>{
    expect(availableRoleMatches("",[])).toBe(true);
    expect(availableRoleMatches("buyer",[])).toBe(false);
    expect(availableRoleMatches("buyer",["procurement_lead"])).toBe(true);
    expect(availableRoleMatches("decision_maker",["procurement_lead"])).toBe(false);
    expect(availableRoleMatches("decision_maker",["executive"])).toBe(true);
    expect(verifiedProspect("approved",0,false)).toBe(false);
    expect(journey("approved",0,false).stage).toContain("contacts optional");
  });
});

// @vitest-environment node
import { describe,it,expect } from "vitest";
import { buyerActivity,buyerPriority } from "./activity";
const identity="Atlas Works is an EPC contractor in India.";
const now=new Date("2026-10-05T00:00:00Z");
const claim=(quote:string,date:string|null)=>({company:"Atlas Works",companyQuote:identity,activityQuote:quote,activityDate:date});
describe("activity evidence and reference-only priority",()=>{
  it("needs a literal dated company claim, not a supplied timestamp",()=>{
    const q="Atlas Works secured a pipeline contract on 2026-09-01.";
    expect(buyerActivity(claim(q,"2026-09-01"),identity+"\n"+q,now).status).toBe("recent");
    expect(buyerActivity(claim(q,"2026-09-02"),identity+"\n"+q,now).status).toBe("capability_only");
    expect(buyerActivity(claim(q,"2026-09-01"),identity,now).status).toBe("capability_only");
  });
  it("does not manufacture active work from old, future or invalid dates",()=>{
    for(const date of ["2020-01-01","2026-12-01","2026-02-31"]){
      const q=`Atlas Works secured a pipeline contract on ${date}.`;
      expect(buyerActivity(claim(q,date),identity+"\n"+q,now).status).not.toBe("recent");
    }
    const q="Atlas Works completed a pipeline project.";
    expect(buyerActivity(claim(q,null),identity+"\n"+q,now).status).toBe("historic");
  });
  it("does not borrow another company's active job",()=>{
    const q="Beta Works secured a pipeline contract on 2026-09-01.";
    expect(buyerActivity(claim(q,"2026-09-01"),identity+"\n"+q,now).status).toBe("capability_only");
  });
  it("keeps unknown activity unknown and ranks current work higher without admission gates",()=>{
    expect(buyerPriority("application","capability_only","C").components.currentWork).toBeNull();
    expect(buyerPriority("application","recent","C").score).toBeGreaterThan(buyerPriority("application","capability_only","C").score);
  });
});

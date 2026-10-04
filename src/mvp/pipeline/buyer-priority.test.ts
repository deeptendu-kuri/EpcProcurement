// @vitest-environment node
import {describe,expect,it} from "vitest";
import {aiPriority} from "./index";
import {getClientProfile} from "@/mvp/config/profile";
import type {RawDoc} from "./contracts";
const profile=getClientProfile();
const article=(title:string,text:string)=>({raw:{title,publishedAt:new Date().toISOString()} as RawDoc,stored:{text}});
describe("product-scoped buyer research priority",()=>{
  it("prioritizes an awarded construction buyer above a pipe manufacturer's sales order",()=>{
    const buyer=article("EPC contractor wins line pipe construction contract","The awarded scope includes line pipe procurement and installation.");
    const seller=article("EPIC wins steel pipe order","A pipe manufacturer secured an order to supply line pipe.");
    expect(aiPriority(buyer,profile,"line-pipe")).toBeGreaterThan(aiPriority(seller,profile,"line-pipe"));
  });
  it("prioritizes the exact searched product and awarded work over other products or open bids",()=>{
    const wanted=article("EPC contractor awarded line pipe installation contract","Line pipe procurement for the awarded pipeline.");
    const other=article("EPC contractor awarded pump installation contract","Pump procurement for a water plant.");
    const tender=article("Open tender invitation for line pipe","Submit bids for line pipe procurement.");
    expect(aiPriority(wanted,profile,"line-pipe")).toBeGreaterThan(aiPriority(other,profile,"line-pipe"));
    expect(aiPriority(wanted,profile,"line-pipe")).toBeGreaterThan(aiPriority(tender,profile,"line-pipe"));
  });
});

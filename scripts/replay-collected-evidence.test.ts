// @vitest-environment node
/** Explicit offline replay of a LOCAL live-search capture. No HTTP, DB writes, or fake buyer substitutions. */
import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {buyerEvidence,discoverySchema} from "../src/mvp/discovery";
const capture=process.env.MVP_REPLAY_EVIDENCE_FILE;
describe("local original-source evidence replay",()=>{
  it.skipIf(!capture)("recovers supported buyers from actual cached responses without another provider call",()=>{
    const data=JSON.parse(readFileSync(capture!,"utf8")) as {documents:{url:string;text:string;result:unknown}[]};
    const results=data.documents.flatMap(doc=>{
      if(!doc.result)return [];
      return discoverySchema.parse(doc.result).buyers.map(buyer=>({company:buyer.company,url:doc.url,...buyerEvidence(buyer,doc.text,{query:"line pipe",productId:"line-pipe",markets:["IN"],leadKinds:["supply_subcontract"]})}));
    });
    const valid=results.filter(result=>result.buyer);console.log(JSON.stringify({offlineOriginalSourceReplay:true,providerCalls:0,validBuyers:valid.map(result=>({company:result.company,url:result.url,referenceScore:result.buyer!.confidence})),rejections:results.filter(result=>!result.buyer).map(result=>({company:result.company,reason:result.reason}))}));
    expect(valid.length).toBeGreaterThan(0);
    for(const result of valid){const text=data.documents.find(doc=>doc.url===result.url)!.text;expect(text.includes(result.buyer!.companyQuote)).toBe(true);if(result.buyer!.countryQuote)expect(text.includes(result.buyer!.countryQuote)).toBe(true);expect(text.includes(result.buyer!.productQuote)).toBe(true);}
  });
});

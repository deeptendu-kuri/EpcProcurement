// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { Queryable } from "@/mvp/db";
import { triggersForCompanies, type TriggerSql } from "./triggers";
const company="11111111-1111-4111-8111-111111111111",other="22222222-2222-4222-8222-222222222222";
const quote="Example EPC constructs process piping systems in India.";
const trigger=(id:string,company_id=company,evidence_ids=["Example-proof"]):TriggerSql=>({id,company_id,run_id:null,product_id:"ss-duplex-pipe",kind:"capability",role:"contractor",project_id:null,title:quote,value_usd:null,value_text:null,event_date:null,date_precision:"unknown",country:"IN",evidence_ids,strength:"possible"});
describe("Batched trigger reads preserve evidence gates",()=>{
  it("reads companies and proofs in two queries, with duplicate companies deduped",async()=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[trigger("Example-first"),trigger("Example-second")]})
      .mockResolvedValueOnce({rows:[{id:"Example-proof",quote,text:quote,document_id:"Example-document"}]});
    const results=await triggersForCompanies({query} as unknown as Queryable,[company,company]);
    expect(query).toHaveBeenCalledTimes(2);expect(query.mock.calls[0][1]).toEqual([[company]]);
    expect(results.get(company)).toHaveLength(2);expect(results.get(company)?.[0].trigger.country).toBe("IN");
  });
  it("never borrows another company’s quote or accepts a changed title",async()=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[trigger("Example-good"),trigger("Example-bad",other,["Example-missing"]),{...trigger("Example-reworded"),title:"Example EPC won a recent contract."}]})
      .mockResolvedValueOnce({rows:[{id:"Example-proof",quote,text:quote,document_id:"Example-document"}]});
    const results=await triggersForCompanies({query} as unknown as Queryable,[company,other]);
    expect(results.get(company)).toHaveLength(1);expect(results.has(other)).toBe(false);
  });
  it("skips the database completely for an empty list",async()=>{
    const query=vi.fn();expect((await triggersForCompanies({query} as unknown as Queryable,[])).size).toBe(0);expect(query).not.toHaveBeenCalled();
  });
});

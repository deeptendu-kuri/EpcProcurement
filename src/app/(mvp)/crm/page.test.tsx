import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import CrmPage from "./page";
import type { Opportunity } from "@/mvp/opportunities";
const fixtures=vi.hoisted(()=>({rows:[] as unknown[],run:"11111111-1111-4111-8111-111111111111"}));
vi.mock("@/mvp/opportunities",()=>({
  listOpportunities:async()=>fixtures.rows,
  recentSearches:async()=>[{id:fixtures.run,created_at:"2026-10-05",adhoc_query:{productId:"cables",query:"cables"}}],
  isVerified:(o:Opportunity)=>o.qualification==="approved"&&o.validated_emails>0&&!o.is_sample,
  opportunityJourney:()=>({action:"View company and contacts"}),
}));
vi.mock("@/components/mvp/search/page-data",()=>({catalogueOptions:()=>[{id:"cables",name:"Cables"}]}));
afterEach(()=>{cleanup();fixtures.rows=[];});
const base={id:"opportunity",run_id:fixtures.run,name:"Real Electrical Contractor",country:null,keyword:"cables",product_id:"cables",product_name:"Cables",buying_reason:"Documented cable installation",qualification:"pending",contact_role:"decision_maker",validated_emails:0,sent:false,is_sample:false,created_at:"2026-10-05",summary:"",material_fit_kind:"explicit",activity_status:"capability_only"} as Opportunity;
async function show(params:Record<string,string>={}){return render(await CrmPage({searchParams:Promise.resolve({search:fixtures.run,...params})}));}
describe("search-scoped CRM",()=>{
  it('excludes rejected records from potential buyers but preserves their explicit review history',async()=>{
    fixtures.rows=[{...base,qualification:'rejected'}];await show();
    expect(screen.queryByText(base.name)).toBeNull();cleanup();
    await show({qualification:'rejected'});expect(screen.getAllByText(base.name).length).toBeGreaterThan(0);
  });
  it("keeps a relevant company without contacts and preserves blank optional cells",async()=>{
    fixtures.rows=[base];await show();
    expect(screen.getAllByText(base.name).length).toBeGreaterThan(0);
    expect(screen.getByText(/Source-backed potential companies remain visible even without contacts/)).toBeTruthy();
    const table=screen.getByRole("table");const cells=table.querySelectorAll("tbody tr td");
    expect(cells[3].textContent).toBe(""); // Unknown country stays blank.
    expect(cells[5].textContent).toBe(""); // No contact substitute.
    expect(cells[8].textContent).toBe(""); // No fabricated conversation.
  });
  it("matches actual available contact roles rather than the requested search priority",async()=>{
    fixtures.rows=[{...base,available_contact_roles:["procurement_lead"]},{...base,id:"other",name:"Director Only",contact_role:"buyer",available_contact_roles:["executive"]}];
    await show({role:"buyer"});expect(screen.getAllByText(base.name).length).toBeGreaterThan(0);
    expect(screen.queryByText("Director Only")).toBeNull();
    expect((screen.getByLabelText("Available contact role") as HTMLSelectElement).value).toBe("buyer");
  });
  it("filters documented active work without treating high capability scores as current work",async()=>{
    fixtures.rows=[{...base,fit_score:100},{...base,id:"active",name:"Active Contractor",activity_status:"ongoing",fit_score:40}];
    await show({activity:"active"});expect(screen.queryByText(base.name)).toBeNull();
    expect(screen.getAllByText("Active Contractor").length).toBeGreaterThan(0);
  });
  it("offers an explicit contact-coverage filter without making it a default eligibility gate",async()=>{
    fixtures.rows=[base,{...base,id:"public",name:"Switchboard Company",public_contacts:[{kind:"phone",value:"+971 4 330 4465",source_url:"https://company.example/contact",quote:"Call +971 4 330 4465"}]}];
    await show({contacts:"any"});expect(screen.queryByText(base.name)).toBeNull();
    expect(screen.getAllByText("Switchboard Company").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Contact availability")).toBeTruthy();
  });
});

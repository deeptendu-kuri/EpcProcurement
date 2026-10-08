import { afterEach,describe,it,expect } from "vitest";
import { cleanup,render,screen,within } from "@testing-library/react";
import { ProjectResults } from "./project-results";
import type { Opportunity } from "@/mvp/opportunities";
afterEach(cleanup);
describe("buyer-first result cards",()=>{
  it("shows the actual company and evidence when no project is established, without inventing validation",()=>{
    const row={id:"unit",name:"Atlas Works",country:"IN",keyword:"line pipe",product_name:"line pipe",buying_reason:"Documented pipeline construction",qualification:"pending",validated_emails:0,sent:true,is_sample:false,project_id:null,source_urls:["https://atlas.example/services"]} as Opportunity;
    render(<ProjectResults rows={[row]} returnTo="/crm?search=unit"/>);
    expect(screen.getByRole("heading",{level:3}).textContent).toBe("Atlas Works");
    expect(screen.getByText(/current requirement unconfirmed/)).toBeTruthy();
    expect(screen.getByText("Buyer contact not yet validated")).toBeTruthy();
    expect(screen.getByText("What we can sell them")).toBeTruthy();
    expect(screen.getByText(/buyer not contacted/)).toBeTruthy();
    expect(screen.getByRole("link",{name:/Read supporting source/}).getAttribute("href")).toBe("https://atlas.example/services");
    expect(screen.getByRole("link",{name:/Open full lead workspace/}).getAttribute("href")).toContain("returnTo=");
  });
  it("groups active work first, keeps capability-only prospects and does not infer activity from a score",()=>{
    const base={country:null,keyword:"cables",product_name:"cables",buying_reason:"Cable installation",qualification:"pending",validated_emails:0,sent:false,is_sample:false,project_id:null,material_fit_kind:"explicit",discovery_version:1} as Opportunity;
    render(<ProjectResults rows={[{...base,id:"cap",name:"Capability Company",activity_status:"capability_only",fit_score:90},{...base,id:"active",name:"Active Company",activity_status:"ongoing",activity_date:"2026-09-20",fit_score:50}]} returnTo="/crm?search=unit" />);
    expect(screen.getAllByRole("heading",{level:3}).map(h=>h.textContent)).toEqual(["Active Company","Capability Company"]);
    expect(screen.getByRole("region",{name:"Relevant companies · current work unconfirmed"}).textContent).toContain("Capability Company");
    expect(screen.getAllByText(/not a purchase probability or sending gate/)).toHaveLength(2);
    expect(screen.queryByText(/Unknown|Project location not established/)).toBeNull();
  });
  it("shows a sourced switchboard without inventing a named or validated contact",()=>{
    const row={id:"contact",name:"Real Company",country:"AE",keyword:"HDPE pipe",product_name:"HDPE pipe",buying_reason:"HDPE installation",qualification:"pending",validated_emails:0,sent:false,is_sample:false,named_contact_count:0,public_contacts:[{kind:"phone",value:"+971 2 448 2626",source_url:"https://company.example/contact",quote:"Contact +971 2 448 2626"}]} as Opportunity;
    render(<ProjectResults rows={[row]} returnTo="/crm?search=contact" />);
    const region=screen.getByLabelText("Published company contacts for Real Company");
    expect(within(region).getByRole("link",{name:"+971 2 448 2626"}).getAttribute("href")).toBe("https://company.example/contact");
    expect(screen.getByText("Buyer contact not yet validated")).toBeTruthy();
    expect(screen.getByText(/Missing contacts never hide a relevant company/)).toBeTruthy();
  });
});

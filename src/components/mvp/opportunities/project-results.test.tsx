import { afterEach,describe,it,expect } from "vitest";
import { cleanup,render,screen } from "@testing-library/react";
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
    expect(screen.getByText(/buyer not contacted/)).toBeTruthy();
    expect(screen.getByRole("link",{name:/Read supporting source/}).getAttribute("href")).toBe("https://atlas.example/services");
    expect(screen.getByRole("link",{name:/Open contacts/}).getAttribute("href")).toContain("returnTo=");
  });
});

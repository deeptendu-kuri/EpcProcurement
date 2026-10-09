import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuyerView, EvidenceDrawerView } from "@/mvp/buyers/types";
import {exampleCompany} from '@/mvp/crm/fixtures';
import type { Opportunity } from "@/mvp/opportunities";
import { OpportunityWorkspace } from "./workspace";
const navigation=vi.hoisted(()=>({replace:vi.fn((path:string)=>window.history.replaceState(window.history.state,'',path))}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(),replace:navigation.replace }) }));
vi.mock("../outreach/conversation-timeline",()=>({ConversationTimeline:()=> <div>Email automation timeline</div>}));
vi.mock("../buyers/supply-chain-explorer",()=>({SupplyChainExplorer:({leadId,contactsOnly,productScope}:{leadId:string;contactsOnly:boolean;productScope:{id:string}})=> <div data-testid="restored-chain" data-lead={leadId} data-product={productScope.id}>{contactsOnly ? "Company contact roles & details" : "Supply chain and sub-contacts"}</div>}));
afterEach(cleanup);
const opportunity: Opportunity = { id: "opp-1", lead_id: "lead-1", run_id: "run-1", name: "Buyer", product_name: "line pipe", product_id: "line-pipe", keyword: "pipeline", country: "IN", qualification: "pending", is_sample: false, validated_emails: 0, sent: false, contact_role: "buyer", buying_reason: "Won pipeline work", evidence_ids: [], summary: "Saved review notes", owner_name: "Sales", next_action: "Review", follow_up_at: null, created_at: "2026-10-03T00:00:00.000Z" };
const buyer = { name: "Buyer", country: "IN", team: [], proof: [] } as unknown as BuyerView;
function show(overrides: Partial<Opportunity> = {}) { return render(<OpportunityWorkspace opportunity={{ ...opportunity, ...overrides }} buyer={buyer} returnTo="/crm?search=run-1&country=IN" events={[]} drafts={[]} points={[]} demoEmail={{ enabled: true, ready: false, recipient: "test@example.com", error: "Missing key" }} />); }
describe("guided workspace", () => {
  it('puts the navigation before project details and preserves the active tab in the URL',()=>{
    window.history.replaceState({},'','/opportunities/opp-1?returnTo=%2Fcrm%3Fcountry%3DIN');
    show();const tabs=screen.getByRole('tablist',{name:'Lead workspace'}),trigger=screen.getByRole('region',{name:'Trigger'});
    expect(tabs.compareDocumentPosition(trigger)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('tab',{name:'Contacts'}));
    const params=new URLSearchParams(window.location.search);expect(params.get('tab')).toBe('contacts');expect(params.get('returnTo')).toBe('/crm?country=IN');expect(navigation.replace).toHaveBeenCalledWith(expect.stringContaining('tab=contacts'),{scroll:false});
    expect(screen.queryByRole('region',{name:'Trigger'})).toBeNull();expect(screen.getByRole('complementary',{name:'Lead context and actions'})).toBeTruthy();
    window.history.replaceState({},'','/');
  });
  it('uses verified trigger and shared source cards, separating HQ from work country',()=>{
    const header=exampleCompany().row;header.hqCountry='BE';header.operatingCountry='AE';
    const evidence:EvidenceDrawerView={header,why:'Example Engineering 1 Limited constructs gas pipelines in UAE.',sources:[{documentId:'Example-doc',url:'https://example.com/Example',domain:'example.com',title:'Example verified page',publishedAt:null,kind:'company_site',quotes:[{evidenceId:'Example-proof',sentence:'Example Engineering 1 Limited constructs gas pipelines in UAE.',highlight:'constructs gas pipelines',proves:'material'}]}],contacts:[],related:{above:[],below:[]},activity:[]};
    render(<OpportunityWorkspace opportunity={{...opportunity,buying_reason:'Example unverified legacy claim',activity_quote:'Example unverified legacy claim',activity_date:'2026-10-08'}} buyer={buyer} returnTo='/crm' events={[]} drafts={[]} points={[]} demoEmail={{enabled:false,ready:false,recipient:null,error:null}} evidenceView={evidence}/>);
    expect(screen.getByRole('region',{name:'Trigger'}).textContent).toContain('no contract yet');
    expect(screen.getByRole('article',{name:'Source: Example verified page'}).querySelector('mark')?.textContent).toBe('constructs gas pipelines');
    const info=screen.getByRole('region',{name:'Company information'});expect(info.textContent).toContain('Headquarters countryBelgium');expect(info.textContent).toContain('Operating country · verified workUAE');
    expect(screen.queryByText('Example unverified legacy claim')).toBeNull();
    expect(screen.getByRole('region',{name:'Material fit and current activity'}).textContent).not.toContain('2026-10-08');
  });
  it('accepts contacts deep links without changing the email journey or sidebar',()=>{
    render(<OpportunityWorkspace opportunity={opportunity} buyer={buyer} returnTo='/crm' events={[]} drafts={[]} points={[]} demoEmail={{enabled:false,ready:false,recipient:null,error:null}} initialTab='contacts'/>);
    expect(screen.getByRole('tab',{name:'Contacts'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('complementary',{name:'Lead context and actions'})).toBeTruthy();
  });
  it('guides reviewed prospect demos to conversation without requiring missing personal contact data',()=>{
    render(<OpportunityWorkspace opportunity={{...opportunity,qualification:'approved'}} buyer={buyer} returnTo='/crm' events={[]} drafts={[]} points={[]} demoOutreach demoEmail={{enabled:true,ready:true,recipient:'test@example.com',error:null}}/>);
    fireEvent.click(screen.getByRole('button',{name:'View automatic workflow'}));expect(screen.getByRole('tab',{name:'Email & meetings'}).getAttribute('aria-selected')).toBe('true');expect(screen.queryByRole('region',{name:'Lead journey'})).toBeNull();
    fireEvent.click(screen.getByRole('tab',{name:'Overview'}));expect(screen.getByRole('region',{name:'Company information'})).toBeTruthy();expect(screen.getByRole('region',{name:'Material fit and current activity'})).toBeTruthy();
  });
  it("does not display the legacy pipeline fallback as an electrical material buyer's business",()=>{
    const b={...buyer,role:'subcontractor',whatTheyDo:'Pipeline builder'} as BuyerView;
    render(<OpportunityWorkspace opportunity={{...opportunity,product_id:'cables',product_name:'cables',discovery_version:5}} buyer={b} returnTo="/crm" events={[]} drafts={[]} points={[]} demoEmail={{enabled:false,ready:false,recipient:'test@example.com',error:null}} />);
    expect(screen.queryByText('Pipeline builder')).toBeNull();
    expect(within(screen.getByRole('region',{name:'Company information'})).getByText('Subcontractor')).toBeTruthy();
  });
  it("keeps saved summary labels accessible and blocks email until buyer-fit review", () => {
    show();
    expect((screen.getByLabelText("Summary", { exact: true }) as HTMLTextAreaElement).value).toBe("Saved review notes");
    expect(screen.queryByRole("button", { name: /Send|Preview demo email/ })).toBeNull();
    expect(screen.getByRole("complementary",{name:"Lead context and actions"})).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to leads/ }).getAttribute("href")).toBe("/crm?search=run-1&country=IN");
    fireEvent.click(screen.getByRole("tab",{name:"Contacts"}));
    expect(screen.getByText(/Contact verification is not connected/)).toBeTruthy();
  });
  it("shows the real conversation path and integration requirements instead of a manual send button", () => {
    show({ qualification: "approved" });
    fireEvent.click(screen.getByRole("tab",{name:"Email & meetings"}));
    expect(screen.getByText("Email automation timeline")).toBeTruthy();
    expect(screen.getByText(/booking requires a connected Calendar/)).toBeTruthy();
    expect(screen.getByRole("link",{name:"View automation & next step"}).getAttribute("href")).toBe("/outreach");
  });
  it("restores supply-chain and sub-contact tools scoped to the original lead/product",()=>{
    show();fireEvent.click(screen.getByRole("tab",{name:"Subcontractors & supply chain"}));
    const explorer=screen.getByTestId("restored-chain");expect(explorer.getAttribute("data-lead")).toBe("lead-1");expect(explorer.getAttribute("data-product")).toBe("line-pipe");
    expect(screen.getByText(/Unidentified company types are research slots/)).toBeTruthy();
    expect(screen.queryByText("Email automation timeline")).toBeNull();
  });
  it("keeps the sidebar across tabs and supports keyboard tab navigation",()=>{
    show();const overview=screen.getByRole("tab",{name:"Overview"});overview.focus();fireEvent.keyDown(overview,{key:"ArrowRight"});
    expect(screen.getByRole("tab",{name:"Contacts"}).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("complementary",{name:"Lead context and actions"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Email & meeting progress"}));expect(screen.getByText("Email automation timeline")).toBeTruthy();
  });
  it("shows only this search's product and proof; does not invent missing project or contact data",()=>{
    const enrichedBuyer={...buyer,sellItems:[{itemId:"other",name:"Unrelated valves",category:"valves",fit:"possible" as const,why:"Other product",evidenceIds:[]}],proof:[{evidenceId:"other-search",sentence:"Wrong search evidence",highlight:"",source:"Other source",date:null,url:null,verified:false}]};
    render(<OpportunityWorkspace opportunity={opportunity} buyer={enrichedBuyer} returnTo="/crm?search=run-1" events={[]} drafts={[]} points={[]} demoEmail={{enabled:true,ready:false,recipient:"test@example.com",error:null}} />);
    expect(screen.queryByText("Unrelated valves")).toBeNull();expect(screen.queryByText("Wrong search evidence")).toBeNull();
    expect(screen.getByRole("region",{name:"Project context"}).querySelector("h2")?.textContent).toBe("");
    expect(screen.getByRole("region",{name:"Contacts at this company"}).textContent).toContain("No named contacts yet");
  });
  it("deduplicates named contacts across role slots and never treats a sent demo as email validation",()=>{
    const p={id:"person-1",name:"Jane Buyer",title:"Procurement Manager",evidenceIds:[]};
    const b={...buyer,team:[{slotId:"a",person:p},{slotId:"b",person:p}]} as unknown as BuyerView;
    render(<OpportunityWorkspace opportunity={{...opportunity,sent:true,qualification:"approved"}} buyer={b} returnTo="/crm" events={[]} drafts={[]} points={[{person_id:p.id,value:"jane@example.com",source:"public",verified_at:null}]} demoEmail={{enabled:true,ready:true,recipient:"demo@example.com",error:null}} />);
    const rail=screen.getByRole("complementary");expect(within(rail).getByText("1 found")).toBeTruthy();expect(within(rail).getByText("jane@example.com")).toBeTruthy();
    expect(within(rail).queryByText("Validated buyer contact ready")).toBeNull();
    fireEvent.click(within(rail).getByRole("button",{name:"Open email conversation"}));expect(screen.getByRole("tab",{name:"Email & meetings"}).getAttribute("aria-selected")).toBe("true");
  });
});

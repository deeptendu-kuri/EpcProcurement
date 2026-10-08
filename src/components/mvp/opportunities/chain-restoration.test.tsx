import {cleanup,fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {SupplyChain,ChainContactRow} from "@/mvp/buyers/types";
import {SupplyChainExplorer} from "../buyers/supply-chain-explorer";
const api=vi.hoisted(()=>({getChain:vi.fn(),getChainContacts:vi.fn(),addContact:vi.fn(),confirmContact:vi.fn(),removeNodeCompany:vi.fn(),setNodeCompany:vi.fn(),saveDerivedBuyer:vi.fn()}));
vi.mock("../buyers/chain-api",()=>api);
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
const chain:SupplyChain={rootLeadId:"lead-1",rootCompanyId:"c1",peopleTotal:2,peopleFound:1,nodes:[
  {nodeId:"t1",tier:1,parentNodeId:null,companyId:"c1",leadId:"lead-1",derivedKey:null,name:"Buyer",whatTheyDo:"Pipeline builder",supplies:"",link:"confirmed",linkWhy:"Primary company",linkSource:"source",evidenceIds:[],wouldBuy:[{itemId:"line-pipe",name:"line pipe",category:"pipe",fit:"possible",why:"Pipeline activity",evidenceIds:[]},{itemId:"valves",name:"Unrelated valves",category:"valve",fit:"possible",why:"Unscoped",evidenceIds:[]}],competitorFor:[],found:1,total:1,candidates:[],expandable:false},
  {nodeId:"t2:sub",tier:2,parentNodeId:"t1",companyId:null,leadId:null,derivedKey:null,name:"Subcontractor type",whatTheyDo:"Specialist contractor",supplies:"installation",link:"not_identified",linkWhy:"Type only",linkSource:null,evidenceIds:[],wouldBuy:[],competitorFor:[],found:0,total:1,candidates:[],expandable:false},
]};
const contacts:ChainContactRow[]=[{tier:1,nodeId:"t1",companyId:"c1",companyName:"Buyer",companyIdentified:true,slotId:"procurement",role:"buyer",title:"Procurement",why:"Buying team",person:{id:"p1",name:"Jane Buyer",title:"Purchase Manager",email:"jane@example.com",phone:"12345",linkedinUrl:null,evidenceIds:[]},status:"likely",findLinks:[]},{tier:2,nodeId:"t2:sub",companyId:null,companyName:"Subcontractor type",companyIdentified:false,slotId:"director",role:"decision_maker",title:"Director",why:"Company first",person:null,status:"company_first",findLinks:[]}];
beforeEach(()=>{vi.clearAllMocks();api.getChain.mockResolvedValue(chain);api.getChainContacts.mockResolvedValue(contacts);});
afterEach(cleanup);
const scope={id:"line-pipe",name:"line pipe",projectLinked:false};
describe("restored scoped contact and supply-chain tools",()=>{
  it("shows root company contact names, email and phone without creating drafts or claiming validation",async()=>{
    render(<SupplyChainExplorer leadId="lead-1" rootShortName="Buyer" contactsOnly productScope={scope} />);
    await screen.findByText("Jane Buyer");const table=screen.getByRole("table",{name:"Company contact roles & details"});
    expect(within(table).getByText("Jane Buyer")).toBeTruthy();expect(within(table).getByText("jane@example.com")).toBeTruthy();expect(within(table).getByText("12345")).toBeTruthy();
    expect(within(table).queryByText("Subcontractor type")).toBeNull();expect(screen.queryByRole("button",{name:/Draft email/})).toBeNull();
    expect(screen.getByText(/Contact-role confirmation is not email validation/)).toBeTruthy();expect(api.addContact).not.toHaveBeenCalled();expect(api.confirmContact).not.toHaveBeenCalled();
  });
  it("retains tier-2 context but shows product fit only for the searched product",async()=>{
    render(<SupplyChainExplorer leadId="lead-1" rootShortName="Buyer" productScope={scope} />);
    expect(await screen.findByText("Company network & supply-chain research")).toBeTruthy();
    expect(screen.getByText("Tier 1 · primary company")).toBeTruthy();expect(screen.getByText("Not established for this product")).toBeTruthy();expect(screen.queryByText("Unrelated valves")).toBeNull();
    expect(screen.queryByText(/every company here can buy/)).toBeNull();expect(screen.queryByText("Tier 1 · won the work")).toBeNull();
    const table=screen.getByRole("table",{name:"All contacts in this supply chain"});
    expect(within(table).queryByText("Subcontractor type")).toBeNull();
    fireEvent.change(screen.getByLabelText("Contact company"),{target:{value:"t2:sub"}});
    expect(within(table).getByText("Subcontractor type")).toBeTruthy();expect(within(table).queryByText("Jane Buyer")).toBeNull();
  });
  it("shows a recoverable error instead of falsely reporting no contacts when that API fails",async()=>{
    api.getChainContacts.mockRejectedValueOnce(new Error("Offline"));
    render(<SupplyChainExplorer leadId="lead-1" rootShortName="Buyer" contactsOnly productScope={scope} />);
    expect(await screen.findByText(/Contact records could not load/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Retry contact records"}));await waitFor(()=>expect(screen.getByText("Jane Buyer")).toBeTruthy());
  });
});

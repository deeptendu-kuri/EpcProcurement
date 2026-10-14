import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FindForm } from "./find-form";
const api = vi.hoisted(()=>vi.fn());
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>"/find"}));
vi.mock("./api-client",()=>({apiJson:api}));
vi.mock("./shell/toast",()=>({useToast:()=>({show:vi.fn()})}));
vi.mock("./shell/events",()=>({EVENTS:{refreshStatus:"status"},emit:vi.fn()}));
afterEach(()=>{cleanup();api.mockReset();});
const props={markets:[{code:"IN",name:"India"}]};
const QUERY=/What product do you sell/;
describe("bounded material research form",()=>{
  it("keeps role optional and explicitly distinguishes a target from a yield promise",()=>{
    render(<FindForm {...props}/>);
    expect(screen.getByText(/Optional: prioritize a contact role/)).toBeTruthy();
    expect(screen.getByText(/not a guaranteed number of leads/)).toBeTruthy();
    expect(screen.getByText(/Companies appear even without contacts/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
  it("sends research mode and target without requiring contact details",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText(QUERY),{target:{value:"cables"}});
    fireEvent.click(screen.getByRole("radio",{name:/^Deep/}));
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("50");
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"70"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({method:"POST",body:expect.objectContaining({query:"cables",researchMode:"deep",targetCompanies:70,markets:["IN"]})}));
  });
  it("sends a quick search with no extra rounds, and the lead count to pause at",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText(QUERY),{target:{value:"cables"}});
    expect(screen.getByRole("radio",{name:/^Quick/}).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Leads before pausing"),{target:{value:"12"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({body:expect.objectContaining({researchMode:"preview",extraRounds:0,targetCompanies:10,pauseAfter:12})}));
  });
  it("warns when the free AI allowance cannot cover the chosen search size",()=>{
    render(<FindForm {...props} aiLeft={40_000}/>);
    expect(screen.getByRole("alert").textContent).toMatch(/about 40k tokens\. A Quick search needs up to 60k/);
    cleanup();render(<FindForm {...props} aiLeft={300_000}/>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/Free AI left \(last 24 hours\): about 300k tokens\./)).toBeTruthy();
  });
  it("rejects invalid targets before submitting a paid research request",()=>{
    render(<FindForm {...props}/>);fireEvent.change(screen.getByLabelText(QUERY),{target:{value:"cables"}});
    fireEvent.click(screen.getByRole("radio",{name:/^Deep/}));
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"49"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    expect(screen.getByRole("alert").textContent).toContain("between 50 and 100");
    expect(api).not.toHaveBeenCalled();
  });
  it("preserves the typed words and geography when reopening a search",()=>{
    render(<FindForm {...props} initialInput={{query:"Copper cable",productId:"cables",markets:["AE"],leadKinds:["supply_subcontract"],researchMode:"deep",targetCompanies:70}} />);
    expect((screen.getByLabelText(QUERY) as HTMLInputElement).value).toBe("Copper cable");
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("70");
    expect(screen.getByRole("button",{name:"United Arab Emirates"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"India"})).toBeNull();
  });
  it("searches exactly the typed words: no product types, chips or list to choose from (docs/mvp/22)",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText(QUERY),{target:{value:"pressure vessels"}});
    expect(screen.getByText(/We search open tenders and buyers for exactly/).textContent).toContain("pressure vessels");
    expect(screen.queryByRole("group",{name:"Product type"})).toBeNull();
    expect(screen.queryByText(/not in your product list/i)).toBeNull();
    expect(screen.queryByRole("combobox",{name:"Product to sell"})).toBeNull();
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    const body=api.mock.calls[0][1].body;
    expect(body).toMatchObject({query:"pressure vessels"});
    expect(body).not.toHaveProperty("productId");
  });
  it("shows the exact variant typed and sends the stockist choice (docs/mvp/19)",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText(QUERY),{target:{value:"Welded Stainless Steel Pipes 316L"}});
    expect(screen.getByText(/We search open tenders and buyers for exactly/).textContent).toContain("Welded · 316L");
    const toggle=screen.getByLabelText("Also find stockists and traders") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({body:expect.objectContaining({query:"Welded Stainless Steel Pipes 316L",includeResellers:false})}));
  });
});

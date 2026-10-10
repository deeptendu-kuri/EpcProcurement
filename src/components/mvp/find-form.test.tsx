import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FindForm } from "./find-form";
import { materialCatalogue } from "@/mvp/discovery/material-catalogue";
const api = vi.hoisted(()=>vi.fn());
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()}),usePathname:()=>"/find"}));
vi.mock("./api-client",()=>({apiJson:api}));
vi.mock("./shell/toast",()=>({useToast:()=>({show:vi.fn()})}));
vi.mock("./shell/events",()=>({EVENTS:{refreshStatus:"status"},emit:vi.fn()}));
afterEach(()=>{cleanup();api.mockReset();});
const props={markets:[{code:"IN",name:"India"}],products:[{id:"cables",name:"Electrical cables"}],suggestions:[]};
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
    fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"cables"}});
    fireEvent.click(screen.getByRole("radio",{name:/^Deep/}));
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("50");
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"70"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({method:"POST",body:expect.objectContaining({productId:"cables",researchMode:"deep",targetCompanies:70,markets:["IN"]})}));
  });
  it("sends a quick search with no extra rounds, and the lead count to pause at",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"cables"}});
    expect(screen.getByRole("radio",{name:/^Quick/}).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Leads before pausing"),{target:{value:"12"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({body:expect.objectContaining({researchMode:"preview",extraRounds:0,targetCompanies:10,pauseAfter:12})}));
  });
  it("rejects invalid targets before submitting a paid research request",()=>{
    render(<FindForm {...props}/>);fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"cables"}});
    fireEvent.click(screen.getByRole("radio",{name:/^Deep/}));
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"49"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    expect(screen.getByRole("alert").textContent).toContain("between 50 and 100");
    expect(api).not.toHaveBeenCalled();
  });
  it("preserves the chosen material and geography when reopening a search",()=>{
    render(<FindForm {...props} initialInput={{query:"Copper cable",productId:"cables",markets:["AE"],leadKinds:["supply_subcontract"],researchMode:"deep",targetCompanies:70}} />);
    expect((screen.getByLabelText("What do you supply?") as HTMLInputElement).value).toBe("Copper cable");
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("70");
    expect(screen.getByRole("button",{name:"United Arab Emirates"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"India"})).toBeNull();
  });
  it("reads plain words like a search engine: steel pipe offers types and says who buys",()=>{
    render(<FindForm {...props} materials={materialCatalogue()}/>);
    fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"steel pipe"}});
    expect(screen.getByText(/has several types/)).toBeTruthy();
    const types=screen.getByRole("group",{name:"Product type"});
    expect(types.textContent).toContain("Line pipe");expect(types.textContent).toContain("Casing and tubing");
    expect(screen.getByText(/Who buys line pipe:/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:/Carbon steel pipe/}));
    expect(screen.getByRole("button",{name:/Carbon steel pipe/}).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Who buys carbon steel pipe:/)).toBeTruthy();
  });
  it("sends the typed words with the chosen type",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props} materials={materialCatalogue()}/>);
    fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"seamless pipe ASTM A106"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({body:expect.objectContaining({query:"seamless pipe ASTM A106",productId:"cs-process-pipe"})}));
  });
  it("shows the exact variant typed and sends the stockist choice (docs/mvp/19)",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props} materials={materialCatalogue()}/>);
    fireEvent.change(screen.getByLabelText("What do you supply?"),{target:{value:"Welded Stainless Steel Pipes 316L"}});
    expect(screen.getAllByText("Welded · 316L",{selector:"strong"}).length).toBeGreaterThan(0);
    const toggle=screen.getByLabelText("Also find stockists and traders") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({body:expect.objectContaining({query:"Welded Stainless Steel Pipes 316L",productId:"ss-duplex-pipe",includeResellers:false})}));
  });
});

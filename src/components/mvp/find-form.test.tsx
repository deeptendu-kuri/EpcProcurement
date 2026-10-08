import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FindForm } from "./find-form";
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
    expect(screen.getByText("Optional: prioritize a contact role")).toBeTruthy();
    expect(screen.getByText(/not a guaranteed number of leads/)).toBeTruthy();
    expect(screen.getByText(/Companies appear even without contacts/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });
  it("sends research mode and target without requiring contact details",async()=>{
    api.mockRejectedValue(new Error("Unit test: no network"));render(<FindForm {...props}/>);
    fireEvent.change(screen.getByLabelText("Research mode"),{target:{value:"deep"}});
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("50");
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"70"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    await screen.findByRole("alert");
    expect(api).toHaveBeenCalledWith("/api/mvp/runs",expect.objectContaining({method:"POST",body:expect.objectContaining({productId:"cables",researchMode:"deep",targetCompanies:70,markets:["IN"]})}));
  });
  it("rejects invalid targets before submitting a paid research request",()=>{
    render(<FindForm {...props}/>);fireEvent.change(screen.getByLabelText("Research mode"),{target:{value:"deep"}});
    fireEvent.change(screen.getByLabelText("Target companies"),{target:{value:"49"}});
    fireEvent.submit(screen.getByRole("form",{name:"Search for opportunities"}));
    expect(screen.getByRole("alert").textContent).toContain("between 50 and 100");
    expect(api).not.toHaveBeenCalled();
  });
  it("preserves the chosen material and geography when reopening a search",()=>{
    render(<FindForm {...props} initialInput={{query:"Copper cable",productId:"cables",markets:["AE"],leadKinds:["supply_subcontract"],researchMode:"deep",targetCompanies:70}} />);
    expect((screen.getByLabelText("What do you offer?") as HTMLInputElement).value).toBe("Copper cable");
    expect((screen.getByLabelText("Target companies") as HTMLInputElement).value).toBe("70");
    expect(screen.getByRole("button",{name:"United Arab Emirates"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:"India"})).toBeNull();
  });
});

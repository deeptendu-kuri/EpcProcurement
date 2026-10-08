import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {SearchSwitcher} from "./search-switcher";
const push=vi.hoisted(()=>vi.fn());
vi.mock("next/navigation",()=>({useRouter:()=>({push})}));
afterEach(()=>{cleanup();push.mockReset();});
describe("immediate scoped search navigation",()=>{
  it("loads the selected search and keeps the current table without an extra submit",()=>{
    render(<SearchSwitcher value="Example-a" tab="contacts" options={[{id:"Example-a",label:"Pipe"},{id:"Example-b",label:"Cable"}]}/>);
    fireEvent.change(screen.getByLabelText("Search"),{target:{value:"Example-b"}});
    expect(push).toHaveBeenCalledWith("/crm?run=Example-b&tab=contacts");
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("makes a mixed-search view an explicit choice",()=>{
    render(<SearchSwitcher value="Example-a" tab="leads" options={[{id:"Example-a",label:"Pipe"}]}/>);
    fireEvent.change(screen.getByLabelText("Search"),{target:{value:"all"}});
    expect(push).toHaveBeenCalledWith("/crm?run=all&tab=leads");
  });
});

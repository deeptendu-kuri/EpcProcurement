// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {searchPublishedContacts} from "./public-contacts";
const mocks=vi.hoisted(()=>({read:vi.fn(),complete:vi.fn()}));
vi.mock("@/mvp/pipeline/read",()=>({fetchPageText:mocks.read}));
vi.mock("@/mvp/llm",()=>({getLLM:()=>({name:"groq",complete:mocks.complete})}));
const fetchMock=vi.fn();const quote="Jane Doe, Procurement Manager, jane@buyer.co";
beforeEach(()=>{vi.stubEnv("TAVILY_API_KEY","unit");vi.stubEnv("GROQ_API_KEY","unit");vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();mocks.read.mockReset();mocks.complete.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("published named contact discovery",()=>{
  it("saves only original-page name/title/email evidence, not snippets or off-domain results",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://buyer.co/team"},{url:"https://other.co/team"}]}),{status:200}));
    mocks.read.mockResolvedValue({ok:true,text:quote});mocks.complete.mockResolvedValue({text:JSON.stringify({contacts:[{name:"Jane Doe",title:"Procurement Manager",email:"jane@buyer.co",quote},{name:"Fake Person",title:"CEO",email:"fake@buyer.co",quote:"Invented statement not on the actual page"}]})});
    expect(await searchPublishedContacts("buyer.co")).toEqual([{name:"Jane Doe",title:"Procurement Manager",email:"jane@buyer.co",sources:["https://buyer.co/team"]}]);
    expect(mocks.read).toHaveBeenCalledTimes(1);const body=JSON.parse(fetchMock.mock.calls[0][1].body);expect(body.include_domains).toEqual(["buyer.co"]);expect(body.search_depth).toBe("basic");
  });
  it("returns no contacts if the original page cannot be read or has no published address",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://buyer.co/team"}]}),{status:200}));
    mocks.read.mockResolvedValue({ok:false,reason:"robots"});expect(await searchPublishedContacts("buyer.co")).toEqual([]);expect(mocks.complete).not.toHaveBeenCalled();
  });
});

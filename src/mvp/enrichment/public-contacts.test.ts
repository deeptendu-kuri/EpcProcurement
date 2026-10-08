// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {companyContactsFromPage,researchCompanyWebsite,researchPublishedContacts,searchPublishedContacts} from "./public-contacts";
const mocks=vi.hoisted(()=>({read:vi.fn(),complete:vi.fn()}));
vi.mock("@/mvp/pipeline/read",()=>({fetchPageText:mocks.read}));
vi.mock("@/mvp/llm",()=>({getLLM:()=>({name:"groq",complete:mocks.complete})}));
const fetchMock=vi.fn();const quote="Jane Doe, Procurement Manager, jane@buyer.co";
beforeEach(()=>{vi.stubEnv("TAVILY_API_KEY","unit");vi.stubEnv("GROQ_API_KEY","unit");vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();mocks.read.mockReset();mocks.complete.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("published named contact discovery",()=>{
  it("reads official contact details directly without a search or AI credit",async()=>{
    mocks.read.mockResolvedValue({ok:true,text:"Telephone +91 22 3064 2100\nBusiness enquiries info@buyer.co",finalUrl:"https://buyer.co/contact"});
    const result=await researchCompanyWebsite("buyer.co");expect(result.companyContacts).toHaveLength(2);expect(fetchMock).not.toHaveBeenCalled();expect(mocks.complete).not.toHaveBeenCalled();expect(mocks.read).toHaveBeenCalledTimes(1);
  });
  it("rejects contact evidence redirected to a different company",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://buyer.co/team"}]}),{status:200}));
    mocks.read.mockResolvedValue({ok:true,text:quote,finalUrl:"https://other.co/team"});
    expect(await researchPublishedContacts("buyer.co")).toEqual({contacts:[],companyContacts:[]});expect(mocks.complete).not.toHaveBeenCalled();
  });
  it("keeps public company phones/inboxes separate and ignores dates, investor inboxes and other domains",()=>{
    const text="Corporate Office\n+91 22 3064 2100/+91 22 6885 1500 (Board)\nBusiness Enquiries\ninfo@buyer.co\nInvestorRelations@buyer.co\nsales@other.co\nDate 2026-10-05\nPostal 400055";
    const points=companyContactsFromPage(text,"buyer.co","https://buyer.co/contact");
    expect(points.map(p=>p.value)).toEqual(["+91 22 3064 2100","+91 22 6885 1500","info@buyer.co"]);
    expect(points.every(p=>text.includes(p.quote))).toBe(true);
  });
  it("saves a published named role without inventing an email and uses one AI call for three pages",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({results:[{url:"https://buyer.co/team"},{url:"https://buyer.co/contact"},{url:"https://buyer.co/leadership"}]}),{status:200}));
    const text="Jane Doe, Procurement Manager\nPhone +91 22 3064 2100\ninfo@buyer.co";
    mocks.read.mockResolvedValue({ok:true,text});mocks.complete.mockResolvedValue({text:JSON.stringify({contacts:[{name:"Jane Doe",title:"Procurement Manager",email:null,quote:"Jane Doe, Procurement Manager"}]})});
    const result=await researchPublishedContacts("buyer.co");
    expect(result.contacts[0]).toMatchObject({name:"Jane Doe",email:null});expect(result.companyContacts.some(p=>p.kind==="phone")).toBe(true);expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
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

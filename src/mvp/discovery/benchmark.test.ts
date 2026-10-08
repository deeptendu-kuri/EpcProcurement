// @vitest-environment node
/** SYNTHETIC OFFLINE decision benchmark. Not fresh web research or evidence of live yield. */
import {describe,expect,it} from "vitest";
import {getCatalogue} from "@/mvp/config/buyers-config";
import {buyerEvidence,type DiscoveredBuyer} from "./index";
import {buyerActivity} from "./activity";
import type {RunInput} from "@/mvp/types";

const MATERIAL_EXAMPLES:Record<string,string>={
  "line-pipe":"API 5L line pipe","cs-process-pipe":"carbon steel pipe","ss-duplex-pipe":"stainless steel pipe",
  "alloy-pipe":"alloy steel pipe",octg:"OCTG well casing","di-pipe":"ductile iron pipe","hdpe-pipe":"HDPE pipe",
  "grp-pipe":"GRP pipe","pvc-pipe":"uPVC pipe","bw-fittings":"butt weld fittings","forged-fittings":"forged fittings",
  flanges:"flanges","induction-bends":"induction bends",spools:"prefabricated piping","gate-globe-check":"gate valve",
  "ball-valves":"ball valve","butterfly-valves":"butterfly valve","control-relief-valves":"control valve",
  "coating-materials":"pipe coating","field-joint-coating":"field joint coating","cathodic-protection":"cathodic protection",
  paints:"epoxy paint","stud-bolts":"stud bolts",gaskets:"gaskets","welding-consumables":"welding consumables",abrasives:"abrasives",
  "structural-steel":"structural steel",plates:"steel plate",rebar:"rebar","gratings-handrails":"pipe support",
  cables:"power cable","cable-trays":"cable tray",instruments:"pressure gauge",insulation:"mineral wool",pumps:"industrial water pumps",
};
interface Case {name:string;buyer:DiscoveredBuyer;text:string;input:RunInput;expected:boolean}
function fixture(id:string,index:number):Case {
  const company=`Synthetic Engineering ${index} Limited`;
  const quote=`${company} is an EPC contractor in India performing installation and procurement of ${MATERIAL_EXAMPLES[id]}.`;
  return {name:`explicit ${id}`,buyer:{company,country:"IN",role:"epc_contractor",companyQuote:quote,countryQuote:quote,productQuote:quote,project:null,projectQuote:null,confidence:0.01},text:quote,
    input:{query:getCatalogue().items.find(item=>item.id===id)!.shortName,productId:id,markets:["IN"],leadKinds:["supply_subcontract"]},expected:true};
}
const basic=getCatalogue().items.map((item,index)=>fixture(item.id,index));
const base=fixture("line-pipe",100);
const identity="Synthetic Atlas Engineering Limited is an EPC contractor based in India.";
function variation(name:string,text:string,patch:Partial<DiscoveredBuyer>,expected:boolean):Case {
  return {...base,name,text,expected,buyer:{...base.buyer,company:"Synthetic Atlas Engineering Limited",companyQuote:identity,countryQuote:identity,...patch}};
}
const positives:Case[]=[...basic,
  variation("separate named activity paragraph",`${identity}\n\nSynthetic Atlas Engineering Limited constructs gas transmission pipelines.`,{productQuote:"Synthetic Atlas Engineering Limited constructs gas transmission pipelines."},true),
  variation("pronoun-led adjacent activity paragraph",`${identity}\n\nWe construct gas transmission pipelines.`,{productQuote:"We construct gas transmission pipelines."},true),
  variation("pronoun-led adjacent activity sentence",`${identity} We construct gas transmission pipelines.`,{productQuote:"We construct gas transmission pipelines."},true),
  variation("unknown geography stays blank","Synthetic Atlas Engineering Limited is an EPC contractor.\nSynthetic Atlas Engineering Limited constructs gas transmission pipelines.",
    {companyQuote:"Synthetic Atlas Engineering Limited is an EPC contractor.",country:null,countryQuote:null,productQuote:"Synthetic Atlas Engineering Limited constructs gas transmission pipelines."},true),
  {...base,name:"unsupported optional project is blanked",buyer:{...base.buyer,project:"Synthetic Unpublished Project",projectQuote:"Not actually published"}},
  {...base,name:"missing project and contacts do not reject",buyer:{...base.buyer,project:null,projectQuote:null,confidence:0}},
  variation("source-defined company acronym",`${identity.replace("Limited is","Limited (SAEL) is")}\nSAEL constructs gas transmission pipelines.`,
    {companyQuote:identity.replace("Limited is","Limited (SAEL) is"),countryQuote:identity.replace("Limited is","Limited (SAEL) is"),productQuote:"SAEL constructs gas transmission pipelines."},true),
  variation("documented short legal name",`${identity}\nSynthetic Atlas Engineering constructs gas transmission pipelines.`,{productQuote:"Synthetic Atlas Engineering constructs gas transmission pipelines."},true),
];
const negatives:Case[]=basic.map((item,index)=>{
  const quote=`Synthetic Other Company ${index} performs installation and procurement of ${MATERIAL_EXAMPLES[item.input.productId!]}.`;
  return {...item,name:`other-company scope ${item.input.productId}`,text:`${item.text}\n${quote}`,buyer:{...item.buyer,productQuote:quote},expected:false};
});
negatives.push(
  {...base,name:"owner-only",buyer:{...base.buyer,role:"owner"},expected:false},
  {...base,name:"supplier-only",buyer:{...base.buyer,role:"supplier"},expected:false},
  {...base,name:"unsupported company identity",buyer:{...base.buyer,company:"Synthetic Invented Buyer"},expected:false},
  {...base,name:"invented product quote",buyer:{...base.buyer,productQuote:"This unpublished pipe installation claim was invented."},expected:false},
  {...base,name:"wrong selected geography",buyer:{...base.buyer,country:"SA"},expected:false},
  variation("borrowed other-company geography",`${identity}\nBeta Works is based in Saudi Arabia.\nSynthetic Atlas Engineering Limited constructs gas transmission pipelines.`,
    {country:"SA",countryQuote:"Beta Works is based in Saudi Arabia.",productQuote:"Synthetic Atlas Engineering Limited constructs gas transmission pipelines."},false),
  variation("open tender only","Synthetic Atlas Engineering Limited is an EPC contractor in India inviting bids for pipeline construction; tender notice and bid deadline apply.",
    {companyQuote:"Synthetic Atlas Engineering Limited is an EPC contractor in India inviting bids for pipeline construction; tender notice and bid deadline apply.",countryQuote:"Synthetic Atlas Engineering Limited is an EPC contractor in India inviting bids for pipeline construction; tender notice and bid deadline apply.",productQuote:"Synthetic Atlas Engineering Limited is an EPC contractor in India inviting bids for pipeline construction; tender notice and bid deadline apply."},false),
  variation("other company breaks pronoun continuation",`${identity}\n\nBeta Works is a different contractor in India.\n\nWe construct gas transmission pipelines.`,{productQuote:"We construct gas transmission pipelines."},false),
  variation("geography inferred from customer brand","Synthetic Atlas Engineering Limited is an EPC contractor constructing gas pipelines for Aramco.",
    {companyQuote:"Synthetic Atlas Engineering Limited is an EPC contractor constructing gas pipelines for Aramco.",productQuote:"Synthetic Atlas Engineering Limited is an EPC contractor constructing gas pipelines for Aramco.",country:"SA",countryQuote:"Synthetic Atlas Engineering Limited is an EPC contractor constructing gas pipelines for Aramco."},false),
  variation("pipeline services belonging to named second company in identity span",`${identity}\nBeta Engineering installs gas transmission pipelines in India.`,
    {companyQuote:`${identity}\nBeta Engineering installs gas transmission pipelines in India.`,productQuote:"Beta Engineering installs gas transmission pipelines in India."},false),
  {...base,name:"HDPE work does not qualify as line pipe",text:"Synthetic Engineering 100 Limited is an EPC contractor in India installing HDPE water pipelines.",
    buyer:{...base.buyer,companyQuote:"Synthetic Engineering 100 Limited is an EPC contractor in India installing HDPE water pipelines.",countryQuote:"Synthetic Engineering 100 Limited is an EPC contractor in India installing HDPE water pipelines.",productQuote:"Synthetic Engineering 100 Limited is an EPC contractor in India installing HDPE water pipelines."},expected:false},
);

describe("SYNTHETIC offline discovery benchmark (not live market performance)",()=>{
  it("contains at least 30 positives and 30 negatives with every catalogue category represented",()=>{
    expect(positives.length).toBeGreaterThanOrEqual(30);expect(negatives.length).toBeGreaterThanOrEqual(30);
    expect(new Set(basic.map(item=>item.input.productId)).size).toBe(35);
  });
  it.each(positives)("preserves $name",item=>{
    const decision=buyerEvidence(item.buyer,item.text,item.input);
    expect(decision.buyer,decision.reason).not.toBeNull();
    if(item.buyer.project==="Synthetic Unpublished Project")expect(decision.buyer!.project).toBeNull();
    if(item.buyer.country===null)expect(decision.buyer!.countryQuote).toBeNull();
  });
  it.each(negatives)("rejects $name",item=>{
    const decision=buyerEvidence(item.buyer,item.text,item.input);
    expect(decision.buyer,`Incorrect inclusion: ${decision.reason}`).toBeNull();
  });
  it("keeps current activity separate from capability and completion",()=>{
    const now=new Date("2026-10-05T00:00:00Z");
    expect(buyerActivity(base.buyer,base.text,now).status).toBe("capability_only");
    const ongoing=`${base.buyer.company} is executing a gas pipeline project on 2026-09-01; work is ongoing.`;
    expect(buyerActivity({...base.buyer,activityDate:"2026-09-01",activityQuote:ongoing},base.text+"\n"+ongoing,now).status).toBe("ongoing");
    const completed=`${base.buyer.company} completed pipeline construction on 2026-09-01.`;
    expect(buyerActivity({...base.buyer,activityDate:"2026-09-01",activityQuote:completed},base.text+"\n"+completed,now).status).toBe("historic");
    const footer=`${base.buyer.company} copyright 2026-09-01.`;
    expect(buyerActivity({...base.buyer,activityDate:"2026-09-01",activityQuote:footer},base.text+"\n"+footer,now).status).toBe("capability_only");
  });
});

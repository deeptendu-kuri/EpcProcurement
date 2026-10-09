// @vitest-environment node
import {afterEach,describe,expect,it,vi} from "vitest";
import {getCatalogue} from "@/mvp/config/buyers-config";
import {MATERIAL_ACTIVITIES} from "./material";
import {materialCatalogue,resolveMaterial} from "./material-catalogue";
import {interpretMaterial} from "./interpret";
import {buyerPageCandidate,buyerQueries,buyingActivities,materialEvidenceKind,researchBudget} from "./plan";
import type {RunInput} from "@/mvp/types";
const input:RunInput={query:"line pipe",productId:"line-pipe",markets:["IN","AE","SA"],leadKinds:["supply_subcontract"]};
afterEach(()=>vi.unstubAllEnvs());
describe("reviewed material interpretation and consuming-work planning",()=>{
  it("covers every catalogue item rather than defaulting electrical/civil materials to pipes",()=>{
    expect(getCatalogue().items).toHaveLength(35);
    for(const item of getCatalogue().items){expect(MATERIAL_ACTIVITIES[item.id]?.length,item.id).toBeGreaterThanOrEqual(2);expect(resolveMaterial(item.shortName,item.id).productId,item.id).toBe(item.id);}
    expect(buyingActivities("cables")).toContain("electrical installation");
    expect(buyingActivities("rebar")).toContain("reinforced concrete construction");
    expect(buyingActivities("not-in-catalogue")).toEqual([]);
  });
  it.each([["HDPE","hdpe-pipe"],["power cables","cables"],["electrical wiring","cables"],["welding wire","welding-consumables"],["steel beams","structural-steel"],["ASTM A106","cs-process-pipe"],["stainless steel pipe","ss-duplex-pipe"],
    ["seamless pipe ASTM A106","cs-process-pipe"],["casing and tubing","octg"],["GI pipe","cs-process-pipe"],["LSAW pipe","line-pipe"],["steel plates","plates"],["ductile iron pipe","di-pipe"],["cables","cables"]])("resolves %s to %s without a provider",(query,id)=>{
    expect(resolveMaterial(query)).toMatchObject({status:"resolved",productId:id,originalKeyword:query});
  });
  it.each(["wire","steel","valves","pipe","steel pipe"])("offers product types for generic %s instead of guessing",query=>{
    const result=resolveMaterial(query);
    expect(result).toMatchObject({status:"clarification",productId:null});
    expect(result.candidateIds.length).toBeGreaterThan(1);
  });
  it("reads generic words as a family with one-click types and who buys",()=>{
    const steelPipe=interpretMaterial(materialCatalogue(),"steel pipe");
    expect(steelPipe).toMatchObject({family:"Steel pipe",confidence:"broad"});
    expect(steelPipe.choices.map(c=>c.id)).toEqual(["line-pipe","cs-process-pipe","ss-duplex-pipe","alloy-pipe","octg"]);
    expect(steelPipe.whoBuys.length).toBeGreaterThan(0);
    expect(interpretMaterial(materialCatalogue(),"carbon steel pipe").best?.id).toBe("cs-process-pipe");
    expect(interpretMaterial(materialCatalogue(),"steel pipe for gas pipeline").best?.id).toBe("line-pipe");
    expect(interpretMaterial(materialCatalogue(),"plates").whoBuys).toContain("Shipyards");
  });
  it("trusts the chosen type unless the words clearly name a different material",()=>{
    expect(resolveMaterial("steel pipe","line-pipe")).toMatchObject({status:"resolved",productId:"line-pipe"});
    expect(resolveMaterial("steel pipe","cs-process-pipe")).toMatchObject({status:"resolved",productId:"cs-process-pipe"});
    expect(resolveMaterial("wire","line-pipe")).toMatchObject({status:"resolved",productId:"line-pipe"});
    expect(resolveMaterial("power cables","line-pipe")).toMatchObject({status:"clarification",productId:null,candidateIds:["line-pipe","cables"]});
  });
  it("does not substitute materials outside the catalogue",()=>{
    expect(resolveMaterial("cement")).toMatchObject({status:"unsupported",productId:null});
    expect(resolveMaterial("optical fiber cable")).toMatchObject({productId:null});
    expect(resolveMaterial("cement","cables")).toMatchObject({status:"unsupported",productId:null});
    expect(resolveMaterial("HDPE","invalid")).toMatchObject({status:"unsupported",productId:null});
    expect(buyerQueries({...input,productId:"invalid"})).toEqual([]);
  });
  it("visits every market before a second company/project lane",()=>{
    const queries=buyerQueries(input);
    expect(queries.map(q=>q.market)).toEqual(["IN","AE","SA","IN","AE","SA","IN","AE","SA","IN","AE","SA"]);
    expect(queries.slice(0,3).every(q=>q.lane==="company")).toBe(true);
    expect(queries.slice(3,6).every(q=>q.lane==="company")).toBe(true);
    expect(queries.slice(6).every(q=>q.lane==="project")).toBe(true);
    expect(new Set(queries.map(q=>q.key)).size).toBe(queries.length);
    expect(queries[0].query).not.toContain("United Arab Emirates");
    expect(queries[1].query).toContain("United Arab Emirates");
  });
  it("deep mode adds activity variants with explicit ceilings and keeps identical plan keys",()=>{
    vi.stubEnv("MVP_MAX_SEARCH_QUERIES","999");vi.stubEnv("MVP_MAX_AI_DOCS","8");
    const deep={...input,researchMode:"deep" as const,targetCompanies:70};
    const plan=buyerQueries(deep);expect(plan.length).toBeGreaterThan(24);
    expect(plan.some(q=>q.activityIndex>0&&q.lane==="activity")).toBe(true);
    expect(researchBudget(deep)).toMatchObject({mode:"deep",searchQueries:24,bingQueries:30,maxPages:200,maxAiPages:8,maxAiTokens:250_000,maxPagesPerDomain:4,maxRepairCalls:2,targetCompanies:70});
    expect(researchBudget(input)).toMatchObject({mode:"preview",searchQueries:4,bingQueries:6,maxAiPages:8});
    expect(plan.slice(0,3).map(q=>q.key)).toEqual(buyerQueries(input).slice(0,3).map(q=>q.key));
  });
  it('uses material-specific company routes before broad consulting/directory routes in a batch',()=>{
    const plan=buyerQueries({...input,query:'power cables',productId:'cables',markets:['AE'],researchMode:'batch'});
    expect(plan[0].query).toBe('United Arab Emirates power cable installation contractors');
    expect(plan.slice(0,5).every(q=>q.lane==='company')).toBe(true);
    expect(plan.find(q=>q.lane!=='company')?.lane).toBe('project');
    expect(plan[0].query).not.toContain('-jobs');
  });
});
describe("material-specific evidence without domain-wide keyword bans",()=>{
  it("does not let an HDPE navigation link erase separate line-pipe work",()=>{
    const text="Our services: HDPE installation.\nAtlas constructs gas transmission pipelines.";
    expect(materialEvidenceKind(text,"line-pipe")).toBe("application");
    expect(materialEvidenceKind("Atlas constructs HDPE water pipelines.","line-pipe")).toBe("none");
    expect(materialEvidenceKind("Atlas installs HDPE and API 5L line pipe.","line-pipe")).toBe("explicit");
  });
  it("keeps cable types distinct and does not confuse optical laying with power cable buying",()=>{
    expect(materialEvidenceKind("Atlas installs optical fiber cables for telecom.","cables")).toBe("none");
    expect(materialEvidenceKind("Atlas performs electrical installation and power distribution construction.","cables")).toBe("application");
    expect(materialEvidenceKind("Atlas installs armoured cable.","cables")).toBe("explicit");
    expect(materialEvidenceKind('Services Portfolio: Installation & Acceptance Testing, Onsite Repair, Oil Purification, Electrical Testing, Spare','cables')).toBe('none');
  });
  it("matches engineering meaning rather than finance/marketing homonyms",()=>{
    expect(materialEvidenceKind("We procure TV channels and publishing plates.","structural-steel")).toBe("none");
    expect(materialEvidenceKind("We install concrete slabs and display sheets.","plates")).toBe("none");
    expect(materialEvidenceKind("We install software transmitter channels.","instruments")).toBe("none");
    expect(materialEvidenceKind("We install electrical insulation on optical wire.","insulation")).toBe("none");
  });
  it("distinguishes directly published materials from supported consuming applications",()=>{
    expect(materialEvidenceKind("Atlas fabricates pressure vessels.","plates")).toBe("application");
    expect(materialEvidenceKind("Atlas specializes in pressure vessel fabrication.","plates")).toBe("application");
    expect(materialEvidenceKind("Atlas fabricates steel plates.","plates")).toBe("explicit");
    expect(materialEvidenceKind("Atlas undertakes structural steel fabrication.","welding-consumables")).toBe("application");
    expect(buyerPageCandidate("Atlas is an EPC contractor.","cables")).toBe(false);
    expect(buyerPageCandidate("Atlas installs power cables.","cables")).toBe(true);
  });
});

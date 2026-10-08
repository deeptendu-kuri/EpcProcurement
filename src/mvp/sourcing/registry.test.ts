// @vitest-environment node
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,afterEach,describe,it,expect,vi} from 'vitest';
import {createTestDb,type Db} from '@/mvp/db';
import {createResearchRun,sessionFor} from '@/mvp/research/store';
import {processResearchTick,type ResearchDeps} from '@/mvp/research/engine';
import {htmlToText} from '@/mvp/pipeline/read';
import {SOURCING_REGISTRY,collectRegistry,registryFeedDocs,registryPageTargets,registryReadWarning} from './registry';
import pages from './fixtures/baseline-pages.json';
import {sourcePlan} from './plan';
const network=vi.hoisted(()=>({robots:vi.fn(),text:vi.fn(),wait:vi.fn()}));
vi.mock('@/mvp/pipeline/read',async original=>({...await original<object>(),robotsAllowed:network.robots,getText:network.text,politeWait:network.wait}));
const input={query:'line pipe',productId:'line-pipe',markets:['IN','AE'],leadKinds:['supply_subcontract' as const]};
const kpil=pages.documents.find(p=>p.url.includes('businessline'))!;
const dewa=pages.documents.find(p=>p.url.includes('dewa-awards'))!;
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function replay(file:string,page=dewa){return readFileSync(new URL(`./fixtures/${file}`,import.meta.url),'utf8').replace('{{original}}',escape(page.text)).replace('{{url}}',escape(page.url)).replace('{{title}}',escape(page.title??''));}
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe('WP9 public registry readers (explicit Example transport wrappers)',()=>{
  it('plans required public registries and retains the existing structured TED source',()=>{
    const plan=sourcePlan({productId:'line-pipe',markets:['IN','SA','AE','NO','MY'],mode:'batch'});
    for(const id of ['saudigulf-awards','bse-orders','nse-orders','cppp-awards','tadawul-announcements','bursa-announcements'])expect(plan.some(p=>p.registryId===id)).toBe(true);
    expect(plan.some(p=>p.source==='ted'&&p.market==='NO')).toBe(true);
    expect(plan.some(p=>p.registryId==='petronas-licensing')).toBe(false);
    expect(SOURCING_REGISTRY.every(s=>s.cadenceDays>0&&s.maxPages<=4&&/^https:/.test(s.url))).toBe(true);
  });
  it.each(['saudigulf-awards','cppp-awards','tadawul-announcements','bursa-announcements','dewa-contractor-list'])('reads saved real text in an Example HTML transport for %s without fabricating missing awardees',async id=>{
    const source=SOURCING_REGISTRY.find(s=>s.id===id)!;
    const parsed=await htmlToText(replay('registry-replay.html'),source.url,true);
    expect(parsed.text).toContain('Dubai Electricity and Water Authority');expect(parsed.tables[0]).toHaveLength(1);
    expect(parsed.links[0].url).toBe(dewa.url);
    network.robots.mockResolvedValue(true);
    const docs=await collectRegistry(source,input);expect(docs[0]).toMatchObject({kind:'roundup',text:null,research:{registryId:id}});
    expect(network.text).not.toHaveBeenCalled(); // HTML fetch happens in the shared budgeted read stage.
  },30000);
  it.each(['bse-orders','nse-orders'])('filters %s RSS and never promotes feed descriptions into evidence',id=>{
    const docs=registryFeedDocs(SOURCING_REGISTRY.find(s=>s.id===id)!,replay('registry-replay.xml',kpil),input);
    expect(docs).toHaveLength(1);expect(docs[0]).toMatchObject({url:kpil.url,text:null,kind:'roundup'});expect(docs[0].fallbackText).toBeUndefined();
  });
  it('honours robots before a feed and checks every redirect hop',async()=>{
    const source=SOURCING_REGISTRY.find(s=>s.id==='bse-orders')!;network.robots.mockResolvedValue(false);
    await expect(collectRegistry(source,input)).rejects.toThrow('robots');expect(network.text).not.toHaveBeenCalled();
    network.robots.mockResolvedValue(true);network.text.mockResolvedValue({ok:true,text:replay('registry-replay.xml',kpil)});
    await collectRegistry(source,input);expect(network.text.mock.calls[0][3].beforeHop).toBeTypeOf('function');
    network.robots.mockResolvedValue(false);await expect(network.text.mock.calls[0][3].beforeHop('https://www.bseindia.com/attachment')).rejects.toThrow('robots');
  });
  it('follows only bounded relevant public links, not login/social/unrelated links',()=>{
    const source=SOURCING_REGISTRY.find(s=>s.id==='saudigulf-awards')!;
    const relevant={url:dewa.url,text:dewa.title!};
    const selected=registryPageTargets(source,[relevant,{url:'https://linkedin.com/company/example',text:'Example pipeline contract'},{url:source.url+'login',text:'Example pipeline contract'},{url:source.url+'board',text:'Example board meeting'}],{...input,productId:'cables'});
    expect(selected).toEqual([relevant]);
    expect(registryReadWarning('dewa-contractor-list','http','HTTP 403')).toMatchObject({requiresManualFetch:true,coverageWarning:true,httpStatus:403});
  });
});
describe('registry failures are coverage, not failed runs',()=>{
  let db:Db;beforeAll(async()=>{db=await createTestDb();},120000);afterAll(async()=>db.close());
  it('settles an unavailable registry-only batch and never invents buyers or sends mail',async()=>{
    vi.stubEnv('TAVILY_API_KEY','');const id=await createResearchRun({...input,markets:['AE'],query:'power cables',productId:'cables',lanes:['roundup']},db);
    const deps:ResearchDeps={collect:vi.fn(async(source,_ctx,payload)=>{if(source==='directory-seed')return [payload.raw as never];throw new Error('Registry HTTP 403');}),read:vi.fn(async()=>({ok:false as const,reason:'http' as const,detail:'HTTP 403'})),discover:vi.fn(),save:vi.fn()};
    for(let tick=0;tick<30&&(await sessionFor(db,id))?.state==='active';tick++)await processResearchTick(db,deps,id);
    expect((await sessionFor(db,id))?.state).toBe('done');
    expect((await db.query<{status:string;counters:{coverageIncomplete:boolean}}>('select status,counters from runs where id=$1',[id])).rows[0]).toMatchObject({status:'done',counters:{coverageIncomplete:true}});
    expect((await db.query("select result from research_jobs where run_id=$1 and result->>'requiresManualFetch'='true'",[id])).rows).toHaveLength(2);
    expect((await db.query('select id from search_opportunities')).rows).toHaveLength(0);expect((await db.query('select id from funnel_messages')).rows).toHaveLength(0);
  });
});

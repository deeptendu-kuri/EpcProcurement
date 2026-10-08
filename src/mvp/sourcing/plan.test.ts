// @vitest-environment node
import { afterEach,describe,expect,it,vi } from 'vitest';
import { researchBudget } from '@/mvp/discovery/plan';
import { runInputSchema } from '@/app/api/mvp/_shared/schemas';
import { sourcePlan,tavilyTask } from './plan';
import { classifyPage } from './classify';
import { junkReason } from './junk';
import fixtures from './fixtures/baseline-pages.json';
afterEach(()=>vi.unstubAllEnvs());
describe('WP2 hybrid source plan and deterministic classification',()=>{
  it.each([
    {productId:'line-pipe',keyword:'line pipe',markets:['IN','AE']},
    {productId:'cables',keyword:'power and control cables',markets:['AE']},
    {productId:'line-pipe',keyword:'pipeline',markets:['IN','SA','AE','NO','MY']},
  ])('plans the three benchmark queries in trigger → roundup → capability order: $keyword',input=>{
    const plan=sourcePlan({...input,mode:'batch'});
    for(const market of input.markets){
      const tasks=plan.filter(t=>t.market===market);
      expect(tasks.filter(t=>t.source==='bing-query')).toHaveLength(2);
      expect(tasks.filter(t=>t.source==='tavily'&&t.lane==='trigger')).toHaveLength(1);
      expect(tasks.filter(t=>t.source==='tavily'&&t.lane==='roundup')).toHaveLength(1);
      expect(tasks.filter(t=>t.source==='tavily'&&t.lane==='capability')).toHaveLength(2);
      expect(tavilyTask(tasks.find(t=>t.source==='tavily'&&t.lane==='trigger')!)).toMatchObject({topic:'news',days:365});
    }
    const firstFallback=plan.findIndex(t=>t.lane==='capability');
    expect(plan.slice(firstFallback).every(t=>t.lane==='capability')).toBe(true);
    if(input.markets.includes('NO'))expect(plan.some(t=>t.source==='ted'&&t.market==='NO')).toBe(true);
    expect(new Set(plan.map(t=>t.id)).size).toBe(plan.length);
  });
  it('always includes public registry and EU/EEA TED tasks, with an explicit lane opt-out',()=>{
    expect(sourcePlan({productId:'cables',markets:['AE','DE'],mode:'preview'}).some(t=>t.registryId==='dewa-contractor-list')).toBe(true);
    expect(sourcePlan({productId:'cables',markets:['DE'],mode:'preview'}).some(t=>t.source==='ted')).toBe(true);
    expect(sourcePlan({productId:'cables',markets:['AE'],mode:'preview',lanes:['trigger']}).every(t=>t.lane==='trigger')).toBe(true);
  });
  it.each([
    ['preview',4,6,40,20,60000],['batch',8,12,80,40,120000],['deep',24,30,200,80,250000],
  ] as const)('has explicit %s budgets which env can only reduce', (mode,searchQueries,bingQueries,maxPages,maxAiPages,maxAiTokens)=>{
    const input={query:'line pipe',markets:['IN'],researchMode:mode};
    for(const key of ['MVP_MAX_SEARCH_QUERIES','MVP_MAX_BING_QUERIES','MVP_MAX_RESEARCH_PAGES','MVP_MAX_AI_DOCS','MVP_MAX_RESEARCH_AI_TOKENS'])vi.stubEnv(key,'999999');
    expect(researchBudget(input)).toMatchObject({searchQueries,bingQueries,maxPages,maxAiPages,maxAiTokens});
    vi.stubEnv('MVP_MAX_SEARCH_QUERIES','0');vi.stubEnv('MVP_MAX_RESEARCH_AI_TOKENS','500');
    expect(researchBudget(input)).toMatchObject({searchQueries:0,maxAiTokens:500});
  });
  it('classifies saved DEWA as roundup, Tekzone as company site, KPIL as article',()=>{
    const expected=[['dewa-awards','roundup'],['tekzoneme','company_site'],['businessline','article']];
    for(const [url,kind] of expected){const page=fixtures.documents.find(d=>d.url.includes(url))!;expect(classifyPage(page)).toBe(kind);}
    expect(classifyPage({url:'https://ted.europa.eu/en/notice/-/detail/686247-2026',title:'Contract award notice',text:''})).toBe('tender_notice');
    expect(classifyPage({url:'https://www.bseindia.com/announcements',title:null,text:''})).toBe('filing');
  });
  it('blocks junk domains, market/job titles, social and search-result HTML before any reading',()=>{
    for(const url of ['https://www.ibisworld.com/industry/','https://en.wikipedia.org/wiki/Pipeline','https://www.mordorintelligence.com/companies','https://anything.weebly.com/page','https://linkedin.com/company/kec','https://www.google.com/search?q=kec','https://www.amazon.co.uk/pipe'])expect(junkReason(url,'Example', ['AE'])).not.toBeNull();
    expect(junkReason('https://example.org/report','Example market outlook')).not.toBeNull();
    expect(junkReason('https://highergov.com/contract','Example',['AE'])).not.toBeNull();
    expect(junkReason('https://highergov.com/contract','Example',['US'])).toBeNull();
    expect(junkReason('https://tekzoneme.com/services','Cross country pipelines',['AE'])).toBeNull();
  });
  it('validates lanes on the existing runs request without exposing recipient overrides',()=>{
    const input={query:'line pipe',productId:'line-pipe',markets:['IN'],leadKinds:['supply_subcontract'],lanes:['trigger','roundup'],recipient:'not-allowed@example.org'};
    expect(runInputSchema.parse(input)).toMatchObject({lanes:['trigger','roundup']});
    expect(runInputSchema.parse(input)).not.toHaveProperty('recipient');
    expect(runInputSchema.safeParse({...input,lanes:['linkedin']}).success).toBe(false);
  });
});

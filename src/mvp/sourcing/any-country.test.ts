// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '@/mvp/config/countries';
import { runInputSchema } from '@/app/api/mvp/_shared/schemas';
import { countriesInQuote } from '@/mvp/discovery/locations';
import { buyerEvidence } from '@/mvp/discovery';
import { buildBingQueries } from '@/mvp/pipeline/sources/bing-news';
import { sourcePlan } from './plan';

describe('any-country search is not restricted to profile markets',()=>{
  it.each(COUNTRIES)('accepts and plans all three lanes for $name ($code)',({code,name})=>{
    const input=runInputSchema.parse({query:'line pipe',productId:'line-pipe',markets:[code],leadKinds:['supply_subcontract']});
    const plan=sourcePlan({...input,productId:'line-pipe',mode:'preview'});
    expect(new Set(plan.map(t=>t.lane))).toEqual(new Set(['trigger','roundup','capability']));
    // trigger 1 + roundup 2 (contractors, stockists) + capability 2; stockists only when he sells to them.
    expect(plan.filter(t=>t.source==='tavily')).toHaveLength(5);
    expect(sourcePlan({...input,productId:'line-pipe',mode:'preview',includeResellers:false}).filter(t=>t.source==='tavily')).toHaveLength(4);
    expect(plan.filter(t=>t.query).every(t=>t.query!.includes(name))).toBe(true);
    // Every country gets local news (its own language where it has one) and GDELT country news.
    expect(plan.some(t=>t.source==='local-news'&&t.market===code)).toBe(true);
    expect(plan.some(t=>t.source==='gdelt-country'&&t.market===code)).toBe(true);
    expect(buildBingQueries(['line pipe'],code).length).toBeGreaterThan(0);
  });

  // Example synthetic text: tests the admission contract, NOT live country coverage.
  it.each(['KE','BR','JP','NZ','GH','CH'])('keeps an evidenced potential contractor in %s without an award, date or contacts',code=>{
    const name=COUNTRIES.find(c=>c.code===code)!.name;
    const quote=`Example Pipeline Construction provides pipeline construction and line pipe installation services in ${name}.`;
    expect(countriesInQuote(quote,['Example Pipeline Construction'])).toContain(code);
    const result=buyerEvidence({company:'Example Pipeline Construction',companyQuote:quote,country:code,countryQuote:quote,
      operatingCountries:[{country:code,quote}],role:'epc_contractor',productQuote:quote,project:null,projectQuote:null,
      confidence:0,activityDate:null,activityQuote:null},quote,{query:'line pipe',productId:'line-pipe',markets:[code],leadKinds:['supply_subcontract']});
    expect(result.buyer).not.toBeNull();
    expect(result.buyer?.activityDate).toBeNull();
  });
});

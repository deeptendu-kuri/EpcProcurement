// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {judgeNeed} from './need';
import {supportedWorkProof} from '@/mvp/discovery/work-proof';
import type {SearchBrief} from '@/mvp/discovery/brief';
import captured from './fixtures/live-app-need-regressions.json';

// Exact real-provider answers from the completed local application run. These
// are offline regressions, never live search seeds or fabricated model answers.
describe('the completed app run’s material-omission failures',()=>{
  const brief=captured.brief as SearchBrief;
  it.each([
    {url:'domain-b.com',names:['Larsen & Toubro (L&T)'],market:'IN'},
    {url:'gulftoday.ae',names:['Engineering for the Petroleum and Process Industries (ENPPI)','Petrojet','Petrofac Emirates LLC'],market:'AE'},
  ])('recovers only sourced potential applications on $url',({url,names,market})=>{
    const page=captured.pages.find(p=>p.url.includes(url))!;
    const result=judgeNeed(page.answer,page,brief,['IN','CA','AE'],new Date('2026-10-11'))!;
    const leads=result.companies.filter(c=>c.verdict==='lead');
    expect(leads.map(c=>c.name)).toEqual(names);expect(result.market).toBe(market);
    expect(result.needWhy).toContain('unconfirmed');
    for(const c of leads){
      expect(c.quoteVerified).toBe(true);expect(page.text).toContain(c.quote);
      expect(supportedWorkProof({company:c.name,quote:c.quote,text:page.text,package:c.package,url:page.url},'ss-duplex-pipe',brief)).toBe(true);
    }
    expect(result.companies.find(c=>c.name.startsWith('China Petroleum'))?.verdict).not.toBe('lead');
  });
});

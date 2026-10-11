// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {catalogueBrief} from '@/mvp/discovery/brief';
import {stainlessWorkApplication,stainlessApplicationProof,missingMaterialOnly} from '@/mvp/discovery/potential-work';
import {junkCompanyReason} from '@/mvp/sourcing/entities';
import {wonConstructionContract} from '@/mvp/sourcing/contract';
import {needOf} from '@/mvp/buyers';
import {judgeNeed,namesCompany} from './need';
import {companyNames} from '@/mvp/discovery/evidence';
import {publicationDateProof} from './page-date';
import pages from './fixtures/live-quality-pages.json';
import captured from './fixtures/captured-need-answers.json';

const brief=catalogueBrief('Stainless steel pipe ASTM A312 TP316L for process piping',['IN','CA','AE'],'ss-duplex-pipe');
const now=new Date('2026-10-11T00:00:00Z');
const uae=pages.documents.find(d=>d.url.includes('gulftoday'))!;
const answer=captured.answers.find(a=>a.urlIncludes==='gulftoday.ae')!.answer;
const judge=(a:unknown=answer,p=uae)=>judgeNeed(JSON.stringify(a),p,brief,['IN','CA','AE'],now)!;

describe('actual captured AI answers replayed offline',()=>{
  it('recovers only three UAE process-work buyers, not the separate transmission-pipeline contractor',()=>{
    const result=judge();
    expect(result.needsItem).toBe('yes');
    expect(result.companies.filter(c=>c.verdict==='lead').map(c=>c.name)).toEqual(['ENPPI','Petrojet','Petrofac Emirates LLC']);
    expect(result.companies.find(c=>c.name.startsWith('China Petroleum'))?.verdict).toBe('rejected');
    expect(result.companies.find(c=>c.name==='Adnoc Gas')?.verdict).not.toBe('lead');
    expect(result.companies.filter(c=>c.verdict==='lead').every(c=>c.quoteVerified&&uae.text.includes(c.quote))).toBe(true);
    expect(result.needWhy).toContain('potential application');expect(result.needWhy).toContain('unconfirmed');
  });
  it('retains the two Canadian contractors and no owner as a material buyer',()=>{
    const page=pages.documents.find(d=>d.url.includes('markets.ft'))!;
    const result=judge(captured.answers[0].answer,page);
    expect(result.companies.filter(c=>c.verdict==='lead').map(c=>c.name)).toEqual(['Fluor Corporation','JGC Corporation']);
    expect(result.market).toBe('CA');
  });
  it.each(['no','unclear'])('can correct a %s caused only by missing material wording',needsItem=>{
    expect(judge({...answer,needsItem}).companies.filter(c=>c.verdict==='lead')).toHaveLength(3);
  });
  it.each([
    {needWhy:'This package does not require stainless steel pipe.'},
    {use:null,needsItem:'no',needWhy:'Water network work, not a process plant.'},
    {country:'India'},
    {companies:answer.companies.map(c=>({...c,buysItem:'no'}))},
    {companies:answer.companies.map(c=>({...c,quoteIndex:999,quote:'Example invented contract sentence.'}))},
  ])('does not weaken own-package, use, country or quote checks: %j',over=>{
    expect(judge({...answer,...over}).companies.filter(c=>c.verdict==='lead')).toHaveLength(0);
  });
  it('does not turn old or future-dated work into current buyers',()=>{
    for(const publishedAt of ['2015-01-10','2026-10-27'])
      expect(judge(answer,{...uae,publishedAt}).companies.filter(c=>c.verdict==='lead')).toHaveLength(0);
  });
  it('does not borrow Petrofac compression work for the transmission contractor',()=>{
    const quote=uae.text.split('\n').find(p=>p.startsWith('A $514 million'))!;
    expect(stainlessWorkApplication({company:'China Petroleum Pipeline Engineering Company',quote,text:uae.text},brief)).toBeNull();
    expect(stainlessWorkApplication({company:'Petrofac Emirates LLC',quote,text:uae.text},brief)).toBe('oil & gas processing plant');
    expect(missingMaterialOnly('The text does not specify the material of the pipelines or compression equipment.')).toBe(true);
  });
  it('recognises an actual EPC selection/NTP, not a prize or mere investment decision',()=>{
    const ca=pages.documents.find(d=>d.url.includes('markets.ft'))!;
    const quote=ca.text.split('\n').find(p=>p.startsWith('Fluor Corporation (NYSE: FLR) announced'))!;
    expect(wonConstructionContract(quote)).toBe(true);
    expect(wonConstructionContract('Example company was selected for an excellence award.')).toBe(false);
    expect(wonConstructionContract('Example owner announced final investment decision for an LNG project.')).toBe(false);
    const proof=publicationDateProof(ca.text)!;
    expect(proof.date.slice(0,10)).toBe('2026-09-29');expect(ca.text).toContain(proof.quote);
  });
  it.each(['EPC Expo June 16-17, 2027','Natural Resources Canada','Ministry of Energy'])('excludes non-company candidate %s',name=>{
    expect(junkCompanyReason(name)).not.toBeNull();
  });
  it('keeps both legacy and potential-need reasons readable in the table',()=>{
    expect(needOf('Example quote. Why it may need pipe: Potential application.')).toEqual({work:'Example quote.',why:'Potential application.'});
    expect(needOf('Example quote. Why it needs pipe: Legacy explanation.')).toEqual({work:'Example quote.',why:'Legacy explanation.'});
  });
  it('allows a sourced legal short name, never a guessed acronym or common legal suffix',()=>{
    expect(companyNames('JGC Corporation','JGC Corporation and Fluor are EPC joint-venture partners.')).toContain('JGC');
    expect(companyNames('JGC Corporation','JGC builds a plant.')).not.toContain('JGC');
    expect(namesCompany('Example unrelated Corporation builds a plant.','XYZ Corporation')).toBe(false);
    expect(junkCompanyReason('Example Summit Engineering Ltd')).toBeNull();
  });
  it('never stitches attributed clauses into a verified evidence quote',()=>{
    const text='Example EPC constructs an LNG export facility; Example EPC installs its gas processing plant.';
    const proof=stainlessApplicationProof({company:'Example EPC',quote:text,text},brief)!;
    expect(proof.use).toBe('oil & gas processing plant');expect(proof.quote).toBe(text);
  });
});

import {describe,expect,it} from 'vitest';
import {engineeringOnlySource,otherStainlessPipe} from './work-scope';
import {supportedWorkProof} from './work-proof';
import {catalogueBrief} from './brief';
import {judgeNeed} from '@/mvp/research/need';
import {namesCompany} from './evidence';

// Literal page captured in the 11-Oct live run; not a synthetic company/contract.
const quote='Adnoc Gas announced on Wednesday that Worley Engineering has been awarded the Front-End Engineering and Design (FEED) contract for new gas processing facilities at Bab Gas Cap (BGC).';
const brief=catalogueBrief('Stainless steel pipe ASTM A312 TP316L for process piping',['AE'],'ss-duplex-pipe');
describe('original contract scope beats a model package label',()=>{
  it('rejects the captured FEED contract even when the model calls it physical EPC',()=>{
    const result=judgeNeed(JSON.stringify({project:'Bab Gas Cap',country:'United Arab Emirates',use:'oil & gas processing plant',needsItem:'yes',companies:[{name:'Worley Engineering',role:'epc',package:'engineering, procurement and construction',quote,buysItem:'yes'}]}),
      {text:quote+'\nThe BGC project supports UAE gas self-sufficiency.',publishedAt:'2024-12-04',url:'https://www.gulftoday.ae/business/2024/12/04/adnoc-gas-awards-design-contract-for-gas-processing-facilities-at-bgc'},brief,['AE'],new Date('2026-10-11'))!;
    expect(result.companies[0]).toMatchObject({verdict:'rejected',quoteVerified:true,reason:'engineering only, buys no material'});
    expect(supportedWorkProof({company:'Worley Engineering',quote,text:quote,package:'EPC'},'ss-duplex-pipe',brief)).toBe(false);
  });
  it('does not borrow another company’s construction from a shared paragraph (Example fixture)',()=>{
    const text='Example Designer won a FEED contract; Example Builder won the construction contract for the gas processing plant.';
    expect(engineeringOnlySource(text,c=>namesCompany(c,['Example Designer']))).toBe(true);
    expect(engineeringOnlySource(text,c=>namesCompany(c,['Example Builder']))).toBe(false);
  });
  it('retains genuine engineering, procurement and construction (Example fixture)',()=>{
    const text='Example EPC won engineering, procurement and construction of a gas processing plant in UAE.';
    expect(engineeringOnlySource(text)).toBe(false);
    expect(supportedWorkProof({company:'Example EPC',quote:text,text},'ss-duplex-pipe',brief)).toBe(true);
  });
  it('distinguishes polymer output from an explicitly different piping package (Example fixture)',()=>{
    const text='Example EPC won construction of a polyethylene manufacturing unit at an Indian petrochemical refinery complex.';
    expect(otherStainlessPipe(text)).toBe(false);
    expect(otherStainlessPipe('Example EPC installs polyethylene pipes in the plant.')).toBe(true);
    expect(otherStainlessPipe('Example EPC installs HDPE water pipelines.')).toBe(true);
    expect(supportedWorkProof({company:'Example EPC',quote:text,text},'ss-duplex-pipe',brief)).toBe(true);
    const result=judgeNeed(JSON.stringify({project:'Example refinery',country:'India',use:'chemical process plant',needsItem:'unclear',needWhy:'The text does not mention any specific pipe or material.',companies:[{name:'Example EPC',role:'epc',package:'construction of the polyethylene manufacturing unit',quote:text,buysItem:'yes'}]}),{text,publishedAt:'2026-01-01'},brief,['IN'],new Date('2026-10-11'))!;
    expect(result.companies[0]).toMatchObject({verdict:'lead',quoteVerified:true});
    expect(result.needWhy).toContain('unconfirmed');
  });
});

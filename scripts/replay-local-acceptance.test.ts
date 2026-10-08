// @vitest-environment node
/** Explicit offline regression against the genuine saved 5 October search. */
import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {buyerEvidence,discoverySchema} from '../src/mvp/discovery';
it.skipIf(!process.env.MVP_LIVE_ACCEPTANCE_CAPTURE)('recovers UAE cable work from original captured extraction, without any provider request',()=>{
  const fetcher=vi.fn(()=>{throw Error('Offline replay must not request a provider');});vi.stubGlobal('fetch',fetcher);
  try{
    const data=JSON.parse(readFileSync(process.env.MVP_LIVE_ACCEPTANCE_CAPTURE!,'utf8')) as {documents:{text:string;url:string;result:unknown}[]};
    const results=data.documents.flatMap(d=>!d.result?[]:discoverySchema.parse(d.result).buyers.map(b=>({url:d.url,text:d.text,...buyerEvidence(b,d.text,{query:'Power and control cables',productId:'cables',markets:['AE'],leadKinds:['supply_subcontract']})})));
    const valid=results.filter(r=>r.buyer);expect(valid.length).toBeGreaterThan(0);
    for(const r of valid){expect(r.buyer!.country).toBe('AE');expect(r.text).toContain(r.buyer!.companyQuote);expect(r.text).toContain(r.buyer!.productQuote);expect(r.text).toContain(r.buyer!.countryQuote!);}
    expect(fetcher).not.toHaveBeenCalled();console.log(JSON.stringify({offline:true,providerRequests:0,recovered:valid.map(r=>({company:r.buyer!.company,url:r.url,productEvidence:r.buyer!.productQuote,country:r.buyer!.country}))}));
  }finally{vi.unstubAllGlobals();}
});

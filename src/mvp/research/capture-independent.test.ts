// @vitest-environment node
/** Explicit, opt-in capture of primary pages. No AI/search/email API is called.
 * Produces an ignored corpus; ordinary tests never make network requests. */
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {it,expect} from 'vitest';
import {fetchPageText} from '@/mvp/pipeline/read';

it.skipIf(process.env.CAPTURE_INDEPENDENT_SOURCES!=='on')('capture independently researched primary pages',async()=>{
  const urls=[
    'https://woodfibrelng.ca/construction/',
    'https://woodfibrelng.ca/news/2026/05/25/woodfibre-lng-at-65-complete-partnership-driving-progress/',
    'https://www.adnocgas.ae/en/news-and-media/press-releases/2026/q2-2026-results/',
    'https://www.ten.com/en/media/press-releases/technip-energies-jgc-and-nmdc-energy-awarded-major-contract-adnocs-ruwais-lng',
    'https://www.praj.net/wp-content/uploads/2026/02/Praj-Q3-9M-FY26-Results-Release_12022026.pdf',
    'https://www.thyssenkrupp-uhde.com/en/media/press-releases/press-detail/thyssenkrupp-uhde-secures-landmark-contract-for-gnfc%27s-new-nitric-acid-plant-296463',
    'https://www.mitchellinstallations.ca/',
  ];
  const pages=[];
  for(const url of urls){
    const page=await fetchPageText(url,{fullPage:true,maxPdfPages:5});
    pages.push({requestedUrl:url,...page});
  }
  const dir=resolve('tmp/independent-buyer-sources');await mkdir(dir,{recursive:true});
  await writeFile(resolve(dir,'pages.json'),JSON.stringify({capturedAt:new Date().toISOString(),pages},null,2));
  console.info(JSON.stringify(pages.map(p=>({url:p.requestedUrl,ok:p.ok,reason:'reason' in p?p.reason:null,chars:'text' in p?p.text.length:0}))));
  expect(pages.some(p=>p.ok)).toBe(true);
},240000);

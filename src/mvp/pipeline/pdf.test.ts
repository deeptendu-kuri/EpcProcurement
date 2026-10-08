// @vitest-environment node
import {describe,expect,it} from 'vitest';
import {parsePdf} from './pdf';
/** Synthetic PDF fixture generated in memory; no downloads, provider calls or personal data. */
export function fixturePdf(pageCount=1,empty=false) {
  const fontId=3+pageCount*2;
  const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${pageCount} /Kids [${Array.from({length:pageCount},(_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`];
  for(let i=0;i<pageCount;i++){
    const stream=empty?'':`BT /F1 12 Tf 50 750 Td (Atlas Electrical Contracting LLC) Tj 0 -22 Td (We install power cables in Dubai, United Arab Emirates.) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let pdf='%PDF-1.4\n';const offsets=[0];
  objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
  pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf));
}
describe('bounded PDF original text',()=>{
  it('extracts actual text and page references without an LLM',async()=>{
    const result=await parsePdf(fixturePdf());expect(result.ok).toBe(true);
    if(result.ok){expect(result.text).toContain('Atlas Electrical Contracting LLC');expect(result.text).toContain('install power cables');expect(result.pages).toHaveLength(1);expect(result.pages[0].page).toBe(1);}
  },20000);
  it('rejects oversized documents before worker parsing',async()=>{expect(await parsePdf(new Uint8Array(3_000_001))).toEqual({ok:false,reason:'resource'});});
  it('does not call an empty/scanned document successful extraction',async()=>{expect(await parsePdf(fixturePdf(1,true))).toEqual({ok:false,reason:'ocr_needed'});},20000);
  it('enforces document and remaining cumulative page limits',async()=>{expect(await parsePdf(fixturePdf(2),1)).toEqual({ok:false,reason:'resource'});expect(await parsePdf(fixturePdf(),0)).toEqual({ok:false,reason:'resource'});},20000);
  it('classifies malformed documents safely',async()=>{expect(await parsePdf(new Uint8Array(Buffer.from('%PDF-not-a-document')))).toEqual({ok:false,reason:'pdf_parse'});},20000);
});

// No rendering/OCR, remote resources or embedded JavaScript. Parent bounds time and heap.
import { parentPort, workerData } from 'node:worker_threads';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
let task;
try {
  task = getDocument({data:new Uint8Array(workerData.bytes), isEvalSupported:false,
    disableFontFace:true, useSystemFonts:false, useWorkerFetch:false, stopAtErrors:true});
  const document = await task.promise;
  if (document.numPages > workerData.maxPages) throw new Error('pdf_page_limit');
  const pages=[]; let remaining=60000; let truncated=false;
  for(let number=1;number<=document.numPages;number++) {
    const page=await document.getPage(number);
    const content=await page.getTextContent();
    const rows=[];
    for(const item of content.items) {
      if(!('str' in item)||!item.str.trim())continue;
      const y=item.transform[5]; let row=rows.find(r=>Math.abs(r.y-y)<3);
      if(!row){row={y,items:[]};rows.push(row);}
      row.items.push({x:item.transform[4],width:item.width,str:item.str});
    }
    const text=rows.sort((a,b)=>b.y-a.y).map(row=>{
      let end=null;
      return row.items.sort((a,b)=>a.x-b.x).map(item=>{
        const separator=end===null?'':item.x-end>18?' | ':' ';
        end=item.x+item.width;return separator+item.str;
      }).join('');
    }).join('\n');
    pages.push({page:number,text:text.slice(0,Math.max(0,remaining))});
    remaining-=text.length;if(remaining<0)truncated=true;
    page.cleanup();
  }
  const text=pages.map(p=>`[PDF page ${p.page}]\n${p.text}`).join('\n\n');
  if(pages.every(p=>p.text.trim().length<20))throw new Error('pdf_ocr_needed');
  parentPort.postMessage({ok:true,text,pages,truncated});
} catch(error) {
  const message=error instanceof Error?error.message:'';
  parentPort.postMessage({ok:false,reason:message==='pdf_page_limit'?'resource':message==='pdf_ocr_needed'?'ocr_needed':'pdf_parse'});
} finally { await task?.destroy().catch(()=>undefined); }

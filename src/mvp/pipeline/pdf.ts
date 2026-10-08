import { Worker } from "node:worker_threads";
import path from "node:path";
export interface PdfPage {page:number;text:string}
export type PdfResult = {ok:true;text:string;pages:PdfPage[];truncated:boolean} | {ok:false;reason:"resource"|"ocr_needed"|"pdf_parse"};
/** Separate bounded heap and wall deadline: hostile PDF parsing cannot hold the app worker. */
export async function parsePdf(bytes:Uint8Array,maxPages=10,timeoutMs=15000):Promise<PdfResult> {
  if(bytes.length>3_000_000||maxPages<1)return {ok:false,reason:"resource"};
  return new Promise(resolve=>{
    const worker=new Worker(path.join(process.cwd(),"src/mvp/pipeline/pdf-worker.mjs"),{
      workerData:{bytes,maxPages:Math.min(10,maxPages)},resourceLimits:{maxOldGenerationSizeMb:96},
    });
    let settled=false;
    const finish=(result:PdfResult)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(result);};
    const timer=setTimeout(()=>finish({ok:false,reason:"resource"}),timeoutMs);
    worker.once("message",(result:PdfResult)=>finish(result));
    worker.once("error",()=>finish({ok:false,reason:"pdf_parse"}));
    worker.once("exit",()=>finish({ok:false,reason:"pdf_parse"}));
  });
}

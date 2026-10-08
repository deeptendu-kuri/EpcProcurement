import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bearerAuthorized,verifyQstash } from '@/mvp/research/signatures';
import { processResearchTick } from '@/mvp/research/engine';
import { dispatchResearchOutbox } from '@/mvp/research/transport';
import { serverlessRuntime,SERVERLESS_SETUP_MESSAGE } from '@/mvp/runtime';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
  const raw=await request.text();if(raw.length>4096)return NextResponse.json({error:'Request too large.'},{status:413});
  const origin=process.env.APP_URL;const endpoint=origin?new URL('/api/mvp/research/worker',origin).toString():request.url;
  const authorized=bearerAuthorized(request.headers.get('authorization'),process.env.RESEARCH_WORKER_SECRET)
    ||verifyQstash(request.headers.get('upstash-signature'),raw,endpoint,[process.env.QSTASH_CURRENT_SIGNING_KEY??'',process.env.QSTASH_NEXT_SIGNING_KEY??'']);
  if(!authorized)return NextResponse.json({error:'Worker authentication required.'},{status:401});
  if(serverlessRuntime())return NextResponse.json({error:SERVERLESS_SETUP_MESSAGE},{status:503});
  let body:unknown;try{body=raw?JSON.parse(raw):{};}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400});}
  const parsed=z.object({runId:z.uuid().optional(),jobId:z.uuid().optional()}).strict().safeParse(body);
  if(!parsed.success)return NextResponse.json({error:'Invalid task payload.'},{status:400});
  try{const result=await processResearchTick(undefined,undefined,parsed.data.runId,parsed.data.jobId);await dispatchResearchOutbox();return NextResponse.json(result,{headers:{'cache-control':'no-store'}});}
  catch{return NextResponse.json({error:'Research worker unavailable; saved jobs remain.'},{status:503});}
}

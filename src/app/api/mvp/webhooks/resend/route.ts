import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyResendWebhook } from '@/mvp/research/signatures';
import { recordResendReceipt } from '@/mvp/research/transport';
import { startResearchWorker } from '@/mvp/research/worker';
export const runtime='nodejs';
export async function POST(request:Request){
  const raw=await request.text();if(raw.length>65536)return NextResponse.json({error:'Webhook too large.'},{status:413});
  if(!verifyResendWebhook(request.headers,raw,process.env.RESEND_WEBHOOK_SECRET??''))return NextResponse.json({error:'Invalid webhook signature.'},{status:401});
  let body:unknown;try{body=JSON.parse(raw);}catch{return NextResponse.json({error:'Invalid JSON.'},{status:400});}
  const parsed=z.object({type:z.string().min(1).max(100),data:z.object({email_id:z.string().max(200).optional()}).passthrough()}).safeParse(body);
  if(!parsed.success)return NextResponse.json({error:'Invalid webhook payload.'},{status:400});
  try{const saved=await recordResendReceipt(request.headers.get('svix-id')!,parsed.data.type,parsed.data.data.email_id??null);if(saved)startResearchWorker();return NextResponse.json({received:true,duplicate:!saved});}
  catch{return NextResponse.json({error:'Webhook persistence unavailable.'},{status:503});}
}

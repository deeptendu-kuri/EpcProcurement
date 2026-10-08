import {NextResponse} from 'next/server';
import {z} from 'zod';
import {opportunityEvidence} from '@/mvp/evidence';
import {NO_STORE,jsonError,serverError,uuidSchema} from '../../_shared/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{opportunityId:string}>}){
  const {opportunityId}=await params;
  if(!uuidSchema.safeParse(opportunityId).success||!z.object({}).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams)).success)return jsonError(400,'Invalid evidence request.');
  try{const view=await opportunityEvidence(opportunityId);return view?NextResponse.json(view,{headers:NO_STORE}):jsonError(404,'Verified opportunity evidence not found.');}catch(e){return serverError('Opportunity evidence',e);}
}

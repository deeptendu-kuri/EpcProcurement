import {NextResponse} from 'next/server';
import {z} from 'zod';
import {companyEvidence} from '@/mvp/evidence';
import {NO_STORE,jsonError,serverError,uuidSchema} from '../../../_shared/http';
export const runtime='nodejs';
const query=z.object({run:z.union([uuidSchema,z.literal('all')]).default('all')}).strict();
export async function GET(request:Request,{params}:{params:Promise<{companyId:string}>}){
  const {companyId}=await params;const parsed=query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!uuidSchema.safeParse(companyId).success||!parsed.success)return jsonError(400,'Invalid company evidence request.');
  try{const view=await companyEvidence(companyId,parsed.data.run);return view?NextResponse.json(view,{headers:NO_STORE}):jsonError(404,'Verified company evidence not found.');}catch(e){return serverError('Company evidence',e);}
}

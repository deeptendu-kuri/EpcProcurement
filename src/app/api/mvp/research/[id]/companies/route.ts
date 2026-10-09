import {NextResponse} from 'next/server';
import {z} from 'zod';
import {getDb} from '@/mvp/db';
import {checkFoundCompany,listFoundCompanies} from '@/mvp/research/found';
import {startResearchWorker} from '@/mvp/research/worker';
import {NO_STORE,jsonError,readJson,serverError,uuidSchema} from '../../../_shared/http';

/** Session-protected: every company this search named, checked or not. */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidSchema.safeParse(id).success)return jsonError(404,'Search not found.');
  try{
    const db=getDb();
    const session=(await db.query<{state:string}>('select state from research_sessions where run_id=$1',[id])).rows[0];
    if(!session)return NextResponse.json({companies:[],active:false},{headers:NO_STORE});
    return NextResponse.json({companies:await listFoundCompanies(db,id),active:session.state==='active'},{headers:NO_STORE});
  }catch(error){return serverError('found companies',error);}
}

/** "Check now": queue the normal website, work and contact checks for one listed company. */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidSchema.safeParse(id).success)return jsonError(404,'Search not found.');
  const body=await readJson(request,z.object({candidateId:uuidSchema}).strict());if(body.response)return body.response;
  try{
    const result=await checkFoundCompany(getDb(),id,body.data.candidateId);
    if(result.queued)startResearchWorker();
    return NextResponse.json(result,{headers:NO_STORE});
  }catch(error){
    if(error instanceof Error&&/not found|no saved research/i.test(error.message))return jsonError(404,error.message);
    return serverError('check found company',error);
  }
}

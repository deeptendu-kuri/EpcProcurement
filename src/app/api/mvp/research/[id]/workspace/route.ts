import {NextResponse} from 'next/server';
import {searchWorkspace} from '@/mvp/research/workspace';
import {NO_STORE,jsonError,serverError,uuidSchema} from '../../../_shared/http';

/** Session-protected: the live snapshot behind a search's workspace (docs/mvp/18 §4). */
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;if(!uuidSchema.safeParse(id).success)return jsonError(404,'Search not found.');
  try{
    const data=await searchWorkspace(id);
    return data?NextResponse.json(data,{headers:NO_STORE}):jsonError(404,'Search not found.');
  }catch(error){return serverError('search workspace',error);}
}

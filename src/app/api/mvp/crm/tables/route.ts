import {NextResponse} from 'next/server';
import {tableQuerySchema} from '@/mvp/crm/contracts';
import {crmTables} from '@/mvp/crm/tables';
import {NO_STORE,jsonError,serverError} from '../../_shared/http';
export const runtime='nodejs';
export async function GET(request:Request){
  const parsed=tableQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!parsed.success)return jsonError(400,'Invalid table filters.',parsed.error.issues);
  try{return NextResponse.json(await crmTables(parsed.data),{headers:NO_STORE});}
  catch(e){return serverError('CRM tables',e);}
}

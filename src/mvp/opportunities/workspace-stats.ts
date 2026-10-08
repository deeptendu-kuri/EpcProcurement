import { getDb } from "@/mvp/db";

export interface SearchWorkflowCount {run_id:string;workflow_count:number;meeting_count:number;}
/** Read-only dashboard counts; unlike the conversation list, this does not truncate at 200. */
export async function searchWorkflowCounts(runIds:string[]):Promise<SearchWorkflowCount[]> {
  if(!runIds.length)return [];
  return (await getDb().query<SearchWorkflowCount>(`select o.run_id,
    count(*)::int as workflow_count,
    count(*) filter (where t.state='meeting_booked')::int as meeting_count
    from funnel_threads t join search_opportunities o on o.id=t.opportunity_id
    where o.run_id=any($1::uuid[]) group by o.run_id`,[runIds])).rows;
}

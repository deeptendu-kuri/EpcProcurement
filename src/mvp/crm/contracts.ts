import {z} from 'zod';
import type {ContactSlot,LeadRow,ContractorRow,SubcontractorRow,BuyerRole} from '@/mvp/buyers/types';
const uuid=z.string().uuid();
export const tableQuerySchema=z.object({
  run:z.union([uuid,z.literal('all'),z.literal('none')]).default('none'),
  tab:z.enum(['leads','contractors','subcontractors','contacts']).default('leads'),
  country:z.string().regex(/^[A-Z]{2}$/).optional(),
  role:z.enum(['owner','epc_contractor','subcontractor','manufacturer','fabricator','distributor']).optional(),
  contactRole:z.string().max(60).optional(),
  trigger:z.enum(['award','order','tender','subcontract','capability']).optional(),
  age:z.enum(['30','90','365','540','undated']).optional(),
  product:z.string().max(100).optional(),fit:z.enum(['ready','check','early','not_buyer']).optional(),
  contacts:z.enum(['any','named','validated','missing']).optional(),showRejected:z.enum(['1']).optional(),
  qualification:z.enum(['pending','approved','rejected']).optional(),activity:z.enum(['active','capability_only','historic','unknown']).optional(),
  keyword:z.string().max(200).optional(),q:z.string().max(200).optional(),company:uuid.optional(),
  page:z.coerce.number().int().min(1).max(10000).default(1),
  size:z.coerce.number().pipe(z.union([z.literal(25),z.literal(50),z.literal(100)])).default(25),
  sort:z.enum(['date_desc','date_asc','value_desc','value_asc','fit_desc','fit_asc','name']).default('date_desc'),
}).strict();
export type TableQuery=z.infer<typeof tableQuerySchema>;
export type TableTab=TableQuery['tab'];
export interface TableContact extends ContactSlot {
  companyId:string;companyName:string;opportunityId:string|null;tier:1|2|3;
  email:string|null;phone:string|null;validated:boolean;source:string;
}
export type TableRow=LeadRow|ContractorRow|SubcontractorRow|TableContact;
export interface WorkspaceRef {companyId:string;opportunityId:string;leadId:string;keyword:string;role:BuyerRole;}
export interface TableFacets {
  countries:string[];products:{id:string;name:string}[];roles:BuyerRole[];
  counts:Record<TableTab,number>;capabilityOnly:number;workspaces:WorkspaceRef[];truncated:boolean;
}
export interface TableResult {rows:TableRow[];total:number;facets:TableFacets;}
export function tableParams(query:Partial<TableQuery>):URLSearchParams {
  return new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=='').map(([k,v])=>[k,String(v)]));
}
export function rowCompany(row:TableRow):string{return row.companyId;}
export function rowKey(row:TableRow):string {
  return 'slotId' in row?`${row.companyId}:${row.slotId}`:'linkedToCompanyId' in row?`${row.companyId}:${row.linkedToCompanyId}`:row.opportunityId;
}

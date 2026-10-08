/** Explicitly synthetic UI fixtures; never loaded by production or a live benchmark. */
import type {CompanyTableView,TableDataset} from './tables';
import {buildTeam} from '@/mvp/buyers/team';
import type {Trigger} from '@/mvp/buyers/types';
export const EXAMPLE_RUN='11111111-1111-4111-8111-111111111111';
export function exampleCompany(n=1,patch:Partial<CompanyTableView>={}):CompanyTableView{
  const id=`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;const name=`Example Engineering ${n} Limited`;
  const trigger:Trigger={id,kind:'capability',role:'contractor',title:`${name} constructs gas pipelines in UAE.`,date:null,datePrecision:'unknown',valueUsd:null,valueText:null,country:'AE',projectId:null,projectName:null,ownerName:null,strength:'possible',evidenceIds:[]};
  const team=buildTeam('epc_contractor',name,[]);
  return {row:{opportunityId:id,companyId:id,name,whatTheyDo:'Pipeline contractor',trigger,operatingCountry:'AE',hqCountry:null,sellSummary:'Line pipe',fitScore:40,howSure:'low',stage:'early',contactsFound:0,contactsTotal:team.length,sourceCount:1,status:'new',isSample:false},
    role:'epc_contractor',contractorRole:'main_contractor',team,contacts:team.map(s=>({...s,companyId:id,companyName:name,opportunityId:id,tier:1,email:null,phone:null,validated:false,source:''})),ref:{companyId:id,opportunityId:id,leadId:id,keyword:'line pipe',role:'epc_contractor'},refProduct:'line-pipe',qualification:'pending',activity:'capability_only',...patch};
}
export function exampleDataset(n=1):TableDataset{return {companies:Array.from({length:n},(_,i)=>exampleCompany(i+1)),chain:[],truncated:false};}

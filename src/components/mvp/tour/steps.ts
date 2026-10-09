/** Read-only, optional guide to the search-scoped sales journey. */
export type TourPage = "/dashboard" | "/find" | "/crm" | "/outreach" | "lead";
export interface TourStep {
  id: string; page: TourPage; element?: string; title: string; description: string;
  side?: "top" | "right" | "bottom" | "left";
  needsLeads?: boolean; emptyElement?: string; emptyDescription?: string;
}
const EMPTY = "No saved lead is available for this search yet. When you run a search, open a company to review its evidence and contacts. The guide never creates data or sends email.";
export const TOUR_STEPS: TourStep[] = [
  {id:"searches",page:"/dashboard",element:"overview-searches",title:"Your action plan and searches",description:"Start here. The Dashboard lists what needs you today and every search you ran. Open a search to watch it work and see its shortlist, or go to its Leads.",side:"bottom"},
  {id:"material",page:"/find",element:"find-query",title:"Type what you supply",description:"Type the material in your own words, such as steel pipe or seamless A106. Pick the exact type if asked, choose countries, then Find buyers. Research uses provider credits only when you submit.",side:"bottom"},
  {id:"results",page:"/crm",element:"leads-search",title:"Buyers from your search",description:"Pick one of your searches or all of them. Each row shows the search, what they will buy, what else you can sell them, a rating and the email status. Open SuperSearch to filter, and click a company for its evidence. Missing contact details stay blank.",side:"bottom"},
  {id:"workspace",page:"lead",element:"workspace-tabs",title:"All the lead details in one place",description:"Open full workspace from a company drawer. Review project evidence, contacts, subcontractors and supply chain here. Email & meetings contains the same lead’s conversation and CRM summary.",needsLeads:true,emptyDescription:EMPTY,side:"bottom"},
  {id:"automation",page:"/outreach",element:"automation-health",title:"Watch automatic email progress",description:"Automation checks evidence-qualified companies after a new search, within the configured cap. This demo sends only to the approved inbox shown here, never to buyer addresses. Google Calendar consent is required once.",side:"bottom"},
  {id:"meeting",page:"/outreach",element:"automation-conversations",title:"From reply to a confirmed meeting",description:"Reply to the received email with requirements or a meeting request. Confirm an offered time. The conversation shows the actual reply, Calendar event, Meet link and summary when available. Errors and paused workflows remain visible.",side:"top"},
];
export const TOUR_LENGTH = TOUR_STEPS.length;
export function progressText(index:number,total=TOUR_LENGTH):string{return `Step ${index+1} of ${total}`;}
export function tourSelector(element:string):string{return `[data-tour="${element}"]`;}
export function stepPath(step:TourStep,leadId:string|null,runId?:string|null):string|null {
  if(step.page==="lead")return leadId?`/opportunities/${leadId}${runId?`?returnTo=${encodeURIComponent("/crm?run="+runId)}`:""}`:null;
  return step.page==="/crm"&&runId?`/crm?run=${runId}`:step.page;
}
export function onStepPage(step:TourStep,pathname:string,leadId:string|null):boolean {
  const path=stepPath(step,leadId);return path!==null&&pathname===path.split("?")[0];
}

/** Read-only, optional guide to the search-scoped sales journey. */
export type TourPage = "/overview" | "/find" | "/crm" | "/outreach" | "lead";
export interface TourStep {
  id: string; page: TourPage; element?: string; title: string; description: string;
  side?: "top" | "right" | "bottom" | "left";
  needsLeads?: boolean; emptyElement?: string; emptyDescription?: string;
}
const EMPTY = "No saved lead is available for this search yet. When you run a search, open a company to review its evidence and contacts. The guide never creates data or sends email.";
export const TOUR_STEPS: TourStep[] = [
  {id:"searches",page:"/overview",element:"overview-searches",title:"One workspace per search",description:"Start here. Each material search keeps its countries, companies and email progress together. Use View leads to continue a specific search; SuperSearch explores all saved companies.",side:"bottom"},
  {id:"material",page:"/find",element:"find-query",title:"Choose what you sell",description:"Select a material and countries, then Find buyers. Contact roles and deeper research are optional under Advanced options. Research consumes provider credits only when you submit the form.",side:"bottom"},
  {id:"results",page:"/crm",element:"results-tabs",title:"Projects, companies and contacts",description:"Switch between Leads, Contractors, Subcontractors & suppliers, and Contacts. Click a company to open its evidence drawer. Missing contact details stay blank; a score is not proof of a purchase.",side:"bottom"},
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

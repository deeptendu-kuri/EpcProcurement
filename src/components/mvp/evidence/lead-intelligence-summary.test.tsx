import {afterEach,describe,it,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {LeadIntelligenceSummary} from './lead-intelligence-summary';
import {exampleDataset} from '@/mvp/crm/fixtures';
const lead=exampleDataset(1).companies[0].row;
afterEach(cleanup);
describe('restored rich buyer drawer',()=>{
  it('prominently shows only the selected product and links to the full profile and automation',()=>{render(<LeadIntelligenceSummary lead={lead} leadId={lead.companyId} workspace="/opportunities/Example?returnTo=%2Fcrm"/>);expect(screen.getByRole('region',{name:'What we can sell them'}).textContent).toContain(lead.sellSummary);expect(screen.getByRole('link',{name:/Full buyer profile/}).getAttribute('href')).toBe(`/buyers/${lead.companyId}`);expect(screen.getByRole('link',{name:/Email & meeting/}).getAttribute('href')).toContain('&tab=conversation');});
  it('shows absent facts explicitly and does not turn capability into an award',()=>{render(<LeadIntelligenceSummary lead={{...lead,trigger:null,operatingCountry:null,hqCountry:null}} workspace={null}/>);expect(screen.getAllByText('Not established')).toHaveLength(5);expect(screen.getByText('Not named in evidence')).toBeTruthy();expect(screen.getByText('No source-backed buying trigger established.')).toBeTruthy();expect(screen.queryByRole('link')).toBeNull();});
  it('never constructs a full buyer URL from synthetic, derived or executable IDs',()=>{for(const leadId of ['derived:Example','javascript:alert(1)','Example']){const {unmount}=render(<LeadIntelligenceSummary lead={lead} leadId={leadId} workspace={null}/>);expect(screen.queryByRole('link')).toBeNull();unmount();}});
});

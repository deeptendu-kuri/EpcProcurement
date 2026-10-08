import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ProspectConversation} from './prospect-conversation';
const api=vi.hoisted(()=>vi.fn());vi.mock('../api-client',()=>({apiJson:api}));
const id='00000000-0000-0000-0000-000000000007';
const settings={enabled:true,ready:true,worker:true,recipient:'approved@gmail.com',seller:{name:'Demo Seller',company:null},calendar:null,calendarSetup:true,prospectDemo:true,prospectsPerSearch:1,preferences:{duration:30,timeZone:'Asia/Kolkata',startHour:10,endHour:18},last_tick_at:null,groq:true,emailable:true,receiving:'demo.resend.app'};
let data:Record<string,unknown>;
beforeEach(()=>{api.mockReset();data={settings,threads:[],messages:[],eligibility:{canStart:true,researchPaused:true,reason:null}};api.mockImplementation(async(_url:string,options?:{method?:string})=>options?.method?{}:data);});
afterEach(cleanup);
async function expandHistorical(){fireEvent.click(await screen.findByText('Advanced: manually select a historical saved prospect'));}
describe('same-workspace research to meeting controls',()=>{
  it('shows paused research honestly, keeps buyer identity separate and never starts on page load',async()=>{
    render(<ProspectConversation opportunityId={id}/>);await screen.findByText('Automatic email status');
    expect((screen.getByText('Advanced: manually select a historical saved prospect').closest('details') as HTMLDetailsElement).open).toBe(false);
    expect(screen.getByText(/Research is paused/)).toBeTruthy();expect(screen.getByText(/Salesperson: Demo Seller/)).toBeTruthy();expect(screen.getByRole('list',{name:'Sales workflow progress'})).toBeTruthy();
    expect(api.mock.calls.every(([,options])=>!options?.method)).toBe(true);
  });
  it('queues only after the explicit action with the frozen demo recipient',async()=>{
    render(<ProspectConversation opportunityId={id}/>);await expandHistorical();fireEvent.click(await screen.findByRole('button',{name:'Start this prospect’s demo workflow'}));
    await waitFor(()=>expect(api).toHaveBeenCalledWith(`/api/mvp/automation/conversation/${id}`,{method:'POST',body:{action:'start_demo',confirmedRecipient:'approved@gmail.com'}}));
  });
  it('allows buyer-fit review without claiming email validation',async()=>{
    data={...data,eligibility:{canStart:false,researchPaused:true,reason:'Confirm potential buyer fit in this workspace before starting the demo.'}};
    render(<ProspectConversation opportunityId={id}/>);await expandHistorical();const start=await screen.findByRole('button',{name:'Start this prospect’s demo workflow'});expect((start as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'Confirm potential buyer fit'}));await waitFor(()=>expect(api).toHaveBeenCalledWith(`/api/mvp/opportunities/${id}`,{method:'PATCH',body:{qualification:'approved'}}));
  });
  it('blocks start until global automation and its worker are enabled',async()=>{
    data={...data,settings:{...settings,enabled:false,worker:false}};render(<ProspectConversation opportunityId={id}/>);
    await expandHistorical();const start=await screen.findByRole('button',{name:'Start this prospect’s demo workflow'});expect((start as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('link',{name:'Email & Calendar setup'}).getAttribute('href')).toBe('/settings?tab=automation');
  });
  it('shows meeting selection and only marks Calendar ready after an actual booked link',async()=>{
    data={...data,threads:[{id:'thread',state:'awaiting_time',paused:false,reason:'Select a free slot',summary:'Buyer requested a meeting',offered_slots:['2026-10-12T04:30:00Z'],meeting_start:null,meet_url:null}],messages:[{id:'m',direction:'out',kind:'initial',state:'accepted',subject:'Material',body:'Hi Buyer procurement team',created_at:'2026-10-06T04:00:00Z'}]};
    render(<ProspectConversation opportunityId={id}/>);await screen.findByText('Waiting for your chosen slot');expect(screen.getByText(/Reply in Gmail with/)).toBeTruthy();expect(screen.queryByRole('link',{name:'Open booked Google Meet'})).toBeNull();
    expect(within(screen.getByRole('list',{name:'Sales workflow progress'})).getByText(/Calendar & Meet ready/).parentElement?.textContent).toContain('Pending');
  });
  it('links to an existing company/product conversation instead of duplicating outreach',async()=>{
    data={...data,eligibility:{canStart:false,existingOpportunityId:id,reason:'This company and product already have a conversation.'}};render(<ProspectConversation opportunityId={id}/>);const link=await screen.findByRole('link',{name:'Open existing company conversation'});expect(link.getAttribute('href')).toBe(`/opportunities/${id}?tab=conversation`);expect(screen.queryByRole('button',{name:'Start this prospect’s demo workflow'})).toBeNull();
  });
});

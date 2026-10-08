import {afterEach,describe,it,expect} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {AutomationReadiness} from './automation-readiness';
const status={enabled:true,ready:true,worker:true,prospectDemo:true,prospectsPerSearch:1,recipient:'Example-approved@gmail.com',calendar:'Example-approved@gmail.com',configError:null};
afterEach(cleanup);
describe('automatic demo readiness',()=>{
  it('shows the real recipient and a cap, not an unconditional email promise',()=>{render(<AutomationReadiness status={status}/>);expect(screen.getByText('Automatic demo email is on')).toBeTruthy();expect(screen.getByText('Example-approved@gmail.com')).toBeTruthy();expect(screen.getByText(/Missing buyer contacts do not block/)).toBeTruthy();expect(screen.getByText(/Existing conversations and historical searches/)).toBeTruthy();expect(screen.getByRole('link').getAttribute('href')).toBe('/outreach');});
  it.each([{enabled:false},{worker:false},{ready:false,configError:'Example configuration missing'},{prospectDemo:false}])('never calls incomplete setup active: %j',override=>{render(<AutomationReadiness status={{...status,...override}}/>);expect(screen.getByText('Automatic demo email needs setup')).toBeTruthy();expect(screen.queryByText('Automatic demo email is on')).toBeNull();});
  it('makes the one-time Calendar consent gap explicit',()=>{render(<AutomationReadiness status={{...status,calendar:null}}/>);expect(screen.getByText(/Calendar is not connected/)).toBeTruthy();});
});

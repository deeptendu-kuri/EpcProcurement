// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { localMeetingInstant,resolveMeetingTime } from './meeting-time';
const p={timeZone:'Asia/Kolkata',duration:30,startHour:10,endHour:18};
const now=new Date('2026-10-07T06:00:00Z');
const slots=['2026-10-08T04:30:00.000Z','2026-10-09T04:30:00.000Z','2026-10-12T04:30:00.000Z'];
const resolve=(text:string,offered=slots)=>resolveMeetingTime(text,offered,now,p,now);
describe('grounded natural-language meeting agreements',()=>{
  it('accepts offered numbered and ordinal choices',()=>{
    expect(resolve('Slot 1')).toEqual({kind:'selected',start:slots[0]});
    expect(resolve('Option 2.')).toEqual({kind:'selected',start:slots[1]});
    expect(resolve('Please book slot 2')).toEqual({kind:'selected',start:slots[1]});
    expect(resolve('The second one works, thank you')).toEqual({kind:'selected',start:slots[1]});
  });
  it('accepts the exact offered row copied back, including its own 24-hour morning format',()=>{
    const selection='Slot 1: Thursday, 8 October 2026 at 10:00';
    expect(resolve(selection)).toEqual({kind:'selected',start:slots[0]});
    expect(resolve(selection+'\n\nOn Wed, 7 Oct, 2026, 6:41\u202fpm Seller, <\nonboarding@resend.dev> wrote:\n> Please confirm just one slot.')).toEqual({kind:'selected',start:slots[0]});
    expect(resolve('option 2: Friday, 9 October 2026 at 10:00')).toEqual({kind:'selected',start:slots[1]});
    expect(resolve(selection,[]).kind).toBe('clarify');
  });
  it.each(['Please book slot 1 or 2','Please book slot 1, maybe','Please book slot 1, tentative','Slot 1: Friday, 9 October 2026 at 10:00','Slot 1: Thursday, 8 October 2026 at 11:00','Slot 1: Thursday, 8 October 2026 at 10:00 or slot 2','Slot 1: Thursday, 8 October 2026 at 10:00 is not available'])('never treats ambiguous or conflicting offered selections as consent: %s',text=>{
    expect(resolve(text).kind).toBe('clarify');
  });
  it('anchors tomorrow and weekdays to the actual received date in the declared timezone',()=>{
    expect(resolve('Can we meet tomorrow at 3 PM?',[])).toEqual({kind:'selected',start:'2026-10-08T09:30:00.000Z'});
    expect(resolve('Friday at 10 AM works')).toEqual({kind:'selected',start:slots[1]});
    expect(resolve('Please book a meeting on 9 October 2026 at 15:00')).toEqual({kind:'selected',start:'2026-10-09T09:30:00.000Z'});
  });
  it('supports explicit IANA zones and UTC without assuming a buyer timezone',()=>{
    expect(resolve('Please book a meeting 2026-10-09 at 9 AM UTC')).toEqual({kind:'selected',start:'2026-10-09T09:00:00.000Z'});
    expect(resolve('Please book 2026-10-09 at 3 PM Asia/Kolkata')).toEqual({kind:'selected',start:'2026-10-09T09:30:00.000Z'});
  });
  it.each(['Maybe the second one works','Please book slot 1 or slot 2','Friday works','Please book Friday at 10:00','Please book next Friday at 3 PM','Please book 2026-10-10 at 3 PM','Please book 2026-10-09 at 3 PM EST','Please book Friday 2026-10-08 at 3 PM','Please book slot 2 on Friday at 3 PM','Please book 2026-02-30 at 3 PM'])('asks instead of guessing: %s',text=>{
    expect(resolve(text).kind).toBe('clarify');
  });
  it('does not turn material delivery times, quoted mail or a bare meeting request into a booked time',()=>{
    expect(resolve('Please deliver the cable tomorrow at 3 PM',[]).kind).toBe('none');
    expect(resolve('Please deliver the cable tomorrow at 3 PM').kind).toBe('none');
    expect(resolve('The shipment is due Friday at 10 AM').kind).toBe('none');
    expect(resolve('Can we arrange a meeting?',[]).kind).toBe('none');
    expect(resolve('Thanks\n> Please book slot 2').kind).toBe('none');
  });
  it('never turns a wrapped Gmail sent timestamp into a proposed time or a clarification',()=>{
    const header='\n\nOn Wed, 7 Oct, 2026, 5:24\u202fpm Sales Demo, <\nonboarding@resend.dev> wrote:\n\n> Can we meet Friday at 3 PM?';
    expect(resolve('Yes can you schedule a meet'+header,[])).toEqual({kind:'none'});
    expect(resolve('Yes can you schedule a meet'+header)).toEqual({kind:'none'});
    expect(resolve('Can we meet tomorrow at 3 PM?'+header,[])).toEqual({kind:'selected',start:'2026-10-08T09:30:00.000Z'});
  });
  it('rejects invalid and ambiguous DST wall clocks',()=>{
    expect(localMeetingInstant('2026-03-08','02:30','America/New_York')).toBeNull();
    expect(localMeetingInstant('2026-11-01','01:30','America/New_York')).toBeNull();
    expect(localMeetingInstant('2026-10-09','15:00','Asia/Kolkata')).toBe('2026-10-09T09:30:00.000Z');
  });
});

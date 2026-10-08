import { businessTime, freshReply, selectedSlot } from './policy';

type Preferences={timeZone:string;duration:number;startHour:number;endHour:number};
export type MeetingTime={kind:'selected';start:string}|{kind:'clarify';reason:string}|{kind:'none'};
const days=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
/** Use the same canonical label in offers and when a buyer copies one back. */
export function offeredSlotLabel(start:string,timeZone:string):string {
  return new Intl.DateTimeFormat('en-GB',{timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date(start));
}
function parts(date:Date,zone:string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
}
/** Convert a local wall clock; reject DST gaps and duplicated wall clocks rather than guess. */
export function localMeetingInstant(date:string,time:string,zone:string):string|null {
  try {
    const naive=Date.parse(`${date}T${time}:00Z`);if(!Number.isFinite(naive))return null;
    let instant=naive;
    for(let i=0;i<3;i++) {
      const p=parts(new Date(instant),zone);
      instant+=naive-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    }
    const matches=(value:number)=>{const p=parts(new Date(value),zone);return `${p.year}-${p.month}-${p.day}`===date&&`${p.hour}:${p.minute}`===time;};
    if(!matches(instant)||matches(instant-3600_000)||matches(instant+3600_000))return null;
    return new Date(instant).toISOString();
  }catch{return null;}
}
/** Ground consent in literal buyer wording. AI intent alone never invents an agreed date/time. */
export function resolveMeetingTime(text:string,slots:string[],receivedAt:Date,p:Preferences,now=new Date()):MeetingTime {
  const fresh=freshReply(text);const body=fresh.toLowerCase();const direct=selectedSlot(text,slots);
  // A literal copy of one offered row is explicit consent, including our own
  // 24-hour 10:00 format. Never infer AM/PM for unrelated or edited free text.
  const copied=/^(?:slot|option)\s*([1-3])\s*:\s*(.+)$/i.exec(fresh);
  if(copied) {
    const start=slots[Number(copied[1])-1];
    const normalize=(value:string)=>value.replace(/\s+/g,' ').trim().toLowerCase();
    if(start&&normalize(copied[2])===normalize(offeredSlotLabel(start,p.timeZone)))return {kind:'selected',start};
    return {kind:'clarify',reason:'The selected slot and stated date/time differ. Please confirm one offered slot.'};
  }
  // An offered calendar slot must not make a material delivery deadline into
  // meeting consent. Let the sales-intent handler answer that requirement.
  if(/\b(?:deliver(?:y|ed)?|ship(?:ping|ment)?|dispatch|material arrival)\b/.test(body)
    && !/\b(?:meeting|meet|call|chat|discussion|appointment|calendar|slot|option)\b/.test(body))return {kind:'none'};
  if(!slots.length&&!/\b(?:meeting|meet|call|chat|discussion|appointment|calendar)\b/.test(body))return {kind:'none'};
  const hasTime=/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?)\b|\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(body);
  const hasDay=/\b(?:today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\b/.test(body);
  if(direct&&!hasTime&&!hasDay)return {kind:'selected',start:direct}; // adapter rechecks expiry/availability
  if(!direct&&/\b(?:slot|option)\s*\d\b/.test(body))return {kind:'clarify',reason:'Please confirm just one available offered slot.'};
  const ordinal=[...body.matchAll(/\b(first|second|third)\s+(?:one|option|slot|time)\b/g)];
  const consent=/\b(?:book|confirm|schedule|works?|fine|available|yes|please|let'?s|can we|could we|suits)\b/.test(body)||Boolean(slots.length&&hasTime&&hasDay);
  if(!consent || !hasTime&&!hasDay&&!ordinal.length)return {kind:'none'};
  const clarify=(reason:string):MeetingTime=>({kind:'clarify',reason});
  if(/\b(?:not|no|can'?t|cannot|unavailable|maybe|tentative|unsure|or)\b/.test(body))return clarify('Please confirm one definite date and time.');
  if(ordinal.length) {
    const indexes=[...new Set(ordinal.map(m=>['first','second','third'].indexOf(m[1])))];
    if(indexes.length!==1||!slots[indexes[0]]||hasTime||hasDay)return clarify('Please confirm one offered slot or a specific date and time.');
    return {kind:'selected',start:slots[indexes[0]]};
  }
  let zone=p.timeZone;
  const zones=[...fresh.matchAll(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/g)].map(m=>m[1]);
  if(new Set(zones).size>1)return clarify('Please specify one timezone.');
  if(zones.length)zone=zones[0];
  else if(/\b(?:utc|gmt)\b/.test(body))zone='UTC';
  else if(/\b(?:est|edt|pst|pdt|cst|cdt|cet|cest|bst|ist|aest|aedt)\b/.test(body))return clarify('Please specify an unambiguous timezone, for example Asia/Kolkata or UTC.');
  let reference:ReturnType<typeof parts>;
  try{reference=parts(receivedAt,zone);}catch{return clarify('Please specify a valid timezone.');}
  const referenceDay=`${reference.year}-${reference.month}-${reference.day}`;
  const clockMatches=[...body.matchAll(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/g)];
  if(clockMatches.length!==1)return clarify('Please include one time with AM/PM or a 24-hour clock.');
  const clock=clockMatches[0];let hour=Number(clock[1]??clock[4]);const minute=Number(clock[2]??clock[5]??0);
  if(clock[3]){if(hour<1||hour>12)return clarify('Please check the time.');hour=hour%12+(/p/.test(clock[3])?12:0);}
  else if(hour>0&&hour<=12)return clarify('Please confirm AM or PM for that time.');
  const time=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  const dates=[...body.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)].map(m=>m[1]);
  const namedDates=[...body.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/g)];
  for(const m of namedDates)dates.push(`${m[3]||reference.year}-${String(months.indexOf(m[2])+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`);
  const relative=[...body.matchAll(/\b(today|tomorrow)\b/g)];
  for(const m of relative)dates.push(new Date(Date.parse(referenceDay+'T12:00:00Z')+(m[1]==='tomorrow'?86400_000:0)).toISOString().slice(0,10));
  const weekdays=[...body.matchAll(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/g)];
  if(!dates.length&&weekdays.length===1) {
    const day=new Date(referenceDay+'T12:00:00Z');let delta=(days.indexOf(weekdays[0][1])-day.getUTCDay()+7)%7;
    if(/\bnext\s+/.test(body))return clarify('Please give the calendar date for “next” weekday so I do not book the wrong week.');
    if(delta===0){const candidate=localMeetingInstant(referenceDay,time,zone);if(candidate&&Date.parse(candidate)<=now.getTime())delta=7;}
    dates.push(new Date(day.getTime()+delta*86400_000).toISOString().slice(0,10));
  }
  if(weekdays.length>1||new Set(dates).size>1)return clarify('Please confirm just one meeting date.');
  if(!dates.length) {
    const matching=slots.filter(s=>{const q=parts(new Date(s),zone);return `${q.hour}:${q.minute}`===time;});
    return matching.length===1?{kind:'selected',start:matching[0]}:clarify('Please include the date as well as the time.');
  }
  const date=dates[0];const start=localMeetingInstant(date,time,zone);
  if(!start)return clarify('That local date/time is invalid or ambiguous. Please choose another time.');
  if(direct&&Date.parse(start)!==Date.parse(direct))return clarify('The selected slot and stated date/time differ. Which time should I book?');
  if(weekdays.length&&days[new Date(date+'T12:00:00Z').getUTCDay()]!==weekdays[0][1])return clarify('The weekday and calendar date differ. Which date did you mean?');
  if(Date.parse(start)<=now.getTime()||Date.parse(start)>now.getTime()+14*86400_000)return clarify('Please choose a future time within the next two weeks.');
  const end=new Date(Date.parse(start)+p.duration*60_000-1);
  if(!businessTime(new Date(start),p.timeZone,p.startHour,p.endHour)||!businessTime(end,p.timeZone,p.startHour,p.endHour))return clarify(`Please choose a weekday during ${p.startHour}:00–${p.endHour}:00 ${p.timeZone}.`);
  return {kind:'selected',start};
}

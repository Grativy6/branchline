const formatters=new Map();
function formatter(zone){if(!formatters.has(zone))formatters.set(zone,new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}));return formatters.get(zone);}
export function localParts(at,zone){const p=Object.fromEntries(formatter(zone).formatToParts(new Date(at)).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};}
const dayAfter=(date,n)=>new Date(Date.parse(date+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export function wallInstant(date,time,zone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||dayAfter(date,0)!==date)throw new Error('Choose a valid date and time.');
  const start=Date.parse(date+'T00:00:00Z')-14*3600000;let firstAfter=null;
  for(let at=start;at<=start+52*3600000;at+=60000){const p=localParts(at,zone);if(p.date===date&&p.time===time)return at;if(p.date===date&&p.time>time&&firstAfter===null)firstAfter=at;}
  if(firstAfter!==null)return firstAfter;throw new Error('This local date has no valid scheduled time.');
}
export function validateSchedule(s){
  if(!s||Object.keys(s).sort().join()!=='date,intervalMinutes,repeat,time,weekdays,zone'||!['once','daily','weekdays','interval'].includes(s.repeat)||!Array.isArray(s.weekdays)||s.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||s.repeat==='weekdays'&&!s.weekdays.length||!Number.isInteger(s.intervalMinutes)||s.intervalMinutes<1||s.intervalMinutes>43200)throw new Error('Choose a supported schedule.');
  formatter(s.zone);wallInstant(s.date,s.time,s.zone);return s;
}
export function nextOccurrence(s,after){
  const first=wallInstant(s.date,s.time,s.zone);if(first>after&&s.repeat!=='weekdays')return first;
  if(s.repeat==='once')return null;
  if(s.repeat==='interval'){const step=s.intervalMinutes*60000;return first+(Math.floor((after-first)/step)+1)*step;}
  const start=[localParts(after,s.zone).date,s.date].sort().at(-1);
  for(let i=0;i<9;i++){const date=dayAfter(start,i);if(date<s.date)continue;
    if(s.repeat==='weekdays'&&!s.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()))continue;
    const at=wallInstant(date,s.time,s.zone);if(at>after)return at;
  }
  throw new Error('No next occurrence within the weekly schedule.');
}
export function latestDue(s,now){
  const first=wallInstant(s.date,s.time,s.zone);if(first>now)return null;
  if(s.repeat==='once')return first;
  if(s.repeat==='interval')return first+Math.floor((now-first)/(s.intervalMinutes*60000))*s.intervalMinutes*60000;
  for(let i=0;i<9;i++){const date=dayAfter(localParts(now,s.zone).date,-i);if(date<s.date)break;
    if(s.repeat==='weekdays'&&!s.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay()))continue;
    const at=wallInstant(date,s.time,s.zone);if(at<=now)return at;
  }return null;
}

'use strict';
function midnight(timestamp,timeZone){
 const d=new Date(timestamp),target=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());let result=target;
 const f=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(f.formatToParts(result).map(p=>[p.type,p.value]));const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);const delta=target-local;if(!delta)return result;result+=delta;}
 throw Object.assign(Error('TASK_DATE_INVALID'),{code:'TASK_DATE_INVALID'});
}
function schedule(snapshot,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
 const date=snapshot.start||(snapshot.repeatRule?snapshot.due:null),source=snapshot.start?'start':snapshot.repeatRule?'repeat_due':'immediate';
 if(!date)return {source,timeZone,notBefore:null,...(snapshot.repeatRule?{error:'REPEAT_DATE_REQUIRED'}:{})};
 return {source,timeZone,notBefore:date.isAllDay?midnight(date.timestamp,timeZone):date.timestamp};
}
const contextKey=s=>JSON.stringify({start:s.start||null,due:s.due||null,repeatRule:s.repeatRule||'',parent:s.parentTaskGuid||null,
 tasklists:(s.tasklists||[]).map(x=>x.guid).sort(),attachments:(s.sourceAttachments||[]).map(x=>[x.guid,x.name,x.bytes]).sort(),
 subtasks:(s.subtasks||[]).map(x=>[x.guid,x.title,x.description]).sort()});
module.exports={schedule,midnight,contextKey};

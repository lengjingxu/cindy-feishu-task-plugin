'use strict';
const fail=code=>{throw Object.assign(Error(code),{code});};
const guid=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/i.test(x);
const listNames=new Map(),creatorNames=new Map();
function dateField(value){
 if(!value||value.timestamp==='0'||value.timestamp===0)return null;
 const timestamp=Number(value.timestamp);
 if(!Number.isSafeInteger(timestamp)||timestamp<=0||timestamp>8640000000000000||(value.is_all_day!==undefined&&typeof value.is_all_day!=='boolean'))fail('TASK_DATE_INVALID');
 return {timestamp,isAllDay:value.is_all_day===true};
}
function metadata(t){
 const sourceAttachments=(t.attachments||[]).map(a=>{
  if(!guid(a.guid)||typeof a.name!=='string'||!Number.isSafeInteger(a.size)||a.size<0)fail('TASK_ATTACHMENT_INVALID');
  return {guid:a.guid,name:a.name,bytes:a.size,resource:a.resource};
 });
 const tasklists=(t.tasklists||[]).map(a=>{if(!guid(a.tasklist_guid))fail('TASKLIST_INVALID');return{guid:a.tasklist_guid,sectionGuid:a.section_guid||null};});
 return {contextVersion:1,start:dateField(t.start),due:dateField(t.due),repeatRule:t.repeat_rule||'',parentTaskGuid:t.parent_task_guid||null,
  subtaskCount:t.subtask_count||0,sourceAttachments,tasklists,sourceUrl:t.url||null,creator:t.creator?.id?{id:t.creator.id,type:t.creator.type,name:t.creator.name||null}:null};
}
async function enrichCreator(creator,request,appId){
 if(!creator||creator.name||!appId)return creator;
 const key=appId+':'+creator.type+':'+creator.id,cached=creatorNames.get(key);
 if(cached&&cached.until>Date.now())return {...creator,...cached.value};
 let value;
 try{
  let name;
  if(creator.type==='user'){
   if(!/^ou_[a-zA-Z0-9_-]{1,128}$/.test(creator.id))fail('CREATOR_ID_INVALID');
   const r=await request('/contact/v3/users/'+encodeURIComponent(creator.id)+'?user_id_type=open_id');
   if(r.data?.user?.open_id!==creator.id)fail('CREATOR_ID_MISMATCH');
   name=r.data.user.name;
  }else if(creator.type==='app'&&creator.id===appId){
   const r=await request('/bot/v3/info');name=r.bot?.app_name;
  }else return {...creator,nameState:'unavailable'};
  if(typeof name!=='string'||!name.trim()||name.length>512)fail('CREATOR_NAME_UNAVAILABLE');
  value={name:name.trim(),nameState:'verified'};
 }catch(e){value={nameState:'unavailable',error:e.code||'CREATOR_READ_FAILED'};}
 if(creatorNames.size>=256)creatorNames.delete(creatorNames.keys().next().value);
 creatorNames.set(key,{value,until:Date.now()+(value.name?300000:60000)});
 return {...creator,...value};
}
async function enrich(snapshot,request,taskGuid,appId=''){
 const errors=[];
 snapshot.creator=await enrichCreator(snapshot.creator,request,appId);
 snapshot.tasklists=await Promise.all(snapshot.tasklists.map(async list=>{
  const key=appId+':'+list.guid,cached=listNames.get(key);if(appId&&cached&&cached.until>Date.now())return{...list,...cached.value};
  let value;
  try{const r=await request('/task/v2/tasklists/'+list.guid);const t=r.data?.tasklist;if(t?.guid!==list.guid||!t.name)fail('TASKLIST_INVALID');value={name:t.name};}
  catch(e){value={nameState:'unavailable',error:e.code||'TASKLIST_READ_FAILED'};}
  if(appId){if(listNames.size>=256)listNames.delete(listNames.keys().next().value);listNames.set(key,{until:Date.now()+(value.name?300000:60000),value});}
  return{...list,...value};
 }));
 snapshot.subtasks=[];
 if(snapshot.subtaskCount){
  let token='';const seen=new Set();
  try{
   for(let page=0;page<20;page++){
    const r=await request('/task/v2/tasks/'+taskGuid+'/subtasks?page_size=100&user_id_type=open_id'+(token?'&page_token='+encodeURIComponent(token):''));const d=r.data;
    if(!Array.isArray(d?.items)||typeof d.has_more!=='boolean')fail('SUBTASKS_RESPONSE_INVALID');
    for(const t of d.items){if(!guid(t.guid)||t.parent_task_guid!==taskGuid)fail('SUBTASK_SCOPE_MISMATCH');snapshot.subtasks.push({guid:t.guid,title:t.summary,description:t.description||'',done:t.status==='done',...metadata(t)});}
    if(!d.has_more)return {...snapshot,contextErrors:errors};
    if(!d.page_token||seen.has(d.page_token))fail('SUBTASKS_PAGINATION_INVALID');seen.add(d.page_token);token=d.page_token;
   }
   fail('SUBTASKS_TOO_LARGE');
  }catch(e){snapshot.subtasks=[];errors.push({section:'subtasks',code:e.code||'SUBTASKS_READ_FAILED'});}
 }
 return {...snapshot,contextErrors:errors};
}
function sourceLink(attachment,expected,taskGuid){
 if(attachment?.guid!==expected.guid||attachment.name!==expected.name||attachment.size!==expected.bytes||attachment.resource?.type!=='task'||attachment.resource.id!==taskGuid)fail('SOURCE_ATTACHMENT_SCOPE_MISMATCH');
 let url;try{url=new URL(attachment.url);}catch{fail('ARTIFACT_LINK_UNAVAILABLE');}
 if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))fail('ARTIFACT_LINK_UNAVAILABLE');
 return {url:url.href,name:expected.name,bytes:expected.bytes};
}
module.exports={metadata,enrich,sourceLink,enrichCreator};

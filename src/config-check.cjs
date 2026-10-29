'use strict';
const {fail}=require('./core.cjs');
const required=['task:task:read','task:task:write','task:comment:write','task:attachment:write'];
async function scopes(request){
 const r=await request('/application/v6/scopes');const d=r.data;
 if(!Array.isArray(d?.scopes)||d.has_more===true||d.page_token)fail('SCOPES_RESPONSE_INCOMPLETE');
 const seen=new Map();
 for(const s of d.scopes){const key=s.scope_type+':'+s.scope_name;if(typeof s.scope_name!=='string'||![1,2].includes(s.grant_status)||!['user','tenant'].includes(s.scope_type)||seen.has(key))fail('SCOPES_RESPONSE_INVALID');seen.set(key,s.grant_status);}
 const missing=required.filter(s=>seen.get('tenant:'+s)!==1);
 return {state:missing.length?'missing':'verified',configuration:{source:'application/v6/scopes',scopes:d.scopes.map(s=>({scope_name:s.scope_name,scope_type:s.scope_type,grant_status:s.grant_status}))},missing};
}
async function versions(request,appId){
 let token='',items=[];const seen=new Set();
 for(let page=0;page<20;page++){
  const r=await request('/application/v6/applications/'+appId+'/app_versions?lang=zh_cn&page_size=50&order=0'+(token?'&page_token='+encodeURIComponent(token):''));const d=r.data;
  if(!Array.isArray(d?.items)||typeof d.has_more!=='boolean')fail('VERSIONS_RESPONSE_INVALID');
  for(const v of d.items){if(v.app_id!==appId||!v.version_id||![0,1,2,3,4].includes(v.status))fail('VERSIONS_RESPONSE_INVALID');items.push({appId:v.app_id,versionId:v.version_id,version:v.version,status:v.status,publishTime:v.publish_time,events:v.events||[],scopes:v.scopes||[]});}
  if(!d.has_more)return {state:'observed',configuration:{source:'application/v6/applications/app_versions',versions:items},note:'版本审核状态不等于事件已收到或闭环通过'};
  if(!d.page_token||seen.has(d.page_token))fail('VERSIONS_PAGINATION_INVALID');seen.add(d.page_token);token=d.page_token;
 }
 fail('VERSIONS_PAGINATION_LIMIT');
}
module.exports={scopes,versions,required};

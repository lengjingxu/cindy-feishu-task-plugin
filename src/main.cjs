'use strict';
const {Journal}=require('./journal.cjs');
const {Applications}=require('./applications.cjs');
const {createApplication,error}=require('./application.cjs');
const {fail}=require('./core.cjs');
const channel=new BroadcastChannel('feishu-task-bridge-v1');
const journal=new Journal(req=>cindy.fs(req),async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''));
const apps=new Applications(journal,()=>crypto.randomUUID());
const runtimes=new Map(),bindingReservations=new Map();let loaded=false,loading,dispatchTail=Promise.resolve();
async function ready(){if(loaded)return;if(!loading)loading=apps.load().then(()=>{loaded=true}).finally(()=>{loading=null});await loading;}
function runtime(id){
 const a=apps.get(id);
 if(!runtimes.has(id))runtimes.set(id,createApplication({id,slot:a.slot,store:apps.store(id),channel,
  dispatchGate:(target,send)=>{
   const p=dispatchTail.then(()=>{
    if(apps.entries().some(other=>other.id!==id&&Object.values(other.state.tasks).some(t=>t.dispatch?.target?.id===target.id&&(t.orphanedDelivery||!['done','stopped'].includes(t.state)))))fail('TARGET_BUSY');
    return send();
   });dispatchTail=p.catch(()=>{});return p;
  },
  rawNode:r=>cindy.node.request({...r,params:{...r.params,credentialScope:apps.state.credentialScope}}),assertUnique:appId=>apps.assertUnique(id,appId),
  canOperate:method=>{
   const status=apps.get(id).status;
   if(['state','targets','listener/stop'].includes(method))return;
   if(method==='binding/restore'&&status!=='deleted')return;
   if(['begin-binding','binding-complete'].includes(method)&&status==='disconnected')return;
   if(status!=='active')fail('APPLICATION_DISCONNECTED');
  }
 }));return runtimes.get(id);
}
async function state(){
 const applications=[];const tasks=[];
 const ids=apps.entries().map(a=>a.id);
 // Identity restoration stays ordered so duplicate app credentials cannot race.
 for(const id of ids)if(apps.get(id).status==='active'){await runtime(id).ready();await runtime(id).ui('restore-binding');}
 await Promise.all(ids.filter(id=>apps.get(id).status==='active').map(id=>runtime(id).refreshProfile()));
 for(const id of ids){
  const a=apps.get(id);
  let view;
  if(a.status==='active')view=runtime(a.id).publicState();
  else {view={tasks:Object.values(a.state.tasks),connection:a.state.connection||{},appProfile:a.state.appProfile,binding:{partnerId:a.state.connection?.partnerId},onboarding:a.state.onboarding,connectionAuthenticated:false,receiving:false,hostServicesAvailable:true};}
  tasks.push(...view.tasks.map(t=>({...t,applicationId:a.id,applicationStatus:a.status,result:t.result?{...t.result,artifacts:(t.result.artifacts||[]).map(x=>({...x,available:a.status==='active'&&x.available}))}:undefined})));
  if(a.status!=='deleted')applications.push({...view,tasks:undefined,id:a.id,credentialKey:a.slot,status:a.status});
 }
 // Retain legacy single-account state fields for tool clients; UI selects by id.
 return {...applications[0],applications,tasks,capacity:4};
}
let management=Promise.resolve();
function manage(fn){const p=management.then(fn);management=p.catch(()=>{});return p;}
async function ui(action,args={}){
 await ready();
 if(action==='targets')return cindy.targets.list({targetKind:'bot'});
 if(action==='state'||action==='initialize')return state();
 if(action==='add-application')return manage(async()=>({applicationId:await apps.add()}));
 const id=args.applicationId||(args.id&&['artifact-link','source-attachment-link','inspect-task','reconcile','cancel'].includes(action)?apps.route(args):apps.entries().find(a=>a.status!=='deleted')?.id);
 if(!id)fail('APPLICATION_REQUIRED');
 const a=apps.get(id),r=runtime(id);
 if(action==='prepare-removal')return manage(async()=>{
  const reservation=bindingReservations.get(id);if(reservation&&reservation.expiresAt>Date.now())fail('AUTHORIZATION_BUSY');
  const latest=apps.get(id);if(latest.status==='deleted')fail('APPLICATION_NOT_FOUND');
  if(!['disconnect','delete'].includes(args.mode))fail('ACTION_UNSUPPORTED');
  if(latest.status==='active')await r.prepareRemoval();
  await apps.status(id,args.mode==='delete'?'deleting':'disconnecting');
  return {credentialKey:a.slot,credentialScope:apps.state.credentialScope};
 });
 if(action==='finish-removal')return manage(async()=>{
  const current=apps.get(id);if(!['deleting','disconnecting'].includes(current.status))fail('REMOVAL_NOT_STARTED');
  const removed=await cindy.node.request({method:'binding/remove',params:{credentialKey:a.slot,credentialScope:apps.state.credentialScope},timeoutMs:30000});
  if(!removed.ok)fail('CREDENTIAL_REMOVAL_UNVERIFIED');
  const check=await cindy.node.request({method:'binding/restore',params:{credentialKey:a.slot,credentialScope:apps.state.credentialScope},timeoutMs:30000});
  if(!check.ok||check.result?.saved!==false)fail('CREDENTIAL_REMOVAL_UNVERIFIED');
  await apps.status(id,current.status==='deleting'?'deleted':'disconnected');r.disconnected();return state();
 });
 if(action==='authorize-binding'){
  const reservation=bindingReservations.get(id);if(!reservation||reservation.token!==args.token)fail('AUTHORIZATION_REQUIRED');
  const result=await cindy.node.request({method:a.slot==='account'?'binding/authorize':'binding/authorize'+a.slot.slice(7),params:{credentialKey:a.slot,credentialScope:apps.state.credentialScope,authorizationMode:'settings',token:reservation.token,...(a.state.connection?.appId?{appId:a.state.connection.appId}:{})},timeoutMs:120000,maxTotalMs:300000});
  if(!result.ok)fail(result.errorCode||result.error?.message||'AUTHORIZATION_FAILED');return result.result;
 }
 if(action==='cancel-binding'){
  const reservation=bindingReservations.get(id);if(!reservation||reservation.token!==args.token)fail('AUTHORIZATION_REQUIRED');
  const result=await cindy.node.request({method:'binding/cancel',params:{credentialKey:a.slot},timeoutMs:30000});
  if(!result.ok)fail('AUTHORIZATION_CANCEL_FAILED');return result.result;
 }
 if(action==='end-binding'){const reservation=bindingReservations.get(id);if(reservation?.token===args.token)bindingReservations.delete(id);return {ended:true};}
 if(action==='begin-binding')return manage(async()=>{
  if(!['active','disconnected'].includes(apps.get(id).status))fail('APPLICATION_DISCONNECTED');
  const reservation=bindingReservations.get(id);
  if(reservation&&reservation.expiresAt>Date.now())return {...reservation,credentialKey:a.slot,credentialScope:apps.state.credentialScope,appId:apps.get(id).state.connection?.appId};
  await r.ready();await r.ui(action,args);
  const next={token:crypto.randomUUID(),expiresAt:Date.now()+300000};bindingReservations.set(id,next);
  return {...next,credentialKey:a.slot,credentialScope:apps.state.credentialScope,appId:apps.get(id).state.connection?.appId};
 });
 if(action==='binding-complete')return manage(async()=>{
  if(!['active','disconnected'].includes(apps.get(id).status))fail('APPLICATION_DISCONNECTED');
  // Restoring this exact reserved slot cannot replace another application's identity.
  if(apps.get(id).status==='disconnected')await apps.status(id,'active');
  await r.ui(action,args);return state();
 });
 if(action==='recover'&&!args.applicationId){for(const x of apps.entries())if(x.status==='active')await runtime(x.id).ui(action,args);return state();}
 const result=await r.ui(action,args);return ['artifact-link','source-attachment-link','inspect-assigned'].includes(action)?result:state();
}
const requests=new Map();
channel.onmessage=async({data})=>{
 if(!data||data.type!=='request'||typeof data.reqId!=='string')return;
 if(requests.size>=500&&!requests.has(data.reqId)){channel.postMessage({reqId:data.reqId,ok:false,error:{code:'UI_REQUEST_LIMIT',message:'请重新打开插件。'}});return;}
 if(!requests.has(data.reqId))requests.set(data.reqId,ui(data.action,data.args).then(result=>{if(!['state','targets','artifact-link'].includes(data.action))channel.postMessage({type:'changed'});return {ok:true,result}},e=>({ok:false,error:error(e)})));
 channel.postMessage({reqId:data.reqId,...await requests.get(data.reqId)});
};
cindy.onHostMessage(async msg=>{
 try{
  if(msg.type==='event'&&msg.name==='node-notification'){
   await ready();
   const key=msg.params?.credentialKey||'account';
   const a=apps.entries().find(a=>a.slot===key&&a.status!=='deleted');
   if(msg.method==='binding/authorization'){
    const reservation=a&&bindingReservations.get(a.id);
    if(reservation&&reservation.token===msg.params?.token)channel.postMessage({type:'binding-authorization',applicationId:a.id,token:reservation.token,url:msg.params.url});
    return;
   }
   if(a?.status==='active')await runtime(a.id).onMessage(msg);return;
  }
  if(msg.type!=='tool-call')return;
  if(msg.tool==='inspect_host_support'){
   const node=await cindy.node.request({method:'runtime/capabilities',params:{},timeoutMs:30000});
   const support={node:node.ok?node.result:null,nodeError:node.ok?undefined:node.errorCode,targets:typeof cindy.targets?.list==='function',scopedDelegationProbe:typeof cindy.targets?.capabilities==='function',fullWorkflowVerified:false};
   await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result:support});return;
  }
  await ready();
  if(msg.tool==='list_inbox'){const s=await state();const offset=Math.max(0,msg.args?.offset||0);await cindy.send({type:'tool-result',callId:msg.callId,ok:true,result:s.tasks.slice(offset,offset+50)});return;}
  const id=msg.tool==='bind_application'?(msg.args?.applicationId||apps.entries().find(a=>a.status==='active')?.id):apps.route(msg.args||{});
  if(!id)fail('APPLICATION_REQUIRED');
  if(msg.tool==='bind_application'){
   const reservation=await manage(async()=>{const old=bindingReservations.get(id);if(old&&old.expiresAt>Date.now())fail('AUTHORIZATION_BUSY');const token=crypto.randomUUID();bindingReservations.set(id,{token,expiresAt:Date.now()+300000});return token;});
   try{await runtime(id).onMessage(msg);}finally{if(bindingReservations.get(id)?.token===reservation)bindingReservations.delete(id);}
  }else await runtime(id).onMessage(msg);
 }catch(e){const err=error(e);if(msg.type==='tool-call')await cindy.send({type:'tool-result',callId:msg.callId,ok:false,errorCode:err.code,message:err.message});else channel.postMessage({type:'error',error:err});}
});
// Resume only the user's persisted reception choice. Paused apps stay paused.
ready().then(async()=>{
 for(const a of apps.entries())if(a.status==='active'&&a.state.connection?.receivingRequested){
  try{await runtime(a.id).resume();}catch(e){channel.postMessage({type:'error',error:error(e)});}
 }
}).catch(e=>channel.postMessage({type:'error',error:error(e)}));

'use strict';
const {fail}=require('./core.cjs');
class Activity {
 constructor(b,node){this.b=b;this.node=node;}
 async append(args,session){return this.b.serial(async()=>{
  const t=Object.values(this.b.state.tasks).find(t=>t.bindingId===args.bindingId);
  if(!t)fail('BINDING_NOT_FOUND');if(!session||session!==t.targetTaskId)fail('SESSION_MISMATCH');if(args.generation!==t.generation)fail('STALE_GENERATION');
  if(!['comment','step'].includes(args.kind)||!Number.isSafeInteger(args.sequence)||args.sequence<1||typeof args.message!=='string'||!args.message.trim()||new TextEncoder().encode(args.message).length>3000)fail('ACTIVITY_INVALID');
  const signature=JSON.stringify([args.kind,args.message]);let op=t.activities?.[args.sequence];
  if(op&&op.signature!==signature)fail('SEQUENCE_CONFLICT');
  if(!op&&args.sequence<=(t.activitySequence||0))fail('STALE_SEQUENCE');
  if(['done','stopped'].includes(t.state))fail('REPORT_NOT_ACTIVE');
  const save=async value=>{const n=JSON.parse(JSON.stringify(this.b.state));n.tasks[t.id].activities||={};n.tasks[t.id].activities[args.sequence]=value;n.tasks[t.id].activitySequence=Math.max(args.sequence,n.tasks[t.id].activitySequence||0);await this.b.save(n);op=value;};
  if(op&&['verified','accepted_unverified'].includes(op.state))return op;
  const snap=await this.b.remote.get(t.id);if(!snap.assigned||snap.done||snap.deleted||snap.title!==t.snapshot.title||snap.description!==t.snapshot.description)fail('SOURCE_REVOKED');
  const call=(action,extra)=>this.node('feishu/action',{action,guid:t.id,appId:this.b.state.connection.appId,...extra});
  if(!op){await save({kind:args.kind,message:args.message,signature,key:this.b.uuid(),timestamp:Math.floor(Date.now()/1000),state:'attempted'});
   try{const receipt=await call('activity_write',{operation:op,expectedTitle:snap.title,expectedDescription:snap.description});await save({...op,receipt,state:args.kind==='step'?'accepted_unverified':'attempted'});}catch(e){await save({...op,error:e.code||'ACTIVITY_OUTCOME_UNKNOWN'});return op;}
  }
  if(op.kind==='step')return op;
  if(!op.receipt?.id)return {...op,error:'ACTIVITY_OUTCOME_UNKNOWN'};
  try{const readback=await call('activity_read',{commentId:op.receipt.id});if(readback.id!==op.receipt.id||readback.resourceId!==t.id||readback.content!==op.message)fail('COMMENT_READBACK_MISMATCH');await save({...op,state:'verified',readback});}catch(e){await save({...op,error:e.code||'COMMENT_READBACK_FAILED'});}
  return op;
 });}
}
module.exports={Activity};

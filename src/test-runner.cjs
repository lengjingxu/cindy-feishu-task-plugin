'use strict';
const {fail}=require('./core.cjs');const {fileMatches}=require('./artifacts.cjs');const clone=x=>JSON.parse(JSON.stringify(x));
// 创建/事件、受理排队、伙伴实际开工三段各自计时，避免队列延迟吃掉执行预算。
const CREATE_BUDGET=600000,QUEUE_BUDGET=1800000,WORK_BUDGET=600000,SETTLE_BUDGET=900000;
class TestRunner {
 constructor(b,onboarding,io,now=()=>Date.now()){Object.assign(this,{b,onboarding,io,now});this.tail=Promise.resolve();}
 serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 get run(){return this.b.state.testRun;}
 async save(run){await this.b.serial(async()=>{const n=clone(this.b.state);n.testRun=run;n.onboarding.test={state:run.state,stage:run.stage,error:run.error,epoch:run.epoch,runId:run.id,cleanup:run.cleanup};await this.b.save(n);});}
 async start(target){return this.serial(async()=>{
  if(this.run&&!['passed','failed','blocked'].includes(this.run.state))fail('TEST_ALREADY_ACTIVE');
  if(this.run?.guid&&this.run.cleanup?.state!=='verified')fail('TEST_CLEANUP_REQUIRED');
  const s=this.onboarding.state;
  if(s.identity.state!=='verified')fail('CHECK_CONNECTION_FIRST');
  if(s.permissions.state!=='verified')fail('TASK_PERMISSIONS_REQUIRED');
  if(s.association.state!=='selected')fail('ASSOCIATION_REQUIRED');
  if(target?.kind!=='bot'||!target.id)fail('TEST_TARGET_REQUIRED');
  if(!this.b.state.connection?.partnerId)fail('CONNECTION_PARTNER_REQUIRED');
  if(target.id!==this.b.state.connection.partnerId)fail('CONNECTION_PARTNER_MISMATCH');
  const r=await this.b.targets.resolve({target});if(r.id!==target.id||r.kind!=='bot')fail('TARGET_UNAVAILABLE');
  await this.b.assertExecution();
  await this.b.settleStopped();
  if(this.onboarding.hasBindings())fail('ACTIVE_BINDINGS_FROZEN');
  const id=this.b.uuid(),marker='cindy-test-'+id;
  let run={id,marker,epoch:s.epoch,appId:s.identity.appId,target:clone(target),startedAt:this.now(),deadline:this.now()+CREATE_BUDGET,acceptedAt:null,queueDeadline:null,workStartedAt:null,workDeadline:null,state:'running',stage:'create',create:{state:'prepared'},cleanup:{state:'not_needed'}};
  await this.save(run);
  try{
   await this.io.listen(run.appId,run.startedAt,600000);
   run.create.state='attempted';await this.save(run);
   const receipt=await this.io.create(run);if(!receipt?.guid)fail('TEST_CREATE_RECEIPT_INVALID');
   run={...run,guid:receipt.guid,create:{state:'received',receipt},cleanup:{state:'required'},stage:'event'};await this.save(run);
  }catch(e){run={...run,state:run.create.state==='attempted'?'create_uncertain':'blocked',error:e.code||'TEST_CREATE_UNKNOWN'};await this.save(run);await this.io.stop();}
  return this.run;
 });}
 async tick(){return this.serial(async()=>{
  let r=this.run;if(!r||!['running','cleanup_pending','cleanup_uncertain'].includes(r.state))return r;
  if(r.state.startsWith('cleanup'))return this.cleanup(r);
  if(r.epoch!==this.onboarding.state.epoch)return this.finish(false,'TEST_CONFIGURATION_CHANGED');
  const expired=this.expired(r);if(expired)return this.finish(false,expired);
  try{
   if(r.stage==='event'){
    const entry=Object.entries(this.b.state.events).find(([,e])=>e.appId===r.appId&&e.guid===r.guid);
    if(!entry)return r;
    const t=await this.b.refresh(entry[0]);if(!t)fail('TEST_EVENT_NOT_CREATE');
    if(t.snapshot.title!==r.marker||t.snapshot.description!==require('./test-spec.cjs').description(r.marker)||!t.snapshot.soleAppAssignee)fail('TEST_SOURCE_MISMATCH');
    r={...r,stage:'dispatch',event:{id:entry[1].id,guid:r.guid}};await this.save(r);
    await this.b.serial(async()=>{const n=clone(this.b.state);n.onboarding.events={...n.onboarding.events,runtime:{state:'verified',guid:r.guid,eventId:entry[1].id,epoch:r.epoch}};await this.b.save(n);});
   }
   if(r.stage==='dispatch'){
    const t=await this.b.dispatch(r.guid,r.target);
    if(t.state==='uncertain')return this.finish(false,'TEST_DELIVERY_UNCERTAIN');
    if(!t.targetTaskId)fail('TEST_DELIVERY_RECEIPT_INVALID');
    const acceptedAt=this.now();
    r={...r,stage:'result',acceptedAt,queueDeadline:acceptedAt+QUEUE_BUDGET,delivery:{taskId:t.targetTaskId,requestKey:t.dispatch.requestKey}};await this.save(r);
   }
   let t=this.b.task(r.guid);
   if(["write_uncertain","write_failed","writing"].includes(t.state))t=await this.b.reconcile(r.guid);
   if(r.workStartedAt==null&&this.started(t)){const workStartedAt=this.now();r={...r,workStartedAt,workDeadline:workStartedAt+WORK_BUDGET};await this.save(r);}
   if(['write_blocked','write_failed','stopped','needs_input'].includes(t.state)&&t.error!=='FILE_GRANT_REQUIRED')return this.finish(false,t.error||'TEST_RESULT_BLOCKED');
   if(t.state==='done'){
    const snap=await this.b.remote.get(r.guid);
    if(!t.result?.summary.includes(r.marker)||!t.result.artifacts?.length)fail('TEST_ARTIFACT_REQUIRED');
    if(!snap.done||snap.agentStatus!==4||!snap.assigned||snap.title!==r.marker)fail('TEST_READBACK_MISMATCH');
    if(t.outbox.some(op=>op.state!=='verified'||(op.kind==='file'&&!fileMatches(snap,op))||(op.kind==='text'&&!snap.textDeliveries.includes(op.value))))fail('TEST_READBACK_MISMATCH');
    const downloads=[];
    r={...r,proof:{operations:['task.create','task.event','target.send','text_delivery','task_delivery','agent_status','task.readback'],guid:r.guid,event:r.event,delivery:r.delivery,readback:{done:snap.done,agentStatus:snap.agentStatus,attachments:snap.attachments,textDeliveries:snap.textDeliveries},downloads,epoch:r.epoch}};await this.save(r);
    for(const artifact of t.result.artifacts){
     const expected=require('./artifacts.cjs').verifiedArtifact(t,artifact.id);
     const proof=await this.io.download(r,expected);
     if(proof?.verified!==true||proof.guid!==expected.guid||proof.bytes!==expected.bytes||proof.content!==r.marker+'\n'||!/^[a-f0-9]{64}$/.test(proof.sha256||''))fail('TEST_DOWNLOAD_CONTENT_MISMATCH');
     downloads.push(proof);
     r={...r,proof:{...r.proof,downloads:[...downloads]}};await this.save(r);
    }
    r={...r,proof:{...r.proof,operations:[...r.proof.operations,'attachment.download']}};await this.save(r);
    return this.finish(true);
   }
  }catch(e){return this.finish(false,e.code||'TEST_STAGE_FAILED');}
  return this.run;
 });}
 async finish(passed,error){let r={...this.run,state:'cleanup_pending',stage:'cleanup',outcome:passed?'passed':'failed',...(error?{error}:{})};await this.save(r);return this.cleanup(r);}
 async cleanup(r){
  await this.io.stop();
  if(!r.guid){await this.save({...r,state:'create_uncertain',error:'TEST_GUID_UNKNOWN'});return this.run;}
  // 伙伴仍在执行时不得删除飞书任务，否则在途执行会立刻 TASK_NOT_FOUND。
  const inflight=await this.inFlight(r);
  if(inflight){
   const since=r.cleanup.since||this.now();
   const wait={...r.cleanup,state:'waiting',reason:inflight,since};
   await this.save(this.now()-since>=SETTLE_BUDGET?{...r,cleanup:wait,state:'cleanup_uncertain',error:'TEST_AGENT_IN_FLIGHT'}:{...r,cleanup:wait});
   return this.run;
  }
  // Revoke report generation before cleanup. This cannot stop an already-running partner.
  await this.b.serial(async()=>{const t=this.b.state.tasks[r.guid];if(t&&t.state!=='stopped'){await this.b.stop(r.guid);}});
  try{
   let absent=await this.io.absent(r);
   if(!absent.absent){
    if(r.cleanup.state==='attempted')fail('TEST_CLEANUP_OUTCOME_UNKNOWN');
    r={...r,cleanup:{state:'attempted'}};await this.save(r);
    await this.io.remove(r);absent=await this.io.absent(r);
   }
   if(absent.absent!==true)fail('TEST_CLEANUP_READBACK_FAILED');
   r={...r,cleanup:{state:'verified',receipt:absent},state:r.outcome||'failed',stage:'finished'};if(r.error==='TEST_AGENT_IN_FLIGHT')delete r.error;await this.save(r);
   if(r.state==='passed')await this.b.serial(async()=>{const n=clone(this.b.state);for(const k of ['permissions','registration','subscription','events'])n.onboarding[k]={...n.onboarding[k],runtime:{state:'verified',guid:r.guid,epoch:r.epoch}};n.onboarding.publication={...n.onboarding.publication,runtime:{state:'observed',taskCapabilitiesVerified:true,guid:r.guid,epoch:r.epoch}};await this.b.save(n);});
  }catch(e){await this.save({...r,state:'cleanup_uncertain',error:e.code||'TEST_CLEANUP_UNKNOWN'});}
  return this.run;
 }
 expired(r){
  const now=this.now();
  if(!r.delivery)return now>=r.deadline?'TEST_DEADLINE_EXCEEDED':null;
  if(r.workStartedAt==null)return now>=r.queueDeadline?'TEST_QUEUE_TIMEOUT':null;
  return now>=r.workDeadline?'TEST_DEADLINE_EXCEEDED':null;
 }
 started(t){return Boolean(t)&&(t.startedAt!=null||['writing','write_uncertain','write_failed'].includes(t.state));}
 async inFlight(r){
  if(!r.delivery)return null;
  const t=this.b.task(r.guid);
  if(t&&['writing','write_uncertain','write_failed'].includes(t.state))return 'TASK_WRITING';
  if(t&&t.state==='done')return null;
  if(typeof this.b.inspectExecution!=='function')return null;
  let x;try{x=await this.b.inspectExecution(r.guid);}catch(e){return 'EXECUTION_RECEIPT_UNREADABLE';}
  const receipt=x?.executionReceipt;
  if(!receipt||receipt.settled===true)return null;
  return ['pending','accepted','cancelled'].includes(receipt.status)?'EXECUTION_IN_FLIGHT':null;
 }
 async cancel(){return this.serial(async()=>{if(!this.run||this.run.state!=='running')fail('TEST_NOT_RUNNING');return this.finish(false,'TEST_CANCELLED');});}
}
module.exports={TestRunner};

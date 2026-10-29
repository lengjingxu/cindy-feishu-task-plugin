'use strict';
const {fail}=require('./core.cjs');const {fileMatches}=require('./artifacts.cjs');const clone=x=>JSON.parse(JSON.stringify(x));
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
  let run={id,marker,epoch:s.epoch,appId:s.identity.appId,target:clone(target),startedAt:this.now(),deadline:this.now()+600000,state:'running',stage:'create',create:{state:'prepared'},cleanup:{state:'not_needed'}};
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
  if(this.now()>=r.deadline)return this.finish(false,'TEST_DEADLINE_EXCEEDED');
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
    r={...r,stage:'result',delivery:{taskId:t.targetTaskId,requestKey:t.dispatch.requestKey}};await this.save(r);
   }
   let t=this.b.task(r.guid);
   if(["write_uncertain","write_failed","writing"].includes(t.state))t=await this.b.reconcile(r.guid);
   if(['write_blocked','write_failed','stopped','needs_input'].includes(t.state)&&t.error!=='FILE_GRANT_REQUIRED')return this.finish(false,t.error||'TEST_RESULT_BLOCKED');
   if(t.state==='done'){
    const snap=await this.b.remote.get(r.guid);
    if(!t.result?.summary.includes(r.marker)||!t.result.artifacts?.length)fail('TEST_ARTIFACT_REQUIRED');
    if(!snap.done||snap.agentStatus!==4||!snap.assigned||snap.title!==r.marker)fail('TEST_READBACK_MISMATCH');
    if(t.outbox.some(op=>op.state!=='verified'||(op.kind==='file'&&!fileMatches(snap,op))||(op.kind==='text'&&!snap.textDeliveries.includes(op.value))))fail('TEST_READBACK_MISMATCH');
    r={...r,proof:{operations:['task.create','task.event','target.send','text_delivery','task_delivery','agent_status','task.readback'],guid:r.guid,event:r.event,delivery:r.delivery,readback:{done:snap.done,agentStatus:snap.agentStatus,attachments:snap.attachments,textDeliveries:snap.textDeliveries},epoch:r.epoch}};await this.save(r);
    return this.finish(true);
   }
  }catch(e){return this.finish(false,e.code||'TEST_STAGE_FAILED');}
  return this.run;
 });}
 async finish(passed,error){let r={...this.run,state:'cleanup_pending',stage:'cleanup',outcome:passed?'passed':'failed',...(error?{error}:{})};await this.save(r);return this.cleanup(r);}
 async cleanup(r){
  await this.io.stop();
  if(!r.guid){await this.save({...r,state:'create_uncertain',error:'TEST_GUID_UNKNOWN'});return this.run;}
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
   r={...r,cleanup:{state:'verified',receipt:absent},state:r.outcome||'failed',stage:'finished'};await this.save(r);
   if(r.state==='passed')await this.b.serial(async()=>{const n=clone(this.b.state);for(const k of ['permissions','registration','subscription','events'])n.onboarding[k]={...n.onboarding[k],runtime:{state:'verified',guid:r.guid,epoch:r.epoch}};n.onboarding.publication={...n.onboarding.publication,runtime:{state:'observed',taskCapabilitiesVerified:true,guid:r.guid,epoch:r.epoch}};await this.b.save(n);});
  }catch(e){await this.save({...r,state:'cleanup_uncertain',error:e.code||'TEST_CLEANUP_UNKNOWN'});}
  return this.run;
 }
 async cancel(){return this.serial(async()=>{if(!this.run||this.run.state!=='running')fail('TEST_NOT_RUNNING');return this.finish(false,'TEST_CANCELLED');});}
}
module.exports={TestRunner};

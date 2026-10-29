'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {Bridge,initial}=require('../src/core.cjs');
async function fixture(createdAt=10){let now=150,n=0,sends=0;const snapshot={createdAt,title:'任务',description:'要求',assigned:false,done:false};const b=new Bridge({store:{load:async()=>({...initial(),connection:{appId:'app',partnerId:'bot'}}),save:async()=>{}},uuid:()=>String(++n),now:()=>now,targets:{capabilities:async()=>({delegation:{version:1,execution:true}}),resolve:async p=>p.target,send:async()=>{sends++;return{accepted:true,taskId:'session'}}},remote:{get:async()=>({...snapshot})}});await b.load();return {b,snapshot,setTime:t=>now=t,get sends(){return sends},event:async(id,extra={})=>{await b.ingest({id,guid:'task',appId:'app',baseline:100,...extra});return b.refresh('app:'+id);}};}
for(const createdAt of [10,120])test('已观察前态：创建时间'+createdAt+'的任务启用后指派可接入',async()=>{const f=await fixture(createdAt);assert.equal(await f.event('before',{isCreate:createdAt>100}),null);f.setTime(250);f.snapshot.assigned=true;const t=await f.event('assigned',{assigneesChanged:true,eventAt:200});assert.equal(t.partnerId,'bot');await f.b.drain();assert.equal(f.sends,1);});
test('历史任务评论或一般更新不接管，即使当前已指派',async()=>{const f=await fixture();f.snapshot.assigned=true;assert.equal(await f.event('comment'),null);assert.equal(await f.event('ordinary'),null);assert.equal(f.sends,0);});
test('没有前态/缺时间/陈旧或乱序负责人事件不推断应用新增指派',async()=>{const f=await fixture();f.snapshot.assigned=true;assert.equal(await f.event('unknown',{assigneesChanged:true,eventAt:120}),null);assert.equal(f.b.state.events['app:unknown'].intake,'assignment_unproven');f.snapshot.assigned=false;await f.event('before');f.snapshot.assigned=true;f.setTime(250);for(const [id,eventAt] of [['missing',null],['old',90],['out-of-order',140]])assert.equal(await f.event(id,{assigneesChanged:true,eventAt}),null);assert.equal(f.sends,0);});
test('重复/乱序不重投；取消指派终止任务并拒绝后续报告',async()=>{const f=await fixture();await f.event('before');f.setTime(250);f.snapshot.assigned=true;await f.event('assigned',{assigneesChanged:true,eventAt:200});await f.b.drain();await f.event('assigned',{assigneesChanged:true,eventAt:200});await f.event('late',{assigneesChanged:true,eventAt:110});await f.b.drain();assert.equal(f.sends,1);f.snapshot.assigned=false;await f.event('removed',{assigneesChanged:true,eventAt:240});const t=f.b.task('task');assert.equal(t.state,'stopped');await assert.rejects(f.b.report('progress',{bindingId:t.bindingId,generation:t.generation,sequence:1,message:'late'},'session'),{code:'REPORT_NOT_ACTIVE'});});

test('首次指派事件：基线排除旧指派，无前态也自动且仅投递一次',async()=>{const f=await fixture();f.b.state.connection.assignmentBaseline={appId:'app',at:100,assigned:['old']};f.snapshot.assigned=true;const t=await f.event('first',{assigneesChanged:true,eventAt:120});assert.equal(t.partnerId,'bot');assert.equal(f.b.state.events['app:first'].intake,'live_assignment');await f.b.drain();await f.event('first',{assigneesChanged:true,eventAt:120});await f.b.drain();assert.equal(f.sends,1);});
test('基线中的旧任务、错误应用、陈旧与未来事件不能导入任务',async()=>{for(const variation of ['old','wrong-app','before','future','missing','done']){const f=await fixture();f.b.state.connection.assignmentBaseline={appId:variation==='wrong-app'?'other':'app',at:100,assigned:variation==='old'?['task']:[]};f.snapshot.assigned=true;f.snapshot.done=variation==='done';assert.equal(await f.event(variation,{assigneesChanged:true,eventAt:variation==='before'?90:variation==='future'?200:variation==='missing'?null:120}),null);assert.equal(f.sends,0);}});
test('基线旧任务在观察到撤销后重新指派可接入',async()=>{const f=await fixture();f.b.state.connection.assignmentBaseline={appId:'app',at:100,assigned:['task']};await f.event('removed',{assigneesChanged:true,eventAt:120});f.setTime(250);f.snapshot.assigned=true;assert.equal((await f.event('reassigned',{assigneesChanged:true,eventAt:200})).partnerId,'bot');await f.b.drain();assert.equal(f.sends,1);});

// Regression/unit: a task assigned while subscription was rejected has no live
// event to replay. Explicit recovery verifies current source and deduplicates.
test('用户指定漏收任务以真实API补收，不伪造事件、不重投',async()=>{
 const f=await fixture();f.snapshot.assigned=true;f.snapshot.soleAppAssignee=true;
 await Promise.all([f.b.recoverAssigned('task'),f.b.recoverAssigned('task')]);
 assert.equal(Object.keys(f.b.state.events).length,0);assert.equal(f.b.task('task').intake.kind,'explicit_recovery');
 await f.b.drain();await f.b.recoverAssigned('task');await f.b.drain();assert.equal(f.sends,1);
 f.b.state.connection.partnerId='other';assert.equal((await f.b.recoverAssigned('task')).partnerId,'bot');
});
test('补收拒绝已取消指派、已完成及多负责人的任务',async()=>{
 for(const kind of ['unassigned','done','multiple']){
  const f=await fixture();f.snapshot.assigned=kind!=='unassigned';f.snapshot.done=kind==='done';f.snapshot.soleAppAssignee=kind!=='multiple';
  await assert.rejects(f.b.recoverAssigned('task'));assert.equal(Object.keys(f.b.state.tasks).length,0);assert.equal(f.sends,0);
 }
});

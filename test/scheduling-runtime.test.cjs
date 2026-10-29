const {test}=require('node:test'),assert=require('node:assert/strict');
const {createApplication}=require('../src/application.cjs');const {initial}=require('../src/core.cjs');
test('现有监听心跳在到期时派发预约任务，暂停持久化且恢复不自动启动暂停应用',async()=>{
 const appId='cli_0000000000000001',guid='11111111-1111-4111-8111-111111111111';let sends=0,listenerCalls=0,finish,r;
 const future=Date.now()+100000;
 const snapshot={title:'未来预约',description:'fixture',assigned:true,soleAppAssignee:true,createdAt:1,contextVersion:1,start:{timestamp:future,isAllDay:false},textDeliveries:[],attachments:[],subtasks:[],tasklists:[],sourceAttachments:[]};
 let data={...initial(),connection:{appId,partnerId:'bot'},onboarding:{epoch:1,identity:{state:'verified',appId},permissions:{state:'verified'},association:{state:'selected',target:{kind:'bot',id:'bot'}},test:{state:'passed',epoch:1},registration:{runtime:{state:'verified',epoch:1}},subscription:{runtime:{state:'verified',epoch:1}},events:{runtime:{state:'verified',epoch:1}}},testRun:{target:{id:'bot'}},tasks:{[guid]:{id:guid,appId,partnerId:'bot',bindingId:'binding',generation:1,sequence:0,reports:{},state:'scheduled',schedule:{notBefore:future,timeZone:'Asia/Shanghai'},queuedTarget:{kind:'bot',id:'bot'},snapshot}}};
 global.cindy={targets:{list:async()=>({targets:[]}),resolve:async p=>p.target,capabilities:async()=>({delegation:{version:1,execution:true}}),send:async()=>{sends++;return{accepted:true,taskId:'session'}}}};
 const store={load:async()=>structuredClone(data),save:async s=>{data=structuredClone(s)}};
 const rawNode=async req=>{
  if(req.method==='binding/restore')return{ok:true,result:{saved:true,appId}};
  if(req.method==='listener/run'){listenerCalls++;queueMicrotask(()=>r.onMessage({type:'event',name:'node-notification',method:'listener/status',params:{state:'connected'}}));return new Promise(resolve=>finish=()=>resolve({ok:true,result:{reason:'paused',childExited:true}}));}
  if(req.method==='listener/stop'){finish?.();return{ok:true,result:{}};}
  if(req.params.action==='assignment_baseline')return{ok:true,result:{appId,at:Date.now(),assigned:[]}};
  if(req.params.action==='get')return{ok:true,result:structuredClone(snapshot)};
  throw Error('unexpected call');
 };
 const make=()=>createApplication({id:'app',slot:'account',store,channel:{postMessage(){}},rawNode,canOperate(){},assertUnique:async()=>{}});
 try{
  r=make();await r.ui('receive');assert.equal(sends,0);assert.equal(data.connection.receivingRequested,true);
  // Simulates time reaching an already persisted due point; fresh Feishu data
  // also confirms the moved start instead of trusting stale local state.
  r.bridge.state.tasks[guid].schedule.notBefore=Date.now()-1;snapshot.start.timestamp=Date.now()-1;
  await r.onMessage({type:'event',name:'node-notification',method:'listener/status',params:{state:'connected'}});assert.equal(sends,1);
  await r.onMessage({type:'event',name:'node-notification',method:'listener/status',params:{state:'connected'}});assert.equal(sends,1);
  // A fresh runtime uses the saved receive choice and does not redeliver work.
  finish();r=make();await r.resume();assert.equal(listenerCalls,2);assert.equal(sends,1);
  await r.ui('pause');assert.equal(data.connection.receivingRequested,false);const restored=make();await restored.resume();assert.equal(listenerCalls,2);
 }finally{finish?.();delete global.cindy;}
});

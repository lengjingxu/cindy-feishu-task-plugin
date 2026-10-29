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

async function autonomousFixture(t,{sendError=false,busy=false,readError=false}={}){
 t.mock.timers.enable({apis:['Date','setTimeout'],now:1800000000000});
 const appId='cli_0000000000000001',guid='22222222-2222-4222-8222-222222222222';
 let sends=0,reads=0,finish,r,hold=busy;
 const future=Date.now()+10000;
 const snapshot={title:'自动预约',description:'fixture',assigned:true,soleAppAssignee:true,createdAt:1,contextVersion:1,start:{timestamp:future,isAllDay:false},textDeliveries:[],attachments:[],subtasks:[],tasklists:[],sourceAttachments:[]};
 let data={...initial(),connection:{appId,partnerId:'bot'},onboarding:{epoch:1,identity:{state:'verified',appId},permissions:{state:'verified'},association:{state:'selected',target:{kind:'bot',id:'bot'}},test:{state:'passed',epoch:1},registration:{runtime:{state:'verified',epoch:1}},subscription:{runtime:{state:'verified',epoch:1}},events:{runtime:{state:'verified',epoch:1}}},testRun:{target:{id:'bot'}},tasks:{[guid]:{id:guid,appId,partnerId:'bot',bindingId:'binding',generation:1,sequence:0,reports:{},state:'scheduled',schedule:{notBefore:future,timeZone:'Asia/Shanghai'},queuedTarget:{kind:'bot',id:'bot'},snapshot}}};
 global.cindy={targets:{list:async()=>({targets:[]}),resolve:async p=>p.target,capabilities:async()=>({delegation:{version:1,execution:true}}),send:async()=>{sends++;if(sendError)throw Error('unknown transport');return{accepted:true,taskId:'session'};}}};
 const rawNode=async req=>{
  if(req.method==='binding/restore')return{ok:true,result:{saved:true,appId}};
  if(req.method==='listener/run'){queueMicrotask(()=>r.onMessage({type:'event',name:'node-notification',method:'listener/status',params:{state:'connected'}}));return new Promise(resolve=>finish=()=>resolve({ok:true,result:{reason:'paused',childExited:true}}));}
  if(req.method==='listener/stop'){finish?.();return{ok:true,result:{}};}
  if(req.params.action==='assignment_baseline')return{ok:true,result:{appId,at:Date.now(),assigned:[]}};
  if(req.params.action==='get'){reads++;if(readError&&reads===1)return{ok:false,errorCode:'TEMPORARY'};return{ok:true,result:structuredClone(snapshot)};}
  throw Error('unexpected call');
 };
 r=createApplication({id:'app',slot:'account',store:{load:async()=>structuredClone(data),save:async s=>{data=structuredClone(s)}},channel:{postMessage(){}},rawNode,canOperate(){},assertUnique:async()=>{},dispatchGate:async(target,send)=>{if(hold)throw Object.assign(Error('busy'),{code:'TARGET_BUSY'});return send();}});
 const advance=async ms=>{t.mock.timers.tick(ms);for(let i=0;i<100;i++)await Promise.resolve();};
 t.after(async()=>{await r.ui('pause');delete global.cindy;t.mock.timers.reset();});
 await r.ui('receive');
 return{r,advance,snapshot,get sends(){return sends},get reads(){return reads},get task(){return data.tasks[guid]},release(){hold=false}};
}
test('预约由插件计时器唤醒，无Host心跳或页面操作仍只派发一次',async t=>{
 const h=await autonomousFixture(t);await h.advance(9999);assert.equal(h.sends,0);
 await h.advance(1);assert.equal(h.sends,1);assert.equal(h.task.state,'delivered');
 await h.advance(180000);assert.equal(h.sends,1);
});
test('伙伴占用时按分钟检查原伙伴，不热循环或改派',async t=>{
 const h=await autonomousFixture(t,{busy:true});await h.advance(10000);assert.equal(h.sends,0);assert.equal(h.task.queueError,'TARGET_BUSY');
 h.release();await h.advance(59999);assert.equal(h.sends,0);await h.advance(1);assert.equal(h.sends,1);assert.equal(h.task.dispatch.target.id,'bot');
});
test('计时器醒来重新读取飞书日期，延期后继续等待',async t=>{
 const h=await autonomousFixture(t);h.snapshot.start.timestamp+=20000;
 await h.advance(10000);assert.equal(h.sends,0);assert.equal(h.reads,1);
 await h.advance(20000);assert.equal(h.sends,1);
});
test('暂停清除唤醒，恢复接收后按账本重新安排',async t=>{
 const h=await autonomousFixture(t);await h.r.ui('pause');await h.advance(10000);assert.equal(h.sends,0);
 await h.r.ui('receive');assert.equal(h.sends,1);
});
test('未知投递结果不被自主计时器重发',async t=>{
 const h=await autonomousFixture(t,{sendError:true});await h.advance(10000);assert.equal(h.sends,1);assert.equal(h.task.state,'uncertain');
 await h.advance(180000);assert.equal(h.sends,1);
});

test('读取失败按持久化重试时间自主恢复，不提前发送',async t=>{
 const h=await autonomousFixture(t,{readError:true});await h.advance(10000);assert.equal(h.sends,0);assert.equal(h.task.nextAttemptAt,Date.now()+60000);
 await h.advance(59999);assert.equal(h.reads,1);await h.advance(1);assert.equal(h.sends,1);
});

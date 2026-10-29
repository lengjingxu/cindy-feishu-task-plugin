const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {webcrypto}=require('node:crypto');
// Production bundled entry: an unbound account can configure a partner, but
// cannot manufacture a connection, report source or secondary task assignment.
test('main通过Host恢复身份，未认证状态不接单，UI不能伪造任务报告',async()=>{
 const files=new Map(),replies=[],toolReplies=[];let receiver,channel,nodeCalls=[],resolves=0;
 class Channel{constructor(){channel=this}postMessage(v){replies.push(v)}}
 const cindy={fs:async r=>{if(r.op==='read')return files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'};files.set(r.path,r.content);return{ok:true}},targets:{list:async()=>({targets:[]}),resolve:async p=>{resolves++;return p.target},send:async()=>assert.fail('no sends')},node:{request:async r=>{nodeCalls.push(r);return r.method==='binding/restore'?{ok:true,result:{saved:false}}:{ok:false,errorCode:'CONNECTION_REQUIRED'}}},onHostMessage:fn=>{receiver=fn},send:async r=>{toolReplies.push(r)}};
 vm.runInNewContext(fs.readFileSync('plugin/main.js','utf8'),{cindy,BroadcastChannel:Channel,crypto:webcrypto,TextEncoder,Uint8Array,console});
 await channel.onmessage({data:{type:'request',reqId:'state',action:'state'}});assert.equal(replies.at(-1).ok,true);assert.equal(replies.at(-1).result.connectionAuthenticated,false);assert.equal(nodeCalls[0].method,'binding/restore');
 const req={data:{type:'request',reqId:'same',action:'select-partner',args:{target:{kind:'bot',id:'selected'}}}};await Promise.all([channel.onmessage(req),channel.onmessage(req)]);assert.equal(resolves,1);assert.equal(replies.at(-1).result.binding.state,'unbound');assert.equal(replies.at(-1).result.binding.candidate.id,'selected');
 await channel.onmessage({data:{type:'request',reqId:'receive',action:'receive'}});assert.equal(replies.at(-1).ok,false);assert(!nodeCalls.some(r=>r.method==='listener/run'));
 await channel.onmessage({data:{type:'request',reqId:'connect',action:'connect',args:{appId:'cli_0000000000000000'}}});assert.equal(replies.at(-1).ok,false);
 for(const action of ['dispatch','rules','submit_result']){await channel.onmessage({data:{type:'request',reqId:action,action,args:{session_context:{session_id:'forged'}}}});assert.equal(replies.at(-1).error.code,'ACTION_UNSUPPORTED');}
 await receiver({type:'tool-call',callId:'bind',tool:'bind_application',args:{}});const auth=nodeCalls.find(r=>r.method==='binding/authorize');assert.equal(auth.callId,'bind');assert.equal(auth.cancelWithCall,true);assert.equal(toolReplies.at(-1).ok,false);
});
test('Host恢复失败后下次重试重新初始化，不暴露半初始化成功状态',async()=>{
 const files=new Map(),replies=[];let channel,calls=0;
 class Channel{constructor(){channel=this}postMessage(v){replies.push(v)}}
 const cindy={fs:async r=>{if(r.op==='read')return files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'};files.set(r.path,r.content);return{ok:true}},targets:{list:async()=>({targets:[]})},node:{request:async()=>++calls===1?{ok:false,errorCode:'TEMPORARY'}:{ok:true,result:{saved:false}}},onHostMessage(){}};
 vm.runInNewContext(fs.readFileSync('plugin/main.js','utf8'),{cindy,BroadcastChannel:Channel,crypto:webcrypto,TextEncoder,Uint8Array,console});
 for(const reqId of ['first','second'])await channel.onmessage({data:{type:'request',reqId,action:'state'}});
 assert.equal(replies[0].ok,false);assert.equal(replies[1].ok,true);assert.equal(calls,3);
});
test('设置页绑定前置检查不创建或发送聊天任务',async()=>{
 const files=new Map(),replies=[];let channel,creates=0,sends=0;
 class Channel{constructor(){channel=this}postMessage(v){replies.push(v)}}
 const cindy={fs:async r=>{if(r.op==='read')return files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'};files.set(r.path,r.content);return{ok:true}},targets:{list:async()=>({targets:[]})},node:{request:async()=>({ok:true,result:{saved:false,hostServices:true}})},tasks:{create:async r=>{creates++;assert.equal(r.title,'绑定飞书应用');return{taskId:'setup',revision:1}},send:async r=>{sends++;assert.equal(r.taskId,'setup');assert(r.text.includes('bind_application'));return{runId:'setup-run'}}},onHostMessage(){}};
 vm.runInNewContext(fs.readFileSync('plugin/main.js','utf8'),{cindy,BroadcastChannel:Channel,crypto:webcrypto,TextEncoder,Uint8Array,console});
 await Promise.all(['a','b'].map(reqId=>channel.onmessage({data:{type:'request',reqId,action:'begin-binding'}})));assert.equal(creates,0);assert.equal(sends,0);assert.equal(replies.filter(r=>r.reqId).length,2);assert(replies.filter(r=>r.reqId).every(r=>r.ok));
});

// Production entry and real journal/Bridge with synthetic Host transports. This
// exercises app selection, event routing, removal and report isolation together.
async function multiFixture(seed,{nameRead}={}){
 const files=new Map(),replies=[],toolReplies=[],nodeCalls=[],sent=[];let receiver,channel,counter=0;
 if(seed){const payload=JSON.stringify(seed);files.set('ledger/r000000.json',JSON.stringify({index:0,previous:'',payload,hash:require('node:crypto').createHash('sha256').update(payload).digest('hex')}));}
 const snapshots=new Map();
 const identities={account:'cli_0000000000000001',account2:'cli_0000000000000002'};
 class Channel{constructor(){channel=this}postMessage(v){replies.push(v)}}
 const cindy={fs:async r=>{if(r.op==='read')return files.has(r.path)?{ok:true,content:files.get(r.path)}:{ok:false,errorCode:'NOT_FOUND'};files.set(r.path,r.content);return{ok:true}},targets:{list:async()=>({targets:[]}),resolve:async p=>p.target,get:async()=>({found:false}),capabilities:async()=>({delegation:{version:1,execution:true,receiptQuery:true,settled:true}}),send:async p=>{sent.push(p);return{executionId:'plugin-target:execution',requestKey:p.requestKey,target:p.target,delivery:'queue',accepted:true,taskId:p.target.id+'-session'}}},node:{request:async r=>{
  nodeCalls.push(r);const p=r.params||{};
  if(r.method==='binding/remove'){delete identities[p.credentialKey];return{ok:true,result:{removed:true}};}
  if(r.method==='binding/restore')return{ok:true,result:identities[p.credentialKey]?{saved:true,appId:identities[p.credentialKey],hostServices:true}:{saved:false,hostServices:true}};
  if(r.method==='feishu/action'&&p.action==='check')return{ok:true,result:{authenticated:p.appId===identities[p.credentialKey]}};
  if(r.method==='feishu/action'&&p.action==='app_profile')return nameRead?nameRead(p):{ok:true,result:{appId:identities[p.credentialKey],name:'应用 '+p.credentialKey,source:'bot/v3/info'}};
  if(r.method==='feishu/action'&&['get','write'].includes(p.action)){
   const key=p.appId+':'+p.guid;if(!snapshots.has(key))snapshots.set(key,{title:'Task',description:'Test',assigned:true,soleAppAssignee:true,createdAt:200,textDeliveries:[],attachments:[]});const snap=snapshots.get(key);
   if(p.action==='write'){const op=p.operation;if(op.kind==='text')snap.textDeliveries.push(op.value);else if(op.kind==='progress'){snap.agentProgress=op.value.message;snap.agentStatus=op.value.status;}else if(op.kind==='complete'){snap.done=true;snap.agentStatus=4;}}
   return{ok:true,result:structuredClone(snap)};
  }
  return{ok:true,result:{}};
 }},onHostMessage:fn=>{receiver=fn},send:async r=>toolReplies.push(r)};
 vm.runInNewContext(fs.readFileSync('plugin/main.js','utf8'),{cindy,BroadcastChannel:Channel,crypto:webcrypto,TextEncoder,Uint8Array,console,setInterval,clearInterval,setTimeout,clearTimeout});
 return{files,nodeCalls,identities,sent,toolReplies,snapshots,tool:m=>receiver(m),ui:async(action,args={})=>{const reqId='r'+ ++counter;await channel.onmessage({data:{type:'request',reqId,action,args}});return replies.find(r=>r.reqId===reqId);}};
}
test('multi-app settings keep separate partners; disconnect/delete require verified credential removal',async()=>{
 const h=await multiFixture();let s=await h.ui('state');assert.equal(s.ok,true);
 await h.ui('select-partner',{applicationId:'account',target:{kind:'bot',id:'old'}});
 const added=await h.ui('add-application');const id=added.result.applicationId;
 s=await h.ui('state');assert.equal(s.result.applications.length,2);assert.equal(s.result.applications[1].connection.appId,h.identities.account2);
 assert.deepEqual(Array.from(s.result.applications,a=>a.appProfile.name),['应用 account','应用 account2']);
 assert.equal(h.nodeCalls.filter(r=>r.params?.action==='app_profile').length,2);
 assert.equal(h.nodeCalls.filter(r=>['registration','subscription'].includes(r.params?.action)).length,0);
 await h.ui('select-partner',{applicationId:id,target:{kind:'bot',id:'new'}});
 s=await h.ui('state');assert.equal(s.result.applications[0].binding.partnerId,'old');assert.equal(s.result.applications[1].binding.partnerId,'new');
 assert.equal((await h.ui('prepare-removal',{applicationId:id,mode:'disconnect'})).result.credentialKey,'account2');
 assert.equal(h.identities.account2,'cli_0000000000000002');
 assert.equal((await h.ui('finish-removal',{applicationId:id})).ok,true);
 s=await h.ui('state');assert.equal(s.result.applications[1].status,'disconnected');assert.equal(s.result.applications[0].connectionAuthenticated,true);
 const before=h.nodeCalls.length;assert.equal((await h.ui('test-connection',{applicationId:id,target:{kind:'bot',id:'new'}})).error.code,'APPLICATION_DISCONNECTED');assert.equal(h.nodeCalls.length,before);
 const binding=await h.ui('begin-binding',{applicationId:id});assert.equal(binding.result.appId,'cli_0000000000000002');
 assert.equal((await h.ui('prepare-removal',{applicationId:id,mode:'delete'})).error.code,'AUTHORIZATION_BUSY');
 await h.ui('end-binding',{applicationId:id,token:binding.result.token});
 assert.equal((await h.ui('prepare-removal',{applicationId:id,mode:'delete'})).ok,true);assert.equal((await h.ui('finish-removal',{applicationId:id})).ok,true);
 s=await h.ui('state');assert.equal(s.result.applications.length,1);assert.equal(s.result.applications[0].binding.partnerId,'old');
});
test('active or pending tasks prevent removing credentials; report routing uses immutable binding, not selected app',async()=>{
 const {initial}=require('../src/core.cjs');
 const mk=(appId,partnerId,bindingId)=>({...initial(),connection:{appId,partnerId},onboarding:{epoch:1,identity:{state:'verified'},test:{state:'not_run'}},tasks:{same:{id:'same',appId,partnerId,bindingId,generation:1,sequence:0,reports:{},state:'pending',snapshot:{title:'Task',description:'Test'}}}});
 const seed={...initial(),applicationsVersion:1,applications:{a:{id:'a',slot:'account',status:'active',state:mk('cli_0000000000000001','one','bind-one')},b:{id:'b',slot:'account2',status:'active',state:mk('cli_0000000000000002','two','bind-two')}}};
 const h=await multiFixture(seed);assert.equal((await h.ui('state')).ok,true);
 assert.equal((await h.ui('prepare-removal',{applicationId:'a',mode:'delete'})).error.code,'ACTIVE_BINDINGS_FROZEN');
 await h.tool({type:'tool-call',callId:'ambiguous',tool:'get_task',args:{id:'same'}});assert.equal(h.toolReplies.at(-1).errorCode,'APPLICATION_REQUIRED');
 await h.tool({type:'tool-call',callId:'read',tool:'get_task',args:{id:'same',applicationId:'b'}});assert.equal(h.toolReplies.at(-1).result.partnerId,'two');
 await h.tool({type:'tool-call',callId:'forged',tool:'report_progress',args:{bindingId:'bind-one',applicationId:'b',generation:1,sequence:1,message:'forged',session_context:{session_id:'wrong'}}});assert.equal(h.toolReplies.at(-1).ok,false);
 assert.equal(h.nodeCalls.filter(r=>r.params?.action==='write').length,0);
});
test('concurrent results with identical task GUIDs report to each app credential and original partner',async()=>{
 const {initial}=require('../src/core.cjs');const applications={};
 for(const [id,slot,n] of [['a','account',1],['b','account2',2]]){const appId='cli_000000000000000'+n;applications[id]={id,slot,status:'active',state:{...initial(),connection:{appId,partnerId:id},onboarding:{identity:{state:'verified'}},tasks:{same:{id:'same',appId,partnerId:id,bindingId:'binding-'+id,generation:1,sequence:0,reports:{},state:'delivered',targetTaskId:'session-'+id,dispatch:{target:{kind:'bot',id}},snapshot:{title:'Task',description:'Test'}}}}};}
 const h=await multiFixture({...initial(),applicationsVersion:1,applications});await h.ui('state');
 await Promise.all(['a','b'].map(id=>h.tool({type:'tool-call',callId:id,tool:'submit_result',args:{bindingId:'binding-'+id,generation:1,sequence:1,message:'result-'+id,verification:'isolated readback',artifacts:[],session_context:{session_id:'session-'+id}}})));
 assert.equal(h.toolReplies.length,2);for(const result of h.toolReplies){assert.equal(result.ok,true);assert.equal(result.result.state,'done');}
 for(const [key,snap] of h.snapshots){const id=key.includes('0001:')?'a':'b';assert.equal(snap.done,true);assert.deepEqual(snap.textDeliveries,['result-'+id+'\n验证范围：isolated readback']);}
 for(const req of h.nodeCalls.filter(r=>r.method==='feishu/action'))assert.equal(req.params.appId,h.identities[req.params.credentialKey]);
 const state=await h.ui('state');assert.equal(state.result.tasks.length,2);assert.deepEqual(JSON.parse(JSON.stringify(state.result.tasks.map(t=>[t.applicationId,t.partnerId,t.state]))),[['a','a','done'],['b','b','done']]);
});

// Regression/unit: settings stream may end after Host saved the identity but
// before the UI receives its terminal receipt. A state refresh must restore the
// exact slot without authorizing again, inventing a saved state, or resetting it.
test('state refresh recovers a saved authorization after the terminal UI receipt was lost',async()=>{
 const h=await multiFixture();delete h.identities.account;
 let s=await h.ui('state');assert.equal(s.result.connectionAuthenticated,false);
 s=await h.ui('state');assert.equal(s.result.connectionAuthenticated,false);
 h.identities.account='cli_0000000000000001';
 s=await h.ui('state');assert.equal(s.ok,true);assert.equal(s.result.connectionAuthenticated,true);
 assert.equal(s.result.connection.appId,h.identities.account);assert.equal(s.result.onboarding.identity.state,'verified');
 const epoch=s.result.onboarding.epoch;await h.ui('state');
 assert.equal((await h.ui('state')).result.onboarding.epoch,epoch);
 assert.equal(h.nodeCalls.filter(r=>r.params?.action==='check').length,1);
 assert.equal(h.nodeCalls.filter(r=>r.method.startsWith('binding/authorize')).length,0);
});

test('读取一个应用名称失败仍能自动读取其他应用，不重复注册或授权',async()=>{
 const h=await multiFixture(undefined,{nameRead:async p=>p.credentialKey==='account'?{ok:false,errorCode:'PROTOCOL_ERROR',message:'FEISHU_API_99991672'}:{ok:true,result:{appId:p.appId,name:'应用二',source:'bot/v3/info'}}});
 await h.ui('state');await h.ui('add-application');const s=await h.ui('state');assert.equal(s.ok,true);
 assert.equal(s.result.applications[0].appProfile.state,'unavailable');assert.equal(s.result.applications[1].appProfile.name,'应用二');
 assert.equal(h.nodeCalls.filter(r=>r.params?.action==='app_profile').length,2);
 assert(!h.nodeCalls.some(r=>r.method.startsWith('binding/authorize')||['registration','subscription'].includes(r.params?.action)));
});
test('批量名称在途时添加应用不会读取未初始化运行时，下次状态包含新应用',async()=>{
 let release,started;const waiting=new Promise(r=>started=r);let reads=0;
 const h=await multiFixture(undefined,{nameRead:async p=>{if(++reads===1){started();await new Promise(r=>release=r);}return{ok:true,result:{appId:p.appId,name:'应用 '+p.credentialKey,source:'bot/v3/info'}};}});
 const first=h.ui('state');await waiting;await h.ui('add-application');release();
 assert.equal((await first).ok,true);const s=await h.ui('state');assert.equal(s.ok,true);assert.equal(s.result.applications.length,2);assert.equal(s.result.applications[1].appProfile.name,'应用 account2');
});

test('支持检查直接走无凭据Node方法，不冒充完整工作流已验证',async()=>{
 const replies=[],calls=[];let receiver;
 class Channel{postMessage(){}}
 const cindy={fs:async()=>({ok:false,errorCode:'NOT_FOUND'}),targets:{list(){throw Error('must not list targets')}},node:{request:async r=>{calls.push(r);assert.equal(r.method,'runtime/capabilities');return{ok:true,result:{version:1,authorization:true,hostServicesEntry:false,childSpawn:true}};}},onHostMessage:fn=>{receiver=fn},send:async r=>replies.push(r)};
 vm.runInNewContext(fs.readFileSync('plugin/main.js','utf8'),{cindy,BroadcastChannel:Channel,crypto:webcrypto,TextEncoder,Uint8Array,console});
 await receiver({type:'tool-call',tool:'inspect_host_support',callId:'inspect',args:{}});
 assert.equal(calls.length,1);assert.equal(replies[0].ok,true);assert.equal(replies[0].result.scopedDelegationProbe,false);assert.equal(replies[0].result.fullWorkflowVerified,false);assert.equal(replies[0].result.node.hostServicesEntry,false);
});

test('设置页授权只发公开Node请求，命名空间持久化且取消沿同一预留',async()=>{
 const h=await multiFixture();await h.ui('state');
 const begun=await h.ui('begin-binding',{applicationId:'account'});assert.equal(begun.ok,true);
 const token=begun.result.token;
 await h.ui('authorize-binding',{applicationId:'account',token});
 const auth=h.nodeCalls.find(x=>x.method==='binding/authorize');assert(auth);assert.equal(auth.callId,undefined);assert.equal(auth.params.authorizationMode,'settings');assert.equal(auth.params.credentialScope,begun.result.credentialScope);assert(auth.params.credentialScope);
 await h.ui('cancel-binding',{applicationId:'account',token});assert(h.nodeCalls.some(x=>x.method==='binding/cancel'));
 const wrong=await h.ui('authorize-binding',{applicationId:'account',token:'wrong'});assert.equal(wrong.error.code,'AUTHORIZATION_REQUIRED');
 const ledger=[...h.files.values()].map(x=>JSON.parse(x)).filter(x=>x.payload).map(x=>JSON.parse(x.payload));assert(ledger.some(x=>x.credentialScope===auth.params.credentialScope));
});

test('设置页在途原应用续授权固定身份，禁止解除与工具换绑',async()=>{
 const {initial}=require('../src/core.cjs'),{blank}=require('../src/onboarding.cjs');
 const appId='cli_0000000000000001';const state={...initial(),connection:{appId,partnerId:'original'},onboarding:{...blank(),identity:{state:'verified',appId}},tasks:{old:{id:'old',state:'needs_input',dispatch:{target:{kind:'bot',id:'original'},requestKey:'old-key'}}}};
 const h=await multiFixture(state);const begin=await h.ui('begin-binding');assert.equal(begin.ok,true);assert.equal(begin.result.appId,appId);
 await h.ui('authorize-binding',{token:begin.result.token});const call=h.nodeCalls.find(x=>x.method==='binding/authorize');assert.equal(call.params.appId,appId);assert.equal(call.params.authorizationMode,'settings');assert.equal(call.callId,undefined);
 const removal=await h.ui('prepare-removal',{mode:'disconnect'});assert.equal(removal.ok,false);assert.equal(h.sent.length,0);
});

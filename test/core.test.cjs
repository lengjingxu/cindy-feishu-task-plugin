const {test}=require('node:test');const assert=require('node:assert/strict');const {Bridge,initial}=require('../src/core.cjs');const {fileMatches,grantFor}=require('../src/artifacts.cjs');
const copy=x=>structuredClone(x);
async function fixture(){
 let data={...initial(),connection:{appId:'app',partnerId:'bot-1'}},n=0;const sends=[],writes=[];let snapshot={title:'写周报',description:'仅整理本任务',assigned:true,soleAppAssignee:true,done:false,createdAt:200,textDeliveries:[],attachments:[],agentStatus:2};
 const store={load:async()=>copy(data),save:async s=>{data=copy(s)}};
 const targets={capabilities:async()=>({delegation:{version:1,execution:true}}),resolve:async({target})=>target,send:async p=>{sends.push(copy(p));return{accepted:true,taskId:'canonical-1',delivery:'queue'}},cancel:async()=>({accepted:true})};
 const remote={get:async()=>copy(snapshot),matches:(s,o)=>o.kind==='file'?fileMatches(s,o):o.kind==='text'?s.textDeliveries.includes(o.value):o.kind==='progress'?s.agentProgress===o.value.message&&s.agentStatus===o.value.status:s.done&&s.agentStatus===4,write:async(id,o)=>{writes.push(copy(o));if(o.kind==='text')snapshot.textDeliveries.push(o.value);else if(o.kind==='progress'){snapshot.agentProgress=o.value.message;snapshot.agentStatus=o.value.status;}else{snapshot.done=true;snapshot.agentStatus=4;}}};
 remote.prepareFile=(a,g)=>grantFor(a,g);remote.upload=async(id,a)=>{const receipt={guid:'attachment-'+a.id,name:a.name,size:a.bytes,resource:{id,type:'task_delivery'}};snapshot.attachments.push(receipt);writes.push({kind:'file',value:a});return receipt};
 const make=()=>new Bridge({store,targets,remote,uuid:()=>`key-${++n}`});const b=make();await b.load();
 const event={id:'event-1',appId:'app',guid:'task-1',isCreate:true,baseline:100};
 const add=async(e=event)=>{await b.ingest(e);await b.refresh(e.appId+':'+e.id);};
 return{b,store,targets,remote,sends,writes,event,add,make,get data(){return data},get snap(){return snapshot},set snap(s){snapshot=s}};
}
const target={kind:'bot',id:'bot-1'};
async function assigned(f){await f.add();return f.b.dispatch('task-1',target)}
async function reported(f,artifacts=[]){const t=await assigned(f);return f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'已完成文字结果',verification:'仅单元测试',artifacts},'canonical-1');}
const rejects=(p,code)=>assert.rejects(p,e=>e.code===code);
test("已停止来源的迟到不存在事件不阻断恢复，其它错误保留待处理",async()=>{
 const f=await fixture();await assigned(f);await f.b.stop("task-1");
 const get=f.remote.get;f.remote.get=async()=>{throw Object.assign(Error(),{code:"FEISHU_API_1470404"})};
 await f.add({...f.event,id:"late-deleted",isCreate:false});
 assert.equal(f.data.events["app:late-deleted"].pending,false);
 assert.equal(f.data.events["app:late-deleted"].intake,"stopped_source_absent");
 assert.equal(f.b.task("task-1").orphanedDelivery,true);assert.equal(f.sends.length,1);
 await rejects(f.add({...f.event,id:"unknown",guid:"unknown"}),"FEISHU_API_1470404");
 assert.equal(f.data.events["app:unknown"].pending,true);
 f.remote.get=get;await f.add({...f.event,id:"next",guid:"next"});
 f.remote.get=async()=>{throw Object.assign(Error(),{code:"FEISHU_API_1470404"})};
 await rejects(f.add({...f.event,id:"active-missing",guid:"next"}),"FEISHU_API_1470404");
 assert.equal(f.data.events["app:active-missing"].pending,true);
 f.remote.get=async()=>{throw Object.assign(Error(),{code:"FEISHU_TRANSPORT_UNKNOWN"})};
 await rejects(f.add({...f.event,id:"offline"}),"FEISHU_TRANSPORT_UNKNOWN");
 assert.equal(f.data.events["app:offline"].pending,true);
});
test('三次重复事件只保存一次，重复派发返回同一回执',async()=>{const f=await fixture();await Promise.all([f.b.ingest(f.event),f.b.ingest(f.event),f.b.ingest(f.event)]);assert.equal(Object.keys(f.data.events).length,1);await f.b.refresh('app:event-1');await f.b.dispatch('task-1',target);await f.b.dispatch('task-1',target);assert.equal(f.sends.length,1);});
test('无创建标识和基线前历史任务不自动接管',async()=>{const f=await fixture();await f.add({...f.event,isCreate:false});assert.equal(Object.keys(f.data.tasks).length,0);await f.add({...f.event,id:'old',baseline:300});assert.equal(Object.keys(f.data.tasks).length,0);});
test('持久化失败不接单、不派发',async()=>{const f=await fixture();f.store.save=async()=>{throw Error('disk full')};await assert.rejects(f.b.ingest(f.event));assert.equal(f.sends.length,0);assert.equal(Object.keys(f.b.state.events).length,0);});
test('Host接受后本地写回失败：重启沿用原requestKey及正文恢复',async()=>{const f=await fixture();await f.add();let accepted=false;const save=f.store.save;f.targets.send=async p=>{f.sends.push(copy(p));accepted=true;return{accepted:true,taskId:'canonical-1'}};f.store.save=async s=>{if(accepted)throw Error('crash');await save(s)};await assert.rejects(f.b.dispatch('task-1',target));f.store.save=save;const recovered=f.make();await recovered.load();await recovered.dispatch('task-1',target);assert.equal(f.sends.length,2);assert.deepEqual(f.sends[0],f.sends[1]);});
test('未知投递绝不重发或换伙伴',async()=>{const f=await fixture();f.targets.send=async p=>{f.sends.push(p);throw Object.assign(Error(),{code:'DELIVERY_UNCERTAIN'})};await assigned(f);await f.b.dispatch('task-1',target);assert.equal(f.sends.length,1);await rejects(f.b.dispatch('task-1',{kind:'bot',id:'other'}),'REQUEST_KEY_CONFLICT');});
test('伙伴失效不改投',async()=>{const f=await fixture();await f.add();f.targets.resolve=async()=>{throw Object.assign(Error(),{code:'TARGET_UNAVAILABLE'})};await rejects(f.b.dispatch('task-1',target),'TARGET_UNAVAILABLE');assert.equal(f.b.task('task-1').state,'pending');assert.equal(f.sends.length,0);});
test('每伙伴一个在途，其它任务保留待分配',async()=>{const f=await fixture();await assigned(f);await f.add({...f.event,id:'event2',guid:'task2'});await rejects(f.b.dispatch('task2',target),'TARGET_BUSY');assert.equal(f.b.task('task2').state,'pending');});
test('缺上下文或跨session报告拒绝',async()=>{const f=await fixture();const t=await assigned(f);const a={bindingId:t.bindingId,generation:1,sequence:1,message:'hello'};await rejects(f.b.report('progress',a,undefined),'SESSION_MISMATCH');await rejects(f.b.report('progress',a,'evil-session'),'SESSION_MISMATCH');});
test('旧代次、重复序号冲突、回退序号拒绝；合法重复无写入',async()=>{const f=await fixture();const t=await assigned(f);const a={bindingId:t.bindingId,generation:1,sequence:2,message:'hello'};await rejects(f.b.report('progress',{...a,generation:0},'canonical-1'),'STALE_GENERATION');await f.b.report('progress',a,'canonical-1');const rev=f.data.revision;assert.equal((await f.b.report('progress',a,'canonical-1')).duplicate,true);assert.equal(f.data.revision,rev);await rejects(f.b.report('progress',{...a,message:'changed'},'canonical-1'),'SEQUENCE_CONFLICT');await rejects(f.b.report('progress',{...a,sequence:1},'canonical-1'),'STALE_SEQUENCE');});
const artifact={id:'report',name:'report.pdf',bytes:12};
const grant={token:'host-issued-fixture',file_count:1,total_bytes:12,rel_paths:['report.pdf']};
const fileArgs=f=>({bindingId:f.b.task('task-1').bindingId,generation:1,artifactId:'report'});
test('文字结果自动回报摘要、验证范围、进度及完成状态，无确认关卡',async()=>{const f=await fixture();await reported(f);assert.equal(f.b.task('task-1').state,'done');assert.deepEqual(f.writes.map(x=>x.kind),['text','progress','complete']);assert(f.snap.textDeliveries[0].includes('验证范围：仅单元测试'));assert(f.b.task('task-1').outbox.every(x=>x.state==='verified'&&x.readbackEvidence));assert.equal(f.b.confirm,undefined);});
test('必须声明产物清单，不能用本机路径或占位字段冒充文件',async()=>{const f=await fixture();const t=await assigned(f);const a={bindingId:t.bindingId,generation:1,sequence:1,message:'done'};await rejects(f.b.report('result',a,'canonical-1'),'ARTIFACT_MANIFEST_REQUIRED');await rejects(f.b.report('result',{...a,artifacts:['/tmp/fake']},'canonical-1'),'ARTIFACT_INVALID');});
test('文件未上传不能完成，过户上传后独立读回再自动完成',async()=>{const f=await fixture();await reported(f,[artifact]);assert.equal(f.b.task('task-1').state,'write_blocked');assert.equal(f.b.task('task-1').error,'FILE_GRANT_REQUIRED');assert(!f.writes.some(x=>x.kind==='complete'));await f.b.deliverFile(fileArgs(f),'canonical-1',grant,'call-1');assert.equal(f.b.task('task-1').state,'done');assert.deepEqual(f.writes.map(x=>x.kind),['text','file','progress','complete']);assert(!JSON.stringify(f.data).includes(grant.token));});
test('文件过户错误及Host鉴权缺口保留产物且不发送上传',async()=>{const f=await fixture();await reported(f,[artifact]);await f.b.deliverFile(fileArgs(f),'canonical-1',{...grant,total_bytes:11},'call-1');assert.equal(f.b.task('task-1').error,'FILE_GRANT_MISMATCH');f.remote.prepareFile=()=>{throw Object.assign(Error(),{code:'HOST_UPLOAD_AUTH_UNAVAILABLE'})};await f.b.deliverFile(fileArgs(f),'canonical-1',grant,'call-1');assert.equal(f.b.task('task-1').error,'HOST_UPLOAD_AUTH_UNAVAILABLE');assert.equal(f.b.task('task-1').outbox[1].state,'prepared');assert.equal(f.writes.length,1);});
test('文件回传跨session和旧代次被拒',async()=>{const f=await fixture();await reported(f,[artifact]);await rejects(f.b.deliverFile(fileArgs(f),'other',grant,'call'),'SESSION_MISMATCH');await rejects(f.b.deliverFile({...fileArgs(f),generation:0},'canonical-1',grant,'call'),'STALE_GENERATION');});
test('上传结果未知，即使同名同大小附件出现也不冒认或重传',async()=>{const f=await fixture();await reported(f,[artifact]);const upload=f.remote.upload;f.remote.upload=async(...args)=>{await upload(...args);throw Error('timeout')};await f.b.deliverFile(fileArgs(f),'canonical-1',grant,'call');assert.equal(f.b.task('task-1').state,'write_uncertain');await f.b.deliverFile(fileArgs(f),'canonical-1',grant,'new-call');assert.equal(f.writes.filter(x=>x.kind==='file').length,1);assert(!f.writes.some(x=>x.kind==='complete'));});
test('附件回执已保存但读回失败，重启对账不重传',async()=>{const f=await fixture();await reported(f,[artifact]);let afterUpload=false;const get=f.remote.get;const upload=f.remote.upload;f.remote.upload=async(...args)=>{const r=await upload(...args);afterUpload=true;return r};f.remote.get=async()=>{if(afterUpload)throw Error('offline');return get()};await f.b.deliverFile(fileArgs(f),'canonical-1',grant,'call');assert.equal(f.b.task('task-1').state,'write_uncertain');f.remote.get=get;const recovered=f.make();await recovered.load();await recovered.reconcile('task-1');assert.equal(recovered.task('task-1').state,'done');assert.equal(f.writes.filter(x=>x.kind==='file').length,1);});
test('离线完成先保存全部结果，恢复后仅执行未写步骤',async()=>{const f=await fixture();const t=await assigned(f);const get=f.remote.get;f.remote.get=async()=>{throw Error('offline')};await f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'离线结果',artifacts:[]},'canonical-1');assert.equal(f.b.task('task-1').state,'write_failed');assert.equal(f.b.task('task-1').result.summary,'离线结果');assert.equal(f.writes.length,0);f.remote.get=get;await f.b.reconcile('task-1');assert.equal(f.b.task('task-1').state,'done');});
test('追加文字成功但超时：独立读回对账，不重复追加',async()=>{const f=await fixture();const write=f.remote.write;let first=true;f.remote.write=async(id,o)=>{await write(id,o);if(first){first=false;throw Error('timeout')}};await reported(f);assert.equal(f.b.task('task-1').state,'write_uncertain');await f.b.reconcile('task-1');assert.equal(f.b.task('task-1').state,'done');assert.equal(f.writes.filter(x=>x.kind==='text').length,1);});
test('外部写入未知且读回无证据，不再发送',async()=>{const f=await fixture();f.remote.write=async(id,o)=>{f.writes.push(o);throw Error('timeout')};await reported(f);await f.b.reconcile('task-1');assert.equal(f.writes.length,1);assert.equal(f.b.task('task-1').state,'write_uncertain');});
test('多人会签可回报结果但禁止未经验证的状态4',async()=>{const f=await fixture();f.snap.soleAppAssignee=false;await reported(f);assert.equal(f.b.task('task-1').error,'COMPLETION_MODE_UNVERIFIED');assert.deepEqual(f.writes.map(x=>x.kind),['text','progress']);});
test('改派/删除/要求变更后止写，保留结果，不复活任务',async()=>{for(const changed of [{assigned:false},{deleted:true},{description:'新要求'}]){const f=await fixture();const t=await assigned(f);Object.assign(f.snap,changed);await f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'done',artifacts:[]},'canonical-1');assert.equal(f.b.task('task-1').state,'stopped');assert.equal(f.writes.length,0);}});
test('回写各步骤前重新核对归属',async()=>{const f=await fixture();const write=f.remote.write;f.remote.write=async(id,o)=>{await write(id,o);f.snap.assigned=false};await reported(f);assert.equal(f.writes.length,1);assert.equal(f.b.task('task-1').state,'stopped');});
test('撤回回执不等于停止运行，伙伴占位保持',async()=>{const f=await fixture();await assigned(f);await f.b.cancel('task-1');assert.equal(f.b.task('task-1').state,'cancel_check');await f.add({...f.event,id:'event2',guid:'task2'});await rejects(f.b.dispatch('task2',target),'TARGET_BUSY');});
test('重复事件及自己的完成事件不改变已完成事实',async()=>{const f=await fixture();await reported(f);const revision=f.data.revision;await f.add();assert.equal(f.data.revision,revision);await f.add({...f.event,id:'completed',isCreate:false});assert.equal(f.b.task('task-1').state,'done');});
test('需补充独立于完成，回报真实阻塞且不写状态4',async()=>{const f=await fixture();const t=await assigned(f);await f.b.report('clarification',{bindingId:t.bindingId,generation:1,sequence:1,message:'需要数据源'},'canonical-1');assert.equal(f.b.task('task-1').state,'needs_input');assert.equal(f.snap.agentStatus,3);assert(!f.writes.some(x=>x.kind==='complete'));});
test('完成PATCH成功但读回暂失，完成事件不撤销原回写账本',async()=>{const f=await fixture();const get=f.remote.get;const write=f.remote.write;let block=false;f.remote.write=async(id,op)=>{await write(id,op);if(op.kind==='complete')block=true};f.remote.get=async()=>{if(block)throw Error('offline');return get()};await reported(f);assert.equal(f.b.task('task-1').state,'write_uncertain');block=false;await f.add({...f.event,id:'complete-event',isCreate:false});assert.equal(f.b.task('task-1').state,'write_uncertain');await f.b.reconcile('task-1');assert.equal(f.b.task('task-1').state,'done');assert.equal(f.writes.filter(x=>x.kind==='complete').length,1);});
test('重复完成报告仅对账未完成步骤，不重复写已完成成果',async()=>{const f=await fixture();const t=await assigned(f);const a={bindingId:t.bindingId,generation:1,sequence:1,message:'done',artifacts:[]};const get=f.remote.get;f.remote.get=async()=>{throw Error('offline')};await f.b.report('result',a,'canonical-1');f.remote.get=get;await f.b.report('result',a,'canonical-1');const count=f.writes.length;assert.equal(f.b.task('task-1').state,'done');assert.equal((await f.b.report('result',a,'canonical-1')).duplicate,true);assert.equal(f.writes.length,count);});
test('旧版结果缺产物清单不得自动完成，原任务补交后才推进',async()=>{const f=await fixture();await assigned(f);const next=structuredClone(f.b.state);next.tasks['task-1'].state='review';next.tasks['task-1'].result={summary:'旧成果',verification:'旧验证'};await f.b.save(next);await f.b.writeRemaining('task-1');assert.equal(f.b.task('task-1').error,'LEGACY_ARTIFACT_MANIFEST_REQUIRED');const t=f.b.task('task-1');await f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'旧成果',artifacts:[]},'canonical-1');assert.equal(f.b.task('task-1').state,'done');assert.equal(f.b.task('task-1').legacyResult.result.summary,'旧成果');});
test('队列释放后自动出队，忙时保留原伙伴且不会改派',async()=>{const f=await fixture();const t=await assigned(f);await f.add({...f.event,id:'second',guid:'task2'});await f.b.enqueue('task2',target);await rejects(f.b.enqueue('task2',{kind:'bot',id:'other'}),'CONNECTION_PARTNER_MISMATCH');await f.b.drain();assert.equal(f.sends.length,1);await f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'done',artifacts:[]},'canonical-1');f.snap.done=false;f.snap.agentStatus=1;await f.b.drain();assert.equal(f.sends.length,2);assert.equal(f.sends[1].target.id,target.id);});
test('来源停止不代表伙伴停止，未确认结束时不释放占位',async()=>{const f=await fixture();await assigned(f);await f.b.stop('task-1');await f.add({...f.event,id:'second',guid:'task2'});await f.b.enqueue('task2',target);await f.b.drain();assert.equal(f.sends.length,1);assert.equal(f.b.task('task2').state,'pending');});

test('连接伙伴约束覆盖入队和内部派发，旧无映射任务拒绝猜测',async()=>{
 const f=await fixture();await f.add();const other={kind:'bot',id:'other'};
 await rejects(f.b.enqueue('task-1',other),'CONNECTION_PARTNER_MISMATCH');
 await rejects(f.b.dispatch('task-1',other),'CONNECTION_PARTNER_MISMATCH');
 delete f.b.state.tasks['task-1'].partnerId;
 await rejects(f.b.dispatch('task-1',target),'CONNECTION_PARTNER_REQUIRED');assert.equal(f.sends.length,0);
});
test('接收时冻结伙伴：换伙伴后refresh及重启仍使用原映射，新事件使用新伙伴',async()=>{
 const f=await fixture();await f.b.ingest(f.event);f.b.state.connection.partnerId='next';await f.b.refresh('app:event-1');
 assert.equal(f.b.partnerTarget('task-1').id,target.id);await f.b.enqueue('task-1',target);
 const restored=f.make();await restored.load();await restored.drain();assert.equal(f.sends[0].target.id,target.id);
 await f.add({...f.event,id:'next-event',guid:'next-task'});assert.equal(f.b.partnerTarget('next-task').id,'next');
});
test('异应用事件拒绝，事件伪报伙伴不覆盖连接映射',async()=>{const f=await fixture();await rejects(f.b.ingest({...f.event,appId:'other'}),'EVENT_SCOPE_REJECTED');await f.b.ingest({...f.event,partnerId:'forged'});assert.equal(f.b.state.events['app:event-1'].partnerId,target.id);});

test('未关联伙伴拒绝接收；接收后自动入队，无需人工分配',async()=>{const f=await fixture();delete f.b.state.connection.partnerId;await rejects(f.b.ingest(f.event),'CONNECTION_PARTNER_REQUIRED');assert.equal(Object.keys(f.b.state.events).length,0);f.b.state.connection.partnerId=target.id;await f.add();await f.b.drain();assert.equal(f.sends.length,1);assert.equal(f.sends[0].target.id,target.id);});

test('宿主未接通委派审核时不投递，范围完整写进不可变信封',async()=>{
 const f=await fixture();await f.add();f.targets.capabilities=async()=>({delegation:{version:1,execution:false}});
 await rejects(f.b.dispatch('task-1',target),'HOST_DELEGATION_UNAVAILABLE');assert.equal(f.sends.length,0);
 f.targets.capabilities=async()=>({delegation:{version:1,execution:true}});await f.b.dispatch('task-1',target);
 assert(f.sends[0].delegation.task.includes(f.snap.description));assert(f.sends[0].delegation.task.includes('task-1'));
});
test('只有匹配原请求的Host结束回执才释放停止任务伙伴占位',async()=>{
 const f=await fixture();await assigned(f);await f.b.stop('task-1');
 const key=f.b.task('task-1').dispatch.requestKey;
 f.targets.cancel=async()=>({cancelled:true,settled:true,requestKey:'other',clientId:'plugin-target:one'});
 await f.b.settleStopped();assert.equal(f.b.task('task-1').orphanedDelivery,true);
 f.targets.cancel=async()=>({cancelled:true,settled:true,requestKey:key,clientId:'plugin-target:one'});
 await f.b.settleStopped();assert.equal(f.b.task('task-1').orphanedDelivery,false);
 await f.add({...f.event,id:'next',guid:'task2'});await f.b.drain();assert.equal(f.sends.length,2);
});

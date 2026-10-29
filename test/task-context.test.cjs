const {test}=require('node:test'),assert=require('node:assert/strict');
const {metadata,enrich,sourceLink}=require('../src/task-context.cjs');
const {schedule,midnight}=require('../src/task-schedule.cjs');
const {Bridge,initial}=require('../src/core.cjs');
const parent='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222',file='33333333-3333-4333-8333-333333333333',list='44444444-4444-4444-8444-444444444444';
const copy=x=>structuredClone(x);
async function fixture(extra={}){
 let now=1000,n=0,data={...initial(),connection:{appId:'app',partnerId:'bot'}},sends=[];
 const snapshots={[parent]:{title:'预约测试',description:'只做当前任务',createdAt:1,assigned:true,soleAppAssignee:true,done:false,textDeliveries:[],attachments:[],...metadata({}),...extra}};
 const store={load:async()=>copy(data),save:async s=>{data=copy(s)}};
 const targets={get:async()=>({found:false}),capabilities:async()=>({delegation:{version:1,execution:true,receiptQuery:true,settled:true}}),resolve:async p=>p.target,send:async p=>{sends.push(p);return{executionId:'plugin-target:execution',requestKey:p.requestKey,target:p.target,delivery:'queue',accepted:true,taskId:'session'}},cancel:async()=>({cancelled:false})};
 const remote={get:async id=>copy(snapshots[id]),matches:(s,o)=>o.kind==='text'?s.textDeliveries.includes(o.value):o.kind==='progress'?s.agentStatus===o.value.status&&s.agentProgress===o.value.message:s.done&&s.agentStatus===4,write:async(id,o)=>{const s=snapshots[id];if(o.kind==='text')s.textDeliveries.push(o.value);else if(o.kind==='progress'){s.agentStatus=o.value.status;s.agentProgress=o.value.message;}else{s.done=true;s.agentStatus=4;s.repeatRule='';}}};
 const make=()=>new Bridge({store,targets,remote,uuid:()=>String(++n),now:()=>now}),b=make();await b.load();
 const add=async(id=parent)=>{await b.ingest({id:'event'+ ++n,guid:id,appId:'app',isCreate:true,baseline:0});const key=Object.keys(b.state.events).at(-1);await b.refresh(key);};
 return {b,make,snapshots,sends,add,set now(n){now=n},get data(){return data}};
}
test('飞书全天日期按执行时区午夜，带时刻原值、0清除和循环due规则',()=>{
 const utc=Date.UTC(2026,9,30);assert.equal(midnight(utc,'Asia/Shanghai'),Date.UTC(2026,9,29,16));
 assert.equal(midnight(Date.UTC(2026,2,8),'America/New_York'),Date.UTC(2026,2,8,5));
 assert.equal(schedule({start:{timestamp:2000,isAllDay:false},due:{timestamp:3000,isAllDay:false},repeatRule:'FREQ=DAILY'},'Asia/Shanghai').notBefore,2000);
 assert.equal(schedule({due:{timestamp:3000,isAllDay:false},repeatRule:'FREQ=DAILY'},'Asia/Shanghai').notBefore,3000);
 assert.equal(schedule({due:{timestamp:3000,isAllDay:false}},'Asia/Shanghai').notBefore,null);
 assert.equal(metadata({start:{timestamp:'0',is_all_day:true}}).start,null);
 assert.throws(()=>metadata({start:{timestamp:'invalid',is_all_day:true}}),{code:'TASK_DATE_INVALID'});
});
test('预约持久化、重启恢复、到期复核延期，不提前派发且只派一次',async()=>{
 const f=await fixture({start:{timestamp:2000,isAllDay:false}});await f.add();assert.equal(f.b.task(parent).state,'scheduled');await f.b.drain();assert.equal(f.sends.length,0);
 f.now=2000;f.snapshots[parent].start.timestamp=3000;await f.b.drain();assert.equal(f.sends.length,0);assert.equal(f.b.task(parent).schedule.notBefore,3000);
 const restored=f.make();await restored.load();f.now=3000;await restored.drain();await restored.drain();assert.equal(f.sends.length,1);assert.equal(restored.task(parent).partnerId,'bot');assert(f.sends[0].text.includes('实际开工前先调用 report_progress'));
});
test('飞书复制的下一循环实例按GUID去重并等待下一期，不自行复制或立即连续执行',async()=>{
 const f=await fixture({due:{timestamp:1000,isAllDay:false},repeatRule:'FREQ=DAILY;INTERVAL=1'});await f.add();await f.b.drain();const t=f.b.task(parent);
 await f.b.report('result',{bindingId:t.bindingId,generation:1,sequence:1,message:'完成当前期',verification:'fixture',artifacts:[]},'session');assert.equal(f.b.task(parent).state,'done');assert.equal(f.b.task(parent).cycle.rule,'FREQ=DAILY;INTERVAL=1');
 f.snapshots[child]={...copy(f.snapshots[parent]),done:false,createdAt:1001,due:{timestamp:86401000,isAllDay:false},repeatRule:'FREQ=DAILY;INTERVAL=1'};await f.add(child);await f.add(child);await f.b.drain();assert.equal(f.sends.length,1);assert.equal(f.b.task(child).state,'scheduled');
});
test('循环缺日期、子任务资料不完整时保留待处理，不派发残缺任务',async()=>{
 for(const extra of [{repeatRule:'FREQ=DAILY'}, {contextErrors:[{section:'subtasks',code:'READ_FAILED'}]}]){const f=await fixture(extra);await f.add();await f.b.drain();assert.equal(f.sends.length,0);assert(f.b.task(parent).queueError);}
});
test('运行中源附件变化停止旧范围；结果附件不改变任务输入范围',async()=>{
 const f=await fixture({sourceAttachments:[{guid:file,name:'需求.pdf',bytes:10}]});await f.add();await f.b.drain();f.snapshots[parent].attachments=[{guid:'delivery'}];await f.add();assert.equal(f.b.task(parent).state,'delivered');f.snapshots[parent].sourceAttachments[0].bytes=20;await f.add();assert.equal(f.b.task(parent).state,'stopped');
});
test('原伙伴真实回报记录开始与阶段；接受投递不当成开始，重放不重复时间线',async()=>{
 const f=await fixture();await f.add();await f.b.drain();const t=f.b.task(parent);assert.equal(t.startedAt,undefined);
 const p={bindingId:t.bindingId,generation:1,sequence:1,message:'已开始读取资料'};await assert.rejects(f.b.report('progress',p,'other'),{code:'SESSION_MISMATCH'});await f.b.report('progress',p,'session');await f.b.report('progress',p,'session');assert.equal(f.b.task(parent).progressHistory.length,1);assert.equal(f.b.task(parent).startedAt,1000);assert.equal(f.snapshots[parent].agentStatus,2);
});
test('清单名称权限失败不伪造名称，子任务分页完整，不混入其他父任务',async()=>{
 let pages=0;const s=metadata({tasklists:[{tasklist_guid:list}],subtask_count:2});
 const r=await enrich(s,async path=>{if(path.includes('tasklists'))throw Object.assign(Error(),{code:'FEISHU_API_99991672'});pages++;return{data:{items:[{guid:pages===1?child:file,parent_task_guid:parent,summary:'子任务',status:'todo'}],has_more:pages===1,page_token:'next'}};},parent);
 assert.equal(pages,2);assert.equal(r.subtasks.length,2);assert.equal(r.tasklists[0].nameState,'unavailable');assert.equal(r.contextErrors.length,0);
 const bad=await enrich(metadata({subtask_count:1}),async()=>({data:{items:[{guid:child,parent_task_guid:file}],has_more:false}}),parent);assert.equal(bad.contextErrors[0].code,'SUBTASK_SCOPE_MISMATCH');assert.equal(bad.subtasks.length,0);
});
test('源附件与交付附件严格区分，临时链接不接受跨任务或非HTTPS',()=>{
 const expected={guid:file,name:'资料.pdf',bytes:100};const attachment={guid:file,name:'资料.pdf',size:100,resource:{type:'task',id:parent},url:'https://example.feishu.cn/temporary'};
 assert.equal(sourceLink(attachment,expected,parent).name,'资料.pdf');for(const wrong of [{...attachment,resource:{type:'task_delivery',id:parent}},{...attachment,resource:{type:'task',id:child}},{...attachment,url:'file:///private/data'}])assert.throws(()=>sourceLink(wrong,expected,parent));
 const m=metadata({attachments:[{...attachment,file_token:'secret-token'}]});assert(!JSON.stringify(m).includes('secret-token'));assert(!JSON.stringify(m).includes('temporary'));
});

test('创建人只保存公开身份，刷新读到外部完成时停止旧执行范围',async()=>{
 assert.deepEqual(metadata({creator:{id:'ou_abc',type:'user',name:'同名用户',secret:'do-not-copy'}}).creator,{id:'ou_abc',type:'user',name:'同名用户'});
 const f=await fixture();await f.add();await f.b.drain();f.snapshots[parent].done=true;await f.b.inspect(parent);assert.equal(f.b.task(parent).state,'stopped');assert.equal(f.b.task(parent).generation,2);
});

test('创建人姓名按原应用和open_id读取，缓存隔离且不保留通讯录敏感字段',async()=>{
 const {enrichCreator}=require('../src/task-context.cjs');let calls=0;
 const creator={id:'ou_creator_fixture',type:'user',name:null};
 const request=async path=>{calls++;assert.equal(path,'/contact/v3/users/ou_creator_fixture?user_id_type=open_id');return{data:{user:{open_id:creator.id,name:'张三',mobile:'private-phone',email:'private-mail'}}};};
 const a=await enrichCreator(creator,request,'app-name-a');assert.equal(a.name,'张三');assert.equal(a.mobile,undefined);assert.equal(a.email,undefined);
 await enrichCreator(creator,request,'app-name-a');assert.equal(calls,1);await enrichCreator(creator,request,'app-name-b');assert.equal(calls,2);
});
test('姓名查询权限失败或身份错配不借用其他用户名称，不扩大任务查询范围',async()=>{
 const {enrichCreator}=require('../src/task-context.cjs');const c={id:'ou_scope_fixture',type:'user'};
 const denied=await enrichCreator(c,async()=>{throw Object.assign(Error(),{code:'FEISHU_API_99991672'});},'app-name-denied');assert.equal(denied.name,undefined);assert.equal(denied.error,'FEISHU_API_99991672');
 const mismatch=await enrichCreator(c,async()=>({data:{user:{open_id:'ou_other',name:'其他用户'}}}),'app-name-mismatch');assert.equal(mismatch.name,undefined);assert.equal(mismatch.error,'CREATOR_ID_MISMATCH');
 const external=await enrichCreator({id:'cli_other',type:'app'},async()=>{throw Error('must not query');},'cli_self');assert.equal(external.name,undefined);
});

test('预约到期但伙伴忙时转入等待队列，不误显示仍待开始或绕过占位',async()=>{
 const f=await fixture();await f.add();await f.b.drain();f.snapshots[child]={...structuredClone(f.snapshots[parent]),start:{timestamp:2000,isAllDay:false}};await f.add(child);assert.equal(f.b.task(child).state,'scheduled');await f.b.drain();assert.equal(f.b.task(child).state,'scheduled');
 f.now=2000;await f.b.drain();assert.equal(f.b.task(child).state,'pending');assert.equal(f.b.task(child).queueError,'TARGET_BUSY');assert.equal(f.sends.length,1);
});

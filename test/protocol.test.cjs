const {test}=require("node:test");const assert=require("node:assert/strict");const {spawn}=require("node:child_process");const {once}=require("node:events");const {action}=require("../src/feishu.cjs");const {Listener}=require("../src/listener.cjs");const {ListenerProxy}=require("../src/listener-proxy.cjs");const SDK=require("@larksuiteoapi/node-sdk");
const appId="cli_0000000000000000",guid="00000000-0000-0000-0000-000000000000";
const silent={debug(){},trace(){},info(){},warn(){},error(){}};
const response=body=>({ok:true,json:async()=>body});
test("Node协议拒绝畸形JSON、未知方法及无凭据请求，且不泄漏参数",async()=>{
 const child=spawn(process.execPath,["plugin/node/worker.cjs"],{stdio:["pipe","pipe","pipe"]});let out="",err="";child.stdout.on("data",x=>out+=x);child.stderr.on("data",x=>err+=x);
 child.stdin.end("bad json\n"+JSON.stringify({jsonrpc:"2.0",id:1,method:"unknown",params:{secret:"sensitive-example"}})+"\n"+JSON.stringify({jsonrpc:"2.0",id:2,method:"feishu/action",params:{action:"check",appId}})+"\n");
 await once(child,"exit");const rows=out.trim().split("\n").map(JSON.parse);assert.equal(rows.length,3);assert.equal(rows[0].error.code,-32700);assert.equal(rows[1].error.code,-32601);assert.equal(rows[2].error.message,"CONNECTION_REQUIRED");assert(!out.includes("sensitive-example"));assert.equal(err,"");
});
test("认证不冒充任务权限，固定域名且禁止跳转",async()=>{const requests=[];const r=await action({appId,action:"check"},"test-secret",async(url,init)=>{requests.push({url,init});return response({code:0,tenant_access_token:"test-token"})});assert.equal(r.authenticated,true);assert.equal(r.taskPermissionsVerified,false);assert.equal(requests[0].init.redirect,"error");assert(requests[0].url.startsWith("https://open.feishu.cn/"));assert(!JSON.stringify(r).includes("test-secret"));});
test("Node不接收无grant文件或评论写入，文件必须走Host过户通道",async()=>{for(const kind of ["attachment","comment"]){let calls=0;const mock=async()=>{calls++;return response(calls===1?{code:0,tenant_access_token:"token"}:{code:0,data:{task:{members:[{id:appId,type:"app",role:"assignee"}],status:"todo"}}})};await assert.rejects(action({appId,guid,action:"write",operation:{kind,value:"x"},expectedDescription:""},"secret",mock),e=>e.code==="WRITE_UNSUPPORTED");assert.equal(calls,2);}});
test("网络异常只输出固定错误，不泄漏原始凭据异常",async()=>{await assert.rejects(action({appId,action:"check"},"secret",async()=>{throw Error("secret-in-error")}),e=>e.code==="FEISHU_TRANSPORT_UNKNOWN"&&!e.message.includes("secret-in-error"));});
test("真实SDK等待业务Promise才ACK，失败返回500",async()=>{
 for(const failed of [false,true]){
  const client=new SDK.WSClient({appId,appSecret:"test-only",logger:silent});let resolve,reject;const barrier=new Promise((a,b)=>{resolve=a;reject=b});const sent=[];
  client.eventDispatcher=new SDK.EventDispatcher({logger:silent}).register({"task.task.update_user_access_v2":()=>barrier});
  client.dataCache.mergeData=()=>({schema:"2.0",header:{event_type:"task.task.update_user_access_v2"},event:{task_guid:guid}});client.sendMessage=x=>sent.push(x);
  try{const work=client.handleEventData({headers:[{key:"type",value:"event"}],payload:new Uint8Array()});await new Promise(r=>setImmediate(r));assert.equal(sent.length,0);failed?reject(Error("disk")):resolve({});await work;assert.equal(JSON.parse(new TextDecoder().decode(sent[0].payload)).code,failed?500:200);}finally{client.close({force:true});}
 }
});
test("监听处理器等main持久化确认，暂停清理待确认事件",async()=>{
 let dispatcher,closed=false;const notifications=[];class WS{async start(x){dispatcher=x.eventDispatcher;}getConnectionStatus(){return{state:"connected"}}close(){closed=true}}class D{register(x){this.handlers=x;return this}}
 const l=new Listener({WSClient:WS,EventDispatcher:D},(method,params)=>notifications.push({method,params}));const run=l.run({appId,durationMs:30000,baseline:100},"secret");await new Promise(r=>setImmediate(r));let done=false;
 const event=dispatcher.handlers["task.task.update_user_access_v2"]({app_id:appId,event_id:"e",task_guid:guid,create_time:"200",event_types:["task_create","task_assignees_update"]}).then(()=>{done=true});
 await new Promise(r=>setImmediate(r));assert.equal(done,false);assert.equal(notifications[0].params.event.eventAt,200);assert.equal(notifications[0].params.event.assigneesChanged,true);l.ack({token:notifications[0].params.token,accepted:true});await event;
 const pending=dispatcher.handlers["task.task.update_user_access_v2"]({app_id:appId,event_id:"e2",task_guid:guid,event_types:[]});const rejected=assert.rejects(pending,/LISTENER_STOPPED/);l.stop();await run;await rejected;assert(closed);assert.equal(l.pending.size,0);assert.equal(l.current,null);
});
test("子进程暂停等待真实退出，租期结束无存活进程",async()=>{
 let child;const start=async(entry,args)=>{assert.equal(entry,"node/listener.cjs");assert.deepEqual(args,[]);child=spawn(process.execPath,["-e","process.stdin.resume(); setInterval(()=>{},1000)"],{stdio:["pipe","pipe","pipe"]});return child};
 const proxy=new ListenerProxy(start,()=>{});const run=proxy.run({appId,durationMs:30000},"test-secret");await new Promise(r=>setImmediate(r));const pid=child.pid;proxy.stop();const result=await run;assert.equal(result.childExited,true);assert.equal(result.reason,"paused");assert.throws(()=>process.kill(pid,0),e=>e.code==="ESRCH");assert.equal(proxy.current,null);
});
test("缺Host childSpawn明确拒绝，不另起本机Node替代",async()=>{const p=new ListenerProxy(undefined,()=>{});await assert.rejects(p.run({appId},"secret"),e=>e.code==="HOST_CHILD_SPAWN_REQUIRED");});
test("租期到期回收真实测试socket及进程",async()=>{
 let child,port,ready;const opened=new Promise(r=>{ready=r});
 const source = '(' + function () { const net = require("node:net"); const s=net.createServer(); s.listen(0,"127.0.0.1",()=>process.stdout.write(JSON.stringify({method:"listener/status",params:{port:s.address().port}})+String.fromCharCode(10))); process.stdin.resume(); }.toString() + ')()';
 const proxy=new ListenerProxy(async()=>{child=spawn(process.execPath,["-e",source],{stdio:["pipe","pipe","pipe"]});return child},(method,params)=>{port=params.port;ready()});
 try {
  const run=proxy.run({appId,durationMs:1000},"test-secret");await opened;
  const result=await run;assert.equal(result.reason,"lease_expired");assert.equal(result.childExited,true);
  assert.throws(()=>process.kill(child.pid,0),e=>e.code==="ESRCH");
  await new Promise((resolve,reject)=>{const socket=require("node:net").connect(port,"127.0.0.1");socket.once("connect",()=>{socket.destroy();reject(Error("socket remained open"))});socket.once("error",e=>e.code==="ECONNREFUSED"?resolve():reject(e));});
 } finally { if(child?.exitCode===null&&!child.killed)child.kill(); }
});
test('飞书进度回写使用实际PATCH字段，快照暴露进度与产物供独立核验',async()=>{const requests=[];const task={summary:'title',description:'desc',status:'todo',members:[{id:appId,type:'app',role:'assignee'}],agent_task_status:2,agent_task_progress:'已开始',attachment_deliveries:[{guid:'g'}]};const fetcher=async(url,init)=>{requests.push({url,init});return response(url.includes('/auth/')?{code:0,tenant_access_token:'token'}:init.method==='PATCH'?{code:0}:{code:0,data:{task}})};await action({appId,guid,action:'write',expectedTitle:'title',expectedDescription:'desc',operation:{kind:'progress',value:{status:2,message:'已开始'}}},'secret',fetcher);const body=JSON.parse(requests.at(-1).init.body);assert.deepEqual(body.update_fields,['agent_task_progress','agent_task_status']);assert.deepEqual(body.task,{agent_task_progress:'已开始',agent_task_status:2});const snap=await action({appId,guid,action:'get'},'secret',fetcher);assert.equal(snap.agentProgress,'已开始');assert.equal(snap.attachments[0].guid,'g');});
test('应用任务基线分页完整；重复游标或缺页不能开启接收',async()=>{
 const urls=[];const items=[{guid:'old',members:[{id:appId,type:'app',role:'assignee'}]},{guid:'other',members:[{id:'other',type:'app',role:'assignee'}]}];
 let pages=0;const fetcher=async(url)=>{urls.push(url);return response(url.includes('/auth/')?{code:0,tenant_access_token:'token'}:{code:0,data:++pages===1?{items,has_more:true,page_token:'next'}:{items:[],has_more:false}})};
 const baseline=await action({appId,action:'assignment_baseline'},'synthetic',fetcher);assert.deepEqual(baseline.assigned,['old']);assert.equal(baseline.appId,appId);assert(Number.isSafeInteger(baseline.at));assert(urls.at(-1).includes('page_token=next'));
 await assert.rejects(action({appId,action:'assignment_baseline'},'synthetic',async url=>response(url.includes('/auth/')?{code:0,tenant_access_token:'token'}:{code:0,data:{items:[],has_more:true,page_token:'same'}})),{code:'BASELINE_PAGINATION_INVALID'});
});
test('文件上传凭据只传私有Host方法，任务撤销后零上传',async()=>{
 const upload={url:'https://open.feishu.cn/open-apis/task/v2/attachments/upload',method:'POST',uploadDir:{token:'granted-ticket',fields:{resource_type:'task_delivery',resource_id:guid}}};let assigned=true,sends=0;
 const fetcher=async url=>response(url.includes('/auth/')?{code:0,tenant_access_token:'private-token'}:{code:0,data:{task:{members:assigned?[{id:appId,type:'app',role:'assignee'}]:[],status:'todo'}}});
 const host={authenticatedFetch:async(request,authorization)=>{sends++;assert.equal(request,upload);assert.equal(authorization,'Bearer private-token');return{ok:true,status:200,body:'{}'}}};
 const result=await action({appId,action:'upload',request:upload},'synthetic',fetcher,host);assert.equal(result.ok,true);assert(!JSON.stringify(result).includes('private-token'));assigned=false;await assert.rejects(action({appId,action:'upload',request:upload},'synthetic',fetcher,host),{code:'SOURCE_REVOKED'});assert.equal(sends,1);
});

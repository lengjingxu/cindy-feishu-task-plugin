"use strict";
const { Bridge, fail } = require("./core.cjs");
const { ChannelBinding } = require("./channel-binding.cjs");
const { Activity } = require("./activity.cjs");
const { TestRunner } = require("./test-runner.cjs");
const { LeaseLoop } = require("./lease-loop.cjs");
const { Onboarding } = require("./onboarding.cjs");
const { AppProfile } = require("./app-profile.cjs");

const { GrantedUpload, fileMatches, verifiedArtifact } = require("./artifacts.cjs");
const errors = {
  AUTHORIZATION_BUSY: "请先完成或取消正在进行的授权。",
  APPLICATION_LIMIT: "最多添加 4 个应用，请先删除不用的连接。",
  APPLICATION_ALREADY_BOUND: "此应用已添加。",
  APPLICATION_DISCONNECTED: "应用已断开，请重新绑定。",
  APPLICATION_REQUIRED: "请选择应用。",
  CREDENTIAL_REMOVAL_UNVERIFIED: "删除结果待核实，请重试。",
  LEDGER_NOT_INITIALIZED: "账本尚未初始化，请在连接页初始化。",
  STORAGE_UNAVAILABLE: "宿主私有存储不可用或回执不符合契约。请保留数据并完成 Host 联调。",
  STORAGE_RESTART_REQUIRED: "上次持久化结果不确定，已停止写入。请重新打开插件核对账本。",
  FILE_GRANT_REQUIRED: "产物已登记但尚未上传。请从原伙伴任务使用 upload_result_file，并通过 ghost_call 顶层 dir 过户真实文件。",
  HOST_UPLOAD_AUTH_UNAVAILABLE: "当前 Cindy 缺少产物上传接口，文件已保留。",
  SESSION_MISMATCH: "报告来源与投递回执不一致，请从原关联任务提交。",
  TARGET_BUSY: "该伙伴仍有本插件在途任务，新任务继续等待该伙伴处理。",
  COMPLETION_MODE_UNVERIFIED: "多人负责人完成语义尚未验收，请在飞书人工确认。",
  CONNECTION_PARTNER_REQUIRED: "请在应用设置中关联处理伙伴，再开启任务接收。",
  CONNECTION_PARTNER_MISMATCH: "任务只能投递给接收时关联的执行伙伴。",
  HOST_DEVICE_CREDENTIAL_STORE_UNAVAILABLE: "当前 Cindy 缺少此插件的绑定接口。",
  TASK_PERMISSIONS_REQUIRED: "请先查询当前应用权限并开通缺少的项目。",
  TEST_TARGET_REQUIRED: "请明确选择本次专用测试的伙伴。",
  TEST_CLEANUP_REQUIRED: "上一次专用任务清理尚未核实，请先读取原任务确认。",
  QUEUED_TARGET_FROZEN: "此任务已排队等待原伙伴，不会自动改派。",
  ONBOARDING_TEST_REQUIRED: "首次接入闭环测试尚未通过，请先完成连接页步骤。",
  ACTIVE_BINDINGS_FROZEN: "仍有在途任务，应用和凭据绑定已冻结。请先处理原任务。",
  ACCOUNT_HAS_TASK_HISTORY: "当前账本仍有关联应用的任务历史，暂不支持切换应用；请保留原配置。",
  PROVISION_OUTCOME_UNKNOWN: "注册或订阅结果未知，已禁止重复提交。需核实上次回执。",
  CHECK_CONNECTION_FIRST: "请先检查应用认证，再开启接收。",
  ARTIFACT_NOT_READY: "文件尚未上传完成。",
  ARTIFACT_NOT_FOUND: "未找到该文件，请刷新任务。",
  ARTIFACT_SCOPE_MISMATCH: "文件信息已变化，请刷新任务后重试。",
  ARTIFACT_LINK_UNAVAILABLE: "暂时无法获取文件链接，请稍后重试。"
};
function error(e) { let code = e.code || "BRIDGE_FAILED"; if (["GHOST_NOT_FOUND", "GHOST_NAMESPACE_MISMATCH", "GHOST_ASLEEP", "GHOST_CRASHED", "TIMEOUT", "INTERNAL"].includes(code)) code = "BRIDGE_HOST_" + code; return { code, message: errors[code] || "操作未完成（" + code + "）。请保留现有记录，核对连接与任务状态后再处理。" }; }
function createApplication({id,slot,store,channel,rawNode,assertUnique,canOperate,dispatchGate}) {
const journal=store;
// The Node-held token reaches Host uploadDir over the private authenticated bridge.
const uploads = new GrantedUpload(req => node('feishu/action', {action:'upload',appId:bridge.state.connection?.appId,request:req},req.callId), () => connectionAuthenticated);
let hostServicesAvailable=false; let loading; let bridge; let onboarding; let appProfile; let channelBinding; let runner; let activity; let lease; let testMode=false; let testTimer; let receiving = false; let listenerState = "paused"; let listenerRun; let connectionAuthenticated = false; let draining=null;
let queueTimer;
function stopQueueTimer(){if(queueTimer!==undefined){clearTimeout(queueTimer);queueTimer=undefined;}}
function armQueueTimer(){
  stopQueueTimer();
  if(!receiving||testMode||!bridge)return;
  const now=Date.now();let due=Infinity;
  for(const t of Object.values(bridge.state.tasks)){
    // Never wake an attempted or unknown delivery for automatic re-send.
    if(!['pending','scheduled'].includes(t.state)||!t.queuedTarget||t.dispatch)continue;
    const eligibleAt=Math.max(t.schedule?.notBefore||0,t.nextAttemptAt||0);
    due=Math.min(due,eligibleAt>now?eligibleAt:now+60000);
  }
  if(due===Infinity)return;
  // Busy partners and failed reads must not turn overdue work into a hot loop.
  const delay=due>now?Math.min(due-now,60000):60000;
  queueTimer=setTimeout(()=>{queueTimer=undefined;tick().catch(e=>channel.postMessage({type:'error',error:error(e)}));},delay);
}
async function tick(){
  if(!receiving||testMode||!bridge)return;
  if(!draining){
    stopQueueTimer();
    draining=bridge.drain(()=>receiving&&!testMode).then(()=>channel.postMessage({type:'changed'})).finally(()=>{draining=null;armQueueTimer();});
  }
  return draining;
}
async function node(method, params, callId) {
  canOperate(method);
  const r = await rawNode({ method, params: {...params,credentialKey:slot}, ...(callId?{callId,cancelWithCall:true}:{}),timeoutMs: method === "listener/run" ? 75000 : 30000 });
  if (!r.ok) throw Object.assign(new Error("Node 请求失败"), { code: r.errorCode === "PROTOCOL_ERROR" && /^[A-Z][A-Z0-9_]{1,80}$/.test(r.message || "") ? r.message : "NODE_" + (r.errorCode || "REQUEST_FAILED") });
  if(r.result?.operationError)fail(r.result.operationError);
  return r.result;
}
async function ready() {
  if (bridge) return bridge;
  if (!loading) loading = (async () => {
    if (typeof cindy.targets?.list !== "function") fail("HOST_TARGETS_UNAVAILABLE");
    const b = new Bridge({ store: journal, targets: cindy.targets, uuid: () => crypto.randomUUID(), remote: {
      get: guid => node("feishu/action", { action: "get", guid, appId: b.state.connection?.appId }),
      write: (guid, operation) => node("feishu/action", { action: "write", guid, operation, appId: b.state.connection?.appId,
        expectedTitle: b.task(guid).snapshot.title, expectedDescription: b.task(guid).snapshot.description }),
      prepareFile: (artifact, grant) => uploads.prepare(artifact, grant),
      upload: (guid, artifact, grant, callId) => uploads.send(guid, artifact, grant, callId),
      matches: (snap, op) => op.kind === "file" ? fileMatches(snap, op) : op.kind === "text" ? snap.textDeliveries?.includes(op.value) :
        op.kind === "progress" ? snap.agentStatus === op.value.status && snap.agentProgress === op.value.message : snap.agentStatus === 4 && snap.done
    } });
    const dispatch=b.dispatch.bind(b);b.dispatch=(id,target)=>dispatchGate?dispatchGate(target,()=>dispatch(id,target)):dispatch(id,target);
    try{await b.load();}catch(e){if(e.code!=='LEDGER_NOT_INITIALIZED')throw e;await journal.initialize();await b.load();} channelBinding=new ChannelBinding(b); onboarding = new Onboarding(b, node); activity=new Activity(b,node);
    lease=new LeaseLoop(node,state=>{if(state==='ended'){receiving=false;stopQueueTimer();if(!['failed','paused'].includes(listenerState))listenerState='gap_check';}else listenerState=state;channel.postMessage({type:'changed'});});
    runner=new TestRunner(b,onboarding,{
      listen:async(appId,baseline,duration)=>{testMode=true;receiving=true;lease.start(appId,baseline,duration);await lease.waitReady();testTimer=setInterval(()=>runner.tick().catch(()=>{listenerState='attention';}),1000);},
      stop:async()=>{clearInterval(testTimer);await lease.stop();receiving=false;testMode=false;},
      create:r=>node('feishu/action',{action:'test_create',appId:r.appId,marker:r.marker}),
      absent:r=>node('feishu/action',{action:'test_absent',appId:r.appId,guid:r.guid}),
      remove:r=>node('feishu/action',{action:'test_delete',appId:r.appId,guid:r.guid,marker:r.marker})
    });
    const restored=await node('binding/restore',{});hostServicesAvailable=restored.hostServices===true;
    if(restored.saved){
      await assertUnique(restored.appId);
      if(b.state.connection?.appId&&b.state.connection.appId!==restored.appId)fail('APP_ID_MISMATCH');
      if(onboarding.state.identity.state!=='verified')await onboarding.authenticate(restored.appId);
      connectionAuthenticated=true;
    }
    bridge = b;
    appProfile=new AppProfile(b,node);
    return b;
  })().finally(() => { loading = null; });
  return loading;
}
function publicState() { return { tasks: Object.values(bridge.state.tasks).map(t => ({ ...t, ...(t.result ? { result: { ...t.result,
  artifacts: (t.result.artifacts || []).map(a => { let available = false; try { verifiedArtifact(t, a.id); available = true; } catch {} return { ...a, available }; }) } } : {}) })),
  connection: {appId:bridge.state.connection?.appId}, appProfile:bridge.state.appProfile, hostServicesAvailable, setupTask:bridge.state.setupTask, binding: channelBinding.state, onboarding: onboarding.state, testRun: bridge.state.testRun, receiving, listenerState, connectionAuthenticated,
  limitation: "普通文件交付、安装后身份对齐与断线补收尚待验收。" }; }
async function receive() {
  if (receiving) return;
  const b = await ready(); onboarding.assertReady(); if (!connectionAuthenticated) fail("CHECK_CONNECTION_FIRST");
  await b.assertExecution();
  const inventory=await node('feishu/action',{action:'assignment_baseline',appId:b.state.connection.appId});
  await b.serial(async () => { const next = JSON.parse(JSON.stringify(b.state));
    next.connection.baseline=inventory.at;next.connection.assignmentBaseline=inventory;next.connection.receivingRequested=true;await b.save(next); });
  receiving = true; lease.start(b.state.connection.appId,b.state.connection.baseline,Infinity);
  listenerRun=lease.promise;
  try{await lease.waitReady();await tick();}catch(e){receiving=false;stopQueueTimer();await lease.stop();listenerState="failed";throw e;}

}
async function ui(action, args = {}) {
  if (action === "initialize") { await journal.initialize(); await ready(); return publicState(); }
  const b = await ready();
  if (action !== "state" && action !== "targets") canOperate(action);
  if (action === "restore-binding") {
    if (!connectionAuthenticated) {
      const restored=await node("binding/restore",{});
      hostServicesAvailable=restored.hostServices===true;
      if(restored.saved){
        await assertUnique(restored.appId);
        if(b.state.connection?.appId && b.state.connection.appId!==restored.appId)fail("APP_ID_MISMATCH");
        if(onboarding.state.identity.state!=="verified")await onboarding.authenticate(restored.appId);
        connectionAuthenticated=true;
      }
    }
    return publicState();
  }
  if (action === "state") return publicState();
  if(action==='inspect-task'){await b.inspect(args.id);return publicState();}
  if(action==='source-attachment-link'){const task=b.task(args.id);if(task.appId!==b.state.connection?.appId)fail('APP_ID_MISMATCH');return node('feishu/action',{action:'source_attachment_link',appId:task.appId,guid:task.id,attachmentGuid:args.attachmentGuid});}
  if (action === "artifact-link") {
    const task = b.task(args.id);
    const artifact = verifiedArtifact(task, args.artifactId);
    if (task.appId !== b.state.connection?.appId) fail("APP_ID_MISMATCH");
    return node("feishu/action", { action: "attachment_link", appId: b.state.connection.appId, guid: task.id, artifact });
  }
  if (action === "begin-binding") {
    if(receiving)fail("PAUSE_FIRST");
    if(onboarding.hasBindings())fail("ACTIVE_BINDINGS_FROZEN");
    return {ready:true};
  }
  if (action === "binding-complete") {
    const restored=await node("binding/restore",{});
    if(!restored.saved)fail("AUTHORIZATION_FAILED");
    await assertUnique(restored.appId);await onboarding.authenticate(restored.appId);connectionAuthenticated=true;await onboarding.inspect();
    return publicState();
  }

  if (action === "select-partner" || action === "select-channel-owner") { if(receiving)fail("PAUSE_FIRST"); await channelBinding.select(args.target);return publicState(); }
  if (action === "recover") {
    await runner.tick();
    for(const t of Object.values(b.state.tasks))if(t.state!=="stopped"&&(!t.snapshot?.contextVersion||t.snapshot?.creator?.type==="user"&&!t.snapshot.creator.name||t.snapshot?.tasklists?.some(x=>!x.name)))await b.inspect(t.id);
    for (const [key, event] of Object.entries(b.state.events)) if (event.pending && !event.testOnly) await b.refresh(key);
    for (const t of Object.values(b.state.tasks)) if (t.state === "dispatching" && t.id!==runner.run?.guid) await b.dispatch(t.id, t.dispatch.target);
    for (const t of Object.values(b.state.tasks)) if (t.id!==runner.run?.guid && ["writing", "write_failed", "write_uncertain", "write_blocked"].includes(t.state)) await b.reconcile(t.id);
    await runner.tick(); if(receiving&&!testMode)await tick(); return publicState();
  }
  if (action === "targets") return cindy.targets.list({ targetKind: "bot" });

  if (action === "connect") {
    if (receiving) fail("PAUSE_FIRST");
    connectionAuthenticated = false;
    await onboarding.authenticate(args.appId);
    connectionAuthenticated = true; return publicState();
  }
  if (action === "credentials-changing") { if(receiving) fail("PAUSE_FIRST"); await onboarding.invalidateCredentials(); connectionAuthenticated=false; return publicState(); }
  if (action === "inspect-assigned") return node("feishu/action",{action:"assigned_tasks",appId:b.state.connection.appId});
  if (action === "provision") { await onboarding.provision(args.kind,args.existing===true,args.retryRejected===true); return publicState(); }
  if (action === "associate") { if(receiving) fail("PAUSE_FIRST"); await onboarding.associate(args.mode,args.target); return publicState(); }
  if (action === "inspect-configuration") { await onboarding.inspect(); return publicState(); }
  if (action === "test-connection") { if(receiving)fail("PAUSE_FIRST"); await runner.start(args.target); return publicState(); }
  if (action === "cancel-test") { await runner.cancel(); return publicState(); }
  if (action === "receive") { await receive(); return publicState(); }
  if (action === "pause") {await b.serial(async()=>{const n=JSON.parse(JSON.stringify(b.state));n.connection.receivingRequested=false;await b.save(n);});receiving=false;stopQueueTimer();if(testMode)await runner.cancel();else await lease.stop();await draining; listenerState = "paused"; return publicState(); }

  if (action === "recover-task") {
    if(!receiving||testMode)fail("CHECK_CONNECTION_FIRST");
    if(!/^[a-f0-9-]{36}$/i.test(args.id||""))fail("TASK_GUID_INVALID");
    await b.recoverAssigned(args.id);await tick();return publicState();
  }
  if (action === "reconcile") return b.reconcile(args.id);
  if (action === "cancel") return b.cancel(args.id);
  fail("ACTION_UNSUPPORTED");
}
async function onMessage(msg) {
  if (msg.type === "event" && msg.name === "node-notification") {
    if (msg.method === "listener/status") { listenerState = msg.params.state; lease?.connection(listenerState);if(listenerState==='connected')try{await tick();}catch(e){channel.postMessage({type:'error',error:error(e)});}channel.postMessage({ type: "changed" }); }
    if (msg.method === "inbox/event") {
      const { token, event } = msg.params;
      try {
        const b = await ready();
        if (!receiving || event.appId !== b.state.connection?.appId) fail("EVENT_SCOPE_REJECTED");
        await b.ingest({...event,...(testMode?{testOnly:true,testRunId:runner.run?.id}:{})}); await node("listener/ack", { token, accepted: true });
        if(testMode) { await runner.tick(); }
        else {
          const t = await b.refresh(event.appId + ":" + event.id);
          if (t?.state === "pending") {
            await b.enqueue(t.id,b.partnerTarget(t.id));
          }
          await tick();
        }
      } catch (e) {
        // No successful ACK is issued on persistence failure. Do not change partner/key.
        listenerState = "attention"; channel.postMessage({ type: "error", error: error(e) });
      }
      channel.postMessage({ type: "changed" });
    }
    return;
  }
  if (msg.type !== "tool-call") return;
  try {
    const b = await ready(); canOperate(msg.tool); let result; const args = msg.args || {};
    if (msg.tool === "list_inbox") result = Object.values(b.state.tasks).slice(Math.max(0, args.offset || 0), Math.max(0, args.offset || 0) + 50);
    else if (msg.tool === "bind_application") {
      if(receiving)fail("PAUSE_FIRST");
      if(onboarding.hasBindings())fail("ACTIVE_BINDINGS_FROZEN");
      const r=await rawNode({method:slot==='account'?"binding/authorize":"binding/authorize"+slot.slice(7),params:{appId:args.appId,credentialKey:slot},callId:msg.callId,cancelWithCall:true,timeoutMs:120000,maxTotalMs:300000});
      if(!r.ok)fail("AUTHORIZATION_FAILED");
      result=r.result;await onboarding.authenticate(result.appId);connectionAuthenticated=true;await onboarding.inspect();
    }
    else if (msg.tool === "get_task") result = b.task(args.id);
    else if (msg.tool === "inspect_delivery") result = await b.inspectExecution(args.id);
    else if(msg.tool==='get_source_attachment'){
      const t=Object.values(b.state.tasks).find(t=>t.bindingId===args.bindingId);
      if(!t)fail('TASK_NOT_FOUND');if(t.targetTaskId!==args.session_context?.session_id)fail('SESSION_MISMATCH');if(t.generation!==args.generation)fail('STALE_GENERATION');
      if(!['delivered','running','needs_input'].includes(t.state))fail('REPORT_NOT_ACTIVE');
      result=await node('feishu/action',{action:'source_attachment_link',appId:t.appId,guid:t.id,attachmentGuid:args.attachmentGuid});
    }
    else if (msg.tool === "report_progress" || msg.tool === "submit_result" || msg.tool === "request_clarification")
      result = await b.report(msg.tool === "submit_result" ? "result" : msg.tool === "request_clarification" ? "clarification" : "progress", args, args.session_context?.session_id);
    else if (msg.tool === "append_task_activity") result=await activity.append(args,args.session_context?.session_id);
    else if (msg.tool === "upload_result_file") result = await b.deliverFile(args, args.session_context?.session_id, args.dir_deposit, msg.callId);
    else fail("TOOL_UNSUPPORTED");
    if(testMode)await runner.tick();else if(receiving)await tick();
    await cindy.send({ type: "tool-result", callId: msg.callId, ok: true, result });
    channel.postMessage({ type: "changed" });
  } catch (e) { const err = error(e); await cindy.send({ type: "tool-result", callId: msg.callId, ok: false, errorCode: err.code, message: err.message }); }
 }
return {id,slot,ready,ui,onMessage,publicState,
 async resume(){await ready();if(bridge.state.connection?.receivingRequested)await receive();},
 async refreshProfile(){if(connectionAuthenticated)await appProfile.refresh();},
 get bridge(){return bridge},
 async prepareRemoval(){
  await ready();
  if(testMode)fail('TEST_ALREADY_ACTIVE');
  const wasReceiving=receiving;receiving=false;stopQueueTimer();if(wasReceiving)await lease.stop();await draining;listenerState='paused';
  await bridge.serial(async()=>{const n=JSON.parse(JSON.stringify(bridge.state));if(n.connection)n.connection.receivingRequested=false;await bridge.save(n);});
  await bridge.tail;
  if(onboarding.hasBindings()||Object.values(bridge.state.tasks).some(t=>!['done','stopped'].includes(t.state))||
    (runner.run?.guid&&runner.run.cleanup?.state!=='verified'))fail('ACTIVE_BINDINGS_FROZEN');
 },
 disconnected(){connectionAuthenticated=false;},
};
}
module.exports={createApplication,error};

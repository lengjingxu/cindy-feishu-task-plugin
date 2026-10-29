"use strict";
const { fail } = require("./core.cjs");
const base = "https://open.feishu.cn/open-apis";
async function jsonFetch(fetcher, path, init) {
  let r;
  try { r = await fetcher(base + path, { ...init, redirect: "error", signal: AbortSignal.timeout(15000) }); }
  catch { fail("FEISHU_TRANSPORT_UNKNOWN"); }
  let body; try { body = await r.json(); } catch { fail("FEISHU_RESPONSE_INVALID"); }
  if (!r.ok && !Number.isInteger(body.code)) fail("FEISHU_HTTP_" + r.status);
  if (body.code !== 0) {
    const error=Object.assign(new Error("FEISHU_API_"+String(body.code)),{code:"FEISHU_API_"+String(body.code)});
    // Only the subscription endpoint's bounded error description is retained;
    // auth responses, headers, credentials and task content never enter it.
    if(path.startsWith("/task/v2/task_v2/task_subscription"))error.subscriptionMessage=String(body.msg||"").slice(0,300).replace(/[A-Za-z0-9_-]{32,}/g,"[redacted]");
    throw error;
  }
  if (!r.ok) fail("FEISHU_HTTP_" + r.status);
  return body;
}
async function action(params, secret, fetcher = fetch, host = null) {
  if (!/^cli_[0-9a-f]{16}$/i.test(params.appId || "") || !secret) fail("CONNECTION_REQUIRED");
  const auth = await jsonFetch(fetcher, "/auth/v3/tenant_access_token/internal", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: params.appId, app_secret: secret }) });
  let token = auth.tenant_access_token;
  if (!token) fail("FEISHU_AUTH_INVALID");
  const request = (path, method = "GET", body) => jsonFetch(fetcher, path, { method,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    // Token acquisition is authentication only, never presented as task permission verification.
    if (params.action === "check") return { authenticated: true, taskPermissionsVerified: false };
    if(params.action==='app_profile'){
      const r=await request('/bot/v3/info');
      if(typeof r.bot?.app_name!=='string'||!r.bot.app_name.trim()||r.bot.app_name.length>512||!r.bot.open_id)fail('APP_PROFILE_INVALID');
      return {appId:params.appId,name:r.bot.app_name.trim(),source:'bot/v3/info'};
    }
    if(params.action==="scopes") return await require('./config-check.cjs').scopes(request);
    if(params.action==="versions") return await require('./config-check.cjs').versions(request,params.appId);
    if(params.action==='assignment_baseline') {
      const assigned=[],seen=new Set();let pageToken='';
      for(let page=0;page<1000;page++) {
        const q=new URLSearchParams({type:'my_tasks',page_size:'100'});if(pageToken)q.set('page_token',pageToken);
        const r=await request('/task/v2/tasks?'+q); const data=r.data;
        if(!Array.isArray(data?.items))fail('BASELINE_RESPONSE_INVALID');
        for(const t of data.items) if((t.members||[]).some(m=>m.type==='app'&&m.id===params.appId&&m.role==='assignee'))assigned.push(t.guid);
        if(!data.has_more)return {appId:params.appId,assigned:[...new Set(assigned)],at:Date.now()};
        if(!data.page_token||seen.has(data.page_token))fail('BASELINE_PAGINATION_INVALID');
        pageToken=data.page_token;seen.add(pageToken);
      }
      fail('BASELINE_TOO_LARGE');
    }
    if(params.action==='assigned_tasks') {
      const items=[];let pageToken='';const seen=new Set();
      for(let page=0;page<1000;page++){
        const q=new URLSearchParams({type:'my_tasks',page_size:'100'});if(pageToken)q.set('page_token',pageToken);
        const r=await request('/task/v2/tasks?'+q);const d=r.data;
        if(!Array.isArray(d?.items))fail('BASELINE_RESPONSE_INVALID');
        for(const t of d.items)if((t.members||[]).some(m=>m.type==='app'&&m.id===params.appId&&m.role==='assignee'))items.push({guid:t.guid,title:t.summary,status:t.status,createdAt:t.created_at,assignees:(t.members||[]).filter(m=>m.role==='assignee').map(m=>({id:m.id,type:m.type}))});
        if(!d.has_more)return {appId:params.appId,items};
        if(!d.page_token||seen.has(d.page_token))fail('BASELINE_PAGINATION_INVALID');seen.add(d.page_token);pageToken=d.page_token;
      }
      fail('BASELINE_TOO_LARGE');
    }
    if(params.action==='upload') {
      if(!host?.authenticatedFetch)fail('HOST_UPLOAD_AUTH_UNAVAILABLE');
      const u=params.request;
      if(u?.url!=='https://open.feishu.cn/open-apis/task/v2/attachments/upload'||u.method!=='POST'
        ||u.uploadDir?.fields?.resource_type!=='task_delivery')fail('UPLOAD_SCOPE_INVALID');
      const guid=u.uploadDir.fields.resource_id;
      if(!/^[a-f0-9-]{36}$/i.test(guid||''))fail('TASK_GUID_INVALID');
      const current=(await request('/task/v2/tasks/'+guid)).data?.task;
      if(!current||(current.members||[]).filter(m=>m.role==='assignee').length!==1
        ||!(current.members||[]).some(m=>m.type==='app'&&m.id===params.appId&&m.role==='assignee')
        ||current.status==='done')fail('SOURCE_REVOKED');
      return host.authenticatedFetch(u,'Bearer '+token);
    }
    if(params.action==="test_create") {
      if(!/^cindy-test-[a-f0-9-]{36}$/.test(params.marker||"")) fail("TEST_MARKER_INVALID");
      const r=await request('/task/v2/tasks','POST',{summary:params.marker,description:require('./test-spec.cjs').description(params.marker),client_token:params.marker,members:[{id:params.appId,type:'app',role:'assignee'}]});
      if(!/^[a-f0-9-]{36}$/i.test(r.data?.task?.guid||'')) fail('TEST_CREATE_RECEIPT_INVALID');
      return {guid:r.data.task.guid,marker:params.marker};
    }
    if(params.action==='test_absent') {
      if(!/^[a-f0-9-]{36}$/i.test(params.guid||'')) fail('TASK_GUID_INVALID');
      try{await request('/task/v2/tasks/'+params.guid);return {absent:false};}catch(e){if(e.code==='FEISHU_API_1470404')return {absent:true,code:1470404};throw e;}
    }
    if (params.action === "registration") {
      const r=await request("/task/v2/agent/register_agent","POST",{});
      if(r.data?.agent?.app_id!==params.appId) fail("REGISTRATION_RECEIPT_INVALID");
      return {verified:true,appId:params.appId,agent:{app_id:r.data.agent.app_id,app_name:r.data.agent.app_name},code:r.code};
    }
    if (params.action === "subscription") {
      let r;
      try { r=await request("/task/v2/task_v2/task_subscription?user_id_type=open_id","POST",{}); }
      catch(e){if(e.subscriptionMessage!==undefined)return {verified:false,appId:params.appId,error:e.code,detail:e.subscriptionMessage};throw e;}
      if(r.data?.code!==undefined && r.data.code!==0) fail("SUBSCRIPTION_RECEIPT_INVALID");
      return {verified:true,appId:params.appId,code:r.code,subscriptionAccepted:true};
    }
    if (!/^[0-9a-f-]{36}$/i.test(params.guid || "")) fail("TASK_GUID_INVALID");
    const path = "/task/v2/tasks/" + params.guid;
    const raw = await request(path); const t = raw.data?.task; if (!t) fail("FEISHU_TASK_INVALID");
    const assignees = (t.members || []).filter(m => m.role === "assignee");
    const assigned = assignees.some(m => m.type === "app" && m.id === params.appId);
    const snapshot = { title: t.summary, description: t.description || "", assigned, done: t.status === "done",
      soleAppAssignee: assigned && assignees.length === 1, textDeliveries: t.text_deliveries || [],
      agentStatus: t.agent_task_status, agentProgress: t.agent_task_progress, attachments: t.attachment_deliveries || [], revision: t.updated_at, createdAt: Number(t.created_at) };
    Object.assign(snapshot,require('./task-context.cjs').metadata(t));
    if(params.action==='test_delete') {
      if(!/^cindy-test-[a-f0-9-]{36}$/.test(params.marker||'')||t.summary!==params.marker||!snapshot.soleAppAssignee||t.description!==require('./test-spec.cjs').description(params.marker))fail('TEST_CLEANUP_SCOPE_MISMATCH');
      await request(path,'DELETE');return {deleted:true,guid:params.guid};
    }
    if(params.action==='activity_read') {
      if(!/^\d{1,30}$/.test(params.commentId||''))fail('COMMENT_ID_INVALID');
      const r=await request('/task/v2/comments/'+params.commentId);const c=r.data?.comment;
      if(!c||c.resource_id!==params.guid||c.resource_type!=='task')fail('COMMENT_SCOPE_MISMATCH');
      return {id:c.id,content:c.content,resourceId:c.resource_id};
    }
    if (params.action === "get") return await require('./task-context.cjs').enrich(snapshot,request,params.guid,params.appId);
    if(params.action==='source_attachment_link'){
      if(!assigned)fail('SOURCE_REVOKED');
      const expected=snapshot.sourceAttachments.find(a=>a.guid===params.attachmentGuid);
      if(!expected)fail('SOURCE_ATTACHMENT_NOT_FOUND');
      const r=await request('/task/v2/attachments/'+expected.guid);
      return require('./task-context.cjs').sourceLink(r.data?.attachment,expected,params.guid);
    }
    if (params.action === "attachment_link") {
      if (!assigned) fail("SOURCE_REVOKED");
      const a = params.artifact;
      if (!/^[a-f0-9-]{36}$/i.test(a?.guid || "")) fail("ARTIFACT_NOT_FOUND");
      if (!snapshot.attachments.some(item => item.guid === a.guid && item.name === a.name && item.size === a.bytes &&
          item.resource?.id === params.guid && item.resource?.type === "task_delivery")) fail("ARTIFACT_SCOPE_MISMATCH");
      const detail = await request("/task/v2/attachments/" + a.guid);
      return require("./artifacts.cjs").attachmentLink(detail.data?.attachment, a, params.guid);
    }
    if (!assigned || snapshot.done) fail("SOURCE_REVOKED");
    if(params.action==='activity_write') {
      if(params.expectedTitle!==snapshot.title||params.expectedDescription!==snapshot.description)fail('SOURCE_CHANGED');
      const op=params.operation;
      if(!op||typeof op.message!=='string'||!op.message.trim()||new TextEncoder().encode(op.message).length>3000)fail('ACTIVITY_INVALID');
      if(op.kind==='comment') {
        const r=await request('/task/v2/comments','POST',{resource_type:'task',resource_id:params.guid,content:op.message});const c=r.data?.comment;
        if(!c?.id||c.resource_id!==params.guid||c.resource_type!=='task')fail('COMMENT_RECEIPT_INVALID');
        return {id:c.id,resourceId:c.resource_id};
      }
      if(op.kind==='step' && Number.isSafeInteger(op.timestamp)&&op.timestamp>0&&op.timestamp<100000000000&&typeof op.key==='string') {
        await request('/task/v2/agent_task_step_info/append_task_steps','POST',{task_guid:params.guid,idempotent_key:op.key,task_steps:[{content:op.message,timestamp:op.timestamp}]});
        return {accepted:true,independentReadback:false};
      }
      fail('ACTIVITY_INVALID');
    }
    if (params.action !== "write") fail("ACTION_UNSUPPORTED");
    if (params.expectedTitle !== snapshot.title || params.expectedDescription !== snapshot.description) fail("SOURCE_CHANGED");
    let task; let fields;
    if (params.operation?.kind === "text" && typeof params.operation.value === "string") {
      if (snapshot.textDeliveries.includes(params.operation.value)) return { alreadyPresent: true };
      task = { text_deliveries: [...snapshot.textDeliveries, params.operation.value] }; fields = ["text_deliveries"];
    } else if (params.operation?.kind === "complete" && params.operation.value === 4) {
      if (!snapshot.soleAppAssignee) fail("COMPLETION_MODE_UNVERIFIED");
      task = { agent_task_status: 4 }; fields = ["agent_task_status"];
    } else if (params.operation?.kind === "progress" && [2, 3].includes(params.operation.value?.status) && typeof params.operation.value.message === "string") {
      task = { agent_task_progress: params.operation.value.message, agent_task_status: params.operation.value.status };
      fields = ["agent_task_progress", "agent_task_status"];
    } else fail("WRITE_UNSUPPORTED");
    await request(path, "PATCH", { task, update_fields: fields });
    return { written: true, requiresReadback: true };
  } finally { token = undefined; secret = undefined; }
}
module.exports = { action };

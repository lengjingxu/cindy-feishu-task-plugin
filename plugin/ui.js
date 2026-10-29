'use strict';
let bindingFlow=null,application=null,removing=null,editingPartner=false;
const taskKey=t=>t.applicationId?t.applicationId+':'+t.id:t.id;
function currentApplication(){return state.applications?.find(a=>a.id===application)||state;}
function appArgs(){return application?{applicationId:application}:{};}
const channel=new BroadcastChannel('feishu-task-bridge-v1');
const pending=new Map();let page=document.body.dataset.settingsOnly?'connection':'tasks',state={tasks:[],connection:{}},targets=[],selected=null,detail=false,query='',filter='all',busy=false;
const app=document.querySelector('#app'),notice=document.querySelector('#notice');
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={pending:'等待伙伴处理',dispatching:'投递待核实',delivered:'已投递',running:'执行中',review:'需补交产物清单',needs_input:'需补充',write_blocked:'回报受阻',writing:'回写中',write_uncertain:'回写待核实',write_failed:'回写失败',uncertain:'投递待核实',done:'已完成',stopped:'来源已变更',cancel_check:'撤回待核实'};
const formatBytes=bytes=>bytes>=1048576?(bytes/1048576).toFixed(1)+' MB':bytes>=1024?(bytes/1024).toFixed(1)+' KB':bytes+' 字节';
const button=(label,action)=>'<button data-action="'+action+'">'+label+'</button>';
async function request(action,args={}){
 const wake=await fetch('/wake');if(!wake.ok)throw new Error('无法唤醒插件，请检查是否已启用。');
 const reqId=crypto.randomUUID();const msg={type:'request',reqId,action,args};
 return new Promise((resolve,reject)=>{const timer=setInterval(()=>channel.postMessage(msg),500);const timeout=setTimeout(()=>{clearInterval(timer);pending.delete(reqId);reject(new Error('操作结果未知，请刷新核对；不要重复提交。'));},action==='authorize-binding'?310000:45000);pending.set(reqId,{resolve,reject,timer,timeout});channel.postMessage(msg);});
}
channel.onmessage=({data})=>{
 if(data.type==='binding-authorization'&&bindingFlow&&data.token===bindingFlow.token){
  try{const url=new URL(data.url);if(url.protocol!=='https:'||url.hostname!=='open.feishu.cn'||url.username||url.password)throw Error('url');bindingFlow.url=url.href;render();}catch{notice.textContent='授权链接无效。';}return;
 }

 const p=pending.get(data.reqId);if(p){clearInterval(p.timer);clearTimeout(p.timeout);pending.delete(data.reqId);data.ok?p.resolve(data.result):p.reject(Object.assign(new Error(data.error.message),{code:data.error.code}));}
 if(data.type==='error')notice.textContent=data.error.message;
 if(data.type==='changed'&&!busy)refresh().catch(e=>notice.textContent=e.message);
};
window.addEventListener('pagehide',()=>{bindingFlow?.control.abort();for(const p of pending.values()){clearInterval(p.timer);clearTimeout(p.timeout);}pending.clear();channel.close();});
function options(id=''){return '<option value="">选择伙伴</option>'+targets.map(t=>'<option value="'+esc(t.id)+'" '+(t.id===id?'selected':'')+'>'+esc(t.label)+'</option>').join('');}
function applicationLabel(view){
 const profile=view.appProfile;
 if(profile?.appId===view.connection?.appId&&typeof profile?.name==='string'&&profile.name.trim())return profile.name.trim();
 const agent=view.onboarding?.registration?.receipt?.agent;
 const name=agent?.app_id===view.connection?.appId && typeof agent?.app_name==='string'?agent.app_name.trim():'';
 return name || (view.connection?.appId?'飞书应用':'待绑定应用');
}
function partnerLabel(id){if(!id)return '未关联伙伴';const t=targets.find(x=>x.id===id);return t?t.label:'伙伴暂不可用';}
function render(){
 const focused=document.activeElement;const focusId=focused?.id,focusTask=focused?.dataset?.task,focusHeading=focused?.matches?.('.task-heading h1');
 document.querySelectorAll('[data-page]').forEach(b=>b.setAttribute('aria-current',b.dataset.page===page?'page':'false'));
 if(page==='tasks'){
  renderTasks();
 }else{
  if(state.applications && !application){
   app.innerHTML='<div class="toolbar"><h2>应用设置</h2>'+button('添加飞书应用','add-application')+'</div><section class="list">'+state.applications.map(a=>'<button class="item" data-application="'+esc(a.id)+'"><strong>'+esc(applicationLabel(a))+'</strong><small>'+esc(a.binding?.partnerId?partnerLabel(a.binding.partnerId):'未选择伙伴')+' · '+esc(a.status==='disconnected'?'已解除绑定':a.status==='deleting'||a.status==='disconnecting'?'移除待完成':a.receiving?'接收中':a.onboarding?.test?.state==='passed'?'已连接':'待设置')+'</small></button>').join('')+'</section>';
  }else{
  const view=currentApplication();
  const binding=view.binding||{}, onboarding=view.onboarding||{};
  let content;
  if(removing){
   content='<h3>'+esc(removing==='delete'?'删除此应用连接？':'解除此应用绑定？')+'</h3><div class="actions">'+button('取消','cancel-removal')+button('确认','confirm-removal')+'</div>';
  }else if(['deleting','disconnecting'].includes(view.status)){
   content='<h3>完成移除</h3>'+button('重试','finish-removal');
  }else if(bindingFlow){
   content='<h3>绑定飞书应用</h3>'+(bindingFlow.url?'<canvas id="binding-qr" aria-label="飞书应用授权二维码"></canvas><div class="actions"><a class="button" href="'+esc(bindingFlow.url)+'" rel="noreferrer" referrerpolicy="no-referrer">打开飞书授权</a>'+button('取消','cancel-binding')+'</div>':'<p role="status">正在获取二维码…</p>'+button('取消','cancel-binding'));
  }else if(view.status==='disconnected'){
   content='<h3>应用已断开</h3>'+button('重新绑定','bind');
  }else if(['running','cleanup_pending','cleanup_uncertain'].includes(view.testRun?.state)){
   const stage={create:'创建测试任务',event:'等待飞书事件',dispatch:'交给伙伴',result:'伙伴执行中',cleanup:'清理测试任务'}[view.testRun.stage]||'正在验证';
   content='<h3>验证应用连接</h3><p role="status">'+esc(stage)+'</p>'+button('取消测试','cancel-test');
  }else if(view.needsInitialization){
   content='<h3>添加飞书应用</h3>'+button('开始设置','initialize');
  }else if(onboarding.identity?.state!=='verified'){
   content='<h3>添加飞书应用</h3>'+button('绑定飞书应用','bind');
  }else if(!binding.partnerId||editingPartner){
   content='<h3>关联处理伙伴</h3><label>处理伙伴<select id="connection-partner">'+options()+'</select></label><div class="actions">'+button('保存执行伙伴','select-partner')+'</div>';
  }else if(onboarding.permissions?.state==='verified' && onboarding.registration?.state!=='verified' && onboarding.registration?.runtime?.state!=='verified'){
   content='<h3>注册任务身份</h3>'+(onboarding.registration?.state==='unverified'||!onboarding.registration?'<div class="actions">'+button('注册任务身份','register-agent')+button('验证已有身份','test-connection')+'</div>':'<p role="status">注册结果待核实</p>');
  }else if(onboarding.permissions?.state==='verified' && onboarding.subscription?.state!=='verified' && onboarding.subscription?.runtime?.state!=='verified'){
   content='<h3>订阅任务事件</h3>'+(onboarding.subscription?.state==='unverified'||!onboarding.subscription?button('订阅任务事件','subscribe-agent'):'<p role="status">订阅结果待核实</p>');
  }else if(onboarding.test?.state!=='passed'){
   content='<h3>验证应用连接</h3><p>处理伙伴：'+esc(partnerLabel(binding.partnerId))+'</p>'+(view.testRun?.error?'<p role="status">验证未通过</p>':'')+(onboarding.permissions?.state!=='verified'?'<div class="actions">'+button('检查应用权限','inspect-configuration')+button('更新授权','bind')+'</div>':button('开始连接测试','test-connection'));
  }else{
   content='<h3>应用连接</h3><p>处理伙伴：'+esc(partnerLabel(binding.partnerId))+'</p><p>'+esc(view.receiving?'正在接收任务':'任务接收已暂停')+'</p>'+button(view.receiving?'暂停接收':'开启接收',view.receiving?'pause':'receive');
  }
  const hasList=Array.isArray(state.applications);
  const controls=!bindingFlow&&!removing&&!editingPartner&&!['running','cleanup_pending','cleanup_uncertain'].includes(view.testRun?.state);
  const management=controls&&hasList?'<div class="actions app-management">'+(view.binding?.partnerId&&view.status==='active'?button('更换伙伴','change-partner'):'')+(view.connection?.appId&&view.status==='active'&&!view.receiving?button('更新授权','bind'):'')+(view.connection?.appId&&view.status==='active'?button('解除绑定','disconnect-application'):'')+button('删除应用','delete-application')+'</div>':'';
  app.innerHTML=(hasList?button('返回应用列表','applications'):'')+'<h2>'+esc(applicationLabel(view))+'</h2><section class="section">'+content+'</section>'+management;
  }


 }
 app.querySelectorAll('button').forEach(b=>b.disabled=busy&&b.dataset.action!=='cancel-binding');
 if(bindingFlow?.url){const c=document.querySelector('#binding-qr');if(c)window.renderBindingQR(c,bindingFlow.url).catch(()=>{notice.textContent='二维码生成失败，请使用授权链接。';});}
 const search=document.querySelector('#search');if(search)search.oninput=e=>{query=e.target.value;const pos=e.target.selectionStart;render();document.querySelector('#search').focus();document.querySelector('#search').setSelectionRange(pos,pos);};
 const gb=document.querySelector('#group-by');if(gb)gb.onchange=e=>{grouping=e.target.value;render();};
 const pf=document.querySelector('#project-filter');if(pf)pf.onchange=e=>{projectFilter=e.target.value;render();};
 const f=document.querySelector('#filter');if(f)f.onchange=e=>{filter=e.target.value;render();};
 if(focusId)document.getElementById(focusId)?.focus();else if(focusTask)[...app.querySelectorAll('[data-task]')].find(x=>x.dataset.task===focusTask)?.focus();else if(focusHeading&&detail)app.querySelector('.task-heading h1')?.focus();
}
async function bindFromSettings(){
 const args=appArgs(),context=await request('begin-binding',args);
 const flow={url:null,token:context.token,applicationId:args.applicationId};bindingFlow=flow;render();
 try{
  await request('authorize-binding',{...args,token:context.token});
  if(bindingFlow===flow){await request('binding-complete',args);await refresh();}
 }finally{if(bindingFlow===flow)bindingFlow=null;await request('end-binding',{...args,token:context.token}).catch(()=>{});render();}
}
const detailLoads=new Map();
async function loadTask(t){if(!t||detailLoads.has(taskKey(t)))return;const key=taskKey(t);detailLoads.set(key,true);try{const r=await request('inspect-task',{id:t.id,...(t.applicationId?{applicationId:t.applicationId}:{})});state=r;render();}catch(e){if(detail&&selected===key)notice.textContent=e.message;}finally{detailLoads.delete(key);}}
async function refresh(){state=await request('state');render();}
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&detail){detail=false;render();[...document.querySelectorAll('[data-task]')].find(b=>b.dataset.task===selected)?.focus();}});
window.addEventListener('focus',()=>{if(!busy)refresh().catch(e=>notice.textContent=e.message);});
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;
 if(b.dataset.action==='cancel-binding'){const flow=bindingFlow;try{if(flow)await request('cancel-binding',{applicationId:flow.applicationId,token:flow.token});bindingFlow=null;notice.textContent='';await refresh();}catch(err){notice.textContent=err.message;}render();return;}
 if(busy)return;
 if(b.dataset.page){page=b.dataset.page;detail=false;if(page==='connection'){application=null;removing=null;editingPartner=false;}render();return;}
 if(b.dataset.application){application=b.dataset.application;removing=null;editingPartner=false;render();return;}
 if(b.dataset.task){selected=b.dataset.task;detail=true;render();document.querySelector('.task-heading h1')?.focus();const t=state.tasks.find(t=>taskKey(t)===selected);loadTask(t);return;}
 const action=b.dataset.action;if(!action)return;
 if(action==='back'){detail=false;render();[...app.querySelectorAll('[data-task]')].find(x=>x.dataset.task===selected)?.focus();return;}
 if(action==='applications'){application=null;editingPartner=false;removing=null;render();return;}
 if(action==='change-partner'){editingPartner=true;render();return;}
 if(action==='disconnect-application'||action==='delete-application'){removing=action==='delete-application'?'delete':'disconnect';render();return;}
 if(action==='cancel-removal'){removing=null;render();return;}
 const task=state.tasks.find(t=>taskKey(t)===selected);
 let args={id:task?.id};
 if(action==='source-attachment-link')args={id:task?.id,attachmentGuid:b.dataset.attachment};
 if(action==='artifact-link')args={id:task?.id,artifactId:b.dataset.artifact};
 if(action==='select-partner')args={target:{kind:'bot',id:document.querySelector('#connection-partner').value}};
 if(action==='select-channel-owner')args={target:{kind:'bot',id:document.querySelector('#channel-owner').value}};

 if(action==='connect')args={appId:document.querySelector('#app-id').value.trim()};
 if(action==='test-connection')args={target:{kind:'bot',id:currentApplication().binding.partnerId}};
 if(action==='register-agent')args={kind:'registration',existing:false};
 if(action==='subscribe-agent')args={kind:'subscription'};
 if(action==='associate')args={mode:document.querySelector('#association-mode').value,target:{kind:'bot',id:document.querySelector('#default-target').value}};
 args={...args,...appArgs(),...(task?.applicationId&&['artifact-link','source-attachment-link','refresh-task','reconcile','cancel'].includes(action)?{applicationId:task.applicationId}:{})};
 busy=true;notice.textContent='';render();
 try{
  if(action==='add-application'){const added=await request(action);application=added.applicationId;await refresh();return;}
  if(action==='confirm-removal'||action==='finish-removal'){
   const view=currentApplication();
   const r=await request('prepare-removal',{...appArgs(),mode:action==='confirm-removal'?removing:view.status==='deleting'?'delete':'disconnect'});
   if(!/^account[234]?$/.test(r.credentialKey))throw new Error('应用连接无效');
   await request('finish-removal',appArgs());removing=null;application=null;await refresh();return;
  }
  if(action==='bind'){await bindFromSettings();notice.textContent='';return;}
  if(action==='artifact-link'||action==='source-attachment-link'){
   const result=await request(action,args);const url=new URL(result.url);
   if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))throw new Error('文件链接无效，请重试。');
   const link=document.createElement('a');link.href=url.href;link.rel='noreferrer';link.referrerPolicy='no-referrer';document.body.append(link);link.click();link.remove();notice.textContent='';return;
  }
  await request(['register-agent','subscribe-agent'].includes(action)?'provision':action==='refresh-task'?'inspect-task':action==='refresh'?'recover':action,args);if(action==='initialize'||action==='refresh'){const r=await request('targets');targets=r.targets;}notice.textContent='';if(action==='select-partner')editingPartner=false;await refresh();}
 catch(err){notice.textContent=err.name==='AbortError'?'':err.message;if(['confirm-removal','finish-removal'].includes(action)){removing=null;await refresh().catch(()=>{});}}finally{busy=false;render();}
});
(async()=>{try{state=await request('state');const r=await request('targets');targets=r.targets;render();}catch(e){state.needsInitialization=e.code==='LEDGER_NOT_INITIALIZED';notice.textContent=state.needsInitialization?'':e.message;page='connection';render();}})();

window.addEventListener('pagehide',()=>{if(bindingFlow)channel.postMessage({type:'request',reqId:crypto.randomUUID(),action:'cancel-binding',args:{applicationId:bindingFlow.applicationId,token:bindingFlow.token}});});

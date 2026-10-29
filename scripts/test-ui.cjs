const {chromium}=require('playwright');const fs=require('node:fs/promises');const assert=require('node:assert/strict');
(async()=>{
 await fs.mkdir('output/playwright',{recursive:true});await fs.mkdir('evidence',{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:true});let checks=0;const errors=[];
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('http://localhost/**',async route=>{const name=new URL(route.request().url()).pathname.slice(1)||'main-view.html';if(name==='wake')return route.fulfill({status:200,body:'{}'});if(!['main-view.html','settings.html','ui.css','ui.js','tasks.js','qr.js'].includes(name))return route.abort();await route.fulfill({status:200,contentType:name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html',body:await fs.readFile('plugin/'+name,'utf8')});});
  await page.addInitScript(()=>{
   window.bindingCancelled=0;
   const state={hostServicesAvailable:true,tasks:[{id:'task1',partnerId:'bot-original',state:'pending',snapshot:{title:'需要核对的项目周报与交付说明'.repeat(5),description:'这里是明确的任务要求。'.repeat(20)}},{id:'task2',state:'uncertain',snapshot:{title:'投递结果未知的任务',description:'不能换键重发'},dispatch:{target:{id:'bot1'}}}],connection:{},binding:{state:'unbound',partnerId:'bot1'},listenerState:'paused'};
   Object.assign(state.tasks[0].snapshot,{creator:{id:'user-a',type:'user',name:'张三'},tasklists:[{guid:'list-alpha',name:'客户方案'},{guid:'list-beta',name:'运营 <组>'}],start:{timestamp:1793404800000,isAllDay:true},due:{timestamp:1793491200000,isAllDay:false},repeatRule:'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',subtaskCount:1,subtasks:[{guid:'child',title:'整理客户访谈',done:false}],sourceAttachments:[{guid:'source-file',name:'访谈资料.pdf',bytes:2048}]});
   state.tasks.push({id:'scheduled-task',partnerId:'bot-original',state:'scheduled',schedule:{notBefore:1793404800000},snapshot:{title:'下一期客户复盘',creator:{id:'user-b',type:'user',name:'张三'},tasklists:[{guid:'list-alpha',name:'客户方案'}],repeatRule:'FREQ=WEEKLY;INTERVAL=1'}});
   state.tasks.push({id:'task3',state:'done',snapshot:{title:'已自动回报的任务',description:'完成'},result:{summary:'结果已自动回报',verification:'真实读回',artifacts:[{id:'a',name:'report.pdf',bytes:12,available:true}]}},{id:'task4',state:'write_blocked',error:'HOST_UPLOAD_AUTH_UNAVAILABLE',snapshot:{title:'产物鉴权阻塞',description:'保留文件'},result:{summary:'成果已保留',verification:'等待上传',artifacts:[{id:'a',name:'blocked.pdf',bytes:12}]}});window.openedFiles=[];HTMLAnchorElement.prototype.click=function(){window.openedFiles.push(this.href)};window.fixtureCalls=[];window.fixtureRequests=[];window.setFixtureTask=t=>{state.tasks=[t];};window.showRegisteredStep=()=>{state.onboarding={identity:{state:'verified'},permissions:{state:'verified'},registration:{state:'unverified'}};state.binding.partnerId='bot1';};window.showPartnerStep=()=>{state.onboarding={identity:{state:'verified'}};state.binding.partnerId=null;};
   window.removedSecrets=[];
   window.showMulti=()=>{state.applications=[{id:'first',credentialKey:'account',status:'active',connection:{appId:'cli_first'},appProfile:{appId:'cli_first',name:'业务应用 <一>',state:'verified'},binding:{partnerId:'bot-original'},hostServicesAvailable:true,onboarding:{identity:{state:'verified'},permissions:{state:'verified'},registration:{state:'verified'},subscription:{state:'verified'},test:{state:'passed'}}}];};
   window.markSecondPassed=()=>{const a=state.applications.find(x=>x.id==='second');a.onboarding={identity:{state:'verified'},permissions:{state:'verified'},registration:{state:'verified'},subscription:{state:'verified'},test:{state:'passed'}};};
   window.BroadcastChannel=class{postMessage(msg){if(msg.type!=='request')return;window.fixtureCalls.push(msg.action);window.fixtureRequests.push(structuredClone(msg));let result;const active=state.applications?.find(a=>a.id===msg.args.applicationId);
    if(msg.action==='add-application'){state.applications.push({id:'second',credentialKey:'account2',status:'active',connection:{},binding:{},hostServicesAvailable:true});result={applicationId:'second'};}
    else if(msg.action==='begin-binding'&&active)result={credentialKey:active.credentialKey,appId:active.connection.appId,token:'reservation'};
    else if(msg.action==='authorize-binding'){
     window.lastAuthUrl=active?.credentialKey||'account';
     queueMicrotask(()=>this.onmessage({data:{type:'binding-authorization',token:msg.args.token,url:'https://open.feishu.cn/page/launcher?user_code=fixture'}}));
     window.finishBindingFixture=()=>this.onmessage({data:{reqId:msg.reqId,ok:true,result:{appId:'cli_second'}}});
     window.cancelBindingFixture=()=>this.onmessage({data:{reqId:msg.reqId,ok:false,error:{message:'已取消',code:'CANCELLED'}}});return;
    }
    else if(msg.action==='cancel-binding'){window.bindingCancelled++;window.cancelBindingFixture();result={cancelled:true};}
    else if(msg.action==='binding-complete'&&active){active.status='active';active.connection={appId:'cli_second'};active.onboarding={identity:{state:'verified'}};result=state;}
    else if(msg.action==='select-partner'&&active){active.binding.partnerId=msg.args.target.id;result=state;}
    else if(msg.action==='prepare-removal'&&active){active.status=msg.args.mode==='delete'?'deleting':'disconnecting';result={credentialKey:active.credentialKey};}
    else if(msg.action==='finish-removal'&&active){if(active.status==='deleting')state.applications=state.applications.filter(a=>a!==active);else active.status='disconnected';result=state;}
    else if(msg.action==='state'||msg.action==='recover'||msg.action==='inspect-task')result=structuredClone(state);else if(msg.action==='source-attachment-link')result={url:'https://example.feishu.cn/source.pdf',name:'访谈资料.pdf'};else if(msg.action==='artifact-link')result={url:'https://example.feishu.cn/report.pdf?request='+window.fixtureCalls.length,name:'report.pdf'};else if(msg.action==='targets')result={targets:[{kind:'bot',id:'bot1',label:'测试伙伴'},{kind:'bot',id:'bot-original',label:'原伙伴'}]};else if(msg.action==='binding-complete'){state.onboarding={identity:{state:'verified'}};state.binding.partnerId=null;result=state;}else if(msg.action==='select-partner'){state.binding.partnerId=msg.args.target.id;result=state;}else result={};queueMicrotask(()=>this.onmessage({data:{reqId:msg.reqId,ok:true,result}}));}close(){}};
  });
  await page.goto('http://localhost/');await page.locator('[data-task=task1]').waitFor();assert.equal(await page.locator('.board-column').count(),5);checks++;
  const callsBeforeGrouping=await page.evaluate(()=>fixtureRequests.length);
  await page.locator('#group-by').selectOption('list');assert.equal(await page.locator('[data-task=task1]').count(),2);assert.equal(await page.locator('.board-column').count(),3);assert.equal(await page.locator('.board-column h2').filter({hasText:'运营 <组>'}).count(),1);checks+=3;
  await page.locator('#filter').selectOption('scheduled');assert.equal(await page.locator('.task-card').count(),1);checks++;
  await page.locator('#filter').selectOption('all');await page.locator('#project-filter').selectOption(':list-beta');assert.equal(await page.locator('.task-card').count(),2);checks++;
  await page.locator('#project-filter').selectOption('all');await page.locator('#group-by').selectOption('partner');assert.equal(await page.locator('.board-column').count(),3);assert.equal(await page.locator('[data-group=bot-original] .task-card').count(),2);checks+=2;
  await page.locator('#group-by').selectOption('creator');assert.equal(await page.locator('.board-column').count(),3);assert.equal(await page.locator('.board-column h2').filter({hasText:'张三'}).count(),2);checks+=2;
  assert.equal(await page.evaluate(()=>fixtureRequests.length),callsBeforeGrouping);checks++;
  await page.locator('[data-task=task1]').click();await page.getByText('创建人',{exact:true}).waitFor();await page.getByText('张三',{exact:true}).waitFor();assert.equal(await page.locator('.kanban').count(),0);checks++;
  await page.keyboard.press('Escape');assert.equal(await page.locator('#group-by').inputValue(),'creator');await page.waitForFunction(()=>document.activeElement?.dataset.task==='task1');checks+=2;
  for(const group of ['status','list','partner','creator']){await page.locator('#group-by').selectOption(group);await page.setViewportSize({width:390,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'output/playwright/group-'+group+'-390.png',fullPage:true});checks++;}
  await page.locator('#group-by').selectOption('status');
  for(const theme of ['light','dark']){
   await page.addStyleTag({content:theme==='dark'?':root{--panel-bg:#151515;--surface:#202020;--surface-elevated:#2c2c2a;--surface-chip:#333;--focus-ring:#888;--text-primary:#eee;--text-secondary:#aaa;--border-default:#444;color-scheme:dark}':':root{--panel-bg:#fafafa;--surface:#fff;--surface-elevated:#fff;--surface-chip:#eee;--focus-ring:#888;--text-primary:#222;--text-secondary:#666;--border-default:#ddd;color-scheme:light}'});
   for(const width of [320,390,768,1360]){
    await page.setViewportSize({width,height:900});await page.locator('[data-task=task1]').click();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
    await page.screenshot({path:`output/playwright/tasks-${theme}-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'返回任务列表'}).click();await page.screenshot({path:'output/playwright/board-'+theme+'-'+width+'.png',fullPage:true});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
    await page.getByRole('button',{name:'应用设置',exact:true}).click();await page.getByText('添加飞书应用').waitFor();checks++;assert.equal(await page.locator('#channel-owner').count(),0);assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.getByRole('button',{name:'开始专用测试'}).count(),0);checks++;
    await page.screenshot({path:`output/playwright/connection-${theme}-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'任务',exact:true}).click();
   }
  }
  await page.setViewportSize({width:320,height:900});await page.locator('[data-task=task2]').click();assert.equal(await page.getByRole('button',{name:'分配给关联伙伴'}).count(),0);checks++;
  await page.getByRole('button',{name:'返回任务列表'}).click();await page.locator('[data-task=task1]').click();assert.equal(await page.locator('#target').count(),0);await page.getByText('原伙伴',{exact:true}).waitFor();assert.match(await page.locator('.task-properties').innerText(),/原伙伴/);checks++;assert.equal(await page.locator('[data-action=dispatch]').count(),0);assert.equal((await page.evaluate(()=>fixtureCalls)).filter(x=>x==='dispatch').length,0);checks++;
  await page.getByRole('button',{name:'返回任务列表'}).click();await page.locator('[data-task=task3]').click();assert.equal(await page.getByRole('button',{name:'确认并回写'}).count(),0);await page.getByText('report.pdf',{exact:true}).waitFor();await page.getByText('12 字节',{exact:true}).waitFor();
  await page.getByRole('button',{name:'打开或下载 report.pdf',exact:true}).click();await page.waitForFunction(()=>openedFiles.length===1);
  await page.getByRole('button',{name:'打开或下载 report.pdf',exact:true}).click();await page.waitForFunction(()=>openedFiles.length===2);
  const opened=await page.evaluate(()=>openedFiles);assert.notEqual(opened[0],opened[1]);
  assert.deepEqual(await page.evaluate(()=>fixtureRequests.filter(r=>r.action==='artifact-link').map(r=>r.args)),[{id:'task3',artifactId:'a'},{id:'task3',artifactId:'a'}]);checks+=3;
  await page.getByRole('button',{name:'返回任务列表'}).click();await page.locator('[data-task=task4]').click();await page.getByText('文件回报受阻').waitFor();assert.equal(await page.getByRole('button',{name:/打开或下载/}).count(),0);checks++;assert.equal(await page.getByRole('button',{name:'确认并回写'}).count(),0);checks++;
  await page.getByRole('button',{name:'应用设置',exact:true}).click();await page.getByText('添加飞书应用').waitFor();checks++;assert.equal(await page.locator('#channel-owner').count(),0);assert.equal(await page.locator('input[type=password]').count(),0);checks++;
  assert.equal(await page.locator('#connection-partner').count(),0);assert.equal(await page.getByText('验证应用连接',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'绑定飞书应用',exact:true}).count(),1);assert(await page.getByRole('button',{name:'绑定飞书应用',exact:true}).isEnabled());checks++;await page.evaluate(()=>showPartnerStep());await page.getByRole('button',{name:'任务',exact:true}).click();await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('button',{name:'应用设置',exact:true}).click();await page.locator('#connection-partner').selectOption('bot1');await page.getByRole('button',{name:'保存执行伙伴',exact:true}).click();await page.waitForFunction(()=>fixtureCalls.includes('select-partner'));await page.getByText('验证应用连接',{exact:true}).waitFor();assert.equal(await page.locator('#connection-partner').count(),0);checks++;
  // Real Bridge state transitions with fixture transports; never a real Host/Feishu call.
  const {Bridge,initial}=require('../src/core.cjs');let uid=0,sent=0,writes=0;
  const snapshot={title:'自动处理测试',description:'应用任务自动交给关联伙伴',assigned:true,soleAppAssignee:true,done:false,createdAt:200,textDeliveries:[],attachments:[]};
  const bridge=new Bridge({store:{load:async()=>({...initial(),connection:{appId:'fixture-app',partnerId:'bot-original'}}),save:async()=>{}},uuid:()=>String(++uid),targets:{capabilities:async()=>({delegation:{version:1,execution:true}}),resolve:async p=>p.target,send:async p=>{assert.equal(p.target.id,'bot-original');sent++;return{accepted:true,taskId:'fixture-session'};}},remote:{get:async()=>structuredClone(snapshot),matches:(snap,op)=>op.kind==='text'?snap.textDeliveries.includes(op.value):op.kind==='progress'?snap.agentProgress===op.value.message&&snap.agentStatus===op.value.status:snap.done&&snap.agentStatus===4,write:async(id,op)=>{writes++;if(op.kind==='text')snapshot.textDeliveries.push(op.value);else if(op.kind==='progress'){snapshot.agentProgress=op.value.message;snapshot.agentStatus=op.value.status;}else{snapshot.done=true;snapshot.agentStatus=4;}}}});
  await bridge.load();await bridge.ingest({id:'event',appId:'fixture-app',guid:'auto-task',isCreate:true,baseline:100});await bridge.refresh('fixture-app:event');await bridge.drain();assert.equal(sent,1);
  await page.evaluate(t=>setFixtureTask(t),bridge.task('auto-task'));await page.getByRole('button',{name:'任务',exact:true}).click();await page.getByRole('button',{name:'刷新',exact:true}).click();await page.locator('[data-task=auto-task]').click();await page.getByText('原伙伴',{exact:true}).waitFor();assert.match(await page.locator('.task-properties').innerText(),/原伙伴/);checks++;assert.equal(await page.locator('[data-action=dispatch]').count(),0);checks++;
  const task=bridge.task('auto-task');await bridge.report('result',{bindingId:task.bindingId,generation:task.generation,sequence:1,message:'自动完成并回报',verification:'fixture独立读回',artifacts:[]},'fixture-session');assert.equal(bridge.task('auto-task').state,'done');assert(writes>0);
  await page.evaluate(t=>setFixtureTask(t),bridge.task('auto-task'));await page.getByRole('button',{name:'刷新任务',exact:true}).click();await page.getByText('已回报飞书',{exact:true}).waitFor();await page.getByText('自动完成并回报',{exact:true}).first().waitFor();checks++;
  assert.equal(await page.locator('nav [data-page]').count(),2);assert.equal(await page.locator('[data-page=rules],[data-action=dispatch]').count(),0);checks++;
  await page.goto('http://localhost/settings.html');await page.getByRole('button',{name:'绑定飞书应用',exact:true}).waitFor();assert.equal(await page.locator('nav').count(),0);assert.equal(await page.getByText(/尚无公开|此处不收取|未来待插件/).count(),0);checks++;
  await page.getByRole('button',{name:'绑定飞书应用',exact:true}).click();await page.locator('#binding-qr').waitFor();
  assert.equal(await page.getByRole('link',{name:'打开飞书授权'}).getAttribute('href'),'https://open.feishu.cn/page/launcher?user_code=fixture');
  assert.equal(await page.locator('#connection-partner').count(),0);checks++;
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'绑定飞书应用',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>bindingCancelled),1);assert.equal(await page.evaluate(()=>fixtureCalls.includes('bind')),false);checks++;
  await page.getByRole('button',{name:'绑定飞书应用',exact:true}).click();await page.locator('#binding-qr').waitFor();await page.evaluate(()=>finishBindingFixture());
  await page.getByRole('button',{name:'保存执行伙伴',exact:true}).waitFor();assert.equal(await page.locator('#binding-qr').count(),0);checks++;
  await page.evaluate(()=>showRegisteredStep());await page.evaluate(()=>refresh());
  await page.getByRole('button',{name:'验证已有身份',exact:true}).waitFor();checks++;
  await page.getByRole('button',{name:'验证已有身份',exact:true}).click();await page.waitForFunction(()=>fixtureCalls.includes('test-connection'));checks++;
  assert.deepEqual(await page.evaluate(()=>fixtureRequests.find(x=>x.action==='test-connection').args),{target:{kind:'bot',id:'bot1'}});assert.equal(await page.evaluate(()=>fixtureCalls.includes('provision')),false);checks++;
  await page.evaluate(()=>showMulti());await page.evaluate(()=>refresh());await page.getByRole('button',{name:'返回应用列表'}).count().then(async n=>{if(n)await page.getByRole('button',{name:'返回应用列表'}).click();});
  assert.match(await page.locator('[data-application=first]').innerText(),/业务应用 <一>/);assert.equal(await page.locator('[data-application=first] 一').count(),0);await page.locator('[data-application=first]').click();assert.equal(await page.locator('#app h2').innerText(),'业务应用 <一>');checks++;await page.getByRole('button',{name:'解除绑定',exact:true}).click();
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await page.evaluate(()=>removedSecrets),[]);checks++;
  await page.getByRole('button',{name:'返回应用列表'}).click();await page.getByRole('button',{name:'添加飞书应用',exact:true}).click();
  await page.getByRole('button',{name:'绑定飞书应用',exact:true}).click();await page.locator('#binding-qr').waitFor();assert.equal(await page.evaluate(()=>lastAuthUrl),'account2');assert.equal(await page.locator('#connection-partner').count(),0);checks++;
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'绑定飞书应用',exact:true}).waitFor();
  await page.getByRole('button',{name:'绑定飞书应用',exact:true}).click();await page.locator('#binding-qr').waitFor();await page.evaluate(()=>finishBindingFixture());
  await page.locator('#connection-partner').selectOption('bot1');await page.getByRole('button',{name:'保存执行伙伴',exact:true}).click();await page.getByRole('heading',{name:'验证应用连接'}).waitFor();checks++;
  assert.equal(await page.locator('#binding-qr').count(),0);assert.equal(await page.locator('#connection-partner').count(),0);checks++;
  await page.evaluate(()=>markSecondPassed());await page.evaluate(()=>refresh());
  await page.getByRole('button',{name:'解除绑定',exact:true}).click();await page.getByRole('button',{name:'确认',exact:true}).click();await page.locator('[data-application=second]').waitFor();
  assert.deepEqual(await page.evaluate(()=>removedSecrets),[]);checks++;
  await page.locator('[data-application=second]').click();await page.getByRole('button',{name:'重新绑定'}).click();await page.locator('#binding-qr').waitFor();checks++;
  await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'重新绑定'}).waitFor();
  await page.getByRole('button',{name:'返回应用列表'}).click();
  for(const theme of ['light','dark']){await page.addStyleTag({content:theme==='dark'?':root{--panel-bg:#151515;--surface:#202020;--surface-elevated:#2c2c2a;--surface-chip:#333;--focus-ring:#888;--text-primary:#eee;--text-secondary:#aaa;--border-default:#444;color-scheme:dark}':':root{--panel-bg:#fafafa;--surface:#fff;--surface-elevated:#fff;--surface-chip:#eee;--focus-ring:#888;--text-primary:#222;--text-secondary:#666;--border-default:#ddd;color-scheme:light}'});for(const width of [320,390,768,1360]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;await page.screenshot({path:'output/playwright/applications-'+theme+'-'+width+'.png',fullPage:true});}}
  await page.locator('[data-application=second]').click();await page.getByRole('button',{name:'删除应用',exact:true}).click();await page.getByRole('button',{name:'确认',exact:true}).click();await page.locator('[data-application=first]').waitFor();assert.equal(await page.locator('[data-application=second]').count(),0);assert.match(await page.locator('[data-application=first]').innerText(),/原伙伴/);checks++;
  assert.deepEqual(errors,[]);checks++;await fs.writeFile('evidence/ui-test.json',JSON.stringify({checks,errors,mockHost:true,widths:[320,390,768,1360],themes:['light','dark'],browserClosed:true},null,2));console.log(`UI assertions passed: ${checks}; fixture Host only`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});

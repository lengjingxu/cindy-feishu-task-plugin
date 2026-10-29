const {test}=require('node:test');const assert=require('node:assert/strict');
const {Bridge,initial}=require('../src/core.cjs');const {Onboarding}=require('../src/onboarding.cjs');const {action}=require('../src/feishu.cjs');
const appId='cli_0000000000000000';
async function fixture(node=async(m,p)=>p.action==='check'?{authenticated:true}:{verified:true,appId}){const writes=[];const b=new Bridge({store:{load:async()=>initial(),save:async s=>writes.push(structuredClone(s))},targets:{resolve:async p=>p.target},uuid:()=>''});await b.load();const o=new Onboarding(b,node);await o.associate('default',{kind:'bot',id:'chosen'});return {b,o,writes};}
test('认证不代表权限发布注册事件或闭环通过；无法开启接收',async()=>{const {o}=await fixture();await o.authenticate(appId);assert.equal(o.state.identity.state,'verified');for(const k of ['permissions','publication','registration','events'])assert.equal(o.state[k].state,'unverified');assert.throws(()=>o.assertReady(),{code:'ONBOARDING_TEST_REQUIRED'});});
test('注册调用前持久化 attempted，成功回执复用不重复写',async()=>{let f,calls=0;f=await fixture(async(m,p)=>{if(p.action==='check')return{authenticated:true};calls++;assert.equal(f.writes.at(-1).onboarding.registration.state,'attempted');return{verified:true,appId};});await f.o.authenticate(appId);await f.o.provision('registration');await f.o.provision('registration');assert.equal(calls,1);});
test('未知注册重启后也禁止重复提交',async()=>{const {o,b}=await fixture(async(m,p)=>{if(p.action==='check')return{authenticated:true};throw Error('timeout');});await o.authenticate(appId);await o.provision('registration');const restored=new Onboarding(b,()=>assert.fail('must not retry'));await assert.rejects(restored.provision('registration'),{code:'PROVISION_OUTCOME_UNKNOWN'});});
test('已有注册缺查询契约时不调用注册API，不准改选首次注册绕过',async()=>{const {o}=await fixture();await o.authenticate(appId);await o.provision('registration',true);assert.equal(o.state.registration.state,'needs_lookup');await assert.rejects(o.provision('registration'),{code:'PROVISION_OUTCOME_UNKNOWN'});});
test('凭据变化失效验证，在途凭据冻结；新伙伴只影响未来关联',async()=>{const {o,b}=await fixture();await o.authenticate(appId);await o.associate('default',{kind:'bot',id:'a'});b.state.tasks.t={state:'running',dispatch:{target:{kind:'bot',id:'a'}}};await o.associate('default',{kind:'bot',id:'b'});assert.equal(b.state.tasks.t.dispatch.target.id,'a');await assert.rejects(o.invalidateCredentials(),{code:'ACTIVE_BINDINGS_FROZEN'});delete b.state.tasks.t;await o.invalidateCredentials();assert.equal(o.state.identity.state,'pending');assert.equal(o.state.test.state,'not_run');});
test('不能默认选伙伴，resolve失效不改投；规则模式不能绕过明确伙伴',async()=>{const {o,b}=await fixture();await assert.rejects(o.associate('default'),{code:'TARGET_INVALID'});b.targets.resolve=async()=>({kind:'bot',id:'different'});await assert.rejects(o.associate('default',{kind:'bot',id:'a'}),{code:'TARGET_UNAVAILABLE'});await assert.rejects(o.associate('rules'),{code:'CONNECTION_PARTNER_REQUIRED'});});
test('配置查询独立记录权限和版本读取失败，不假定发布批准',async()=>{const {o}=await fixture(async(m,p)=>{if(p.action==='check')return{authenticated:true};if(p.action==='scopes')return{state:'verified',missing:[]};throw Object.assign(Error(),{code:'FEISHU_API_99991672'});});await o.authenticate(appId);await o.inspect();assert.equal(o.state.permissions.state,'verified');assert.equal(o.state.publication.state,'unverified');assert.equal(o.state.publication.error,'FEISHU_API_99991672');assert.throws(()=>o.assertReady());});
test('已有任务历史或未知注册不能通过切换应用清除核验记录',async()=>{const {o,b}=await fixture();await o.authenticate(appId);b.state.tasks.t={state:'done'};await assert.rejects(o.authenticate('cli_1111111111111111'),{code:'ACCOUNT_HAS_TASK_HISTORY'});});
test('注册与订阅遵循已验证路径，返回身份并拒绝错误身份回执',async()=>{const calls=[];const fetcher=async(url,init)=>{calls.push({url,init});return{ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'fixture'}:url.includes('register_agent')?{code:0,data:{agent:{app_id:appId,app_name:'test'}}}:{code:0,data:{}}};};assert.equal((await action({action:'registration',appId},'fixture',fetcher)).appId,appId);assert.equal((await action({action:'subscription',appId},'fixture',fetcher)).subscriptionAccepted,true);assert(calls.some(x=>x.url.endsWith('/task/v2/agent/register_agent')&&x.init.method==='POST'));assert(calls.some(x=>x.url.endsWith('/task/v2/task_v2/task_subscription?user_id_type=open_id')));await assert.rejects(action({action:'registration',appId:'cli_1111111111111111'},'fixture',fetcher),{code:'REGISTRATION_RECEIPT_INVALID'});});

test('应用可先认证但未关联不能接收；更换伙伴使验证失效',async()=>{const {b,o}=await fixture();await o.authenticate(appId);assert.equal(b.state.connection.partnerId,'chosen');assert.equal(o.state.association.target.id,'chosen');b.state.onboarding.test={state:'passed',epoch:o.state.epoch};await o.associate('default',{kind:'bot',id:'next'});assert.equal(o.state.test.state,'not_run');delete b.state.connection.partnerId;await o.authenticate(appId);assert.equal(b.state.connection.appId,appId);assert.throws(()=>o.assertReady(),{code:'CONNECTION_PARTNER_REQUIRED'});});

// Regression: tenant subscription must explicitly set the SDK's open_id query;
// a received rejection must remain inspectable, not turn into success.
test('订阅保留服务端拒绝原因且不能冒充成功',async()=>{
 const fetcher=async(url)=>({ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'fixture'}:{code:2200,msg:'invalid user_id_type'}});
 const receipt=await action({action:'subscription',appId},'fixture',fetcher);
 assert.equal(receipt.verified,false);assert.equal(receipt.error,'FEISHU_API_2200');assert.equal(receipt.detail,'invalid user_id_type');
 const f=await fixture(async(m,p)=>p.action==='check'?{authenticated:true}:p.action==='registration'?{verified:true,appId}:receipt);
 await f.o.authenticate(appId);await f.o.provision('registration');await f.o.provision('subscription');
 assert.equal(f.o.state.subscription.state,'uncertain');assert.equal(f.o.state.subscription.detail,'invalid user_id_type');
 await assert.rejects(f.o.provision('subscription'),{code:'PROVISION_OUTCOME_UNKNOWN'});
 await f.o.provision('subscription',false,true);assert.equal(f.o.state.subscription.error,'FEISHU_API_2200');
});

test('原应用续授权保留在途任务、循环及伙伴；换应用与解除仍冻结',async()=>{
 const {o,b,writes}=await fixture();await o.authenticate(appId);
 b.state.tasks={waiting:{state:'needs_input',dispatch:{target:{kind:'bot',id:'chosen'},requestKey:'original'},bindingId:'binding',generation:3},repeat:{state:'pending',queuedTarget:{kind:'bot',id:'chosen'},recurrence:{id:'original'}}};
 const tasks=structuredClone(b.state.tasks),connection=structuredClone(b.state.connection),association=structuredClone(o.state.association);
 o.assertAuthorization(appId);await o.authenticate(appId);
 assert.deepEqual(b.state.tasks,tasks);assert.deepEqual(b.state.connection,connection);assert.deepEqual(o.state.association,association);
 const n=writes.length;await assert.rejects(o.authenticate('cli_1111111111111111'),{code:'ACCOUNT_HAS_TASK_HISTORY'});assert.equal(writes.length,n);
 await assert.rejects(o.invalidateCredentials(),{code:'ACTIVE_BINDINGS_FROZEN'});
 for(const state of ['running','create_uncertain','cleanup_pending']){b.state.testRun={state};assert.throws(()=>o.assertAuthorization(appId),{code:'TEST_ALREADY_ACTIVE'});}
});

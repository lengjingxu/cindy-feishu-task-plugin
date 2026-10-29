const {test}=require('node:test'),assert=require('node:assert/strict');
const {AppProfile}=require('../src/app-profile.cjs');
const {action}=require('../src/feishu.cjs');
const appId='cli_0000000000000001';
function bridge(){return{state:{connection:{appId},tasks:{keep:{state:'running'}}},serial:async f=>f(),save:async function(s){this.state=s;}};}
test('名称只用当前应用凭据读取机器人app_name，不注册、不订阅、不额外申请权限',async()=>{
 const calls=[];const r=await action({action:'app_profile',appId},'fixture',async(url,init)=>{calls.push({url,init});return{ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'fixture-token'}:{code:0,bot:{open_id:'ou_fixture',app_name:' 应用一 '}}};});
 assert.deepEqual(r,{appId,name:'应用一',source:'bot/v3/info'});assert.equal(calls.length,2);assert.equal(calls[1].init.method,'GET');assert(calls[1].url.endsWith('/bot/v3/info'));assert.equal(calls[1].init.headers.Authorization,'Bearer fixture-token');
});
test('名称接口无有效身份或名称时拒绝，不能把错误信息当名称',async()=>{
 for(const bot of [{app_name:'名字'},{open_id:'ou_x',app_name:''},{open_id:'ou_x',app_name:42}])await assert.rejects(action({action:'app_profile',appId},'fixture',async url=>({ok:true,json:async()=>url.includes('/auth/')?{code:0,tenant_access_token:'fixture'}:{code:0,bot}})),{code:'APP_PROFILE_INVALID'});
});
test('并发刷新合并，失败保留同应用已核验名称并标记错误，不阻塞任务或其他应用',async()=>{
 let now=1000,calls=0,reject=false;const b=bridge(),p=new AppProfile(b,async()=>{calls++;if(reject)throw Object.assign(Error(),{code:'FEISHU_API_99991672'});return{appId,name:'应用一',source:'bot/v3/info'};},()=>now);
 await Promise.all([p.refresh(),p.refresh()]);assert.equal(calls,1);await p.refresh();assert.equal(calls,1);
 now+=300001;reject=true;await p.refresh();assert.equal(b.state.appProfile.name,'应用一');assert.equal(b.state.appProfile.state,'unavailable');assert.equal(b.state.appProfile.error,'FEISHU_API_99991672');assert.equal(b.state.tasks.keep.state,'running');
 await p.refresh();assert.equal(calls,2);now+=60001;reject=false;await p.refresh();assert.equal(calls,3);assert.equal(b.state.appProfile.state,'verified');
});
test('晚回执不能覆盖新身份、跨应用回执不能成为当前名称',async()=>{
 const b=bridge();let release;const p=new AppProfile(b,()=>new Promise(r=>release=r));const running=p.refresh();b.state.connection.appId='cli_0000000000000002';release({appId,name:'旧名称',source:'bot/v3/info'});await running;assert.equal(b.state.appProfile,undefined);
 await new AppProfile(b,async()=>({appId,name:'串号',source:'bot/v3/info'})).refresh();assert.equal(b.state.appProfile.name,undefined);assert.equal(b.state.appProfile.error,'APP_PROFILE_INVALID');
});

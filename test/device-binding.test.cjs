'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {DeviceBinding,GAP,REQUIRED}=require('../src/device-binding.cjs');
function fixture(overrides={}){const states=[];let options;const credential={client_id:'cli_test',client_secret:'SENSITIVE_TEST_VALUE'};
 const deps={partnerId:'chosen',saveState:async s=>states.push(s),authorize:async()=>({kind:'opened'}),store:{commit:async r=>({saved:true,appId:r.appId,partnerId:r.partnerId}),restore:async()=>({saved:true,appId:'cli_test',partnerId:'chosen'})},verify:async r=>({appId:r.appId,scopesGranted:true}),registerApp:async o=>{options=o;o.onQRCodeReady({url:'https://accounts.feishu.cn/test-only',expireIn:600});o.onStatusChange({status:'polling'});o.onStatusChange({status:'slow_down'});return credential;},...overrides};return {d:new DeviceBinding(deps),states,credential,get options(){return options;}};}
test('生产缺安全入库能力时，零上游请求',async()=>{let calls=0;const f=fixture({store:null,registerApp:async()=>{calls++;}});await assert.rejects(f.d.run(),{code:GAP});assert.equal(calls,0);});
test('新建/已有选择默认开放，增量权限，无IM覆盖，结果不含秘密或链接',async()=>{const f=fixture();const r=await f.d.run();assert.equal(f.options.createOnly,undefined);assert.equal(f.options.appId,undefined);assert.deepEqual(f.options.addons.scopes.tenant,[...REQUIRED,'task:tasklist:read','contact:contact.base:readonly','contact:user.base:readonly']);assert.deepEqual(Object.keys(f.options.addons).sort(),['events','preset','scopes']);assert.equal(r.state,'bound');assert.equal(r.publication,'unverified');assert.equal(r.closedLoop,'not_run');assert(!JSON.stringify(f.states).includes('SENSITIVE'));assert(!JSON.stringify(f.states).includes('https:'));assert(!('client_secret' in f.credential));assert(f.states.some(s=>s.state==='slow_down'));});
test('指定已有应用身份一致',async()=>{const f=fixture();await f.d.run({appId:'cli_test'});assert.equal(f.options.appId,'cli_test');});
test('指定已有应用身份不一致拒绝保存',async()=>{let saved=false;const f=fixture({store:{commit:async()=>{saved=true;},restore:async()=>{}}});await assert.rejects(f.d.run({appId:'cli_other'}),{code:'APP_ID_MISMATCH'});assert.equal(saved,false);});
for(const [code,expected] of [['access_denied','DENIED'],['expired_token','EXPIRED'],['network-secret-message','AUTHORIZATION_RECEIPT_UNKNOWN']])test(code+'固定错误摘要',async()=>{const f=fixture({registerApp:async()=>{throw Object.assign(new Error('SENSITIVE'),{code});}});await assert.rejects(f.d.run(),{code:expected});assert(!JSON.stringify(f.states).includes('SENSITIVE'));});
test('取消/期限使SDK停止，清理凭据',async()=>{const f=fixture({deadlineMs:5,registerApp:o=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject({code:'abort'}),{once:true}))});await assert.rejects(f.d.run(),{code:'EXPIRED'});const c=new AbortController();c.abort();await assert.rejects(fixture({signal:c.signal}).d.run(),{code:'CANCELLED'});});
test('保存失败或未知回执不重试',async()=>{let n=0;const f=fixture({store:{restore:async()=>{},commit:async()=>{n++;throw Error('SENSITIVE');}}});await assert.rejects(f.d.run(),{code:'CREDENTIAL_SAVE_UNKNOWN'});assert.equal(n,1);assert(!('client_secret' in f.credential));});
test('权限不足不冒充可用；重启只恢复身份待核验',async()=>{const f=fixture({verify:async()=>({appId:'cli_test',scopesGranted:false})});assert.equal((await f.d.run()).state,'permissions_required');assert.deepEqual(await f.d.restore(),{state:'needs_verification',appId:'cli_test',partnerId:'chosen',credentialSaved:true});});
test('授权卡失败不保存',async()=>{let n=0;const f=fixture({authorize:async()=>{throw Error('SENSITIVE');},store:{restore:async()=>{},commit:async()=>{n++;}}});await assert.rejects(f.d.run(),{code:'AUTHORIZATION_CARD_FAILED'});assert.equal(n,0);});

test('可先安全保存应用身份再关联伙伴；无安全存储仍拒绝上游授权',async()=>{const f=fixture({partnerId:null});const r=await f.d.run();assert.equal(r.appId,'cli_test');assert.equal(r.partnerId,null);assert.equal(r.closedLoop,'not_run');const restored=fixture({store:{restore:async()=>({saved:true,appId:'cli_test'})}});assert.equal((await restored.d.restore()).appId,'cli_test');await assert.rejects(fixture({partnerId:null,store:null}).d.run(),{code:GAP});});

test('续授权失败与取消不替换旧凭据；先验证再提交',async()=>{
 for(const mode of ['denied','verify-failed','cancelled']){
  let saved='old';const control=new AbortController();
  const f=fixture({signal:control.signal,store:{restore:async()=>({saved:true,appId:'cli_test'}),commit:async()=>{saved='new';return{saved:true,appId:'cli_test'};}},verify:async()=>{if(mode==='verify-failed')throw Error('invalid');if(mode==='cancelled')control.abort();return{appId:'cli_test'};},...(mode==='denied'?{registerApp:async()=>{throw {code:'access_denied'};}}:{})});
  await assert.rejects(f.d.run({appId:'cli_test'}));assert.equal(saved,'old');
 }
 let verified=false;const f=fixture({verify:async()=>{verified=true;return{appId:'cli_test'};},store:{restore:async()=>({saved:true}),commit:async()=>{assert(verified);return{saved:true,appId:'cli_test'};}}});await f.d.run({appId:'cli_test'});
});

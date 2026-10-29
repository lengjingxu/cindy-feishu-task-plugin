'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function fixture({forbidCapture=false}={}){
 let input,appId='cli_third',seq=0;const output=[],actions=[],saved=[],listeners=[];
 const host={saveCredential:async(key,value,identity)=>{saved.push({key,value,identity});return{saved:true,identity,revision:'r2'}}};
 class Listener {constructor(spawn,notify){this.notify=notify;listeners.push(this);}async run(p,secret){this.secret=secret;this.notify('listener/status',{state:'connected'});return{reason:'test'};}stop(){this.stopped=true;return{stopping:true}}ack(){return{forwarded:true}}}
 const requireMock=name=>name==='./credential-store.cjs'?{CredentialStore:class {async read(key){return secrets[key]?JSON.parse(secrets[key]):null;}async commit(key,{appId,secret}){for(const [k,v]of Object.entries(secrets))if(k!==key&&JSON.parse(v).identity===appId)throw Error('duplicate');saved.push({key,value:secret,identity:appId});secrets[key]=JSON.stringify({nodeCredentialVersion:1,identity:appId,value:secret,revision:'r2'});return {saved:true,appId,revision:'r2'};}async remove(key){delete secrets[key];return{removed:true};}}}:name==='node:readline'?{createInterface:()=>({on:(event,fn)=>{if(event==='line')input=fn;}})}:name==='./listener-proxy.cjs'?{ListenerProxy:Listener}:name==='@larksuiteoapi/node-sdk'?{registerApp:async opts=>{opts.onQRCodeReady({url:'https://open.feishu.cn/test',expireIn:60});return{client_id:appId,client_secret:'synthetic-new'}}}:name==='./feishu.cjs'?{action:async(params,secret)=>{actions.push({params,secret});return{authenticated:true}}}:require('../src/'+name.replace('./',''));
 const processMock={stdin:{},stdout:{write:s=>output.push(JSON.parse(s))},on(){}};
 vm.runInNewContext(fs.readFileSync('src/worker.cjs','utf8'),{require:requireMock,process:processMock,__CINDY_NODE__:{bindHostServices:()=>{if(forbidCapture)assert.fail('unnecessary capture');return host;},bindAuthorization:()=>async()=>{}},fetch:()=>assert.fail('network'),URL,AbortController,setTimeout,clearTimeout,console});
 const secrets={account:JSON.stringify({nodeCredentialVersion:1,identity:'cli_first',value:'synthetic-first',revision:'r1'}),account2:JSON.stringify({nodeCredentialVersion:1,identity:'cli_second',value:'synthetic-second',revision:'r1'})};
 return {actions,saved,listeners,output,secrets,setApp:id=>{appId=id},call:async(method,params={},credentials=secrets)=>{for(const k of Object.keys(secrets))if(!credentials[k])delete secrets[k];const id=++seq;await input(JSON.stringify({jsonrpc:'2.0',id,method,params,cindy:{secrets:credentials}}));return output.find(x=>x.id===id);}};
}
test('worker restores and sends with exactly selected app; listener stop and notifications are isolated',async()=>{
 const f=fixture();const restored=await f.call('binding/restore',{credentialKey:'account2'});assert.equal(restored.result.appId,'cli_second');assert(!JSON.stringify(restored).includes('synthetic'));
 await f.call('feishu/action',{credentialKey:'account2',appId:'cli_second',action:'get'});assert.equal(f.actions[0].secret,'synthetic-second');
 assert.equal((await f.call('feishu/action',{credentialKey:'account2',appId:'cli_first',action:'get'})).error.message,'APP_ID_MISMATCH');assert.equal(f.actions.length,1);
 await f.call('listener/run',{credentialKey:'account',appId:'cli_first'});await f.call('listener/run',{credentialKey:'account2',appId:'cli_second'});
 await f.call('listener/stop',{credentialKey:'account2'});assert.equal(f.listeners[0].stopped,true);assert.equal(f.listeners[1].stopped,undefined);
 assert.deepEqual(f.output.filter(x=>x.method==='listener/status').map(x=>x.params.credentialKey),['account','account2']);
});
test('second authorization saves only its own declared key; duplicate app never overwrites a credential',async()=>{
 const f=fixture();f.setApp('cli_first');let r=await f.call('binding/authorize2',{credentialKey:'account2'},{account:f.secrets.account});assert(r.error);assert.equal(f.saved.length,0);
 f.setApp('cli_third');r=await f.call('binding/authorize2',{credentialKey:'account2'},{account:f.secrets.account});assert.equal(r.result.appId,'cli_third');assert.equal(f.saved.length,1);assert.equal(f.saved[0].key,'account2');assert(!JSON.stringify(r).includes('synthetic-new'));
 assert.equal((await f.call('binding/authorize2',{credentialKey:'account'})).error.message,'APP_ID_MISMATCH');assert.equal(f.saved.length,1);
});

test('正式Node入口可检查支持范围，无需绑定服务/凭据或网络',async()=>{
 let input;const output=[];
 const processMock={stdin:{},stdout:{write:s=>output.push(JSON.parse(s))},on(){}};
 const requireMock=name=>name==='node:readline'?{createInterface:()=>({on:(event,fn)=>{if(event==='line')input=fn;}})}:require('../src/'+name.replace('./',''));
 vm.runInNewContext(fs.readFileSync('src/worker.cjs','utf8'),{require:requireMock,process:processMock,__CINDY_NODE__:{spawnEntry(){assert.fail('no child')},bindAuthorization(){assert.fail('no authorization')}},fetch:()=>assert.fail('no network')});
 await input(JSON.stringify({jsonrpc:'2.0',id:1,method:'runtime/capabilities',params:{}}));
 assert.deepEqual(output[0].result,{version:1,authorization:true,hostServicesEntry:false,childSpawn:true});
});

test('恢复身份和普通飞书请求不捕获授权/上传扩展',async()=>{
 const f=fixture({forbidCapture:true});
 assert.equal((await f.call('binding/restore',{credentialKey:'account2'})).result.appId,'cli_second');
 assert.equal((await f.call('feishu/action',{credentialKey:'account2',appId:'cli_second',action:'get'})).result.authenticated,true);
 assert.equal(f.actions.length,1);assert.equal(f.saved.length,0);
});

test('设置页扫码通过公开Node通知返回用户URL，不捕获Host凭据服务',async()=>{
 const f=fixture({forbidCapture:true});
 const result=await f.call('binding/authorize3',{credentialKey:'account3',authorizationMode:'settings',token:'reservation'});
 assert.equal(result.result.appId,'cli_third');
 const qr=f.output.find(x=>x.method==='binding/authorization');assert.equal(qr.params.token,'reservation');assert.match(qr.params.url,/^https:\/\/open.feishu.cn\//);
 assert(!JSON.stringify(f.output).includes('synthetic-new'));assert.equal(f.saved.length,1);
 assert.equal((await f.call('binding/remove',{credentialKey:'account3'})).result.removed,true);
 assert.equal((await f.call('binding/restore',{credentialKey:'account3'})).result.saved,false);
});

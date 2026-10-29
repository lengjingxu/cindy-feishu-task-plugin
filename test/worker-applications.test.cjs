'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
function fixture(){
 let input,appId='cli_third',seq=0;const output=[],actions=[],saved=[],listeners=[];
 const host={saveCredential:async(key,value,identity)=>{saved.push({key,value,identity});return{saved:true,identity,revision:'r2'}}};
 class Listener {constructor(spawn,notify){this.notify=notify;listeners.push(this);}async run(p,secret){this.secret=secret;this.notify('listener/status',{state:'connected'});return{reason:'test'};}stop(){this.stopped=true;return{stopping:true}}ack(){return{forwarded:true}}}
 const requireMock=name=>name==='node:readline'?{createInterface:()=>({on:(event,fn)=>{if(event==='line')input=fn;}})}:name==='./listener-proxy.cjs'?{ListenerProxy:Listener}:name==='@larksuiteoapi/node-sdk'?{registerApp:async opts=>{opts.onQRCodeReady({url:'https://open.feishu.cn/test',expireIn:60});return{client_id:appId,client_secret:'synthetic-new'}}}:name==='./feishu.cjs'?{action:async(params,secret)=>{actions.push({params,secret});return{authenticated:true}}}:require('../src/'+name.replace('./',''));
 const processMock={stdin:{},stdout:{write:s=>output.push(JSON.parse(s))},on(){}};
 vm.runInNewContext(fs.readFileSync('src/worker.cjs','utf8'),{require:requireMock,process:processMock,__CINDY_NODE__:{bindHostServices:()=>host,bindAuthorization:()=>async()=>{}},fetch:()=>assert.fail('network'),AbortController,setTimeout,clearTimeout,console});
 const secrets={account:JSON.stringify({nodeCredentialVersion:1,identity:'cli_first',value:'synthetic-first',revision:'r1'}),account2:JSON.stringify({nodeCredentialVersion:1,identity:'cli_second',value:'synthetic-second',revision:'r1'})};
 return {actions,saved,listeners,output,secrets,setApp:id=>{appId=id},call:async(method,params={},credentials=secrets)=>{const id=++seq;await input(JSON.stringify({jsonrpc:'2.0',id,method,params,cindy:{secrets:credentials}}));return output.find(x=>x.id===id);}};
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

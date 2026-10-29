'use strict';
// Opt-in macOS smoke: synthetic Keychain items + live SDK QR retrieval/cancel.
// Does not scan, create a Feishu application, send tasks or access Cindy data.
const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const {randomUUID}=require('node:crypto');const readline=require('node:readline');const {CredentialStore}=require('../src/credential-store.cjs');
const scope=randomUUID(),store=new CredentialStore(scope);
function worker(){
 const child=spawn(process.execPath,['plugin/node/worker.cjs'],{stdio:['pipe','pipe','pipe']});const lines=readline.createInterface({input:child.stdout});const pending=new Map();let seq=0,onQR;let stderr='';child.stderr.on('data',b=>stderr+=b);
 lines.on('line',line=>{const r=JSON.parse(line);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}}else if(r.method==='binding/authorization')onQR?.(r.params);});
 return{child,call(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params:{credentialScope:scope,credentialKey:'account',...params}})+'\n');});},qr(fn){onQR=fn},async close(){child.stdin.end();await new Promise(r=>child.once('close',r));assert.equal(stderr,'');}};
}
(async()=>{
 let w;const timeout=setTimeout(()=>{w?.child.kill();process.exitCode=1;},30000);
 try{
  await store.commit('account',{appId:'cli_synthetic',secret:'synthetic-smoke-secret'});
  w=worker();assert.equal((await w.call('binding/restore')).appId,'cli_synthetic');await w.close();
  w=worker();assert.equal((await w.call('binding/restore')).saved,true);await w.call('binding/remove');assert.equal((await w.call('binding/restore')).saved,false);await w.close();console.log('PASS: real Keychain save, worker restart restore, removal/readback');
  w=worker();let qr=false,cancellation;
  w.qr(params=>{const u=new URL(params.url);assert.equal(u.hostname,'open.feishu.cn');assert.equal(u.protocol,'https:');qr=true;cancellation=w.call('binding/cancel');});
  await assert.rejects(()=>w.call('binding/authorize',{authorizationMode:'settings',token:'synthetic-smoke'}));assert(qr);await cancellation;assert.equal((await w.call('binding/restore')).saved,false);await w.close();console.log('PASS: live SDK settings QR notification and cancel, no scanned authorization or app created');
 }finally{clearTimeout(timeout);w?.child.kill();await store.remove('account');}
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});

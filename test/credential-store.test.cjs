'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {CredentialStore}=require('../src/credential-store.cjs');
function fixture(){const items=new Map(),calls=[];let denied=false;const run=async(args,input)=>{calls.push({args,input});if(denied)return{code:36,out:''};if(input){const [,service,key,value]=input.match(/-s (\S+) -a (\S+) -w (\S+)/);items.set(service+key,value);return{code:0,out:''};}const key=args[2]+args[4];if(args[0]==='delete-generic-password'){const found=items.delete(key);return{code:found?0:44,out:''};}return items.has(key)?{code:0,out:items.get(key)+'\n'}:{code:44,out:''};};return{calls,items,run,deny:()=>{denied=true},store:scope=>new CredentialStore(scope,{run,platform:'darwin'})};}
test('plugin credential store restores across instances, isolates scopes, removes only selected slot',async()=>{
 const f=fixture(),scope=randomUUID(),s=f.store(scope);const secret='synthetic " \\ newline\n secret';
 await s.commit('account',{appId:'cli_first',secret});await s.commit('account2',{appId:'cli_second',secret:'synthetic-two'});
 assert.equal((await f.store(scope).read('account')).value,secret);assert.equal(await f.store(randomUUID()).read('account'),null);
 assert(f.calls.every(c=>!c.args.join(' ').includes(secret)));assert(f.calls.filter(c=>c.input).every(c=>c.args.join(' ')==='-i'));
 await assert.rejects(()=>s.commit('account3',{appId:'cli_first',secret}),{code:'APPLICATION_ALREADY_BOUND'});
 await assert.rejects(()=>s.commit('account',{appId:'cli_other',secret}),{code:'APP_ID_MISMATCH'});
 await s.remove('account');await s.remove('account');assert.equal(await s.read('account'),null);assert.equal((await s.read('account2')).identity,'cli_second');
});
test('denied Keychain access is not interpreted as missing credentials; unsupported OS has no fallback',async()=>{
 const f=fixture(),s=f.store(randomUUID());f.deny();await assert.rejects(()=>s.read('account'),{code:'CREDENTIAL_STORE_UNAVAILABLE'});
 assert.throws(()=>new CredentialStore(randomUUID(),{platform:'linux'}),{code:'CREDENTIAL_PLATFORM_UNSUPPORTED'});
 assert.throws(()=>f.store('../unsafe'),{code:'CREDENTIAL_SCOPE_REQUIRED'});
});

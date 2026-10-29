'use strict';
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {slots}=require('./applications.cjs');
const fail=code=>{throw Object.assign(Error(code),{code});};
// Credentials belong to this plugin, never Cindy's database. Only stdin carries
// passwords; no secret appears in process arguments or plugin files.
function security(args,input){return new Promise((resolve,reject)=>{
 const child=spawn('/usr/bin/security',args,{stdio:['pipe','pipe','pipe']});let out='';
 const timer=setTimeout(()=>{child.kill();reject(Object.assign(Error('CREDENTIAL_STORE_UNAVAILABLE'),{code:'CREDENTIAL_STORE_UNAVAILABLE'}));},20000);
 child.once('close',()=>clearTimeout(timer));child.once('error',()=>clearTimeout(timer));
 child.stdout.on('data',b=>{out+=b;});child.stderr.resume();
 child.on('error',()=>reject(Object.assign(Error('CREDENTIAL_STORE_UNAVAILABLE'),{code:'CREDENTIAL_STORE_UNAVAILABLE'})));
 child.on('close',code=>resolve({code,out}));child.stdin.on('error',()=>{});child.stdin.end(input);
});}
class CredentialStore {
 constructor(scope,{run=security,platform=process.platform}={}){
  if(platform!=='darwin')fail('CREDENTIAL_PLATFORM_UNSUPPORTED');
  if(!/^[a-f0-9-]{36}$/.test(scope||''))fail('CREDENTIAL_SCOPE_REQUIRED');
  this.service='cn.feishu.cindy-task-plugin.'+scope;this.run=run;
 }
 key(key){if(!slots.includes(key))fail('APPLICATION_NOT_FOUND');return key;}
 async read(key){
  const r=await this.run(['find-generic-password','-s',this.service,'-a',this.key(key),'-w']);
  if(r.code===44)return null;if(r.code!==0)fail('CREDENTIAL_STORE_UNAVAILABLE');
  let v;try{v=JSON.parse(Buffer.from(r.out.trim(),'base64').toString('utf8'));}catch{fail('CREDENTIAL_INVALID');}
  if(v.nodeCredentialVersion!==1||!/^cli_[a-zA-Z0-9]+$/.test(v.identity||'')||typeof v.value!=='string'||!v.value||!v.revision)fail('CREDENTIAL_INVALID');return v;
 }
 async commit(key,{appId,secret}){
  this.key(key);if(!/^cli_[a-zA-Z0-9]+$/.test(appId||'')||typeof secret!=='string'||!secret)fail('CREDENTIAL_INVALID');
  for(const other of slots){const current=await this.read(other);if(current&&other!==key&&current.identity===appId)fail('APPLICATION_ALREADY_BOUND');if(current&&other===key&&current.identity!==appId)fail('APP_ID_MISMATCH');}
  const value={nodeCredentialVersion:1,identity:appId,value:secret,revision:randomUUID()};
  // Base64 has no interactive command metacharacters. Read back after saving:
  // security interactive mode can exit zero even when its command failed.
  const encoded=Buffer.from(JSON.stringify(value)).toString('base64');
  await this.run(['-i'],'add-generic-password -U -s '+this.service+' -a '+key+' -w '+encoded+'\n');
  const saved=await this.read(key);if(saved?.revision!==value.revision)fail('CREDENTIAL_SAVE_UNKNOWN');
  return {saved:true,appId,revision:saved.revision};
 }
 async remove(key){
  const r=await this.run(['delete-generic-password','-s',this.service,'-a',this.key(key)]);
  if(r.code!==0&&r.code!==44)fail('CREDENTIAL_STORE_UNAVAILABLE');
  if(await this.read(key))fail('CREDENTIAL_REMOVAL_UNVERIFIED');return {removed:true};
 }
}
module.exports={CredentialStore};

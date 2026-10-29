"use strict";
const readline = require("node:readline");
const { ListenerProxy } = require("./listener-proxy.cjs");
const { DeviceBinding } = require("./device-binding.cjs");
const reply = value => process.stdout.write(JSON.stringify(value) + "\n");
const {slots}=require('./applications.cjs');
const listeners=new Map();
function getListener(key){if(!listeners.has(key))listeners.set(key,new ListenerProxy(globalThis.__CINDY_NODE__?.spawnEntry,(method,params)=>reply({jsonrpc:"2.0",method,params:{...params,credentialKey:key}})));return listeners.get(key);}
const authorizing=new Set(),authorizationControls=new Map();
const {CredentialStore}=require('./credential-store.cjs');
async function handle(request) {
  const runtime=globalThis.__CINDY_NODE__;
  if(request.method==='runtime/capabilities')return {version:1,authorization:typeof runtime?.bindAuthorization==='function',hostServicesEntry:typeof runtime?.bindHostServices==='function',childSpawn:typeof runtime?.spawnEntry==='function'};
  const authIndex=['binding/authorize','binding/authorize2','binding/authorize3','binding/authorize4'].indexOf(request.method);
  const key=authIndex>=0?slots[authIndex]:(request.params?.credentialKey||'account');
  if(!slots.includes(key))throw Object.assign(Error('APPLICATION_NOT_FOUND'),{code:'APPLICATION_NOT_FOUND'});
  if(authIndex>=0&&request.params?.credentialKey&&request.params.credentialKey!==key)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
  if(authIndex<0&&!['binding/restore','binding/remove','binding/cancel','listener/stop','listener/ack','listener/run','feishu/action'].includes(request.method))throw Object.assign(Error('METHOD_NOT_FOUND'),{code:'METHOD_NOT_FOUND'});
  if(request.method==='binding/cancel'){const control=authorizationControls.get(key);control?.abort();if(control)await control.finished;return {stopped:true};}
  const listener=getListener(key);
  if(request.method==='listener/stop')return listener.stop();
  if(request.method==='listener/ack')return listener.ack(request.params);
  const needsHost=(request.method==='feishu/action'&&request.params?.action==='upload');
  const host=needsHost?runtime?.bindHostServices?.():undefined;
  const settings=authIndex>=0&&request.params?.authorizationMode==='settings';
  const authorize=settings?async value=>{const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='open.feishu.cn'||url.username||url.password)throw Error('AUTHORIZATION_URL_INVALID');reply({jsonrpc:'2.0',method:'binding/authorization',params:{credentialKey:key,token:request.params.token,url:url.href}});}:authIndex>=0?runtime?.bindAuthorization?.():undefined;
  const store=new CredentialStore(request.params?.credentialScope);
  const mutating=authIndex>=0||request.method==='binding/remove';
  if(mutating&&authorizing.size)throw Object.assign(Error('AUTHORIZATION_BUSY'),{code:'AUTHORIZATION_BUSY'});
  if(mutating)authorizing.add(key);
  const control=authIndex>=0?new AbortController():undefined;if(control){control.finished=new Promise(resolve=>{control.finish=resolve;});authorizationControls.set(key,control);}
  try{
  if(request.method==='binding/remove'){await listener.stop();return store.remove(key);}
  const current=await store.read(key);
  if(request.method==='binding/restore')return {hostServices:typeof globalThis.__CINDY_NODE__?.bindHostServices==='function',...(current?{saved:true,appId:current.identity,revision:current.revision}:{saved:false})};
  if(authIndex>=0) {
    if(current && request.params?.appId && request.params.appId!==current.identity)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
    return await new DeviceBinding({authorize,signal:control.signal,registerApp:require("@larksuiteoapi/node-sdk").registerApp,store:{commit:value=>store.commit(key,value),restore:async()=>{const v=await store.read(key);return v?{saved:true,appId:v.identity,revision:v.revision}:{saved:false};}},
      saveState:async value=>{if(settings)reply({jsonrpc:'2.0',method:'binding/status',params:{credentialKey:key,token:request.params.token,state:value.state}});},verify:async({appId,secret})=>{
        await require('./feishu.cjs').action({action:'check',appId},secret);
        return {appId,scopesGranted:false};
      }}).run({...request.params,...(current?{appId:current.identity}:{})});
  }
  if(!['listener/run','feishu/action'].includes(request.method))throw Object.assign(Error('METHOD_NOT_FOUND'),{code:'METHOD_NOT_FOUND'});
  if(!current)throw Object.assign(Error('CONNECTION_REQUIRED'),{code:'CONNECTION_REQUIRED'});
  if(request.params?.appId!==current.identity)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
  if (request.method === "listener/run") return listener.run(request.params,current.value);
  if (request.method === "feishu/action") return require('./feishu.cjs').action(request.params,current.value,fetch,host);
  throw Object.assign(new Error("METHOD_NOT_FOUND"), { code: "METHOD_NOT_FOUND" });
  }finally{if(mutating){authorizing.delete(key);authorizationControls.delete(key);control?.finish();}}
}
const input = readline.createInterface({ input: process.stdin });
input.on("line", async line => {
  let request;
  try { request = JSON.parse(line); } catch { reply({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
  if (request.jsonrpc !== "2.0" || request.id === undefined || typeof request.method !== "string") {
    reply({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32600, message: "Invalid request" } }); return;
  }
  try { reply({ jsonrpc: "2.0", id: request.id, result: await handle(request) }); }
  catch (e) {
    const code = /^[A-Z][A-Z0-9_]{1,80}$/.test(e.code || "") ? e.code : "WORKER_OPERATION_FAILED";
    reply({ jsonrpc: "2.0", id: request.id, error: { code: code === "METHOD_NOT_FOUND" ? -32601 : -32000, message: code } });
  } finally { if (request.cindy?.secrets) { for(const key of slots)delete request.cindy.secrets[key]; } }
});
input.on("close", () => {for(const control of authorizationControls.values())control.abort();for(const listener of listeners.values())listener.stop();});
process.on("SIGTERM", () => { for(const listener of listeners.values())listener.stop(); setTimeout(() => process.exit(0), 50).unref(); });
process.on("SIGINT", () => { for(const listener of listeners.values())listener.stop(); setTimeout(() => process.exit(0), 50).unref(); });

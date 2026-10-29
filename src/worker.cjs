"use strict";
const readline = require("node:readline");
const { ListenerProxy } = require("./listener-proxy.cjs");
const { DeviceBinding } = require("./device-binding.cjs");
const reply = value => process.stdout.write(JSON.stringify(value) + "\n");
const {slots}=require('./applications.cjs');
const listeners=new Map();
function getListener(key){if(!listeners.has(key))listeners.set(key,new ListenerProxy(globalThis.__CINDY_NODE__?.spawnEntry,(method,params)=>reply({jsonrpc:"2.0",method,params:{...params,credentialKey:key}})));return listeners.get(key);}
const authorizing=new Set();
function credential(request,key) {
  const raw=request.cindy?.secrets?.[key];if(!raw)return null;
  let v;try{v=JSON.parse(raw);}catch{throw Object.assign(Error('CREDENTIAL_INVALID'),{code:'CREDENTIAL_INVALID'});}
  if(v.nodeCredentialVersion!==1||!/^cli_[a-zA-Z0-9]+$/.test(v.identity||'')||!v.value||!v.revision)
    throw Object.assign(Error('CREDENTIAL_INVALID'),{code:'CREDENTIAL_INVALID'});
  return v;
}
async function handle(request) {
  const host=globalThis.__CINDY_NODE__?.bindHostServices?.();
  const authIndex=['binding/authorize','binding/authorize2','binding/authorize3','binding/authorize4'].indexOf(request.method);
  const key=authIndex>=0?slots[authIndex]:(request.params?.credentialKey||'account');
  if(!slots.includes(key))throw Object.assign(Error('APPLICATION_NOT_FOUND'),{code:'APPLICATION_NOT_FOUND'});
  if(authIndex>=0&&request.params?.credentialKey&&request.params.credentialKey!==key)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
  const current=credential(request,key);
  const listener=getListener(key);
  if(request.method==='binding/restore')return {hostServices:typeof globalThis.__CINDY_NODE__?.bindHostServices==='function',...(current?{saved:true,appId:current.identity,revision:current.revision}:{saved:false})};
  if(authIndex>=0) {
    if(authorizing.size)throw Object.assign(Error('AUTHORIZATION_BUSY'),{code:'AUTHORIZATION_BUSY'});
    if(current && request.params?.appId && request.params.appId!==current.identity)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
    const authorize=globalThis.__CINDY_NODE__?.bindAuthorization?.();
    const store=host?{
      commit:async({appId,secret})=>{if(slots.some(other=>other!==key&&credential(request,other)?.identity===appId))throw Object.assign(Error('APPLICATION_ALREADY_BOUND'),{code:'APPLICATION_ALREADY_BOUND'});const r=await host.saveCredential(key,secret,appId);return {saved:r.saved,appId:r.identity,revision:r.revision};},
      restore:async()=>current?{saved:true,appId:current.identity,revision:current.revision}:{saved:false}
    }:null;
    // The Host stores identity + secret atomically. No sensitive state is sent over stdio.
    authorizing.add(key);
    try{return await new DeviceBinding({authorize,signal:host?.signal,registerApp:require("@larksuiteoapi/node-sdk").registerApp,store,
      saveState:async()=>{},verify:async({appId,secret})=>{
        await require('./feishu.cjs').action({action:'check',appId},secret);
        return {appId,scopesGranted:false};
      }}).run({...request.params,...(current?{appId:current.identity}:{})});}finally{authorizing.delete(key);}
  }
  if (request.method === "listener/stop") return listener.stop();
  if (request.method === "listener/ack") return listener.ack(request.params);
  if(!['listener/run','feishu/action'].includes(request.method))throw Object.assign(Error('METHOD_NOT_FOUND'),{code:'METHOD_NOT_FOUND'});
  if(!current)throw Object.assign(Error('CONNECTION_REQUIRED'),{code:'CONNECTION_REQUIRED'});
  if(request.params?.appId!==current.identity)throw Object.assign(Error('APP_ID_MISMATCH'),{code:'APP_ID_MISMATCH'});
  if (request.method === "listener/run") return listener.run(request.params,current.value);
  if (request.method === "feishu/action") return require('./feishu.cjs').action(request.params,current.value,fetch,host);
  throw Object.assign(new Error("METHOD_NOT_FOUND"), { code: "METHOD_NOT_FOUND" });
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
input.on("close", () => {for(const listener of listeners.values())listener.stop();});
process.on("SIGTERM", () => { for(const listener of listeners.values())listener.stop(); setTimeout(() => process.exit(0), 50).unref(); });
process.on("SIGINT", () => { for(const listener of listeners.values())listener.stop(); setTimeout(() => process.exit(0), 50).unref(); });

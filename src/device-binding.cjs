'use strict';
const GAP='HOST_DEVICE_CREDENTIAL_STORE_UNAVAILABLE';
const REQUIRED=['task:task:read','task:task:write','task:comment:write','task:attachment:write'];
const fail=code=>{throw Object.assign(new Error(code),{code});};
// store is a trusted dependency boundary, NOT an existing Cindy API.
class DeviceBinding {
 constructor(deps){Object.assign(this,deps);}
 async run({appId,partnerId=this.partnerId}={}){
  if(!this.store?.commit||!this.store?.restore)fail(GAP);
  if(typeof this.authorize!=='function')fail('HOST_AUTHORIZATION_UNAVAILABLE');
  if(appId!==undefined&&!/^cli_[a-zA-Z0-9]+$/.test(appId))fail('APP_ID_INVALID');
  const control=new AbortController();let result,stage='starting',expired=false,card=Promise.resolve();
  const abort=()=>control.abort();this.signal?.addEventListener('abort',abort,{once:true});
  if(this.signal?.aborted)abort();
  const timer=setTimeout(()=>{expired=true;abort();},Math.min(290000,Math.max(1,this.deadlineMs||290000)));
  const update=async state=>{stage=state;await this.saveState({state,appId:appId||null,partnerId});};
  try{
   if(control.signal.aborted)fail('CANCELLED');
   await update('starting');
   result=await this.registerApp({...(appId?{appId}:{}),addons:{preset:false,scopes:{tenant:[...REQUIRED,'task:tasklist:read','contact:contact.base:readonly','contact:user.base:readonly']},events:{items:{tenant:['task.task.update_user_access_v2']}}},signal:control.signal,
    onQRCodeReady:({url,expireIn})=>{
     // SDK callback is synchronous; attach rejection immediately and abort polling.
     card=Promise.resolve().then(()=>this.authorize({kind:'device',url,expiresAt:Date.now()+Math.min(290000,Math.max(0,expireIn*1000))})).catch(()=>{abort();fail('AUTHORIZATION_CARD_FAILED');});card.catch(()=>{});
    },
    onStatusChange:({status})=>{if(['polling','slow_down','domain_switched'].includes(status))update(status).catch(abort);}
   });
   await card;
   if(control.signal.aborted)fail(expired?'EXPIRED':'CANCELLED');
   if(!result?.client_id||!result?.client_secret)fail('AUTHORIZATION_RECEIPT_UNKNOWN');
   if(appId&&result.client_id!==appId)fail('APP_ID_MISMATCH');
   await update('saving');
   const receipt=await this.store.commit({appId:result.client_id,partnerId,secret:result.client_secret});
   if(control.signal.aborted)fail(expired?'EXPIRED':'CANCELLED');
   if(!receipt?.saved||receipt.appId!==result.client_id)fail('CREDENTIAL_SAVE_UNKNOWN');
   await update('verifying');
   const check=await this.verify({appId:result.client_id,secret:result.client_secret});
   if(control.signal.aborted)fail(expired?'EXPIRED':'CANCELLED');
   if(check?.appId!==result.client_id)fail('APP_ID_MISMATCH');
   const state={state:check.scopesGranted===true?'bound':'permissions_required',appId:result.client_id,partnerId,credentialSaved:true,registration:'unverified',publication:'unverified',events:'unverified',closedLoop:'not_run'};
   await this.saveState(state);return state;
  }catch(e){
   const mapped={access_denied:'DENIED',expired_token:'EXPIRED',abort:expired?'EXPIRED':'CANCELLED'};
   const allowed=['CANCELLED','EXPIRED','APP_ID_MISMATCH','AUTHORIZATION_CARD_FAILED','CREDENTIAL_SAVE_UNKNOWN','AUTHORIZATION_RECEIPT_UNKNOWN'];
   const code=mapped[e.code]||(allowed.includes(e.code)?e.code:stage==='saving'?'CREDENTIAL_SAVE_UNKNOWN':'AUTHORIZATION_RECEIPT_UNKNOWN');
   await this.saveState({state:'blocked',error:code,appId:appId||null});fail(code);
  }finally{clearTimeout(timer);this.signal?.removeEventListener('abort',abort);control.abort();if(result)delete result.client_secret;}
 }
 async restore(){
  if(!this.store?.restore)fail(GAP);
  const r=await this.store.restore();
  return r?.saved&&/^cli_[a-zA-Z0-9]+$/.test(r.appId||'')?{state:'needs_verification',appId:r.appId,partnerId:r.partnerId,credentialSaved:true}:{state:'unbound'};
 }
}
function requireStandaloneBinding(){fail(GAP);}
module.exports={DeviceBinding,requireStandaloneBinding,GAP,REQUIRED};

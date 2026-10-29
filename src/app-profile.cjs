'use strict';
const {fail}=require('./core.cjs');
// One read per authenticated app; no registration, authorization or task writes.
class AppProfile {
 constructor(bridge,node,now=()=>Date.now()){this.b=bridge;this.node=node;this.now=now;this.pending=null;this.lastAppId=null;this.nextRead=0;}
 refresh(){
  const appId=this.b.state.connection?.appId;
  if(!appId)return Promise.resolve();
  if(this.pending)return this.pending;
  if(this.lastAppId===appId&&this.now()<this.nextRead)return Promise.resolve();
  this.lastAppId=appId;
  this.pending=this.read(appId).finally(()=>{this.pending=null;});return this.pending;
 }
 async read(appId){
  let profile;
  try{
   const r=await this.node('feishu/action',{action:'app_profile',appId});
   if(r?.appId!==appId||typeof r.name!=='string'||!r.name.trim()||r.name.length>512||r.source!=='bot/v3/info')fail('APP_PROFILE_INVALID');
   profile={appId,name:r.name.trim(),source:r.source,state:'verified',checkedAt:this.now()};
   this.nextRead=this.now()+300000;
  }catch(e){
   profile={appId,state:'unavailable',error:/^[A-Z][A-Z0-9_]{1,80}$/.test(e.code||'')?e.code:'APP_PROFILE_UNAVAILABLE',checkedAt:this.now()};
   this.nextRead=this.now()+60000;
  }
  await this.b.serial(async()=>{
   // A late response must not rename a replacement application or overwrite tasks.
   if(this.b.state.connection?.appId!==appId)return;
   const next=JSON.parse(JSON.stringify(this.b.state));
   const previous=next.appProfile?.appId===appId?next.appProfile:{};
   next.appProfile=profile.state==='verified'?profile:{...previous,...profile};await this.b.save(next);
  });
 }
}
module.exports={AppProfile};

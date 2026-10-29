"use strict";
const { fail } = require('./core.cjs');
const copy = x => JSON.parse(JSON.stringify(x));
const blank = () => ({ epoch: 0, identity: {state:'pending'}, permissions:{state:'unverified'}, publication:{state:'unverified'}, registration:{state:'unverified'}, subscription:{state:'unverified'}, events:{state:'unverified'}, association:{state:'pending'}, test:{state:'not_run'} });
class Onboarding {
 constructor(bridge, node) { this.b=bridge; this.node=node; }
 get state() { return this.b.state.onboarding || blank(); }
 async save(s) { const next=copy(this.b.state); next.onboarding=s; await this.b.save(next); }
 hasBindings() { return Object.values(this.b.state.tasks).some(t=>t.dispatch && (t.orphanedDelivery || !['done','stopped'].includes(t.state))); }
 async invalidateCredentials() { return this.b.serial(async()=>{
  if(this.hasBindings()) fail('ACTIVE_BINDINGS_FROZEN');
  const s=copy(this.state); s.epoch++; s.identity={state:'pending'}; s.permissions={state:'unverified'}; s.publication={state:'unverified'}; s.events={state:'unverified'}; s.test={state:'not_run'}; await this.save(s);
 }); }
 async authenticate(appId) { return this.b.serial(async()=>{
  if(!/^cli_[0-9a-f]{16}$/i.test(appId||'')) fail('APP_ID_INVALID');
  const old=this.b.state.connection?.appId;
  if(old && old!==appId && (Object.keys(this.b.state.tasks).length || ['registration','subscription'].some(k=>this.state[k].state!=='unverified'))) fail('ACCOUNT_HAS_TASK_HISTORY');
  if(this.hasBindings()) fail('ACTIVE_BINDINGS_FROZEN');
  let s=old===appId?copy(this.state):{...blank(),association:copy(this.state.association)}; s.epoch++; s.identity={state:'pending'}; s.permissions={state:'unverified'}; s.publication={state:'unverified'}; s.events={state:'unverified'}; s.test={state:'not_run'};
  await this.save(s);
  const r=await this.node('feishu/action',{action:'check',appId});
  if(r.authenticated!==true) fail('AUTHENTICATION_FAILED');
  s.identity={state:'verified',appId};
  const next=copy(this.b.state);next.connection={...next.connection,appId};next.onboarding=s;await this.b.save(next);
 }); }
 async provision(kind, existing=false, retryRejected=false) { return this.b.serial(async()=>{
  if(!['registration','subscription'].includes(kind)) fail('ACTION_UNSUPPORTED');
  const s=copy(this.state); if(s.identity.state!=='verified') fail('CHECK_CONNECTION_FIRST');
  if(s[kind].state==='verified') return s[kind];
  if(['attempted','uncertain','needs_lookup'].includes(s[kind].state) && !(kind==='subscription'&&retryRejected&&s[kind].error==='FEISHU_API_2200')) fail('PROVISION_OUTCOME_UNKNOWN');
  if(existing) { s[kind]={state:'needs_lookup',error:'EXISTING_REGISTRATION_LOOKUP_UNAVAILABLE'};await this.save(s);return s[kind]; }
  if(kind==='subscription' && s.registration.state!=='verified') fail('REGISTER_AGENT_FIRST');
  s[kind]={state:'attempted',appId:s.identity.appId}; await this.save(s);
  try {
   const receipt=await this.node('feishu/action',{action:kind,appId:s.identity.appId});
   if(receipt?.verified===false && receipt.appId===s.identity.appId && /^FEISHU_API_[0-9]+$/.test(receipt.error||'')){s[kind]={state:'uncertain',appId:s.identity.appId,error:receipt.error,detail:receipt.detail};await this.save(s);return s[kind];}
   if(receipt?.verified!==true || receipt.appId!==s.identity.appId) fail('PROVISION_RECEIPT_INVALID');
   s[kind]={state:'verified',receipt};
  } catch(e) { s[kind]={...s[kind],state:'uncertain',error:e.code||'PROVISION_OUTCOME_UNKNOWN'}; }
  await this.save(s);return s[kind];
 }); }
 async associate(mode,target) { return this.b.serial(async()=>{
  if(mode!=='default') fail('CONNECTION_PARTNER_REQUIRED');
  if(target?.kind!=='bot'||!target.id) fail('TARGET_INVALID');
  const resolved=await this.b.targets.resolve({target});
  if(resolved.kind!=='bot'||resolved.id!==target.id) fail('TARGET_UNAVAILABLE');
  if(this.b.state.connection?.partnerId===resolved.id)return;
  const s=copy(this.state);s.association={state:'selected',mode:'default',target:{kind:'bot',id:resolved.id}};s.epoch++;s.test={state:'not_run'};
  const next=copy(this.b.state);next.connection={...next.connection,partnerId:resolved.id};next.onboarding=s;await this.b.save(next);
 }); }
 async inspect() { return this.b.serial(async()=>{
  const s=copy(this.state);if(s.identity.state!=='verified')fail('CHECK_CONNECTION_FIRST');
  for(const [key,action] of [['permissions','scopes'],['publication','versions']]){
   try{s[key]={...await this.node('feishu/action',{action,appId:s.identity.appId}),runtime:s[key].runtime};}
   catch(e){s[key]={state:'unverified',error:e.code||'CONFIGURATION_READ_FAILED',runtime:s[key].runtime};}
  }
  await this.save(s);return s;
 }); }
 assertReady() {
  const s=this.state;
  if(!this.b.state.connection?.partnerId||s.association.target?.id!==this.b.state.connection.partnerId)fail('CONNECTION_PARTNER_REQUIRED');
  if(s.test.state!=='passed'||s.test.epoch!==s.epoch||this.b.state.testRun?.target?.id!==this.b.state.connection.partnerId) fail('ONBOARDING_TEST_REQUIRED');
  if(s.identity.state!=='verified'||s.permissions.state!=='verified'||s.association.state!=='selected'||!['registration','subscription','events'].every(k=>s[k].runtime?.state==='verified'&&s[k].runtime.epoch===s.epoch))fail('ONBOARDING_INCOMPLETE');
 }
}
module.exports={Onboarding,blank};

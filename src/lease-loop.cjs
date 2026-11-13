'use strict';
class LeaseLoop {
 constructor(node,status,now=()=>Date.now()){this.node=node;this.status=status;this.now=now;this.active=false;}
 start(appId,baseline,durationMs=600000){
  if(this.active||this.stopping)throw Object.assign(Error('LISTENER_BUSY'),{code:'LISTENER_BUSY'});
  this.lastError=null;this.connected=false;this.active=true;const deadline=durationMs===Infinity?Infinity:this.now()+Math.min(600000,durationMs);
  this.promise=(async()=>{try{for(let lease=0;this.active&&this.now()<deadline;lease++){
   this.status(lease?'renewing':'connecting');
   this.connected=false;
   const r=await this.node('listener/run',{appId,baseline,durationMs:Math.max(1000,Math.min(60000,deadline-this.now()))});
   if(!this.active)break;
   if(r?.reason==='unexpected_exit'&&r.childExited===true){
    this.lastError={code:'LISTENER_UNEXPECTED_EXIT'};this.status('reconnecting');
    await new Promise(resolve=>{this.retryResolve=resolve;this.retryTimer=setTimeout(resolve,5000);});
    clearTimeout(this.retryTimer);this.retryTimer=undefined;this.retryResolve=null;continue;
   }
   if(r?.reason!=='lease_expired'||r.childExited!==true){this.lastError={code:'LISTENER_EXIT_UNCONFIRMED',reason:r?.reason};this.status('failed');return;}
   this.lastError=null;
   this.status('gap_check');
  }}catch(e){this.lastError={code:e.code||'LISTENER_RPC_FAILED'};this.status('failed');}finally{this.active=false;this.status('ended');}})();
 }
 connection(state){this.connected=state==='connected';if(this.connected)this.lastError=null;if(this.connected&&this.readyWait){clearTimeout(this.readyWait.timer);this.readyWait.resolve();this.readyWait=null;}}
 waitReady(){
  if(this.connected)return Promise.resolve();
  if(!this.active)return Promise.reject(Object.assign(Error('LISTENER_NOT_READY'),{code:'LISTENER_NOT_READY'}));
  if(!this.readyWait){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});const timer=setTimeout(()=>{this.readyWait=null;reject(Object.assign(Error('LISTENER_NOT_READY'),{code:'LISTENER_NOT_READY'}));},15000);this.readyWait={resolve,reject,promise,timer};}
  return this.readyWait.promise;
 }
 async stop(){this.stopping=true;const running=this.promise;try{if(this.readyWait){clearTimeout(this.readyWait.timer);this.readyWait.reject(Object.assign(Error('LISTENER_STOPPED'),{code:'LISTENER_STOPPED'}));this.readyWait=null;}this.active=false;clearTimeout(this.retryTimer);this.retryResolve?.();await this.node('listener/stop',{});await running;this.status('paused');}finally{this.stopping=false;}}
}
module.exports={LeaseLoop};

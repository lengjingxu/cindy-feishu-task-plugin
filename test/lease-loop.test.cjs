const {test}=require('node:test'),assert=require('node:assert/strict');const {LeaseLoop}=require('../src/lease-loop.cjs');
test('每租期退出后新RPC续接，最多10段，凭据不进入主逻辑参数',async()=>{let now=0;const calls=[],status=[];const l=new LeaseLoop(async(m,p)=>{calls.push({m,p});now+=60000;return{reason:'lease_expired',childExited:true}},s=>status.push(s),()=>now);l.start('app',0);await l.promise;assert.equal(calls.length,10);assert(calls.every(x=>x.p.durationMs===60000&&!('secret'in x.p)));assert(status.includes('renewing'));assert.equal(l.active,false);});
test('不明确的退出不自动重试；暂停等待当前子进程退出才结束',async()=>{let calls=0;const l=new LeaseLoop(async()=>{calls++;return{reason:'unexpected_exit',childExited:false}},()=>{},()=>0);l.start('app',0);await l.promise;assert.equal(calls,1);let finish;const second=new LeaseLoop(async(m)=>{if(m==='listener/run')return new Promise(r=>finish=r);finish({reason:'paused',childExited:true});return{}},()=>{},()=>0);second.start('app',0);await second.stop();assert.equal(second.active,false);});
test('首次测试必须等待真实连接就绪，停止解除等待',async()=>{
 let finish;const l=new LeaseLoop(async m=>m==='listener/run'?new Promise(r=>finish=r):(finish({reason:'paused',childExited:true}),{}),()=>{});
 l.start('app',0);let ready=false;const waiting=l.waitReady().then(()=>ready=true);await new Promise(r=>setImmediate(r));assert.equal(ready,false);l.connection('connected');await waiting;assert.equal(ready,true);await l.stop();
 const second=new LeaseLoop(async m=>m==='listener/run'?new Promise(r=>finish=r):(finish({reason:'paused',childExited:true}),{}),()=>{});second.start('app',0);const cancelled=assert.rejects(second.waitReady(),{code:'LISTENER_STOPPED'});await second.stop();await cancelled;
});

// Production reception is user-controlled, not limited by the diagnostic test budget.
test('正式接收超过十分钟仍续接，用户暂停后退出',async()=>{
 let now=0,calls=0;const l=new LeaseLoop(async()=>{calls++;now+=60000;if(calls===12)l.active=false;return{reason:'lease_expired',childExited:true}},()=>{},()=>now);
 l.start('app',0,Infinity);await l.promise;assert.equal(calls,12);assert.equal(l.active,false);
});
test('已确认退出的监听按原应用原基线恢复，等待期间暂停不会再启动',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const calls=[];let finish;
 const l=new LeaseLoop(async(m,p)=>{if(m==='listener/stop'){finish?.({reason:'paused',childExited:true});return{};}calls.push(p);if(calls.length===1)return{reason:'unexpected_exit',childExited:true};return new Promise(r=>finish=r);},()=>{});
 const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 l.start('same-app',123,Infinity);await flush();assert.equal(calls.length,1);t.mock.timers.tick(4999);await flush();assert.equal(calls.length,1);t.mock.timers.tick(1);await flush();assert.equal(calls.length,2);assert.equal(calls[1].appId,'same-app');assert.equal(calls[1].baseline,123);await l.stop();
 const stopped=new LeaseLoop(async(m,p)=>{if(m==='listener/run'){calls.push(p);return{reason:'unexpected_exit',childExited:true};}return{};},()=>{});stopped.start('same-app',123,Infinity);await flush();await stopped.stop();const count=calls.length;t.mock.timers.tick(10000);await flush();assert.equal(calls.length,count);t.mock.timers.reset();
});
test('停止RPC未结束时拒绝新监听，旧轮次不能覆盖新轮次',async()=>{
 let finish,stopDone;const l=new LeaseLoop(async m=>m==='listener/run'?new Promise(r=>finish=r):new Promise(r=>stopDone=r),()=>{});
 l.start('app',123,Infinity);const stopping=l.stop();assert.throws(()=>l.start('app',123,Infinity),{code:'LISTENER_BUSY'});
 finish({reason:'paused',childExited:true});await l.promise;assert.throws(()=>l.start('app',123,Infinity),{code:'LISTENER_BUSY'});
 stopDone({});await stopping;l.start('app',123,Infinity);const next=l.stop();finish({reason:'paused',childExited:true});stopDone({});await next;
});

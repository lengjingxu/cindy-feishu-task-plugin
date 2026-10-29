const {test}=require('node:test');const assert=require('node:assert/strict');
const {verifiedArtifact,attachmentLink}=require('../src/artifacts.cjs');
const {action}=require('../src/feishu.cjs');
const appId='cli_0000000000000000',guid='11111111-1111-4111-8111-111111111111',fileGuid='22222222-2222-4222-8222-222222222222';
const artifact={id:'report',name:'项目周报.pdf',bytes:128640};
const receipt={guid:fileGuid,name:artifact.name,size:artifact.bytes,resource:{id:guid,type:'task_delivery'}};
const task={id:guid,result:{artifacts:[artifact]},outbox:[{kind:'file',value:artifact,receipt,state:'verified',taskGuid:guid}]};
test('未上传或未核验的文件不能取得下载票据；原任务已核验产物可取',()=>{
 assert.deepEqual(verifiedArtifact(task,artifact.id),{...artifact,guid:fileGuid});
 for(const state of ['prepared','attempted'])assert.throws(()=>verifiedArtifact({...task,outbox:[{...task.outbox[0],state}]},artifact.id),{code:'ARTIFACT_NOT_READY'});
 assert.throws(()=>verifiedArtifact({...task,id:'other-task'},artifact.id),{code:'ARTIFACT_NOT_READY'});
 assert.throws(()=>verifiedArtifact(task,'other'),{code:'ARTIFACT_NOT_FOUND'});
});
test('临时URL只输出链接和文件名；错误归属及危险协议拒绝',()=>{
 const attachment={...receipt,url:'https://example.feishu.cn/download?temporary=1',file_token:'never-export'};
 assert.deepEqual(attachmentLink(attachment,{...artifact,guid:fileGuid},guid),{url:attachment.url,name:artifact.name});
 for(const change of [{guid:'other'},{size:1},{name:'other.pdf'},{resource:{id:'other',type:'task_delivery'}}])assert.throws(()=>attachmentLink({...attachment,...change},{...artifact,guid:fileGuid},guid),{code:'ARTIFACT_SCOPE_MISMATCH'});
 for(const url of ['javascript:alert(1)','file:///tmp/a','http://example.feishu.cn/a','https://user:secret@example.feishu.cn/a','https://example.feishu.cn:8443/a','not a url'])assert.throws(()=>attachmentLink({...attachment,url},{...artifact,guid:fileGuid},guid),{code:'ARTIFACT_LINK_UNAVAILABLE'});
});
function fixture(){let requests=[],seq=0;const remote={status:'done',summary:'周报',members:[{id:appId,type:'app',role:'assignee'}],attachment_deliveries:[receipt]};const f=async(url,init)=>{requests.push({url,method:init.method});let body;if(url.includes('/auth/'))body={code:0,tenant_access_token:'private-token'};else if(url.includes('/attachments/'))body={code:0,data:{attachment:{...receipt,url:'https://example.feishu.cn/download?seq='+ ++seq,file_token:'private-file-token'}}};else body={code:0,data:{task:remote}};return{ok:true,json:async()=>body};};return{f,remote,requests};}
test('已完成任务仍可下载，每次重新查询临时链接，不暴露令牌',async()=>{
 const {f,requests}=fixture();const p={action:'attachment_link',appId,guid,artifact:{...artifact,guid:fileGuid}};
 const a=await action(p,'synthetic',f),b=await action(p,'synthetic',f);assert.notEqual(a.url,b.url);assert(!JSON.stringify([a,b]).includes('private-'));assert.equal(requests.filter(r=>r.url.includes('/attachments/')).length,2);assert(requests.filter(r=>!r.url.includes('/auth/')).every(r=>r.method==='GET'));
});
test('任务已移除应用或附件来自其它任务时，不获取下载URL',async()=>{
 for(const mutate of [r=>r.members=[],r=>r.attachment_deliveries=[{...receipt,resource:{id:'other',type:'task_delivery'}}]]){
  const {f,remote,requests}=fixture();mutate(remote);await assert.rejects(action({action:'attachment_link',appId,guid,artifact:{...artifact,guid:fileGuid}},'synthetic',f));assert(!requests.some(r=>r.url.includes('/attachments/')));
 }
});
